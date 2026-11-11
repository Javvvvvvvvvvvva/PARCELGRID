import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  geocode: vi.fn(),
  currentBuilding: vi.fn(),
  neighborBuilding: vi.fn(),
  geometry: vi.fn(),
  context: vi.fn(),
}));

vi.mock("@/lib/auth/request", () => ({ requireApiCapability: async () => ({ ok: true }) }));
vi.mock("@/lib/integrations/kakao", () => ({ geocodeAddress: mocks.geocode }));
vi.mock("@/lib/integrations/molit-building", () => ({
  lookupBuildingByJibun: mocks.currentBuilding,
  lookupBuildingByPnu: mocks.neighborBuilding,
  estimateUnitAreaSqm: () => null,
}));
vi.mock("@/lib/integrations/vworld-buildings-client", () => ({ fetchExistingBuildingGeometry: mocks.geometry }));
vi.mock("@/lib/integrations/vworld-cadastral-context", () => ({ fetchCadastralContextParcels: mocks.context }));

const pnu = "1132010500100010000";
const boundary = [[127, 37], [127.0001, 37], [127.0001, 37.0001], [127, 37.0001], [127, 37]];
const parcelFeature = {
  geometry: { type: "Polygon", coordinates: [boundary] },
  properties: { pnu, jibun: "1", jimokName: "대" },
};
const roadFeature = {
  geometry: { type: "LineString", coordinates: [[127, 37], [127.001, 37.001]] },
  properties: { rn: "Test road" },
};
const geocode = {
  address: "Test address", roadAddress: null, lat: 37, lng: 127,
  bCode: "1132010500", lawdCd: "11320", sido: "Test", sigungu: "Test", dong: "Test",
  jibun: "1", mainAddressNo: "1", subAddressNo: "", mountainYn: "N",
};
const emptyGeometry = { source: "vworld-dt_d010", status: "not_found", footprints: [], queryFeatureCount: 0 };
const secret = "https://provider.invalid/?key=synthetic-private-key";
const featureResponse = (features: unknown[]) => ({ response: { status: "OK", result: { featureCollection: { features } } } });

function nearbyRequest(query = "lat=37&lng=127") {
  return new NextRequest(`http://localhost/api/parcels/nearby-context?${query}`);
}

function lookupRequest() {
  return new NextRequest("http://localhost/api/parcels/lookup", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "Test address" }),
  });
}

function successfulFetch(roads: unknown = featureResponse([roadFeature])) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("getLandUseAttr")) {
      return Response.json({ landUses: { field: [{ prposAreaDstrcCode: "UQA122", prposAreaDstrcCodeNm: "제2종일반주거지역" }] } });
    }
    return Response.json(url.searchParams.get("data") === "LT_L_SPRD" ? roads : featureResponse([parcelFeature]));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const failures = [
  { name: "provider error", response: () => Response.json({ response: { status: "ERROR", error: { text: secret } } }) },
  { name: "missing success collection", response: () => Response.json({ response: { status: "OK" } }) },
  { name: "malformed JSON", response: () => new Response(`invalid ${secret}`) },
  { name: "malformed feature", response: () => Response.json(featureResponse([null])) },
  { name: "HTTP denial", response: () => new Response(secret, { status: 403 }) },
  { name: "transport failure", response: (): Response => { throw new Error(secret, { cause: "private-cause" }); } },
  { name: "timeout", response: (): Response => { throw new DOMException(secret, "TimeoutError"); } },
];

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("VWORLD_ENABLED", "true");
  vi.stubEnv("VWORLD_API_KEY", "synthetic-private-key");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected test fetch"); }));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.geocode.mockResolvedValue(geocode);
  mocks.currentBuilding.mockResolvedValue(null);
  mocks.neighborBuilding.mockResolvedValue(null);
  mocks.geometry.mockResolvedValue(emptyGeometry);
  mocks.context.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("optional road evidence", () => {
  it.each(failures)("preserves cadastral success with unavailable roads after $name", async ({ response }) => {
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(async () => Response.json(featureResponse([parcelFeature])))
      .mockImplementationOnce(async () => response()));
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37, 127);
    expect(result).toMatchObject({
      pnu, boundary, roads: [],
      roadsEvidence: { source: "LT_L_SPRD", status: "unavailable", resultCount: null, issue: "request-failed" },
    });
    expect(result?.lotAreaSqm).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each([featureResponse([]), { response: { status: "NOT_FOUND" } }])("records successful zero road results %#", async (roads) => {
    successfulFetch(roads);
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37, 127);
    expect(result).toMatchObject({ pnu, roads: [], roadsEvidence: { status: "empty", resultCount: 0, issue: null } });
  });

  it("preserves successful road data with its evidence", async () => {
    successfulFetch();
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37, 127);
    expect(result).toMatchObject({
      pnu, roads: [{ name: "Test road", points: roadFeature.geometry.coordinates }],
      roadsEvidence: { status: "available", resultCount: 1 },
    });
  });

  it("does not accept malformed road properties as usable data", async () => {
    successfulFetch(featureResponse([{ ...roadFeature, properties: { rn: { private: secret } } }]));
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37, 127);
    expect(result).toMatchObject({ pnu, roads: [], roadsEvidence: { status: "unavailable" } });
  });
});

