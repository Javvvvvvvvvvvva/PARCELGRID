import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelIntersectionArea } from "@/lib/geo/parcel-topology-geometry";
import { calculateParkingLayout, parkingFrontageInwardNormal, type ParkingFrontage } from "@/lib/planning/parking-layout";
import { assessVehicleCirculation, DEFAULT_VEHICLE_PROFILE, screenVehiclePath } from "@/lib/planning/vehicle-circulation";
import { planRectangle, type PlanPoint } from "@/lib/planning/layout-geometry";
import * as massing from "@/lib/planning/planning-massing";

const rectangle = (x: number, z: number, width: number, depth: number) => planRectangle({ x: x + width / 2, z: z + depth / 2 }, width, depth);
const part = (x = 0, width = 12, depth = 7): LocalParcelPolygon => ({ outer: rectangle(x, 0, width, depth), holes: [] });
const parking = { strategy: "surface" as const, providedCars: 0, columnLossPct: 0, coreAreaSqm: 0 };
const frontage = (polygons: LocalParcelPolygon[], polygonIndex = 0, edgeIndex = 0): ParkingFrontage => ({
  polygonIndex, ringIndex: 0, edgeIndex, edge: [polygons[polygonIndex].outer[edgeIndex], polygons[polygonIndex].outer[(edgeIndex + 1) % polygons[polygonIndex].outer.length]],
});
function layout(polygons: LocalParcelPolygon[], frontages = polygons.map((_, i) => frontage(polygons, i))) {
  return calculateParkingLayout({ strategy: "surface", parking, requiredCars: 3, parcelPolygons: polygons, frontages });
}
function expectContained(shape: PlanPoint[], polygon: LocalParcelPolygon) {
  expect(Math.abs(massing.polygonAreaSqm(shape) - localParcelIntersectionArea([{ outer: shape, holes: [] }], [polygon]))).toBeLessThanOrEqual(1e-6);
}

afterEach(() => vi.restoreAllMocks());

