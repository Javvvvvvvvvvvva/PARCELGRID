import { describe, expect, it } from "vitest";
import {
  createRegulatoryReferenceSet,
  replaceConstraintEvidence,
  type RegulatoryConstraintKey,
  type RegulatoryConstraintSet,
} from "@/lib/regulatory/constraints";
import {
  addGuidedGroundFloor,
  guidedFloorArea,
  removeGuidedFloor,
  resizeGuidedFloor,
} from "@/lib/planning/guided-floor-stack";
import {
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";
import type { FloorProgram } from "@/lib/planning/types";

function floor(level: number, areaSqm: number): FloorProgram {
  return createFloorProgram(level, [
    createFloorZone("residential", areaSqm, 1),
  ]);
}

function sourceBacked(
  set: RegulatoryConstraintSet,
  key: RegulatoryConstraintKey,
  value: number
): RegulatoryConstraintSet {
  return {
    ...set,
    [key]: replaceConstraintEvidence(set[key], {
      value,
      status: "source-backed",
      sourceName: "관할 원문",
      sourceRef: "테스트 조문",
      asOf: "2026-07-29",
    }),
  };
}

describe("guided floor stack", () => {
  it("shrinks a new floor to the remaining decision-grade FAR", () => {
    const reference = createRegulatoryReferenceSet({ farPct: 150 });
    const constraints = sourceBacked(reference, "far", 150);
    const floors = [floor(1, 60), floor(2, 60)];

    const result = addGuidedGroundFloor(
      { floorPrograms: floors },
      { lotAreaSqm: 100, regulatoryConstraints: constraints }
    );

    expect(result.status).toBe("adjusted");
    expect(result.floorPrograms).toHaveLength(3);
    expect(guidedFloorArea(result.floorPrograms[2])).toBeCloseTo(30, 5);
  });

  it("blocks a floor above a confirmed floor-count limit", () => {
    const reference = createRegulatoryReferenceSet({ floors: 2 });
    const constraints = sourceBacked(reference, "floors", 2);
    const floors = [floor(1, 50), floor(2, 50)];

    const result = addGuidedGroundFloor(
      { floorPrograms: floors },
      { lotAreaSqm: 100, regulatoryConstraints: constraints }
    );

    expect(result.status).toBe("blocked");
    expect(result.floorPrograms).toBe(floors);
    expect(result.message).toContain("확인된 층수 한도");
  });

  it("does not hard-block against a reference-only FAR", () => {
    const constraints = createRegulatoryReferenceSet({ farPct: 150 });
    const floors = [floor(1, 60), floor(2, 60)];

    const result = addGuidedGroundFloor(
      { floorPrograms: floors },
      { lotAreaSqm: 100, regulatoryConstraints: constraints }
    );

    expect(result.status).toBe("applied");
    expect(guidedFloorArea(result.floorPrograms[2])).toBeCloseTo(60, 5);
    expect(result.message).toContain("미확정 규제");
  });

  it("caps floor resizing at the confirmed building-coverage limit", () => {
    const reference = createRegulatoryReferenceSet({
      farPct: 250,
      bcrPct: 50,
    });
    const withFar = sourceBacked(reference, "far", 250);
    const constraints = sourceBacked(withFar, "bcr", 50);
    const floors = [floor(1, 40)];

    const result = resizeGuidedFloor(
      { floorPrograms: floors },
      { lotAreaSqm: 100, regulatoryConstraints: constraints },
      floors[0].id,
      2
    );

    expect(result.status).toBe("adjusted");
    expect(guidedFloorArea(result.floorPrograms[0])).toBeCloseTo(50, 5);
  });

  it("keeps at least one floor in every plan", () => {
    const floors = [floor(1, 40)];
    const result = removeGuidedFloor(
      { floorPrograms: floors },
      floors[0].id
    );

    expect(result.status).toBe("blocked");
    expect(result.floorPrograms).toBe(floors);
  });
});
