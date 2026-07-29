import { describe, expect, it } from "vitest";
import {
  calculatePlanningMaterialAdjustment,
  estimatePlanningFacadeArea,
} from "@/lib/planning/materials";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

function makeScenario() {
  const scenario = createBlankPlanningScenario();
  scenario.floorPrograms = [
    createFloorProgram(1, [createFloorZone("residential", 100, 1)], 3),
    createFloorProgram(2, [createFloorZone("residential", 100, 1)], 3),
  ];
  return scenario;
}

describe("planning materials", () => {
  it("estimates net facade area from floor area, height, and window ratio", () => {
    const scenario = makeScenario();
    scenario.materials = {
      primaryFacadeMaterial: "brick-veneer",
      secondaryFacadeMaterial: "exposed-concrete",
      primaryFacadeSharePct: 75,
      windowRatioPct: 25,
      rateEvidence: { status: "unpriced" },
    };

    const area = estimatePlanningFacadeArea(scenario);

    expect(area.basis).toBe("area-based-estimate");
    expect(area.grossFacadeAreaSqm).toBeCloseTo(240);
    expect(area.netFacadeAreaSqm).toBeCloseTo(180);
  });

  it("does not invent a material cost when rates are missing", () => {
    const scenario = makeScenario();
    scenario.materials = {
      primaryFacadeMaterial: "brick-veneer",
      secondaryFacadeMaterial: "exposed-concrete",
      primaryFacadeSharePct: 75,
      windowRatioPct: 25,
      rateEvidence: { status: "unpriced" },
    };

    const result = calculatePlanningMaterialAdjustment(scenario);

    expect(result.priced).toBe(false);
    expect(result.adjustmentManwon).toBe(0);
  });

  it("calculates only the delta from the baseline facade rate", () => {
    const scenario = makeScenario();
    scenario.materials = {
      primaryFacadeMaterial: "brick-veneer",
      secondaryFacadeMaterial: "exposed-concrete",
      primaryFacadeSharePct: 75,
      windowRatioPct: 25,
      facadeAreaOverrideSqm: 200,
      baselineFacadeUnitCostPerSqmWon: 100_000,
      selectedFacadeUnitCostPerSqmWon: 150_000,
      rateEvidence: {
        status: "source-backed",
        sourceName: "시공사 견적",
      },
    };

    const result = calculatePlanningMaterialAdjustment(scenario);

    expect(result.priced).toBe(true);
    expect(result.areaBasis).toBe("user-input");
    expect(result.adjustmentManwon).toBe(1_000);
    expect(result.sourceLabel).toBe("시공사 견적");
  });
});
