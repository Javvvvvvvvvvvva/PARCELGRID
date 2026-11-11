import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRegistryDataset } from "@/lib/integrations/molit-building-client";
import { lookupBuildingByJibun } from "@/lib/integrations/molit-building";
import { REGISTRY_QUERY, SYNTHETIC_TITLE, registryResponse } from "./helpers/building-registry-fixture";

beforeEach(() => {
  vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-deadline-key");
  vi.stubEnv("KAKAO_REST_API_KEY", "synthetic-deadline-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected provider request in test"); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetModules();
});

function monotonicClock() {
  let now = 0;
  // Advance elapsed work without firing AbortSignal.timeout's native timer.
  vi.spyOn(performance, "now").mockImplementation(() => now);
  return { advance: (ms: number) => { now += ms; } };
}

function unreadResponse() {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }));
  return { response, cancel };
}

function advanceAfterParse(raw: string, advance: () => void) {
  const parse = JSON.parse;
  return vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
    const result: unknown = parse(text, reviver);
    if (text === raw) advance();
    return result;
  });
}

const kakaoCases = [
  { name: "address", body: { documents: [], meta: { total_count: 0, pageable_count: 0, is_end: true } } },
  { name: "stations", body: { documents: [{ place_name: "Synthetic station", x: "127", y: "37", distance: "12" }] } },
] as const;

async function kakaoCall(name: "address" | "stations") {
  const kakao = await import("@/lib/integrations/kakao");
  return name === "address"
    ? () => kakao.geocodeAddress("private-address-marker")
    : () => kakao.searchNearbyStations(37, 127);
}

describe.each(kakaoCases)("Kakao $name total deadline", ({ name, body }) => {
  it("rejects late headers and discards their unread body before the abort timer fires", async () => {
    const invoke = await kakaoCall(name);
    const clock = monotonicClock();
    const late = unreadResponse();
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      clock.advance(8_001);
      expect(init?.signal?.aborted).toBe(false);
      return late.response;
    }));

    await expect(invoke()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(late.cancel).toHaveBeenCalledOnce();
  });

  it("rejects a valid JSON parse that crosses the original request deadline", async () => {
    const invoke = await kakaoCall(name);
    const clock = monotonicClock();
    const raw = JSON.stringify(body);
    advanceAfterParse(raw, () => clock.advance(8_001));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(raw)));

    await expect(invoke()).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("gives a stalled body only the budget remaining after headers", async () => {
    const invoke = await kakaoCall(name);
    const clock = monotonicClock();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stalled = unreadResponse();
    vi.stubGlobal("fetch", vi.fn(async () => {
      clock.advance(7_900);
      return stalled.response;
    }));
    const rejection = expect(invoke()).rejects.toMatchObject({ name: "TimeoutError" });

    await vi.advanceTimersByTimeAsync(101);
    await rejection;
    expect(stalled.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["Error", "AbortError", "TimeoutError"])("redacts transport %s messages and nested causes", async errorName => {
    const invoke = await kakaoCall(name);
    const transport = new Error("private-address-marker synthetic-deadline-key", {
      cause: new Error("private-cause-marker"),
    });
    transport.name = errorName;
    vi.stubGlobal("fetch", vi.fn(async () => { throw transport; }));

    const error: unknown = await invoke().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(transport);
    expect(error).toMatchObject(errorName === "Error"
      ? { name: "Error", message: "Kakao network request failed" }
      : { name: "TimeoutError", message: "Kakao request interrupted." });
    expect(error).not.toHaveProperty("cause");
    expect((error as Error).stack).not.toMatch(/private-address-marker|synthetic-deadline-key|private-cause-marker/);
  });
});

describe("building registry total deadlines", () => {
  it.each([
    { name: "per-page deadline", outerDeadline: Infinity, secondPageMs: 8_001 },
    { name: "remaining outer deadline", outerDeadline: 10_000, secondPageMs: 3_001 },
  ])("retains only earlier rows when the second page exceeds its $name", async ({ outerDeadline, secondPageMs }) => {
    const clock = monotonicClock();
    const late = unreadResponse();
    const parent = new AbortController();
    const fetch = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("pageNo"));
      clock.advance(page === 1 ? 7_000 : secondPageMs);
      return page === 1 ? Response.json(registryResponse([SYNTHETIC_TITLE], 2, 1, 1)) : late.response;
    });
    vi.stubGlobal("fetch", fetch);

    const result = await fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, parent.signal, outerDeadline);

    expect(result).toMatchObject({ status: "partial", pagesFetched: 1, fetchedCount: 1, totalCount: 2, issues: ["timeout"] });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].registryPk).toBe(SYNTHETIC_TITLE.mgmBldrgstPk);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(late.cancel).toHaveBeenCalledOnce();
    expect(parent.signal.aborted).toBe(false);
  });

  it("rejects valid JSON when parsing crosses the page deadline", async () => {
    const clock = monotonicClock();
    const raw = JSON.stringify(registryResponse([SYNTHETIC_TITLE]));
    advanceAfterParse(raw, () => clock.advance(8_001));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(raw)));

    const result = await fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, new AbortController().signal);

    expect(result).toMatchObject({ status: "unavailable", pagesFetched: 0, rows: [], issues: ["timeout"] });
  });

  it("does not start a page after the shared outer deadline has elapsed", async () => {
    const clock = monotonicClock();
    clock.advance(10_001);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, new AbortController().signal, 10_000);

    expect(result).toMatchObject({ status: "unavailable", pagesFetched: 0, rows: [], issues: ["timeout"] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares the lookup's 25-second deadline across title pagination and both detail operations", async () => {
    const clock = monotonicClock();
    const detailResponses: ReturnType<typeof unreadResponse>[] = [];
    const releaseDetails: Array<() => void> = [];
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      const page = Number(url.searchParams.get("pageNo"));
      if (url.pathname.endsWith("/getBrTitleInfo")) {
        clock.advance(7_000);
        const row = { ...SYNTHETIC_TITLE, mgmBldrgstPk: `synthetic-title-${page}`, rnum: String(page) };
        return Response.json(registryResponse([row], 3, page, 1));
      }
      const late = unreadResponse();
      detailResponses.push(late);
      return new Promise<Response>(resolve => {
        releaseDetails.push(() => resolve(late.response));
        if (releaseDetails.length === 2) {
          clock.advance(4_001);
          releaseDetails.forEach(release => release());
        }
      });
    });
    vi.stubGlobal("fetch", fetch);

    const result = await lookupBuildingByJibun("1132010500", "281", "23", "N");

    expect(result?.registry?.title).toMatchObject({ status: "complete", pagesFetched: 3, fetchedCount: 3, issues: [] });
    expect(result?.registry?.floors).toMatchObject({ status: "unavailable", rows: [], issues: ["timeout"] });
    expect(result?.registry?.exclusiveCommon).toMatchObject({ status: "unavailable", rows: [], issues: ["timeout"] });
    expect(result?.buildings).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(detailResponses).toHaveLength(2);
    for (const late of detailResponses) expect(late.cancel).toHaveBeenCalledOnce();
  });
});
