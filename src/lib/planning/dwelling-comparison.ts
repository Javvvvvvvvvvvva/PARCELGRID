import { dwellingProgramSummary } from "@/lib/planning/dwelling-program";
import { calculatePlanningScenario } from "@/lib/planning/scenario-calculator";
import type { PlanningRecommendationEngineInput, RecommendationCandidateEvaluation } from "@/lib/planning/recommendation-engine";
import type { PlanningScenario } from "@/lib/planning/types";

/** One best preliminary candidate per count / floor / mix / parking family. Not a global optimum. */
export function dwellingComparisonCandidates(evaluations: RecommendationCandidateEvaluation[]) {
  const groups = new Map<string, RecommendationCandidateEvaluation>();
  for (const candidate of evaluations) {
    if (!candidate.scenario.dwellingProgram) continue;
    const summary = dwellingProgramSummary(candidate.scenario.floorPrograms);
    const residentialFloors = candidate.scenario.floorPrograms.filter((floor) => floor.zones.some((z) => z.useType === "residential")).length;
    const mixed = summary.maxExclusiveSqm - summary.minExclusiveSqm > 1;
    const key = `${summary.unitCount}:${residentialFloors}:${mixed}:${candidate.scenario.parking.strategy}`;
    const current = groups.get(key);
    if (!current || Number(candidate.eligible) > Number(current.eligible) ||
        (candidate.eligible === current.eligible && (candidate.geometryFailCount < current.geometryFailCount ||
          (candidate.geometryFailCount === current.geometryFailCount && candidate.calculation.economicsPreview.profitManwon > current.calculation.economicsPreview.profitManwon)))) {
      groups.set(key, candidate);
    }
  }
  return [...groups.values()].sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) || b.calculation.economicsPreview.profitManwon - a.calculation.economicsPreview.profitManwon);
}

export function dwellingSensitivity(scenario: PlanningScenario, input: PlanningRecommendationEngineInput, saleChangePct: number, costChangePct: number) {
  const saleFactor = 1 + saleChangePct / 100;
  const costFactor = 1 + costChangePct / 100;
  if (![saleFactor, costFactor].every((n) => Number.isFinite(n) && n > 0)) throw new Error("유효하지 않은 민감도 범위입니다.");
  // Resolve scoped observed prices first; stress the adopted contract, not its source observations.
  const pricing = calculatePlanningScenario(scenario, { parcel: input.parcel, assumptions: input.assumptions }).revenueProjection.pricing;
  const residentialSale = pricing?.pools.residentialSale;
  return calculatePlanningScenario({
    ...scenario,
    materials: scenario.materials ? {
      ...scenario.materials,
      baselineFacadeUnitCostPerSqmWon: scenario.materials.baselineFacadeUnitCostPerSqmWon == null ? undefined : scenario.materials.baselineFacadeUnitCostPerSqmWon * costFactor,
      selectedFacadeUnitCostPerSqmWon: scenario.materials.selectedFacadeUnitCostPerSqmWon == null ? undefined : scenario.materials.selectedFacadeUnitCostPerSqmWon * costFactor,
    } : undefined,
    dwellingProgram: scenario.dwellingProgram ? {
      ...scenario.dwellingProgram,
      additionalDwellingCostWon: scenario.dwellingProgram.additionalDwellingCostWon * costFactor,
      salePriceBands: undefined,
    } : undefined,
  }, {
    parcel: input.parcel,
    assumptions: {
      ...input.assumptions,
      constructionCostPerSqmWon: input.assumptions.constructionCostPerSqmWon * costFactor,
      residentialSalePricePerSqmWon: input.assumptions.residentialSalePricePerSqmWon * saleFactor,
      revenuePricing: pricing && residentialSale ? { ...pricing, pools: { ...pricing.pools, residentialSale: {
        ...residentialSale,
        baseUnitPriceWon: residentialSale.baseUnitPriceWon == null ? undefined : residentialSale.baseUnitPriceWon * saleFactor,
        unitPriceWon: residentialSale.unitPriceWon * saleFactor,
      } } } : undefined,
    },
  }).economicsPreview;
}
