import { describe, expect, it } from "vitest";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelArea, localParcelIntersectionArea } from "@/lib/geo/parcel-topology-geometry";

const origin: [number, number] = [127, 37.65];
const rect = (x: number, z: number, w: number, h: number): [number, number][] => [[x, z], [x + w, z], [x + w, z + h], [x, z + h]]
  .map(([px, pz]) => [origin[0] + px / (111_000 * Math.cos(origin[1] * Math.PI / 180)), origin[1] - pz / 111_000]);
const scenario = createBlankPlanningScenario({ projectId: "topology", name: "topology" });
scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("office", 20)])];
scenario.placement = { rotationDeg: 0, offsetXM: 0, offsetZM: 0, roadSetbackM: 0, northSetbackM: 0 };
const input = { projectId: "topology", scenario, lotAreaSqm: 484, zoning: "일반상업지역" };
const polygons = (): Wgs84ParcelPolygon[] => [{ outer: rect(-10, -10, 20, 20), holes: [rect(-2, -2, 4, 4)] }, { outer: rect(30, -5, 10, 10), holes: [] }];

describe("full planning parcel geometry", () => {
  it("stores both components and the excluded hole, with net area and shared coordinates", () => {
    const result = buildPlanningGeometry({ ...input, boundaryPolygons: polygons() });
    expect(result.snapshot.parcel.polygons).toHaveLength(2);
    expect(result.snapshot.parcel.polygons![0].holes).toHaveLength(1);
    expect(result.snapshot.parcel.measuredAreaSqm).toBeCloseTo(484, 5);
    expect(result.groundShape).toEqual([]);
    expect(result.groundPolygons).toEqual(result.snapshot.parcel.polygons);
    const floor = result.model.floors[0];
    expect(floor.visualAreaSqm).toBeCloseTo(20, 4);
    expect(localParcelIntersectionArea([{ outer: floor.shape, holes: [] }], result.groundPolygons)).toBeCloseTo(floor.visualAreaSqm, 5);
    expect(result.snapshot.validation.status).toBe("pass");
    expect(result.snapshot.validation.exportable).toBe(true);
    expect(result.snapshot.sourceNotes.join(" ")).toContain("공식 경계");
  });

  it("binds every component and hole into the geometry identity", () => {
    const base = polygons();
    const first = buildPlanningGeometry({ ...input, boundaryPolygons: base }).snapshot;
    const moved = structuredClone(base); moved[1].outer = rect(31, -5, 10, 10);
    expect(buildPlanningGeometry({ ...input, boundaryPolygons: moved }).snapshot.geometryHash).not.toBe(first.geometryHash);
    const hole = structuredClone(base); hole[0].holes = [rect(-2, -2, 3, 4)];
    expect(buildPlanningGeometry({ ...input, boundaryPolygons: hole }).snapshot.geometryHash).not.toBe(first.geometryHash);
    expect(buildPlanningGeometry({ ...input, boundaryPolygons: base, lotAreaSqm: 480 }).snapshot.geometryHash).not.toBe(first.geometryHash);
  });

  it.each([[], null, [{ outer: rect(0, 0, 10, 10), holes: [rect(20, 20, 1, 1)] }]])("never falls back from invalid authoritative topology %j", boundaryPolygons => {
    const result = buildPlanningGeometry({ ...input, boundary: rect(-10, -10, 20, 20), boundaryPolygons: boundaryPolygons as Wgs84ParcelPolygon[] });
    expect(result.groundPolygons).toEqual([]);
    expect(result.snapshot.parcel.measuredAreaSqm).toBe(0);
    expect(result.snapshot.validation.status).toBe("fail");
    expect(result.model.floors.every(floor => !floor.envelopeAvailable)).toBe(true);
  });

  it("retains identical placement coordinates for the legacy and explicit single-ring source", () => {
    const boundary = rect(-10, -10, 20, 20);
    const legacy = buildPlanningGeometry({ ...input, boundary });
    const explicit = buildPlanningGeometry({ ...input, boundaryPolygons: [{ outer: boundary, holes: [] }] });
    expect(explicit.snapshot.geometryHash).toBe(legacy.snapshot.geometryHash);
    expect(localParcelArea(explicit.groundPolygons)).toBeCloseTo(400, 5);
  });
});
