import { describe, expect, it } from "vitest";
import { assessConstructionQuote, constructionQuoteBasis } from "@/lib/planning/construction-quote";
import { evaluateConstructionQuoteCostComparison } from "@/lib/planning/construction-quote-cost-comparison";
import { DEFAULT_DWELLING_PROGRAM } from "@/lib/planning/dwelling-program";
import { createDefaultPlanningMaterials } from "@/lib/planning/materials";
import { createQuantityCostDraft, evaluateQuantityCost } from "@/lib/planning/quantity-cost";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";

function allocatedFixture() {
  const f = constructionQuoteFixture();
  f.quote.lines[0].allocations = f.quote.coverage
    .filter(scope => scope.lineIds.includes("package"))
    .map(scope => ({ scopeId: scope.id, amountWon: 100_000, source: "Synthetic package allocation" }));
  expect(f.quote.lines[0].allocations).toHaveLength(10);
  return f;
}

function refreshQuoteBasis(f: ReturnType<typeof allocatedFixture>) {
  f.quote.sourceBasis = constructionQuoteBasis(f.scenario, f.inputs);
}

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

describe("independent complete-cost comparison invariants", () => {
  it.each(["materials", "dwellingProgram"] as const)("blocks unsupported cost fields in %s", field => {
    const f = allocatedFixture();
    if (field === "materials") {
      f.scenario.materials = { ...createDefaultPlanningMaterials(), primaryFacadeMaterial: "brick-veneer",
        facadeAreaOverrideSqm: 100, baselineFacadeUnitCostPerSqmWon: 100_000,
        selectedFacadeUnitCostPerSqmWon: 90_000 };
      Object.assign(f.scenario.materials, { additionalFacadeCostWon: 50_000_000 });
    } else {
      f.scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0,
        additionalDwellingCostWon: 100_000 };
      Object.assign(f.scenario.dwellingProgram, { additionalDwellingCostMultiplier: 2 });
    }
    refreshQuoteBasis(f);
    expect(assessConstructionQuote(f.scenario, f.inputs).status).toBe("ready");
    const comparison = evaluateConstructionQuoteCostComparison(f.scenario, f.inputs);
    expect(comparison.status).toBe("conflict");
    expect(comparison.currentConstructionCostWon).toBeNull();
    expect(comparison.differenceWon).toBeNull();
  });

  it("matches Stage 2 with simultaneous material credit, dwelling premium and quantity credit without mutation", () => {
    const f = allocatedFixture();
    f.scenario.materials = { ...createDefaultPlanningMaterials(), primaryFacadeMaterial: "brick-veneer",
      facadeAreaOverrideSqm: 100, baselineFacadeUnitCostPerSqmWon: 100_000,
      selectedFacadeUnitCostPerSqmWon: 90_000, rateEvidence: {
        status: "source-backed", sourceName: "Synthetic rate evidence", sourceUrl: "https://example.com/rates",
        observedAt: "2026-11-01", note: "Synthetic metadata; not authentic source evidence",
      } };
    f.scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0,
      additionalDwellingCostWon: 100_000, costSource: "Synthetic dwelling cost source",
      salePriceBands: [{ minExclusiveSqm: 0, maxExclusiveSqm: null, unitPriceWon: 1_000_000,
        source: "Synthetic sale metadata unrelated to hard cost" }] };
    const quantity = createQuantityCostDraft(f.scenario, f.inputs);
    for (const line of quantity.lines) Object.assign(line, { treatment: "included", scopeConfirmed: true,
      source: "Synthetic base allowance" });
    Object.assign(quantity.lines.find(line => line.id === "entryDoorCount")!, {
      treatment: "replace-allowance", unitRateWon: 100_000, includedAllowanceWon: 500_000,
      allowanceSource: "Synthetic same-scope base allowance",
    });
    f.scenario.quantityCost = quantity;
    refreshQuoteBasis(f);
    expect(evaluateQuantityCost(f.scenario, f.inputs).status).toBe("ready");
    const assumptions = planningEconomicsAssumptionsFromLegacy(f.data.scenarios[0]._raw.assumptions, "invariant");
    const stage2 = calculatePlanningScenario(f.scenario, {
      assumptions,
      parcel: { address: "Synthetic verification parcel", lotAreaSqm: 900, maxFARPct: 200, maxBCRPct: 60,
        heightLimitM: 30, acquisitionCostManwon: 50000, demolitionCostManwon: 1000,
        parkingRuleAsOf: "2026-10-24" },
    });
    const before = structuredClone({ scenario: f.scenario, inputs: f.inputs });
    freeze(f.scenario); freeze(f.inputs);
    const comparison = evaluateConstructionQuoteCostComparison(f.scenario, f.inputs);
    expect(comparison.status).toBe("ready");
    expect(comparison.materialAdjustmentWon).toBe(-1_000_000);
    expect(comparison.additionalDwellingCostWon).toBe(200_000);
    expect(comparison.quantityAdjustmentWon).toBe(-100_000);
    expect(comparison.currentConstructionCostWon).toBe(stage2.economicsPreview.constructionCostManwon * 10_000);
    expect(comparison.differenceWon).toBeCloseTo(comparison.quoteConstructionCostWon! - comparison.currentConstructionCostWon!, 5);
    expect({ scenario: f.scenario, inputs: f.inputs }).toEqual(before);
    expect(comparison.financialApplied).toBe(false);
    expect(comparison.approvalStatus).toBe("unverified");
  });

  it.each(["materials", "dwellingProgram", "quantityCost"] as const)("keeps explicit null %s unknown instead of zero", field => {
    const f = allocatedFixture();
    Object.assign(f.scenario, { [field]: null });
    refreshQuoteBasis(f);
    const comparison = evaluateConstructionQuoteCostComparison(f.scenario, f.inputs);
    expect(comparison.status).toBe("conflict");
    expect(comparison.currentConstructionCostWon).toBeNull();
    expect(comparison.differenceWon).toBeNull();
  });
});
