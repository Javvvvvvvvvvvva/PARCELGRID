"use client";
import { FacadeCostSummary } from "@/components/planning/FacadeCostSummary";

import { sessionFetch as fetch } from "@/lib/auth/client-session";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  calculateScenario,
  ASSUMPTION_META,
} from "@/lib/finance/scenario";
import { generatePFSchedule } from "@/lib/finance/cashflow";
import { calculateTaxes, TAX_MODEL_AS_OF } from "@/lib/finance/tax";
import {
  EXPERT_TAX_CONTRACT_SCHEMA_VERSION,
  TAX_ASSESSMENT_CATEGORY_META,
  TAX_ASSESSMENT_CATEGORIES,
  buildAfterTaxCalculationBasis,
  buildAfterTaxLedger,
  buildExpertTaxContractKey,
  createDraftExpertTaxContract,
  type AfterTaxLedgerResult,
  type AfterTaxStrategy,
  type ExpertTaxInputContract,
  type ExpertTaxPayment,
  type TaxAssessmentCategory,
  type TaxAssessmentStatus,
  type TaxpayerType,
} from "@/lib/finance/after-tax-ledger";
import {
  buildAfterTaxDecisionSupport,
  type AfterTaxDecisionObjective,
  type AfterTaxDecisionSupport,
} from "@/lib/finance/after-tax-decision-support";
import { PROJECT_LEDGER_MODEL_VERSION } from "@/lib/finance/project-ledger";
import {
  applyRevenuePricingDraft,
  blendedRevenueUnitPrice,
  buildRevenuePricingDraftKey,
  FINANCIAL_REVENUE_POOL_KEYS,
  normalizeRevenueAreaPools,
  revenueAreaForPool,
  revenueAreaTotals,
  revenuePriceSourceFieldForPool,
  revenuePricingFromAssumptions,
  REVENUE_PRICE_ADJUSTMENT_DIMENSIONS,
  type RevenuePoolPricingDraft,
  type RevenuePricingDraftContract,
} from "@/lib/finance/revenue-contract";
import {
  buildFinancialReconciliationAudit,
  type FinancialReconciliationAudit,
} from "@/lib/finance/reconciliation-audit";
import { findMaxAcquisitionForScenario } from "@/lib/finance/max-acquisition";
import { calculatedAnnualIrr, meetsIrrTarget } from "@/lib/finance/return-metrics";
import {
  acquisitionPricePerPyeong,
  acquisitionPriceTotal,
  assessAcquisitionPrice,
  type AcquisitionPriceMode,
} from "@/lib/finance/acquisition-price";
import {
  findDealRescuePaths,
  passesDealRescueTarget,
  type DealRescueChange,
  type DealRescueResult,
} from "@/lib/finance/deal-rescue";
import {
  buildDealStressTest,
  type DealStressResult,
  type DealStressThreshold,
} from "@/lib/finance/deal-stress-test";
import {
  applyFinancialSources,
  buildSourceDataGate,
  FINANCIAL_SOURCE_FIELD_META,
  FINANCIAL_SOURCE_GUIDANCE,
  HOLD_PERIOD_SOURCE_FIELDS,
  TENANT_ROLLOVER_SOURCE_FIELDS,
  sourceKindRequiresDocument,
  validateFinancialSource,
  validateFinancialSourceEvidence,
  type FinancialSourceField,
  type FinancialSourceKind,
  type FinancialSourceMap,
  type FinancialSourceRecord,
  type SourceDataGateResult,
} from "@/lib/finance/source-data-gate";
import {
  SOURCE_DOCUMENT_ACCEPT,
  type SourceDocumentMetadata,
} from "@/lib/finance/source-document";
import type {
  AssumptionSet,
  FinancialRevenueAreaPools,
  FinancialRevenuePoolKey,
  FinancialRevenuePricingSnapshot,
  RevenuePriceAdjustmentDimension,
  TaxBreakdown,
} from "@/lib/finance/types";
import {
  ASSUMPTION_VALUE_RULES,
  assumptionValueWithLegacyDefault,
  validateAssumptionValue,
} from "@/lib/finance/assumption-validation";
import { toCashflowVM, type ScenarioVM } from "@/lib/adapters/view-model";
import type {
  ScenarioDecisionObjective,
  ScenarioDecisionSupport,
} from "@/lib/finance/scenario-decision-support";
import { resolveStage3DashboardContext } from "@/lib/stage3/dashboard-model";
import { commitStage3FeasibilitySnapshot } from "@/lib/services/commit-stage3-feasibility";
import {
  buildStage3Sensitivity,
  findStage3BreakEvenRevenuePrice,
  type Stage3Sensitivity,
} from "@/lib/stage3/feasibility-analysis";
import { useProjectStore } from "@/lib/stores/project-store";
import { won } from "@/lib/utils/format";
import {
  principalHasCapability,
  useAccessSession,
} from "@/lib/hooks/use-access-session";

const SQM_PER_PYEONG = 3.305785;
const EMPTY_FINANCIAL_SOURCES: FinancialSourceMap = {};

type Tone = "positive" | "review" | "negative" | "neutral";

interface AssumptionField {
  field: keyof AssumptionSet;
  label: string;
  divisor: number;
  suffix: string;
  step: number;
  decimals?: number;
}

