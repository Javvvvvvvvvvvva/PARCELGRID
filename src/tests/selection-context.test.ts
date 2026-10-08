import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { contextMatchesSelection, selectionContextRequestSchema, selectionContextResponseSchema } from "@/lib/parcels/selection-context";
import { parseSelectionContextLayer, splitCadastralContext } from "@/lib/integrations/vworld-selection-context";
import { POST } from "@/app/api/parcels/selection-context/route";

const request = { pnu: "1132010500102810023", center: { lat: 37.65, lng: 127.025 }, revision: "selection-1" };
const ring = (x = 127.025, y = 37.65, d = 0.0001) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
const feature = (id: string, geometry: { type: string; coordinates: unknown } = { type: "Polygon", coordinates: [ring()] }, properties = {}) => ({ type: "Feature", id, geometry, properties });
const building = (features: unknown[]) => ({ type: "FeatureCollection", features });
const cad = (features: unknown[], total = features.length) => ({ response: { status: "OK", record: { total }, result: { featureCollection: building(features) } } });
const parcel = (id = "1132010500102810024", jimokName = "대") => feature(id, undefined, { pnu: id, jibun: "281-24", jimokName });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("selection map geometry contract", () => {
  it("keeps holes and every multipolygon part at original longitude/latitude", () => {
    const outer = ring(), hole = ring(127.02502, 37.65002, 0.00003), second = ring(127.0253);
    const layer = parseSelectionContextLayer(building([feature("two-parts", { type: "MultiPolygon", coordinates: [[outer, hole], [second]] })]), "buildings", request);
    expect(layer.status).toBe("available");
    expect(layer.features[0].polygons).toEqual([[outer, hole], [second]]);
    expect(layer.sourceUpdatedAt).toBeNull();
  });
  it("normalizes an unmistakably reversed Korean WFS axis without moving shapes", () => {
    const layer = parseSelectionContextLayer(building([feature("yx", { type: "Polygon", coordinates: [ring().map(([x, y]) => [y, x])] })]), "buildings", request);
    expect(layer.features[0].polygons).toEqual([[ring()]]);
    expect(parseSelectionContextLayer(cad([feature("bad-axis", { type: "Polygon", coordinates: [ring().map(([x, y]) => [y, x])] }, { pnu: "1132010500102810024" })]), "parcels", request).status).toBe("partial");
  });
  it("closes an open ring but never replaces a malformed hole with a filled footprint", () => {
    const good = feature("open", { type: "Polygon", coordinates: [ring().slice(0, -1)] });
    const bad = feature("hole", { type: "Polygon", coordinates: [ring(), [[127.02501, 37.65001]]] });
    const layer = parseSelectionContextLayer(building([good, bad]), "buildings", request);
    expect(layer.status).toBe("partial"); expect(layer.omittedCount).toBe(1);
    expect(layer.features.map(f => f.id)).toEqual(["open"]); expect(layer.features[0].polygons).toEqual([[ring()]]);
  });
  it("excludes self intersections, outside holes, projected coordinates and remote shapes", () => {
    const bow = [[127.025, 37.65], [127.0251, 37.6501], [127.025, 37.6501], [127.0251, 37.65], [127.025, 37.65]];
    const layer = parseSelectionContextLayer(building([
      feature("bow", { type: "Polygon", coordinates: [bow] }),
      feature("outside-hole", { type: "Polygon", coordinates: [ring(), ring(127.026)] }),
      feature("projected", { type: "Polygon", coordinates: [[[200000, 450000], [200010, 450000], [200010, 450010], [200000, 450000]]] }),
      feature("remote", { type: "Polygon", coordinates: [ring(129, 36)] }),
    ]), "buildings", request);
    expect(layer.features).toEqual([]); expect(layer.omittedCount).toBe(3); expect(layer.status).toBe("partial");
  });
  it("separates road parcels, excludes only the selected cadastral PNU, and retains its building", () => {
    const layer = parseSelectionContextLayer(cad([parcel(request.pnu), parcel(), parcel("1132010500102810025", "도로")]), "parcels", request);
    const split = splitCadastralContext(structuredClone(layer));
    expect(split.parcels.features.map(f => f.pnu)).toEqual(["1132010500102810024"]);
    expect(split.roads.features.map(f => f.kind)).toEqual(["road"]);
    expect(parseSelectionContextLayer(building([feature("selected-building", undefined, { pnu: request.pnu })]), "buildings", request).features).toHaveLength(1);
  });
  it("distinguishes explicit zero results from malformed or denied provider responses", () => {
    expect(parseSelectionContextLayer(cad([]), "parcels", request).status).toBe("empty");
    expect(parseSelectionContextLayer({ response: { status: "NOT_FOUND" } }, "parcels", request).status).toBe("empty");
    for (const payload of [{}, { response: { status: "ERROR" } }, { response: { status: "OK", result: {} } }]) {
      expect(() => parseSelectionContextLayer(payload, "parcels", request)).toThrow();
    }
    expect(() => parseSelectionContextLayer({ error: "key denied" }, "buildings", request)).toThrow();
    expect(() => parseSelectionContextLayer({ ...building([]), crs: { properties: { name: "EPSG:3857" } } }, "buildings", request)).toThrow(/CRS/);
  });
  it("marks capped results partial even if every returned shape is valid", () => {
    const layer = parseSelectionContextLayer(cad([parcel()], 150), "parcels", request);
    expect(layer.status).toBe("partial"); expect(layer.limited).toBe(true);
    expect(splitCadastralContext(layer).roads.status).toBe("partial");
    const capped = parseSelectionContextLayer(building(Array.from({ length: 101 }, (_, i) => feature(String(i)))), "buildings", request);
    expect(capped.features).toHaveLength(100); expect(capped.status).toBe("partial");
  });
  it("requires the exact PNU, center and selection revision, including repeat visits to one parcel", () => {
    const layer = parseSelectionContextLayer(building([]), "buildings", request);
    const context = { ...request, layers: { parcels: layer, buildings: layer, roads: layer } };
    expect(contextMatchesSelection(context, request)).toBe(true);
    for (const changed of [{ ...request, pnu: "1132010500102810024" }, { ...request, revision: "selection-2" }, { ...request, center: { ...request.center, lng: 127.026 } }]) expect(contextMatchesSelection(context, changed)).toBe(false);
    expect(selectionContextRequestSchema.safeParse({ ...request, center: { lat: 127.025, lng: 37.65 } }).success).toBe(false);
  });
});