describe("nearby parcel failure and empty contracts", () => {
  it.each(failures)("rejects $name and returns static failure without a zero count", async ({ response }) => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const { fetchNearbyCadastralParcels } = await import("@/lib/integrations/vworld");
    await expect(fetchNearbyCadastralParcels(37, 127)).rejects.toThrow();
    const result = await (await import("@/app/api/parcels/nearby-context/route")).GET(nearbyRequest());
    const payload = await result.json();
    expect(result.status).toBe(502);
    expect(payload).toEqual({
      code: "VWORLD_NEARBY_UNAVAILABLE", error: "VWorld 주변 필지 데이터를 확인하지 못했습니다.", retryable: true,
      sourceEvidence: { cadastral: { source: "LP_PA_CBND_BUBUN", status: "unavailable", resultCount: null, issue: "request-failed" } },
    });
    expect(payload).not.toHaveProperty("count");
    expect(payload).not.toHaveProperty("neighbors");
    expect(JSON.stringify(payload)).not.toMatch(/synthetic-private-key|provider\.invalid|private-cause/);
    expect(mocks.neighborBuilding).not.toHaveBeenCalled();
  });

  it.each([featureResponse([]), { response: { status: "NOT_FOUND" } }])("keeps a normal empty result successful %#", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    const result = await (await import("@/app/api/parcels/nearby-context/route")).GET(nearbyRequest());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ neighbors: [], count: 0, sourceEvidence: { cadastral: { status: "empty", resultCount: 0 } } });
    expect(mocks.neighborBuilding).not.toHaveBeenCalled();
  });

  it("keeps successful cadastral data when an optional building lookup fails", async () => {
    successfulFetch();
    mocks.neighborBuilding.mockRejectedValue(new Error(secret));
    const result = await (await import("@/app/api/parcels/nearby-context/route")).GET(nearbyRequest());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      count: 1, neighbors: [{ pnu, boundary, building: null }],
      sourceEvidence: { cadastral: { status: "available", resultCount: 1 } },
    });
  });

  it("keeps exclusion as successful empty data", async () => {
    successfulFetch();
    const result = await (await import("@/app/api/parcels/nearby-context/route")).GET(nearbyRequest(`lat=37&lng=127&pnu=${pnu}`));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ count: 0, sourceEvidence: { cadastral: { status: "empty" } } });
  });

  it.each([null, {}, { pnu: "" }, { pnu: {} }, { pnu, jibun: {} }])("does not silently drop malformed parcel properties %#", async (properties) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(featureResponse([{ ...parcelFeature, properties }]))));
    const result = await (await import("@/app/api/parcels/nearby-context/route")).GET(nearbyRequest());
    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({ code: "VWORLD_NEARBY_UNAVAILABLE", sourceEvidence: { cadastral: { status: "unavailable" } } });
  });

  it.each([
    "lng=127", "lat=37", "lat=&lng=127", "lat=%20&lng=127", "lat=37&lng=",
    "lat=37junk&lng=127", "lat=37&lng=127junk", "lat=NaN&lng=127", "lat=37&lng=Infinity",
    "lat=-90.01&lng=127", "lat=90.01&lng=127", "lat=37&lng=-180.01", "lat=37&lng=180.01",
    "lat=37&lng=127&radiusM=", "lat=37&lng=127&radiusM=NaN", "lat=37&lng=127&radiusM=Infinity",
    "lat=37&lng=127&radiusM=75junk", "lat=37&lng=127&radiusM=0", "lat=37&lng=127&radiusM=-1",
    "lat=37&lng=127&radiusM=181",
  ])("rejects invalid query %s without a provider call", async (query) => {
    const result = await (await import("@/app/api/parcels/nearby-context/route")).GET(nearbyRequest(query));
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ code: "INVALID_NEARBY_SEARCH" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["lat=-90&lng=-180&radiusM=1", "lat=90&lng=180&radiusM=180"])("accepts valid inclusive bounds %s", async (query) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(featureResponse([]))));
    expect((await (await import("@/app/api/parcels/nearby-context/route")).GET(nearbyRequest(query))).status).toBe(200);
  });
});

