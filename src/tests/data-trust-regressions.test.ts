import { afterEach, describe, expect, it, vi } from "vitest";
import { transactionEvidenceComplete, transactionEvidenceMessage } from "@/lib/integrations/molit-evidence";

const range = { lawdCd: "11320", type: "land" as const, startYearMonth: "202601", endYearMonth: "202601" };
const emptyXml = '<response><header><resultCode>000</resultCode></header><body><pageNo>1</pageNo><numOfRows>100</numOfRows><totalCount>0</totalCount><items/></body></response>';
const oneXml = '<response><header><resultCode>000</resultCode></header><body><pageNo>1</pageNo><numOfRows>100</numOfRows><totalCount>1</totalCount><items><item><dealYear>2026</dealYear><dealMonth>1</dealMonth><dealDay>1</dealDay><dealAmount>10000</dealAmount><dealArea>100</dealArea><umdNm>테스트동</umdNm><jibun>1</jibun></item></items></body></response>';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("MOLIT transaction failure evidence", () => {
  it("distinguishes successful zero from missing configuration", async () => {
    vi.stubEnv("MOLIT_SERVICE_KEY", "");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const missing = await (await import("@/lib/integrations/molit")).fetchMolitRangeWithEvidence(range);
    expect(missing.evidence).toMatchObject({ status: "unavailable", failedMonths: [{ month: "202601", issue: "not-configured" }] });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.resetModules(); vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-key");
    fetchMock.mockResolvedValue(new Response(emptyXml));
    const empty = await (await import("@/lib/integrations/molit")).fetchMolitRangeWithEvidence(range);
    expect(empty.evidence).toMatchObject({ status: "complete", transactionCount: 0, completedMonths: ["202601"], failedMonths: [] });
    expect(transactionEvidenceComplete([empty.evidence])).toBe(true);
    expect(transactionEvidenceMessage([missing.evidence])).toContain("거래 0건이 아니며");
  });
  it.each([
    [403, "denied body with synthetic-key", "access-denied"],
    [429, "limited", "rate-limit"],
    [200, '<OpenAPI_ServiceResponse><returnReasonCode>30</returnReasonCode><returnAuthMsg>synthetic-key</returnAuthMsg></OpenAPI_ServiceResponse>', "access-denied"],
    [200, '<response><header><resultCode>03</resultCode></header></response>', "provider-error"],
    [200, "<html>denied</html>", "invalid-response"],
    [200, '<response><resultCode>000</resultCode></response>', "invalid-response"],
    [200, oneXml.replace("<totalCount>1", "<totalCount>2"), "invalid-response"],
  ])("classifies HTTP %s as %s without response or credentials", async (status, body, issue) => {
    vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
    const { fetchMolitRangeWithEvidence, fetchMolitRange } = await import("@/lib/integrations/molit");
    const result = await fetchMolitRangeWithEvidence(range);
    expect(result.transactions).toEqual([]);
    expect(result.evidence).toMatchObject({ status: "unavailable", failedMonths: [{ month: "202601", issue }] });
    expect(JSON.stringify(result)).not.toContain("synthetic-key");
    await expect(fetchMolitRange(range)).rejects.toThrow("MOLIT");
  });
  it("keeps successful observations while excluding incomplete ranges from automatic pricing", async () => {
    vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string) => new URL(input).searchParams.get("DEAL_YMD") === "202601" ? new Response(oneXml) : new Response("denied", { status: 403 })));
    const { fetchMolitRangeWithEvidence } = await import("@/lib/integrations/molit");
    const result = await fetchMolitRangeWithEvidence({ ...range, endYearMonth: "202602" });
    expect(result.transactions).toHaveLength(1);
    expect(result.evidence).toMatchObject({ status: "partial", completedMonths: ["202601"], failedMonths: [{ month: "202602", issue: "access-denied" }] });
    expect(transactionEvidenceComplete([result.evidence])).toBe(false);
  });
  it("records timeout independently of an empty result", async () => {
    vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-key");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    const result = await (await import("@/lib/integrations/molit")).fetchMolitRangeWithEvidence(range);
    expect(result.evidence.failedMonths[0]?.issue).toBe("timeout");
  });
});

describe("VWorld origin and zoning contracts", () => {
  it("uses the configured domain for cadastral and zoning calls", async () => {
    vi.stubEnv("VWORLD_API_KEY", "synthetic-key"); vi.stubEnv("VWORLD_API_DOMAIN", "https://test.example");
    const fetchMock = vi.fn(async (input: string) => new Response(JSON.stringify(input.includes("getLandUseAttr")
      ? { landUses: { field: [{ prposAreaDstrcCode: "UQA122", prposAreaDstrcCodeNm: "제2종일반주거지역" }] } }
      : { response: { status: "NOT_FOUND" } })));
    vi.stubGlobal("fetch", fetchMock);
    const { lookupCadastral, lookupZoningByPNU } = await import("@/lib/integrations/vworld");
    await lookupCadastral(37, 127); await lookupZoningByPNU("1132010500102810023");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) expect(new URL(url).searchParams.get("domain")).toBe("https://test.example");
  });
  it.each(["<html>blocked</html>", JSON.stringify({ error: "denied" }), JSON.stringify({ landUses: { field: [] } })])("never converts invalid or unclassified zoning into source-backed zero ceilings", async body => {
    vi.stubEnv("VWORLD_API_KEY", "synthetic-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const { lookupZoningByPNU } = await import("@/lib/integrations/vworld");
    await expect(lookupZoningByPNU("1132010500102810023")).rejects.toThrow("VWorld 용도지역");
  });
});


describe("provider error redaction", () => {
  it("does not include Kakao error body in thrown errors or logs", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "synthetic-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("echo synthetic-key", { status: 403 })));
    const log = vi.spyOn(console, "error");
    try {
      const { geocodeAddress } = await import("@/lib/integrations/kakao");
      await expect(geocodeAddress("테스트 주소")).rejects.toThrow("Kakao geocode HTTP 403");
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("does not retain malformed VWorld response text in an Error cause", async () => {
    vi.stubEnv("VWORLD_API_KEY", "synthetic-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("echo synthetic-key")));
    const { lookupZoningByPNU } = await import("@/lib/integrations/vworld");
    try { await lookupZoningByPNU("1132010500102810023"); throw new Error("Expected rejection"); }
    catch (error) { expect(error).toBeInstanceOf(Error); expect((error as Error).cause).toBeUndefined(); expect(String(error)).not.toContain("synthetic-key"); }
  });
});
