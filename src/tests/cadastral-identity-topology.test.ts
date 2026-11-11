import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { area, multiPolygon } from "@turf/turf";
import { normalizeRoadLines } from "@/lib/geo/normalize-road-lines";

const pnu = "1132010500102810023";
const ring = (x = 127, y = 37, size = 0.001) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const feature = (id = pnu, coordinates = [ring()]) => ({ geometry: { type: "Polygon", coordinates }, properties: { pnu: id, jibun: "281-23", jimokName: "대" } });
const response = (features: unknown[]) => Response.json({ response: { status: "OK", result: { featureCollection: { features } } } });
function mockFeatures(features: unknown[], roads: unknown[] = []) {
  const fetchMock = vi.fn(async (input: string) => response(new URL(input).searchParams.get("data") === "LT_L_SPRD" ? roads : features));
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}
beforeEach(() => { vi.resetModules(); vi.stubEnv("VWORLD_ENABLED", "true"); vi.stubEnv("VWORLD_API_KEY", "synthetic-key"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("cadastral identity selection", () => {
  it("does not substitute a nearby containing parcel for the requested PNU", async () => {
    const fetchMock = mockFeatures([feature("1132010500102810024")]);
    expect(await (await import("@/lib/integrations/vworld")).lookupCadastral(37.0005, 127.0005, { pnu })).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("matches the full PNU, including legal dong and mountain category", async () => {
    mockFeatures([feature("1132010500202810023"), feature("1132010600102810023"), feature()]);
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37.0005, 127.0005, { pnu });
    expect(result?.pnu).toBe(pnu);
    expect(result?.polygons).toEqual([[ring()]]);
  });
  it("matches a complete lot/mountain hint using PNU when optional lot fields are absent", async () => {
    mockFeatures([feature("1132010500202810023"), feature()]);
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37.0005, 127.0005, { mainAddressNo: "0281", subAddressNo: "0023", mountainYn: "Y" });
    expect(result?.pnu).toBe("1132010500202810023");
  });
  it("uses containment, not nearest-centroid fallback, without an identity hint", async () => {
    mockFeatures([feature()]);
    expect(await (await import("@/lib/integrations/vworld")).lookupCadastral(37.002, 127.002)).toBeNull();
  });
  it("rejects ambiguity on a shared parcel edge but accepts an exact identity", async () => {
    mockFeatures([feature(), feature("1132010500102810024", [ring(127.001)])]);
    const api = await import("@/lib/integrations/vworld");
    await expect(api.lookupCadastral(37.0005, 127.001)).rejects.toBeInstanceOf(api.CadastralIdentityError);
    expect((await api.lookupCadastral(37.0005, 127.001, { pnu }))?.pnu).toBe(pnu);
  });
  it("deduplicates exact repeated features but never selects the first of conflicting same-PNU features", async () => {
    mockFeatures([feature(), feature()]);
    const api = await import("@/lib/integrations/vworld");
    expect((await api.lookupCadastral(37.0005, 127.0005, { pnu }))?.pnu).toBe(pnu);
    mockFeatures([feature(), feature(pnu, [ring(127.002)])]);
    await expect(api.lookupCadastral(37.0005, 127.0005, { pnu })).rejects.toBeInstanceOf(api.CadastralIdentityError);
  });
  it.each([null, {}, { pnu: 1132010500102810023 }, { pnu: "11320" }, { pnu, jibun: {} }, { pnu, bonbun: "282" }, { pnu, bubun: "23suffix" }, { pnu, jiga: "123won" }, { pnu, jiga: "-1" }])("rejects malformed/contradictory attributes rather than inventing facts %#", async properties => {
    mockFeatures([{ ...feature(), properties }]);
    await expect((await import("@/lib/integrations/vworld")).lookupCadastral(37.0005, 127.0005, { pnu })).rejects.toThrow("V-World cadastral");
  });
  it("retains decimal unit prices rather than truncating them", async () => {
    mockFeatures([{ ...feature(), properties: { ...feature().properties, jiga: "1234.5" } }]);
    expect((await (await import("@/lib/integrations/vworld")).lookupCadastral(37.0005, 127.0005))?.landPriceWonPerSqm).toBe(1234.5);
  });
});

describe("source topology preservation", () => {
  it("excludes the identified target before interpreting its unsupported topology", async () => {
    mockFeatures([feature(pnu, [ring(), ring(127.0002, 37.0002, 0.0002)]), feature("1132010500102810024", [ring(127.0005, 37, 0.0001)])]);
    const neighbors = await (await import("@/lib/integrations/vworld")).fetchNearbyCadastralParcels(37, 127, { excludePnu: pnu });
    expect(neighbors.map(parcel => parcel.pnu)).toEqual(["1132010500102810024"]);
  });
  it.each([{ coordinates: [[127, 37], [127, 37]] }, { coordinates: [[127, 37, 1], [127, 37, 2]] }])("rejects zero-length road parts instead of reporting available roads %#", async ({ coordinates }) => {
    mockFeatures([feature()], [{ geometry: { type: "LineString", coordinates }, properties: { rn: "Degenerate" } }]);
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37.0005, 127.0005);
    expect(result?.roads).toEqual([]);
    expect(result?.roadsEvidence).toMatchObject({ status: "unavailable", resultCount: null });
  });
  it("rejects a dense star without building an intersection collection", async () => {
    const count = 4001, step = 2000;
    const vertices = Array.from({ length: count }, (_, i) => {
      const angle = 2 * Math.PI * ((i * step) % count) / count;
      return [127 + 0.001 * Math.cos(angle), 37 + 0.001 * Math.sin(angle)];
    });
    vertices.push(vertices[0]);
    const fetchMock = mockFeatures([feature(pnu, [vertices])]);
    await expect((await import("@/lib/integrations/vworld")).lookupCadastral(37, 127, { pnu })).rejects.toThrow("self-intersects");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("keeps disconnected MultiLineString parts even when the gap is smaller than the legacy split threshold", async () => {
    const parts = [[[127, 37], [127.0001, 37]], [[127.00015, 37.00005], [127.00025, 37.00005]]];
    mockFeatures([feature()], [{ geometry: { type: "MultiLineString", coordinates: parts }, properties: { rn: "Separated road" } }]);
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37.0005, 127.0005);
    expect(result?.roads.map(road => road.points)).toEqual(parts);
    expect(normalizeRoadLines(result!.roads).map(road => road.points)).toEqual(parts);
  });
  it("retains holes and their area instead of supplying a filled automatic boundary", async () => {
    const polygons = [[ring(), ring(127.0002, 37.0002, 0.0002)]];
    mockFeatures([feature(pnu, polygons[0])]);
    const api = await import("@/lib/integrations/vworld");
    const error = await api.lookupCadastral(37.0001, 127.0001, { pnu }).catch(error => error);
    expect(error).toBeInstanceOf(api.CadastralGeometryError);
    expect(error.sourceGeometry.polygons).toEqual(polygons);
    expect(error.sourceGeometry.measuredAreaSqm).toBeCloseTo(area(multiPolygon(polygons)), 1);
    expect(error.sourceGeometry.measuredAreaSqm).toBeLessThan(area(multiPolygon([[ring()]])));
  });
  it("does not identify a point inside a hole as part of that parcel", async () => {
    mockFeatures([feature(pnu, [ring(), ring(127.0002, 37.0002, 0.0002)])]);
    expect(await (await import("@/lib/integrations/vworld")).lookupCadastral(37.0003, 127.0003)).toBeNull();
  });
  it("retains every MultiPolygon component even when the address is in the second one", async () => {
    const polygons = [[ring()], [ring(127.002, 37, 0.0005)]];
    mockFeatures([{ ...feature(), geometry: { type: "MultiPolygon", coordinates: polygons } }]);
    const api = await import("@/lib/integrations/vworld");
    const error = await api.lookupCadastral(37.0002, 127.0022).catch(error => error);
    expect(error).toBeInstanceOf(api.CadastralGeometryError);
    expect(error.sourceGeometry.polygons).toEqual(polygons);
    expect(error.sourceGeometry.measuredAreaSqm).toBeCloseTo(area(multiPolygon(polygons)), 1);
  });
  it("accepts a single-ring MultiPolygon without silently dropping anything", async () => {
    mockFeatures([{ ...feature(), geometry: { type: "MultiPolygon", coordinates: [[ring()]] } }]);
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37.0005, 127.0005, { pnu });
    expect(result?.boundary).toEqual(ring());
    expect(result?.lotAreaSqm).toBeCloseTo(area(multiPolygon([[ring()]])), 1);
  });
  it("rejects an asymmetric self-crossing boundary", async () => {
    mockFeatures([feature(pnu, [[[127, 37], [127.002, 37.002], [127, 37.001], [127.001, 37], [127, 37]]])]);
    await expect((await import("@/lib/integrations/vworld")).lookupCadastral(37, 127, { pnu })).rejects.toThrow("self-intersects");
  });
  it("rejects a five-millimeter crossing in an otherwise ordinary parcel", async () => {
    const coordinates = [[0, 0], [10, 0], [10, 10], [5.005, 10], [5, 10.005], [5.005, 10.005], [5, 10], [0, 10], [0, 0]]
      .map(([x, y]) => [127 + x / (111320 * Math.cos(37 * Math.PI / 180)), 37 + y / 110540]);
    mockFeatures([feature(pnu, [coordinates])]);
    await expect((await import("@/lib/integrations/vworld")).lookupCadastral(37, 127, { pnu })).rejects.toThrow("self-intersects");
  });
  it("uses longitude-scaled nearby bounds and carries caller cancellation to fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      const bbox = new URL(input).searchParams.get("geomFilter")!.slice(4, -1).split(",").map(Number);
      expect((bbox[2] - bbox[0]) * 111000 * Math.cos(37 * Math.PI / 180)).toBeCloseTo(150, 5);
      expect((bbox[3] - bbox[1]) * 111000).toBeCloseTo(150, 5);
      controller.abort(); expect(init.signal?.aborted).toBe(true);
      throw new DOMException("interrupted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect((await import("@/lib/integrations/vworld")).fetchNearbyCadastralParcels(37, 127, { signal: controller.signal })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
