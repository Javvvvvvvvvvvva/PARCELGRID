import { describe, expect, it } from "vitest";
import {
  addBasementFloor,
  addGroundFloor,
  addZoneToFloor,
  duplicateFloorProgram,
  removeFloorProgram,
  updateFloorProgram,
  updateFloorZone,
} from "@/lib/planning/floor-program-editor";
import {
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

function starterFloors() {
  return [
    createFloorProgram(1, [createFloorZone("retail", 40, 1)]),
    createFloorProgram(2, [createFloorZone("residential", 60, 2)]),
  ];
}

describe("Stage 2 floor program editor", () => {
  it("adds and duplicates floors with unique identifiers", () => {
    const initial = starterFloors();
    const withThird = addGroundFloor(initial);
    const duplicated = duplicateFloorProgram(withThird, initial[0].id);
    const withBasement = addBasementFloor(duplicated);

    expect(withThird.some((floor) => floor.level === 3)).toBe(true);
    expect(duplicated.some((floor) => floor.level === 4)).toBe(true);
    expect(withBasement.some((floor) => floor.level === -1)).toBe(true);
    expect(new Set(withBasement.map((floor) => floor.id)).size).toBe(
      withBasement.length
    );
    expect(
      new Set(withBasement.flatMap((floor) => floor.zones.map((zone) => zone.id))).size
    ).toBe(withBasement.flatMap((floor) => floor.zones).length);
  });

  it("updates floor settings and zone programs immutably", () => {
    const initial = starterFloors();
    const floorId = initial[0].id;
    const zoneId = initial[0].zones[0].id;
    const floorUpdated = updateFloorProgram(initial, floorId, {
      floorHeightM: 4.2,
    });
    const zoneUpdated = updateFloorZone(floorUpdated, floorId, zoneId, {
      useType: "residential",
      areaSqm: 55,
      unitCount: 2,
      revenueModel: "sale",
    });

    expect(initial[0].floorHeightM).not.toBe(4.2);
    expect(zoneUpdated[0].floorHeightM).toBe(4.2);
    expect(zoneUpdated[0].zones[0]).toMatchObject({
      useType: "residential",
      areaSqm: 55,
      unitCount: 2,
      revenueModel: "sale",
    });
  });

  it("adds zones and prevents deleting the final remaining floor", () => {
    const single = [createFloorProgram(1, [createFloorZone("residential", 40, 1)])];
    const withZone = addZoneToFloor(single, single[0].id, "common");
    const stillOne = removeFloorProgram(withZone, withZone[0].id);

    expect(withZone[0].zones).toHaveLength(2);
    expect(withZone[0].zones[1].useType).toBe("common");
    expect(stillOne).toHaveLength(1);
  });
});
