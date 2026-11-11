/**
 * Project-level orchestrator.
 *
 * Runs the full engine for one parcel and a set of scenarios. It keeps every
 * decision objective visible and uses a no-weight Pareto frontier. The legacy
 * `recommended` flag now means only "current comparison focus" so persisted
 * screens can migrate without presenting a hidden aggregate score as truth.
 */

import { calculateScenarioWithCostSensitivity } from "@/lib/finance/construction-cost-sensitivity";
import { generatePFSchedule } from "@/lib/finance/cashflow";
import { calculateTaxes } from "@/lib/finance/tax";
import { checkCompliance, complianceScore } from "@/lib/finance/compliance";
import { findMaxAcquisitionAll } from "@/lib/finance/max-acquisition";
import { calculatedAnnualIrr } from "@/lib/finance/return-metrics";
import {
  buildScenarioDecisionSupport,
  type ScenarioDecisionSupport,
} from "@/lib/finance/scenario-decision-support";
import {
  toScenarioVM,
  toCashflowVM,
  toRiskVMs,
  toParcelVM,
  type ScenarioVM,
  type CashflowRowVM,
  type RiskVM,
  type ParcelVM,
  toCompVMs,
  type CompVM,
} from "@/lib/adapters/view-model";
import type { Parcel, Scenario } from "@/lib/finance/types";

import type { ScenarioComparison } from "@/lib/finance/scenario-verdict";
import type { SalePriceEstimate } from "@/lib/finance/sale-price-from-comps";

export const PROJECT_CALCULATION_VERSION = "v228" as const;

export interface ProjectComputed {
  /** Retained only for the explicitly unpriced site-inspection workflow. */
  siteIntake?: import("@/lib/hooks/use-dynamic-project").StoredParcel;
  parcel: ParcelVM;
  scenarios: ScenarioVM[];
  /** 가중치 없는 파레토 비교와 축별 선두 후보. */
  decisionSupport: ScenarioDecisionSupport;
  /** PF schedule for the current comparison focus, ready for the dashboard chart. */
  pfSchedule: CashflowRowVM[];
  /** Risk findings shared at the parcel level (zoning-derived). */
  parcelRisks: RiskVM[];
  /** 실거래 비교 — 같은 법정동 / 시군구 최근 12개월. 백엔드에서 MOLIT 호출 후 주입. */
  comps: CompVM[];
  transactionEvidence?: import("@/lib/integrations/molit-evidence").MolitRangeEvidence[];
  /** Exclusive-area dwelling sales must not enter legacy land/whole-building valuation. */
  dwellingMarket?: {
    comps: CompVM[];
    evidence: import("@/lib/integrations/molit-evidence").MolitRangeEvidence[];
  };
  /** 매각 단가 산정 근거 (Comparable 알고리즘 분석) — 화면 표시용. 주입식. */
  saleEstimate?: SalePriceEstimate;
  /** 권장+최대 시나리오 비교 (의사결정 도구) */
  scenarioComparison?: ScenarioComparison;
  /** 시나리오별 최대 시행 가능 인수가 (IRR 10/15/20% 역산). 백엔드에서 계산 후 주입. */
  maxAcquisition: import("@/lib/finance/max-acquisition").ScenarioMaxAcquisition[];
  meta: {
    mode?: "site-only";
    intakeRevision?: string;
    lastSyncedAt: string;
    version: string;
    /** Actual schedule input, unlike the non-semantic lastSyncedAt timestamp. */
    calculationStartDate?: string;
  };
}

export interface ComputeOptions {
  /** The selected parcel revision that these calculations describe. */
  intakeRevision?: string;
  /** Project start ISO date for cashflow phasing. */
  startDate?: string;
  /** 사용자 대표안 등 특정 시나리오를 현재 비교 기준으로 고정한다. */
  recommendedId?: string;
  /** 실거래 transactions — 백엔드에서 MOLIT 호출 결과 주입 */
  transactions?: import("@/lib/integrations/molit").MolitTransaction[];
  transactionEvidence?: import("@/lib/integrations/molit-evidence").MolitRangeEvidence[];
  /** 본인 부지의 법정동 (예: "역삼동") — 같은 동 표시용 */
  parcelDong?: string;
  /** 최대 시행 가능 인수가 역산 (시나리오 × IRR 3개 = 12회 calculateScenario 호출, ~100ms) */
  calculateMaxAcquisition?: boolean;
}

