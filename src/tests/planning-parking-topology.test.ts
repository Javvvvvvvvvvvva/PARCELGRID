import { describe, expect, it } from "vitest";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { buildPlanningParkingGeometry } from "@/lib/planning/planning-parking-geometry";
import { parkingGeometryParts } from "@/lib/planning/parking-geometry-parts";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { DEFAULT_VEHICLE_PROFILE } from "@/lib/planning/vehicle-circulation";
import { localParcelIntersectionArea } from "@/lib/geo/parcel-topology-geometry";
import { buildParkingSequenceRecommendation } from "@/lib/planning/parking-sequence-advisor";
import type { PlanningScenarioCalculation } from "@/lib/planning/types";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import type { ParkingLayoutResult } from "@/lib/planning/parking-layout";

const origin: [number, number] = [127, 37.65];
const point = (x: number, z: number): [number, number] => [origin[0] + x / (111_000 * Math.cos(origin[1] * Math.PI / 180)), origin[1] - z / 111_000];
const rect = (x: number, z: number, w: number, h: number) => [[x, z], [x + w, z], [x + w, z + h], [x, z + h]].map(([a, b]) => point(a, b));

function fixture(complex = true, withHole = false) {
  const scenario = createBlankPlanningScenario({ projectId: "parking-topology", name: "parking-topology" });
  scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("office", 1)])];
  scenario.placement = { rotationDeg: 0, offsetXM: 0, offsetZM: 0, roadSetbackM: 0, northSetbackM: 0 };
  scenario.parking = { strategy: "surface", providedCars: 0, coreAreaSqm: 0, columnLossPct: 0 };
  const boundaryPolygons: Wgs84ParcelPolygon[] = [{ outer: rect(-25, -10, 20, 20), holes: withHole ? [rect(-10, 4, 2, 2)] : [] },
    ...(complex ? [{ outer: rect(5, -10, 20, 20), holes: [] }] : [])];
  const roads = [{ name: "access", points: [point(-30, 13), point(30, 13)] }];
  const planning = buildPlanningGeometry({ projectId: "parking-topology", scenario, boundaryPolygons,
    roads, lotAreaSqm: complex ? 800 : 400, zoning: "일반상업지역" }).snapshot;
  return { scenario, planning, boundaryPolygons, roads, requiredCars: 1 };
}