const ASSUMPTION_GROUPS: Array<{
  title: string;
  fields: AssumptionField[];
}> = [
  {
    title: "매출 가격",
    fields: [
      { field: "salePricePerSqM", label: "매각·분양 단가", divisor: 10_000, suffix: "만원/㎡", step: 10 },
      { field: "rentPerSqMMonth", label: "월 임대료", divisor: 10_000, suffix: "만원/㎡·월", step: 0.1, decimals: 1 },
      { field: "vacancyRate", label: "공실률", divisor: 1, suffix: "%", step: 0.5, decimals: 1 },
      { field: "operatingExpenseRate", label: "운영비율", divisor: 1, suffix: "% EGI", step: 0.5, decimals: 1 },
      { field: "capRate", label: "Exit cap rate", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
    ],
  },
  {
    title: "원가",
    fields: [
      { field: "constCostPerSqM", label: "직접 공사비", divisor: 10_000, suffix: "만원/㎡", step: 10 },
      { field: "basementCostMultiplier", label: "지하 공사비 가중치", divisor: 1, suffix: "배", step: 0.05, decimals: 2 },
      { field: "softCostRate", label: "설계·감리·인허가", divisor: 1, suffix: "%", step: 0.5, decimals: 1 },
      { field: "contingencyRate", label: "예비비", divisor: 1, suffix: "%", step: 0.5, decimals: 1 },
      { field: "acquisitionTaxManwon", label: "취득세 반영액", divisor: 1, suffix: "만원", step: 100 },
      { field: "acquisitionOtherCostManwon", label: "기타 취득 부대비", divisor: 1, suffix: "만원", step: 100 },
      { field: "tenantRelocationCostManwon", label: "명도·임차인 정리비", divisor: 1, suffix: "만원", step: 100 },
    ],
  },
  {
    title: "금융·목표",
    fields: [
      { field: "ltcTarget", label: "PF 적격 공사비 조달비율", divisor: 1, suffix: "%", step: 1 },
      { field: "interestRate", label: "PF 금리", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
      { field: "pfUpfrontFeeRate", label: "PF 약정·취급 수수료", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
      { field: "trustFeeManwon", label: "신탁·자금관리비", divisor: 1, suffix: "만원", step: 100 },
      { field: "equityCommitmentManwon", label: "확인 자기자본 한도", divisor: 1, suffix: "만원", step: 100 },
      { field: "equityIRR", label: "요구 IRR", divisor: 1, suffix: "%", step: 0.5, decimals: 1 },
    ],
  },
  {
    title: "장기대출 검토",
    fields: [
      { field: "takeoutLtv", label: "최대 LTV", divisor: 1, suffix: "%", step: 1 },
      { field: "takeoutInterestRate", label: "연 금리", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
      { field: "takeoutAmortizationYears", label: "원리금 상환기간", divisor: 1, suffix: "년", step: 1 },
      { field: "takeoutLoanTermYears", label: "계약 만기", divisor: 1, suffix: "년", step: 1 },
      { field: "takeoutPaymentDeferralMonths", label: "원리금 납부유예", divisor: 1, suffix: "개월", step: 1 },
      { field: "takeoutInterestOnlyMonths", label: "이자만 납부", divisor: 1, suffix: "개월", step: 1 },
      { field: "takeoutRateResetMonths", label: "금리 재설정", divisor: 1, suffix: "개월", step: 1 },
      { field: "takeoutAnnualRateChange", label: "연 금리 변화", divisor: 1, suffix: "%p/년", step: 0.1, decimals: 2 },
      { field: "takeoutRateFloor", label: "금리 floor", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
      { field: "takeoutRateCap", label: "금리 cap", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
      { field: "takeoutDsraMonths", label: "DSRA 적립", divisor: 1, suffix: "개월", step: 1 },
      { field: "takeoutMinDscr", label: "최소 DSCR", divisor: 1, suffix: "배", step: 0.05, decimals: 2 },
      { field: "takeoutLoanCommitmentManwon", label: "확인 대출 확약액", divisor: 1, suffix: "만원", step: 100 },
      { field: "takeoutFeeRate", label: "취급·약정 수수료", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
    ],
  },
  {
    title: "보유 운영·Exit",
    fields: [
      { field: "holdPeriodYears", label: "장기 보유기간", divisor: 1, suffix: "년", step: 1 },
      { field: "annualRentGrowthRate", label: "연 임대료 성장률", divisor: 1, suffix: "%/년", step: 0.1, decimals: 2 },
      { field: "annualExpenseGrowthRate", label: "연 운영비 성장률", divisor: 1, suffix: "%/년", step: 0.1, decimals: 2 },
      { field: "rentFreeMonths", label: "초기 무상임대", divisor: 1, suffix: "개월", step: 1 },
      { field: "tenantImprovementPerSqM", label: "임차인 공사비", divisor: 10_000, suffix: "만원/㎡", step: 1, decimals: 1 },
      { field: "leasingCommissionRate", label: "임대 중개수수료", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
      { field: "securityDepositMonths", label: "보증금", divisor: 1, suffix: "개월", step: 0.5, decimals: 1 },
      { field: "tenantLeaseTermMonths", label: "가중 평균 임대차", divisor: 1, suffix: "개월", step: 1 },
      { field: "replacementReservePerSqMYear", label: "연 교체 준비금", divisor: 10_000, suffix: "만원/㎡·년", step: 0.1, decimals: 1 },
      { field: "majorRepairYear", label: "대수선 발생", divisor: 1, suffix: "년차", step: 1 },
      { field: "majorRepairCostManwon", label: "대수선 비용", divisor: 1, suffix: "만원", step: 100 },
      { field: "holdExitCapRate", label: "보유 종료 Exit cap", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
      { field: "exitSellingCostRate", label: "매각 부대비", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
    ],
  },
  {
    title: "임차인 교체·갱신",
    fields: [
      { field: "tenantRenewalProbability", label: "갱신 확률", divisor: 1, suffix: "%", step: 1, decimals: 1 },
      { field: "renewalRentAdjustmentRate", label: "갱신 임대료 조정", divisor: 1, suffix: "%", step: 0.5, decimals: 1 },
      { field: "renewalRentFreeMonths", label: "갱신 무상임대", divisor: 1, suffix: "개월", step: 1 },
      { field: "replacementDowntimeMonths", label: "신규 유치 공실", divisor: 1, suffix: "개월", step: 1 },
      { field: "replacementRentFreeMonths", label: "신규 무상임대", divisor: 1, suffix: "개월", step: 1 },
      { field: "replacementTenantImprovementPerSqM", label: "신규 임차인 공사비", divisor: 10_000, suffix: "만원/㎡", step: 1, decimals: 1 },
      { field: "replacementLeasingCommissionRate", label: "신규 임대 중개수수료", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
    ],
  },
  {
    title: "사업 기간",
    fields: [
      { field: "designMonths", label: "설계·인허가", divisor: 1, suffix: "개월", step: 1 },
      { field: "constructionMonths", label: "공사", divisor: 1, suffix: "개월", step: 1 },
      { field: "saleOutMonths", label: "분양·매각", divisor: 1, suffix: "개월", step: 1 },
      { field: "salesPaceMonthlyPct", label: "월 분양 속도", divisor: 1, suffix: "%/월", step: 0.5, decimals: 1 },
      { field: "leaseUpMonths", label: "임대 안정화", divisor: 1, suffix: "개월", step: 1 },
    ],
  },
];

const TAKEOUT_SOURCE_FIELDS: FinancialSourceField[] = [
  "takeoutLtv",
  "takeoutInterestRate",
  "takeoutAmortizationYears",
  "takeoutLoanTermYears",
  "takeoutPaymentDeferralMonths",
  "takeoutInterestOnlyMonths",
  "takeoutRateResetMonths",
  "takeoutAnnualRateChange",
  "takeoutRateFloor",
  "takeoutRateCap",
  "takeoutDsraMonths",
  "takeoutMinDscr",
  "takeoutLoanCommitmentManwon",
  "takeoutFeeRate",
];
const TAKEOUT_ASSUMPTION_FIELDS = new Set<keyof AssumptionSet>(
  TAKEOUT_SOURCE_FIELDS as Array<keyof AssumptionSet>,
);
const HOLD_ASSUMPTION_FIELDS = new Set<keyof AssumptionSet>(
  [...HOLD_PERIOD_SOURCE_FIELDS, ...TENANT_ROLLOVER_SOURCE_FIELDS] as Array<
    keyof AssumptionSet
  >,
);

export default function DashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const accessSession = useAccessSession();
  const canUpdateProject = principalHasCapability(
    accessSession.data,
    "project.update",
  );
  const data = useProjectStore((state) => state.data);
  const saveStage3FeasibilitySnapshot = useProjectStore(
    (state) => state.saveStage3FeasibilitySnapshot
  );
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const representativeScenarioId = useProjectStore((state) => state.representativePlanningScenarioId);
  const representativeGeometry = useProjectStore((state) => state.representativeGeometrySnapshot);
  const geometryValidationError = useProjectStore((state) => state.geometryValidationError);
  const draftAssumptions = useProjectStore((state) => state.draftAssumptions);
  const setDraftAssumption = useProjectStore((state) => state.setDraftAssumption);
  const resetDraftAssumptions = useProjectStore((state) => state.resetDraftAssumptions);
  const draftAcquisitionPrices = useProjectStore((state) => state.draftAcquisitionPrices);
  const setDraftAcquisitionPrice = useProjectStore((state) => state.setDraftAcquisitionPrice);
  const resetDraftAcquisitionPrice = useProjectStore((state) => state.resetDraftAcquisitionPrice);
  const financialSources = useProjectStore((state) => state.financialSources);
  const setFinancialSource = useProjectStore((state) => state.setFinancialSource);
  const removeFinancialSource = useProjectStore((state) => state.removeFinancialSource);
  const revenuePricingDrafts = useProjectStore(
    (state) => state.revenuePricingDrafts,
  );
  const setRevenuePoolPricingDraft = useProjectStore(
    (state) => state.setRevenuePoolPricingDraft,
  );
  const resetRevenuePricingDraft = useProjectStore(
    (state) => state.resetRevenuePricingDraft,
  );
  const expertTaxContracts = useProjectStore((state) => state.expertTaxContracts);
  const setExpertTaxContract = useProjectStore((state) => state.setExpertTaxContract);
  const removeExpertTaxContract = useProjectStore((state) => state.removeExpertTaxContract);
  const [rescueRun, setRescueRun] = useState<{
    key: string;
    result: DealRescueResult;
  } | null>(null);
  const [rescueRunning, setRescueRunning] = useState(false);
  const [rescueError, setRescueError] = useState<{ key: string; message: string } | null>(null);
  const [stressRun, setStressRun] = useState<{
    key: string;
    result: DealStressResult;
  } | null>(null);
  const [stressRunning, setStressRunning] = useState(false);
  const [stressError, setStressError] = useState<{ key: string; message: string } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [taxStrategy, setTaxStrategy] = useState<AfterTaxStrategy>(
    "stabilized-sale"
  );

  const projectPlanningScenarios = useMemo(
    () => planningScenarios.filter(
      (scenario) => scenario.projectId === projectId || scenario.id === representativeScenarioId
    ),
    [planningScenarios, projectId, representativeScenarioId]
  );

  const context = useMemo(
    () => resolveStage3DashboardContext({
      parcel: data?.parcel,
      projectId,
      representativeScenarioId,
      representativeGeometrySnapshot: representativeGeometry,
      planningScenarios: projectPlanningScenarios,
      financeScenarios: data?.scenarios ?? [],
    }),
    [data?.parcel, data?.scenarios, projectId, projectPlanningScenarios, representativeGeometry, representativeScenarioId]
  );

  const activeScenarioId = context.ready ? context.financeScenario.id : representativeScenarioId;
  const draft = activeScenarioId ? draftAssumptions[activeScenarioId] : undefined;
  const draftAcquisitionPrice = draftAcquisitionPrices[projectId];
  const projectFinancialSources =
    financialSources[projectId] ?? EMPTY_FINANCIAL_SOURCES;
  const revenuePricingDraft = activeScenarioId
    ? revenuePricingDrafts[
        buildRevenuePricingDraftKey(projectId, activeScenarioId)
      ]
    : undefined;

  const calculation = useMemo(() => {
    if (!context.ready || !data?.parcel) return null;
    const draftScenario = {
      ...context.financeScenario._raw,
      assumptions: {
      ...context.financeScenario._raw.assumptions,
      ...(draft ?? {}),
      } as AssumptionSet,
    };
    const baseRevenuePricing =
      draftScenario.revenuePricing ??
      draftScenario.program.areaContract?.revenueProjection?.pricing ??
      revenuePricingFromAssumptions(draftScenario.assumptions);
    const scenarioWithRevenuePricing = {
      ...draftScenario,
      revenuePricing: applyRevenuePricingDraft(
        baseRevenuePricing,
        revenuePricingDraft,
      ),
    };
    const draftParcel = {
      ...data.parcel,
      acquiredPrice: draftAcquisitionPrice ?? data.parcel.acquiredPrice,
    };
    const sourced = applyFinancialSources(
      draftParcel,
      scenarioWithRevenuePricing,
      projectFinancialSources
    );
    const parcel = sourced.parcel;
    const scenario = sourced.scenario;
    const assumptions = scenario.assumptions;
    const acquisitionPrice = parcel.acquiredPrice;
    const sourceGate = buildSourceDataGate(scenario, projectFinancialSources);
    const result = calculateScenario({ parcel, scenario });
    const reconciliation = buildFinancialReconciliationAudit({
      result,
      scenario,
    });
    const taxes = calculateTaxes({
      parcel,
      result,
      residentialSaleShare: scenario.program.mix.residentialSale,
    });
    const stabilizedTaxContract =
      expertTaxContracts[
        buildExpertTaxContractKey(projectId, scenario.id, "stabilized-sale")
      ];
    const stabilizedAfterTax = buildAfterTaxLedger({
      projectId,
      scenarioId: scenario.id,
      strategy: "stabilized-sale",
      preTaxEquityCashFlowsManwon: result.equityCashFlowsManwon,
      preTaxAcquisitionTaxManwon: result.acquisitionTax,
      equityHurdleRatePct: assumptions.equityIRR,
      contract: stabilizedTaxContract,
    });
    const holdTaxContract =
      expertTaxContracts[
        buildExpertTaxContractKey(projectId, scenario.id, "long-term-hold")
      ];
    const holdAfterTax = buildAfterTaxLedger({
      projectId,
      scenarioId: scenario.id,
      strategy: "long-term-hold",
      preTaxEquityCashFlowsManwon:
        result.hold.combinedEquityCashFlowsManwon,
      preTaxAcquisitionTaxManwon: result.acquisitionTax,
      equityHurdleRatePct: assumptions.equityIRR,
      contract: holdTaxContract,
    });
    const cashflow = toCashflowVM(generatePFSchedule({
      parcel,
      scenario,
      result,
      startDate: parcel.acquired,
    }));
    const maxAcquisition = findMaxAcquisitionForScenario(
      parcel,
      scenario,
      [assumptions.equityIRR]
    ).results[0];
    const sensitivity = buildStage3Sensitivity(parcel, scenario);
    const breakEven = findStage3BreakEvenRevenuePrice(parcel, scenario);
    return {
      assumptions,
      acquisitionPrice,
      parcel,
      scenario,
      result,
      taxes,
      cashflow,
      maxAcquisition,
      sensitivity,
      breakEven,
      sourceGate,
      reconciliation,
      afterTax: {
        "stabilized-sale": stabilizedAfterTax,
        "long-term-hold": holdAfterTax,
      },
    };
  }, [
    context,
    data?.parcel,
    draft,
    draftAcquisitionPrice,
    expertTaxContracts,
    projectFinancialSources,
    projectId,
    revenuePricingDraft,
  ]);

  const afterTaxDecisionSupport = useMemo(() => {
    if (!data?.decisionSupport) return null;
    return buildAfterTaxDecisionSupport({
      strategy: "stabilized-sale",
      preTaxDecisionSupport: data.decisionSupport,
      candidates: data.scenarios.map((candidate) => ({
        scenarioId: candidate.id,
        ledger: buildAfterTaxLedger({
          projectId,
          scenarioId: candidate.id,
          strategy: "stabilized-sale",
          preTaxEquityCashFlowsManwon: candidate.equityCashFlowsManwon,
          preTaxAcquisitionTaxManwon: candidate.acquisitionTax,
          equityHurdleRatePct: candidate._raw.assumptions.equityIRR,
          contract:
            expertTaxContracts[
              buildExpertTaxContractKey(
                projectId,
                candidate.id,
                "stabilized-sale",
              )
            ],
        }),
        requiredEquityManwon: candidate.funding.requiredEquityManwon,
        maxExposureManwon: Math.abs(candidate.maxExposure),
        durationMonths: candidate.timeline,
        regulatoryScore: candidate.regulatory,
      })),
    });
  }, [data, expertTaxContracts, projectId]);

  if (!data) return null;
  if (!context.ready || !calculation) {
    const blocked = context.ready
      ? { title: "사업성 계산이 준비되지 않았습니다", message: "대표 계획안 계산을 다시 실행하세요.", code: "missing-finance-scenario" }
      : context;
    return (
      <Stage3Blocked
        title={blocked.title}
        message={
          geometryValidationError && blocked.code !== "missing-finance-scenario"
            ? geometryValidationError
            : blocked.message
        }
        projectId={projectId}
      />
    );
  }

  const { planningScenario, geometry, financeScenario } = context;
  const {
    assumptions,
    acquisitionPrice,
    scenario,
    result,
    taxes,
    cashflow,
    maxAcquisition,
    sensitivity,
    breakEven,
    sourceGate,
    reconciliation,
    afterTax,
  } = calculation;
  const contractedRevenueAreas = scenario.program.areaContract
    ? revenueAreaTotals(scenario.program.areaContract.revenueAreas)
    : null;
  const hasSaleRevenue = contractedRevenueAreas
    ? contractedRevenueAreas.saleSqm > 0
    : scenario.program.mix.residentialSale > 0;
  const hasLeaseRevenue = contractedRevenueAreas
    ? contractedRevenueAreas.leaseSqm > 0
    : scenario.program.mix.residentialLease > 0 ||
      scenario.program.mix.retail > 0;
  const currentSaleUnitPrice = hasSaleRevenue
    ? blendedRevenueUnitPrice(scenario, "sale")
    : 0;
  const usesPresalePace =
    (scenario.program.areaContract
      ? normalizeRevenueAreaPools(scenario.program.areaContract.revenueAreas)
          .residentialSaleSqm > 0
      : scenario.program.mix.residentialSale > 0) &&
    scenario.program.type !== "single-house" &&
    scenario.program.type !== "multi-family";
  const revenueAreas = scenario.program.areaContract
    ? normalizeRevenueAreaPools(scenario.program.areaContract.revenueAreas)
    : null;
  const activeRevenuePools = revenueAreas
    ? FINANCIAL_REVENUE_POOL_KEYS.filter(
        (pool) => revenueAreaForPool(revenueAreas, pool) > 0,
      )
    : [];
  const saleSourceFields: FinancialSourceField[] = [
    ...(revenueAreas
      ? activeRevenuePools
          .filter((pool) => pool.endsWith("Sale"))
          .map(revenuePriceSourceFieldForPool)
      : (["salePricePerSqM"] as FinancialSourceField[])),
    ...(usesPresalePace
      ? (["salesPaceMonthlyPct"] as FinancialSourceField[])
      : []),
  ];
  const leaseSourceFields: FinancialSourceField[] = [
    ...(revenueAreas
      ? activeRevenuePools
          .filter((pool) => pool.endsWith("Lease"))
          .map(revenuePriceSourceFieldForPool)
      : (["rentPerSqMMonth"] as FinancialSourceField[])),
    "vacancyRate",
    "operatingExpenseRate",
    "capRate",
    "leaseUpMonths",
  ];
  const hasBasementCost =
    (scenario.program.areaContract?.basementAreaSqm ?? 0) > 0 ||
    scenario.program.floorsBelow > 0;
  const activeAssumptionGroups = ASSUMPTION_GROUPS.map((group) => ({
    ...group,
    fields: group.fields.filter(({ field }) => {
      if (field === "basementCostMultiplier") return hasBasementCost;
      if (field === "salePricePerSqM") return !scenario.program.areaContract && hasSaleRevenue;
      if (field === "saleOutMonths") return hasSaleRevenue;
      if (field === "salesPaceMonthlyPct") return usesPresalePace;
      if (TAKEOUT_ASSUMPTION_FIELDS.has(field)) return hasLeaseRevenue;
      if (HOLD_ASSUMPTION_FIELDS.has(field)) {
        return hasLeaseRevenue;
      }
      if (
        (field === "rentPerSqMMonth" && !scenario.program.areaContract) ||
        field === "vacancyRate" ||
        field === "operatingExpenseRate" ||
        field === "capRate" ||
        field === "leaseUpMonths"
      ) {
        return hasLeaseRevenue;
      }
      return true;
    }),
  })).filter((group) => group.fields.length > 0);
  const acquisitionEdited =
    projectFinancialSources.acquisitionPrice != null ||
    (draftAcquisitionPrice != null &&
      draftAcquisitionPrice !== data.parcel.acquiredPrice);
  const pricingEditedCount = Object.values(revenuePricingDraft?.pools ?? {}).reduce(
    (count, pool) =>
      count +
      (pool?.baseUnitPriceWon != null ? 1 : 0) +
      Object.keys(pool?.adjustments ?? {}).length,
    0,
  );
  const editedCount =
    Object.keys(draft ?? {}).length +
    pricingEditedCount +
    (acquisitionEdited ? 1 : 0);
  const marketEstimate = data.parcel.acquisitionEstimate?.estimatedPriceManwon
    ?? (data.parcel.estMarketPrice
      ? Math.round((data.parcel.estMarketPrice * data.parcel.lotArea) / 10_000)
      : Math.round((data.parcel.landPrice * data.parcel.lotArea) / 10_000));
  const marketMedianTotal = data.parcel.acquisitionEstimate?.marketMedianManwon ?? 0;
  const houseProxy = data.parcel.acquisitionEstimate?.houseProxy;
  const acquisitionPerPyeong = acquisitionPricePerPyeong(
    acquisitionPrice,
    data.parcel.lotArea
  );
  const publicValueTotal = Math.round((data.parcel.landPrice * data.parcel.lotArea) / 10_000);
  const bidGap = maxAcquisition.marketGap;
  const acquisitionSearchLabel = maxAcquisition.status === "bracketed"
    ? "탐색 구간 내 후보"
    : maxAcquisition.status === "search-limited"
      ? "탐색 한도 도달"
      : maxAcquisition.status === "no-candidate"
        ? "통과 후보 미발견" : "계산 확인 필요";
  const acquisitionTargetTone: Tone = maxAcquisition.feasible === null
    ? "review" : maxAcquisition.feasible === false ? "negative"
      : maxAcquisition.marketFundingStatus === "unverified" ? "review" : "positive";
  const takeoutDscrAvailable = result.dscrStatus === "takeout-amortizing";
  const takeoutMeetsDscr =
    takeoutDscrAvailable && result.dscr >= assumptions.takeoutMinDscr;
  const takeoutStatusTone: Tone =
    result.takeout.status === "commitment-feasible"
      ? "positive"
      : result.takeout.status === "commitment-shortfall" ||
          result.takeout.status === "terms-invalid"
        ? "negative"
        : result.takeout.status === "not-applicable"
          ? "neutral"
          : "review";
  const takeoutBindingLabel = result.takeout.bindingConstraints
    .map((constraint) => {
      if (constraint === "ltv") return "LTV";
      if (constraint === "dscr") return "DSCR";
      return "확약액";
    })
    .join(" · ");
  const holdEnabled =
    hasLeaseRevenue && assumptions.holdPeriodYears > 0;
  const holdCalculated = [
    "modeled-unverified",
    "refinance-shortfall",
    "commitment-feasible",
  ].includes(result.hold.status);
  const holdTone: Tone =
    result.hold.status === "commitment-feasible"
      ? "positive"
      : result.hold.status === "refinance-shortfall" ||
          result.hold.status === "terms-invalid"
        ? "negative"
        : result.hold.status === "not-applicable" ||
            result.hold.status === "not-configured"
          ? "neutral"
          : "review";
  const activeTaxStrategy: AfterTaxStrategy =
    taxStrategy === "long-term-hold" && holdCalculated
      ? "long-term-hold"
      : "stabilized-sale";
  const activeAfterTax = afterTax[activeTaxStrategy];
  const activePreTaxEquityCashFlowsManwon =
    activeTaxStrategy === "long-term-hold"
      ? result.hold.combinedEquityCashFlowsManwon
      : result.equityCashFlowsManwon;
  const activeTaxContract =
    expertTaxContracts[
      buildExpertTaxContractKey(projectId, scenario.id, activeTaxStrategy)
    ];
  const rawProfit = result.profitUnroundedManwon;
  const profitTone: Tone = !Number.isFinite(rawProfit) ? "review" : rawProfit! > 0 ? "positive" : rawProfit! < 0 ? "negative" : "review";
  const annualIrr = calculatedAnnualIrr(result);
  const irrAvailable = annualIrr !== null;
  const irrTone: Tone = !irrAvailable
    ? "review"
    : meetsIrrTarget(result, assumptions.equityIRR)
      ? "positive"
      : "negative";
  const marketConfidence = data.parcel.acquisitionEstimate?.confidence ?? "low";
  const saleConfidence = data.saleEstimate?.confidence ?? "low";
  const aboveFloors = geometry.building.aboveGroundFloors.length;
  const basementFloors = geometry.building.basementFloors.length;
  const currentSourceValues = {
    acquisitionPrice,
    ...assumptions,
    ...Object.fromEntries(
      FINANCIAL_REVENUE_POOL_KEYS.map((pool) => [
        revenuePriceSourceFieldForPool(pool),
        scenario.revenuePricing?.pools[pool].baseUnitPriceWon ??
          scenario.revenuePricing?.pools[pool].unitPriceWon ??
          0,
      ]),
    ),
  } as Record<FinancialSourceField, number>;
  const pendingSourceFields = Array.from(
    new Set([
      ...sourceGate.missingFields,
      ...sourceGate.invalidFields.map((item) => item.field),
    ])
  );
  const pendingSourceLabels = pendingSourceFields
    .slice(0, 4)
    .map((field) => FINANCIAL_SOURCE_FIELD_META[field].label)
    .join(" · ");
  const rescueKey = JSON.stringify({
    projectId,
    geometryHash: geometry.geometryHash,
    scenarioId: scenario.id,
    acquisitionPrice,
    assumptions,
    revenuePricing: scenario.revenuePricing,
  });
  const visibleRescue =
    rescueRun?.key === rescueKey ? rescueRun.result : null;
  const visibleStress =
    stressRun?.key === rescueKey ? stressRun.result : null;

  const resetAll = () => {
    resetDraftAssumptions(financeScenario.id);
    resetDraftAcquisitionPrice(projectId);
    resetRevenuePricingDraft(projectId, financeScenario.id);
  };

  const commitCurrentSnapshot = () => {
    const nextData = commitStage3FeasibilitySnapshot(
      data,
      calculation.parcel,
      scenario
    );
    const savedAtIso = new Date().toISOString();
    saveStage3FeasibilitySnapshot({
      projectId,
      representativeScenarioId: planningScenario.id,
      representativeScenarioVersion: planningScenario.version,
      geometryHash: geometry.geometryHash,
      savedAt: savedAtIso,
      data: nextData,
    });
    setSavedAt(
      new Date(savedAtIso).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  };

  const openHandoff = () => {
    commitCurrentSnapshot();
    router.push(`/projects/${projectId}/handoff`);
  };

  const runDealRescue = () => {
    setRescueRunning(true);
    setRescueRun(null);
    setRescueError(null);
    window.setTimeout(() => {
      try {
        const rescue = findDealRescuePaths(calculation.parcel, scenario);
        setRescueRun({ key: rescueKey, result: rescue });
      } catch (error) {
        setRescueError({ key: rescueKey, message: error instanceof Error ? error.message : "입력값과 계산 범위를 확인하세요." });
      } finally {
        setRescueRunning(false);
      }
    }, 0);
  };

  const runDealStress = () => {
    setStressRunning(true);
    setStressRun(null);
    setStressError(null);
    window.setTimeout(() => {
      try {
        const stress = buildDealStressTest(calculation.parcel, scenario);
        setStressRun({ key: rescueKey, result: stress });
      } catch (error) {
        setStressError({ key: rescueKey, message: error instanceof Error ? error.message : "입력값과 계산 범위를 확인하세요." });
      } finally {
        setStressRunning(false);
      }
    }, 0);
  };

  return (
    <div className="stage3-page">
      {geometry.analysisReference && <section role="status" className="audit-banner">
        <div className="audit-copy"><strong>예비 분석 기준안 · 공식 경계·허가·전문가 승인 미확정</strong>
          <span>채택 시 미확정 {geometry.analysisReference.unresolved.length}건 · 가정에 따른 사업성 계산</span></div>
      </section>}
      <header className="stage3-header">
        <div>
          <div className="eyebrow">STAGE 3 · FEASIBILITY</div>
          <h1>대표 계획안의 가격과 사업성을 검토합니다</h1>
          <p>Stage 2 대표 매스에 관측자료와 검토 가정을 연결한 예비 사업성 모델입니다. 금융기관 약정·시공사 견적·세무 검토 전에는 투자 확정값으로 사용할 수 없습니다.</p>
        </div>
        <div className="header-actions">
          <StatusBadge tone={geometry.validation.status === "pass" ? "positive" : "review"}>
            Geometry {geometry.validation.status === "pass" ? "확인" : "검토"}
          </StatusBadge>
          <button className="secondary-button" onClick={() => router.push(`/projects/${projectId}/envelope`)}>계획 스튜디오</button>
        </div>
      </header>

      {!canUpdateProject && (
        <div className="stage3-readonly" role="status">
          현재 계정은 계산과 근거를 열람할 수 있지만 가정·원문·저장본을 변경할 수 없습니다.
        </div>
      )}

      <fieldset className="stage3-permission-scope" disabled={!canUpdateProject}>

      <section className="audit-banner" role="status" style={sourceGate.status === "source-backed" ? { borderColor: "var(--pos-fg)", background: "var(--pos-soft)", color: "var(--pos-fg)" } : undefined}>
        <div className="audit-copy">
          <strong>{sourceGate.status === "source-backed" ? "소스 데이터 게이트 통과" : "소스 데이터 미완료 · 확정 판단 차단"}</strong>
          <span>
            {sourceGate.status === "source-backed"
              ? `필수 입력 ${sourceGate.validRecords.length}건이 원문·발급기관·기준일·확인자와 함께 등록되어 계산에 반영됐습니다.`
              : `필수 입력 ${sourceGate.requiredFields.length}건 중 ${sourceGate.validRecords.length}건 검증 · 다음 필요: ${pendingSourceLabels || "등록값 원문 확인"}${pendingSourceFields.length > 4 ? ` 외 ${pendingSourceFields.length - 4}건` : ""}`}
          </span>
        </div>
        {sourceGate.status !== "source-backed" && (
          <a className="audit-link" href="#source-data-room">근거자료 입력</a>
        )}
      </section>

      <section className="source-lock">
        <div className="source-main">
          <span className="section-kicker">LOCKED REPRESENTATIVE</span>
          <strong>{planningScenario.name}</strong>
          <span>v{planningScenario.version} · 지상 {aboveFloors}층{basementFloors ? ` / 지하 ${basementFloors}층` : ""} · 프로그램 {geometry.building.totalProgramAreaSqm.toFixed(1)}㎡</span>
        </div>
        <Fact label="실현 용적률" value={`${geometry.building.preliminaryFarPct.toFixed(1)}%`} />
        <Fact label="Geometry hash" value={geometry.geometryHash} mono />
        <Fact label="금융 원장" value={`${PROJECT_LEDGER_MODEL_VERSION} · ${data.meta.version}`} mono />
      </section>

      <section className="decision-grid">
        <DecisionSignal
          label="사업 손익"
          title={profitTone === "positive" ? "현재 가정상 흑자" : profitTone === "negative" ? "현재 가정상 손실" : "손익 정밀값 확인"}
          value={won(result.profit)}
          tone={profitTone}
          note={`세전 매출 대비 ${result.profitMargin.toFixed(1)}% · 미산정 세금 있음`}
        />
        <DecisionSignal
          label="요구수익률"
          title={
            !irrAvailable
              ? result.irrStatus === "ambiguous"
                ? "IRR 복수해 가능"
                : "IRR 산정 불가"
              : meetsIrrTarget(result, assumptions.equityIRR)
                ? "현재 가정상 목표 충족"
                : "현재 가정상 목표 미달"
          }
          value={annualIrr !== null ? `IRR ${annualIrr.toFixed(3)}%` : "IRR N/A"}
          tone={irrTone}
          note={
            irrAvailable
              ? `요구 IRR ${assumptions.equityIRR.toFixed(1)}% · NPV ${won(result.npv)} · 반올림 전 판정`
              : `IRR 대신 NPV ${won(result.npv)} 확인 · 현금흐름 부호 패턴 검토 필요`
          }
        />
        <DecisionSignal
          label="현재 취득대금 목표 검사"
          title={maxAcquisition.feasible === null ? "현재가 판정 불가" : maxAcquisition.feasible ? "현재가 IRR 목표 충족" : "현재가 목표 미충족"}
          value={bidGap === null ? "역산 후보 미산정" : `후보가 차이 ${won(bidGap, { sign: true })}`}
          tone={acquisitionTargetTone}
          note={`${acquisitionSearchLabel} · 세전 IRR·계획·자금부족 검사 · 전역 최대가 아님${maxAcquisition.marketFundingStatus === "unverified" ? " · 자금한도 미확인" : ""}`}
        />
        <DecisionSignal
          label="장기대출 원리금 커버"
          title={
            !hasLeaseRevenue
              ? "임대형 N/A"
              : result.takeout.status === "terms-missing"
                ? "장기대출 조건 미입력"
                : result.takeout.status === "terms-invalid"
                  ? "장기대출 조건 오류"
                : result.takeout.status === "commitment-shortfall"
                  ? "PF 재융자 부족"
                  : result.takeout.status === "modeled-unverified"
                    ? "계산 한도·확약 미확인"
                    : takeoutMeetsDscr
                      ? "입력 조건상 목표 충족"
                      : "조건 검토"
          }
          value={
            takeoutDscrAvailable
              ? `DSCR ${result.dscr.toFixed(2)}`
              : result.takeout.status === "terms-missing"
                ? "조건 미입력"
                : result.takeout.status === "terms-invalid"
                  ? "입력 오류"
                  : "임대 NOI 없음"
          }
          tone={takeoutStatusTone}
          note={
            takeoutDscrAvailable
              ? `안정화 NOI ÷ 최대 연간 정기 원리금 · 최소 ${assumptions.takeoutMinDscr.toFixed(2)} · balloon 별도`
              : hasLeaseRevenue
                ? "LTV·금리·상환기간·계약 만기·최소 DSCR을 확인해야 산정합니다"
                : "임대 NOI가 있는 안에만 적용합니다"
          }
        />
      </section>

      <section
        className="funding-banner"
        role="status"
        data-status={result.funding.status}
      >
        <div>
          <span className="section-kicker">FUNDING CAPACITY</span>
          <strong>
            {result.funding.status === "unverified"
              ? "자기자본 한도 미확인"
              : result.funding.status === "shortfall"
                ? `자기자본 ${won(result.funding.shortfallManwon)} 부족`
                : "확인 자기자본 한도 내 조달 가능"}
          </strong>
        </div>
        <p>
          필요 {won(result.funding.requiredEquityManwon)} · 확인 한도{" "}
          {result.funding.equityCommitmentManwon == null
            ? "미입력"
            : won(result.funding.equityCommitmentManwon)}
          {result.funding.firstShortfallMonth == null
            ? ""
            : ` · ${result.funding.firstShortfallMonth}개월차부터 부족`}
          {` · 계획 PF 한도 ${won(result.funding.pfCommitmentManwon)} · 최고잔액 ${won(result.funding.maxPfBalanceManwon)}`}
        </p>
      </section>

      {hasLeaseRevenue && (
        <section
          className="takeout-banner"
          role="status"
          data-status={result.takeout.status}
        >
          <div>
            <span className="section-kicker">TAKE-OUT UNDERWRITING</span>
            <strong>
              {result.takeout.status === "terms-missing"
                ? "장기대출 조건 미입력"
                : result.takeout.status === "terms-invalid"
                  ? "장기대출 조건 오류"
                : result.takeout.status === "commitment-shortfall"
                  ? `입력 확약액 기준 ${won(result.takeout.refinanceShortfallManwon ?? 0)} 부족`
                  : result.takeout.status === "commitment-feasible"
                    ? "입력 확약액 기준 PF 상환 가능"
                    : result.takeout.status === "modeled-unverified"
                      ? (result.takeout.refinanceShortfallManwon ?? 0) > 0
                        ? `계산상 ${won(result.takeout.refinanceShortfallManwon ?? 0)} 부족`
                        : "계산 한도 내 상환 가능 · 확약 미확인"
                      : "안정화 임대가치·NOI 확인 필요"}
            </strong>
          </div>
          <p>
            {result.takeout.modeledLoanManwon == null
              ? result.takeout.invalidTerms.length > 0
                ? result.takeout.invalidTerms.join(" ")
                : "최대 LTV·초기 금리·상환기간·계약 만기·최소 DSCR과 대출 확약액을 입력하면 PF 상환 부족액을 계산합니다."
              : `장기대출 ${won(result.takeout.modeledLoanManwon)} · 수수료·DSRA 차감 종결 현금흐름 ${won(result.takeout.netTakeoutCashFlowManwon ?? result.takeout.netTakeoutProceedsManwon ?? 0)} · DSRA ${won(result.takeout.dsraRequiredBalanceManwon ?? 0)} · PF 상환 필요 ${won(result.takeout.pfBalanceToRefinanceManwon)} · LTV ${(result.takeout.ltvPct ?? 0).toFixed(1)}% · DSCR ${(result.takeout.dscr ?? 0).toFixed(2)} · Debt yield ${(result.takeout.debtYieldPct ?? 0).toFixed(1)}% · ${result.takeout.rateMode === "projected-variable" ? `예상 변동금리 ${(result.takeout.minimumProjectedRatePct ?? 0).toFixed(2)}~${(result.takeout.maximumProjectedRatePct ?? 0).toFixed(2)}%` : `고정금리 ${(result.takeout.maximumProjectedRatePct ?? 0).toFixed(2)}%`} · 최대 연 정기상환 ${won(result.takeout.maximumAnnualDebtServiceManwon ?? 0)} · 만기 balloon ${won(result.takeout.maturityBalloonManwon ?? 0)}${takeoutBindingLabel ? ` · 한도 제약 ${takeoutBindingLabel}` : ""}`}
            <br />현재 기본 손익·IRR은 임대 안정화 후 자산 매각 가정입니다. 보유기간을 설정하면 장기대출 실행값이 아래 별도 보유 원장에 반영됩니다.
          </p>
        </section>
      )}

      {hasLeaseRevenue && (
        <section
          className="hold-section"
          role="status"
          data-status={result.hold.status}
          data-tone={holdTone}
        >
          <div className="hold-heading">
            <div>
              <span className="section-kicker">LONG-TERM HOLD ALTERNATIVE</span>
              <strong>
                {result.hold.status === "not-configured"
                  ? "장기 보유안 미설정"
                  : result.hold.status === "not-applicable"
                    ? "임대 보유안 비적용"
                    : result.hold.status === "terms-missing"
                      ? "보유 원장 필수 조건 미입력"
                      : result.hold.status === "terms-invalid"
                        ? "보유 원장 입력값 오류"
                        : result.hold.status === "refinance-shortfall"
                          ? "재융자 부족분을 자기자본으로 보충한 보유안"
                          : result.hold.status === "commitment-feasible"
                            ? "확약액 기준 재융자 가능한 보유안"
                            : "계산상 보유안 · 대출 확약 미확인"}
              </strong>
            </div>
            <p>
              {result.hold.status === "not-configured"
                ? "보유기간을 입력하기 전에는 기존 안정화 매각 결과만 표시합니다."
                : result.hold.status === "not-applicable"
                  ? result.hold.warnings[0]
                  : result.hold.status === "terms-missing" ||
                      result.hold.status === "terms-invalid"
                    ? result.hold.warnings.join(" ")
                    : `${result.hold.strategyMode === "mixed-sale-lease" ? `혼합안 매각대금 ${won(result.hold.developmentSaleRevenueManwon ?? 0)} 유지 · ` : ""}개발 ${result.totalMonths}개월 + 운영 ${result.hold.holdMonths}개월 · 보유 임대자산 ${won(result.hold.retainedLeaseValueManwon ?? 0)} · 최종 매각 ${won(result.hold.exitSaleGrossManwon ?? 0)} · 종료시 잔존대출 상환 ${won(result.hold.exitLoanPayoffManwon ?? 0)} · 계약 balloon ${won(result.hold.totalTakeoutBalloonManwon ?? 0)}${result.hold.balloonPaymentMonth == null ? "" : ` (${result.hold.balloonPaymentMonth}개월차)`}`}
            </p>
          </div>
          {holdCalculated && (
            <>
              <div className="hold-metrics">
                <HoldMetric
                  label="개발+보유 세전손익"
                  value={won(result.hold.profitManwon ?? 0)}
                />
                <HoldMetric
                  label="보유안 세전 IRR"
                  value={
                    result.hold.irrStatus === "calculated" &&
                    result.hold.irrPct != null
                      ? `${result.hold.irrPct.toFixed(1)}%`
                      : "N/A"
                  }
                />
                <HoldMetric
                  label="보유안 NPV"
                  value={won(result.hold.npvManwon ?? 0)}
                />
                <HoldMetric
                  label="Equity Multiple"
                  value={`${(result.hold.equityMultiple ?? 0).toFixed(2)}x`}
                />
                <HoldMetric
                  label="최저 연 DSCR"
                  value={
                    result.hold.minimumAnnualDscr == null
                      ? "N/A"
                      : result.hold.minimumAnnualDscr.toFixed(2)
                  }
                />
                <HoldMetric
                  label="누적 회수"
                  value={
                    result.hold.paybackMonth == null
                      ? "미회수"
                      : `${result.hold.paybackMonth}개월`
                  }
                />
                <HoldMetric
                  label="임대차 만기 이벤트"
                  value={`${result.hold.tenantRolloverEvents?.length ?? 0}회`}
                />
              </div>
              <p className="hold-costs">
                초기 TI {won(result.hold.initialTenantImprovementManwon ?? 0)} · 최초 임대 중개 {won(result.hold.initialLeasingCommissionManwon ?? 0)} · 임차 교체 공실 {won(result.hold.totalRolloverDowntimeLossManwon ?? 0)} · 교체 TI {won(result.hold.totalReplacementTenantImprovementManwon ?? 0)} · 교체 중개 {won(result.hold.totalReplacementLeasingCommissionManwon ?? 0)} · 무상임대 손실 {won(result.hold.totalRentFreeConcessionManwon ?? 0)} · 최대 제한 보증금 {won(result.hold.maximumSecurityDepositManwon ?? 0)} · DSRA {won(result.hold.initialDsraManwon ?? 0)} · 교체 준비금 {won(result.hold.totalReplacementReserveManwon ?? 0)} · 대수선 {won(result.hold.totalMajorRepairManwon ?? 0)} · 자본화 이자 {won(result.hold.totalTakeoutCapitalizedInterestManwon ?? 0)} · 만기 balloon {won(result.hold.totalTakeoutBalloonManwon ?? 0)}
              </p>
            </>
          )}
          <p className="hold-boundary">
            이 값은 안정화 매각 기본 지표와 분리된 대안이며 현재 저장 계획안의 공통 Pareto 비교에는 포함하지 않습니다. 임차 교체는 가중 평균 만기 기반 기대값이며 임차인별 비동기 만기·중도해지·대손과 재산세·반복 보험료는 미반영입니다.
          </p>
        </section>
      )}

      <ExpertTaxWorkspace
        key={`${scenario.id}:${activeTaxStrategy}`}
        projectId={projectId}
        scenarioId={scenario.id}
        strategy={activeTaxStrategy}
        allowHoldStrategy={holdCalculated}
        contract={activeTaxContract}
        result={activeAfterTax}
        statutoryTaxes={taxes}
        preTaxEquityCashFlowsManwon={activePreTaxEquityCashFlowsManwon}
        preTaxAcquisitionTaxManwon={result.acquisitionTax}
        equityHurdleRatePct={assumptions.equityIRR}
        onStrategyChange={setTaxStrategy}
        onSave={setExpertTaxContract}
        onRemove={() =>
          removeExpertTaxContract(
            projectId,
            scenario.id,
            activeTaxStrategy
          )
        }
      />

      <section className="dashboard-section land-section" id="land-price">
        <SectionHeader
          eyebrow="LAND PRICE LADDER"
          title="토지 가격의 원본·입력·알고리즘 결과를 분리합니다"
          description="시장 참고 추정가는 실거래·공시지가에 자체 보정 규칙을 적용한 값입니다. 감정평가액이 아니며, 예비 취득대금 후보는 한정된 범위에서 세전 목표를 재검사한 값입니다."
        />
        <div className="price-ladder">
          <PricePoint label="공시지가 총액" value={publicValueTotal} note="공시지가 × 필지면적" />
          {marketMedianTotal > 0 && (
            <PricePoint
              label="토지 실거래 중앙값"
              value={marketMedianTotal}
              note={`${Math.round(data.parcel.acquisitionEstimate?.marketMedianPerPyeong ?? 0).toLocaleString()}만원/평 · 토지 분포 참고`}
            />
          )}
          <PricePoint
            label="알고리즘 참고 추정가"
            value={marketEstimate}
            note={`${acquisitionMethodLabel(data.parcel.acquisitionEstimate?.method)}${houseProxy ? ` ${houseProxy.sampleSize}건` : ""} · ${confidenceLabel(marketConfidence)}`}
            tone="market"
          />
          <PricePoint
            label="현재 부동산 총 취득대금"
            value={acquisitionPrice}
            note={`${Math.round(acquisitionPerPyeong).toLocaleString()}만원/평 · ${acquisitionEdited ? "사용자 수정값" : "부지 등록 입력값"}`}
            tone="active"
          />
          <PricePoint
            label="예비 모델상 취득대금 후보"
            value={maxAcquisition.maxLandCost}
            note={`요구 IRR ${assumptions.equityIRR.toFixed(1)}% · ${acquisitionSearchLabel} · 전역 최대가 아님`}
            tone={acquisitionTargetTone === "positive" ? "safe" : acquisitionTargetTone === "negative" ? "risk" : "default"}
          />
        </div>
        <div className="method-strip">
          <span>
            활성 추정 표본 <b>
              {data.parcel.acquisitionEstimate?.method === "house-comps"
                ? houseProxy
                  ? `구축 주택 ${houseProxy.sampleSize}건`
                  : "구축 주택 · 구버전 표본 미보존"
                : `${data.parcel.acquisitionEstimate?.details?.sampleSize ?? "미보존"}건`}
            </b>
          </span>
          <span>토지 분포 표본 <b>{data.parcel.acquisitionEstimate?.transactionCount ?? "미보존"}건</b></span>
          <span>동일 지목 표본 <b>{data.parcel.acquisitionEstimate?.details?.sampleSize ?? "미보존"}</b></span>
          <span>입지 티어 <b>{data.parcel.acquisitionEstimate?.details?.locationTier ?? "이전 프로젝트"}</b></span>
          <button className="text-button" onClick={() => router.push(`/projects/${projectId}/comps`)}>실거래 근거 열기</button>
        </div>
      </section>

      <div className="workspace-grid">
        <main className="stage3-main">
          <section className="dashboard-section"><h2>외벽 수량·재료비</h2><FacadeCostSummary cost={scenario.program.areaContract?.facadeCost} /></section>
          <section className="dashboard-section">
            <SectionHeader eyebrow="PRELIMINARY PRO FORMA" title="예비 사업수지" description="공사비·금융·매출 가정을 한 원장에서 계산한 세전 결과입니다. 세후 결과는 위 세무 전문가 입력 원장에서 별도로 계산합니다." />
            <FinancialReconciliationPanel audit={reconciliation} />
            <div className="metric-grid">
              <MetricCard label="세전 총사업비" value={won(result.totalCost)} note="0원 미확인 비용은 합계에서 제외" />
              <MetricCard label="가정상 매출·가치" value={won(result.totalRevenue)} />
              <MetricCard label="세전 예상손익" value={won(result.profit)} tone={profitTone} />
              <MetricCard label="이익률" value={`${result.profitMargin.toFixed(1)}%`} tone={profitTone} />
              <MetricCard
                label="필요 자기자본"
                value={won(result.equity)}
                note={
                  result.funding.status === "unverified"
                    ? "확인 한도 미입력"
                    : result.funding.status === "shortfall"
                      ? `${won(result.funding.shortfallManwon)} 부족`
                      : "확인 한도 이내"
                }
                tone={
                  result.funding.status === "shortfall"
                    ? "negative"
                    : result.funding.status === "funded"
                      ? "positive"
                      : "review"
                }
              />
              <MetricCard label="예비 PF 최고잔액" value={won(result.pfLoan)} note={`실제 LTC ${result.ltc.toFixed(1)}%`} />
              <MetricCard label="세전 IRR" value={irrAvailable ? `${result.irr.toFixed(1)}%` : "N/A"} note={irrAvailable ? undefined : "유일한 IRR을 산정할 수 없음"} tone={irrTone} />
              <MetricCard label="세전 NPV" value={won(result.npv)} note={`할인율 ${assumptions.equityIRR.toFixed(1)}% · 반올림 전 판정`} tone={!Number.isFinite(result.npvUnroundedManwon) ? "review" : result.npvUnroundedManwon! >= 0 ? "positive" : "negative"} />
            </div>
            <div className="return-strip">
              <ReturnMetric label="Equity Multiple" value={`${result.equityMultiple.toFixed(2)}x`} />
              <ReturnMetric label="최대 자금노출" value={won(Math.abs(result.maxExposure))} />
              <ReturnMetric label="회수 예상" value={result.paybackMonths == null ? "N/A" : `${result.paybackMonths}개월`} note={result.paybackMonths == null ? "사업기간 내 미회수" : undefined} />
              <ReturnMetric label="전체 기간" value={`${result.totalMonths}개월`} />
              <ReturnMetric label="세전 원장 포함 세금" value={won(taxes.includedInPretaxTotal)} note="세후에서 중복 차감하지 않음" />
            </div>
          </section>

          <section className="dashboard-section" id="deal-rescue">
            {scenario.program.areaContract?.quantityCostAdjustment && <p>
              수량 교체 견적액은 고정입니다. 공사비 절감 경로는 기본 연면적 단가에 남은 공종만 변경하며 교체 견적의 재협상은 포함하지 않습니다.
            </p>}
            <DealRescuePanel
              rescue={visibleRescue}
              baseline={result}
              targetIRR={assumptions.equityIRR}
              running={rescueRunning}
              onRun={runDealRescue}
            />
            {rescueError?.key === rescueKey && (
              <p role="alert" style={{ color: "var(--neg-fg)", overflowWrap: "anywhere" }}>
                구조 개선 분석 실패: {rescueError.message}
              </p>
            )}
          </section>

          <section className="dashboard-section" id="deal-stress-lab">
            <DealStressLabPanel
              stress={visibleStress}
              baseline={result}
              targetIRR={assumptions.equityIRR}
              running={stressRunning}
              onRun={runDealStress}
            />
            {stressError?.key === rescueKey && (
              <p role="alert" style={{ color: "var(--neg-fg)", overflowWrap: "anywhere" }}>
                스트레스 분석 실패: {stressError.message}
              </p>
            )}
          </section>

          <section className="dashboard-section split-section">
            <BreakdownPanel
              title="사업비 구성"
              total={result.totalCost}
              items={[
                ["부동산 취득대금", result.landCost],
                ["취득세 반영액", result.acquisitionTax],
                ["기타 취득 부대비", result.acquisitionOtherCost],
                ["철거비", result.demolitionCost],
                ["명도·임차인 정리비", result.tenantRelocationCost],
                ["직접 공사비", result.hardCost],
                ["설계·인허가·간접비", result.softCost],
                ["예비비", result.contingency],
                ["PF 이자", result.interestCost],
                ["PF 약정·취급 수수료", result.pfFee],
                ["신탁·자금관리비", result.trustFee],
              ]}
            />
            <BreakdownPanel
              title="용도·운영방식별 매출·가치"
              total={result.totalRevenue}
              items={[
                ["주거 매각", result.revenueByPool.residentialSale],
                ["상가 매각", result.revenueByPool.retailSale],
                ["업무 매각", result.revenueByPool.officeSale],
                ["주거 임대 출구가치", result.revenueByPool.residentialLease],
                ["상가 임대 출구가치", result.revenueByPool.retailLease],
                ["업무 임대 출구가치", result.revenueByPool.officeLease],
              ]}
            />
          </section>

          <section className="dashboard-section" id="sensitivity">
            <SectionHeader
              eyebrow="TWO-WAY SENSITIVITY"
              title={`${sensitivity.revenueLabel}${sensitivity.costStressUnavailableReason ? " 민감도 · 전체 견적 고정" : " × 기본 공사단가 민감도"}`}
              description={sensitivity.costStressUnavailableReason ?? "각 셀은 현재 토지 검토가와 금융조건을 고정하고 두 핵심 변수만 바꾼 예상 손익입니다."}
            />
            {scenario.program.areaContract?.quantityCostAdjustment && <p>
              수량 교체 견적액과 기존 포함 비율은 유지합니다. 세로축은 남은 기본 공종의 단가 변화이며 전체 공사비의 같은 비율 증감을 뜻하지 않습니다.
            </p>}
            <SensitivityMatrix sensitivity={sensitivity} />
            <div className="break-even-strip">
              <div>
                <span>현재 {breakEven.label}</span>
                <strong>{formatRevenuePrice(breakEven.current, breakEven.kind)}</strong>
              </div>
              <div>
                <span>손익분기 {breakEven.label}</span>
                <strong>{breakEven.value == null ? "계산 범위 밖" : formatRevenuePrice(breakEven.value, breakEven.kind)}</strong>
              </div>
              <div>
                <span>가격 안전마진</span>
                <strong>{breakEven.marginPct == null ? "—" : `${breakEven.marginPct >= 0 ? "+" : ""}${breakEven.marginPct.toFixed(1)}%`}</strong>
              </div>
            </div>
          </section>

          <section className="dashboard-section" id="cashflow">
            <SectionHeader eyebrow="UNIFIED CASH FLOW" title="분기 자금흐름" description="IRR·NPV·PF 이자와 동일한 월별 원장을 분기로 합산합니다. 설계·공사·회수 기간 입력과 공사비 100%가 반영됩니다." />
            <CashflowTable rows={cashflow} />
          </section>

          <section className="dashboard-section" id="price-evidence">
            <SectionHeader eyebrow="EXIT PRICE EVIDENCE" title="매각·분양 가격 근거" description="가격 추정치와 사용자가 수정한 계산 가정을 구분합니다. 사례가 부족하면 숫자를 확정값으로 표시하지 않습니다." />
            <div className="evidence-summary">
              <EvidenceMetric label="현재 적용 단가" value={`${Math.round((currentSaleUnitPrice * SQM_PER_PYEONG) / 10_000).toLocaleString()}만원/평`} />
              <EvidenceMetric label="채택 사례 중앙값" value={data.saleEstimate ? `${data.saleEstimate.medianPPP.toLocaleString()}만원/평` : "근거 부족"} />
              <EvidenceMetric label="전체 거래 중앙값" value={data.saleEstimate ? `${data.saleEstimate.conservativePPP.toLocaleString()}만원/평` : "근거 부족"} />
              <EvidenceMetric label="표본 근거 수준" value={confidenceLabel(saleConfidence)} />
            </div>
            <div className="case-list">
              {(data.saleEstimate?.cases ?? []).slice(0, 5).map((item) => (
                <div className="case-row" key={`${item.address}-${item.date}-${item.pricePerPyeong}`}>
                  <span><b>{item.address}</b><small>{item.date} · {item.buildYear ? `${item.buildYear}년 준공` : "준공연도 미확인"}</small></span>
                  <strong>{item.pricePerPyeong.toLocaleString()}만원/평</strong>
                  <em>{item.sameDong ? "같은 동" : "같은 구"}</em>
                </div>
              ))}
              {!data.saleEstimate && <div className="empty-evidence">채택 가능한 단독·다가구 유사 사례가 3건 미만입니다. 현재 가격은 시장 확정값이 아니라 기본 가정입니다.</div>}
            </div>
            <button className="secondary-button" onClick={() => router.push(`/projects/${projectId}/comps`)}>전체 실거래 비교</button>
          </section>

          {data.scenarios.length > 1 && (
            <section className="dashboard-section" id="plan-comparison">
              <SectionHeader eyebrow="SAVED PLAN COMPARISON" title="저장 계획안 다목적 비교" description="Stage 2 저장안의 손익·수익률·필요자본·자금노출·기간·법규를 각각 비교합니다. 하나의 숨은 종합점수로 순위를 만들지 않습니다." />
              <ScenarioTable
                scenarios={data.scenarios}
                representativeId={financeScenario.id}
                decisionSupport={data.decisionSupport}
                afterTaxDecisionSupport={afterTaxDecisionSupport ?? undefined}
                onOpen={(id) => router.push(`/projects/${projectId}/scenarios/${id}`)}
              />
            </section>
          )}
        </main>

        <aside className="stage3-sidebar">
          <section className="assumption-panel" id="inputs">
            <div className="assumption-heading">
              <div><span className="section-kicker">LIVE INPUTS</span><h2>계산 조정</h2></div>
              {editedCount > 0 && <button className="text-button" onClick={resetAll}>{editedCount}건 초기화</button>}
            </div>
            <AcquisitionPriceEditor
              totalManwon={acquisitionPrice}
              lotAreaSqm={data.parcel.lotArea}
              referenceManwon={marketEstimate}
              edited={acquisitionEdited}
              source={projectFinancialSources.acquisitionPrice ? `${projectFinancialSources.acquisitionPrice.sourceName} · ${projectFinancialSources.acquisitionPrice.asOf} · 소스 값 적용` : "부지 등록 입력값 · 시장 추정가와 분리"}
              onChange={(value) => setDraftAcquisitionPrice(projectId, value)}
            />
            {revenueAreas && scenario.revenuePricing && (
              <RevenuePricingEditor
                areas={revenueAreas}
                pricing={scenario.revenuePricing}
                draft={revenuePricingDraft}
                onChange={(pool, patch) =>
                  setRevenuePoolPricingDraft(
                    projectId,
                    financeScenario.id,
                    pool,
                    patch,
                  )
                }
              />
            )}
            {activeAssumptionGroups.map((group) => (
              <details key={group.title} open className="assumption-group">
                <summary>{group.title}</summary>
                {group.fields.map((field) => (
                  <NumericEditor
                    key={field.field}
                    {...field}
                    value={assumptionValueWithLegacyDefault(
                      assumptions,
                      field.field,
                    )}
                    edited={projectFinancialSources[field.field] != null || draft?.[field.field] != null}
                    source={projectFinancialSources[field.field] ? `${projectFinancialSources[field.field]!.sourceName} · ${projectFinancialSources[field.field]!.asOf} · 소스 값 적용` : ASSUMPTION_META[field.field]?.basis ?? "사용자 확인 필요"}
                    onChange={(value) => setDraftAssumption(financeScenario.id, field.field, value)}
                  />
                ))}
              </details>
            ))}
          </section>

          <section className="evidence-panel" id="source-data-room">
            <SourceDataPanel
              key={`${scenario.id}:${sourceGate.requiredFields.join(",")}`}
              projectId={projectId}
              records={projectFinancialSources}
              gate={sourceGate}
              currentValues={currentSourceValues}
              onSave={(record) => setFinancialSource(projectId, record)}
              onRemove={(field) => removeFinancialSource(projectId, field)}
            />
          </section>

          <section className="evidence-panel">
            <span className="section-kicker">MODEL COVERAGE</span>
            <h2>계산 반영 범위</h2>
            <EvidenceRow label="대표 계획 매스" value={geometry.geometryHash} state="확정" />
            <SourceCoverageRow
              label="취득대금·부대비"
              fields={[
                "acquisitionPrice",
                "acquisitionTaxManwon",
                "acquisitionOtherCostManwon",
                "tenantRelocationCostManwon",
              ]}
              records={projectFinancialSources}
              fallback={`${acquisitionEdited ? "사용자 수정 입력" : "부지 등록 입력"} · ${won(acquisitionPrice)} 총액 · 세금·명도·계약 부대비 원문 필요`}
            />
            <EvidenceRow label="토지 참고 추정" value={`${data.parcel.acquisitionEstimate?.modelVersion ?? "legacy-unversioned"} · 자체 보정·외부 검증 전`} state="미확정" />
            {hasSaleRevenue && (
              <SourceCoverageRow
                label="매각 단가"
                fields={saleSourceFields}
                records={projectFinancialSources}
                fallback={data.saleEstimate ? `${data.saleEstimate.modelVersion} · ${data.saleEstimate.basis} · 외부 검증 전` : "내부 초기 가정 · 실거래 또는 감정평가 근거 필요"}
              />
            )}
            {hasLeaseRevenue && (
              <>
                <SourceCoverageRow
                  label="임대 수입"
                  fields={leaseSourceFields}
                  records={projectFinancialSources}
                  fallback="임대료·공실률·운영비율·Exit cap rate 원문 필요"
                />
                <SourceCoverageRow
                  label="장기대출"
                  fields={TAKEOUT_SOURCE_FIELDS}
                  records={projectFinancialSources}
                  fallback="금융기관 장기대출 Term Sheet·확약서 필요"
                />
                {holdEnabled && (
                  <SourceCoverageRow
                    label="보유 운영·Exit"
                    fields={[
                      ...HOLD_PERIOD_SOURCE_FIELDS,
                      ...TENANT_ROLLOVER_SOURCE_FIELDS,
                    ].filter((field) =>
                      sourceGate.requiredFields.includes(field),
                    )}
                    records={projectFinancialSources}
                    fallback="운용계획·임대차 만기·갱신·교체비·수선예산·Exit 가치 근거 필요"
                  />
                )}
              </>
            )}
            <SourceCoverageRow
              label="공사비"
              fields={hasBasementCost
                ? ["constCostPerSqM", "basementCostMultiplier", "softCostRate", "contingencyRate"]
                : ["constCostPerSqM", "softCostRate", "contingencyRate"]}
              records={projectFinancialSources}
              fallback="시공사·건축사 견적 또는 승인 예산 기준 필요"
            />
            <SourceCoverageRow
              label="PF 조건"
              fields={[
                "ltcTarget",
                "interestRate",
                "pfUpfrontFeeRate",
                "trustFeeManwon",
              ]}
              records={projectFinancialSources}
              fallback="금융기관 Term Sheet 필요"
            />
            <SourceCoverageRow
              label="투자 기준·확약"
              fields={["equityIRR", "equityCommitmentManwon"]}
              records={projectFinancialSources}
              fallback="대표자 승인 요구수익률 기준 필요"
            />
            <SourceCoverageRow
              label="사업 일정"
              fields={[
                "designMonths",
                "constructionMonths",
                ...(hasSaleRevenue
                  ? (["saleOutMonths"] as FinancialSourceField[])
                  : []),
              ]}
              records={projectFinancialSources}
              fallback={hasSaleRevenue
                ? "설계·공정·매각 일정 근거 필요"
                : "설계·공정 일정 근거 필요"}
            />
            <EvidenceRow
              label="세금"
              value={
                activeAfterTax.decisionGrade
                  ? `${TAX_MODEL_AS_OF} · 세무 전문가 원문·일정 확인`
                  : `${TAX_MODEL_AS_OF} 법정 참고 · 세무 계약 미완료`
              }
              state={activeAfterTax.decisionGrade ? "확정" : "미확정"}
            />
            <p className="coverage-note">등록된 원문이 실제 계산에 반영된 상태를 표시합니다. 0원으로 남은 취득세·부대비·명도비·PF 수수료·신탁비는 면제가 아니라 총사업비 미반영 상태이며, 자기자본 한도와 장기대출 확약액이 없으면 조달·재융자 가능성을 확정하지 않습니다. 장기 보유안은 보유기간을 입력한 경우에만 운용·Exit 근거를 필수로 요구합니다.</p>
          </section>

          <section className="next-actions">
            <button className="secondary-button" onClick={() => router.push(`/projects/${projectId}/comps`)}>가격 근거</button>
            <button className="secondary-button" onClick={commitCurrentSnapshot}>현재안 저장</button>
            <button
              className="primary-button"
              disabled={
                sourceGate.status !== "source-backed" ||
                result.funding.status !== "funded"
              }
              title={
                sourceGate.status !== "source-backed"
                  ? "필수 소스 데이터를 모두 등록해야 합니다."
                  : result.funding.status === "shortfall"
                    ? "확인 자기자본 한도가 필요 금액보다 부족합니다."
                    : result.funding.status === "unverified"
                      ? "자기자본 확약 한도를 등록해야 합니다."
                      : "현재안을 저장하고 전문가 검증·인계로 이동합니다."
              }
              onClick={openHandoff}
            >
              저장 후 전문가 인계
            </button>
            {savedAt && <span className="save-status" role="status">{savedAt} 보고서 스냅샷 저장</span>}
          </section>
        </aside>
      </div>
      </fieldset>

      <style jsx>{`
        .stage3-page{max-width:1540px;margin:0 auto;padding:26px 28px 54px;color:var(--fg)}
        .stage3-permission-scope{min-width:0;margin:0;padding:0;border:0}.stage3-readonly{margin-bottom:12px;padding:9px 11px;border-left:3px solid var(--warn);background:var(--warn-soft);color:var(--warn-fg);font-size:10px;font-weight:700}
        .audit-banner{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;margin-bottom:12px;padding:12px 14px;border:1px solid #d8a92e;border-radius:10px;background:#fff8dc;color:#5f4600}.audit-copy{display:grid;gap:4px}.audit-banner strong{font-size:11.5px}.audit-banner span{font-size:10.5px;line-height:1.5}.audit-link{display:inline-flex;align-items:center;min-height:30px;padding:0 10px;border:1px solid currentColor;border-radius:7px;color:inherit;text-decoration:none;font-size:9.5px;font-weight:800;white-space:nowrap}\n        .stage3-header{display:flex;justify-content:space-between;gap:28px;align-items:flex-start;margin-bottom:18px}.eyebrow,.section-kicker{font-size:9px;letter-spacing:.18em;font-weight:800;color:var(--fg-muted)}
        h1{font-size:28px;letter-spacing:0;margin:7px 0 7px}.stage3-header p{max-width:780px;margin:0;color:var(--fg-muted);font-size:12px;line-height:1.6}.header-actions{display:flex;gap:8px;align-items:center}
        button{font:inherit;cursor:pointer}.secondary-button,.primary-button{min-height:36px;border-radius:8px;padding:0 12px;border:1px solid var(--border);background:var(--bg-elev);color:var(--fg);font-size:11px;font-weight:700}.primary-button{background:var(--fg);color:var(--bg);border-color:var(--fg)}.text-button{border:0;background:transparent;color:var(--accent);font-size:10.5px;padding:0;font-weight:700}
        .source-lock{display:grid;grid-template-columns:minmax(260px,1.5fr) repeat(3,minmax(120px,.65fr));border:1px solid var(--border);border-radius:11px;background:var(--bg-elev);margin-bottom:12px}.source-main,.source-lock>:global(.fact){padding:13px 15px}.source-main{display:grid;gap:4px;border-right:1px solid var(--border-faint)}.source-main strong{font-size:14px}.source-main>span:last-child{font-size:10.5px;color:var(--fg-muted)}
        .decision-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}.funding-banner,.takeout-banner{display:grid;grid-template-columns:minmax(210px,.42fr) minmax(0,1fr);gap:18px;align-items:center;margin-bottom:12px;padding:12px 14px;border:1px solid #d8a92e;border-radius:10px;background:#fff8dc;color:#5f4600}.funding-banner[data-status="funded"],.takeout-banner[data-status="commitment-feasible"]{border-color:var(--pos-fg);background:var(--pos-soft);color:var(--pos-fg)}.funding-banner[data-status="shortfall"],.takeout-banner[data-status="commitment-shortfall"],.takeout-banner[data-status="terms-invalid"]{border-color:var(--neg-fg);background:var(--neg-soft);color:var(--neg-fg)}.funding-banner>div,.takeout-banner>div{display:grid;gap:4px}.funding-banner strong,.takeout-banner strong{font-size:12px}.funding-banner p,.takeout-banner p{margin:0;font-size:10.5px;line-height:1.55}
        .hold-section{display:grid;gap:11px;margin-bottom:12px;padding:14px 15px;border:1px solid var(--border);border-left:4px solid var(--fg-subtle);border-radius:10px;background:var(--bg-elev)}.hold-section[data-tone="positive"]{border-left-color:var(--pos-fg)}.hold-section[data-tone="negative"]{border-left-color:var(--neg-fg)}.hold-section[data-tone="review"]{border-left-color:#b8860b}.hold-heading{display:grid;grid-template-columns:minmax(220px,.42fr) minmax(0,1fr);gap:18px;align-items:center}.hold-heading>div{display:grid;gap:5px}.hold-heading strong{font-size:12px}.hold-heading p,.hold-costs,.hold-boundary{margin:0;font-size:10px;line-height:1.55;color:var(--fg-muted)}.hold-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border:1px solid var(--border-faint);border-radius:8px;overflow:hidden}.hold-metrics>:global(.hold-metric){min-width:0;padding:10px 11px;background:var(--bg-soft)}.hold-metrics>:global(.hold-metric)+:global(.hold-metric){border-left:1px solid var(--border-faint)}.hold-metrics>:global(.hold-metric span){display:block;font-size:8.5px;color:var(--fg-muted)}.hold-metrics>:global(.hold-metric strong){display:block;margin-top:4px;font-size:12px;font-family:var(--font-mono);overflow-wrap:anywhere}.hold-boundary{padding-top:9px;border-top:1px solid var(--border-faint)}
        .dashboard-section,.assumption-panel,.evidence-panel{border:1px solid var(--border);border-radius:11px;background:var(--bg-elev);padding:17px}.dashboard-section{margin-bottom:12px}.land-section{padding:18px 19px}
        .price-ladder{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-top:15px}.method-strip{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:11px;padding-top:10px;border-top:1px solid var(--border-faint);font-size:10px;color:var(--fg-muted)}.method-strip b{color:var(--fg)}.method-strip button{margin-left:auto}
        .workspace-grid{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:12px;align-items:start}.stage3-main{min-width:0}.stage3-sidebar{display:grid;gap:12px;position:sticky;top:16px}.assumption-heading{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--border-faint);padding-bottom:10px}.assumption-heading h2,.evidence-panel h2{font-size:16px;margin:5px 0 0}
        .metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px}.return-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-top:9px;border:1px solid var(--border-faint);border-radius:9px;overflow:hidden}.return-strip>:global(div)+:global(div){border-left:1px solid var(--border-faint)}
        .split-section{display:grid;grid-template-columns:1fr 1fr;gap:28px}.break-even-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.break-even-strip>div{padding:11px 12px;border-radius:8px;background:var(--bg-soft);display:grid;gap:4px}.break-even-strip span{font-size:9.5px;color:var(--fg-muted)}.break-even-strip strong{font-size:13px;font-family:var(--font-mono)}
        .evidence-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}.case-list{display:grid;margin:12px 0}.case-row{display:grid;grid-template-columns:1fr 130px 65px;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--border-faint);font-size:10.5px}.case-row span{display:grid;gap:2px}.case-row small{color:var(--fg-muted)}.case-row strong{text-align:right;font-family:var(--font-mono)}.case-row em{font-style:normal;text-align:center;border-radius:999px;background:var(--bg-soft);padding:4px 6px;color:var(--fg-muted)}.empty-evidence{padding:13px;background:var(--warn-soft);color:var(--warn-fg);border-radius:8px;font-size:10.5px;line-height:1.55}
        .assumption-group{border-bottom:1px solid var(--border-faint)}.assumption-group summary{padding:11px 0 7px;font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--fg-muted);cursor:pointer}.coverage-note{padding:10px;margin:11px 0 0;border-radius:8px;background:var(--bg-soft);font-size:9.5px;color:var(--fg-muted);line-height:1.55}.next-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.next-actions .primary-button,.save-status{grid-column:1/-1}.save-status{text-align:center;color:var(--pos-fg);font-size:9.5px}
        :global(.revenue-pricing-group){border-bottom:1px solid var(--border-faint)}:global(.revenue-pricing-group>summary){padding:11px 0 7px;font-size:10px;font-weight:800;color:var(--fg-muted);cursor:pointer}:global(.revenue-pricing-list){display:grid;gap:6px;padding:2px 0 10px}:global(.revenue-price-row){border:1px solid var(--border-faint);border-radius:6px;background:var(--bg)}:global(.revenue-price-row>summary){display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;cursor:pointer;list-style:none}:global(.revenue-price-row>summary::-webkit-details-marker){display:none}:global(.revenue-price-row>summary>span),:global(.revenue-price-row>summary>strong){display:grid;gap:2px}:global(.revenue-price-row>summary b){font-size:10px}:global(.revenue-price-row>summary small){color:var(--fg-subtle);font-size:8px;font-weight:500}:global(.revenue-price-row>summary>strong){text-align:right;font-family:var(--font-mono);font-size:10.5px}:global(.revenue-base-input){display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 8px;padding:8px 0;border-top:1px solid var(--border-faint);color:var(--fg-muted);font-size:9px}:global(.revenue-base-input>span:last-child){display:flex;align-items:center;gap:4px}:global(.revenue-base-input input){width:84px;height:26px;padding:0 5px;border:1px solid var(--border);border-radius:5px;background:var(--bg-elev);color:var(--fg);text-align:right;font:inherit;font-weight:700}:global(.revenue-base-input input:disabled){cursor:not-allowed;opacity:.58}:global(.revenue-base-input small),:global(.revenue-adjustment-grid small){color:var(--fg-faint);font-size:8px}:global(.revenue-adjustment-grid){display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;padding:0 8px 8px}:global(.revenue-adjustment-grid label){display:grid;gap:3px;min-width:0;color:var(--fg-subtle);font-size:8px}:global(.revenue-adjustment-grid label>span:last-child){display:flex;align-items:center;gap:2px}:global(.revenue-adjustment-grid input){width:100%;min-width:0;height:24px;padding:0 3px;border:1px solid var(--border);border-radius:4px;background:var(--bg-elev);color:var(--fg);text-align:right;font:inherit;font-size:8.5px}:global(.revenue-price-source){display:block;overflow:hidden;margin:0 8px;padding:0 0 8px;color:var(--fg-faint);font-size:8px;text-overflow:ellipsis;white-space:nowrap}
        @media(max-width:1180px){.workspace-grid{grid-template-columns:1fr}.stage3-sidebar{position:static;grid-template-columns:1fr 1fr}.next-actions{grid-column:1/-1}.decision-grid{grid-template-columns:repeat(2,1fr)}.hold-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.hold-metrics>:global(.hold-metric:nth-child(4)){border-left:0}.hold-metrics>:global(.hold-metric:nth-child(n+4)){border-top:1px solid var(--border-faint)}}
        @media(max-width:760px){.stage3-page{padding:18px 14px}.stage3-header{display:block}.header-actions{margin-top:14px}.source-lock,.price-ladder,.metric-grid,.split-section,.evidence-summary,.stage3-sidebar,.funding-banner,.takeout-banner,.hold-heading{grid-template-columns:1fr}.source-main{border-right:0}.decision-grid{grid-template-columns:1fr}.return-strip,.hold-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.hold-metrics>:global(.hold-metric:nth-child(odd)){border-left:0}.hold-metrics>:global(.hold-metric:nth-child(n+3)){border-top:1px solid var(--border-faint)}.case-row{grid-template-columns:1fr}.case-row strong,.case-row em{text-align:left}.method-strip button{margin-left:0}}
      `}</style>
    </div>
  );
}

function cloneExpertTaxContract(
  contract: ExpertTaxInputContract
): ExpertTaxInputContract {
  return {
    ...contract,
    document: contract.document ? { ...contract.document } : undefined,
    assessments: contract.assessments.map((assessment) => ({
      ...assessment,
      payments: assessment.payments.map((payment) => ({ ...payment })),
    })),
  };
}

function taxStrategyLabel(strategy: AfterTaxStrategy): string {
  return strategy === "stabilized-sale" ? "안정화 매각" : "장기 보유";
}

function taxAssessmentStatusLabel(status: TaxAssessmentStatus): string {
  if (status === "confirmed") return "금액 확정";
  if (status === "not-applicable") return "해당 없음";
  return "미검토";
}

function afterTaxStatusLabel(status: AfterTaxLedgerResult["status"]): string {
  if (status === "expert-confirmed") return "전문가 확인 세후 원장";
  if (status === "draft") return "완결된 세무 초안";
  if (status === "incomplete") return "세무 검토 미완료";
  if (status === "stale") return "세전 기준 변경 · 재확인 필요";
  if (status === "invalid") return "세무 계약 오류";
  return "세무 계약 미등록";
}

function assessmentNetAmount(
  payments: ExpertTaxPayment[]
): number {
  return payments.reduce(
    (sum, payment) =>
      sum +
      (payment.direction === "payment"
        ? payment.amountManwon
        : -payment.amountManwon),
    0
  );
}

function ExpertTaxWorkspace({
  projectId,
  scenarioId,
  strategy,
  allowHoldStrategy,
  contract,
  result,
  statutoryTaxes,
  preTaxEquityCashFlowsManwon,
  preTaxAcquisitionTaxManwon,
  equityHurdleRatePct,
  onStrategyChange,
  onSave,
  onRemove,
}: {
  projectId: string;
  scenarioId: string;
  strategy: AfterTaxStrategy;
  allowHoldStrategy: boolean;
  contract?: ExpertTaxInputContract;
  result: AfterTaxLedgerResult;
  statutoryTaxes: TaxBreakdown;
  preTaxEquityCashFlowsManwon: number[];
  preTaxAcquisitionTaxManwon: number;
  equityHurdleRatePct: number;
  onStrategyChange: (strategy: AfterTaxStrategy) => void;
  onSave: (contract: ExpertTaxInputContract) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<ExpertTaxInputContract>(() =>
    cloneExpertTaxContract(
      contract ??
        createDraftExpertTaxContract({
          projectId,
          scenarioId,
          strategy,
          preTaxEquityCashFlowsManwon,
          preTaxAcquisitionTaxManwon,
          equityHurdleRatePct,
        })
    )
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accessSession = useAccessSession();
  const canUploadEvidence = principalHasCapability(
    accessSession.data,
    "evidence.upload",
  );
  const taxReviewerRole = accessSession.data?.reviewerRoles.find(
    (role): role is "accountant" | "tax-advisor" =>
      role === "accountant" || role === "tax-advisor",
  );
  const canConfirmTax = Boolean(
    taxReviewerRole &&
      principalHasCapability(accessSession.data, "review.perform"),
  );
  const taxEventRows = result.rows.filter(
    (row) => row.taxPayment > 0 || row.taxRefund > 0
  );

  const updateAssessment = (
    category: TaxAssessmentCategory,
    updater: (
      assessment: ExpertTaxInputContract["assessments"][number]
    ) => ExpertTaxInputContract["assessments"][number]
  ) => {
    setDraft((current) => ({
      ...current,
      reviewStatus: "draft",
      assessments: current.assessments.map((assessment) =>
        assessment.category === category ? updater(assessment) : assessment
      ),
    }));
  };

  const uploadTaxDocument = async () => {
    if (!selectedFile) {
      setError("업로드할 세무 검토 PDF·Excel·CSV를 선택하세요.");
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("field", `tax-${strategy}`);
      form.set("file", selectedFile);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/source-documents`,
        {
          method: "POST",
          body: form,
        }
      );
      const payload = (await response.json().catch(() => null)) as
        | { document?: SourceDocumentMetadata; error?: string }
        | null;
      if (!response.ok || !payload?.document) {
        throw new Error(payload?.error ?? "세무 검토 원문 업로드에 실패했습니다.");
      }
      setDraft((current) => ({
        ...current,
        reviewStatus: "draft",
        document: payload.document,
        documentRef:
          current.documentRef.trim() || payload.document!.fileName,
      }));
      setSelectedFile(null);
      setNotice(`원문 SHA-256 ${payload.document.sha256.slice(0, 12)}… 연결`);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "세무 검토 원문 업로드에 실패했습니다."
      );
    } finally {
      setUploading(false);
    }
  };

  const saveContract = () => {
    if (
      draft.reviewStatus === "expert-confirmed" &&
      (!canConfirmTax || !taxReviewerRole || !accessSession.data)
    ) {
      setError("로그인 계정에 회계사 또는 세무사 검토 역할이 필요합니다.");
      return;
    }
    const expertConfirmed = draft.reviewStatus === "expert-confirmed";
    const confirmedAt = new Date().toISOString();
    onSave({
      ...draft,
      schemaVersion: EXPERT_TAX_CONTRACT_SCHEMA_VERSION,
      projectId,
      scenarioId,
      strategy,
      calculationBasis: buildAfterTaxCalculationBasis({
        preTaxEquityCashFlowsManwon,
        preTaxAcquisitionTaxManwon,
        equityHurdleRatePct,
      }),
      preparedBy: expertConfirmed
        ? accessSession.data!.name
        : draft.preparedBy.trim(),
      preparerRole: expertConfirmed
        ? taxReviewerRole === "tax-advisor"
          ? "세무사"
          : "회계사"
        : draft.preparerRole.trim(),
      expertAttestation: expertConfirmed
        ? {
            userId: accessSession.data!.userId,
            email: accessSession.data!.email,
            name: accessSession.data!.name,
            organization: accessSession.data!.organization,
            reviewerRole: taxReviewerRole!,
            confirmedAt,
          }
        : undefined,
      documentRef: draft.documentRef.trim(),
      assessments: draft.assessments.map((assessment) => ({
        ...assessment,
        note: assessment.note.trim(),
      })),
      updatedAt: new Date().toISOString(),
    });
    setNotice("세무 입력 계약을 저장했습니다.");
    setError(null);
  };

  return (
    <section className="tax-workspace" id="after-tax-ledger">
      <div className="tax-workspace-heading">
        <div>
          <span className="section-kicker">EXPERT AFTER-TAX LEDGER</span>
          <h2>세전 원장과 분리된 세후 현금흐름</h2>
        </div>
        <div className="tax-tabs" role="tablist" aria-label="세후 계산 처분전략">
          <button
            type="button"
            role="tab"
            aria-selected={strategy === "stabilized-sale"}
            onClick={() => onStrategyChange("stabilized-sale")}
          >
            안정화 매각
          </button>
          {allowHoldStrategy && (
            <button
              type="button"
              role="tab"
              aria-selected={strategy === "long-term-hold"}
              onClick={() => onStrategyChange("long-term-hold")}
            >
              장기 보유
            </button>
          )}
        </div>
      </div>

      <div className="tax-status" data-status={result.status} role="status">
        <strong>{afterTaxStatusLabel(result.status)}</strong>
        <span>
          {taxStrategyLabel(strategy)} · 세전 포함 취득세 {won(result.includedInPretaxTaxManwon)}
          {result.decisionGrade
            ? " · 원문·작성자·전 세목 확인"
            : " · 투자 확정 판단에는 사용 불가"}
        </span>
      </div>

      <div className="tax-metrics">
        <TaxMetric
          label="세후 손익"
          value={
            result.afterTaxProfitManwon == null
              ? "N/A"
              : won(result.afterTaxProfitManwon)
          }
        />
        <TaxMetric
          label="세후 IRR"
          value={
            result.irrStatus === "calculated" && result.irrPct != null
              ? `${result.irrPct.toFixed(1)}%`
              : "N/A"
          }
        />
        <TaxMetric
          label="세후 NPV"
          value={result.npvManwon == null ? "N/A" : won(result.npvManwon)}
        />
        <TaxMetric
          label="순 증분 세금"
          value={
            result.netIncrementalTaxManwon == null
              ? "N/A"
              : won(result.netIncrementalTaxManwon)
          }
        />
        <TaxMetric
          label="Equity Multiple"
          value={
            result.equityMultiple == null
              ? "N/A"
              : `${result.equityMultiple.toFixed(2)}x`
          }
        />
      </div>

      {result.errors.length > 0 && (
        <div className="tax-errors" role="alert">
          {result.errors.join(" ")}
        </div>
      )}

      <details className="tax-reference">
        <summary>법정 참고 경계 · {statutoryTaxes.asOf}</summary>
        <div>
          {statutoryTaxes.lines.map((line) => (
            <p key={`${line.tax}-${line.base}`}>
              <strong>{line.tax}</strong>
              <span>{line.rate} · {line.note}</span>
            </p>
          ))}
        </div>
      </details>

      <div className="tax-contract-meta">
        <label>
          <span>납세의무자</span>
          <select
            value={draft.taxpayerType}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                reviewStatus: "draft",
                taxpayerType: event.target.value as TaxpayerType,
              }))
            }
          >
            <option value="undetermined">미확정</option>
            <option value="corporation">법인</option>
            <option value="individual">개인</option>
            <option value="other">기타</option>
          </select>
        </label>
        <label>
          <span>작성자</span>
          <input
            value={draft.preparedBy}
            readOnly={draft.reviewStatus === "expert-confirmed"}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                reviewStatus: "draft",
                preparedBy: event.target.value,
              }))
            }
            placeholder="성명"
          />
        </label>
        <label>
          <span>자격·역할</span>
          <input
            value={draft.preparerRole}
            readOnly={draft.reviewStatus === "expert-confirmed"}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                reviewStatus: "draft",
                preparerRole: event.target.value,
              }))
            }
            placeholder="세무사·회계사"
          />
        </label>
        <label>
          <span>기준일</span>
          <input
            type="date"
            value={draft.asOf}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                reviewStatus: "draft",
                asOf: event.target.value,
              }))
            }
          />
        </label>
        <label>
          <span>문서 번호</span>
          <input
            value={draft.documentRef}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                reviewStatus: "draft",
                documentRef: event.target.value,
              }))
            }
            placeholder="검토 메모 번호"
          />
        </label>
        <label>
          <span>계약 상태</span>
          <select
            value={draft.reviewStatus}
            onChange={(event) => {
              const reviewStatus = event.target.value as
                ExpertTaxInputContract["reviewStatus"];
              setDraft((current) => ({
                ...current,
                reviewStatus,
                preparedBy:
                  reviewStatus === "expert-confirmed" && accessSession.data
                    ? accessSession.data.name
                    : current.preparedBy,
                preparerRole:
                  reviewStatus === "expert-confirmed" && taxReviewerRole
                    ? taxReviewerRole === "tax-advisor"
                      ? "세무사"
                      : "회계사"
                    : current.preparerRole,
                expertAttestation:
                  reviewStatus === "draft"
                    ? undefined
                    : current.expertAttestation,
              }));
            }}
          >
            <option value="draft">초안</option>
            <option value="expert-confirmed" disabled={!canConfirmTax}>
              전문가 확인
            </option>
          </select>
          {!canConfirmTax && (
            <small>회계사·세무사 권한 계정만 전문가 확인 가능</small>
          )}
        </label>
      </div>

      <div className="tax-document-row">
        <label>
          <span>세무 검토 원문</span>
          <input
            type="file"
            accept={SOURCE_DOCUMENT_ACCEPT}
            onChange={(event) =>
              setSelectedFile(event.target.files?.[0] ?? null)
            }
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={uploading || !selectedFile || !canUploadEvidence}
          onClick={() => void uploadTaxDocument()}
        >
          {uploading
            ? "업로드 중"
            : canUploadEvidence
              ? "원문 연결"
              : "업로드 권한 없음"}
        </button>
        <small>
          {draft.document
            ? `${draft.document.fileName} · SHA ${draft.document.sha256.slice(0, 12)}…`
            : "연결된 원문 없음"}
        </small>
      </div>

      <div className="tax-assessment-list">
        {TAX_ASSESSMENT_CATEGORIES.map((category) => {
          const assessment = draft.assessments.find(
            (item) => item.category === category
          )!;
          const meta = TAX_ASSESSMENT_CATEGORY_META[category];
          const netAmount = assessmentNetAmount(assessment.payments);
          return (
            <details className="tax-assessment" key={category}>
              <summary>
                <span>
                  <strong>{meta.label}</strong>
                  <small>
                    {meta.treatment === "included-in-pretax"
                      ? "세전 포함 · 대사 전용"
                      : "세후 증분"}
                  </small>
                </span>
                <em data-status={assessment.assessmentStatus}>
                  {taxAssessmentStatusLabel(assessment.assessmentStatus)} · {won(netAmount)}
                </em>
              </summary>
              <div className="tax-assessment-body">
                <p>{meta.guidance}</p>
                <div className="tax-assessment-controls">
                  <label>
                    <span>판정</span>
                    <select
                      value={assessment.assessmentStatus}
                      onChange={(event) => {
                        const nextStatus = event.target
                          .value as TaxAssessmentStatus;
                        updateAssessment(category, (current) => ({
                          ...current,
                          assessmentStatus: nextStatus,
                          payments:
                            nextStatus === "not-applicable"
                              ? []
                              : current.payments,
                        }));
                      }}
                    >
                      <option value="pending">미검토</option>
                      <option value="confirmed">금액 확정</option>
                      <option value="not-applicable">해당 없음</option>
                    </select>
                  </label>
                  <label className="tax-note-input">
                    <span>검토 메모</span>
                    <input
                      value={assessment.note}
                      onChange={(event) =>
                        updateAssessment(category, (current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      placeholder="과세표준·적용 여부·근거"
                    />
                  </label>
                </div>
                {assessment.assessmentStatus !== "not-applicable" && (
                  <div className="tax-payment-list">
                    {assessment.payments.map((payment, paymentIndex) => (
                      <div className="tax-payment-row" key={`${category}-${paymentIndex}`}>
                        <select
                          aria-label={`${meta.label} 현금흐름 방향`}
                          value={payment.direction}
                          onChange={(event) =>
                            updateAssessment(category, (current) => ({
                              ...current,
                              assessmentStatus: "confirmed",
                              payments: current.payments.map((item, index) =>
                                index === paymentIndex
                                  ? {
                                      ...item,
                                      direction: event.target
                                        .value as ExpertTaxPayment["direction"],
                                    }
                                  : item
                              ),
                            }))
                          }
                        >
                          <option value="payment">납부</option>
                          <option value="refund">환급</option>
                        </select>
                        <label>
                          <span>월</span>
                          <input
                            type="number"
                            min={0}
                            max={1200}
                            step={1}
                            value={payment.month}
                            onChange={(event) =>
                              updateAssessment(category, (current) => ({
                                ...current,
                                assessmentStatus: "confirmed",
                                payments: current.payments.map((item, index) =>
                                  index === paymentIndex
                                    ? {
                                        ...item,
                                        month: Number(event.target.value),
                                      }
                                    : item
                                ),
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>만원</span>
                          <input
                            type="number"
                            min={0}
                            step={10}
                            value={payment.amountManwon}
                            onChange={(event) =>
                              updateAssessment(category, (current) => ({
                                ...current,
                                assessmentStatus: "confirmed",
                                payments: current.payments.map((item, index) =>
                                  index === paymentIndex
                                    ? {
                                        ...item,
                                        amountManwon: Number(event.target.value),
                                      }
                                    : item
                                ),
                              }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          title="납부·환급 일정 삭제"
                          aria-label="납부·환급 일정 삭제"
                          onClick={() =>
                            updateAssessment(category, (current) => ({
                              ...current,
                              payments: current.payments.filter(
                                (_, index) => index !== paymentIndex
                              ),
                            }))
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="tax-add-payment"
                      onClick={() =>
                        updateAssessment(category, (current) => ({
                          ...current,
                          assessmentStatus: "confirmed",
                          payments: [
                            ...current.payments,
                            {
                              month: 0,
                              amountManwon: 0,
                              direction: "payment",
                            },
                          ],
                        }))
                      }
                    >
                      납부·환급 일정 추가
                    </button>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>

      <div className="tax-contract-actions">
        {contract && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (window.confirm("이 처분전략의 세무 입력 계약을 삭제할까요?")) {
                onRemove();
              }
            }}
          >
            계약 삭제
          </button>
        )}
        <button type="button" className="primary-button" onClick={saveContract}>
          세무 계약 저장
        </button>
      </div>
      {(notice || error) && (
        <div className={error ? "tax-notice tax-notice-error" : "tax-notice"} role={error ? "alert" : "status"}>
          {error ?? notice}
        </div>
      )}

      {taxEventRows.length > 0 && (
        <div className="tax-event-table-wrap">
          <table className="tax-event-table">
            <thead>
              <tr>
                <th>월</th>
                <th>세전 자기자본 CF</th>
                <th>납부</th>
                <th>환급</th>
                <th>세후 자기자본 CF</th>
                <th>세후 누적</th>
              </tr>
            </thead>
            <tbody>
              {taxEventRows.map((row) => (
                <tr key={row.month}>
                  <td>{row.month}</td>
                  <td>{won(row.preTaxEquityCashFlow)}</td>
                  <td>{won(row.taxPayment)}</td>
                  <td>{won(row.taxRefund)}</td>
                  <td>{won(row.afterTaxEquityCashFlow)}</td>
                  <td>{won(row.cumulativeAfterTaxEquityCashFlow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .tax-workspace{display:grid;gap:12px;margin-bottom:12px;padding:18px 19px;border:1px solid var(--border);border-radius:11px;background:var(--bg-elev)}
        .tax-workspace-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.tax-workspace-heading h2{margin:5px 0 0;font-size:18px;letter-spacing:0}
        .tax-tabs{display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}.tax-tabs button{min-height:34px;padding:0 12px;border:0;background:var(--bg-soft);color:var(--fg-muted);font-size:10px;font-weight:800}.tax-tabs button+button{border-left:1px solid var(--border)}.tax-tabs button[aria-selected="true"]{background:var(--fg);color:var(--bg)}
        .tax-status{display:flex;justify-content:space-between;gap:14px;padding:11px 12px;border:1px solid var(--border);border-left:4px solid var(--warn-fg);border-radius:8px;background:var(--bg-soft);font-size:10px}.tax-status[data-status="expert-confirmed"]{border-left-color:var(--pos-fg);background:var(--pos-soft)}.tax-status[data-status="invalid"]{border-left-color:var(--neg-fg);background:var(--neg-soft)}.tax-status span{color:var(--fg-muted);text-align:right}
        .tax-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border:1px solid var(--border-faint);border-radius:8px;overflow:hidden}.tax-metrics>:global(.tax-metric){min-width:0;padding:10px 11px;background:var(--bg-soft)}.tax-metrics>:global(.tax-metric)+:global(.tax-metric){border-left:1px solid var(--border-faint)}.tax-metrics>:global(.tax-metric span){display:block;font-size:8.5px;color:var(--fg-muted)}.tax-metrics>:global(.tax-metric strong){display:block;margin-top:4px;font-family:var(--font-mono);font-size:12px;overflow-wrap:anywhere}
        .tax-errors,.tax-notice{padding:9px 10px;border-radius:7px;background:var(--warn-soft);color:var(--warn-fg);font-size:9.5px;line-height:1.55}.tax-notice{background:var(--pos-soft);color:var(--pos-fg)}.tax-notice-error{background:var(--neg-soft);color:var(--neg-fg)}
        .tax-reference{border:1px solid var(--border-faint);border-radius:8px}.tax-reference summary{padding:10px 11px;cursor:pointer;font-size:10px;font-weight:800}.tax-reference>div{padding:0 11px 9px}.tax-reference p{display:grid;grid-template-columns:180px minmax(0,1fr);gap:12px;margin:0;padding:7px 0;border-top:1px solid var(--border-faint);font-size:9.5px}.tax-reference span{color:var(--fg-muted);line-height:1.5}
        .tax-contract-meta{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.tax-contract-meta label,.tax-document-row label,.tax-assessment-controls label,.tax-payment-row label{display:grid;gap:4px;min-width:0}.tax-contract-meta span,.tax-document-row span,.tax-assessment-controls span,.tax-payment-row label span{font-size:8.5px;color:var(--fg-muted)}.tax-contract-meta input,.tax-contract-meta select,.tax-document-row input,.tax-assessment-controls input,.tax-assessment-controls select,.tax-payment-row input,.tax-payment-row select{width:100%;min-width:0;height:34px;padding:0 8px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--fg);font:inherit;font-size:10px}
        .tax-document-row{display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,.7fr) auto minmax(160px,.7fr);gap:8px;align-items:end}.tax-document-row small{align-self:center;color:var(--fg-muted);font-size:9px;overflow-wrap:anywhere}
        .tax-assessment-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tax-assessment{border:1px solid var(--border-faint);border-radius:8px;background:var(--bg-soft)}.tax-assessment summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;cursor:pointer}.tax-assessment summary>span{display:grid;gap:2px}.tax-assessment summary strong{font-size:10.5px}.tax-assessment summary small{font-size:8.5px;color:var(--fg-muted)}.tax-assessment summary em{font-style:normal;font-size:9px;color:var(--warn-fg);white-space:nowrap}.tax-assessment summary em[data-status="confirmed"]{color:var(--pos-fg)}.tax-assessment summary em[data-status="not-applicable"]{color:var(--fg-muted)}.tax-assessment-body{display:grid;gap:9px;padding:0 11px 11px}.tax-assessment-body>p{margin:0;padding-top:8px;border-top:1px solid var(--border-faint);color:var(--fg-muted);font-size:9px;line-height:1.5}.tax-assessment-controls{display:grid;grid-template-columns:130px minmax(0,1fr);gap:8px}.tax-payment-list{display:grid;gap:6px}.tax-payment-row{display:grid;grid-template-columns:90px 100px minmax(120px,1fr) 30px;gap:6px;align-items:end}.tax-payment-row>button{width:30px;height:34px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--fg-muted);font-size:17px}.tax-add-payment{justify-self:start;min-height:30px;padding:0 9px;border:1px dashed var(--border);border-radius:7px;background:transparent;color:var(--accent);font-size:9px;font-weight:800}
        .tax-contract-actions{display:flex;justify-content:flex-end;gap:8px}.tax-event-table-wrap{overflow-x:auto;border:1px solid var(--border-faint);border-radius:8px}.tax-event-table{width:100%;border-collapse:collapse;font-size:9.5px}.tax-event-table th,.tax-event-table td{padding:8px 9px;border-bottom:1px solid var(--border-faint);text-align:right;white-space:nowrap}.tax-event-table th:first-child,.tax-event-table td:first-child{text-align:left}.tax-event-table th{color:var(--fg-muted);background:var(--bg-soft);font-weight:700}.tax-event-table tbody tr:last-child td{border-bottom:0}
        @media(max-width:1100px){.tax-contract-meta{grid-template-columns:repeat(3,minmax(0,1fr))}.tax-assessment-list{grid-template-columns:1fr}.tax-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.tax-document-row{grid-template-columns:1fr 1fr}.tax-document-row small{align-self:end}}
        @media(max-width:700px){.tax-workspace{padding:15px 14px}.tax-workspace-heading,.tax-status{display:grid}.tax-status span{text-align:left}.tax-tabs{width:100%}.tax-tabs button{flex:1}.tax-metrics,.tax-contract-meta,.tax-document-row{grid-template-columns:1fr 1fr}.tax-metrics>:global(.tax-metric:nth-child(odd)){border-left:0}.tax-reference p,.tax-assessment-controls{grid-template-columns:1fr}.tax-payment-row{grid-template-columns:80px 70px minmax(100px,1fr) 30px}}
      `}</style>
    </section>
  );
}

function TaxMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="tax-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DealStressLabPanel({
  stress,
  baseline,
  targetIRR,
  running,
  onRun,
}: {
  stress: DealStressResult | null;
  baseline: DealStressResult["baseline"];
  targetIRR: number;
  running: boolean;
  onRun: () => void;
}) {
  const baselinePasses = passesDealRescueTarget(baseline, targetIRR);
  const fundingUnverified = baseline.funding.status === "unverified";
  const passCount =
    stress?.stressCases.filter((row) => row.passesTarget).length ?? 0;
  const maxCostShare = stress
    ? Math.max(...stress.costDna.map((row) => row.shareOfTotalCost), 1)
    : 1;

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 18,
          alignItems: "flex-start",
        }}
      >
        <SectionHeader
          eyebrow="DEAL STRESS LAB"
          title="손실 원인과 사업 생존선을 한 번에 검증합니다"
          description={`동일 금융 원장에서 비용 구성, 현재값 대비 통과 경계, 다섯 가지 하방 상황을 다시 계산합니다. 손익·NPV·IRR ${targetIRR.toFixed(1)}%를 동시에 만족해야 통과입니다.`}
        />
        <div
          style={{
            display: "grid",
            justifyItems: "end",
            gap: 8,
            flex: "0 0 auto",
          }}
        >
          <span
            style={{
              padding: "6px 9px",
              borderRadius: 999,
              background: baselinePasses
                ? fundingUnverified
                  ? "var(--warn-soft)"
                  : "var(--pos-soft)"
                : "var(--neg-soft)",
              color: baselinePasses
                ? fundingUnverified
                  ? "var(--warn-fg)"
                  : "var(--pos-fg)"
                : "var(--neg-fg)",
              fontSize: 9.5,
              fontWeight: 800,
            }}
          >
            {stress
              ? `하방 ${passCount}/5 통과`
              : baselinePasses
                ? fundingUnverified
                  ? "재무 목표 통과 · 자금한도 미확인"
                  : "현재안 통과 · 하방 미검증"
                : "현재안 미달 · 원인 미검증"}
          </span>
          <button
            disabled={running}
            onClick={onRun}
            style={{
              minHeight: 36,
              padding: "0 12px",
              border: "1px solid var(--fg)",
              borderRadius: 8,
              background: "var(--fg)",
              color: "var(--bg)",
              font: "inherit",
              fontSize: 11,
              fontWeight: 700,
              cursor: running ? "wait" : "pointer",
              opacity: running ? 0.65 : 1,
            }}
          >
            {running
              ? "경계값 재계산 중…"
              : stress
                ? "현재 입력으로 다시 검증"
                : "사업성 검증 실행"}
          </button>
        </div>
      </div>

      {!stress && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
            marginTop: 15,
          }}
        >
          <RescueGate
            label="손익"
            value={won(baseline.profit)}
            pass={Number.isFinite(baseline.profitUnroundedManwon) && baseline.profitUnroundedManwon! >= 0}
          />
          <RescueGate
            label="NPV"
            value={won(baseline.npv)}
            pass={Number.isFinite(baseline.npvUnroundedManwon) && baseline.npvUnroundedManwon! >= 0}
          />
          <RescueGate
            label="IRR"
            value={
              calculatedAnnualIrr(baseline) !== null
                ? `${calculatedAnnualIrr(baseline)!.toFixed(3)}%`
                : "N/A"
            }
            pass={
              meetsIrrTarget(baseline, targetIRR)
            }
          />
        </div>
      )}

      {stress && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, .9fr) minmax(0, 1.35fr)",
              gap: 12,
              marginTop: 15,
            }}
          >
            <article
              style={{
                padding: 13,
                border: "1px solid var(--border-faint)",
                borderRadius: 9,
                background: "var(--bg-soft)",
              }}
            >
              <div style={{ display: "grid", gap: 3, marginBottom: 12 }}>
                <span className="section-kicker">LOSS DNA · LEDGER</span>
                <strong style={{ fontSize: 13 }}>비용 원장 구성</strong>
                <small style={{ color: "var(--fg-muted)", lineHeight: 1.45 }}>
                  비용 항목의 정확한 구성비입니다. 항목별 인과효과를 임의
                  추정하지 않습니다.
                </small>
              </div>
              <div style={{ display: "grid", gap: 9 }}>
                {stress.costDna.map((row) => (
                  <div key={row.id} style={{ display: "grid", gap: 4 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: 9.5,
                      }}
                    >
                      <span>{row.label}</span>
                      <strong style={{ fontFamily: "var(--font-mono)" }}>
                        {won(row.amount)} · {row.shareOfTotalCost.toFixed(1)}%
                      </strong>
                    </div>
                    <div
                      style={{
                        height: 5,
                        borderRadius: 999,
                        background: "var(--border-faint)",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          width: `${Math.max(1, (Math.abs(row.shareOfTotalCost) / maxCostShare) * 100)}%`,
                          height: "100%",
                          borderRadius: 999,
                          background: "var(--fg-muted)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 6,
                  marginTop: 13,
                  paddingTop: 10,
                  borderTop: "1px solid var(--border-faint)",
                }}
              >
                <StressGap
                  label="손익 부족"
                  value={
                    formatMonetaryGap(stress.gateGap.profit)
                  }
                />
                <StressGap
                  label="NPV 부족"
                  value={formatMonetaryGap(stress.gateGap.npv)}
                />
                <StressGap
                  label="IRR 부족"
                  value={
                    stress.gateGap.irrPctPoint == null
                      ? "산정 불가"
                      : stress.gateGap.irrPctPoint > 0 && stress.gateGap.irrPctPoint < 0.001
                        ? "0.001%p 미만"
                        : `${stress.gateGap.irrPctPoint.toFixed(3)}%p`
                  }
                />
              </div>
            </article>

            <article
              style={{
                padding: 13,
                border: "1px solid var(--border-faint)",
                borderRadius: 9,
              }}
            >
              <div style={{ display: "grid", gap: 3, marginBottom: 11 }}>
                <span className="section-kicker">SURVIVAL LINES</span>
                <strong style={{ fontSize: 13 }}>
                  현재값 대비 사업 생존선
                </strong>
                <small style={{ color: "var(--fg-muted)", lineHeight: 1.45 }}>
                  각 행은 다른 조건을 고정한 단일 변수 경계입니다.
                  시장가격·견적·대출 약정이 아닙니다.
                </small>
              </div>
              <div style={{ display: "grid", gap: 7 }}>
                {stress.costStressUnavailableReason && <p role="status">{stress.costStressUnavailableReason}</p>}
                {stress.thresholds.map((row) => (
                  <StressThresholdRow
                    key={row.id}
                    row={row}
                    baselinePasses={stress.baselinePasses}
                  />
                ))}
              </div>
            </article>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ display: "grid", gap: 3, marginBottom: 9 }}>
              <span className="section-kicker">DOWNSIDE CASES</span>
              <strong style={{ fontSize: 13 }}>표준 하방 시나리오</strong>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                gap: 8,
              }}
            >
              {stress.stressCases.map((row) => (
                <article
                  key={row.id}
                  style={{
                    display: "grid",
                    gap: 8,
                    padding: 11,
                    border: `1px solid ${row.passesTarget ? "var(--pos-fg)" : "var(--neg-fg)"}`,
                    borderRadius: 8,
                    background: row.passesTarget
                      ? "var(--pos-soft)"
                      : "var(--neg-soft)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <strong style={{ fontSize: 10.5 }}>{row.label}</strong>
                    <b
                      style={{
                        fontSize: 8.5,
                        color: row.passesTarget
                          ? "var(--pos-fg)"
                          : "var(--neg-fg)",
                      }}
                    >
                      {row.passesTarget ? "통과" : "붕괴"}
                    </b>
                  </div>
                  <small
                    style={{
                      minHeight: 28,
                      color: "var(--fg-muted)",
                      lineHeight: 1.45,
                    }}
                  >
                    {row.changes.join(" · ")}
                  </small>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 4,
                      fontSize: 8.5,
                    }}
                  >
                    <span>
                      손익
                      <b style={{ display: "block", marginTop: 2 }}>
                        {won(row.result.profit)}
                      </b>
                    </span>
                    <span>
                      NPV
                      <b style={{ display: "block", marginTop: 2 }}>
                        {won(row.result.npv)}
                      </b>
                    </span>
                    <span>
                      IRR
                      <b style={{ display: "block", marginTop: 2 }}>
                        {row.result.irrStatus === "calculated"
                          ? `${row.result.irr.toFixed(1)}%`
                          : "N/A"}
                      </b>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <p
            style={{
              margin: "12px 0 0",
              paddingTop: 10,
              borderTop: "1px solid var(--border-faint)",
              color: "var(--fg-muted)",
              fontSize: 9,
              lineHeight: 1.55,
            }}
          >
            {stress.modelVersion} · 원장 대사 오차{" "}
            {Math.abs(stress.reconciliationError).toExponential(1)}만원 ·{" "}
            {stress.geometryPolicy} 탐색 한계: {stress.bounds.join(" / ")}.
          </p>
        </>
      )}
    </>
  );
}

function formatMonetaryGap(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "산정 불가";
  if (value === 0) return "없음";
  return value < 0.001 ? "0.001만원 미만" : won(value);
}

function StressGap({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>
      {label}
      <b
        style={{
          display: "block",
          marginTop: 3,
          color: "var(--fg)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {value}
      </b>
    </span>
  );
}

function StressThresholdRow({
  row,
  baselinePasses,
}: {
  row: DealStressThreshold;
  baselinePasses: boolean;
}) {
  const available = row.threshold != null;
  const delta = row.deltaFromCurrentPct;
  let status = "범위 내 해 없음";
  if (available && row.status === "at-bound") status = "탐색 한계까지 통과";
  else if (available && baselinePasses && row.direction === "maximum") {
    status = `상승 여유 ${Math.abs(delta ?? 0).toFixed(1)}%`;
  } else if (available && baselinePasses) {
    status = `하락 여유 ${Math.abs(delta ?? 0).toFixed(1)}%`;
  } else if (available) {
    status = `필요 조정 ${delta != null && delta > 0 ? "+" : ""}${(delta ?? 0).toFixed(1)}%`;
  }
  const positive = available && baselinePasses;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "minmax(110px, 1fr) minmax(95px, .8fr) 18px minmax(95px, .8fr)",
        gap: 8,
        alignItems: "center",
        padding: "9px 10px",
        borderRadius: 8,
        background: available ? "var(--bg-soft)" : "var(--neg-soft)",
      }}
    >
      <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
        <b style={{ fontSize: 10 }}>{row.label}</b>
        <small
          style={{
            color: positive
              ? "var(--pos-fg)"
              : available
                ? "var(--warn-fg)"
                : "var(--neg-fg)",
            fontWeight: 700,
          }}
        >
          {status}
        </small>
      </span>
      <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>
        현재
        <b
          style={{
            display: "block",
            marginTop: 2,
            color: "var(--fg)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {formatStressThreshold(row.current, row.unit)}
        </b>
      </span>
      <b style={{ color: "var(--fg-muted)" }}>→</b>
      <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>
        {row.direction === "maximum" ? "최대" : "최소"}
        <b
          style={{
            display: "block",
            marginTop: 2,
            color: "var(--fg)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {available ? formatStressThreshold(row.threshold!, row.unit) : "N/A"}
        </b>
      </span>
    </div>
  );
}

function formatStressThreshold(
  value: number,
  unit: DealStressThreshold["unit"],
) {
  if (unit === "만원") return won(value);
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (unit === "원/㎡·월")
    return `${Math.round(value).toLocaleString()}원/㎡·월`;
  return `${Math.round(value).toLocaleString()}원/㎡`;
}

function DealRescuePanel({
  rescue,
  baseline,
  targetIRR,
  running,
  onRun,
}: {
  rescue: DealRescueResult | null;
  baseline: DealRescueResult["baseline"];
  targetIRR: number;
  running: boolean;
  onRun: () => void;
}) {
  const baselinePasses = passesDealRescueTarget(baseline, targetIRR);
  const fundingUnverified = baseline.funding.status === "unverified";
  const statusLabel =
    rescue?.status === "already-viable"
      ? fundingUnverified
        ? "재무 목표 통과 · 자금한도 미확인"
        : "현재안 목표 통과"
      : rescue?.status === "rescue-found"
        ? fundingUnverified
          ? "검증 경로 발견 · 자금한도 미확인"
          : "검증 경로 발견"
        : rescue?.status === "geometry-blocked"
          ? "매스 재검토 필요"
          : rescue?.status === "no-bounded-solution"
            ? "탐색 범위 내 해결안 없음"
            : baselinePasses
              ? fundingUnverified
                ? "재무 목표 통과 · 자금한도 미확인"
                : "현재안 목표 통과"
              : "분석 전";
  const statusTone: Tone =
    fundingUnverified &&
    (rescue?.status === "rescue-found" ||
      rescue?.status === "already-viable" ||
      baselinePasses)
      ? "review"
      : rescue?.status === "rescue-found" || baselinePasses
      ? "positive"
      : rescue
        ? "negative"
        : "review";
  const statusColors = toneColors(statusTone);

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 18,
          alignItems: "flex-start",
        }}
      >
        <SectionHeader
          eyebrow="DEAL RESCUE"
          title="이 사업을 살리는 최소 변경점을 역산합니다"
          description={`현재 계획 매스를 고정하고 토지가·매출 단가·직접 공사비·PF 금리를 다시 계산합니다. 흑자, NPV 0 이상, IRR ${targetIRR.toFixed(1)}% 이상과 확인 자금한도를 함께 검사하며, 한도 미입력 결과는 예비 경로로만 표시합니다.`}
        />
        <div
          style={{
            display: "grid",
            justifyItems: "end",
            gap: 8,
            flex: "0 0 auto",
          }}
        >
          <span
            style={{
              padding: "6px 9px",
              borderRadius: 999,
              background: statusColors.bg,
              color: statusColors.fg,
              fontSize: 9.5,
              fontWeight: 800,
            }}
          >
            {statusLabel}
          </span>
          <button
            disabled={running}
            onClick={onRun}
            style={{
              minHeight: 36,
              padding: "0 12px",
              border: "1px solid var(--fg)",
              borderRadius: 8,
              background: "var(--fg)",
              color: "var(--bg)",
              font: "inherit",
              fontSize: 11,
              fontWeight: 700,
              cursor: running ? "wait" : "pointer",
              opacity: running ? 0.65 : 1,
            }}
          >
            {running
              ? "목표 통과 여부 계산 중…"
              : rescue
                ? "현재 입력으로 다시 계산"
                : "최소 변경 찾기"}
          </button>
        </div>
      </div>

      {!rescue && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
            marginTop: 15,
          }}
        >
          <RescueGate
            label="손익"
            value={won(baseline.profit)}
            pass={Number.isFinite(baseline.profitUnroundedManwon) && baseline.profitUnroundedManwon! >= 0}
          />
          <RescueGate
            label="NPV"
            value={won(baseline.npv)}
            pass={Number.isFinite(baseline.npvUnroundedManwon) && baseline.npvUnroundedManwon! >= 0}
          />
          <RescueGate
            label="IRR"
            value={
              calculatedAnnualIrr(baseline) !== null
                ? `${calculatedAnnualIrr(baseline)!.toFixed(3)}%`
                : "N/A"
            }
            pass={
              meetsIrrTarget(baseline, targetIRR)
            }
          />
        </div>
      )}

      {rescue?.status === "already-viable" && (
        <p
          style={{
            margin: "15px 0 0",
            padding: 12,
            borderRadius: 8,
            background: "var(--pos-soft)",
            color: "var(--pos-fg)",
            fontSize: 10.5,
            lineHeight: 1.55,
          }}
        >
          현재 입력이 네 가지 게이트를 모두 통과합니다. 불필요한 낙관 가정을
          추가하지 않았습니다.
        </p>
      )}

      {rescue && rescue.paths.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 9,
            marginTop: 15,
          }}
        >
          {rescue.paths.map((path) => {
            const reachable = path.status === "reachable";
            return (
              <article
                key={path.id}
                style={{
                  display: "grid",
                  alignContent: "start",
                  gap: 9,
                  minHeight: 178,
                  padding: 13,
                  border: `1px solid ${
                    reachable ? "var(--pos-fg)" : "var(--border-faint)"
                  }`,
                  borderRadius: 9,
                  background: reachable
                    ? "var(--pos-soft)"
                    : "var(--bg-soft)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <strong style={{ fontSize: 12 }}>{path.title}</strong>
                  <small
                    style={{
                      color: reachable
                        ? "var(--pos-fg)"
                        : "var(--fg-muted)",
                      fontWeight: 800,
                    }}
                  >
                    {reachable
                      ? "목표 통과"
                      : path.status === "not-applicable"
                        ? "해당 없음"
                        : "범위 내 불가"}
                  </small>
                </div>
                {reachable &&
                  path.changes.map((item) => (
                    <div
                      key={item.field}
                      style={{
                        paddingBottom: 7,
                        borderBottom: "1px solid var(--border-faint)",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          fontSize: 8.5,
                          color: "var(--fg-muted)",
                        }}
                      >
                        {item.label}
                      </span>
                      <strong
                        style={{
                          display: "block",
                          marginTop: 4,
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {formatRescueValue(item, item.from)} →{" "}
                        {formatRescueValue(item, item.to)}
                      </strong>
                      <small
                        style={{
                          display: "block",
                          marginTop: 2,
                          color: "var(--pos-fg)",
                        }}
                      >
                        {item.pctChange == null
                          ? "변화율 N/A"
                          : `${item.pctChange > 0 ? "+" : ""}${item.pctChange.toFixed(1)}%`}
                      </small>
                    </div>
                  ))}
                {reachable && path.result && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 6,
                      fontSize: 8.5,
                    }}
                  >
                    <span>
                      손익
                      <b style={{ display: "block", marginTop: 2 }}>
                        {won(path.result.profit)}
                      </b>
                    </span>
                    <span>
                      NPV
                      <b style={{ display: "block", marginTop: 2 }}>
                        {won(path.result.npv)}
                      </b>
                    </span>
                    <span>
                      IRR
                      <b style={{ display: "block", marginTop: 2 }}>
                        {path.result.irr.toFixed(1)}%
                      </b>
                    </span>
                  </div>
                )}
                <p
                  style={{
                    margin: 0,
                    color: "var(--fg-muted)",
                    fontSize: 8.5,
                    lineHeight: 1.5,
                  }}
                >
                  {path.reason}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {rescue && (
        <p
          style={{
            margin: "12px 0 0",
            paddingTop: 10,
            borderTop: "1px solid var(--border-faint)",
            color: "var(--fg-muted)",
            fontSize: 9,
            lineHeight: 1.55,
          }}
        >
          {rescue.modelVersion} · 엔진 재계산 결과이며 시세 예측이나 견적 확정이
          아닙니다. 기존 계획과 입력값은 자동 변경하지 않습니다. 도달 경로는
          실거래·시공사 견적·금융기관 조건으로 외부 검증한 뒤 별도 버전으로
          확정해야 합니다.
        </p>
      )}
    </>
  );
}

function RescueGate({
  label,
  value,
  pass,
}: {
  label: string;
  value: string;
  pass: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 11px",
        borderRadius: 8,
        background: pass ? "var(--pos-soft)" : "var(--neg-soft)",
      }}
    >
      <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>{label}</span>
      <strong
        style={{
          display: "block",
          marginTop: 4,
          color: pass ? "var(--pos-fg)" : "var(--neg-fg)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        {value} · {pass ? "통과" : "미달"}
      </strong>
    </div>
  );
}

function formatRescueValue(change: DealRescueChange, value: number) {
  if (change.unit === "만원") return won(value);
  if (change.unit === "%") return `${value.toFixed(2)}%`;
  if (change.unit === "원/㎡·월") {
    return `${Math.round(value).toLocaleString()}원/㎡·월`;
  }
  return `${Math.round(value).toLocaleString()}원/㎡`;
}

function formatRevenuePrice(value: number, kind: "sale" | "rent") {
  if (kind === "sale") return `${Math.round((value * SQM_PER_PYEONG) / 10_000).toLocaleString()}만원/평`;
  return `${(value / 10_000).toFixed(1)}만원/㎡·월`;
}

function Stage3Blocked({ title, message, projectId }: { title: string; message: string; projectId: string }) {
  const router = useRouter();
  return <div style={{ maxWidth: 840, margin: "0 auto", padding: "72px 28px" }}><div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg-elev)", padding: 28 }}><span className="ui-tag">STAGE 3</span><h1 style={{ margin: "14px 0 8px", fontSize: 28 }}>{title}</h1><p style={{ margin: 0, color: "var(--fg-muted)", lineHeight: 1.65, fontSize: 13 }}>{message}</p><p style={{ marginTop: 16, padding: 11, borderRadius: 8, background: "var(--bg-soft)", color: "var(--fg-muted)", fontSize: 11 }}>구형 권장안이나 다른 계획안의 숫자로 대체하지 않았습니다. 대표안·Geometry Snapshot·금융 시나리오가 정확히 일치할 때만 표시합니다.</p><button onClick={() => router.push(`/projects/${projectId}/envelope`)} style={{ marginTop: 10, height: 38, border: 0, borderRadius: 8, padding: "0 14px", background: "var(--fg)", color: "var(--bg)", font: "inherit", fontWeight: 700 }}>계획 스튜디오에서 대표안 확인</button></div></div>;
}

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  const colors = toneColors(tone);
  return <span style={{ display: "inline-flex", alignItems: "center", minHeight: 34, padding: "0 10px", borderRadius: 8, background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 700 }}>{children}</span>;
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="fact" style={{ display: "grid", alignContent: "center", gap: 5, borderLeft: "1px solid var(--border-faint)" }}><span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ fontSize: mono ? 10 : 13, fontFamily: mono ? "var(--font-mono)" : "inherit", overflowWrap: "anywhere" }}>{value}</strong></div>;
}

