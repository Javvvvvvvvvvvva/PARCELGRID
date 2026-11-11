import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchOptions } from "@/lib/integrations/molit";
import { transactionEvidenceComplete } from "@/lib/integrations/molit-evidence";

const options: FetchOptions = { lawdCd: "11320", dealYearMonth: "202601", type: "villa" };
const range = { lawdCd: "11320", type: "villa" as const, startYearMonth: "202601", endYearMonth: "202601" };
const row = (id = "1", name = "Synthetic") => `<item><dealYear>2026</dealYear><dealMonth>1</dealMonth><dealDay>1</dealDay><dealAmount>100</dealAmount><excluUseAr>30</excluUseAr><mhouseNm>${name}</mhouseNm><jibun>${id}</jibun><cdealType/><cdealDay/></item>`;
const xml = (total = 1, page = 1, size = 100, items = row()) => `<response><header><resultCode>000</resultCode></header><body><pageNo>${page}</pageNo><numOfRows>${size}</numOfRows><totalCount>${total}</totalCount><items>${items}</items></body></response>`;
const emptyResponse = (input: string | URL | Request) => {
  const url = new URL(String(input));
  return new Response(xml(0, Number(url.searchParams.get("pageNo")), Number(url.searchParams.get("numOfRows")), ""));
};
const load = () => import("@/lib/integrations/molit");

function gatedFetch() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const signals: AbortSignal[] = [];
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal!;
    signals.push(signal);
    const abort = () => reject(new DOMException("interrupted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void gate.then(() => { signal.removeEventListener("abort", abort); resolve(emptyResponse(input)); });
  }));
  vi.stubGlobal("fetch", fetchMock);
  return { release, fetchMock, signals };
}

