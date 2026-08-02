/**
 * Project-level orchestrator.
 *
 * Runs the full engine for one parcel and a set of scenarios. Decides
 * which scenario gets the "recommended" badge based on a composite score
 * that weights profit, DSCR, and regulatory risk.
 *
 * The composite score is intentionally explicit and tunable here — an
 * investment committee can argue with "we used these weights" but not
 * with "the AI picked it".
 */

import { calculateScenario } from "@/lib/finance/scenario";
import { generatePFSchedule } from "@/lib/finance/cashflow";
import { calculateTaxes } from "@/lib/finance/tax";
import { checkCompliance, complianceScore } from "@/lib/finance/compliance";
import { findMaxAcquisitionAll } from "@/lib/finance/max-acquisition";
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

export interface ProjectComputed {
  parcel: ParcelVM;
  scenarios: ScenarioVM[];
  /** PF schedule for the recommended scenario, ready for the dashboard chart. */
  pfSchedule: CashflowRowVM[];
  /** Risk findings shared at the parcel level (zoning-derived). */
  parcelRisks: RiskVM[];
  /** 실거래 비교 — 같은 법정동 / 시군구 최근 12개월. 백엔드에서 MOLIT 호출 후 주입. */
  comps: CompVM[];
  /** 매각 단가 산정 근거 (Comparable 알고리즘 분석) — 화면 표시용. 주입식. */
  saleEstimate?: SalePriceEstimate;
  /** 권장+최대 시나리오 비교 (의사결정 도구) */
  scenarioComparison?: ScenarioComparison;
  /** 시나리오별 최대 시행 가능 인수가 (IRR 10/15/20% 역산). 백엔드에서 계산 후 주입. */
  maxAcquisition: import("@/lib/finance/max-acquisition").ScenarioMaxAcquisition[];
  meta: {
    lastSyncedAt: string;
    version: string;
  };
}

export interface ComputeOptions {
  /** Project start ISO date for cashflow phasing. */
  startDate?: string;
  /** Force a specific scenario as recommended. */
  recommendedId?: string;
  /** 실거래 transactions — 백엔드에서 MOLIT 호출 결과 주입 */
  transactions?: import("@/lib/integrations/molit").MolitTransaction[];
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
  // Compute each scenario
  const computed = scenarios.map((scenario) =>
    computeOne(parcel, scenario, options.startDate)
  );

  // Decide the recommended scenario.
  // Composite score = 0.5 × profit_rank + 0.3 × dscr_health + 0.2 × regulatory.
  // We rank, not absolute, because profit scales with FAR but DSCR doesn't.
  const recommendedIdx = options.recommendedId
    ? computed.findIndex((c) => c.scenario.id === options.recommendedId)
    : pickRecommended(computed);

  const scenarioVMs = computed.map((c, i) =>
    toScenarioVM(c.scenario, c.result, c.taxes, c.score, i === recommendedIdx)
  );

  // Parcel-level risks come from any scenario; zoning-only checks are
  // invariant, but program-dependent ones (height, parking) we pull from
  // the recommended scenario.
  const recommended = computed[recommendedIdx];
  const parcelRisks = toRiskVMs(recommended.compliance);
  const parcel_ = toParcelVM(parcel, parcelRisks);

  // PF schedule for the recommended scenario
  const pfSchedule = toCashflowVM(recommended.schedule);

  // 실거래 변환 (옵션 — 백엔드에서 transactions 주입한 경우만)
  const comps = options.transactions
    ? toCompVMs(options.transactions, options.parcelDong ?? "")
    : [];

  // 최대 시행 가능 인수가 역산 (옵션 — 12회 calculateScenario 호출)
  const maxAcquisition = options.calculateMaxAcquisition
    ? findMaxAcquisitionAll(parcel, scenarios)
    : [];

  return {
    parcel: parcel_,
    scenarios: scenarioVMs,
    pfSchedule,
    parcelRisks,
    comps,
    maxAcquisition,
    meta: {
      lastSyncedAt: new Date().toISOString(),
      version: "v218",
    },
  };
}

function pickRecommended(
  computed: ReturnType<typeof computeOne>[]
): number {
  // Rank each scenario by profit (higher = better), DSCR (higher = better,
  // capped at 1.6 to avoid over-rewarding low-leverage scenarios), and
  // regulatory score (higher = better).
  const profits = computed.map((c) => c.result.profit);
  const dscrs = computed.map((c) => Math.min(c.result.dscr, 1.6));
  const scores = computed.map((c) => c.score);

  const profitRank = rank(profits);
  const dscrRank = rank(dscrs);
  const regRank = rank(scores);

  let bestIdx = 0;
  let bestComposite = -Infinity;
  for (let i = 0; i < computed.length; i++) {
    const composite =
      0.5 * profitRank[i] + 0.3 * dscrRank[i] + 0.2 * regRank[i];
    if (composite > bestComposite) {
      bestComposite = composite;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Type helper so pickRecommended's parameter type is inferable
function computeOne(p: Parcel, s: Scenario, startDate?: string) {
  const r = calculateScenario({ parcel: p, scenario: s });
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

/** Returns 0..1 normalized rank; higher value gets higher rank. */
function rank(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 1);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => sorted.indexOf(v) / (values.length - 1));
}
