import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchVworldJson, VWORLD_MAX_RESPONSE_BYTES } from "@/lib/integrations/vworld-response";

const pnu = "1132010500102810023", center = { lng: 127, lat: 37 };
const boundary: [number, number][] = [[127, 37], [127.001, 37], [127.001, 37.001], [127, 37]];
beforeEach(() => { vi.resetModules(); vi.stubEnv("VWORLD_ENABLED", "true"); vi.stubEnv("VWORLD_API_KEY", "synthetic-private-key"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function overflowing(max: number) {
  const cancel = vi.fn(); let chunks = 0;
  const response = new Response(new ReadableStream({ pull(c) { chunks++; c.enqueue(new Uint8Array(Math.ceil(max / 2))); }, cancel }, { highWaterMark: 0 }),
    { headers: { "content-length": "1", "content-type": "application/json" } });
  return { response, cancel, count: () => chunks };
}

const adapters = [
  { name: "target cadastral", run: async () => (await import("@/lib/integrations/vworld")).lookupCadastral(37, 127) },
  { name: "cadastral context", run: async () => (await import("@/lib/integrations/vworld-cadastral-context")).fetchCadastralContextParcels({ center, targetPnu: pnu }) },
  { name: "planned roads", run: async () => (await import("@/lib/integrations/vworld-upis-roads")).fetchUpisRoadBoundaries({ center }) },
  { name: "building WFS legacy", run: async () => (await import("@/lib/integrations/vworld-buildings")).fetchExistingBuildingGeometry({ center, pnu, boundary }) },
  { name: "building WFS active client", run: async () => (await import("@/lib/integrations/vworld-buildings-client")).fetchExistingBuildingGeometry({ center, pnu, boundary }) },
];
describe("VWorld response reception boundaries", () => {
  it.each(adapters)("$name cancels actual byte overflow before domain parsing", async ({ run }) => {
    const input = overflowing(VWORLD_MAX_RESPONSE_BYTES);
    vi.stubGlobal("fetch", vi.fn(async () => input.response));
    await expect(run()).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
    expect(input.cancel).toHaveBeenCalledOnce(); expect(input.count()).toBe(3);
  });
  it.each(adapters)("$name discards HTTP error bodies without reflecting private values", async ({ run }) => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 403 })));
    await expect(run()).rejects.toThrow("V-World HTTP 403");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("keeps the active WFS query contract and accepts JSON despite a wrong content type", async () => {
    const fetch = vi.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      expect(query.get("OUTPUT")).toBe("application/json");
      expect(query.get("BBOX")?.split(",")).toHaveLength(4);
      return new Response('{"type":"FeatureCollection","features":[]}', { headers: { "content-type": "text/plain" } });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await (await import("@/lib/integrations/vworld-buildings-client")).fetchExistingBuildingGeometry({ center, pnu, boundary }))
      .toMatchObject({ status: "not_found", footprints: [] });
  });
  it("rejects an oversized nearby-parcel response instead of returning successful empty data", async () => {
    const input = overflowing(VWORLD_MAX_RESPONSE_BYTES);
    vi.stubGlobal("fetch", vi.fn(async () => input.response));
    await expect((await import("@/lib/integrations/vworld")).fetchNearbyCadastralParcels(37, 127)).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
    expect(input.cancel).toHaveBeenCalledOnce();
  });
  it("bounds optional road responses without losing the selected cadastral feature", async () => {
    const input = overflowing(VWORLD_MAX_RESPONSE_BYTES);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ response: { status: "OK", result: { featureCollection: {
      features: [{ geometry: { type: "Polygon", coordinates: [boundary] }, properties: { pnu, jibun: "1", jimokName: "대" } }],
    } } } })).mockResolvedValueOnce(input.response));
    expect(await (await import("@/lib/integrations/vworld")).lookupCadastral(37, 127)).toMatchObject({
      pnu, roads: [], roadsEvidence: { status: "unavailable", resultCount: null },
    });
    expect(input.cancel).toHaveBeenCalledOnce();
  });
  it("bounds NED zoning separately and retains no response/cause secrets", async () => {
    const input = overflowing(1_048_576);
    vi.stubGlobal("fetch", vi.fn(async () => input.response));
    const pending = (await import("@/lib/integrations/vworld")).lookupZoningByPNU(pnu);
    await expect(pending).rejects.toThrow("VWorld 용도지역 응답 형식을 확인할 수 없습니다.");
    await pending.catch(error => { expect(error.cause).toBeUndefined(); expect(String(error)).not.toContain("synthetic-private-key"); });
    expect(input.cancel).toHaveBeenCalledOnce();
  });
  it.each([null, 1, { prposAreaDstrcCode: {} }, { prposAreaDstrcCodeNm: ["private"] }])("rejects malformed zoning fields %j", async field => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ landUses: { field: [field] } })));
    await expect((await import("@/lib/integrations/vworld")).lookupZoningByPNU(pnu)).rejects.toThrow("VWorld 용도지역");
  });
  it("preserves single-field zoning results and leaves regulatory limits unconfirmed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ landUses: { field: { prposAreaDstrcCode: "UQA122", prposAreaDstrcCodeNm: "제2종일반주거지역" } } })));
    const result = await (await import("@/lib/integrations/vworld")).lookupZoningByPNU(pnu);
    expect(result).toMatchObject({ maxFAR: 250, maxBCR: 60, heightLimitM: 0 });
    expect(result.regulatoryConstraints).toMatchObject({ far: { status: "reference-only" }, bcr: { status: "reference-only" }, height: { status: "unknown", value: null } });
  });
  it("uses one abort signal for the response body after headers have arrived", async () => {
    const controller = new AbortController(), cancel = vi.fn();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      queueMicrotask(() => controller.abort());
      return new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }));
    }));
    await expect(fetchVworldJson("https://example.invalid")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("times out a stalled body even when a fetch implementation ignores its signal", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }))));
    const pending = expect(fetchVworldJson("https://example.invalid", { timeoutMs: 50 })).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(51); await pending;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([
    ['{"x":1e400}', "INVALID_JSON_NUMBER"],
    ["[".repeat(50) + "0" + "]".repeat(50), "JSON_TOO_DEEP"],
    ["[" + "0,".repeat(250_000) + "0]", "JSON_TOO_MANY_NODES"],
    ["<error>synthetic-private-key</error>", "INVALID_JSON"],
  ])("rejects unsafe provider JSON with static code %#", async (body, code) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(fetchVworldJson("https://example.invalid")).rejects.toMatchObject({ code });
  });
  it("cancels a rejected content type without reading or echoing it", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-type": "private-header-value" } })));
    await expect(fetchVworldJson("https://example.invalid", { requireJsonContentType: true })).rejects.toThrow("V-World returned a non-JSON response");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([{}, null, { response: { status: "ERROR", error: { text: "private-error" } } }, { response: { status: "OK" } },
    { response: { status: "OK", result: { featureCollection: { features: [null] } } } },
    { response: { status: "OK", result: { featureCollection: { features: Array.from({ length: 201 }, () => ({})) } } } },
  ])("never treats malformed/provider-error feature envelopes as successful absence %#", async body => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    await expect(fetchVworldJson("https://example.invalid", { envelope: "data" })).rejects.toThrow("V-World feature response invalid or unavailable");
  });
  it.each([{}, null, { features: {} }, { features: [null] }])("rejects malformed WFS envelopes %#", async body => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    await expect(fetchVworldJson("https://example.invalid", { envelope: "wfs" })).rejects.toThrow("V-World feature response invalid or unavailable");
  });
  it("preserves an explicit NOT_FOUND result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ response: { status: "NOT_FOUND" } })));
    expect(await (await import("@/lib/integrations/vworld")).lookupCadastral(37, 127)).toBeNull();
  });
  it("redacts transport errors and nested causes before any route logger can retain them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private-request-url-and-key", { cause: "private-cause" }); }));
    const pending = fetchVworldJson("https://example.invalid");
    await expect(pending).rejects.toThrow("V-World network request failed");
    await pending.catch(error => { expect(error.cause).toBeUndefined(); expect(String(error)).not.toContain("private"); });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("private-timeout-reason", "TimeoutError"); }));
    await expect(fetchVworldJson("https://example.invalid")).rejects.toMatchObject({ name: "TimeoutError", message: "V-World request timed out or was interrupted." });
  });
  it.each(["bad", [], [[null]], [[[127, "37"], [127, 37], [128, 37]]], [[[127, 200], [127, 37], [128, 37]]],
    [[[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001]]]])(
    "rejects invalid polygon coordinates before cadastral/building absence can be reported %#", async coordinates => {
      const feature = { geometry: { type: "Polygon", coordinates }, properties: { pnu } };
      const { lookupCadastral } = await import("@/lib/integrations/vworld");
      const { fetchExistingBuildingGeometry } = await import("@/lib/integrations/vworld-buildings-client");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ response: { status: "OK", result: { featureCollection: { features: [feature] } } } })));
      await expect(lookupCadastral(37, 127)).rejects.toThrow("V-World feature response invalid or unavailable");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ features: [feature] })));
      await expect(fetchExistingBuildingGeometry({ center, pnu, boundary })).rejects.toThrow("V-World feature response invalid or unavailable");
    });
  it("accepts finite normal/axis-swapped WFS coordinates but rejects non-polygon buildings", async () => {
    const feature = { geometry: { type: "Polygon", coordinates: [boundary.map(([x, y]) => [y, x])] }, properties: { pnu } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ features: [feature] })));
    expect(await (await import("@/lib/integrations/vworld-buildings-client")).fetchExistingBuildingGeometry({ center, pnu, boundary })).toMatchObject({ status: "matched" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ features: [{ ...feature, geometry: { type: "LineString", coordinates: boundary } }] })));
    await expect(fetchVworldJson("https://example.invalid", { envelope: "wfs" })).rejects.toThrow("V-World feature response invalid or unavailable");
  });
  it("limits total vertices across parts, rather than only each ring", async () => {
    const ring = Array.from({ length: 5001 }, () => [127, 37]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ features: [{ geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] } }] })));
    await expect(fetchVworldJson("https://example.invalid", { envelope: "wfs" })).rejects.toThrow("V-World feature response invalid or unavailable");
  });
  it("enforces the absolute deadline when delayed headers and a synchronous body pull prevent timer delivery", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const spin = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { /* Reproduce a blocked timer. */ } };
    vi.stubGlobal("fetch", vi.fn(async () => {
      spin(60);
      return new Response(new ReadableStream({ pull(c) { spin(70); c.enqueue(new TextEncoder().encode('{"features":[]}')); c.close(); } }, { highWaterMark: 0 }));
    }));
    await expect(fetchVworldJson("https://example.invalid", { timeoutMs: 100, envelope: "wfs" })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(controller.signal.aborted).toBe(false);
  });
  it.each([
    { type: "LineString", coordinates: [[127, 37], [127.001, 37.001]] },
    { type: "MultiLineString", coordinates: [[[127, 37], [127.001, 37.001]]] },
  ])("rejects $type for cadastral and planned-road polygon datasets", async geometry => {
    const feature = { geometry, properties: { pnu, present_sn: "synthetic-road" } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ response: { status: "OK", result: { featureCollection: { features: [feature] } } } })));
    await expect((await import("@/lib/integrations/vworld")).lookupCadastral(37, 127)).rejects.toThrow("V-World feature response invalid or unavailable");
    await expect((await import("@/lib/integrations/vworld-cadastral-context")).fetchCadastralContextParcels({ center, targetPnu: pnu })).rejects.toThrow("V-World feature response invalid or unavailable");
    await expect((await import("@/lib/integrations/vworld-upis-roads")).fetchUpisRoadBoundaries({ center })).rejects.toThrow("V-World feature response invalid or unavailable");
  });
  it("accepts road centerlines in their own dataset while preserving cadastral polygons", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ response: { status: "OK", result: { featureCollection: {
      features: [{ geometry: { type: "Polygon", coordinates: [boundary] }, properties: { pnu } }],
    } } } })).mockResolvedValueOnce(Response.json({ response: { status: "OK", result: { featureCollection: {
      features: [{ geometry: { type: "LineString", coordinates: [[127, 37], [127.001, 37.001]] }, properties: { rn: "합성도로" } }],
    } } } })));
    const result = await (await import("@/lib/integrations/vworld")).lookupCadastral(37, 127);
    expect(result?.roads).toEqual([{ name: "합성도로", points: [[127, 37], [127.001, 37.001]], topology: "source-part" }]);
    expect(result?.roadsEvidence).toMatchObject({ status: "available", resultCount: 1 });
  });
});