describe("component-owned parking topology", () => {
  it("retains independently accessed capacity and geometry without a singular fake path", () => {
    const polygons = [part(0, 20, 16), part(40, 20, 16)];
    const result = layout(polygons);
    expect(result.generationStatus).toBe("complete");
    expect(result.components).toHaveLength(2);
    expect(result.capacityCars).toBe(result.components.reduce((sum, c) => sum + c.capacityCars, 0));
    expect(result.aisleShape).toEqual([]);
    expect(result.entryPath).toEqual([]);
    expect(result.targetShape).toEqual([]);
    for (const component of result.components) {
      expect(component.capacityCars).toBeGreaterThan(0);
      expect(component.aisleShape).toHaveLength(4);
      expect(component.entryPath).toHaveLength(2);
      expect(component.entryPaths).toHaveLength(1);
      expectContained(component.aisleShape, polygons[component.polygonIndex]);
      for (const stall of component.stalls) {
        expect(stall.componentId).toBe(component.id);
        expect(stall.polygonIndex).toBe(component.polygonIndex);
        expectContained(stall.corners, polygons[component.polygonIndex]);
      }
    }
  });

  it("does not count or invent access for an isolated component", () => {
    const polygons = [part(), part(40)];
    const result = layout(polygons, [frontage(polygons, 1)]);
    expect(result.components[0].capacityCars).toBe(0);
    expect(result.components[0].accessStatus).toBe("missing");
    expect(result.components[0].frontage).toBeNull();
    expect(result.components[0].entryPath).toEqual([]);
    expect(result.capacityCars).toBe(layout([polygons[1]]).capacityCars);
    expect(result.stalls.every(stall => stall.polygonIndex === 1)).toBe(true);
  });

  it("does not use legacy frontage as a first-component fallback", () => {
    const polygons = [part(), part(40)];
    const result = calculateParkingLayout({ strategy: "surface", parking, requiredCars: 1,
      parcelPolygons: polygons, parcelShape: polygons[0].outer, frontEdge: frontage(polygons).edge });
    expect(result.capacityCars).toBe(0);
  });

  it("excludes a hole wholly enclosed by a stall while keeping usable frontage", () => {
    const polygon = part(0, 20);
    polygon.holes = [rectangle(1.23, 2.12, 0.02, 0.02)];
    const result = layout([polygon]);
    expect(result.capacityCars).toBeGreaterThan(0);
    expect(result.capacityCars).toBeLessThan(layout([part(0, 20)]).capacityCars);
    result.stalls.forEach(stall => expectContained(stall.corners, polygon));
  });

  it("clips thin concave intrusions through stalls and aisle edges", () => {
    const polygon: LocalParcelPolygon = { outer: [
      { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 16 }, { x: 10.62, z: 16 },
      { x: 10.62, z: 1 }, { x: 10.6, z: 1 }, { x: 10.6, z: 16 }, { x: 0, z: 16 },
    ], holes: [] };
    const result = layout([polygon]);
    expect(result.capacityCars).toBeGreaterThan(0);
    result.stalls.forEach(stall => expectContained(stall.corners, polygon));
    for (const component of result.components) if (component.aisleShape.length) expectContained(component.aisleShape, polygon);
  });

  it("checks the piloti approach across holes, not only the parking rectangle", () => {
    const polygon = part(0, 12, 20), pilotiShape = rectangle(2, 10, 6, 6);
    const input = { strategy: "piloti" as const, parking: { ...parking, strategy: "piloti" as const }, requiredCars: 1,
      pilotiEnabled: true, pilotiShape, parcelPolygons: [polygon], frontages: [frontage([polygon])] };
    expect(calculateParkingLayout(input).capacityCars).toBeGreaterThan(0);
    polygon.holes = [rectangle(0.2, 5, 11.6, 0.02)];
    expect(calculateParkingLayout(input).capacityCars).toBe(0);
  });

  it("retains valid single-ring piloti layouts through a contained side-yard approach", () => {
    for (const [outer, pilotiShape] of [
      [rectangle(-10, -8, 20, 16), rectangle(-5, -8, 10, 16)],
      [rectangle(-6, -9, 12, 16), rectangle(-3, -2, 6, 6.3)],
    ]) {
      const polygon = { outer, holes: [] }, input = { strategy: "piloti" as const,
        parking: { ...parking, strategy: "piloti" as const }, requiredCars: 2, pilotiEnabled: true,
        pilotiShape, parcelShape: outer, frontEdge: frontage([polygon]).edge };
      const legacy = calculateParkingLayout(input);
      const authoritative = calculateParkingLayout({ ...input, parcelShape: [], parcelPolygons: [polygon], frontages: [frontage([polygon])] });
      expect(authoritative.capacityCars).toBe(legacy.capacityCars);
      expect(authoritative.capacityCars).toBeGreaterThan(0);
    }
  });

  it("uses edge winding when a concave centroid is outside, in either ring/edge order", () => {
    const outer = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 7 }, { x: 7, z: 7 },
      { x: 7, z: 23 }, { x: 20, z: 23 }, { x: 20, z: 30 }, { x: 0, z: 30 }];
    expect(massing.polygonCentroid(outer).x).toBeGreaterThan(7);
    for (const ring of [outer, [...outer].reverse()]) for (const reversed of [false, true]) {
      const polygons = [{ outer: ring, holes: [] }];
      const edgeIndex = ring.findIndex((p, i) => p.x === 7 && ring[(i + 1) % ring.length].x === 7);
      const access = frontage(polygons, 0, edgeIndex);
      if (reversed) access.edge = [access.edge[1], access.edge[0]];
      const normal = parkingFrontageInwardNormal(access, polygons)!;
      expect(normal.x).toBe(-1);
      expect(Math.abs(normal.z)).toBe(0);
      const planned = layout(polygons, [access]);
      expect(planned.capacityCars).toBeGreaterThan(0);
      planned.stalls.forEach(stall => expectContained(stall.corners, polygons[0]));
      const circulation = assessVehicleCirculation({ layout: planned, parcelPolygons: polygons, parking });
      expect(circulation.clearCandidateCount).toBeGreaterThan(0);
      expect(circulation.stalls.every(stall => stall.status === "clear-candidate")).toBe(true);
    }
  });

  it.each([[], [{ outer: [], holes: [] }], null, [{ ...part(), holes: [rectangle(30, 0, 1, 1)] }]])(
    "treats explicit invalid topology as authoritative (%j)", polygons => {
      const good = part();
      const result = calculateParkingLayout({ strategy: "surface", parking, requiredCars: 1,
        parcelPolygons: polygons as LocalParcelPolygon[], parcelShape: good.outer, frontEdge: frontage([good]).edge });
      expect(result.generationStatus).toBe("invalid-input");
      expect(result.capacityCars).toBe(0);
      expect(result.components).toEqual([]);
    });

  it("rejects hole frontages, foreign edges and explicit empty access", () => {
    const polygons = [part(), part(40)];
    for (const bad of [{ ...frontage(polygons), ringIndex: 1 }, { ...frontage(polygons), polygonIndex: 1 },
      { ...frontage(polygons), edgeIndex: 99 }]) {
      expect(layout(polygons, [bad]).generationStatus).toBe("invalid-input");
    }
    expect(calculateParkingLayout({ strategy: "surface", parking, requiredCars: 1, parcelShape: polygons[0].outer,
      frontEdge: frontage(polygons).edge, frontages: [] }).capacityCars).toBe(0);
  });

  it("preserves each mixed-source core, columns, exclusion and entry", () => {
    const polygons = [part(0, 30, 22)];
    const building = rectangle(8, 10, 12, 10);
    const result = calculateParkingLayout({ strategy: "mixed", parking: { ...parking, strategy: "mixed", coreAreaSqm: 4 },
      requiredCars: 4, parcelPolygons: polygons, frontages: [frontage(polygons)], buildingShape: building,
      pilotiEnabled: true, pilotiShape: building });
    expect(result.components).toHaveLength(2);
    expect(result.components.every(c => c.capacityCars > 0)).toBe(true);
    expect(result.components.find(c => c.source === "piloti")!.coreShape).toHaveLength(4);
    expect(result.components.find(c => c.source === "piloti")!.obstacles.length).toBeGreaterThan(1);
    expect(result.components.find(c => c.source === "surface")!.exclusionShape).toEqual(building);
    expect(result.aisleShape).toEqual([]);
    expect(result.entryPath).toEqual([]);
  });

  it("uses one budget for all components and candidate searches", () => {
    const budget = vi.spyOn(massing, "createPlanningGeometryBudget").mockImplementation(() => {
      let remaining = 80;
      return () => { if (--remaining < 0) { const error = new Error("bounded"); error.name = "TimeoutError"; throw error; } };
    });
    const result = layout([part(), part(40), part(80)]);
    expect(budget).toHaveBeenCalledTimes(1);
    expect(result.generationStatus).toBe("budget-exhausted");
    expect(result.capacityCars).toBe(0);
  });
});

