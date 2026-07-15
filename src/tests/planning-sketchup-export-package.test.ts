import { describe, expect, it } from "vitest";
import type {
  ExistingBuildingFootprint,
  ExistingBuildingGeometry,
} from "@/lib/geo/existing-building-geometry";
import {
  buildPlanningGeometry,
  planningRingCentroid,
  planningRingToLocalMeters,
} from "@/lib/planning/planning-geometry";
import {
  buildSketchupExportPackage,
  DEFAULT_CONTEXT_FLOOR_HEIGHT_M,
} from "@/lib/planning/sketchup-export-package";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

function squareBoundary(sizeM = 20): [number, number][] {
  const centerLng = 127.034;
  const centerLat = 37.65;
  const halfLat = sizeM / 2 / 111_000;
  const halfLng =
    sizeM / 2 / (111_000 * Math.cos((centerLat * Math.PI) / 180));
  return [
    [centerLng - halfLng, centerLat - halfLat],
    [centerLng + halfLng, centerLat - halfLat],
    [centerLng + halfLng, centerLat + halfLat],
    [centerLng - halfLng, centerLat + halfLat],
    [centerLng - halfLng, centerLat - halfLat],
  ];
}

function footprintSquare(
  id: string,
  offsetXM: number,
  offsetNorthM: number,
  sizeM: number,
  patch: Partial<ExistingBuildingFootprint> = {}
): ExistingBuildingFootprint {
  const centerLng = 127.034;
  const centerLat = 37.65;
  const lngScale = 111_000 * Math.cos((centerLat * Math.PI) / 180);
  const lng = centerLng + offsetXM / lngScale;
  const lat = centerLat + offsetNorthM / 111_000;
  const halfLng = sizeM / 2 / lngScale;
  const halfLat = sizeM / 2 / 111_000;
  return {
    id,
    pnu: "",
    buildingName: id,
    polygons: [
      [
        [lng - halfLng, lat - halfLat],
        [lng + halfLng, lat - halfLat],
        [lng + halfLng, lat + halfLat],
        [lng - halfLng, lat + halfLat],
        [lng - halfLng, lat - halfLat],
      ],
    ],
    footprintAreaSqm: sizeM * sizeM,
    totalAreaSqm: 0,
    heightM: 0,
    groundFloors: 0,
    undergroundFloors: 0,
    useApprovalDate: "",
    purposeCode: "",
    structureCode: "",
    violationStatus: "unknown",
    violationRaw: "",
    matchMethod: "geometry",
    source: "vworld-dt_d010",
    ...patch,
  };
}

function planning(footprintScalePct = 100) {
  const scenario = createBlankPlanningScenario({
    projectId: "parcel-1",
    name: "Export 기준안",
  });
  scenario.id = "scenario-fixed";
  scenario.version = 3;
  const floor = createFloorProgram(1, [
    createFloorZone("residential", 100, 1),
  ]);
  floor.id = "floor-fixed";
  floor.footprintScalePct = footprintScalePct;
  scenario.floorPrograms = [floor];
  scenario.placement = {
    rotationDeg: 0,
    offsetXM: 0,
    offsetZM: 0,
    roadSetbackM: 0,
    northSetbackM: 0,
  };

  const boundary = squareBoundary();
  const origin = planningRingCentroid(boundary);
  const lotAreaSqm = polygonAreaSqm(
    planningRingToLocalMeters(boundary, origin)
  );
  return buildPlanningGeometry({
    projectId: "parcel-1",
    scenario,
    boundary,
    lotAreaSqm,
    zoning: "일반상업지역",
    roads: [],
    setback: { road: 0, side: 0, rear: 0 },
    generatedAt: "2026-07-14T00:00:00.000Z",
  }).snapshot;
}

function contextGeometry(
  contextFootprints: ExistingBuildingFootprint[]
): ExistingBuildingGeometry {
  return {
    source: "vworld-dt_d010",
    status: "matched",
    footprints: [],
    contextFootprints,
    contextRadiusM: 35,
    queryFeatureCount: contextFootprints.length,
  };
}

