import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { generateInteriorCandidates } from "@/lib/planning/interior/generator";
import type { InteriorGenerationInput } from "@/lib/planning/interior/types";

export const rectangle = (width = 12, depth = 12) => [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
export const generationInput = (outline = rectangle()): InteriorGenerationInput => ({ outline, count: 2, circulationWidthM: 1.8, coreDepthM: 3.5, minRoomWidthM: 2, minRoomAreaSqm: 12, wallThicknessM: 0.15 });

export function interiorFixture() {
  const scenario = createBlankPlanningScenario({ projectId: "interior-test", name: "구획 검증" });
  scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 144, 2)])];
  scenario.placement = { rotationDeg: 0, offsetXM: 0, offsetZM: 0, roadSetbackM: 0, northSetbackM: 0 };
  const lng = 127.034, lat = 37.65;
  const boundary: [number, number][] = [[-15, -15], [15, -15], [15, 15], [-15, 15], [-15, -15]].map(([x, z]) => [lng + x / (111000 * Math.cos(lat * Math.PI / 180)), lat - z / 111000]);
  const build = () => buildPlanningGeometry({ projectId: "interior-test", scenario, boundary, lotAreaSqm: 900, zoning: "일반상업지역", roads: [], setback: { road: 0, side: 0, rear: 0 }, generatedAt: "2026-09-28T00:00:00Z" }).snapshot;
  const initial = build();
  const layout = generateInteriorCandidates(generationInput(initial.building.floors[0].shape)).candidates[0].layout;
  return { scenario, layout, initial, build };
}
