import { afterEach, describe, expect, it, vi } from "vitest";
import { XMLValidator } from "fast-xml-parser";
import { parseMolitResponse, MOLIT_XML_MAX_BYTES, MOLIT_XML_MAX_ELEMENTS, MOLIT_XML_MAX_NESTED_TAGS } from "@/lib/integrations/molit";
import { fetchRegistryDataset } from "@/lib/integrations/molit-building-client";
import { REGISTRY_QUERY, SYNTHETIC_TITLE, registryResponse } from "./helpers/building-registry-fixture";

const xml = (extra = "") => `<response><header><resultCode>000</resultCode></header><body><totalCount>0</totalCount><items/>${extra}</body></response>`;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe("MOLIT structure limits", () => {
  it.each(["<x/>", "<x></x>"])("accepts exactly the element budget for %s and rejects one more", tag => {
    const body = xml(tag.repeat(MOLIT_XML_MAX_ELEMENTS - 6));
    expect(parseMolitResponse(body, "11320", "villa")).toEqual({ totalCount: 0, transactions: [] });
    expect(() => parseMolitResponse(body.replace("</body>", tag + "</body>"), "11320", "villa")).toThrow("MOLIT invalid-response");
    expect(parseMolitResponse(xml(), "11320", "villa").totalCount).toBe(0);
  });
  it("rejects excessive nesting before constructing an unbounded tree", () => {
    const count = MOLIT_XML_MAX_NESTED_TAGS + 5;
    expect(() => parseMolitResponse(xml("<x>".repeat(count) + "private-value" + "</x>".repeat(count)), "11320", "villa")).toThrow("MOLIT invalid-response");
    expect(parseMolitResponse(xml("<x>".repeat(10) + "value" + "</x>".repeat(10)), "11320", "villa").totalCount).toBe(0);
  });
  it("rejects a 100000-level document before entering the uncapped syntax validator", () => {
    const validate = vi.spyOn(XMLValidator, "validate");
    const body = xml("<x>".repeat(100_000) + "private" + "</x>".repeat(100_000));
    expect(() => parseMolitResponse(body, "11320", "villa")).toThrow("MOLIT invalid-response");
    expect(validate).not.toHaveBeenCalled();
  });
  it("still rejects malformed XML after bounded construction", () => {
    expect(() => parseMolitResponse(xml().replace("</body>", "</wrong>"), "11320", "villa")).toThrow("MOLIT invalid-response");
    expect(() => parseMolitResponse(xml().replace("<items/>", "<items a='1' a='2'/>"), "11320", "villa")).toThrow("MOLIT invalid-response");
  });
  it.each(["", "<leaf/>"])("enforces the exact root-inclusive depth budget, including self-closing leaves %s", leaf => {
    const count = MOLIT_XML_MAX_NESTED_TAGS - 2 - (leaf ? 1 : 0);
    const valid = "<x>".repeat(count) + leaf + "</x>".repeat(count);
    expect(parseMolitResponse(xml(valid), "11320", "villa").totalCount).toBe(0);
    expect(() => parseMolitResponse(xml("<x>" + valid + "</x>"), "11320", "villa")).toThrow("MOLIT invalid-response");
  });
  it("limits direct parser calls in UTF-8 bytes, not JS string length", () => {
    const body = xml(`<ignored>${"가".repeat(Math.ceil(MOLIT_XML_MAX_BYTES / 3))}</ignored>`);
    expect(body.length).toBeLessThan(MOLIT_XML_MAX_BYTES);
    expect(() => parseMolitResponse(body, "11320", "villa")).toThrow("MOLIT invalid-response");
  });
  it("does not count literal XML-like text in CDATA/comments as elements", () => {
    const body = xml("<!-- " + "<x/>".repeat(MOLIT_XML_MAX_ELEMENTS) + " --><ignored><![CDATA[<x> & text]]></ignored>");
    expect(parseMolitResponse(body, "11320", "villa").totalCount).toBe(0);
  });
  it("preserves escaped values, cancellation blanks and a large valid page", () => {
    const item = "<item><dealYear>2026</dealYear><dealMonth>1</dealMonth><dealDay>1</dealDay><dealAmount>10,000</dealAmount><excluUseAr>30</excluUseAr><mhouseNm>A &amp; B</mhouseNm><umdNm>합성동</umdNm><jibun>1</jibun><cdealType/><cdealDay/></item>";
    const body = xml().replace("<totalCount>0", "<totalCount>1000").replace("<items/>", `<items>${item.repeat(1000)}</items>`);
    const result = parseMolitResponse(body, "11320", "villa");
    expect(result.transactions).toHaveLength(1000);
    expect(result.transactions[999]).toMatchObject({ buildingName: "A & B", cancellationStatus: "not-reported", exclusiveArea: 30 });
  });
  it.each([
    '"unknown":1e400',
    '"unknown":' + "[".repeat(50) + "0" + "]".repeat(50),
    '"unknown":[' + "0,".repeat(250_000) + "0]",
  ])("rejects registry JSON structural overflow even in unknown fields", async extra => {
    vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-private-key");
    const valid = JSON.stringify(registryResponse([SYNTHETIC_TITLE], 1, 1, 100));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(valid.slice(0, -1) + "," + extra + "}")));
    const result = await fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, new AbortController().signal);
    expect(result).toMatchObject({ status: "unavailable", rows: [], issues: ["invalid-response"] });
    expect(JSON.stringify(result)).not.toContain("synthetic-private-key");
  });
  it("keeps prior registry rows partial after a structurally invalid second page", async () => {
    vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(registryResponse([SYNTHETIC_TITLE], 2, 1, 1)))
      .mockResolvedValueOnce(new Response('{"unknown":1e400}')));
    const result = await fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, new AbortController().signal);
    expect(result).toMatchObject({ status: "partial", fetchedCount: 1, issues: ["invalid-response"] });
    expect(result.rows).toHaveLength(1);
  });
  it("keeps a failed month unavailable and releases the MOLIT concurrency slot for following work", async () => {
    vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-key");
    const bad = xml("<x/>".repeat(MOLIT_XML_MAX_ELEMENTS));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(new URL(url).searchParams.get("DEAL_YMD") === "202601" ? bad : xml("<pageNo>1</pageNo><numOfRows>100</numOfRows>"))));
    const { fetchMolitRangeWithEvidence } = await import("@/lib/integrations/molit");
    const result = await fetchMolitRangeWithEvidence({ lawdCd: "11320", type: "villa", startYearMonth: "202601", endYearMonth: "202602" });
    expect(result.evidence).toMatchObject({ status: "partial", failedMonths: [{ month: "202601", issue: "invalid-response" }], completedMonths: ["202602"] });
    const later = await Promise.all(Array.from({ length: 8 }, (_, i) => fetchMolitRangeWithEvidence({ lawdCd: String(12000 + i), type: "villa", startYearMonth: "202602", endYearMonth: "202602" })));
    expect(later.every(item => item.evidence.status === "complete")).toBe(true);
  });
});
