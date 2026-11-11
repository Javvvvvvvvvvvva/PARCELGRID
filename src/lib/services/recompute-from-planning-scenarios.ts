import { defaultAssumptions } from "@/lib/finance/scenario";
import { transactionEvidenceComplete } from "@/lib/integrations/molit-evidence";
import { estimateSalePriceFromComps } from "@/lib/finance/sale-price-from-comps";
import {
  applyRevenuePricingSourceRecords,
  validateFinancialSource,
  type FinancialSourceMap,
} from "@/lib/finance/source-data-gate";
import { revenuePoolForPriceSourceField } from "@/lib/finance/revenue-contract";
import type { AssumptionSet, Parcel, Scenario } from "@/lib/finance/types";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import type { PlanningScenario } from "@/lib/planning/types";
import {
  computeProject,
  type ComputeOptions,
  type ProjectComputed,
} from "@/lib/services/compute-project";

export interface RecomputePlanningOptions extends ComputeOptions {
  /** 잠긴 대표 Geometry와 금융 면적 계약을 연결한다. */
  geometryHashes?: Record<string, string | undefined>;
  financialSources?: FinancialSourceMap;
}

function applyCurrentFinancialSources(
  parcel: Parcel,
  assumptions: AssumptionSet,
  sources: FinancialSourceMap | undefined,
): { parcel: Parcel; assumptions: AssumptionSet } {
  if (!sources) return { parcel, assumptions };
  const nextParcel = { ...parcel };
  const nextAssumptions = { ...assumptions };
  for (const [field, record] of Object.entries(sources)) {
    if (!record || !validateFinancialSource(record).valid) continue;
    if (field === "acquisitionPrice") {
      nextParcel.acquiredPrice = record.value;
      continue;
    }
    if (revenuePoolForPriceSourceField(field)) continue;
    nextAssumptions[field as keyof AssumptionSet] = record.value;
  }
  return { parcel: nextParcel, assumptions: nextAssumptions };
}

function cloneAssumptions(previous: ProjectComputed | null): AssumptionSet {
  const source =
    previous?.scenarios.find((scenario) => scenario.recommended)?._raw.assumptions ??
    previous?.scenarios[0]?._raw.assumptions ??
    defaultAssumptions();
  return { ...source };
}

function eligibleScenarios(
  scenarios: PlanningScenario[],
  representativeId: string
): PlanningScenario[] {
  const eligible = scenarios.filter(
    (scenario) => scenario.id === representativeId || scenario.status === "saved"
  );
  return [...eligible].sort((a, b) => {
    if (a.id === representativeId) return -1;
    if (b.id === representativeId) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/**
 * Stage 2의 저장 계획안을 금융 엔진 시나리오로 재계산한다.
 *
 * 대표 계획안은 recommended 시나리오가 되며, 같은 프로젝트의 저장된 다른
 * 계획안은 비교 시나리오로 유지한다. 기존 실거래·매각단가 근거는 보존한다.
 */
export function recomputeFromPlanningScenarios(
  parcel: Parcel,
  planningScenarios: PlanningScenario[],
  representativeId: string,
  previous: ProjectComputed | null,
  options: RecomputePlanningOptions = {}
): ProjectComputed | null {
  const candidates = eligibleScenarios(planningScenarios, representativeId);
  if (!candidates.some((scenario) => scenario.id === representativeId)) return null;

  const baseAssumptions = cloneAssumptions(previous);
  const saleEstimate = estimateSalePriceFromComps(transactionEvidenceComplete(previous?.transactionEvidence?.filter(item => item.type === "house")) ? previous?.comps ?? [] : []);
  if (saleEstimate) {
    baseAssumptions.salePricePerSqM = saleEstimate.salePricePerSqM;
  }
  const sourced = applyCurrentFinancialSources(
    parcel,
    baseAssumptions,
    options.financialSources,
  );
  const effectiveParcel = sourced.parcel;
  const assumptions = sourced.assumptions;

  const planningAssumptions = planningEconomicsAssumptionsFromLegacy(
    assumptions,
    `stage2-representative-${representativeId}`
  );
  if (planningAssumptions.revenuePricing) {
    planningAssumptions.revenuePricing = applyRevenuePricingSourceRecords(
      planningAssumptions.revenuePricing,
      options.financialSources,
    );
  }
  const calculationContext = {
    parcel: {
      address: effectiveParcel.address,
      zoning: effectiveParcel.zoning,
      zoningStatus:
        effectiveParcel.inputProvenance?.zoning === "vworld-land-use"
          ? ("public-observation" as const)
          : ("user-entered" as const),
      sunlightRuleAsOf: previous?.meta.lastSyncedAt?.slice(0, 10),
      lotAreaSqm: effectiveParcel.lotArea,
      maxFARPct: effectiveParcel.maxFAR,
      maxBCRPct: effectiveParcel.maxBCR,
      heightLimitM: effectiveParcel.heightLimit ?? 0,
      regulatoryConstraints: effectiveParcel.regulatoryConstraints,
      roofAllowanceM: 1.4,
      acquisitionCostManwon: effectiveParcel.acquiredPrice,
      demolitionCostManwon: effectiveParcel.demolitionCost ?? 0,
    },
    assumptions: planningAssumptions,
    calculatedAt: previous?.meta.lastSyncedAt,
  };
  const { geometryHashes } = options;
  const computeOptions: ComputeOptions = {
    startDate: options.startDate,
    recommendedId: options.recommendedId,
    transactions: options.transactions,
    parcelDong: options.parcelDong,
    calculateMaxAcquisition: options.calculateMaxAcquisition,
  };

  const financeScenarios: Scenario[] = candidates.map((planningScenario) => {
    const calculation = calculatePlanningScenario(
      planningScenario,
      calculationContext
    );
    const scenarioAssumptions: AssumptionSet = { ...assumptions };

    return {
      id: planningScenario.id,
      name: planningScenario.name,
      shortName: planningScenario.name,
      tag:
        planningScenario.id === representativeId
          ? "대표 계획안"
          : "저장 계획안",
      program: planningScenarioToBuildingProgram(planningScenario, calculation, {
        geometryHash: geometryHashes?.[planningScenario.id],
      }),
      assumptions: scenarioAssumptions,
      revenuePricing: calculation.revenueProjection.pricing,
    };
  });

  const computed = computeProject(effectiveParcel, financeScenarios, {
    calculateMaxAcquisition: true,
    ...computeOptions,
    recommendedId: representativeId,
  });

  return {
    ...computed,
    comps: previous?.comps ?? [],
    transactionEvidence: previous?.transactionEvidence,
    dwellingMarket: previous?.dwellingMarket,
    saleEstimate: saleEstimate ?? undefined,
    // 구형 Envelope 권장/최대 비교는 새 PlanningScenario 대표안과 기준이 다르다.
    scenarioComparison: undefined,
  };
}