describe("bound full-region parking snapshot", () => {
  it("preserves each accessible component and never fabricates one aggregate aisle", () => {
    const input = fixture();
    const snapshot = buildPlanningParkingGeometry(input);
    expect(snapshot.frontage.sourceMatched).toBe(true);
    expect(new Set(snapshot.frontage.candidates!.map(edge => edge.polygonIndex))).toEqual(new Set([0, 1]));
    expect(snapshot.frontage.frontEdgeIndex).toBeNull();
    expect(snapshot.layout.components).toHaveLength(2);
    expect(snapshot.layout.components.every(component => component.capacityCars > 0 && component.frontage?.polygonIndex === component.polygonIndex)).toBe(true);
    expect(snapshot.layout.capacityCars).toBe(snapshot.layout.components.reduce((sum, part) => sum + part.capacityCars, 0));
    expect(snapshot.layout.aisleShape).toEqual([]);
    expect(snapshot.layout.entryPath).toEqual([]);
    expect(snapshot.circulation.approvalStatus).toBe("unverified");
    expect(snapshot.circulation.stalls.every(stall => stall.componentId && stall.polygonIndex !== undefined)).toBe(true);
    expect(parkingGeometryParts(snapshot.layout)).toHaveLength(2);
  });

  it("keeps source-aligned multipart parking actionable while excluding actual holes", () => {
    const input = fixture(true, true), before = structuredClone(input);
    const snapshot = buildPlanningParkingGeometry(input);
    expect(snapshot.frontage.sourceMatched).toBe(true);
    expect(snapshot.validation.exportable).toBe(true);
    expect(snapshot.layout.components).toHaveLength(2);
    const holes = input.planning.parcel.polygons!.flatMap(part => part.holes);
    expect(holes).toHaveLength(1);
    for (const stall of snapshot.layout.stalls) for (const hole of holes) {
      expect(localParcelIntersectionArea([{ outer: stall.corners, holes: [] }], [{ outer: hole, holes: [] }])).toBeCloseTo(0, 8);
    }
    const recommendation = buildParkingSequenceRecommendation({ ...input,
      scenario: { ...input.scenario, parking: { ...input.scenario.parking, strategy: "none" } },
      geometry: input.planning,
      calculation: { parking: { requiredCars: 1 }, metrics: { residentialUnitCount: 0 } } as PlanningScenarioCalculation,
    });
    expect(recommendation.kind).toBe("surface");
    expect(recommendation.actionable).toBe(true);
    expect(recommendation.surface.layout?.components).toHaveLength(2);
    expect(input).toEqual(before);
  });

  it("rejects ground moved into a source-aligned hole despite unchanged area and pass flags", () => {
    const input = fixture(true, true);
    const ground = input.planning.building.aboveGroundFloors[0];
    const center = (ring: typeof ground.shape) => ({
      x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
      z: ring.reduce((sum, p) => sum + p.z, 0) / ring.length,
    });
    const start = center(ground.shape), target = center(input.planning.parcel.polygons![0].holes[0]);
    ground.shape.forEach(p => { p.x += target.x - start.x; p.z += target.z - start.z; });
    const snapshot = buildPlanningParkingGeometry(input);
    expect(snapshot.frontage.sourceMatched).toBe(false);
    expect(snapshot.validation.exportable).toBe(false);
    expect(snapshot.layout.capacityCars).toBe(0);
  });

  it("binds all component and hole coordinates even when the leading legacy ring is unchanged", () => {
    const input = fixture();
    const altered = structuredClone(input.boundaryPolygons);
    altered[1].outer = rect(6, -10, 20, 20);
    const result = buildPlanningParkingGeometry({ ...input, boundary: input.boundaryPolygons[0].outer, boundaryPolygons: altered });
    expect(result.frontage.sourceMatched).toBe(false);
    expect(result.layout.capacityCars).toBe(0);
    expect(result.validation.issues.map(issue => issue.code)).toContain("parking-source-mismatch");
    const holed: Wgs84ParcelPolygon[] = structuredClone(input.boundaryPolygons);
    holed[1].holes = [rect(12, -3, 2, 2)];
    expect(buildPlanningParkingGeometry({ ...input, boundaryPolygons: holed }).frontage.sourceMatched).toBe(false);
  });

  it("rejects stale roads, stale scenario basis, and explicit empty source without fallback", () => {
    const input = fixture(false);
    const roadChanged = buildPlanningParkingGeometry({ ...input, roads: [{ name: "access", points: [point(-30, 14), point(30, 14)] }] });
    expect(roadChanged.validation.status).toBe("fail");
    const changed = structuredClone(input.scenario); changed.placement.offsetXM = 1;
    expect(buildPlanningParkingGeometry({ ...input, scenario: changed }).frontage.sourceMatched).toBe(false);
    expect(buildPlanningParkingGeometry({ ...input, boundary: input.boundaryPolygons[0].outer, boundaryPolygons: [] }).layout.capacityCars).toBe(0);
  });

  it("does not bypass a source mismatch when parking is not applicable", () => {
    const input = fixture(false);
    input.scenario.parking.strategy = "none";
    const result = buildPlanningParkingGeometry({ ...input, requiredCars: 0, boundaryPolygons: [] });
    expect(result.validation.status).toBe("fail");
    expect(result.validation.exportable).toBe(false);
  });

  it("binds vehicle assumptions and entry offset into the verification identity", () => {
    const input = fixture(false);
    const first = buildPlanningParkingGeometry(input);
    const altered = structuredClone(input.scenario);
    altered.parking.vehicleProfile = { ...DEFAULT_VEHICLE_PROFILE, widthM: DEFAULT_VEHICLE_PROFILE.widthM + 0.1 };
    expect(buildPlanningParkingGeometry({ ...input, scenario: altered }).parkingGeometryHash).not.toBe(first.parkingGeometryHash);
    altered.parking.vehicleProfile = DEFAULT_VEHICLE_PROFILE;
    altered.parking.entryOffsetRatio = 0.2;
    expect(buildPlanningParkingGeometry({ ...input, scenario: altered }).parkingGeometryHash).not.toBe(first.parkingGeometryHash);
  });

  it.each([NaN, -1, Infinity, 1001])("blocks invalid required count %s", requiredCars => {
    const result = buildPlanningParkingGeometry({ ...fixture(false), requiredCars });
    expect(result.validation.status).toBe("fail");
    expect(result.validation.issues.map(issue => issue.code)).toContain("parking-required-cars-invalid");
  });

  it("uses legacy display geometry only when components are absent", () => {
    const input = fixture(false);
    const layout = buildPlanningParkingGeometry(input).layout;
    expect(parkingGeometryParts({ ...layout, components: [] })).toEqual([]);
    expect(parkingGeometryParts({ ...layout, components: undefined } as unknown as ParkingLayoutResult)).toHaveLength(1);
  });
});