export function computeProject(
  parcel: Parcel,
  scenarios: Scenario[],
  options: ComputeOptions = {}
): ProjectComputed {
  if (scenarios.length === 0) {
    throw new Error("프로젝트 계산에는 시나리오가 한 개 이상 필요합니다.");
  }
  const calculationStartDate = options.startDate ?? parcel.acquired;
  if (!Number.isFinite(Date.parse(calculationStartDate))) {
    throw new Error("사업 현금흐름의 시작일이 올바르지 않습니다.");
  }

  // Compute each scenario
  const computed = scenarios.map((scenario) =>
    computeOne(parcel, scenario, calculationStartDate)
  );

  const decisionSupport = buildScenarioDecisionSupport(
    computed.map((candidate) => ({
      id: candidate.scenario.id,
      viable: candidate.result.viable,
      profit: candidate.result.profitUnroundedManwon ?? Number.NaN,
      downsideProfit:
        candidate.result.constructionCostSensitivity?.high.status === "calculated"
          ? candidate.result.constructionCostSensitivity.high.result.profitUnroundedManwon ?? null
          : null,
      npv: candidate.result.npvUnroundedManwon ?? Number.NaN,
      irr: calculatedAnnualIrr(candidate.result),
      requiredEquity: candidate.result.funding.requiredEquityManwon,
      maxExposure: Math.abs(candidate.result.maxExposure),
      durationMonths: candidate.result.totalMonths,
      regulatoryScore: candidate.score,
      fundingStatus: candidate.result.funding.status,
      blockingRegulatoryIssues: candidate.compliance
        .filter(
          (check) =>
            check.level === "high" &&
            ["GFA-01", "GFA-02", "GFA-03", "SUN-02"].includes(check.code),
        )
        .map((check) => check.finding),
      regulatoryReviewIssues:
        candidate.scenario.generation?.useScreening.reviewItems,
    })),
    options.recommendedId,
  );
  const recommendedIdx = computed.findIndex(
    (candidate) => candidate.scenario.id === decisionSupport.focusScenarioId,
  );

  const scenarioVMs = computed.map((c, i) =>
    toScenarioVM(c.scenario, c.result, c.taxes, c.score, i === recommendedIdx)
  );

  // Parcel-level risks and the cached schedule follow the current comparison
  // focus. An explicit representative remains the focus even when the Pareto
  // contract marks it ineligible, so the UI never silently changes user intent.
  const recommended = computed[recommendedIdx];
  const parcelRisks = toRiskVMs(recommended.compliance);
  const parcel_ = toParcelVM(parcel, parcelRisks);

  // PF schedule for the current comparison focus
  const pfSchedule = toCashflowVM(recommended.schedule);

  // 실거래 변환 (옵션 — 백엔드에서 transactions 주입한 경우만)
  const comps = options.transactions
    ? toCompVMs(options.transactions, options.parcelDong ?? "")
    : [];

  // Optional bounded acquisition search; each candidate is explicitly evaluated.
  const maxAcquisition = options.calculateMaxAcquisition
    ? findMaxAcquisitionAll(parcel, scenarios)
    : [];

  return {
    parcel: parcel_,
    scenarios: scenarioVMs,
    decisionSupport,
    pfSchedule,
    parcelRisks,
    comps: comps.filter(comp => comp.type !== "연립다세대"),
    transactionEvidence: options.transactionEvidence?.filter(item => item.type !== "villa"),
    dwellingMarket: options.transactionEvidence?.some(item => item.type === "villa") ? {
      comps: comps.filter(comp => comp.type === "연립다세대"),
      evidence: options.transactionEvidence.filter(item => item.type === "villa"),
    } : undefined,
    maxAcquisition,
    meta: {
      intakeRevision: options.intakeRevision,
      lastSyncedAt: new Date().toISOString(),
      version: PROJECT_CALCULATION_VERSION,
      calculationStartDate,
    },
  };
}

// Shared calculation bundle consumed by the view models and decision contract.
function computeOne(p: Parcel, s: Scenario, startDate?: string) {
  const r = calculateScenarioWithCostSensitivity({ parcel: p, scenario: s });
  const c = checkCompliance({ parcel: p, program: s.program });
  return {
    scenario: s,
    result: r,
    compliance: c,
    score: complianceScore(c),
    taxes: calculateTaxes({
      parcel: p,
      result: r,
      residentialSaleShare: s.program.mix.residentialSale,
    }),
    schedule: generatePFSchedule({
      parcel: p,
      scenario: s,
      result: r,
      startDate: startDate ?? p.acquired,
    }),
  };
}