beforeEach(() => { vi.resetModules(); vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-secret"); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("MOLIT completed cache and pagination", () => {
  it("coalesces pending work, isolates returned values and preserves source retrieval time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-10T00:00:00Z"));
    const fetchMock = vi.fn(async () => new Response(xml())); vi.stubGlobal("fetch", fetchMock);
    const api = await load();
    const [a, b] = await Promise.all([api.fetchMolitTransactions(options), api.fetchMolitTransactions(options)]);
    a[0].buildingName = "mutated";
    expect(b[0].buildingName).toBe("Synthetic");
    const first = await api.fetchMolitRangeWithEvidence(range);
    vi.setSystemTime(new Date("2026-01-10T00:09:59Z"));
    const cached = await api.fetchMolitRangeWithEvidence(range);
    expect(cached.evidence.sourceRetrievals).toEqual(first.evidence.sourceRetrievals);
    expect(cached.transactions[0].buildingName).toBe("Synthetic");
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date("2026-01-10T00:10:00Z"));
    await api.fetchMolitRangeWithEvidence(range);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("uses Korean calendar month at the UTC boundary and expires historical data after 24h", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-31T16:00:00Z"));
    const fetchMock = vi.fn(async input => emptyResponse(input)); vi.stubGlobal("fetch", fetchMock);
    const api = await load();
    await api.fetchMolitTransactions(options);
    await api.fetchMolitTransactions({ ...options, dealYearMonth: "202602" });
    vi.setSystemTime(new Date("2026-01-31T16:10:00Z"));
    await api.fetchMolitTransactions(options);
    await api.fetchMolitTransactions({ ...options, dealYearMonth: "202602" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.setSystemTime(new Date("2026-02-01T16:00:00Z"));
    await api.fetchMolitTransactions(options);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("bounds the completed cache to 256 entries and evicts LRU", async () => {
    const fetchMock = vi.fn(async input => emptyResponse(input)); vi.stubGlobal("fetch", fetchMock);
    const api = await load();
    for (let i = 0; i <= api.MOLIT_CACHE_MAX_ENTRIES; i++) await api.fetchMolitTransactions({ ...options, lawdCd: String(10000 + i) });
    expect(api.molitRuntimeUsage()).toMatchObject({ completedCache: { entries: 256 }, pendingPages: 0 });
    expect(api.molitRuntimeUsage().completedCache.bytes).toBeLessThanOrEqual(api.MOLIT_CACHE_MAX_BYTES);
    await api.fetchMolitTransactions({ ...options, lawdCd: "10001" });
    expect(fetchMock).toHaveBeenCalledTimes(257);
    await api.fetchMolitTransactions({ ...options, lawdCd: "10000" });
    expect(fetchMock).toHaveBeenCalledTimes(258);
  });
  it.each([
    xml().replace("<pageNo>1</pageNo>", ""),
    xml().replace("<numOfRows>100</numOfRows>", ""),
    xml(1, 2), xml(1, 1, 99), xml(1, 1, 100, ""), xml(0), xml(1, 1, 100, row() + row("2")),
  ])("never caches invalid page metadata/cardinality", async body => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(body)).mockImplementation(async () => new Response(xml()));
    vi.stubGlobal("fetch", fetchMock);
    const api = await load();
    expect((await api.fetchMolitRangeWithEvidence(range)).evidence.status).toBe("unavailable");
    expect(api.molitRuntimeUsage().completedCache.entries).toBe(0);
    expect((await api.fetchMolitRangeWithEvidence(range)).evidence.status).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rejects replayed page metadata and lets a corrected retry recover", async () => {
    let broken = true;
    const fetchMock = vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get("pageNo"));
      return new Response(xml(2, broken ? 1 : page, 1, row(broken ? "1" : String(page))));
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = await load();
    const bad = await api.fetchMolitRangeWithEvidence({ ...range, pageSize: 1 });
    expect(transactionEvidenceComplete([bad.evidence])).toBe(false);
    expect(bad.evidence.failedMonths[0].issue).toBe("invalid-response");
    expect(api.molitRuntimeUsage().completedCache.entries).toBe(0);
    broken = false;
    const good = await api.fetchMolitRangeWithEvidence({ ...range, pageSize: 1 });
    expect(good.transactions).toHaveLength(2);
    expect(transactionEvidenceComplete([good.evidence])).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("invalidates all retained pages when provider totals change across otherwise valid pages", async () => {
    let broken = true;
    const fetchMock = vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get("pageNo"));
      return new Response(xml(broken && page === 2 ? 3 : 2, page, 1, row(String(page))));
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = await load();
    expect((await api.fetchMolitRangeWithEvidence({ ...range, pageSize: 1 })).evidence.status).toBe("unavailable");
    expect(api.molitRuntimeUsage().completedCache.entries).toBe(0);
    broken = false;
    expect((await api.fetchMolitRangeWithEvidence({ ...range, pageSize: 1 })).evidence.status).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("MOLIT admission and cancellation", () => {
  it("admits six active plus 64 queued distinct pages and returns static overload errors", async () => {
    const { release, fetchMock } = gatedFetch(); const api = await load();
    const requests = Array.from({ length: 70 }, (_, i) => api.fetchMolitTransactions({ ...options, lawdCd: String(10000 + i) }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(api.molitRuntimeUsage().pendingPages).toBe(70);
    await expect(api.fetchMolitTransactions({ ...options, lawdCd: "20000" })).rejects.toThrow("MOLIT capacity-limit");
    release(); await Promise.all(requests);
    expect(fetchMock).toHaveBeenCalledTimes(70);
    expect(api.molitRuntimeUsage().pendingPages).toBe(0);
  });
  it("bounds same-page consumers without cancelling admitted consumers", async () => {
    const { release, fetchMock } = gatedFetch(); const api = await load();
    const requests = Array.from({ length: 64 }, () => api.fetchMolitTransactions(options));
    await expect(api.fetchMolitTransactions(options)).rejects.toThrow("MOLIT capacity-limit");
    release(); await Promise.all(requests);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("isolates one caller's cancellation and cancels upstream only after its last caller leaves", async () => {
    const { release, signals, fetchMock } = gatedFetch(); const api = await load();
    const a = new AbortController(), b = new AbortController();
    const first = api.fetchMolitTransactions({ ...options, signal: a.signal });
    const second = api.fetchMolitTransactions({ ...options, signal: b.signal });
    const firstRejected = expect(first).rejects.toThrow("timeout");
    const secondRejected = expect(second).rejects.toThrow("timeout");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    a.abort(); await firstRejected;
    expect(signals[0].aborted).toBe(false);
    b.abort(); await secondRejected;
    expect(signals[0].aborted).toBe(true);
    await vi.waitFor(() => expect(api.molitRuntimeUsage().pendingPages).toBe(0));
    expect(api.molitRuntimeUsage().completedCache.entries).toBe(0);
    const retry = api.fetchMolitTransactions(options);
    release(); await retry;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("removes cancelled queued pages without sending them upstream", async () => {
    const { release, fetchMock } = gatedFetch(); const api = await load();
    const active = Array.from({ length: 6 }, (_, i) => api.fetchMolitTransactions({ ...options, lawdCd: String(10000 + i) }));
    const controller = new AbortController();
    const queued = api.fetchMolitTransactions({ ...options, signal: controller.signal });
    const rejected = expect(queued).rejects.toThrow("timeout");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    controller.abort(); await rejected;
    release(); await Promise.all(active);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(api.molitRuntimeUsage().pendingPages).toBe(0);
  });
  it("allows repeated join/cancel cycles while preserving the one remaining subscriber", async () => {
    const { release, fetchMock, signals } = gatedFetch(); const api = await load();
    const persistent = api.fetchMolitTransactions(options);
    for (let i = 0; i < 1000; i++) {
      const controller = new AbortController();
      const request = api.fetchMolitTransactions({ ...options, signal: controller.signal });
      const rejected = expect(request).rejects.toThrow("timeout");
      controller.abort(); await rejected;
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signals[0].aborted).toBe(false);
    release(); await persistent;
    expect(api.molitRuntimeUsage().pendingPages).toBe(0);
  });
  it("redacts transport details and does not cache failures", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("synthetic-secret and private query"))
      .mockImplementation(async input => emptyResponse(input));
    vi.stubGlobal("fetch", fetchMock); const api = await load();
    await expect(api.fetchMolitTransactions(options)).rejects.toThrow("MOLIT network");
    expect(api.molitRuntimeUsage().completedCache.entries).toBe(0);
    await expect(api.fetchMolitTransactions(options)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("MOLIT range budgets", () => {
  it("limits each range to three month workers while preserving completed months", async () => {
    const { release, fetchMock } = gatedFetch(); const api = await load();
    const pending = api.fetchMolitRangeWithEvidence({ ...range, endYearMonth: "202612" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    release();
    const result = await pending;
    expect(result.evidence.completedMonths).toHaveLength(12);
    expect(result.evidence.status).toBe("complete");
  });
  it("supports six parallel 25-month queries without self-induced overload", async () => {
    vi.stubGlobal("fetch", vi.fn(async input => emptyResponse(input))); const api = await load();
    const types = ["land", "commercial", "officetel", "officeRent", "aptRent", "house"] as const;
    const results = await Promise.all(types.map(type => api.fetchMolitRangeWithEvidence({ ...range, type, startYearMonth: "202401", endYearMonth: "202601" })));
    for (const result of results) expect(result.evidence).toMatchObject({ status: "complete", failedMonths: [] });
    expect(api.molitRuntimeUsage().pendingPages).toBe(0);
  });
  it("accepts 60 months and explicitly rejects 61 months", async () => {
    const fetchMock = vi.fn(async input => emptyResponse(input)); vi.stubGlobal("fetch", fetchMock); const api = await load();
    await expect(api.fetchMolitRangeWithEvidence({ ...range, startYearMonth: "202101", endYearMonth: "202601" })).rejects.toThrow("range-limit");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await api.fetchMolitRangeWithEvidence({ ...range, startYearMonth: "202101", endYearMonth: "202512" })).evidence.completedMonths).toHaveLength(60);
  });
  it("rejects late headers even when timer callbacks have not run", async () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("fetch", vi.fn(async input => { now = 15_001; return emptyResponse(input); }));
    const api = await load();
    await expect(api.fetchMolitTransactions(options)).rejects.toThrow("timeout");
    expect(api.molitRuntimeUsage().completedCache.entries).toBe(0);
  });
  it("uses one 30-second deadline across sequential pages, not a fresh budget per page", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), ms);
      return controller.signal;
    });
    const fetchMock = vi.fn((input: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const page = Number(new URL(input).searchParams.get("pageNo"));
      const timer = setTimeout(() => resolve(new Response(xml(5, page, 1, row(String(page))))), 7000);
      init!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("timeout", "TimeoutError")); }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock); const api = await load();
    const pending = api.fetchMolitRangeWithEvidence({ ...range, pageSize: 1 });
    await vi.advanceTimersByTimeAsync(30_001);
    const result = await pending;
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.evidence).toMatchObject({ status: "unavailable", failedMonths: [{ month: "202601", issue: "timeout" }] });
    expect(result.transactions).toEqual([]);
    expect(api.molitRuntimeUsage().pendingPages).toBe(0);
  });
  it("rejects ranges exceeding 50,000 rows without calling them complete", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get("pageNo"));
      const items = Array.from({ length: 1000 }, (_, i) => row(`${page}-${i}`)).join("");
      return new Response(xml(51_000, page, 1000, items));
    }));
    const api = await load();
    const result = await api.fetchMolitRangeWithEvidence({ ...range, pageSize: 1000 });
    expect(result.evidence.failedMonths[0].issue).toBe("size-limit");
    expect(transactionEvidenceComplete([result.evidence])).toBe(false);
    expect(api.molitRuntimeUsage().completedCache.bytes).toBeLessThanOrEqual(api.MOLIT_CACHE_MAX_BYTES);
  }, 20_000);
  it("bounds cache bytes and range serialized bytes independently of row count", async () => {
    const name = "x".repeat(1_200_000);
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get("pageNo"));
      return new Response(xml(16, page, 2, row(`${page}-1`, name) + row(`${page}-2`, name)));
    }));
    const api = await load();
    const result = await api.fetchMolitRangeWithEvidence({ ...range, pageSize: 2 });
    expect(result.evidence.failedMonths[0].issue).toBe("size-limit");
    expect(result.transactions).toEqual([]);
    expect(api.molitRuntimeUsage().completedCache.bytes).toBeLessThanOrEqual(api.MOLIT_CACHE_MAX_BYTES);
    expect(api.molitRuntimeUsage().pendingPages).toBe(0);
  }, 20_000);
  it.each([{ page: 201 }, { pageSize: 1001 }, { page: 0 }, { pageSize: 0 }, { dealYearMonth: "202613" }, { lawdCd: "bad" }, { type: "toString" }])("rejects invalid request options before fetch %j", async invalid => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); const api = await load();
    await expect(api.fetchMolitTransactions({ ...options, ...invalid } as FetchOptions)).rejects.toThrow("invalid-response");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
