import { constructionQuoteFixture } from "./construction-quote-fixture";
import { createQuoteAdoptionReviewDraft } from "@/lib/planning/construction-quote-adoption-review";
import { applyFullQuoteAdoption } from "@/lib/planning/full-quote-adoption";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy, type PlanningCalculationContext } from "@/lib/planning/scenario-calculator";

export function fullQuoteAdoptionFixture(asOf = "2026-11-11") {
  const f = constructionQuoteFixture(), parcel = f.data.parcel;
  const context: PlanningCalculationContext = {
    parcel: { address: parcel.address, lotAreaSqm: parcel.lotArea, maxFARPct: parcel.maxFAR, maxBCRPct: parcel.maxBCR,
      heightLimitM: parcel.heightLimit, boundary: parcel.boundary, boundaryPolygons: parcel.boundaryPolygons,
      roads: parcel.roads, setback: parcel.setback, zoning: parcel.zoning,
      acquisitionCostManwon: parcel.acquiredPrice, demolitionCostManwon: parcel.demolitionCost ?? 0 },
    assumptions: planningEconomicsAssumptionsFromLegacy(f.data.scenarios[0]._raw.assumptions, "quote-adoption-fixture"),
    calculatedAt: `${asOf}T00:00:00.000Z`,
  };
  f.quote.lines[0].allocations = f.quote.coverage.filter(scope => scope.lineIds.includes("package"))
    .map(scope => ({ scopeId: scope.id, amountWon: 100000, source: `Synthetic allocation ${scope.id}` }));
  const before = calculatePlanningScenario(f.scenario, context);
  f.scenario.economicsPreview = before.economicsPreview;
  const geometry = buildPlanningGeometry({ projectId: f.projectId, scenario: f.scenario,
    boundary: parcel.boundary, boundaryPolygons: parcel.boundaryPolygons, roads: parcel.roads,
    setback: parcel.setback, lotAreaSqm: parcel.lotArea, zoning: parcel.zoning,
    sunlight: before.sunlight, generatedAt: context.calculatedAt }).snapshot;
  const draft = createQuoteAdoptionReviewDraft(f.scenario, f.inputs, geometry);
  draft.checkedOn = asOf;
  draft.scopes.forEach(scope => { scope.confirmed = true; scope.source = "Synthetic scope p3; not actual evidence"; });
  const patch = applyFullQuoteAdoption(f.scenario, f.inputs, geometry, draft, asOf);
  return { ...f, context, geometry, draft, patch, before, adopted: { ...f.scenario, ...patch } };
}