function DecisionSignal({ label, title, value, tone, note }: { label: string; title: string; value: string; tone: Tone; note: string }) {
  const colors = toneColors(tone);
  return <article style={{ border: "1px solid var(--border)", borderTop: `3px solid ${colors.edge}`, borderRadius: 10, padding: "12px 13px", background: "var(--bg-elev)" }}><span style={{ fontSize: 9, color: "var(--fg-muted)", fontWeight: 800, letterSpacing: ".08em" }}>{label}</span><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 8 }}><strong style={{ fontSize: 13 }}>{title}</strong><strong style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: colors.fg }}>{value}</strong></div><p style={{ margin: "7px 0 0", fontSize: 9.5, color: "var(--fg-muted)", lineHeight: 1.4 }}>{note}</p></article>;
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><span className="section-kicker">{eyebrow}</span><h2 style={{ fontSize: 17, margin: "6px 0 4px" }}>{title}</h2><p style={{ margin: 0, color: "var(--fg-muted)", fontSize: 10.5, lineHeight: 1.5 }}>{description}</p></div>;
}

function PricePoint({ label, value, note, tone = "default" }: { label: string; value: number | null; note: string; tone?: "default" | "market" | "active" | "safe" | "risk" }) {
  const edge = tone === "active" ? "var(--accent)" : tone === "safe" ? "var(--pos-fg)" : tone === "risk" ? "var(--neg-fg)" : "var(--border-faint)";
  return <div style={{ padding: "12px 13px", border: `1px solid ${edge}`, borderRadius: 9, background: tone === "active" ? "var(--accent-soft)" : "var(--bg-soft)" }}><span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 16 }}>{value === null ? "미산정" : won(value)}</strong><small style={{ display: "block", marginTop: 4, color: "var(--fg-faint)", fontSize: 9 }}>{note}</small></div>;
}

