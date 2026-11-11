import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cadastral: vi.fn(), upis: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ requireApiCapability: async () => ({ ok: true }) }));
vi.mock("@/lib/integrations/vworld-cadastral-context", () => ({ fetchCadastralContextParcels: mocks.cadastral }));
vi.mock("@/lib/integrations/vworld-upis-roads", () => ({ fetchUpisRoadBoundaries: mocks.upis, VWORLD_UPIS_ROAD_DATA: "LT_C_UPISUQ151" }));
import { POST } from "@/app/api/parcels/cadastral-context/route";

function request(signal?: AbortSignal) {
  return new NextRequest("http://localhost/api/parcels/cadastral-context", {
    method: "POST", signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetPnu: "1132010500102810023", lat: 37, lng: 127 }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VWORLD_ENABLED", "true");
  vi.stubEnv("VWORLD_API_KEY", "synthetic-key");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.cadastral.mockResolvedValue([]);
  mocks.upis.mockResolvedValue({ parcels: [], summaries: [] });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("cadastral context route evidence", () => {
  it("distinguishes successful empty results from complete query coverage", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ parcels: [], queryCompleteness: "unconfirmed", sourceEvidence: {
      cadastral: { status: "empty", resultCount: 0 }, upis: { status: "empty", resultCount: 0 },
    } });
    expect(payload.warnings).toHaveLength(2);
  });
  it.each(["cadastral", "upis"] as const)("preserves partial success with unavailable %s count and a visible warning", async (provider) => {
    mocks[provider].mockRejectedValue(new Error("https://private.invalid?key=synthetic-key"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.sourceEvidence[provider]).toMatchObject({ status: "unavailable", resultCount: null });
    expect(payload.sourceSummary[provider === "cadastral" ? "cadastralParcelCount" : "upisRoadBoundaryCount"]).toBeNull();
    expect(payload.warnings.join(" ")).toContain("확인하지 못했습니다");
    expect(JSON.stringify([payload, vi.mocked(console.warn).mock.calls])).not.toMatch(/private\.invalid|synthetic-key/);
  });
  it("does not return a successful empty context when both providers failed", async () => {
    mocks.cadastral.mockRejectedValue(new Error("private"));
    mocks.upis.mockRejectedValue(new Error("private"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).not.toHaveProperty("parcels");
    expect(payload.sourceEvidence.cadastral.resultCount).toBeNull();
    expect(payload.sourceEvidence.upis.resultCount).toBeNull();
  });
  it("shares one deadline and propagates request cancellation to both providers", async () => {
    const controller = new AbortController();
    await POST(request(controller.signal));
    const cadastral = mocks.cadastral.mock.calls[0][0], upis = mocks.upis.mock.calls[0][0];
    expect(cadastral.outerDeadline).toBe(upis.outerDeadline);
    expect(cadastral.signal).toBe(upis.signal);
    controller.abort();
    expect(cadastral.signal.aborted).toBe(true);
  });
  it("rejects late success even when an adapter ignores the deadline", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    mocks.upis.mockImplementation(async () => { now = 13_000; return { parcels: [], summaries: [] }; });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty("parcels");
  });
  it("makes no provider calls when VWorld is disabled", async () => {
    vi.stubEnv("VWORLD_ENABLED", "false");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.cadastral).not.toHaveBeenCalled();
    expect(mocks.upis).not.toHaveBeenCalled();
  });
});
