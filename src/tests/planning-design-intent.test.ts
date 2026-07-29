import { describe, expect, it } from "vitest";
import { buildPlanningDesignIntent } from "@/lib/planning/design-intent";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";

describe("Planning Design Intent", () => {
  it("exports geometry locks and material evidence without calling an AI model", () => {
    const scenario = createBlankPlanningScenario({
      projectId: "PROJECT-1",
      name: "테스트 계획안",
    });
    scenario.materials = {
      primaryFacadeMaterial: "brick-veneer",
      secondaryFacadeMaterial: "exposed-concrete",
      primaryFacadeSharePct: 75,
      windowRatioPct: 25,
      facadeAreaOverrideSqm: 100,
      baselineFacadeUnitCostPerSqmWon: 100_000,
      selectedFacadeUnitCostPerSqmWon: 120_000,
      rateEvidence: {
        status: "source-backed",
        sourceName: "견적서 A",
        observedAt: "2026-07-29",
      },
    };

    const intent = buildPlanningDesignIntent(scenario, {
      projectId: "PROJECT-1",
      address: "서울 테스트",
      parcelAreaSqm: 100,
      maxBuildingCoveragePct: 60,
      maxFloorAreaRatioPct: 200,
    });

    expect(intent.geometryLock.referenceImageRequired).toBe(true);
    expect(intent.materials.primaryFacade).toBe("brick-veneer");
    expect(intent.materials.primaryFacadeSharePct).toBe(75);
    expect(intent.costEvidence.materialAdjustmentManwon).toBe(200);
    expect(intent.costEvidence.sourceLabel).toBe("견적서 A");
    expect(intent.generationInstruction.conceptOnly).toBe(true);
  });
});