function FinancialReconciliationPanel({
  audit,
}: {
  audit: FinancialReconciliationAudit;
}) {
  const tone: Tone =
    audit.status === "pass"
      ? "positive"
      : audit.status === "fail"
        ? "negative"
        : "review";
  const colors = toneColors(tone);
  const hasStageTransitionReview = audit.checks.some(
    (check) =>
      check.id.startsWith("stage2-") && check.status !== "pass"
  );
  const statusLabel =
    audit.status === "pass"
      ? "숫자 대사 통과"
      : audit.status === "fail"
        ? "숫자 대사 실패"
        : hasStageTransitionReview
          ? "Stage 2/3 단가 차이 확인"
          : "자금조달 원장 확인";

  return (
    <div
      role="status"
      style={{
        marginTop: 14,
        padding: 12,
        border: `1px solid ${colors.edge}`,
        borderRadius: 9,
        background: colors.bg,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 11.5 }}>사업수지 자동 대사</strong>
        <span style={{ color: colors.fg, fontSize: 9.5, fontWeight: 800 }}>
          {statusLabel}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 7,
          marginTop: 9,
        }}
      >
        {audit.checks.map((check) => {
          const checkTone: Tone =
            check.status === "pass"
              ? "positive"
              : check.status === "fail"
                ? "negative"
                : "review";
          const checkColors = toneColors(checkTone);
          return (
            <div
              key={check.id}
              title={check.message}
              style={{
                padding: "9px 10px",
                borderRadius: 7,
                background: "var(--bg-elev)",
                border: "1px solid var(--border-faint)",
              }}
            >
              <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>
                {check.label}
              </span>
              <strong
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 9.5,
                  color: checkColors.fg,
                }}
              >
                {check.status === "pass"
                  ? "일치"
                  : check.status === "fail"
                    ? `불일치 ${Math.abs(check.differenceManwon).toFixed(2)}만원`
                    : check.id === "funding-sources"
                      ? "월별 원장 확인"
                      : `단계 차이 ${Math.abs(check.differenceManwon).toFixed(2)}만원`}
              </strong>
            </div>
          );
        })}
      </div>
      <p
        style={{
          margin: "8px 0 0",
          color: "var(--fg-muted)",
          fontSize: 8.5,
          lineHeight: 1.5,
        }}
      >
        여섯 수익 풀은 Stage 2 잠금값과 Stage 3 현재값을 각각 대사합니다. 매출·사업비·손익은
        1만원 단위 독립 반올림 최대오차 안에서 확인합니다. 자기자본은 누적 투입액,
        PF는 최고잔액이므로 둘의 합은 총사업비 항등식이 아니며 조달과 상환은 분기
        자금흐름에서 확인합니다.
      </p>
    </div>
  );
}

