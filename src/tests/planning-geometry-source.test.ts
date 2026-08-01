import { describe, expect, it } from "vitest";
import {
  isPlanningGeometryLocked,
  protectLockedPlanningGeometryPatch,
  resolvePlanningGeometrySource,
} from "@/lib/planning/geometry-source";
import {
  clonePlanningScenario,
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

describe("Planning Geometry Source", () => {
  it("resolves legacy scenarios as editable exact engine geometry", () => {
    const scenario = createBlankPlanningScenario();
    delete scenario.geometrySource;

    expect(resolvePlanningGeometrySource(scenario)).toEqual({
      mode: "engine-generated",
      exactGeometryAvailable: true,
      locked: false,
    });
    expect(isPlanningGeometryLocked(scenario)).toBe(false);
  });

  it("blocks geometry mutations in locked scenario patches", () => {
    const scenario = createBlankPlanningScenario();
    scenario.geometrySource = {
      mode: "engine-generated",
      exactGeometryAvailable: true,
      locked: true,
      lockedGeometryHash: "pg-geometry-1",
    };
    const nextFloor = createFloorProgram(2, [
      createFloorZone("residential", 30, 1),
    ]);
    const patch = protectLockedPlanningGeometryPatch(scenario, {
      name: "재료만 검토",
      primaryUse: "office" as const,
      floorPrograms: [...scenario.floorPrograms, nextFloor],
      placement: { ...scenario.placement, rotationDeg: 45 },
      parking: { ...scenario.parking, strategy: "surface" as const },
    });

    expect(patch.name).toBe("재료만 검토");
    expect(patch.primaryUse).toBeUndefined();
    expect(patch.floorPrograms).toBeUndefined();
    expect(patch.placement).toBeUndefined();
    expect(patch.parking).toBeUndefined();
  });

  it("duplicates a locked scenario as an explicitly editable plan", () => {
    const scenario = createBlankPlanningScenario();
    scenario.geometrySource = {
      mode: "engine-generated",
      exactGeometryAvailable: true,
      locked: true,
      lockedGeometryHash: "pg-geometry-1",
      lockedAt: "2026-07-31T00:00:00.000Z",
    };

    const copy = clonePlanningScenario(scenario);

    expect(copy.geometrySource?.locked).toBe(false);
    expect(copy.geometrySource?.lockedGeometryHash).toBeUndefined();
    expect(copy.geometrySource?.lockedAt).toBeUndefined();
  });
});
