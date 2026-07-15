import { describe, expect, it } from "vitest";
import { buildCadastralContext } from "@/lib/geo/cadastral-context";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { buildSketchupSiteExport } from "@/lib/planning/sketchup-site-export";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

const ORIGIN: [number, number] = [127.025749, 37.650511];

function localRingToLngLat(points: Array<[number, number]>): [number, number][] {
  const lngScale = 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return points.map(([x, z]) => [ORIGIN[0] + x / lngScale, ORIGIN[1] - z / 111_000]);
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
  const boundary = targetBoundary();
  const scenario = createBlankPlanningScenario({
    projectId: "site-export-project",
    name: "통합 사이트 계획안",
  });
  scenario.id = "site-export-scenario";
  scenario.version = 3;
  const floor1 = createFloorProgram(1, [
    createFloorZone("residential", 80, 1),
  ]);
  floor1.id = "site-export-floor-1";
  const floor2 = createFloorProgram(2, [
    createFloorZone("residential", 80, 1),
  ]);
  floor2.id = "site-export-floor-2";
  scenario.floorPrograms = [floor1, floor2];
  scenario.placement = {
    rotationDeg: 0,
    offsetXM: 0,
    offsetZM: 0,
    roadSetbackM: 0,
    northSetbackM: 0,
  };
  const local = localRingToLngLat([
    [-10, 10],
    [10, 10],
    [10, -10],
    [-10, -10],
  ]);
  const lotAreaSqm = polygonAreaSqm(
    local.slice(0, -1).map(([lng, lat]) => ({
      x: (lng - ORIGIN[0]) * 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180),
      z: -(lat - ORIGIN[1]) * 111_000,
    }))
  );
  return buildPlanningGeometry({
    projectId: "site-export-project",
    scenario,
    boundary,
    lotAreaSqm,
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
    generatedAt: "2026-07-15T00:00:00.000Z",
  }).snapshot;
}

describe("SketchUp integrated site export", () => {
  it("packages model DAE, site-context DAE, DXF, GeoJSON, metadata, and README", () => {
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
        pnu: "UPIS-11000UQ151PS201912165646-1",
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
      targetPnu: "site-export-project",
      parcels: sourceParcels,
      generatedAt: "2026-07-15T00:00:00.000Z",
    });
    const basePackage = buildSketchupExportPackage({
      planning: plan,
      generatedAt: "2026-07-15T00:00:00.000Z",
    });
    const result = buildSketchupSiteExport({
      basePackage,
      cadastral,
      targetBoundary: targetBoundary(),
      sourceParcels,
    });

    expect(cadastral.summary.primaryWidthAvgM).toBeCloseTo(6.25, 1);
    expect(result.filename).toMatch(/SITE-/);
    expect(result.modelDaeFilename).toMatch(/-model\.dae$/);
    expect(result.siteDaeFilename).toMatch(/-site-context\.dae$/);
    expect(result.siteDaeText).toContain("PG_ROAD_BOUNDARY_UPIS");
    expect(result.siteDaeText).toContain("PG_ADJACENT_PARCELS");
    expect(result.siteDaeText).toContain("PG_ROAD_CENTERLINE_REFERENCE");
    expect(result.siteDaeText).toContain("PG_FRONTAGE");
    expect(result.siteDaeText).toContain("PG_ROAD_WIDTH_SAMPLES");
    expect(result.metadataText).toContain("LT_C_UPISUQ151");
    expect(result.metadataText).toContain(cadastral.cadastralHash);
    expect(result.readmeText).toContain("두 DAE는 동일한 meter 단위");
    expect(result.zipBytes[0]).toBe(0x50);
    expect(result.zipBytes[1]).toBe(0x4b);
  });
});