function MetricCard({ label, value, note, tone = "neutral" }: { label: string; value: string; note?: string; tone?: Tone }) {
  const colors = toneColors(tone);
  return <div style={{ padding: "12px 13px", border: "1px solid var(--border-faint)", borderRadius: 9, background: "var(--bg-soft)" }}><span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 6, fontSize: 16, fontFamily: "var(--font-mono)", color: colors.fg }}>{value}</strong>{note && <small style={{ display: "block", marginTop: 3, fontSize: 8.5, color: "var(--fg-faint)" }}>{note}</small>}</div>;
}

function ReturnMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div style={{ padding: "10px 11px", background: "var(--bg-elev)" }}><span style={{ display: "block", fontSize: 8.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 4, fontSize: 12, fontFamily: "var(--font-mono)" }}>{value}</strong>{note && <small style={{ fontSize: 8, color: "var(--fg-faint)" }}>{note}</small>}</div>;
}

function HoldMetric({ label, value }: { label: string; value: string }) {
  return <div className="hold-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function BreakdownPanel({ title, total, items }: { title: string; total: number; items: Array<[string, number]> }) {
  const max = Math.max(1, ...items.map(([, value]) => value));
  return <div><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong style={{ fontSize: 13 }}>{title}</strong><strong style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{won(total)}</strong></div><div style={{ display: "grid", gap: 9, marginTop: 13 }}>{items.map(([label, value]) => <div key={label}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 9.5 }}><span style={{ color: "var(--fg-muted)" }}>{label}</span><span style={{ fontFamily: "var(--font-mono)" }}>{won(value)}</span></div><div style={{ height: 4, marginTop: 4, borderRadius: 999, background: "var(--bg-soft)", overflow: "hidden" }}><div style={{ width: `${Math.max(0, value / max * 100)}%`, height: "100%", background: "var(--fg-subtle)" }} /></div></div>)}</div></div>;
}

