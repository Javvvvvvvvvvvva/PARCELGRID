import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateParkingLayout, type ParkingLayoutInput } from "@/lib/planning/parking-layout";
import * as geometry from "@/lib/planning/layout-geometry";
import * as topology from "@/lib/geo/parcel-topology-geometry";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";

function fixture(angle: number, strategy: "surface" | "piloti"): ParkingLayoutInput {
  const outer = geometry.planRectangle({ x: 0, z: 0 }, 40, 40, angle);
  const building = geometry.planRectangle({ x: 0, z: 0 }, 18, 16, angle);
  return { strategy, parcelPolygons: [{ outer, holes: [] }], buildingShape: building, pilotiShape: building,
    pilotiEnabled: true, requiredCars: 3, frontages: [{ polygonIndex: 0, ringIndex: 0, edgeIndex: 0, edge: [outer[0], outer[1]] }],
    parking: { strategy, providedCars: 0, coreAreaSqm: 4, columnLossPct: 8 } };
}

afterEach(() => vi.restoreAllMocks());

describe("bounded parking geometry performance", () => {
  it("screens rotated convex layouts without per-stall polygon clipping", () => {
    const regionClips = vi.spyOn(topology, "localParcelIntersectionArea");
    const shapeClips = vi.spyOn(geometry, "planIntersectionArea");
    const containsClips = vi.spyOn(geometry, "planContains");
    const start = performance.now();
    const inputs = [0, 17, 90].flatMap(angle => [fixture(angle, "surface"), fixture(angle, "piloti")]);
    const results = inputs.map(calculateParkingLayout);
    const clippingCalls = regionClips.mock.calls.length + shapeClips.mock.calls.length + containsClips.mock.calls.length;
    console.info(JSON.stringify({ parkingGeometryBenchmark: { elapsedMs: Math.round(performance.now() - start), clippingCalls,
      layouts: results.map(result => ({ capacity: result.capacityCars, mode: result.accessMode, angle: result.orientationDeg })) } }));
    // A deterministic work bound, independent of CI contention. The Turf-only baseline made 9,015 calls.
    expect(clippingCalls).toBeLessThan(1200);
    expect(results.map(result => result.capacityCars)).toEqual([22, 12, 22, 12, 22, 12]);
    expect(results.every(result => result.accessMode === "internal-aisle")).toBe(true);
    for (const [index, result] of results.entries()) {
      expect(result.generationStatus).toBe("complete");
      expect(result.capacityCars).toBeGreaterThan(0);
      for (const component of result.components) {
        for (const shape of [...component.stalls.map(stall => stall.corners), component.aisleShape].filter(shape => shape.length)) {
          expect(Math.abs(polygonAreaSqm(shape) - topology.localParcelIntersectionArea([{ outer: shape, holes: [] }], inputs[index].parcelPolygons!))).toBeLessThanOrEqual(1e-6);
        }
      }
    }
  });

  it("matches equivalent collinear source rings that retain Turf containment", () => {
    for (const strategy of ["surface", "piloti"] as const) {
      const input = fixture(0, strategy), fast = calculateParkingLayout(input);
      const split = (shape: NonNullable<ParkingLayoutInput["parcelShape"]>) => [...shape,
        { x: (shape[0].x + shape.at(-1)!.x) / 2, z: (shape[0].z + shape.at(-1)!.z) / 2 }];
      const clipped = calculateParkingLayout({ ...input,
        parcelPolygons: [{ outer: split(input.parcelPolygons![0].outer), holes: [] }],
        buildingShape: split(input.buildingShape!), pilotiShape: split(input.pilotiShape!),
      });
      expect(clipped.generationStatus).toBe("complete");
      expect(clipped.capacityCars).toBe(fast.capacityCars);
      expect(clipped.stalls).toEqual(fast.stalls);
      expect(clipped.aisleShape).toEqual(fast.aisleShape);
      expect(clipped.entryPath).toEqual(fast.entryPath);
      expect(clipped.coreShape).toEqual(fast.coreShape);
      expect(clipped.columns).toEqual(fast.columns);
    }
  });

  it("does not reuse prepared geometry after source mutation between requests", () => {
    const input = fixture(0, "surface");
    const initial = calculateParkingLayout(input), stall = initial.stalls[0];
    input.parcelPolygons![0].holes.push(geometry.planRectangle(stall.center, 0.02, 0.02));
    const changed = calculateParkingLayout(input);
    expect(changed.generationStatus).toBe("complete");
    for (const current of changed.stalls) expect(Math.abs(polygonAreaSqm(current.corners) -
      topology.localParcelIntersectionArea([{ outer: current.corners, holes: [] }], input.parcelPolygons!))).toBeLessThanOrEqual(1e-6);
    input.parcelPolygons![0].outer[0].x = Number.NaN;
    expect(calculateParkingLayout(input).generationStatus).toBe("invalid-input");
  });
});
