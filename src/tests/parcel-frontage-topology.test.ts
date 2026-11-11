import { describe, expect, it } from "vitest";
import { analyzeParcelFrontage } from "@/lib/geo/road-frontage";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";

const origin: [number, number] = [127, 37.65];
const point = (x: number, z: number): [number, number] => [origin[0] + x / (111_000 * Math.cos(origin[1] * Math.PI / 180)), origin[1] - z / 111_000];
const ring = (values: number[][]) => values.map(([x, z]) => point(x, z));
const rect = (x: number, z: number, w: number, h: number) => ring([[x, z], [x + w, z], [x + w, z + h], [x, z + h]]);

describe("component-aware road frontage", () => {
  it("keeps full ring identity and does not give a remote component access", () => {
    const polygons = [{ outer: rect(0, 0, 10, 10), holes: [rect(2, 2, 2, 2)] }, { outer: rect(40, 0, 10, 10), holes: [] }];
    const result = analyzeParcelFrontage(polygons, [{ name: "access", points: [point(-2, 14), point(12, 14)] }], origin)!;
    expect(result.frontages.map(edge => [edge.polygonIndex, edge.ringIndex, edge.edgeIndex])).toEqual([[0, 0, 2]]);
    expect(result.edgeSetbacksByPolygon).toEqual([[[0.5, 0.5, 0, 0.5], [0.5, 0.5, 0.5, 0.5]], [[0.5, 0.5, 0.5, 0.5]]]);
    expect(result.frontages[0].edge[0].x).toBeCloseTo(10, 6);
    expect(result.frontages[0].roadDistM).toBeCloseTo(4, 6);
  });

  it.each([false, true])("uses winding for the reentrant frontage, reversed=%s", reverse => {
    const outer = ring([[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]]);
    const result = analyzeParcelFrontage([{ outer: reverse ? [...outer].reverse() : outer, holes: [] }],
      [{ name: "courtyard approach", points: [point(11, 20), point(19, 20)] }], origin)!;
    expect(result.frontages).toHaveLength(1);
    expect(result.frontages[0].edge.every(p => Math.abs(p.z - 10) < 1e-6)).toBe(true);
  });

  it("does not infer access through a very thin intervening component", () => {
    const polygons = [{ outer: rect(0, 0, 10, 10), holes: [] }, { outer: rect(0, 11.234, 10, 0.001), holes: [] }];
    const result = analyzeParcelFrontage(polygons, [{ name: null, points: [point(-1, 14), point(11, 14)] }], origin)!;
    expect(result.frontages.some(edge => edge.polygonIndex === 0)).toBe(false);
    expect(result.frontages.some(edge => edge.polygonIndex === 1)).toBe(true);
  });

  it("does not turn hole edges or coincident centerlines into verified entries", () => {
    const polygons = [{ outer: rect(0, 0, 20, 20), holes: [rect(5, 5, 10, 10)] }];
    const result = analyzeParcelFrontage(polygons, [{ name: null, points: [point(6, 10), point(14, 10)] }], origin)!;
    expect(result.frontages).toEqual([]);
    expect(analyzeParcelFrontage([{ outer: rect(0, 0, 10, 10), holes: [] }], [{ name: null, points: [point(0, 10), point(10, 10)] }])!.frontages).toEqual([]);
  });

  it("fails closed for invalid topology and bounded malformed road input", () => {
    expect(analyzeParcelFrontage([], [])).toBeNull();
    expect(analyzeParcelFrontage(null as unknown as Wgs84ParcelPolygon[], [])).toBeNull();
    expect(analyzeParcelFrontage([{ outer: rect(0, 0, 10, 10), holes: [rect(12, 12, 1, 1)] }], [])).toBeNull();
    expect(analyzeParcelFrontage([{ outer: rect(0, 0, 10, 10), holes: [] }], [{ name: null, points: [[NaN, 0], [0, 0]] }])).toBeNull();
    expect(analyzeParcelFrontage([{ outer: rect(0, 0, 10, 10), holes: [] }], [{ name: null, points: Array(10_001).fill(point(0, 0)) }])).toBeNull();
  });
});