function SensitivityMatrix({ sensitivity }: { sensitivity: Stage3Sensitivity }) {
  return <div style={{ overflowX: "auto", marginTop: 14 }}><table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 4, fontSize: 9.5 }}><thead><tr><th style={{ textAlign: "left", color: "var(--fg-muted)" }}>공사비 \ 가격</th>{sensitivity.revenueSteps.map((step) => <th key={step} style={{ minWidth: 84, color: "var(--fg-muted)" }}>{step > 0 ? "+" : ""}{step}%</th>)}</tr></thead><tbody>{sensitivity.rows.map((row, ri) => <tr key={sensitivity.costSteps[ri]}><th style={{ textAlign: "left", color: "var(--fg-muted)" }}>{sensitivity.costSteps[ri] > 0 ? "+" : ""}{sensitivity.costSteps[ri]}%</th>{row.map((cell, ci) => { const base = sensitivity.costSteps[ri] === 0 && sensitivity.revenueSteps[ci] === 0; const tone: Tone = cell.profitUnroundedManwon === null ? "review" : cell.profitUnroundedManwon >= 0 ? "positive" : "negative"; const colors = toneColors(tone); return <td key={sensitivity.revenueSteps[ci]} style={{ padding: "9px 7px", textAlign: "center", borderRadius: 7, outline: base ? "2px solid var(--fg)" : "none", background: colors.bg, color: colors.fg }}><strong style={{ display: "block", fontFamily: "var(--font-mono)" }}>{won(cell.profit)}</strong><small>IRR {cell.irrStatus === "calculated" ? `${cell.irr.toFixed(1)}%` : "N/A"}</small></td>; })}</tr>)}</tbody></table></div>;
}