describe("SketchUp Export Package Contract", () => {
  it("separates verified and estimated context building heights", () => {
    const existing = contextGeometry([
      footprintSquare("verified", 16, 5, 6, {
        heightM: 12.4,
        groundFloors: 4,
      }),
      footprintSquare("floor-estimated", -16, 4, 5, {
        groundFloors: 3,
      }),
      footprintSquare("default-estimated", 5, -17, 4),
    ]);

    const result = buildSketchupExportPackage({
      planning: planning(),
      existingGeometry: existing,
      generatedAt: "2026-07-14T00:00:00.000Z",
    });

    expect(result.validation.exportable).toBe(true);
    expect(result.validation.status).toBe("ready-with-warnings");
    expect(result.context.summary.totalBuildings).toBe(3);
    expect(result.context.summary.verifiedHeightBuildings).toBe(1);
    expect(result.context.summary.estimatedHeightBuildings).toBe(2);
    expect(result.context.summary.defaultHeightBuildings).toBe(1);
    expect(
      result.context.buildings.find((building) => building.id === "verified")
        ?.heightM
    ).toBe(12.4);
    expect(
      result.context.buildings.find(
        (building) => building.id === "floor-estimated"
      )?.heightM
    ).toBe(3 * DEFAULT_CONTEXT_FLOOR_HEIGHT_M);
    expect(
      result.context.buildings.find(
        (building) => building.id === "default-estimated"
      )?.heightM
    ).toBe(DEFAULT_CONTEXT_FLOOR_HEIGHT_M);
    expect(
      result.layers.find(
        (layer) => layer.name === "PG_CONTEXT_BUILDINGS_VERIFIED"
      )?.objectCount
    ).toBe(1);
    expect(
      result.layers.find(
        (layer) => layer.name === "PG_CONTEXT_BUILDINGS_ESTIMATED"
      )?.objectCount
    ).toBe(2);
  });

  it("uses the same meter origin as the verified planning geometry", () => {
    const result = buildSketchupExportPackage({
      planning: planning(),
      existingGeometry: contextGeometry([
        footprintSquare("east-building", 20, 0, 4, { heightM: 9 }),
      ]),
    });
    const outer = result.context.buildings[0].polygons[0].outer;
    const averageX = outer.reduce((sum, point) => sum + point.x, 0) / outer.length;
    const averageZ = outer.reduce((sum, point) => sum + point.z, 0) / outer.length;

    expect(result.context.coordinateSystem).toEqual(
      result.planning.coordinateSystem
    );
    expect(averageX).toBeCloseTo(20, 1);
    expect(averageZ).toBeCloseTo(0, 1);
  });

  it("changes context and package hashes when surrounding geometry changes", () => {
    const first = buildSketchupExportPackage({
      planning: planning(),
      existingGeometry: contextGeometry([
        footprintSquare("context", 14, 0, 5, { heightM: 9 }),
      ]),
      generatedAt: "2026-07-14T00:00:00.000Z",
    });
    const same = buildSketchupExportPackage({
      planning: planning(),
      existingGeometry: contextGeometry([
        footprintSquare("context", 14, 0, 5, { heightM: 9 }),
      ]),
      generatedAt: "2026-07-15T00:00:00.000Z",
    });
    const changed = buildSketchupExportPackage({
      planning: planning(),
      existingGeometry: contextGeometry([
        footprintSquare("context", 14, 0, 5, { heightM: 12 }),
      ]),
      generatedAt: "2026-07-14T00:00:00.000Z",
    });

    expect(first.contextGeometryHash).toBe(same.contextGeometryHash);
    expect(first.exportPackageHash).toBe(same.exportPackageHash);
    expect(changed.contextGeometryHash).not.toBe(first.contextGeometryHash);
    expect(changed.exportPackageHash).not.toBe(first.exportPackageHash);
    expect(changed.planningGeometryHash).toBe(first.planningGeometryHash);
  });

  it("allows context warnings but blocks a mismatched proposed mass", () => {
    const valid = buildSketchupExportPackage({
      planning: planning(),
      existingGeometry: contextGeometry([
        footprintSquare("estimated", 15, 0, 5, { groundFloors: 2 }),
      ]),
    });
    const invalid = buildSketchupExportPackage({
      planning: planning(90),
      existingGeometry: contextGeometry([
        footprintSquare("estimated", 15, 0, 5, { groundFloors: 2 }),
      ]),
    });

    expect(valid.validation.status).toBe("ready-with-warnings");
    expect(valid.validation.exportable).toBe(true);
    expect(invalid.validation.status).toBe("blocked");
    expect(invalid.validation.exportable).toBe(false);
    expect(invalid.validation.blockingReasons.length).toBeGreaterThan(0);
  });
});
