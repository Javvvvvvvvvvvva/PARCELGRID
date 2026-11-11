import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/projects/dynamic/route";
import { parseManualParcelBoundaryGeoJson, validateParcelBoundaryInput } from "@/lib/geo/manual-parcel-boundary";
import { parcelBoundaryPolygons } from "@/lib/geo/parcel-topology";
import { unprojectParcelPolygons } from "@/lib/geo/parcel-envelope";
import type { Parcel } from "@/lib/finance/types";

const rect = (x = 0, z = 0, w = 10, h = 10) => [{ x, z }, { x: x + w, z }, { x: x + w, z: z + h }, { x, z: z + h }];
const parts = unprojectParcelPolygons([{ outer: rect(0, 0, 20, 20), holes: [rect(4, 4, 4, 4)] }, { outer: rect(30), holes: [] }], [127, 37]);
const simple = [{ outer: parts[1].outer, holes: [] }];
const json = (geometry: unknown) => JSON.stringify(geometry);
const geojson = { type: "MultiPolygon", coordinates: parts.map(p => [p.outer, ...p.holes]) };

describe("manual parcel whole-topology input", () => {
  it("preserves holes and components without exposing a partial legacy boundary", () => {
    const parsed = parseManualParcelBoundaryGeoJson(json(geojson));
    expect(parsed.polygons).toHaveLength(2);
    expect(parsed.polygons[0].holes).toHaveLength(1);
    expect(parsed.measuredAreaSqm).toBeCloseTo(484, 2);
    expect(parsed.boundary).toEqual([]);
  });

  it("does not fall back to a valid legacy ring from explicitly empty topology", () => {
    expect(() => validateParcelBoundaryInput({ boundary: simple[0].outer, boundaryPolygons: [] })).toThrow();
    expect(parcelBoundaryPolygons({ boundary: simple[0].outer, boundaryPolygons: [] })).toEqual([]);
  });

  it("rejects conflicting legacy geometry, but accepts reversed equivalent rings", () => {
    expect(() => validateParcelBoundaryInput({ boundary: parts[0].outer, boundaryPolygons: simple })).toThrow("일치하지");
    expect(validateParcelBoundaryInput({ boundary: [...simple[0].outer].reverse(), boundaryPolygons: simple }).boundaryPolygons).toEqual(simple);
    expect(() => validateParcelBoundaryInput({ boundary: parts[0].outer, boundaryPolygons: parts })).toThrow("일부 외곽선");
  });

  it.each(["127", null, true])("rejects coerced coordinate values %j", value => {
    const bad = structuredClone(geojson) as { type: string; coordinates: unknown[][][] };
    bad.coordinates[0][0][0] = [value, 37];
    expect(() => parseManualParcelBoundaryGeoJson(json(bad))).toThrow();
  });

  it("rejects holes outside their owner and overlapping components", () => {
    const badHole = [{ outer: parts[0].outer, holes: [parts[1].outer] }];
    expect(() => validateParcelBoundaryInput({ boundaryPolygons: badHole })).toThrow();
    expect(() => validateParcelBoundaryInput({ boundaryPolygons: [...simple, ...simple] })).toThrow();
  });

  it("limits text size, point count, nesting and cancellation before acceptance", () => {
    expect(() => parseManualParcelBoundaryGeoJson(" ".repeat(1_500_001))).toThrow("크기");
    expect(() => parseManualParcelBoundaryGeoJson(json({ type: "Polygon", coordinates: [Array.from({ length: 10_001 }, () => [127, 37])] }))).toThrow("10,000");
    expect(() => parseManualParcelBoundaryGeoJson(json({ type: "Feature", geometry: geojson, properties: { deeply: JSON.parse("[".repeat(30) + "0" + "]".repeat(30)) } }))).toThrow();
    const controller = new AbortController(); controller.abort();
    expect(() => parseManualParcelBoundaryGeoJson(json(geojson), { signal: controller.signal })).toThrow();
  });
});

const parcel: Parcel = { id: "topology-test", address: "합성 필지", addressRoad: "", lotArea: 100, zoning: "미분류", zoneCode: "", maxFAR: 200, maxBCR: 60,
  heightLimit: 0, setback: { road: 0.5, side: 0.5, rear: 0.5 }, landPrice: 1, estMarketPrice: 1, acquired: "2026-10-27", acquiredPrice: 1 };
async function request(boundaries: Record<string, unknown>) {
  const response = await POST(new NextRequest("http://localhost/api/projects/dynamic", { method: "POST", headers: { "Content-Type": "application/json" }, body: json({ parcel: { ...parcel, ...boundaries } }) }));
  return { status: response.status, body: await response.json() };
}

describe("dynamic intake topology validation gate", () => {
  it("preserves valid complex topology and continues to the independent zoning gate", async () => {
    expect(await request({ boundary: [], boundaryPolygons: parts })).toMatchObject({ status: 422, body: { code: "NO_ELIGIBLE_SCENARIO" } });
  });
  it("rejects a contradictory simple ring beside full topology", async () => {
    expect(await request({ boundary: parts[0].outer, boundaryPolygons: simple })).toMatchObject({ status: 422, body: { code: "INVALID_PARCEL_GEOMETRY" } });
  });
  it("does not let passthrough fields bypass structural validation", async () => {
    expect(await request({ boundary: simple[0].outer, boundaryPolygons: null })).toMatchObject({ status: 422, body: { code: "INVALID_PROJECT_INPUT" } });
    expect(await request({ boundary: simple[0].outer, boundaryPolygons: [] })).toMatchObject({ status: 422, body: { code: "INVALID_PROJECT_INPUT" } });
  });
  it("passes valid topology-only simple input to the subsequent zoning gate", async () => {
    expect(await request({ boundaryPolygons: simple })).toMatchObject({ status: 422, body: { code: "NO_ELIGIBLE_SCENARIO" } });
  });
});
