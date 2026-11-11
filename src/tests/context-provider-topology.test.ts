import { area, polygon } from "@turf/turf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CadastralParcelFeature } from "@/lib/geo/cadastral-context";
import type { ParsedUpisRoadResult } from "@/lib/integrations/vworld-upis-roads";

const center = { lng: 127, lat: 37 };
const targetPnu = "1132010500102810023";
const pnu = "1132010500102810024";
type Provider = "cadastral" | "upis";
type Ring = [number, number][];
type Geometry = { type: string; coordinates: unknown };
type SourceFeature = { geometry: Geometry; properties: Record<string, unknown> };
type Options = { radiusM?: number; maxCount?: number; signal?: AbortSignal; outerDeadline?: number };

function ring(points: [number, number][]): Ring {
  return points.map(([x, y]) => [
    center.lng + x / (111_000 * Math.cos(center.lat * Math.PI / 180)),
    center.lat + y / 111_000,
  ]);
}

function box(x: number, y: number, width: number, height: number): Ring {
  return ring([[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]]);
}

function feature(provider: Provider, geometry: Geometry, id = pnu): SourceFeature {
  return {
    geometry,
    properties: provider === "cadastral"
      ? { pnu: id, jibun: "281-24", jimokName: "도로", jimokCd: "14" }
      : { present_sn: id, dgm_nm: "Synthetic road", dgm_ar: "600", dgm_lt: 30 },
  };
}

function body(features: unknown[]) {
  return { response: { status: "OK", result: { featureCollection: { features } } } };
}

async function invoke(provider: Provider, options: Options = {}): Promise<ParsedUpisRoadResult> {
  if (provider === "cadastral") {
    const { fetchCadastralContextParcels } = await import("@/lib/integrations/vworld-cadastral-context");
    return { parcels: await fetchCadastralContextParcels({ center, targetPnu, ...options }), summaries: [] };
  }
  return (await import("@/lib/integrations/vworld-upis-roads")).fetchUpisRoadBoundaries({ center, ...options });
}

async function read(provider: Provider, features: unknown[], options: Options = {}) {
  vi.mocked(fetch).mockImplementation(async () => Response.json(body(features)));
  return invoke(provider, options);
}

