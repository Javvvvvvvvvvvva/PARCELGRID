import { defaultAssumptions } from "@/lib/finance/scenario";
import { hasParcelBoundary } from "@/lib/geo/parcel-topology";
import { quoteAdoptionBusinessDate } from "@/lib/planning/construction-quote-adoption-review";
import { assessFullQuoteAdoption } from "@/lib/planning/full-quote-adoption";
import { validateFullQuoteCostContract } from "@/lib/planning/full-quote-cost-contract";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import type { PlanningScenario } from "@/lib/planning/types";
import {
  canonicalProjectWorkspaceJson,
  type ProjectWorkspacePayload,
} from "./project-workspace";

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalProjectWorkspaceJson(left) === canonicalProjectWorkspaceJson(right);
}

function financialCalculation(scenario: ProjectWorkspacePayload["projectData"]["scenarios"][number] | undefined) {
  if (!scenario) return undefined;
  return {
    ...scenario, name: undefined, shortName: undefined, tag: undefined, recommended: undefined,
    _raw: scenario._raw ? {
      ...scenario._raw, name: undefined, shortName: undefined, tag: undefined,
    } : undefined,
  };
}

function isApplyingAdoption(
  next: ProjectWorkspacePayload,
  previous: ProjectWorkspacePayload | undefined,
  scenario: PlanningScenario,
  prior: PlanningScenario | undefined,
): boolean {
  if (scenario.status === "saved" && prior?.status !== "saved") return true;
  if (scenario.geometrySource?.locked && !prior?.geometrySource?.locked) return true;
  if (next.representativeScenarioId === scenario.id &&
      (previous?.representativeScenarioId !== scenario.id ||
       !sameValue(next.representativeGeometry, previous.representativeGeometry))) return true;
  if (scenario.economicsPreview.status === "estimated" &&
      !sameValue(scenario.economicsPreview, prior?.economicsPreview)) return true;

  const finance = next.projectData.scenarios.find(item => item.id === scenario.id);
  const priorFinance = previous?.projectData.scenarios.find(item => item.id === scenario.id);
  // Display labels and selection can change without recalculating the financial result.
  return finance !== undefined && !sameValue(financialCalculation(finance), financialCalculation(priorFinance));
}

/** Validate live adoption actions under the workspace revision lock, preserving historic drafts. */
export function validateFullQuoteAdoptionTransitions(
  next: ProjectWorkspacePayload,
  previous?: ProjectWorkspacePayload,
  asOf = quoteAdoptionBusinessDate(),
): void {
  const priorScenarios = new Map(previous?.planningScenarios.map(plan => [plan.id, plan]));
  for (const scenario of next.planningScenarios) {
    if (scenario.fullQuoteAdoption === undefined) continue;
    const prior = priorScenarios.get(scenario.id);
    const changed = !sameValue(scenario.fullQuoteAdoption, prior?.fullQuoteAdoption);
    if (!changed && !isApplyingAdoption(next, previous, scenario, prior)) continue;

    const contract = validateFullQuoteCostContract(scenario.fullQuoteAdoption);
    if (changed && contract.adoptedOn !== asOf) {
      throw new Error("전체 견적 채택일은 한국 기준 오늘이어야 합니다.");
    }
    if (contract.adoptedOn > asOf || contract.quote.validUntil < asOf) {
      throw new Error("전체 견적의 유효기간이 지나거나 채택일이 현재보다 늦습니다.");
    }

    const data = next.projectData;
    const parcel = data.parcel;
    const legacy = data.scenarios.find(item => item.recommended)?._raw?.assumptions ??
      data.scenarios[0]?._raw?.assumptions ?? defaultAssumptions();
    const assumptions = planningEconomicsAssumptionsFromLegacy(legacy, `stage2-${data.meta.version}`);
    const inputs = {
      constructionCostPerSqmWon: assumptions.constructionCostPerSqmWon,
      basementCostMultiplier: assumptions.basementCostMultiplier,
    };
    if (!sameValue(contract.inputs, inputs) ||
        !sameValue(contract.quote, scenario.constructionQuote)) {
      throw new Error("전체 견적 채택과 현재 견적·원가 입력이 일치하지 않습니다.");
    }
    if (!hasParcelBoundary(parcel)) {
      throw new Error("전체 견적 채택에는 현재 대지 경계가 필요합니다.");
    }
    // Calculate sunlight from the raw plan before assessing the adoption itself.
    const calculation = calculatePlanningScenario({ ...scenario, fullQuoteAdoption: undefined }, {
      parcel: {
        address: parcel.address,
        zoning: parcel.zoning,
        zoningStatus: parcel.inputProvenance?.zoning === "vworld-land-use"
          ? "public-observation" : "user-entered",
        sunlightRuleAsOf: data.meta.lastSyncedAt?.slice(0, 10),
        lotAreaSqm: parcel.lotArea,
        boundary: parcel.boundary,
        boundaryPolygons: parcel.boundaryPolygons,
        roads: parcel.roads,
        setback: parcel.setback,
        maxFARPct: parcel.maxFAR,
        maxBCRPct: parcel.maxBCR,
        heightLimitM: parcel.heightLimit ?? 0,
        regulatoryConstraints: parcel.regulatoryConstraints,
        roofAllowanceM: 1.4,
        acquisitionCostManwon: parcel.acquiredPrice,
        demolitionCostManwon: parcel.demolitionCost ?? 0,
      },
      assumptions,
      calculatedAt: data.meta.lastSyncedAt,
    });
    const geometry = buildPlanningGeometry({
      projectId: next.projectId,
      scenario,
      boundary: parcel.boundary,
      boundaryPolygons: parcel.boundaryPolygons,
      lotAreaSqm: parcel.lotArea,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
      sunlight: calculation.sunlight,
      roofAllowanceM: calculation.metrics.roofAllowanceM,
      generatedAt: data.meta.lastSyncedAt,
    }).snapshot;
    assessFullQuoteAdoption(scenario, inputs, geometry, asOf);
  }
}
