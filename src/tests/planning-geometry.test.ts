import { describe, expect, it } from "vitest";
import {
  buildPlanningGeometry,
  planningRingCentroid,
  planningRingToLocalMeters,
  polygonSelfIntersects,
} from "@/lib/planning/planning-geometry";
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

function scenarioWithArea(areaSqm: number, footprintScalePct = 100) {
  const scenario = createBlankPlanningScenario({
    projectId: "parcel-1",
    name: "검증 계획안",
  });
  scenario.id = "scenario-geometry-1";
  const zone = createFloorZone("residential", areaSqm, 1);
  zone.id = "zone-residential-1";
  const floor = createFloorProgram(1, [zone]);
  floor.id = "floor-1";
  floor.footprintScalePct = footprintScalePct;
  scenario.floorPrograms = [floor];
  scenario.placement = {
    rotationDeg: 0,
    offsetXM: 0,
    offsetZM: 0,
    roadSetbackM: 0,
    northSetbackM: 0,
  };
  return scenario;
}

function build(areaSqm: number, footprintScalePct = 100, generatedAt?: string) {
  const boundary = squareBoundary();
  const origin = planningRingCentroid(boundary);
  const officialAreaSqm = polygonAreaSqm(
    planningRingToLocalMeters(boundary, origin)
  );
  return buildPlanningGeometry({
    projectId: "parcel-1",
    scenario: scenarioWithArea(areaSqm, footprintScalePct),
    boundary,
    lotAreaSqm: officialAreaSqm,
    zoning: "일반상업지역",
    roads: [],
    setback: { road: 0, side: 0, rear: 0 },
    generatedAt,
  }).snapshot;
}

describe("Planning Geometry Contract", () => {
  it("keeps program area and generated 3D footprint within strict tolerance", () => {
    const snapshot = build(100);
    const floor = snapshot.building.floors[0];

    expect(floor.programAreaSqm).toBe(100);
    expect(floor.visualAreaSqm).toBeCloseTo(100, 3);
    expect(Math.abs(floor.areaDifferencePct)).toBeLessThanOrEqual(0.1);
    expect(floor.areaStatus).toBe("pass");
    expect(snapshot.validation.status).toBe("pass");
    expect(snapshot.validation.representativeEligible).toBe(true);
    expect(snapshot.validation.exportable).toBe(true);
    expect(snapshot.coordinateSystem.unit).toBe("meter");
    expect(snapshot.coordinateSystem.northAxis).toBe("-Z");
    expect(snapshot.coordinateSystem.eastAxis).toBe("+X");
  });

  it("blocks representative confirmation when a visual scale changes mass size", () => {
    const snapshot = build(100, 90);
    const floor = snapshot.building.floors[0];

    expect(floor.visualAreaSqm).toBeCloseTo(81, 2);
    expect(floor.areaStatus).toBe("fail");
    expect(snapshot.validation.status).toBe("fail");
    expect(snapshot.validation.representativeEligible).toBe(false);
    expect(snapshot.validation.exportable).toBe(false);
    expect(
      snapshot.validation.issues.some(
        (issue) => issue.code === "floor-area-mismatch"
      )
    ).toBe(true);
  });

  it("blocks representative confirmation and export for an unsupported upper floor", () => {
    const boundary = squareBoundary();
    const origin = planningRingCentroid(boundary);
    const lotAreaSqm = polygonAreaSqm(
      planningRingToLocalMeters(boundary, origin)
    );
    const scenario = scenarioWithArea(20);
    const upper = createFloorProgram(
      2,
      [createFloorZone("residential", 20, 1)],
      3
    );
    upper.northSetbackM = 50;
    scenario.floorPrograms.push(upper);

    const snapshot = buildPlanningGeometry({
      projectId: "parcel-1",
      scenario,
      boundary,
      lotAreaSqm,
      zoning: "일반상업지역",
      roads: [],
      setback: { road: 0, side: 0, rear: 0 },
    }).snapshot;

    expect(snapshot.building.floors[1].supportedByLowerFloor).toBe(false);
    expect(snapshot.validation.status).toBe("fail");
    expect(snapshot.validation.representativeEligible).toBe(false);
    expect(snapshot.validation.exportable).toBe(false);
    expect(
      snapshot.validation.issues.some(
        (issue) => issue.code === "floor-support-insufficient"
      )
    ).toBe(true);
  });

  it("creates a stable geometry hash independent of generation time", () => {
    const first = build(100, 100, "2026-07-14T00:00:00.000Z");
    const second = build(100, 100, "2026-07-15T00:00:00.000Z");
    const changed = build(101, 100, "2026-07-14T00:00:00.000Z");

    expect(first.geometryHash).toBe(second.geometryHash);
    expect(changed.geometryHash).not.toBe(first.geometryHash);
  });

  it("does not shrink the legal-max envelope with legacy design setback values", () => {
    const boundary = squareBoundary();
    const origin = planningRingCentroid(boundary);
    const lotAreaSqm = polygonAreaSqm(
      planningRingToLocalMeters(boundary, origin)
    );
    const common = {
      projectId: "parcel-1",
      scenario: scenarioWithArea(100),
      boundary,
      lotAreaSqm,
      zoning: "일반상업지역",
      roads: [],
      generatedAt: "2026-07-17T00:00:00.000Z",
    };
    const legalOnly = buildPlanningGeometry({
      ...common,
      setback: { road: 0, side: 0, rear: 0 },
    }).snapshot;
    const legacyDesignMargin = buildPlanningGeometry({
      ...common,
      setback: { road: 3, side: 1.5, rear: 3 },
    }).snapshot;

    expect(legacyDesignMargin.building.floors[0].shape).toEqual(
      legalOnly.building.floors[0].shape
    );
    expect(legacyDesignMargin.geometryHash).toBe(legalOnly.geometryHash);
  });

  it("detects self-intersecting export polygons", () => {
    expect(
      polygonSelfIntersects([
        { x: 0, z: 0 },
        { x: 4, z: 4 },
        { x: 0, z: 4 },
        { x: 4, z: 0 },
      ])
    ).toBe(true);
    expect(
      polygonSelfIntersects([
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 4 },
        { x: 0, z: 4 },
      ])
    ).toBe(false);
  });
});