describe("lookup source evidence and warning metadata", () => {
  it("keeps cadastral success and warns when optional roads, context and geometry fail", async () => {
    successfulFetch({ response: { status: "ERROR", error: { text: secret } } });
    mocks.context.mockRejectedValue(new Error(secret, { cause: "private-cause" }));
    mocks.geometry.mockRejectedValue(new Error(secret));
    const result = await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest());
    const payload = await result.json();
    expect(result.status).toBe(200);
    expect(payload).toMatchObject({
      mode: "vworld", pnu, boundary, roads: [], cadastralParcels: [], currentBuilding: null,
      sourceEvidence: {
        roads: { status: "unavailable", resultCount: null },
        cadastral: { status: "unavailable", resultCount: null },
        buildings: { status: "unavailable", resultCount: null },
      },
    });
    expect(payload.warnings).toHaveLength(3);
    expect(payload.inputProvenance.note).toBe(payload.warnings.join(" "));
    expect(payload.warnings.join(" ")).toContain("실제 유무는 별도 확인");
    expect(JSON.stringify(payload)).not.toMatch(/synthetic-private-key|provider\.invalid|private-cause/);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(secret);
  });

  it("retains successful empty geometry evidence even when no current building can hold metadata", async () => {
    successfulFetch(featureResponse([]));
    const result = await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest());
    const payload = await result.json();
    expect(payload.currentBuilding).toBeNull();
    expect(payload.sourceEvidence).toMatchObject({
      roads: { status: "empty", resultCount: 0, issue: null },
      cadastral: { status: "empty", resultCount: 0, issue: null },
      buildings: { status: "empty", resultCount: 0, issue: null },
    });
    expect(payload.warnings).toHaveLength(3);
    expect(payload.warnings.every((warning: string) => warning.includes("조회 결과가 0건"))).toBe(true);
  });

  it("preserves successful roads and context while marking returned geometry errors unavailable", async () => {
    successfulFetch();
    mocks.context.mockResolvedValue([{ pnu: "1132010500100020000", boundary, jimok: "도로" }]);
    mocks.geometry.mockResolvedValue({ ...emptyGeometry, status: "error" });
    const payload = await (await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest())).json();
    expect(payload.roads).toHaveLength(1);
    expect(payload.cadastralParcels).toHaveLength(1);
    expect(payload.sourceEvidence).toMatchObject({
      roads: { status: "available", resultCount: 1 }, cadastral: { status: "available", resultCount: 1 },
      buildings: { status: "unavailable", resultCount: null },
    });
    expect(payload.warnings).toHaveLength(1);
  });

  it("returns all successful optional sources without warnings and preserves attached building metadata", async () => {
    successfulFetch();
    mocks.context.mockResolvedValue([{ pnu: "1132010500100020000", boundary, jimok: "도로" }]);
    const geometry = {
      ...emptyGeometry, status: "matched", queryFeatureCount: 1,
      footprints: [{
        id: "building-1", pnu, buildingName: "Test building", polygons: [[boundary]],
        footprintAreaSqm: 20, totalAreaSqm: 40, heightM: 6, groundFloors: 2, undergroundFloors: 0,
        useApprovalDate: "20000101", purposeCode: "", structureCode: "", violationStatus: "unknown",
        violationRaw: "", matchMethod: "pnu", source: "vworld-dt_d010",
      }],
    };
    mocks.geometry.mockResolvedValue(geometry);
    const payload = await (await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest())).json();
    expect(payload.sourceEvidence).toMatchObject({
      roads: { status: "available", resultCount: 1 }, cadastral: { status: "available", resultCount: 1 },
      buildings: { status: "available", resultCount: 1 },
    });
    expect(payload.currentBuilding.geometry).toEqual(geometry);
    expect(payload.warnings).toEqual([]);
    expect(payload.inputProvenance).not.toHaveProperty("note");
  });

  it("treats missing road evidence as unrecorded rather than a successful empty lookup", async () => {
    successfulFetch();
    const adapter = await import("@/lib/integrations/vworld");
    const cadastral = await adapter.lookupCadastral(37, 127);
    if (!cadastral) throw new Error("Expected cadastral fixture");
    const legacy = { ...cadastral, roads: [] };
    Reflect.deleteProperty(legacy, "roadsEvidence");
    vi.spyOn(adapter, "lookupCadastral").mockResolvedValue(legacy);
    const payload = await (await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest())).json();
    expect(payload.sourceEvidence.roads).toMatchObject({ status: "unavailable", resultCount: null, issue: "not-recorded" });
    expect(payload.warnings[0]).toContain("데이터를 확인하지 못했습니다");
  });
});

