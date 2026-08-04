import { defaultAssumptions } from "@/lib/finance/scenario";
import { estimateSalePriceFromComps } from "@/lib/finance/sale-price-from-comps";
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
  options: ComputeOptions = {}
): ProjectComputed | null {
  const candidates = eligibleScenarios(planningScenarios, representativeId);
  if (!candidates.some((scenario) => scenario.id === representativeId)) return null;

  const assumptions = cloneAssumptions(previous);
  const saleEstimate = estimateSalePriceFromComps(previous?.comps ?? []);
  if (saleEstimate) {
    assumptions.salePricePerSqM = saleEstimate.salePricePerSqM;
  }

  const planningAssumptions = planningEconomicsAssumptionsFromLegacy(
    assumptions,
    `stage2-representative-${representativeId}`
  );
  const calculationContext = {
    parcel: {
      lotAreaSqm: parcel.lotArea,
      maxFARPct: parcel.maxFAR,
      maxBCRPct: parcel.maxBCR,
      heightLimitM: parcel.heightLimit ?? 0,
      acquisitionCostManwon: parcel.acquiredPrice,
      demolitionCostManwon: parcel.demolitionCost ?? 0,
    },
    assumptions: planningAssumptions,
    calculatedAt: previous?.meta.lastSyncedAt,
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
      program: planningScenarioToBuildingProgram(planningScenario, calculation),
      assumptions: scenarioAssumptions,
    };
  });

  const computed = computeProject(parcel, financeScenarios, {
    calculateMaxAcquisition: true,
    ...options,
    recommendedId: representativeId,
  });

  return {
    ...computed,
    comps: previous?.comps ?? [],
    saleEstimate: saleEstimate ?? previous?.saleEstimate,
    // 구형 Envelope 권장/최대 비교는 새 PlanningScenario 대표안과 기준이 다르다.
    scenarioComparison: undefined,
  };
}
