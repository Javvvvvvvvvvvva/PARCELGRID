import { defaultAssumptions } from "@/lib/finance/scenario";
import { planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import type { PlanningRecommendationEngineInput } from "@/lib/planning/recommendation-engine";
import type { ProjectComputed } from "@/lib/services/compute-project";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().filter((key) => record[key] !== undefined)
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

/** Exact input comparison, not an approval signature. Generation time alone is not an input change. */
export function planningRecommendationInputBasis(input: PlanningRecommendationEngineInput): string {
  const ruleDate = (input.generatedAt ?? new Date().toISOString()).slice(0, 10);
  return JSON.stringify(canonicalize({
    version: "planning-recommendation-input-v5-bounded-search",
    projectId: input.projectId,
    sourceRevision: input.sourceRevision,
    parcel: {
      ...input.parcel,
      parkingRuleAsOf: input.parcel.parkingRuleAsOf ?? ruleDate,
      sunlightRuleAsOf: input.parcel.sunlightRuleAsOf ?? ruleDate,
    },
    assumptions: input.assumptions,
  }));
}

/** Generation and display must use the same parcel, economics and effective rule dates. */
export function planningRecommendationInput(
  data: ProjectComputed,
  projectId: string,
): PlanningRecommendationEngineInput {
  const parcel = data.parcel;
  const legacy = data.scenarios.find((scenario) => scenario.recommended)?._raw.assumptions
    ?? data.scenarios[0]?._raw.assumptions ?? defaultAssumptions();
  const ruleDate = (data.meta.lastSyncedAt || new Date().toISOString()).slice(0, 10);
  return {
    projectId,
    // Workspace autosave revisions are deliberately excluded: saving a recommendation is not a new input.
    sourceRevision: `${data.meta.version}:${data.meta.lastSyncedAt}`,
    parcel: {
      address: parcel.address,
      zoningStatus: parcel.inputProvenance?.zoning === "vworld-land-use"
        ? "public-observation" : "user-entered",
      parkingRuleAsOf: ruleDate,
      sunlightRuleAsOf: ruleDate,
      lotAreaSqm: parcel.lotArea,
      maxFARPct: parcel.maxFAR,
      maxBCRPct: parcel.maxBCR,
      heightLimitM: parcel.heightLimit ?? 0,
      regulatoryConstraints: parcel.regulatoryConstraints,
      roofAllowanceM: 1.4,
      acquisitionCostManwon: parcel.acquiredPrice,
      demolitionCostManwon: parcel.demolitionCost ?? 0,
      boundary: parcel.boundary,
      boundaryPolygons: parcel.boundaryPolygons,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
    },
    assumptions: planningEconomicsAssumptionsFromLegacy(legacy, `stage2-recommend-${data.meta.version}`),
  };
}
