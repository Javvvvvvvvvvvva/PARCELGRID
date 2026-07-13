import { describe, expect, it } from "vitest";
import {
  clonePlanningScenario,
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
  summarizePlanningScenario,
  touchPlanningScenario,
} from "@/lib/planning/scenario-utils";

describe("Stage 2 planning scenarios", () => {
  it("summarizes a mixed-use floor-by-floor plan", () => {
    const scenario = createBlankPlanningScenario({ name: "상가 + 주거안" });
    scenario.floorPrograms = [
      createFloorProgram(1, [
        createFloorZone("retail", 45, 0),
        createFloorZone("common", 12, 0),
      ]),
      createFloorProgram(2, [createFloorZone("residential", 72, 2)]),
      createFloorProgram(3, [createFloorZone("residential", 50, 1)]),
      createFloorProgram(-1, [
        createFloorZone("parking", 80, 0),
        createFloorZone("storage", 10, 0),
      ]),
    ];
    scenario.parking = { strategy: "basement", providedCars: 2 };

    const summary = summarizePlanningScenario(scenario);

    expect(summary.aboveGroundFloors).toBe(3);
    expect(summary.undergroundFloors).toBe(1);
    expect(summary.unitCount).toBe(3);
    expect(summary.residentialAreaSqm).toBe(122);
    expect(summary.commercialAreaSqm).toBe(45);
    expect(summary.parkingAreaSqm).toBe(80);
    expect(summary.commonAreaSqm).toBe(22);
    expect(summary.gradeFootprintAreaSqm).toBe(57);
    expect(summary.totalProgramAreaSqm).toBe(269);
    expect(summary.providedCars).toBe(2);
  });

  it("clones a scenario without sharing floor or zone identifiers", () => {
    const source = createBlankPlanningScenario({ name: "균형 추천안" });
    source.economicsPreview = {
      ...source.economicsPreview,
      status: "estimated",
      calculatedAt: "2026-07-12T00:00:00.000Z",
    };

    const copy = clonePlanningScenario(source, "내 계획 A");

    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("내 계획 A");
    expect(copy.baseScenarioId).toBe(source.id);
    expect(copy.origin).toBe("custom");
    expect(copy.floorPrograms[0].id).not.toBe(source.floorPrograms[0].id);
    expect(copy.floorPrograms[0].zones[0].id).not.toBe(
      source.floorPrograms[0].zones[0].id
    );
    expect(copy.economicsPreview.status).toBe("stale");
    expect(copy.economicsPreview.calculatedAt).toBeUndefined();
  });

  it("increments the version whenever a saved plan is edited", () => {
    const scenario = createBlankPlanningScenario({ name: "초안" });
    const updated = touchPlanningScenario(scenario, {
      name: "수정안",
      status: "saved",
    });

    expect(updated.id).toBe(scenario.id);
    expect(updated.createdAt).toBe(scenario.createdAt);
    expect(updated.name).toBe("수정안");
    expect(updated.status).toBe("saved");
    expect(updated.version).toBe(scenario.version + 1);
  });
});
