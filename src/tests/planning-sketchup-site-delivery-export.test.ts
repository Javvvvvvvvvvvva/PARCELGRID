import { describe, expect, it } from "vitest";
import { buildCadastralContext } from "@/lib/geo/cadastral-context";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { buildSketchupSiteDeliveryExport } from "@/lib/planning/sketchup-site-delivery-export";
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
    projectId: "site-delivery-project",
    name: "설계 전달 계획안",
  });
  scenario.id = "site-delivery-scenario";
  scenario.version = 4;
  const floor1 = createFloorProgram(1, [
    createFloorZone("residential", 80, 1),
  ]);
  floor1.id = "site-delivery-floor-1";
  const floor2 = createFloorProgram(2, [
    createFloorZone("residential", 80, 1),
  ]);
  floor2.id = "site-delivery-floor-2";
  scenario.floorPrograms = [floor1, floor2];
  scenario.placement = {
    rotationDeg: 0,
    offsetXM: 0,
    offsetZM: 0,
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
    projectId: "site-delivery-project",
    scenario,
    boundary,
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
    generatedAt: "2026-07-15T00:00:00.000Z",
  }).snapshot;
}

describe("SketchUp site delivery export", () => {
  it("creates a clean design DAE, full-context DAE, and SketchUp tag setup", () => {
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
      targetPnu: "site-delivery-project",
      parcels: sourceParcels,
      generatedAt: "2026-07-15T00:00:00.000Z",
    });
    const basePackage = buildSketchupExportPackage({
      planning: plan,
      generatedAt: "2026-07-15T00:00:00.000Z",
    });
    const result = buildSketchupSiteDeliveryExport({
      basePackage,
      cadastral,
      targetBoundary: targetBoundary(),
      sourceParcels,
    });

    expect(result.cleanDaeFilename).toMatch(/-design-base\.dae$/);
    expect(result.combinedDaeFilename).toMatch(/-full-context\.dae$/);
    expect(result.preferredImportFilename).toBe(result.cleanDaeFilename);

    expect(result.cleanDaeText).toContain("PG_PROPOSED_MASS");
    expect(result.cleanDaeText).toContain("PG_ROAD_BOUNDARY_UPIS");
    expect(result.cleanDaeText).not.toContain('id="PG_ADJACENT_PARCELS-node"');
    expect(result.cleanDaeText).not.toContain('id="PG_ROAD_CENTERLINE_REFERENCE-node"');
    expect(result.cleanDaeText).not.toContain('id="PG_ROAD_WIDTH_SAMPLES-node"');

    expect(result.combinedDaeText).toContain("PG_PROPOSED_MASS");
    expect(result.combinedDaeText).toContain("PG_ROAD_BOUNDARY_UPIS");
    expect(result.combinedDaeText).toContain('id="PG_ADJACENT_PARCELS-node"');
    expect(result.combinedDaeText.match(/<visual_scene\s/g)).toHaveLength(1);

    expect(result.tagSetupFilename).toBe("PARCELGRID-SKETCHUP-TAGS.rb");
    expect(result.tagSetupText).toContain("PG_ADJACENT_PARCELS");
    expect(result.tagSetupText).toContain("tag.visible = !HIDDEN_BY_DEFAULT.include?(name)");
    expect(result.tagSetupText).toContain("Window > Tags");

    expect(result.metadataText).toContain("deliveryAudit");
    expect(result.metadataText).toContain(result.cleanDaeFilename);
    expect(result.metadataText).toContain(result.combinedDaeFilename);
    expect(result.metadataText).toContain(result.tagSetupFilename);
    expect(result.readmeText).toContain("권장 가져오기 — 설계 작업");
    expect(result.readmeText).toContain(result.cleanDaeFilename);
    expect(result.readmeText).toContain("45도로 보이는 이유");
    expect(result.zipBytes[0]).toBe(0x50);
    expect(result.zipBytes[1]).toBe(0x4b);
  });
});
