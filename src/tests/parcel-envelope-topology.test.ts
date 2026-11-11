import { afterEach, describe, expect, it, vi } from "vitest";
import { calcBuildableArea, type BuildableAreaOptions, type LngLat } from "@/lib/finance/buildable-area";
import { buildParcelEnvelope, unprojectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { localParcelArea, localParcelContainsPoint } from "@/lib/geo/parcel-topology-geometry";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { planningEnvelopeSteps } from "@/lib/planning/envelope-steps";

const origin: LngLat = [127, 37];
const rectangle = (x: number, z: number, w: number, h: number) => [{ x, z }, { x: x + w, z }, { x: x + w, z: z + h }, { x, z: z + h }];
const part = (x = 0, z = 0, w = 10, h = 10): LocalParcelPolygon => ({ outer: rectangle(x, z, w, h), holes: [] });
const source = (parts: LocalParcelPolygon[]) => unprojectParcelPolygons(parts, origin);
const boundary = source([part()])[0].outer;

afterEach(() => vi.restoreAllMocks());

describe("bounded whole-region envelope", () => {
  it("retains every component and hole with independent net-area arithmetic", () => {
    const result = calcBuildableArea(undefined, 0, 1, 3, false, undefined, {
      polygons: source([{ outer: rectangle(0, 0, 20, 20), holes: [rectangle(4, 4, 4, 4)] }, part(40, 0, 10, 10)]),
    });
    expect(result.geometryStatus).toBe("available");
    expect(result.lotAreaSqm).toBeCloseTo(400 - 16 + 100, 2);
    expect(result.buildable2DSqm).toBeCloseTo(484, 2);
    expect(result.buildable2DPolygons).toHaveLength(2);
    expect(result.buildable2DPolygons!.flatMap(p => p.holes)).toHaveLength(1);
    expect(result.buildable2DRing).toBeNull();
    expect(result.stepped3D[0].ringLngLat).toBeNull();
  });

  it.each([false, true])("preserves northward winding semantics reversed=%s", reversed => {
    const p = source([part()]);
    if (reversed) p[0].outer.reverse();
    const result = calcBuildableArea(undefined, 0.5, 1, 3, true, undefined, { polygons: p });
    expect(result.geometryStatus).toBe("available");
    expect(result.northEdgeCount).toBe(1);
    expect(result.buildable2DSqm).toBeCloseTo(72, 2);
  });

  it("does not cut one component with another component's north edge", () => {
    const result = calcBuildableArea(undefined, 0, 1, 3, true, undefined, { polygons: source([part(), part(0, 30)]) });
    expect(result.buildable2DSqm).toBeCloseTo(170, 2);
    expect(result.buildable2DPolygons).toHaveLength(2);
  });

  it("keeps both lobes when a narrow connecting neck disappears", () => {
    const neck = [[0, 0], [8, 0], [8, 3.8], [16, 3.8], [16, 0], [24, 0], [24, 8], [16, 8], [16, 4.2], [8, 4.2], [8, 8], [0, 8]].map(([x, z]) => ({ x, z }));
    const result = calcBuildableArea(source([{ outer: neck, holes: [] }])[0].outer, 0.5, 1, 3, false);
    expect(result.geometryStatus).toBe("available");
    expect(result.buildable2DPolygons).toHaveLength(2);
    expect(result.buildable2DRing).toBeNull();
    expect(result.buildable2DSqm).toBeGreaterThan(98);
    expect(result.buildable2DSqm).toBeLessThan(99);
  });

  it("keeps useful concave arms under differential setbacks", () => {
    const shape = [[0, 0], [12, 0], [12, 4], [4, 4], [4, 12], [0, 12]].map(([x, z]) => ({ x, z }));
    const result = buildParcelEnvelope({ polygons: source([{ outer: shape, holes: [] }]), sideSetbackM: 0.5,
      edgeSetbacksByPolygon: [[[0.5, 1, 0.5, 0.5, 0.5, 0.5]]], check: () => {} });
    expect(localParcelArea(result.afterSide)).toBeGreaterThan(45);
    // The local origin is the bounds midpoint (6,6); both arms must remain.
    expect(localParcelContainsPoint(result.afterSide, { x: 3, z: -4 })).toBe(true);
    expect(localParcelContainsPoint(result.afterSide, { x: -4, z: 3 })).toBe(true);
  });

  it("uses component/ring/edge identity for differential setbacks", () => {
    const result = calcBuildableArea(boundary, 0.5, 1, 3, false, [2, 1, 1, 1]);
    expect(result.afterSideSetbackSqm).toBeCloseTo(56, 2);
  });

  it("keeps a zero top level without replacing it with a surviving lower level", () => {
    const shortBoundary = source([part(0, 0, 10, 4)])[0].outer;
    const result = calcBuildableArea(shortBoundary, 0, 4, 3, true);
    expect(result.geometryStatus).toBe("available");
    expect(result.buildable2DPolygons).toEqual([]);
    expect(result.stepped3D.map(s => Math.round(s.floorPlateSqm))).toEqual([25, 25, 0, 0]);
    const steps = planningEnvelopeSteps([{ level: 1 }, { level: 4 }, { level: 5 }], result, result, origin);
    expect(steps[1]).toMatchObject({ polygons: [], shape: [], envelopeAreaSqm: 0, envelopeAvailable: true });
    expect(steps[2]).toMatchObject({ polygons: [], shape: [], envelopeAreaSqm: 0, envelopeAvailable: false });
  });

  it("distinguishes total erosion from unavailable source data", () => {
    const empty = calcBuildableArea(boundary, 100, 2, 3, false);
    expect(empty).toMatchObject({ geometryStatus: "available", buildable2DPolygons: [], buildable2DSqm: 0 });
    expect(empty.stepped3D).toHaveLength(2);
    expect(empty.stepped3D.every(s => s.floorPlateSqm === 0 && s.polygons.length === 0)).toBe(true);
    const unknown = calcBuildableArea(undefined, 0.5, 2, 3, false);
    expect(unknown.geometryStatus).toBe("unavailable");
    expect(unknown.buildable2DPolygons).toBeUndefined();
  });

  it.each([[], null, [{ outer: [], holes: [] }], [{ outer: [["127", 37], [127.1, 37], [127.1, 37.1]], holes: [] }]])(
    "never falls back from malformed authoritative topology: %j", invalid => {
      const result = calcBuildableArea(boundary, 0, 1, 3, false, undefined, { polygons: invalid } as unknown as BuildableAreaOptions);
      expect(result.geometryStatus).toBe("unavailable");
      expect(result.buildable2DPolygons).toBeUndefined();
    });

  it("does not silently assign setbacks to touching components", () => {
    const result = calcBuildableArea(undefined, 0.5, 1, 3, false, undefined, { polygons: source([part(), part(10, 0)]) });
    expect(result.geometryStatus).toBe("unavailable");
  });

  it.each([{ floorHeightsM: [3, 0] }, { floorHeightsM: [3, NaN] }, { floorLevels: [1, 1] }, { roofAllowanceM: Infinity }, { edgeSetbacksByPolygon: [[[1]]] }])(
    "rejects malformed height or edge contracts: %j", options => {
      expect(calcBuildableArea(boundary, 0.5, 2, 3, false, undefined, options).geometryStatus).toBe("unavailable");
    });

  it("fails closed on the shared computation deadline", () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(2_001);
    const result = calcBuildableArea(boundary, 0, 1, 3, false);
    expect(result.geometryStatus).toBe("unavailable");
    expect(result.warnings.join()).toContain("시간 초과");
  });
});
