import { afterEach, describe, expect, it, vi } from "vitest";

function molitXml(page: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>000</resultCode>
    <resultMsg>OK</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <dealYear>2026</dealYear>
        <dealMonth>1</dealMonth>
        <dealDay>${page}</dealDay>
        <dealAmount>${page * 10000}</dealAmount>
        <dealArea>100</dealArea>
        <umdNm>쌍문동</umdNm>
        <jibun>10-${page}</jibun>
        <jimok>대</jimok>
      </item>
    </items>
    <numOfRows>100</numOfRows>
    <pageNo>${page}</pageNo>
    <totalCount>205</totalCount>
  </body>
</response>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("fetchMolitRange", () => {
  it("fetches every page reported by totalCount", async () => {
    vi.stubEnv("MOLIT_SERVICE_KEY", "test-service-key");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("pageNo") ?? "1");
      return new Response(molitXml(page), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchMolitRange } = await import("../lib/integrations/molit");
    const transactions = await fetchMolitRange({
      lawdCd: "11320",
      type: "land",
      startYearMonth: "202601",
      endYearMonth: "202601",
      pageSize: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const pages = fetchMock.mock.calls
      .map(([input]) =>
        Number(new URL(String(input)).searchParams.get("pageNo")),
      )
      .sort((a, b) => a - b);
    expect(pages).toEqual([1, 2, 3]);
    expect(transactions).toHaveLength(3);
    expect(new Set(transactions.map((transaction) => transaction.externalId)).size)
      .toBe(3);
  });
});
