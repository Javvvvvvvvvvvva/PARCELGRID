import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PlanningSiteContextPanel } from "@/components/planning/PlanningSiteContextPanel";
import * as threeGeometry from "@/lib/planning/context-three-geometry";
import { localParcelArea } from "@/lib/geo/parcel-topology-geometry";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const harness = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/lib/stores/project-store", () => ({ useProjectStore: (selector: (state: Record<string, unknown>) => unknown) => selector(harness.state) }));
vi.mock("@/lib/auth/client-session", () => ({ sessionFetch: vi.fn(), sessionLocalStorage: { setItem: vi.fn() } }));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactNode }) => React.createElement("div", null, children),
  useThree: () => ({ camera: new THREE.PerspectiveCamera(), size: { width: 390, height: 519 }, invalidate: vi.fn() }),
}));
vi.mock("@react-three/drei", () => ({ Line: () => null, OrbitControls: () => null, Text: () => null }));
vi.mock("@/components/ui/primitives", () => ({ Panel: ({ children }: { children: ReactNode }) => React.createElement("div", null, children) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("renders every target part and hole and frames them even without surrounding data", () => {
  vi.stubGlobal("React", React);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const data = projectWorkspaceFixture("scene-target").projectData;
  data.scenarios = [];
  const ring = (x: number, z: number, w: number, h: number): [number, number][] =>
    [[x, z], [x + w, z], [x + w, z + h], [x, z + h]].map(([east, south]) =>
      [127.03 + east / (111000 * Math.cos(37.65 * Math.PI / 180)), 37.65 - south / 111000]);
  Object.assign(data.parcel, { boundary: [], boundaryPolygons: [
    { outer: ring(-25, -10, 20, 20), holes: [ring(-22, -7, 3, 3)] },
    { outer: ring(5, -10, 20, 20), holes: [] },
  ], lotArea: 791, zoning: "일반상업지역", roads: [], inputProvenance: { mode: "manual" } });
  const scenario = createBlankPlanningScenario({ projectId: data.parcel.id });
  scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 80, 1)])];
  harness.state = { data, planningScenarios: [scenario], selectedPlanningScenarioId: scenario.id };
  const flat = vi.spyOn(threeGeometry, "contextFlatGeometry");
  const frame = vi.spyOn(threeGeometry, "calculateContextSceneFrame");
  renderToStaticMarkup(React.createElement(PlanningSiteContextPanel, { projectId: data.parcel.id }));
  expect(flat).toHaveBeenCalledTimes(2);
  const rendered = flat.mock.calls.map(call => call[0]);
  expect(rendered.map(part => part.holes.length)).toEqual([1, 0]);
  expect(localParcelArea(rendered)).toBeCloseTo(791, 4);
  const framed = frame.mock.calls[0][0].polygons!;
  expect(framed.slice(0, 2)).toEqual(rendered);
  expect(Math.max(...framed.flatMap(p => p.outer.map(point => point.x))) - Math.min(...framed.flatMap(p => p.outer.map(point => point.x))))
    .toBeCloseTo(50, 5);
});
