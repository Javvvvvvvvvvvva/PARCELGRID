import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NearbyCadastralParcel } from "@/lib/integrations/vworld";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { getBuildingRegistryStatus } from "@/lib/building-registry/evidence";
import { REGISTRY_QUERY, SYNTHETIC_TITLE, registryResponse } from "./helpers/building-registry-fixture";

const mocks = vi.hoisted(() => ({ parcels: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ requireApiCapability: async () => ({ ok: true }) }));
vi.mock("@/lib/runtime/integration-mode", () => ({ vworldRuntimeState: () => ({ mode: "enabled" }) }));
vi.mock("@/lib/integrations/vworld", () => ({ fetchNearbyCadastralParcels: mocks.parcels }));

const PNU = "1132010500102810023";
const parcels = (count = 14): NearbyCadastralParcel[] => Array.from({ length: count }, (_, i) => ({
  pnu: `113201050010281${String(23 + i).padStart(4, "0")}`, jibun: `281-${23 + i}`,
  distanceM: i + 1, lotAreaSqm: 100,
  boundary: [[127, 37], [127.0001, 37], [127.0001, 37.0001], [127, 37]],
}));
const request = (signal?: AbortSignal) => new NextRequest("http://localhost/api/parcels/nearby-context?lat=37&lng=127", { signal });
const loadRegistry = () => import("@/lib/integrations/molit-building");
const loadRoute = () => import("@/app/api/parcels/nearby-context/route");

function titleResponse(input: string, total = 1, size = 100) {
  const url = new URL(input);
  const page = Number(url.searchParams.get("pageNo"));
  const ji = url.searchParams.get("ji")!;
  return Response.json(registryResponse({ ...SYNTHETIC_TITLE, ji,
    mgmBldrgstPk: `synthetic-${ji}-${page}`, rnum: String(page) }, total, page, size));
}

function gatedFetch() {
  let active = 0, peak = 0, aborted = 0;
  const pending: Array<{ input: string; signal: AbortSignal; release: (response?: Response) => void }> = [];
  const fetchMock = vi.fn((input: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal!;
    active++;
    peak = Math.max(peak, active);
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      active--;
      signal.removeEventListener("abort", abort);
      return true;
    };
    const abort = () => {
      if (!finish()) return;
      aborted++;
      reject(new DOMException("synthetic-private-provider-error", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.push({ input, signal, release: (response) => { if (finish()) resolve(response ?? titleResponse(input)); } });
    if (signal.aborted) abort();
  }));
  vi.stubGlobal("fetch", fetchMock);
  return { pending, fetchMock, usage: () => ({ active, peak, aborted }) };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-registry-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected synthetic fetch"); }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  // Native AbortSignal timers otherwise bypass Vitest's synthetic clock.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("synthetic timeout", "TimeoutError")), ms);
    return controller.signal;
  });
  mocks.parcels.mockResolvedValue(parcels());
});

afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("nearby-context bounded enrichment", () => {
  it("runs three workers, preserves parcel order and marks neighbors beyond the lookup cap", async () => {
    const gate = gatedFetch();
    const { GET, maxDuration } = await loadRoute();
    const response = GET(request());
    await vi.advanceTimersByTimeAsync(0);
    expect(maxDuration).toBe(45);
    expect(gate.pending).toHaveLength(3);
    expect(mocks.parcels).toHaveBeenCalledWith(37, 127, expect.objectContaining({
      signal: expect.any(AbortSignal), outerDeadline: 35_000,
    }));
    // Finish the third neighbor first, then let that worker drain the queue.
    for (let i = 2; i < 12; i++) {
      gate.pending[i].release();
      await vi.advanceTimersByTimeAsync(0);
    }
    gate.pending[1].release();
    gate.pending[0].release();
    const result = await response;
    const payload = await result.json();
    expect(result.status).toBe(200);
    expect(gate.usage()).toEqual({ active: 0, peak: 3, aborted: 0 });
    expect(gate.fetchMock).toHaveBeenCalledTimes(12);
    expect(payload.neighbors.map((neighbor: { pnu: string }) => neighbor.pnu)).toEqual(parcels().map(p => p.pnu));
    expect(payload.neighbors[0].building.buildings[0].registryId).toBe("synthetic-0023-1");
    expect(payload.neighbors.slice(12)).toEqual(parcels().slice(12).map(p => ({ ...p, building: null,
      buildingEvidence: { status: "not-requested", issues: ["lookup-limit"] } })));
    expect(payload.sourceEvidence).toMatchObject({
      cadastral: { status: "available", resultCount: 14 },
      buildingRegistry: { status: "partial", attemptedCount: 12, completedCount: 12, partialCount: 0, skippedCount: 2, issues: ["lookup-limit"] },
    });
  });

  it("ends at the shared 35-second deadline including cadastral time and retains earlier rows", async () => {
    mocks.parcels.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(parcels()), 5_000)));
    let active = 0, aborted = 0;
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (new URL(input).searchParams.get("ji") === "0023") return Promise.resolve(Response.json(registryResponse([], 0)));
      return new Promise<Response>((resolve, reject) => {
        const signal = init!.signal!;
        active++;
        const abort = () => {
          clearTimeout(timer);
          active--;
          aborted++;
          reject(new DOMException("interrupted", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          active--;
          resolve(titleResponse(input, 10, 1));
        }, 7_000);
        signal.addEventListener("abort", abort, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await loadRoute();
    let settled = false;
    const response = GET(request()).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(34_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await response;
    const payload = await result.json();
    expect(result.status).toBe(200);
    expect(performance.now()).toBe(35_000);
    expect(active).toBe(0);
    expect(aborted).toBe(6);
    expect(payload.sourceEvidence.buildingRegistry).toMatchObject({
      status: "partial", completedCount: 1, partialCount: 3, attemptedCount: 7, skippedCount: 7,
      issues: expect.arrayContaining(["timeout", "lookup-limit"]),
    });
    expect(getBuildingRegistryStatus(payload.neighbors[0].building)).toBe("no-records");
    expect(payload.neighbors[1].building.registry.title).toMatchObject({ status: "partial", fetchedCount: 3, issues: ["timeout"] });
    expect(payload.neighbors[1].building.buildings).toHaveLength(3);
    expect(payload.neighbors[4].building.redevelopmentSignal).toBe("unknown");
    expect(getBuildingRegistryStatus(payload.neighbors[4].building)).toBe("unknown");
    expect(payload.neighbors[7]).toMatchObject({ building: null, buildingEvidence: { status: "not-requested", issues: ["timeout"] } });
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("cancels active fetches and pending workers on disconnect while retaining successful neighbors", async () => {
    const controller = new AbortController();
    const gate = gatedFetch();
    const { GET } = await loadRoute();
    const response = GET(request(controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    gate.pending[0].release();
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.pending).toHaveLength(4);
    controller.abort();
    const payload = await (await response).json();
    expect(gate.usage()).toEqual({ active: 0, peak: 3, aborted: 3 });
    expect(payload.neighbors[0].buildingEvidence).toEqual({ status: "complete", issues: [] });
    expect(payload.neighbors[1].buildingEvidence).toEqual({ status: "unavailable", issues: ["timeout"] });
    expect(payload.neighbors[4]).toMatchObject({ building: null, buildingEvidence: { status: "not-requested", issues: ["request-aborted"] } });
    expect(payload.sourceEvidence.buildingRegistry).toMatchObject({ status: "partial", attemptedCount: 4, completedCount: 1, skippedCount: 10 });
    expect(JSON.stringify(payload)).not.toMatch(/synthetic-private-provider-error|synthetic-registry-key/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gate.fetchMock).toHaveBeenCalledTimes(4);
  });

  it("shares registry admission across simultaneous route requests without cross-cancelling callers", async () => {
    const gate = gatedFetch();
    const { GET } = await loadRoute();
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const responses = controllers.map(controller => GET(request(controller.signal)));
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.pending).toHaveLength(6);
    controllers[0].abort();
    await responses[0];
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.pending).toHaveLength(9);
    expect(gate.usage()).toEqual({ active: 6, peak: 6, aborted: 3 });
    expect(gate.pending.slice(3).every(entry => !entry.signal.aborted)).toBe(true);
    controllers[1].abort();
    controllers[2].abort();
    await Promise.all(responses);
    expect(gate.usage().active).toBe(0);
    expect(gate.fetchMock).toHaveBeenCalledTimes(9);
  });

  it("preserves cadastral failure evidence when the request is already cancelled", async () => {
    const { GET } = await loadRoute();
    const response = await GET(request(AbortSignal.abort()));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "VWORLD_NEARBY_UNAVAILABLE",
      sourceEvidence: { cadastral: { status: "unavailable", resultCount: null } } });
    expect(mocks.parcels).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates cancellation during the cadastral request and never starts registry work", async () => {
    let upstreamSignal: AbortSignal | undefined;
    mocks.parcels.mockImplementation((_lat, _lng, options) => new Promise((_resolve, reject) => {
      upstreamSignal = options.signal;
      upstreamSignal!.addEventListener("abort", () => reject(new DOMException("interrupted", "AbortError")), { once: true });
    }));
    const controller = new AbortController();
    const { GET } = await loadRoute();
    const response = GET(request(controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await response).status).toBe(502);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains late cadastral observations but skips enrichment after the monotonic deadline", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    mocks.parcels.mockImplementation(async () => { now = 35_001; return parcels(2); });
    const { GET } = await loadRoute();
    const response = await GET(request());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.count).toBe(2);
    expect(payload.sourceEvidence.buildingRegistry).toMatchObject({ status: "unavailable", attemptedCount: 0, skippedCount: 2, issues: ["timeout"] });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("registry shared admission and public cancellation", () => {
  it("bounds active and queued requests, reports overload, removes cancelled waiters and recovers capacity", async () => {
    const gate = gatedFetch();
    const api = await loadRegistry();
    const { REGISTRY_MAX_CONCURRENCY: active, REGISTRY_MAX_QUEUED: queued } = await import("@/lib/integrations/molit-building-client");
    const controllers = Array.from({ length: active + queued }, () => new AbortController());
    const lookups = controllers.map(controller => api.lookupBuildingByPnu(PNU, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.pending).toHaveLength(active);
    const overflow = await api.lookupBuildingByPnu(PNU);
    expect(overflow?.registry?.title).toMatchObject({ status: "unavailable", issues: ["capacity-limit"] });
    expect(getBuildingRegistryStatus(overflow)).toBe("unknown");
    controllers[active].abort();
    expect((await lookups[active])?.registry?.title.issues).toEqual(["timeout"]);
    controllers.forEach(controller => controller.abort());
    await Promise.all(lookups);
    expect(gate.usage()).toEqual({ active: 0, peak: active, aborted: active });
    expect(gate.fetchMock).toHaveBeenCalledTimes(active);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(registryResponse([], 0))));
    expect((await api.lookupBuildingByPnu(PNU))?.registry?.title.status).toBe("complete");
  });

  it("includes queue waiting in the page deadline and never fetches an expired waiter", async () => {
    const gate = gatedFetch();
    const api = await loadRegistry();
    const controllers = Array.from({ length: 6 }, () => new AbortController());
    const occupied = controllers.map(controller => api.lookupBuildingByPnu(PNU, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(0);
    const queued = api.lookupBuildingByPnu(PNU, { outerDeadline: performance.now() + 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect((await queued)?.registry?.title.issues).toEqual(["timeout"]);
    expect(gate.fetchMock).toHaveBeenCalledTimes(6);
    expect(gate.usage().active).toBe(6);
    controllers.forEach(controller => controller.abort());
    await Promise.all(occupied);
    expect(gate.usage().active).toBe(0);
  });

  it("holds admission through stalled bodies, cancels the reader and releases the slot", async () => {
    const cancels: ReturnType<typeof vi.fn>[] = [];
    const fetchMock = vi.fn(async () => {
      if (cancels.length === 6) return Response.json(registryResponse([], 0));
      const cancel = vi.fn();
      cancels.push(cancel);
      return new Response(new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = await loadRegistry();
    const controllers = Array.from({ length: 6 }, () => new AbortController());
    const occupied = controllers.map(controller => api.lookupBuildingByPnu(PNU, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(0);
    const queued = api.lookupBuildingByPnu(PNU);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    controllers[0].abort();
    expect((await occupied[0])?.registry?.title.issues).toEqual(["timeout"]);
    expect((await queued)?.registry?.title.status).toBe("complete");
    expect(cancels[0]).toHaveBeenCalledOnce();
    controllers.forEach(controller => controller.abort());
    await Promise.all(occupied);
    for (const cancel of cancels) expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it.each(["pnu", "jibun"] as const)("honors expired deadlines and caller aborts in public %s lookup", async kind => {
    const gate = gatedFetch();
    const api = await loadRegistry();
    const lookup = (options: { signal?: AbortSignal; outerDeadline?: number }): Promise<BuildingLookupResult | null> => kind === "pnu"
      ? api.lookupBuildingByPnu(PNU, options)
      : api.lookupBuildingByJibun("1132010500", "281", "23", "N", options);
    expect((await lookup({ outerDeadline: -1 }))?.registry?.title.issues).toEqual(["timeout"]);
    expect((await lookup({ signal: AbortSignal.abort() }))?.registry?.title.issues).toEqual(["timeout"]);
    expect(gate.fetchMock).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = lookup({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    const result = await pending;
    expect(result?.redevelopmentSignal).toBe("unknown");
    expect(getBuildingRegistryStatus(result)).toBe("unknown");
    expect(gate.pending[0].signal.aborted).toBe(true);
    expect(gate.usage().active).toBe(0);
  });

  it("shares the caller deadline with both detail requests and preserves completed title data", async () => {
    const gate = gatedFetch();
    const api = await loadRegistry();
    const lookup = api.lookupBuildingByJibun("1132010500", "281", "23", "N", { outerDeadline: 100 });
    await vi.advanceTimersByTimeAsync(0);
    gate.pending[0].release();
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.pending).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(100);
    const result = await lookup;
    expect(result?.registry?.query).toEqual(REGISTRY_QUERY);
    expect(result?.registry?.title.status).toBe("complete");
    expect(result?.buildings).toHaveLength(1);
    expect(result?.registry?.floors).toMatchObject({ status: "unavailable", issues: ["timeout"] });
    expect(result?.registry?.exclusiveCommon).toMatchObject({ status: "unavailable", issues: ["timeout"] });
    expect(gate.usage()).toEqual({ active: 0, peak: 2, aborted: 2 });
  });
});