describe("disabled and unconfigured VWorld", () => {
  it.each([
    { mode: "disabled", enabled: "false", key: "synthetic-private-key", code: "VWORLD_DISABLED", issue: "disabled" },
    { mode: "unconfigured", enabled: "true", key: "", code: "VWORLD_NOT_CONFIGURED", issue: "not-configured" },
  ])("makes no VWorld requests in $mode mode and reports unavailable evidence", async ({ enabled, key, code, issue }) => {
    vi.stubEnv("VWORLD_ENABLED", enabled);
    vi.stubEnv("VWORLD_API_KEY", key);
    const adapter = await import("@/lib/integrations/vworld");
    await expect(adapter.fetchNearbyCadastralParcels(37, 127)).rejects.toThrow("V-World integration unavailable");
    await expect(adapter.lookupCadastral(37, 127)).rejects.toThrow("V-World integration unavailable");
    await expect(adapter.lookupZoningByPNU(pnu)).rejects.toThrow("V-World integration unavailable");
    const nearby = await (await import("@/app/api/parcels/nearby-context/route")).GET(nearbyRequest());
    expect(nearby.status).toBe(503);
    expect(await nearby.json()).toMatchObject({ code, sourceEvidence: { cadastral: { status: "unavailable", resultCount: null, issue } } });
    const lookup = await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest());
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toMatchObject({ mode: "manual-required", reason: { code }, sourceEvidence: {
      roads: { status: "unavailable", issue }, buildings: { status: "unavailable", issue }, cadastral: { status: "unavailable", issue },
    } });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.geometry).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
  });
});

describe("lookup identity and topology fallbacks", () => {
  it("does not assume ordinary land or query its registry when mountain identity is missing", async () => {
    mocks.geocode.mockResolvedValue({ ...geocode, mountainYn: "" });
    const fetchMock = successfulFetch();
    const payload = await (await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest())).json();
    expect(payload).toMatchObject({ mode: "manual-required", reason: { code: "CADASTRAL_IDENTITY_UNCONFIRMED" }, currentBuilding: null });
    expect(payload.pnu).toMatch(/^manual-/);
    expect(payload).not.toHaveProperty("boundary");
    expect(payload).not.toHaveProperty("lotArea");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.currentBuilding).not.toHaveBeenCalled();
  });
  it("passes the complete geocoded PNU and does not replace it with a neighboring parcel", async () => {
    const other = { ...parcelFeature, properties: { ...parcelFeature.properties, pnu: "1132010500100020000" } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(featureResponse([other]))));
    const adapter = await import("@/lib/integrations/vworld");
    const spy = vi.spyOn(adapter, "lookupCadastral");
    const payload = await (await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest())).json();
    expect(spy).toHaveBeenCalledWith(37, 127, expect.objectContaining({ pnu, mountainYn: "N" }), { includeRoads: true });
    expect(payload).toMatchObject({ mode: "manual-required", pnu, reason: { code: "CADASTRAL_NOT_FOUND" } });
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.geometry).not.toHaveBeenCalled();
  });
  it("preserves complete multipart source geometry without sending a partial boundary to analysis", async () => {
    const second = boundary.map(([x, y]) => [x + 0.001, y]);
    const polygons = [[boundary], [second]];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(featureResponse([{ ...parcelFeature, geometry: { type: "MultiPolygon", coordinates: polygons } }]))));
    const result = await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest());
    const payload = await result.json();
    expect(result.status).toBe(200);
    expect(payload).toMatchObject({ mode: "manual-required", pnu, reason: { code: "CADASTRAL_TOPOLOGY_REVIEW" }, sourceGeometry: { pnu, polygons } });
    expect(payload.sourceGeometry.measuredAreaSqm).toBeGreaterThan(0);
    expect(payload).not.toHaveProperty("boundary");
    expect(payload).not.toHaveProperty("lotArea");
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.geometry).not.toHaveBeenCalled();
  });
  it("identifies conflicting same-PNU source features as ambiguity rather than a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(featureResponse([parcelFeature, { ...parcelFeature, properties: { ...parcelFeature.properties, jiga: "100" } }]))));
    const payload = await (await (await import("@/app/api/parcels/lookup/route")).POST(lookupRequest())).json();
    expect(payload).toMatchObject({ mode: "manual-required", reason: { code: "CADASTRAL_IDENTITY_AMBIGUOUS" } });
  });
});
