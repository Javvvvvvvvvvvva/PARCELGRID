import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRegistryDataset } from "@/lib/integrations/molit-building-client";
import { REGISTRY_QUERY, SYNTHETIC_TITLE, registryResponse } from "./helpers/building-registry-fixture";

beforeEach(() => { vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-secret"); vi.stubEnv("KAKAO_REST_API_KEY", "synthetic-secret"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function oversized(max: number) {
  const cancel = vi.fn(); let count = 0;
  const response = new Response(new ReadableStream({ pull(c) { count++; c.enqueue(new Uint8Array(Math.ceil(max / 2))); }, cancel }, { highWaterMark: 0 }), { headers: { "content-length": "1" } });
  return { response, cancel, count: () => count };
}
describe("provider adapter failure evidence", () => {
  it("does not turn oversized registry data into an empty complete registry", async () => {
    const input = oversized(3_000_000);
    vi.stubGlobal("fetch", vi.fn(async () => input.response));
    const result = await fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, new AbortController().signal);
    expect(result).toMatchObject({ status: "unavailable", rows: [], totalCount: null, issues: ["invalid-response"] });
    expect(input.cancel).toHaveBeenCalledOnce(); expect(input.count()).toBe(3);
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });
  it("keeps first-page evidence partial when the next body is oversized", async () => {
    const input = oversized(3_000_000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(registryResponse([SYNTHETIC_TITLE], 2, 1, 1))).mockResolvedValueOnce(input.response));
    const result = await fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, new AbortController().signal);
    expect(result).toMatchObject({ status: "partial", fetchedCount: 1, issues: ["invalid-response"] });
    expect(result.rows).toHaveLength(1); expect(input.cancel).toHaveBeenCalledOnce();
  });
  it("records body timeout and cancels instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(), response = new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }));
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const pending = fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await pending).toMatchObject({ status: "unavailable", issues: ["timeout"] });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("does not read HTTP error bodies", async () => {
    const cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }), { status: 403 });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    expect(await fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, new AbortController().signal)).toMatchObject({ issues: ["access-denied"] });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels oversized Kakao bodies before document schema parsing", async () => {
    vi.resetModules(); const { searchAddressSuggestions } = await import("@/lib/integrations/kakao");
    const input = oversized(1_048_576); vi.stubGlobal("fetch", vi.fn(async () => input.response));
    await expect(searchAddressSuggestions("합성 주소")).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
    expect(input.cancel).toHaveBeenCalledOnce();
  });
  it.each([null, "", "Infinity", "91", "abc"])("rejects invalid station latitude %s instead of producing zero/NaN", async y => {
    vi.resetModules(); const { searchNearbyStations } = await import("@/lib/integrations/kakao");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ documents: [{ place_name: "합성역", x: "127", y, distance: "12" }] })));
    await expect(searchNearbyStations(37, 127)).rejects.toThrow("Kakao station response shape unexpected");
  });
  it("keeps successful empty address results distinct without logging the private query", async () => {
    vi.resetModules(); const { geocodeAddress } = await import("@/lib/integrations/kakao");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ documents: [], meta: { total_count: 0, pageable_count: 0, is_end: true } })));
    expect(await geocodeAddress("private-address-marker")).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
  it("returns valid nearby station values with a request deadline", async () => {
    vi.resetModules(); const { searchNearbyStations } = await import("@/lib/integrations/kakao");
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ documents: [{ place_name: "합성역", x: "127.1", y: "37.1", distance: "12" }] });
    }); vi.stubGlobal("fetch", fetch);
    expect(await searchNearbyStations(37, 127)).toEqual([{ name: "합성역", lat: 37.1, lng: 127.1, distanceM: 12 }]);
  });
});