describe("lightweight selection context endpoint", () => {
  const call = (body: unknown = request) => POST(new NextRequest("http://localhost/api/parcels/selection-context", { method: "POST", body: JSON.stringify(body) }));
  it("rejects an invalid selection before calling any provider", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await call({ ...request, pnu: "demo" })).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns unavailable without network calls when the provider is disabled", async () => {
    vi.stubEnv("VWORLD_ENABLED", "false"); vi.stubEnv("VWORLD_API_KEY", "synthetic-key");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await call(), body = selectionContextResponseSchema.parse(await response.json());
    expect(body.layers.buildings.status).toBe("unavailable"); expect(body.revision).toBe(request.revision);
    expect(fetchMock).not.toHaveBeenCalled(); expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("keeps cadastral success when building WFS fails and never fetches registries or finances", async () => {
    vi.stubEnv("VWORLD_ENABLED", "true"); vi.stubEnv("VWORLD_API_KEY", "synthetic-key");
    const fetchMock = vi.fn(async (input: URL) => input.pathname === "/req/data" ? new Response(JSON.stringify(cad([parcel()]))) : new Response("WFS unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = selectionContextResponseSchema.parse(await (await call()).json());
    expect(body.layers.parcels.status).toBe("available"); expect(body.layers.buildings.status).toBe("error");
    expect(body.layers.roads.status).toBe("empty"); expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) { expect(url.host).toBe("api.vworld.kr"); expect(url.searchParams.get("BBOX") ?? url.searchParams.get("geomFilter")).toBeTruthy(); }
  });
  it("reports both upstream failures as errors instead of fabricating empty surroundings", async () => {
    vi.stubEnv("VWORLD_ENABLED", "true"); vi.stubEnv("VWORLD_API_KEY", "synthetic-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic private upstream details")));
    const body = await (await call()).json();
    expect(Object.values(body.layers).map(layer => (layer as { status: string }).status)).toEqual(["error", "error", "error"]);
    expect(JSON.stringify(body)).not.toContain("private upstream");
  });
});
