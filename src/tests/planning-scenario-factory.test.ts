import { describe, expect, it } from "vitest";
import {
  createBlankScenarioForParcel,
  createStarterPlanningScenario,
  type PlanningScenarioParcelSeed,
} from "@/lib/planning/scenario-factory";

const parcel: PlanningScenarioParcelSeed = {
  lotAreaSqm: 120,
  maxFARPct: 200,
  maxBCRPct: 60,
  acquisitionCostManwon: 50_000,
  demolitionCostManwon: 1_000,
};

describe("Stage 2 scenario factory", () => {
  it("creates a parcel-sized, project-scoped blank plan", () => {
    const scenario = createBlankScenarioForParcel(parcel, "직접 설계안", "project-a");
    const floorArea = scenario.floorPrograms[0].zones[0].areaSqm;

    expect(scenario.projectId).toBe("project-a");
    expect(scenario.name).toBe("직접 설계안");
    expect(scenario.origin).toBe("custom");
    expect(floorArea).toBe(48);
    expect(floorArea).toBeLessThanOrEqual(72);
    expect(scenario.economicsPreview.acquisitionCostManwon).toBe(50_000);
    expect(scenario.economicsPreview.demolitionCostManwon).toBe(1_000);
  });

  it("migrates the legacy aggregate input into floor-by-floor programs", () => {
    const scenario = createStarterPlanningScenario(
      parcel,
      {
        farPct: 150,
        scenarioType: "multi-family",
        floors: 3,
        units: 5,
        unitAreaSqm: 40,
        avgUnitAreaSqm: 36,
        requiredCars: 3,
      },
      "project-a"
    );

    expect(scenario.projectId).toBe("project-a");
    expect(scenario.origin).toBe("legacy");
    expect(scenario.floorPrograms).toHaveLength(3);
    expect(scenario.floorPrograms.map((floor) => floor.level)).toEqual([1, 2, 3]);
    expect(
      scenario.floorPrograms.reduce(
        (sum, floor) => sum + floor.zones.reduce((zoneSum, zone) => zoneSum + zone.unitCount, 0),
        0
      )
    ).toBe(5);
    expect(scenario.floorPrograms[0].zones[0].areaSqm).toBe(60);
    expect(scenario.parking.providedCars).toBe(3);
  });
});
