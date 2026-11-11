import { afterEach, describe, expect, it, vi } from "vitest";

const { authorize, fetchRange } = vi.hoisted(() => ({ authorize: vi.fn(), fetchRange: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ requireApiCapability: authorize }));
vi.mock("@/lib/integrations/molit", () => ({ fetchMolitRangeWithEvidence: fetchRange }));
import { POST } from "@/app/api/parcels/dwelling-market/route";
const req = (body: unknown) => new Request("http://localhost/api/parcels/dwelling-market", { method: "POST", body: JSON.stringify(body) });
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("bounded dwelling market refresh", () => {
  it("checks analysis permissions before fetching public data", async () => {
    authorize.mockResolvedValue({ ok: false, response: new Response("forbidden", { status: 403 }) });
    expect((await POST(req({ lawdCd: "11320", dongName: "쌍문동" }))).status).toBe(403);
    expect(fetchRange).not.toHaveBeenCalled();
  });
  it("rejects arbitrary endpoint/date ranges and malformed locations", async () => {
    authorize.mockResolvedValue({ ok: true });
    for (const body of [{ lawdCd: "x", dongName: "쌍문동" }, { lawdCd: "11320", dongName: "" }, { lawdCd: "11320", dongName: "쌍문동", startYearMonth: "190001" }]) {
      expect((await POST(req(body))).status).toBe(422);
    }
    expect(fetchRange).not.toHaveBeenCalled();
  });
  it("limits queries to12months and preserves partial failure instead of declaring zero", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T16:00:00Z"));
    authorize.mockResolvedValue({ ok: true });
    fetchRange.mockResolvedValue({ transactions: [], evidence: { type: "villa", lawdCd: "11320", status: "unavailable", failedMonths: [{ month: "202610", issue: "access-denied" }] } });
    const request = req({ lawdCd: "11320", dongName: "쌍문동" });
    const response = await POST(request);
    expect(fetchRange).toHaveBeenCalledWith({ type: "villa", lawdCd: "11320", startYearMonth: "202511", endYearMonth: "202610", signal: request.signal });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ asOf: "2026-10-19", evidence: { status: "unavailable" } });
  });
  it("redacts unexpected provider errors", async () => {
    authorize.mockResolvedValue({ ok: true }); fetchRange.mockRejectedValue(new Error("private-key"));
    const response = await POST(req({ lawdCd: "11320", dongName: "쌍문동" }));
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("private-key");
  });
});