describe("full-region vehicle sweeps", () => {
  const waypoints = [{ x: 2, z: 3 }, { x: 8, z: 3 }];
  it("detects enclosed holes and thin concave cuts between poses", () => {
    const polygon = part(0, 20, 8);
    polygon.holes = [rectangle(6.123, 2.98, 0.02, 0.02)];
    const result = screenVehiclePath({ waypoints, vehicle: DEFAULT_VEHICLE_PROFILE, parcelPolygons: [polygon], obstacles: [] });
    expect(result.status).toBe("conflict");
    expect(result.collisions.length).toBeGreaterThan(0);
    polygon.holes = [];
    polygon.outer = [{ x: 0, z: 0 }, { x: 6.123, z: 0 }, { x: 6.123, z: 3.01 }, { x: 6.143, z: 3.01 },
      { x: 6.143, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 8 }, { x: 0, z: 8 }];
    expect(screenVehiclePath({ waypoints, vehicle: DEFAULT_VEHICLE_PROFILE, parcelPolygons: [polygon], obstacles: [] }).status).toBe("conflict");
  });

  it("screens actual access on every component with no dependence on aggregate geometry", () => {
    const polygons = [part(), part(40)], planned = layout(polygons);
    const result = assessVehicleCirculation({ layout: planned, parcelPolygons: polygons, parcel: [], parking, frontEdge: null });
    expect(result.status).toBe("preliminary");
    expect(result.clearCandidateCount).toBe(planned.capacityCars);
    expect(new Set(result.stalls.map(s => s.polygonIndex))).toEqual(new Set([0, 1]));
    expect(result.approvalStatus).toBe("unverified");
    result.stalls.forEach(s => s.sweptAreas.forEach(shape => expectContained(shape, polygons[s.polygonIndex!])));
  });

  it("cannot borrow another component's frontage or ignore updated holes", () => {
    const polygons = [part(), part(40)], planned = layout(polygons);
    planned.components[1].frontage = planned.components[0].frontage;
    const missing = assessVehicleCirculation({ layout: planned, parcelPolygons: polygons, parking });
    expect(missing.status).toBe("unknown");
    expect(missing.stalls.filter(s => s.polygonIndex === 1).every(s => s.status === "unavailable")).toBe(true);
    const fresh = layout([part()]);
    const changed = part(); changed.holes = [rectangle(1.5, 2.5, 0.02, 0.02)];
    const conflict = assessVehicleCirculation({ layout: fresh, parcelPolygons: [changed], parking });
    expect(conflict.stalls.some(s => s.status === "conflict")).toBe(true);
  });

  it("does not fall back from empty explicit topology in either entry point", () => {
    const polygon = part(0, 20, 8);
    expect(screenVehiclePath({ waypoints, vehicle: DEFAULT_VEHICLE_PROFILE, parcel: polygon.outer,
      parcelPolygons: [], obstacles: [] }).status).toBe("unavailable");
    expect(assessVehicleCirculation({ layout: layout([polygon]), parking, parcel: polygon.outer,
      frontEdge: frontage([polygon]).edge, parcelPolygons: [] }).status).toBe("unknown");
  });

  it("shares the twenty-stall screening limit across all components", () => {
    const polygons = Array.from({ length: 7 }, (_, i) => part(i * 40));
    const planned = layout(polygons), result = assessVehicleCirculation({ layout: planned, parcelPolygons: polygons, parking });
    expect(planned.stalls.length).toBeGreaterThan(20);
    expect(result.stalls).toHaveLength(20);
    expect(result.uncheckedStalls).toBe(planned.stalls.length - 20);
    expect(result.status).toBe("review");
  });

  it("shares one deadline across component screening and leaves interrupted work unknown", () => {
    const polygons = [part(), part(40)], planned = layout(polygons);
    const budget = vi.spyOn(massing, "createPlanningGeometryBudget").mockImplementation(() => {
      let remaining = 40;
      return () => { if (--remaining < 0) { const error = new Error("bounded"); error.name = "TimeoutError"; throw error; } };
    });
    const result = assessVehicleCirculation({ layout: planned, parcelPolygons: polygons, parking });
    expect(budget).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("unknown");
    expect(result.uncheckedStalls).toBeGreaterThan(0);
    expect(result.approvalStatus).toBe("unverified");
  });
});