function CashflowTable({ rows }: { rows: ReturnType<typeof toCashflowVM> }) {
  const visible = rows.slice(0, 12);
  return <div style={{ overflowX: "auto", marginTop: 13 }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9.5 }}><thead><tr style={{ color: "var(--fg-muted)" }}><th style={{ textAlign: "left", padding: 8 }}>분기</th><th style={{ textAlign: "left", padding: 8 }}>단계</th><th style={{ textAlign: "right", padding: 8 }}>유입</th><th style={{ textAlign: "right", padding: 8 }}>유출</th><th style={{ textAlign: "right", padding: 8 }}>누적</th></tr></thead><tbody>{visible.map((row) => <tr key={row.quarter} style={{ borderTop: "1px solid var(--border-faint)" }}><td style={{ padding: 8 }}>{row.quarter}</td><td style={{ padding: 8 }}>{row.phase}</td><td style={{ padding: 8, textAlign: "right", fontFamily: "var(--font-mono)" }}>{won(row.inflow)}</td><td style={{ padding: 8, textAlign: "right", fontFamily: "var(--font-mono)" }}>{won(row.outflow)}</td><td style={{ padding: 8, textAlign: "right", fontFamily: "var(--font-mono)", color: row.cumulative < 0 ? "var(--neg-fg)" : "var(--pos-fg)" }}>{won(row.cumulative)}</td></tr>)}</tbody></table>{rows.length > visible.length && <p style={{ margin: "8px 0 0", fontSize: 9, color: "var(--fg-muted)" }}>전체 {rows.length}개 분기 중 초기 12개 분기 표시</p>}</div>;
}

function EvidenceMetric({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: "11px 12px", borderRadius: 8, background: "var(--bg-soft)" }}><span style={{ display: "block", fontSize: 9, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 5, fontSize: 12 }}>{value}</strong></div>;
}

function AcquisitionPriceEditor({
  totalManwon,
  lotAreaSqm,
  referenceManwon,
  edited,
  source,
  onChange,
}: {
  totalManwon: number;
  lotAreaSqm: number;
  referenceManwon: number;
  edited: boolean;
  source: string;
  onChange: (value: number) => void;
}) {
  const [mode, setMode] = useState<AcquisitionPriceMode>("total");
  const perPyeong = acquisitionPricePerPyeong(totalManwon, lotAreaSqm);
  const assessment = assessAcquisitionPrice(totalManwon, referenceManwon);
  const displayedValue = mode === "total" ? totalManwon : perPyeong;
  const warning =
    assessment.status === "extreme-low"
      ? `알고리즘 참고 추정의 ${assessment.ratioPct.toFixed(1)}%입니다. 총액과 평당가 단위를 다시 확인하세요.`
      : assessment.status === "extreme-high"
        ? `알고리즘 참고 추정의 ${assessment.ratioPct.toFixed(0)}%입니다. 총액과 평당가 단위를 다시 확인하세요.`
        : null;

  return (
    <div style={{ padding: "10px 0 12px", borderBottom: "1px solid var(--border-faint)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>부동산 총 취득대금</span>
        <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          {(["total", "per-pyeong"] as AcquisitionPriceMode[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              style={{
                minHeight: 25,
                padding: "0 7px",
                border: 0,
                background: mode === item ? "var(--fg)" : "var(--bg)",
                color: mode === item ? "var(--bg)" : "var(--fg-muted)",
                fontSize: 8.5,
                fontWeight: 700,
              }}
            >
              {item === "total" ? "총액" : "평당가"}
            </button>
          ))}
        </span>
      </div>
      <label style={{ display: "flex", justifyContent: "flex-end", gap: 5, alignItems: "center", marginTop: 7 }}>
        <input
          aria-label={mode === "total" ? "부동산 총 취득대금 총액" : "부동산 총 취득대금 평당가"}
          type="number"
          min={0}
          step={mode === "total" ? 1000 : 50}
          value={Number(displayedValue.toFixed(0))}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next) || next < 0) return;
            onChange(
              mode === "total"
                ? next
                : acquisitionPriceTotal(next, lotAreaSqm)
            );
          }}
          style={{
            width: 110,
            height: 29,
            padding: "0 7px",
            borderRadius: 6,
            border: `1px solid ${edited ? "var(--accent)" : "var(--border)"}`,
            background: "var(--bg)",
            color: edited ? "var(--accent)" : "var(--fg)",
            textAlign: "right",
            font: "inherit",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        />
        <small style={{ minWidth: 54, color: "var(--fg-faint)", fontSize: 8.5 }}>
          {mode === "total" ? "만원 총액" : "만원/평"}
        </small>
      </label>
      <div style={{ marginTop: 6, padding: "7px 8px", borderRadius: 6, background: "var(--bg-soft)", fontSize: 9, lineHeight: 1.5 }}>
        <strong>{won(totalManwon)} 총액</strong>
        <span style={{ marginLeft: 6, color: "var(--fg-muted)" }}>
          {Math.round(perPyeong).toLocaleString()}만원/평
        </span>
      </div>
      {warning && (
        <div role="alert" style={{ marginTop: 6, padding: "7px 8px", borderRadius: 6, background: "var(--neg-soft)", color: "var(--neg-fg)", fontSize: 8.8, lineHeight: 1.5 }}>
          {warning}
        </div>
      )}
      <small title={source} style={{ display: "block", marginTop: 4, color: edited ? "var(--accent)" : "var(--fg-faint)", fontSize: 8.5 }}>
        {edited ? "사용자 수정 · 실시간 재계산" : source}
      </small>
    </div>
  );
}

const SOURCE_KIND_LABELS: Record<FinancialSourceKind, string> = {
  "official-api": "공식 API 원문",
  "signed-contract": "서명 계약서",
  "professional-quote": "전문가·시공사 견적",
  "lender-term-sheet": "금융기관 Term Sheet",
  appraisal: "감정평가·시장보고서",
  "approved-policy": "승인된 내부 기준",
};

