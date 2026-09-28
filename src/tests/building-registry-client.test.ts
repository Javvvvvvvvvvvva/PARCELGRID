import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupBuildingByJibun, lookupBuildingByPnu, geocodeToBuildingQuery, pnuToBuildingQuery } from "@/lib/integrations/molit-building";
import { getBuildingRegistryStatus } from "@/lib/building-registry/evidence";
import { fetchRegistryDataset } from "@/lib/integrations/molit-building-client";
import { buildingRegistryEvidenceSchema } from "@/lib/building-registry/types";
import { REGISTRY_QUERY, SYNTHETIC_TITLE, registryResponse } from "./helpers/building-registry-fixture";

const PNU = "1132010500102810023";
function mockJson(value: unknown) { return vi.stubGlobal("fetch", vi.fn(async () => Response.json(value))); }
beforeEach(() => vi.stubEnv("MOLIT_SERVICE_KEY", "private-test-key%2B"));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("building registry observation contract", () => {
  it("requires an explicit successful empty response, never equates it to physical vacancy", async () => {
    mockJson(registryResponse([], 0));
    const result = await lookupBuildingByPnu(PNU);
    expect(result?.registry?.title).toMatchObject({ status: "complete", totalCount: 0, pagesFetched: 1 });
    expect(getBuildingRegistryStatus(result)).toBe("no-records");
    expect(result?.signalReasoning).toContain("부속지번");
    expect(result?.signalReasoning).not.toContain("즉시");
  });

  it.each([
    {}, { response: { body: { totalCount: 0 } } },
    { response: { header: { resultCode: "00" }, body: { items: "", numOfRows: 100, pageNo: 1 } } },
    registryResponse("not-an-item", 0), registryResponse([SYNTHETIC_TITLE], 0),
  ])("does not turn malformed/missing body fields into an empty registry: %j", async (value) => {
    mockJson(value);
    const result = await lookupBuildingByPnu(PNU);
    expect(getBuildingRegistryStatus(result)).toBe("unknown");
    expect(result?.registry?.title.issues).toContain("invalid-response");
  });

  it("preserves access denial without persisting provider text or the service key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><errMsg>private-test-key</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>")));
    const result = await lookupBuildingByPnu(PNU);
    expect(result?.registry?.title.issues).toEqual(["access-denied"]);
    expect(JSON.stringify(result)).not.toContain("private-test-key");
  });

  it("keeps unconfigured and unavailable services distinguishable", async () => {
    vi.stubEnv("MOLIT_SERVICE_KEY", ""); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await lookupBuildingByPnu(PNU))?.registry?.title.issues).toEqual(["not-configured"]);
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("MOLIT_SERVICE_KEY", "test"); fetch.mockRejectedValue(new TypeError("network with secret"));
    expect((await lookupBuildingByPnu(PNU))?.registry?.title.issues).toEqual(["network"]);
  });

  it("reads all returned pages, keeps literal IDs, and decodes the API key once", async () => {
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input); const page = Number(url.searchParams.get("pageNo"));
      expect(url.searchParams.get("serviceKey")).toBe("private-test-key+");
      expect(url.searchParams.get("_type")).toBe("json");
      return Response.json(registryResponse([0, 1].slice(0, page === 2 ? 1 : 2).map((i) => ({
        ...SYNTHETIC_TITLE, mgmBldrgstPk: `NEW-PK:${page}-${i}`, rnum: String((page - 1) * 2 + i + 1),
      })), 3, page, 2));
    }); vi.stubGlobal("fetch", fetch);
    const result = await lookupBuildingByPnu(PNU);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result?.buildings).toHaveLength(3);
    expect(result?.buildings[0].registryId).toBe("NEW-PK:1-0");
    expect(result?.registry?.title.status).toBe("complete");
    expect(buildingRegistryEvidenceSchema.safeParse(result?.registry).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain("serviceKey");
  });

  it("retains first-page evidence when a later page exceeds the API quota", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(registryResponse([SYNTHETIC_TITLE], 2, 1, 1)))
      .mockResolvedValueOnce(Response.json({ response: { header: { resultCode: "22" } } })));
    const result = await lookupBuildingByPnu(PNU);
    expect(result?.buildings).toHaveLength(1);
    expect(result?.registry?.title).toMatchObject({ status: "partial", totalCount: 2, fetchedCount: 1, issues: ["rate-limit"] });
    expect(result?.redevelopmentSignal).toBe("unknown");
  });

  it("rejects repeated pages and changed counts without double counting", async () => {
    for (const changed of [false, true]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(registryResponse([SYNTHETIC_TITLE], 2, 1, 1)))
        .mockResolvedValueOnce(Response.json(registryResponse([SYNTHETIC_TITLE], changed ? 3 : 2, 2, 1))));
      const result = await lookupBuildingByPnu(PNU);
      expect(result?.registry?.title.issues).toContain(changed ? "count-changed" : "repeated-page");
      expect(result?.buildings).toHaveLength(1);
    }
  });

  it("bounds large queries and labels the retained subset partial", async () => {
    const fetch = vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get("pageNo"));
      return Response.json(registryResponse([{ ...SYNTHETIC_TITLE, rnum: String(page), mgmBldrgstPk: `PK-${page}` }], 11, page, 1));
    }); vi.stubGlobal("fetch", fetch);
    const result = await lookupBuildingByPnu(PNU);
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(result?.registry?.title.issues).toContain("page-limit");
    expect(result?.registry?.title.status).toBe("partial");
  });

  it("bounds retained evidence size so large registries cannot overflow ordinary parcel drafts", async () => {
    mockJson(registryResponse(Array.from({ length: 100 }, (_, i) => ({ ...SYNTHETIC_TITLE,
      mgmBldrgstPk: `size-${i}`, rnum: String(i + 1), bldNm: "가".repeat(500), dongNm: "나".repeat(500),
      mainPurpsCdNm: "다".repeat(500), etcPurps: "라".repeat(500) })), 100));
    const result = await lookupBuildingByPnu(PNU);
    expect(result?.registry?.title.status).toBe("partial");
    expect(result?.registry?.title.issues).toContain("size-limit");
    expect(result?.registry?.title.fetchedCount).toBe(100);
    expect(result?.registry?.title.rows.length).toBeLessThan(100);
    expect(new TextEncoder().encode(JSON.stringify(result?.registry?.title)).length).toBeLessThan(351_000);
  });

  it("keeps missing/invalid numeric values distinct from actual zero", async () => {
    mockJson(registryResponse({ ...SYNTHETIC_TITLE, totArea: "", archArea: "NaN", useAprDay: "20260230", indrAutoUtcnt: "" }));
    const result = await lookupBuildingByPnu(PNU);
    expect(result?.buildings[0]).toMatchObject({ parkingCount: null, passengerElevators: 0, approvalDate: "" });
    expect(result?.buildings[0].missingFields).toEqual(expect.arrayContaining(["totArea", "archArea"]));
    expect(result?.registry?.title.rows[0].fields.totArea).toBe("");
    expect(result?.redevelopmentSignal).toBe("unknown");
  });

  it("rejects off-parcel rows and does not merge duplicate title IDs", async () => {
    mockJson(registryResponse([SYNTHETIC_TITLE, { ...SYNTHETIC_TITLE, rnum: "2" }, { ...SYNTHETIC_TITLE, rnum: "3", bun: "0999" }], 3));
    const result = await lookupBuildingByPnu(PNU);
    expect(result?.buildings).toHaveLength(1);
    expect(result?.registry?.title.issues).toEqual(expect.arrayContaining(["duplicate-title-id", "invalid-row"]));
  });

  it("retains title results if detail access fails and keeps floor and unit datasets separate", async () => {
    const fetch = vi.fn(async (input: string) => {
      const op = new URL(input).pathname.split("/").at(-1);
      if (op === "getBrTitleInfo") return Response.json(registryResponse(SYNTHETIC_TITLE));
      if (op === "getBrFlrOulnInfo") return Response.json(registryResponse([{ ...SYNTHETIC_TITLE, area: "200.3", areaExctYn: "N" }]));
      return Response.json({ response: { header: { resultCode: "20" } } });
    }); vi.stubGlobal("fetch", fetch);
    const result = await lookupBuildingByJibun("1132010500", "281", "23", "N");
    expect(result?.registry?.title.status).toBe("complete");
    expect(result?.registry?.floors.rows).toHaveLength(1);
    expect(result?.registry?.exclusiveCommon.issues).toEqual(["access-denied"]);
    expect(getBuildingRegistryStatus(result)).toBe("present");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid parcel queries and honors an already cancelled deadline", async () => {
    expect(pnuToBuildingQuery("1132010500902810023")).toBeNull();
    expect(geocodeToBuildingQuery("1132010500", "1&bun=2", "23", "N")).toBeNull();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await fetchRegistryDataset("getBrTitleInfo", REGISTRY_QUERY, AbortSignal.abort());
    expect(result.issues).toEqual(["timeout"]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