function expectedId(provider: Provider, id = pnu) {
  return provider === "cadastral" ? id : `UPIS-${id}-1`;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VWORLD_API_KEY", "synthetic-topology-key");
  vi.stubEnv("VWORLD_API_DOMAIN", "https://example.invalid");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected unstubbed provider request"); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each<Provider>(["cadastral", "upis"])("%s context topology", provider => {
  it("preserves all multipolygon parts and holes with their total net area", async () => {
    const first = box(-20, -20, 40, 40), firstHole = box(-5, -5, 10, 10);
    const second = box(45, -10, 20, 20), secondHole = box(50, -5, 5, 5);
    const source = feature(provider, { type: "MultiPolygon", coordinates: [[first, firstHole], [second, secondHole]] });
    const result = await read(provider, [source]);

    expect(result.parcels).toHaveLength(1);
    const parcel = result.parcels[0];
    expect(parcel).toMatchObject({
      pnu: expectedId(provider), boundary: [],
      polygons: [{ outer: first, holes: [firstHole] }, { outer: second, holes: [secondHole] }],
    });
    const expectedArea = area(polygon([first])) + area(polygon([second]))
      - area(polygon([firstHole])) - area(polygon([secondHole]));
    expect(parcel.lotAreaSqm).toBeCloseTo(expectedArea, 2);
    expect(parcel.distanceM).toBeCloseTo(5, 0);
    if (provider === "upis") expect(result.summaries[0]).toMatchObject({ presentSn: pnu, featurePartCount: 2 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("populates legacy boundary only for a single part without holes", async () => {
    const outer = box(5, -10, 20, 20);
    const { parcels } = await read(provider, [feature(provider, { type: "Polygon", coordinates: [outer] })]);
    expect(parcels[0].polygons).toEqual([{ outer, holes: [] }]);
    expect(parcels[0].boundary).toEqual(provider === "cadastral" ? outer : outer.slice(0, -1));

    const hole = box(10, -5, 5, 5);
    const complex = await read(provider, [feature(provider, { type: "Polygon", coordinates: [outer, hole] })]);
    expect(complex.parcels[0].boundary).toEqual([]);
    expect(complex.parcels[0].polygons).toEqual([{ outer, holes: [hole] }]);
  });

  it("keeps the entire feature when only a later component is nearby", async () => {
    const far = box(1000, -5, 20, 10), near = box(5, -5, 10, 10);
    const { parcels } = await read(provider, [feature(provider, { type: "MultiPolygon", coordinates: [[far], [near]] })],
      { radiusM: 20, maxCount: 1 });
    expect(parcels).toHaveLength(1);
    expect(parcels[0].polygons).toEqual([{ outer: far, holes: [] }, { outer: near, holes: [] }]);
    expect(parcels[0].lotAreaSqm).toBeCloseTo(area(polygon([far])) + area(polygon([near])), 2);
    expect(parcels[0].distanceM).toBeCloseTo(5, 0);
  });

  it("selects long roads by their nearby edge and sorts by actual proximity", async () => {
    const ordinary = feature(provider, { type: "Polygon", coordinates: [box(15, -5, 10, 10)] }, "1132010500102810025");
    const longRoad = feature(provider, { type: "Polygon", coordinates: [box(3, -5, 1000, 10)] });
    const result = await read(provider, [ordinary, longRoad], { radiusM: 20, maxCount: 1 });
    expect(result.parcels).toHaveLength(1);
    expect(result.parcels[0].pnu).toBe(expectedId(provider));
    expect(result.parcels[0].distanceM).toBeCloseTo(3, 0);
    if (provider === "upis") expect(result.summaries.map(s => s.presentSn)).toEqual([pnu]);
  });

  it("treats a point inside the filled polygon as zero distance", async () => {
    const { parcels } = await read(provider, [feature(provider, { type: "Polygon", coordinates: [box(-100, -100, 200, 200)] })],
      { radiusM: 1 });
    expect(parcels).toHaveLength(1);
    expect(parcels[0].distanceM).toBe(0);
  });

  it("does not treat a point inside a hole as covered by the polygon", async () => {
    const donut = feature(provider, { type: "Polygon", coordinates: [box(-100, -100, 200, 200), box(-80, -80, 160, 160)] });
    const result = await read(provider, [donut], { radiusM: 20 });
    expect(result.parcels).toEqual([]);
    expect(result.summaries).toEqual([]);
  });

  it("preserves a separate filled island inside another component's hole", async () => {
    const outer = box(-100, -100, 200, 200), hole = box(-80, -80, 160, 160), island = box(-5, -5, 10, 10);
    const { parcels } = await read(provider, [feature(provider, { type: "MultiPolygon", coordinates: [[outer, hole], [island]] })],
      { radiusM: 1 });
    expect(parcels[0].polygons).toHaveLength(2);
    expect(parcels[0].distanceM).toBe(0);
  });

  it("deduplicates exact copies without double-counting their geometry", async () => {
    const source = feature(provider, { type: "MultiPolygon", coordinates: [[box(5, -5, 10, 10)], [box(40, -5, 10, 10)]] });
    const result = await read(provider, [source, structuredClone(source)]);
    expect(result.parcels).toHaveLength(1);
    expect(result.parcels[0].polygons).toHaveLength(2);
    if (provider === "upis") expect(result.summaries).toHaveLength(1);
  });

  it.each(["split component", "changed hole", "conflicting metadata"])("rejects duplicate identities with %s", async change => {
    const source = feature(provider, { type: "Polygon", coordinates: [box(5, -10, 20, 20)] });
    const conflicting = structuredClone(source);
    if (change === "split component") conflicting.geometry = { type: "Polygon", coordinates: [box(1000, -10, 20, 20)] };
    if (change === "changed hole") conflicting.geometry = { type: "Polygon", coordinates: [box(5, -10, 20, 20), box(10, -5, 5, 5)] };
    if (change === "conflicting metadata") conflicting.properties[provider === "cadastral" ? "jimokName" : "excut_se"] = "changed";
    await expect(read(provider, [source, conflicting], { radiusM: 20, maxCount: 1 })).rejects.toThrow("duplicate identity conflict");
    await expect(read(provider, [conflicting, source], { radiusM: 20, maxCount: 1 })).rejects.toThrow("duplicate identity conflict");
  });

  it.each([
    { name: "self crossing outer", geometry: { type: "Polygon", coordinates: [ring([[0, 0], [30, 20], [0, 20], [20, 0], [0, 0]])] } },
    { name: "hole outside outer", geometry: { type: "Polygon", coordinates: [box(-10, -10, 20, 20), box(30, 30, 5, 5)] } },
    { name: "overlapping holes", geometry: { type: "Polygon", coordinates: [box(-20, -20, 40, 40), box(-5, -5, 10, 10), box(0, 0, 10, 10)] } },
    { name: "self crossing hole", geometry: { type: "Polygon", coordinates: [box(-20, -20, 60, 60), ring([[0, 0], [30, 20], [0, 20], [20, 0], [0, 0]])] } },
    { name: "overlapping parts", geometry: { type: "MultiPolygon", coordinates: [[box(-10, -10, 20, 20)], [box(0, 0, 20, 20)]] } },
    { name: "degenerate ring", geometry: { type: "Polygon", coordinates: [ring([[0, 0], [10, 0], [20, 0], [0, 0]])] } },
  ])("rejects $name instead of silently dropping geometry", async ({ geometry }) => {
    await expect(read(provider, [feature(provider, geometry)])).rejects.toThrow("context topology invalid");
  });

  it("validates malformed later components even when a first component is usable", async () => {
    const coordinates = [[box(5, -5, 10, 10)], [[[127, 37], [127, "37"], [128, 37], [127, 37]]]];
    await expect(read(provider, [feature(provider, { type: "MultiPolygon", coordinates })])).rejects.toThrow("V-World feature response invalid");
  });

  it.each([{}, { response: { status: "OK" } }, { response: { status: "ERROR" } }])("rejects unavailable response envelopes %#", async response => {
    vi.mocked(fetch).mockImplementation(async () => Response.json(response));
    await expect(invoke(provider)).rejects.toThrow("V-World feature response invalid or unavailable");
  });

  it("retains explicit empty and NOT_FOUND results", async () => {
    expect((await read(provider, [])).parcels).toEqual([]);
    vi.mocked(fetch).mockImplementation(async () => Response.json({ response: { status: "NOT_FOUND" } }));
    expect((await invoke(provider)).parcels).toEqual([]);
  });

  it("propagates caller cancellation without starting a request", async () => {
    await expect(invoke(provider, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares the fetch deadline with topology validation", async () => {
    const geometry = await import("@/lib/planning/planning-geometry");
    const project = geometry.planningRingToLocalMeters;
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(geometry, "planningRingToLocalMeters").mockImplementation((...args) => {
      now = 12_101;
      return project(...args);
    });
    await expect(read(provider, [feature(provider, { type: "Polygon", coordinates: [box(5, -5, 10, 10)] })]))
      .rejects.toMatchObject({ name: "TimeoutError", code: "REQUEST_TIMEOUT" });
  });
});

describe("context provider properties", () => {
  it.each([
    { pnu: "" }, { pnu: Number(pnu) }, { pnu: "not-a-pnu" }, { jimokName: {} }, { jibun: [] },
    { bonbun: "9999" }, { bubun: "invalid" },
  ])("rejects invalid cadastral properties %#", async properties => {
    const source = feature("cadastral", { type: "Polygon", coordinates: [box(5, -5, 10, 10)] });
    Object.assign(source.properties, properties);
    await expect(read("cadastral", [source])).rejects.toThrow(/context (properties invalid|identity inconsistent)/);
  });

  it("uses validated lot numbers for cadastral labels and excludes the target", async () => {
    const source = feature("cadastral", { type: "Polygon", coordinates: [box(5, -5, 10, 10)] });
    source.properties = { pnu, bonbun: "0281", bubun: "0024" };
    const target = feature("cadastral", source.geometry, targetPnu);
    const result = await read("cadastral", [source, target]);
    expect(result.parcels.map(parcel => [parcel.pnu, parcel.jibun])).toEqual([[pnu, "281-24"]]);
  });

  it.each([
    { present_sn: "" }, { present_sn: {} }, { dgm_nm: [] }, { dgm_ar: "unknown" }, { dgm_ar: -1 },
    { dgm_lt: true }, { PRESENT_SN: "conflicting-id" },
  ])("rejects invalid UPIS properties %#", async properties => {
    const source = feature("upis", { type: "Polygon", coordinates: [box(5, -5, 10, 10)] });
    Object.assign(source.properties, properties);
    await expect(read("upis", [source])).rejects.toThrow(/V-World UPIS road/);
  });

  it("validates direct UPIS parser calls as well as fetched responses", async () => {
    const { parseUpisRoadFeatures } = await import("@/lib/integrations/vworld-upis-roads");
    for (const coordinates of [[], [box(5, -5, 10, 10).slice(0, -1)], [[null]]]) {
      expect(() => parseUpisRoadFeatures({
        center, radiusM: 120, maxCount: 10,
        features: [feature("upis", { type: "Polygon", coordinates })],
      })).toThrow("context geometry invalid");
    }
    expect(() => parseUpisRoadFeatures({ center, radiusM: 120, maxCount: 10, features: [{}] }))
      .toThrow("UPIS road features invalid");
  });

  it("preserves cadastral road priority while using nearest distance within a class", async () => {
    const road = feature("cadastral", { type: "Polygon", coordinates: [box(20, -5, 5, 10)] });
    const lot = feature("cadastral", { type: "Polygon", coordinates: [box(2, -5, 5, 10)] }, "1132010500102810025");
    lot.properties.jimokName = "대";
    const { parcels } = await read("cadastral", [lot, road]);
    expect(parcels.map((parcel: CadastralParcelFeature) => parcel.pnu)).toEqual([pnu, "1132010500102810025"]);
  });
});
