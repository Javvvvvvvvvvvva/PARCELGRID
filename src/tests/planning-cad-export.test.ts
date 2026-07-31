import { describe, expect, it } from "vitest";
import { buildCadastralContext } from "@/lib/geo/cadastral-context";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";
import {
  buildPlanningCadPackage,
  PLANNING_CAD_EXPORT_VERSION,
} from "@/lib/planning/planning-cad-export";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

const ORIGIN: [number, number] = [127.025749, 37.650511];

function localRingToLngLat(points: Array<[number, number]>): [number, number][] {
  const lngScale = 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return points.map(([x, z]) => [
    ORIGIN[0] + x / lngScale,
    ORIGIN[1] - z / 111_000,
  ]);
}

function targetBoundary(): [number, number][] {
  return localRingToLngLat([
    [-10, 10],
    [10, 10],
    [10, -10],
    [-10, -10],
    [-10, 10],
  ]);
}

function planning() {
  const scenario = createBlankPlanningScenario({
    projectId: "cad-project",
    name: "CAD 대표 계획안",
  });
  scenario.id = "cad-scenario";
  scenario.version = 3;
  const floor1 = createFloorProgram(1, [
    createFloorZone("residential", 80, 1),
  ]);
  floor1.id = "cad-floor-1";
  const floor2 = createFloorProgram(2, [
    createFloorZone("residential", 65, 1),
  ]);
  floor2.id = "cad-floor-2";
  scenario.floorPrograms = [floor1, floor2];
  scenario.placement = {
    rotationDeg: 5,
    offsetXM: 0.5,
    offsetZM: -0.5,
    roadSetbackM: 0,
    northSetbackM: 0,
  };
  const local = [
    { x: -10, z: 10 },
    { x: 10, z: 10 },
    { x: 10, z: -10 },
    { x: -10, z: -10 },
  ];
  return buildPlanningGeometry({
    projectId: "cad-project",
    scenario,
    boundary: targetBoundary(),
    lotAreaSqm: polygonAreaSqm(local),
    zoning: "제2종일반주거지역",
    roads: [
      {
        name: "노해로41길",
        points: localRingToLngLat([
          [13, 20],
          [13, -20],
        ]),
      },
    ],
    setback: { road: 0, side: 0, rear: 0 },
    generatedAt: "2026-07-30T00:00:00.000Z",
  }).snapshot;
}

describe("Planning CAD export", () => {
  it("exports the locked floor outlines and site context as layered meter DXF", () => {
    const plan = planning();
    const roadBoundary = localRingToLngLat([
      [10, 15],
      [16.25, 15],
      [16.25, -15],
      [10, -15],
      [10, 15],
    ]);
    const adjacentBoundary = localRingToLngLat([
      [-20, 10],
      [-10, 10],
      [-10, -10],
      [-20, -10],
      [-20, 10],
    ]);
    const sourceParcels = [
      {
        pnu: "UPIS-ROAD-1",
        jibun: "소로3류",
        jimok: "도로",
        jimokCode: "UPIS-UQ151",
        lotAreaSqm: 187.5,
        boundary: roadBoundary,
        distanceM: 13,
      },
      {
        pnu: "adjacent-1",
        jibun: "인접필지",
        jimok: "대",
        jimokCode: "08",
        lotAreaSqm: 200,
        boundary: adjacentBoundary,
        distanceM: 15,
      },
    ];
    const cadastral = buildCadastralContext({
      planning: plan,
      targetPnu: "cad-project",
      parcels: sourceParcels,
      generatedAt: "2026-07-30T00:00:00.000Z",
    });
    const basePackage = buildSketchupExportPackage({
      planning: plan,
      generatedAt: "2026-07-30T00:00:00.000Z",
    });

    const result = buildPlanningCadPackage({
      basePackage,
      cadastral,
      targetBoundary: targetBoundary(),
      sourceParcels,
    });
    const metadata = JSON.parse(result.metadataText) as {
      exportVersion: string;
      planningGeometryHash: string;
      coordinateSystem: { unit: string; northAxis: string };
      layers: Array<{
        name: string;
        defaultVisible: boolean;
        entityCount: number;
      }>;
    };

    expect(result.dxfFilename).toMatch(/-CAD-design-base\.dxf$/);
    expect(result.dxfText).toContain("AC1015");
    expect(result.dxfText).toContain("$INSUNITS\n70\n6");
    expect(result.dxfText).toContain("PG_SITE_BOUNDARY");
    expect(result.dxfText).toContain("PG_PROPOSED_FLOOR_01");
    expect(result.dxfText).toContain("PG_PROPOSED_FLOOR_02");
    expect(result.dxfText).toContain("PG_ROAD_BOUNDARY_UPIS");
    expect(result.dxfText).toContain("PG_ADJACENT_PARCELS");
    expect(result.dxfText).toContain("PG_NORTH");

    expect(metadata.exportVersion).toBe(PLANNING_CAD_EXPORT_VERSION);
    expect(metadata.planningGeometryHash).toBe(plan.geometryHash);
    expect(metadata.coordinateSystem).toMatchObject({
      unit: "meter",
      northAxis: "+Y",
    });
    expect(
      metadata.layers.find((layer) => layer.name === "PG_PROPOSED_FLOOR_01")
        ?.entityCount
    ).toBe(1);
    expect(
      metadata.layers.find((layer) => layer.name === "PG_ADJACENT_PARCELS")
        ?.defaultVisible
    ).toBe(false);
    expect(result.readmeText).toContain("1000배");
    expect(result.readmeText).toContain("Save As로 DWG");
    expect(result.zipBytes[0]).toBe(0x50);
    expect(result.zipBytes[1]).toBe(0x4b);
  });
});