function SourceDataPanel({
  projectId,
  records,
  gate,
  currentValues,
  onSave,
  onRemove,
}: {
  projectId: string;
  records: FinancialSourceMap;
  gate: SourceDataGateResult;
  currentValues: Record<FinancialSourceField, number>;
  onSave: (record: FinancialSourceRecord) => void;
  onRemove: (field: FinancialSourceField) => void;
}) {
  const initialField =
    gate.missingFields[0] ?? gate.requiredFields[0] ?? "acquisitionPrice";
  const initialRecord = records[initialField];
  const [field, setField] = useState<FinancialSourceField>(initialField);
  const [value, setValue] = useState(
    String(initialRecord?.value ?? currentValues[initialField] ?? "")
  );
  const [sourceKind, setSourceKind] = useState<FinancialSourceKind>(
    initialRecord?.sourceKind ??
      FINANCIAL_SOURCE_FIELD_META[initialField].allowedKinds[0]
  );
  const [sourceName, setSourceName] = useState(
    initialRecord?.sourceName ?? ""
  );
  const [documentRef, setDocumentRef] = useState(
    initialRecord?.documentRef ?? ""
  );
  const [asOf, setAsOf] = useState(initialRecord?.asOf ?? "");
  const [verifiedBy, setVerifiedBy] = useState(
    initialRecord?.verifiedBy ?? ""
  );
  const [sourceDocument, setSourceDocument] =
    useState<SourceDocumentMetadata | null>(initialRecord?.document ?? null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const accessSession = useAccessSession();
  const canUploadEvidence = principalHasCapability(
    accessSession.data,
    "evidence.upload",
  );
  const canUpdateProject = principalHasCapability(
    accessSession.data,
    "project.update",
  );
  const meta = FINANCIAL_SOURCE_FIELD_META[field];
  const guidance = FINANCIAL_SOURCE_GUIDANCE[field];
  const reusableSourceRecords = Array.from(
    new Map(
      Object.values(records)
        .filter(
          (record): record is FinancialSourceRecord & {
            document: SourceDocumentMetadata;
          } => Boolean(record?.document),
        )
        .map((record) => [record.document.pathname, record]),
    ).values(),
  );

  const selectField = (nextField: FinancialSourceField) => {
    const existing = records[nextField];
    const nextMeta = FINANCIAL_SOURCE_FIELD_META[nextField];
    setField(nextField);
    setValue(String(existing?.value ?? currentValues[nextField] ?? ""));
    setSourceKind(existing?.sourceKind ?? nextMeta.allowedKinds[0]);
    setSourceName(existing?.sourceName ?? "");
    setDocumentRef(existing?.documentRef ?? "");
    setAsOf(existing?.asOf ?? "");
    setVerifiedBy(existing?.verifiedBy ?? "");
    setSourceDocument(existing?.document ?? null);
    setSelectedFile(null);
    setFileInputKey((current) => current + 1);
    setError(null);
    setNotice(null);
  };

  const uploadSourceDocument = async () => {
    if (!selectedFile) {
      setError("업로드할 PDF·Excel·CSV 원문을 선택하세요.");
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("field", field);
      form.set("file", selectedFile);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/source-documents`,
        {
          method: "POST",
          body: form,
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { document?: SourceDocumentMetadata; error?: string }
        | null;
      if (!response.ok || !payload?.document) {
        throw new Error(payload?.error ?? "원문 업로드에 실패했습니다.");
      }
      setSourceDocument(payload.document);
      setDocumentRef((current) => current.trim() || payload.document!.fileName);
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
      setNotice(
        `비공개 원문을 연결했습니다. SHA-256 ${payload.document.sha256.slice(0, 12)}…`,
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "원문 업로드에 실패했습니다.",
      );
    } finally {
      setUploading(false);
    }
  };

  const openSourceDocument = async (document: SourceDocumentMetadata) => {
    setError(null);
    try {
      const query = new URLSearchParams({
        pathname: document.pathname,
        fileName: document.fileName,
      });
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/source-documents?${query}`,
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "원문을 불러올 수 없습니다.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = document.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "원문을 불러올 수 없습니다.",
      );
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const record: FinancialSourceRecord = {
      field,
      value: Number(value),
      sourceKind,
      sourceName: sourceName.trim(),
      documentRef: documentRef.trim(),
      asOf,
      verifiedBy: accessSession.data?.name ?? verifiedBy.trim(),
      recordedAt: new Date().toISOString().slice(0, 10),
      document: sourceDocument ?? undefined,
    };
    const validation = validateFinancialSource(record);
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }
    onSave(record);
    setError(null);
    setNotice(
      sourceKindRequiresDocument(sourceKind) && !sourceDocument
        ? "값은 계산에 반영됐지만 원문 파일이 없어 전문가 인계는 계속 차단됩니다."
        : "원문 값과 증빙 메타데이터를 계산에 반영했습니다.",
    );
  };

  return (
    <>
      <span className="section-kicker">SOURCE DATA ROOM</span>
      <h2 style={{ fontSize: 16, margin: "5px 0 4px" }}>
        원문 기반 계산 입력
      </h2>
      <p
        style={{
          margin: "0 0 10px",
          color: "var(--fg-muted)",
          fontSize: 9.5,
          lineHeight: 1.5,
        }}
      >
        등록 즉시 해당 값이 예비 가정을 덮어쓰고 전체 사업성 원장을 다시
        계산합니다.
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "center",
          padding: "9px 10px",
          borderRadius: 8,
          background:
            gate.status === "source-backed"
              ? "var(--pos-soft)"
              : "var(--neg-soft)",
          color:
            gate.status === "source-backed"
              ? "var(--pos-fg)"
              : "var(--neg-fg)",
          fontSize: 9.5,
          fontWeight: 800,
        }}
      >
        <span>
          {gate.validRecords.length}/{gate.requiredFields.length}건 검증
        </span>
        <span>{gate.coveragePct.toFixed(0)}%</span>
      </div>

      <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
        {gate.requiredFields.map((item) => {
          const record = records[item];
          const validation = record
            ? validateFinancialSourceEvidence(record)
            : null;
          const status = validation?.valid
            ? "확정"
            : record
              ? "원문 확인"
              : "필요";
          return (
            <button
              key={item}
              type="button"
              onClick={() => selectField(item)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                width: "100%",
                padding: "7px 8px",
                border: `1px solid ${item === field ? "var(--accent)" : "var(--border-faint)"}`,
                borderRadius: 7,
                background: item === field ? "var(--accent-soft)" : "var(--bg-soft)",
                color: "var(--fg)",
                textAlign: "left",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 9.5, fontWeight: 700 }}>
                {FINANCIAL_SOURCE_FIELD_META[item].label}
              </span>
              <small
                style={{
                  color: validation?.valid
                    ? "var(--pos-fg)"
                    : record
                      ? "var(--warn-fg)"
                      : "var(--neg-fg)",
                  fontWeight: 800,
                }}
              >
                {status}
              </small>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gap: 4,
          marginTop: 10,
          padding: 9,
          borderRadius: 8,
          background: "var(--warn-soft)",
          color: "var(--warn-fg)",
          fontSize: 9,
          lineHeight: 1.5,
        }}
      >
        <b>{guidance.group} · 왜 필요한가</b>
        <span>{guidance.why}</span>
        <small>권장 근거: {guidance.recommendedEvidence}</small>
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 8, marginTop: 11 }}>
        <label style={sourceLabelStyle}>
          계산 항목
          <select
            value={field}
            onChange={(event) =>
              selectField(event.target.value as FinancialSourceField)
            }
            style={sourceInputStyle}
          >
            {gate.requiredFields.map((item) => (
              <option key={item} value={item}>
                {FINANCIAL_SOURCE_FIELD_META[item].label}
                {records[item] ? " · 등록됨" : " · 필요"}
              </option>
            ))}
          </select>
        </label>
        <label style={sourceLabelStyle}>
          원문 값 ({meta.unit})
          <input
            type="number"
            min="0"
            step="any"
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            style={sourceInputStyle}
          />
          <small style={{ color: "var(--fg-faint)", lineHeight: 1.45 }}>
            현재 예비 계산값을 자동 입력했습니다. 원문과 일치하는지 확인한 뒤 저장하세요.
          </small>
        </label>
        <label style={sourceLabelStyle}>
          출처 유형
          <select
            value={sourceKind}
            onChange={(event) =>
              setSourceKind(event.target.value as FinancialSourceKind)
            }
            style={sourceInputStyle}
          >
            {meta.allowedKinds.map((kind) => (
              <option key={kind} value={kind}>
                {SOURCE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <label style={sourceLabelStyle}>
          발급기관·출처명
          <input
            required
            value={sourceName}
            placeholder="예: ○○건설 / ○○은행"
            onChange={(event) => setSourceName(event.target.value)}
            style={sourceInputStyle}
          />
        </label>
        <label style={sourceLabelStyle}>
          문서번호·URL·파일 참조
          <input
            required
            value={documentRef}
            placeholder="예: 견적서 2026-07-A / 원문 URL"
            onChange={(event) => setDocumentRef(event.target.value)}
            style={sourceInputStyle}
          />
        </label>
        <fieldset
          style={{
            display: "grid",
            gap: 7,
            margin: 0,
            padding: 9,
            border: "1px solid var(--border-faint)",
            borderRadius: 8,
          }}
        >
          <legend style={{ padding: "0 4px", fontSize: 8.5, fontWeight: 800 }}>
            비공개 원문 보관함
          </legend>
          {reusableSourceRecords.length > 0 && (
            <label style={sourceLabelStyle}>
              이미 등록한 원문과 발급정보 재사용
              <select
                value={sourceDocument?.pathname ?? ""}
                onChange={(event) => {
                  const reused = reusableSourceRecords.find(
                    (record) =>
                      record.document.pathname === event.target.value,
                  );
                  setSourceDocument(reused?.document ?? null);
                  if (reused) {
                    if (meta.allowedKinds.includes(reused.sourceKind)) {
                      setSourceKind(reused.sourceKind);
                    }
                    setSourceName(reused.sourceName);
                    setDocumentRef(reused.documentRef || reused.document.fileName);
                    setAsOf(reused.asOf);
                    setVerifiedBy(reused.verifiedBy);
                    setNotice("기존 원문·발급기관·기준일·확인자 정보를 재사용했습니다.");
                  }
                }}
                style={sourceInputStyle}
              >
                <option value="">새 원문 업로드 또는 연결 안 함</option>
                {reusableSourceRecords.map((record) => (
                  <option
                    key={record.document.pathname}
                    value={record.document.pathname}
                  >
                    {record.sourceName} · {record.document.fileName} ·{" "}
                    {record.document.sha256.slice(0, 10)}…
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={sourceLabelStyle}>
            PDF·XLSX·XLS·CSV · 최대 4MB
            <input
              key={fileInputKey}
              type="file"
              accept={SOURCE_DOCUMENT_ACCEPT}
              onChange={(event) =>
                setSelectedFile(event.target.files?.[0] ?? null)
              }
              style={{ ...sourceInputStyle, padding: 6 }}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={uploading || !selectedFile || !canUploadEvidence}
            onClick={uploadSourceDocument}
          >
            {uploading
              ? "해시 확인·업로드 중…"
              : canUploadEvidence
                ? "원문 비공개 업로드"
                : "업로드 권한 없음"}
          </button>
          {sourceDocument && (
            <div
              style={{
                display: "grid",
                gap: 3,
                padding: 8,
                borderRadius: 7,
                background: "var(--pos-soft)",
                color: "var(--pos-fg)",
                fontSize: 8.5,
                overflowWrap: "anywhere",
              }}
            >
              <b>{sourceDocument.fileName}</b>
              <span>
                {(sourceDocument.size / 1024).toFixed(1)}KB · SHA-256{" "}
                {sourceDocument.sha256.slice(0, 16)}…
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => openSourceDocument(sourceDocument)}
                style={{ justifySelf: "start" }}
              >
                원문 내려받기
              </button>
            </div>
          )}
          {sourceKindRequiresDocument(sourceKind) && !sourceDocument && (
            <small style={{ color: "var(--neg-fg)", lineHeight: 1.5 }}>
              이 출처 유형은 값을 저장할 수 있지만 원문 업로드 전까지 전문가
              인계 게이트를 통과하지 못합니다.
            </small>
          )}
        </fieldset>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          <label style={sourceLabelStyle}>
            기준일
            <input
              type="date"
              required
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              style={sourceInputStyle}
            />
          </label>
          <label style={sourceLabelStyle}>
            확인자
            <input
              required
              value={accessSession.data?.name ?? verifiedBy}
              readOnly={Boolean(accessSession.data)}
              placeholder="로그인 사용자"
              onChange={(event) => setVerifiedBy(event.target.value)}
              style={sourceInputStyle}
            />
          </label>
        </div>
        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: 8,
              borderRadius: 7,
              background: "var(--neg-soft)",
              color: "var(--neg-fg)",
              fontSize: 9,
              lineHeight: 1.45,
            }}
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            style={{
              margin: 0,
              padding: 8,
              borderRadius: 7,
              background: "var(--pos-soft)",
              color: "var(--pos-fg)",
              fontSize: 9,
              lineHeight: 1.45,
            }}
          >
            {notice}
          </p>
        )}
        <button className="primary-button" type="submit" disabled={!canUpdateProject}>
          {!canUpdateProject
            ? "입력 수정 권한 없음"
            : records[field]
              ? "소스 값 갱신"
              : "소스 값 적용"}
        </button>
      </form>

      <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
        {gate.requiredFields.map((item) => {
          const record = records[item];
          if (!record) return null;
          const validation = validateFinancialSourceEvidence(record);
          return (
            <div
              key={item}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                padding: "8px 0",
                borderTop: "1px solid var(--border-faint)",
              }}
            >
              <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <b style={{ fontSize: 9.5 }}>
                  {FINANCIAL_SOURCE_FIELD_META[item].label} ·{" "}
                  {formatSourceValue(record)}
                </b>
                <small
                  style={{
                    color: validation.valid
                      ? "var(--pos-fg)"
                      : "var(--neg-fg)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {record.sourceName} · {record.asOf} · {record.documentRef}
                </small>
                {record.document && (
                  <small style={{ color: "var(--fg-muted)", overflowWrap: "anywhere" }}>
                    비공개 원문 {record.document.fileName} · SHA-256{" "}
                    {record.document.sha256.slice(0, 12)}…
                  </small>
                )}
                {!validation.valid && (
                  <small style={{ color: "var(--neg-fg)", lineHeight: 1.4 }}>
                    {validation.errors.join(" ")}
                  </small>
                )}
              </span>
              <span style={{ display: "grid", gap: 5, alignContent: "start" }}>
                {record.document && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => openSourceDocument(record.document!)}
                  >
                    원문
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onRemove(item)}
                >
                  제거
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

const sourceLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  color: "var(--fg-muted)",
  fontSize: 8.5,
  fontWeight: 700,
};

const sourceInputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--bg-elev)",
  color: "var(--fg)",
  padding: "0 8px",
  font: "inherit",
  fontSize: 10,
};

function formatSourceValue(record: FinancialSourceRecord) {
  const unit = FINANCIAL_SOURCE_FIELD_META[record.field].unit;
  if (unit === "만원") return won(record.value);
  if (unit === "%" || unit === "%/월") {
    return `${record.value.toLocaleString()}${unit}`;
  }
  return `${record.value.toLocaleString()}${unit}`;
}

const REVENUE_POOL_LABELS: Record<FinancialRevenuePoolKey, string> = {
  residentialSale: "주거 매각",
  retailSale: "상가 매각",
  officeSale: "업무 매각",
  residentialLease: "주거 임대",
  retailLease: "상가 임대",
  officeLease: "업무 임대",
};

const REVENUE_ADJUSTMENT_LABELS: Record<
  RevenuePriceAdjustmentDimension,
  string
> = {
  use: "용도",
  location: "입지",
  floor: "층",
  area: "면적",
  newBuild: "신축",
};

function RevenuePricingEditor({
  areas,
  pricing,
  draft,
  onChange,
}: {
  areas: FinancialRevenueAreaPools;
  pricing: FinancialRevenuePricingSnapshot;
  draft: RevenuePricingDraftContract | undefined;
  onChange: (
    pool: FinancialRevenuePoolKey,
    patch: RevenuePoolPricingDraft,
  ) => void;
}) {
  const activePools = FINANCIAL_REVENUE_POOL_KEYS.filter(
    (pool) => revenueAreaForPool(areas, pool) > 0,
  );
  return (
    <details open className="assumption-group revenue-pricing-group">
      <summary>용도별 매출 단가</summary>
      <div className="revenue-pricing-list">
        {activePools.map((pool) => {
          const item = pricing.pools[pool];
          const poolDraft = draft?.pools[pool];
          const baseUnitPrice =
            item.baseUnitPriceWon ??
            item.unitPriceWon / Math.max(item.adjustmentFactor, 0.000001);
          const unitSuffix =
            item.unit === "won-per-sqm" ? "만원/㎡" : "만원/㎡·월";
          const sourceLabel =
            item.sourceStatus === "source-backed"
              ? "원문 근거"
              : item.sourceStatus === "user-input"
                ? "사용자 입력"
                : "내부 가정";
          const sourceBacked = item.sourceStatus === "source-backed";
          const ignoredBaseDraft =
            sourceBacked && poolDraft?.baseUnitPriceWon != null;
          return (
            <details key={pool} className="revenue-price-row">
              <summary>
                <span>
                  <b>{REVENUE_POOL_LABELS[pool]}</b>
                  <small>{sourceLabel}</small>
                </span>
                <strong>
                  {(item.unitPriceWon / 10_000).toLocaleString("ko-KR", {
                    maximumFractionDigits: 1,
                  })}
                  <small>{unitSuffix}</small>
                </strong>
              </summary>
              <label className="revenue-base-input">
                <span>보정 전 기준단가</span>
                <span>
                  <input
                    type="number"
                    min={0}
                    step={item.unit === "won-per-sqm" ? 10 : 0.1}
                    disabled={sourceBacked}
                    title={
                      sourceBacked
                        ? "원문 근거 값은 아래 금융 원문 근거에서 수정하거나 근거를 제거하세요."
                        : undefined
                    }
                    value={(baseUnitPrice / 10_000).toFixed(
                      item.unit === "won-per-sqm" ? 0 : 1,
                    )}
                    onChange={(event) => {
                      const value = Number(event.target.value) * 10_000;
                      if (Number.isFinite(value) && value >= 0) {
                        onChange(pool, { baseUnitPriceWon: value });
                      }
                    }}
                  />
                  <small>{unitSuffix}</small>
                </span>
              </label>
              <div className="revenue-adjustment-grid">
                {REVENUE_PRICE_ADJUSTMENT_DIMENSIONS.map((dimension) => {
                  const adjustment = item.adjustments?.[dimension];
                  const factor =
                    adjustment?.factor ??
                    (dimension === "use" ? item.adjustmentFactor : 1);
                  return (
                    <label
                      key={dimension}
                      title={
                        adjustment
                          ? `${adjustment.sourceName}${adjustment.note ? ` · ${adjustment.note}` : ""}`
                          : "구형 통합 보정"
                      }
                    >
                      <span>{REVENUE_ADJUSTMENT_LABELS[dimension]}</span>
                      <span>
                        <input
                          type="number"
                          min={-90}
                          max={900}
                          step={1}
                          value={((factor - 1) * 100).toFixed(1)}
                          onChange={(event) => {
                            const percent = Number(event.target.value);
                            if (
                              Number.isFinite(percent) &&
                              percent >= -90 &&
                              percent <= 900
                            ) {
                              onChange(pool, {
                                adjustments: {
                                  [dimension]: 1 + percent / 100,
                                },
                              });
                            }
                          }}
                        />
                        <small>%</small>
                      </span>
                    </label>
                  );
                })}
              </div>
              <small className="revenue-price-source" title={item.sourceRef}>
                {ignoredBaseDraft
                  ? "원문 단가 우선 · 저장된 사용자 기준단가 초안은 현재 미적용"
                  : poolDraft
                    ? "사용자 단가·보정 초안"
                    : item.sourceName}
              </small>
            </details>
          );
        })}
      </div>
    </details>
  );
}

function NumericEditor({ field, label, value, divisor, suffix, step, decimals = 0, edited, source, onChange }: Omit<AssumptionField, "field"> & { field?: keyof AssumptionSet; value: number; edited: boolean; source: string; onChange: (value: number) => void }) {
  const rule = field ? ASSUMPTION_VALUE_RULES[field] : null;
  const min = rule ? rule.min / divisor : 0;
  const max = rule ? rule.max / divisor : undefined;
  return <label style={{ display: "block", padding: "8px 0" }}><span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><span style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>{label}</span><span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="number" min={min} max={max} step={step} value={(value / divisor).toFixed(decimals)} onChange={(event) => { const next = Number(event.target.value); const rawValue = next * divisor; if (Number.isFinite(next) && (!field || validateAssumptionValue(field, rawValue).length === 0)) onChange(rawValue); }} style={{ width: 88, height: 27, padding: "0 6px", borderRadius: 6, border: `1px solid ${edited ? "var(--accent)" : "var(--border)"}`, background: "var(--bg)", color: edited ? "var(--accent)" : "var(--fg)", textAlign: "right", font: "inherit", fontSize: 10.5, fontWeight: 700 }} /><small style={{ color: "var(--fg-faint)", fontSize: 8.5 }}>{suffix}</small></span></span><small title={source} style={{ display: "block", marginTop: 3, maxWidth: 300, color: edited ? "var(--accent)" : "var(--fg-faint)", fontSize: 8.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{edited ? "사용자 수정 · 실시간 재계산" : source}</small></label>;
}

function SourceCoverageRow({
  label,
  fields,
  records,
  fallback,
}: {
  label: string;
  fields: FinancialSourceField[];
  records: FinancialSourceMap;
  fallback: string;
}) {
  const registered = fields
    .map((field) => records[field])
    .filter((record): record is FinancialSourceRecord => Boolean(record));
  const valid = registered.filter(
    (record) => validateFinancialSourceEvidence(record).valid
  );
  const state: "확정" | "검토" | "미확정" =
    valid.length === fields.length
      ? "확정"
      : registered.length > 0
        ? "검토"
        : "미확정";
  const value =
    registered.length > 0
      ? registered
          .map((record) => {
            const validation = validateFinancialSourceEvidence(record);
            return `${FINANCIAL_SOURCE_FIELD_META[record.field].label}: ${record.sourceName} · ${record.asOf}${validation.valid ? "" : " · 원문 확인 필요"}`;
          })
          .join(" / ")
      : fallback;

  return <EvidenceRow label={label} value={value} state={state} />;
}

function EvidenceRow({ label, value, state }: { label: string; value: string; state: "확정" | "검토" | "미확정" }) {
  const tone: Tone = state === "확정" ? "positive" : state === "검토" ? "review" : "negative";
  return <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border-faint)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ fontSize: 8.5, color: toneColors(tone).fg }}>{state}</strong></div><div style={{ marginTop: 3, fontSize: 9.5, lineHeight: 1.4, overflowWrap: "anywhere" }}>{value}</div></div>;
}

function ScenarioTable({
  scenarios,
  representativeId,
  decisionSupport,
  afterTaxDecisionSupport,
  onOpen,
}: {
  scenarios: ScenarioVM[];
  representativeId: string;
  decisionSupport?: ScenarioDecisionSupport;
  afterTaxDecisionSupport?: AfterTaxDecisionSupport;
  onOpen: (id: string) => void;
}) {
  const entries = new Map(
    decisionSupport?.entries.map((entry) => [entry.scenarioId, entry]) ?? [],
  );
  const leaders = (decisionSupport?.objectiveLeaders ?? []).filter(
    (leader) => leader.scenarioIds.length > 0 && leader.bestValue != null,
  );
  const decisionWarnings = decisionSupport?.warnings.filter((warning) =>
    warning.includes("용도지역 스크리닝") || warning.includes("IRR") || warning.includes("정밀"),
  ) ?? [];
  const afterTaxEntries = new Map(
    afterTaxDecisionSupport?.entries.map((entry) => [entry.scenarioId, entry]) ??
      [],
  );
  const confirmedAfterTaxLeaders =
    afterTaxDecisionSupport?.confirmedObjectiveLeaders.filter(
      (leader) => leader.scenarioIds.length > 0 && leader.bestValue != null,
    ) ?? [];

  return (
    <>
      {decisionSupport && (
        <div style={{ marginTop: 13, borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 11 }}>가중치 없는 파레토 비교 · {decisionSupport.paretoScenarioIds.length}개 후보</strong>
            <span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{decisionSupport.modelVersion}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", marginTop: 9, borderTop: "1px solid var(--border-faint)" }}>
            {leaders.map((leader) => (
              <div key={leader.objective} style={{ padding: "8px 8px 0 0", minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 8.5, color: "var(--fg-muted)" }}>{leader.label} 선두</span>
                <strong style={{ display: "block", marginTop: 2, fontSize: 10, overflowWrap: "anywhere" }}>
                  {leader.scenarioIds.join(" · ")} · {formatDecisionValue(leader.objective, leader.bestValue!)}
                </strong>
              </div>
            ))}
          </div>
          <p style={{ margin: "9px 0 0", fontSize: 9.5, lineHeight: 1.5, color: "var(--fg-muted)" }}>
            장기대출 DSCR은 임대 NOI와 대출 조건이 있는 안에만 적용되어 공통 순위 축에서 제외합니다. 파레토 후보는 다른 후보가 모든 비교 축에서 동시에 앞서지 못한 대안이며, 자동 승인이나 투자 확정을 뜻하지 않습니다.
          </p>
          {decisionWarnings.map((warning) => (
            <p key={warning} style={{ margin: "5px 0 0", fontSize: 9.5, lineHeight: 1.5, color: "var(--warn-fg)" }}>
              {warning}
            </p>
          ))}
        </div>
      )}
      {afterTaxDecisionSupport && (
        <div style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 11 }}>
              전문가 확인 세후 Pareto · {afterTaxDecisionSupport.confirmedEligibleScenarioCount}/{scenarios.length}개 비교 적격
            </strong>
            <span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>
              {afterTaxDecisionSupport.modelVersion}
            </span>
          </div>
          {confirmedAfterTaxLeaders.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", marginTop: 9, borderTop: "1px solid var(--border-faint)" }}>
              {confirmedAfterTaxLeaders.map((leader) => (
                <div key={leader.objective} style={{ padding: "8px 8px 0 0", minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 8.5, color: "var(--fg-muted)" }}>{leader.label} 선두</span>
                  <strong style={{ display: "block", marginTop: 2, fontSize: 10, overflowWrap: "anywhere" }}>
                    {leader.scenarioIds.join(" · ")} · {formatAfterTaxDecisionValue(leader.objective, leader.bestValue!)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: "8px 0 0", fontSize: 9.5, color: "var(--warn-fg)" }}>
              확정 비교를 만들려면 최소 한 계획안의 안정화 매각 세무 원장을 전문가 확인 상태로 저장해야 합니다.
            </p>
          )}
          <p style={{ margin: "8px 0 0", fontSize: 9.5, lineHeight: 1.5, color: "var(--fg-muted)" }}>
            확정 집합 {afterTaxDecisionSupport.confirmedParetoScenarioIds.length}개 · 완결 초안 별도 집합 {afterTaxDecisionSupport.preliminaryParetoScenarioIds.length}개. 초안은 확정 후보나 대표안을 바꾸지 않으며, 세전 현금흐름이 바뀐 확인서는 자동 제외됩니다.
          </p>
          {afterTaxDecisionSupport.warnings.filter((warning) => warning.includes("IRR") || warning.includes("정밀")).map((warning) => (
            <p key={warning} style={{ margin: "5px 0 0", fontSize: 9.5, lineHeight: 1.5, color: "var(--warn-fg)" }}>{warning}</p>
          ))}
        </div>
      )}
      <div style={{ overflowX: "auto", marginTop: 13 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ color: "var(--fg-muted)", textAlign: "right" }}>
              <th style={{ textAlign: "left", padding: 8 }}>계획안</th>
              <th style={{ textAlign: "left", padding: 8 }}>비교 역할</th>
              <th style={{ padding: 8 }}>총사업비</th>
              <th style={{ padding: 8 }}>손익</th>
              <th style={{ padding: 8 }}>IRR</th>
              <th style={{ padding: 8 }}>NPV</th>
              <th style={{ padding: 8 }}>세후 손익</th>
              <th style={{ textAlign: "left", padding: 8 }}>세후 비교</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((scenario) => {
              const representative = scenario.id === representativeId;
              const entry = entries.get(scenario.id);
              const role = entry
                ? entry.status === "pareto"
                  ? "파레토 후보"
                  : entry.status === "dominated"
                    ? "비교 열위"
                    : "비교 제외"
                : "비교";
              const leaderLabels = entry?.leaderObjectives
                .map(decisionObjectiveLabel)
                .join(" · ");
              const afterTaxEntry = afterTaxEntries.get(scenario.id);
              const showAfterTaxMetric =
                afterTaxEntry?.tier === "confirmed" ||
                afterTaxEntry?.tier === "preliminary";
              const rawProfit = scenario.profitUnroundedManwon;
              const profitColor = typeof rawProfit === "number" && Number.isFinite(rawProfit)
                ? rawProfit >= 0 ? "var(--pos-fg)" : "var(--neg-fg)"
                : "var(--fg-muted)";
              const rawAfterTaxProfit = afterTaxEntry?.metrics.afterTaxProfitUnroundedManwon;
              const afterTaxProfitColor = showAfterTaxMetric && typeof rawAfterTaxProfit === "number" && Number.isFinite(rawAfterTaxProfit)
                ? rawAfterTaxProfit >= 0 ? "var(--pos-fg)" : "var(--neg-fg)"
                : "var(--fg-muted)";
              const afterTaxRole = afterTaxEntry
                ? afterTaxEntry.tier === "confirmed"
                  ? afterTaxEntry.status === "pareto"
                    ? "확정 Pareto"
                    : afterTaxEntry.status === "dominated"
                      ? "확정 비교 열위"
                      : "확정 비교 제외"
                  : afterTaxEntry.tier === "preliminary"
                    ? afterTaxEntry.status === "pareto"
                      ? "초안 Pareto"
                      : afterTaxEntry.status === "dominated"
                        ? "초안 비교 열위"
                        : "초안 비교 제외"
                    : "세후 미산정"
                : "세후 미산정";
              const afterTaxLeaderLabels = afterTaxEntry?.leaderObjectives
                .filter((objective) =>
                  ["after-tax-profit", "after-tax-npv", "after-tax-irr"].includes(
                    objective,
                  ),
                )
                .map(afterTaxObjectiveLabel)
                .join(" · ");
              return (
                <tr
                  key={scenario.id}
                  onClick={() => onOpen(scenario.id)}
                  style={{ borderTop: "1px solid var(--border-faint)", background: representative ? "var(--accent-soft)" : "transparent", cursor: "pointer", textAlign: "right" }}
                >
                  <td style={{ textAlign: "left", padding: 9 }}>
                    <strong>{scenario.name}</strong>
                    {representative && <small style={{ marginLeft: 6, color: "var(--accent)" }}>대표안</small>}
                  </td>
                  <td style={{ textAlign: "left", padding: 9 }}>
                    <strong style={{ color: entry?.status === "ineligible" ? "var(--neg-fg)" : entry?.status === "pareto" ? "var(--pos-fg)" : "var(--fg-muted)" }}>{role}</strong>
                    {leaderLabels && <small style={{ display: "block", marginTop: 2, color: "var(--fg-muted)" }}>{leaderLabels}</small>}
                    {entry?.exclusionReasons[0] && <small style={{ display: "block", marginTop: 2, color: "var(--neg-fg)" }}>{entry.exclusionReasons[0]}</small>}
                    {entry?.advisoryReasons?.[0] && <small style={{ display: "block", marginTop: 2, color: "var(--warn-fg)" }}>확인 필요 · {entry.advisoryReasons[0]}</small>}
                  </td>
                  <td style={{ padding: 9, fontFamily: "var(--font-mono)" }}>{won(scenario.cost)}</td>
                  <td style={{ padding: 9, fontFamily: "var(--font-mono)", color: profitColor }}>{won(scenario.profit)}</td>
                  <td style={{ padding: 9, fontFamily: "var(--font-mono)" }}>{scenario.irrStatus === "calculated" ? `${scenario.irr.toFixed(1)}%` : "N/A"}</td>
                  <td style={{ padding: 9, fontFamily: "var(--font-mono)" }}>{won(scenario.npv)}</td>
                  <td style={{ padding: 9, fontFamily: "var(--font-mono)", color: afterTaxProfitColor }}>
                    {showAfterTaxMetric && afterTaxEntry?.metrics.afterTaxProfitManwon != null
                      ? won(afterTaxEntry.metrics.afterTaxProfitManwon)
                      : "N/A"}
                  </td>
                  <td style={{ textAlign: "left", padding: 9 }}>
                    <strong style={{ color: afterTaxEntry?.tier === "confirmed" && afterTaxEntry.status === "pareto" ? "var(--pos-fg)" : afterTaxEntry?.status === "ineligible" ? "var(--neg-fg)" : afterTaxEntry?.tier === "preliminary" ? "var(--warn-fg)" : "var(--fg-muted)" }}>
                      {afterTaxRole}
                    </strong>
                    {afterTaxLeaderLabels && <small style={{ display: "block", marginTop: 2, color: "var(--fg-muted)" }}>{afterTaxLeaderLabels}</small>}
                    {afterTaxEntry?.reasons[0] && <small style={{ display: "block", marginTop: 2, color: afterTaxEntry.tier === "unavailable" ? "var(--fg-muted)" : "var(--neg-fg)" }}>{afterTaxEntry.reasons[0]}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function afterTaxObjectiveLabel(
  objective: AfterTaxDecisionObjective,
): string {
  switch (objective) {
    case "after-tax-profit": return "세후 손익 1위";
    case "after-tax-npv": return "세후 NPV 1위";
    case "after-tax-irr": return "세후 IRR 1위";
    case "required-equity": return "자기자본 최소";
    case "max-exposure": return "노출 최소";
    case "duration": return "기간 최소";
    case "regulatory": return "법규 점수 1위";
  }
}

function formatAfterTaxDecisionValue(
  objective: AfterTaxDecisionObjective,
  value: number,
): string {
  if (
    [
      "after-tax-profit",
      "after-tax-npv",
      "required-equity",
      "max-exposure",
    ].includes(objective)
  ) {
    return won(value);
  }
  if (objective === "after-tax-irr") return `${value.toFixed(1)}%`;
  if (objective === "duration") return `${Math.round(value)}개월`;
  return `${value.toFixed(0)}점`;
}

function decisionObjectiveLabel(objective: ScenarioDecisionObjective): string {
  switch (objective) {
    case "profit": return "손익 1위";
    case "downside-profit": return "고원가 방어 1위";
    case "npv": return "NPV 1위";
    case "irr": return "IRR 1위";
    case "required-equity": return "자기자본 최소";
    case "max-exposure": return "노출 최소";
    case "duration": return "기간 최소";
    case "regulatory": return "법규 점수 1위";
  }
}

function formatDecisionValue(
  objective: ScenarioDecisionObjective,
  value: number,
): string {
  if (["profit", "downside-profit", "npv", "required-equity", "max-exposure"].includes(objective)) {
    return won(value);
  }
  if (objective === "irr") return `${value.toFixed(1)}%`;
  if (objective === "duration") return `${Math.round(value)}개월`;
  return `${value.toFixed(0)}점`;
}

function acquisitionMethodLabel(method?: "house-comps" | "by-comps" | "by-publicvalue" | "hybrid") {
  if (method === "house-comps") return "구축 단독·다가구 토지 proxy";
  if (method === "by-comps") return "토지 실거래";
  if (method === "hybrid") return "실거래·공시지가 혼합";
  if (method === "by-publicvalue") return "공시지가 배율";
  return "이전 프로젝트 추정";
}

function confidenceLabel(confidence: "high" | "medium" | "low") {
  return confidence === "high" ? "표본 근거 충분" : confidence === "medium" ? "표본 근거 보통" : "표본 근거 부족";
}

function toneColors(tone: Tone) {
  if (tone === "positive") return { bg: "var(--pos-soft)", fg: "var(--pos-fg)", edge: "var(--pos)" };
  if (tone === "negative") return { bg: "var(--neg-soft)", fg: "var(--neg-fg)", edge: "var(--neg-fg)" };
  if (tone === "review") return { bg: "var(--warn-soft)", fg: "var(--warn-fg)", edge: "var(--warn-fg)" };
  return { bg: "var(--bg-soft)", fg: "var(--fg)", edge: "var(--border)" };
}
