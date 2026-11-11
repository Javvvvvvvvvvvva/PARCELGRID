import { afterEach, describe, expect, it, vi } from "vitest";
import { toCompVMs } from "@/lib/adapters/view-model";

const item = `<item><dealYear>2026</dealYear><dealMonth>5</dealMonth><dealDay>1</dealDay><dealAmount>25,000</dealAmount>
  <excluUseAr>29.3</excluUseAr><floor>3</floor><buildYear>2022</buildYear><mhouseNm>A &amp; B</mhouseNm>
  <umdNm>쌍문동</umdNm><jibun>1-2</jibun><houseType>다세대</houseType><buyerGbn>개인</buyerGbn><slerGbn>법인</slerGbn>
  <dealingGbn>중개거래</dealingGbn><cdealType/><cdealDay></cdealDay><rgstDate>26.06.01</rgstDate></item>`;
const xml = (items: string, count = 1) => `<response><header><resultCode>000</resultCode></header><body><pageNo>1</pageNo><numOfRows>100</numOfRows><totalCount>${count}</totalCount><items>${items}</items></body></response>`;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("MOLIT villa field and identity contracts", () => {
  it("preserves empty cancellation fields, area axis, registration and parties through the VM", async () => {
    const { parseMolitResponse } = await import("@/lib/integrations/molit");
    const result = parseMolitResponse(xml(item), "11320", "villa");
    expect(result.transactions[0]).toMatchObject({ buildingName: "A & B", type: "연립다세대", exclusiveArea: 29.3, priceManwon: 25000,
      cancellationStatus: "not-reported", areaBasis: "exclusive", registrationDate: "26.06.01", buyerType: "개인", sellerType: "법인" });
    expect(toCompVMs(result.transactions, "쌍문동")[0]).toMatchObject({ type: "연립다세대", floor: 3, areaBasis: "exclusive", cancellationStatus: "not-reported", registrationDate: "26.06.01", distanceKm: null, sameDong: true });
    expect(parseMolitResponse(xml(item.replace("<cdealType/>", "")), "11320", "villa").transactions[0].cancellationStatus).toBe("unknown");
    expect(parseMolitResponse(xml(item.replace("<dealDay>1</dealDay>", "")), "11320", "villa").transactions[0].date).toBe("");
  });
  it("never conflates legal dongs or hyphenated lot numbers", async () => {
    const { parseMolitResponse } = await import("@/lib/integrations/molit");
    const result = parseMolitResponse(xml(item + item.replace("쌍문동", "도봉동") + item.replace("<jibun>1-2", "<jibun>12"), 3), "11320", "villa");
    expect(new Set(result.transactions.map(row => row.externalId)).size).toBe(3);
  });
  it("does not label a fallback gross area as exclusive or conceal a provider district mismatch", async () => {
    const { parseMolitResponse } = await import("@/lib/integrations/molit");
    const raw = item.replace("<excluUseAr>29.3</excluUseAr>", "<excluUseAr>invalid</excluUseAr><totalFloorAr>100</totalFloorAr><sggCd>11305</sggCd>");
    expect(parseMolitResponse(xml(raw), "11320", "villa").transactions[0]).toMatchObject({ exclusiveArea: 100, areaBasis: "gross", lawdCd: "11305" });
  });
  it.each(["<!DOCTYPE response [<!ENTITY secret 'value'>]>", "<broken>"])("rejects malformed XML and DTDs without retaining raw provider text", async prefix => {
    const { parseMolitResponse } = await import("@/lib/integrations/molit");
    expect(() => parseMolitResponse(prefix + xml(item), "11320", "villa")).toThrow("invalid-response");
  });
  it.each([true, false])("fetches RHTrade and retains matching cancellation regardless of ordering %s", async cancelFirst => {
    vi.stubEnv("MOLIT_SERVICE_KEY", "synthetic-key");
    const cancelled = item.replace("<cdealType/>", "<cdealType>O</cdealType>");
    const fetchMock = vi.fn(async (input: string) => {
      expect(new URL(input).pathname).toContain("RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade");
      return new Response(xml(cancelFirst ? cancelled + item : item + cancelled, 2));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await (await import("@/lib/integrations/molit")).fetchMolitRangeWithEvidence({ lawdCd: "11320", type: "villa", startYearMonth: "202605", endYearMonth: "202605" });
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].cancellationStatus).toBe("cancelled");
    expect(result.evidence.status).toBe("complete");
    expect(fetchMock.mock.calls[0][0]).toContain("RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade");
  });
});
