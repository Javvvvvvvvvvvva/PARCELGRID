import { defaultAssumptions } from "@/lib/finance/scenario";
import { DEFAULT_INTERIOR_SETTINGS, generateInteriorDraft } from "@/lib/planning/interior-layout";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { generateRoomLayout } from "@/lib/planning/room-layout";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/planning/room-layout-schema";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { DEMO_PARCEL } from "@/lib/seed/demo-project";

/** Scale/serialization evidence only. This stack is not a legally permissible design. */
export function scalePlanningFixture(unitsByFloor: number[]) {
  const projectId = "SYNTHETIC-SCALE", origin = [127.03, 37.65];
  const geo = (x: number, z: number): [number, number] => [origin[0] + x / (111000 * Math.cos(origin[1] * Math.PI / 180)), origin[1] - z / 111000];
  const boundary = [geo(-25, -25), geo(25, -25), geo(25, 25), geo(-25, 25), geo(-25, -25)];
  const roads = [{ name: "Synthetic frontage", points: [geo(-30, 27), geo(30, 27)] }];
  const scenario = createBlankPlanningScenario({ projectId });
  scenario.id = "SCALE-PLAN";
  scenario.floorPrograms = unitsByFloor.map((units, index) => ({
    ...createFloorProgram(index + 1, [
      { ...createFloorZone(units ? "residential" : "piloti", 700, units), id: `zone-${index + 1}`,
        ...(units ? { saleableAreaSqm: units * 100, parkingExclusiveAreaSqm: units * 100 } : {}) },
      { ...createFloorZone("common", 84, 0), id: `common-${index + 1}` },
    ]), id: `floor-${index + 1}`, floorHeightM: 3,
  }));
  scenario.parking = { strategy: "surface", providedCars: 4, orientation: "parallel-front",
    stallWidthM: 2.5, stallDepthM: 5, aisleWidthM: 6, entryWidthM: 3, coreAreaSqm: 0, columnLossPct: 0 };
  const geometry = buildPlanningGeometry({ projectId, scenario, boundary, roads, lotAreaSqm: 2500,
    zoning: "일반상업지역", setback: { road: 0, side: 0, rear: 0 }, generatedAt: "2026-10-26T00:00:00Z" }).snapshot;
  for (const floor of scenario.floorPrograms) {
    const outline = geometry.building.floors.find(g => g.id === floor.id)!.shape;
    const parent = generateInteriorDraft(floor, outline, { ...DEFAULT_INTERIOR_SETTINGS, coreDepthM: 5.5 });
    if (!parent.draft) throw new Error(parent.message);
    floor.interiorLayout = parent.draft;
    parent.draft.roomLayouts = parent.draft.spaces.filter(s => s.kind === "unit").map(unit => {
      const result = generateRoomLayout(floor, unit.id, outline, { ...DEFAULT_ROOM_SETTINGS, serviceDepthM: 2.4 });
      if (!result.draft) throw new Error(result.message);
      return result.draft;
    });
  }
  return { projectId, scenario, geometry, assumptions: defaultAssumptions(), parcel: {
    ...DEMO_PARCEL, id: projectId, address: "Synthetic scale fixture, no official parcel", addressRoad: "Synthetic frontage",
    lotArea: 2500, boundary, roads, zoning: "일반상업지역", acquiredPrice: 50000, demolitionCost: 1000,
  } };
}
