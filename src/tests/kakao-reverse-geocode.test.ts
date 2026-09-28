import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("map point to legal lot address", () => {
  const originalKey = process.env.KAKAO_REST_API_KEY;
  const fetchMock = vi.fn();
  beforeEach(() => { vi.resetModules(); process.env.KAKAO_REST_API_KEY = "synthetic-server-key"; vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); if (originalKey == null) delete process.env.KAKAO_REST_API_KEY; else process.env.KAKAO_REST_API_KEY = originalKey; });
  it("uses the land-lot address, not a road label, to resolve the legal code", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ documents: [{ address: { address_name: "서울 도봉구 쌍문동 281-23" }, road_address: { address_name: "별도 도로명" } }] })));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ documents: [{ address_name: "서울 도봉구 쌍문동 281-23", address_type: "REGION_ADDR", x: "127.0258", y: "37.6505",
      address: { address_name: "서울 도봉구 쌍문동 281-23", region_1depth_name: "서울", region_2depth_name: "도봉구", region_3depth_name: "쌍문동", h_code: "1132068100", b_code: "1132010500", mountain_yn: "N", main_address_no: "281", sub_address_no: "23" }, road_address: null }], meta: { total_count: 1, pageable_count: 1, is_end: true } })));
    const { reverseGeocodeLocation } = await import("@/lib/integrations/kakao");
    const result = await reverseGeocodeLocation(37.650511, 127.025749);
    expect(result).toMatchObject({ bCode: "1132010500", mainAddressNo: "281", subAddressNo: "23" });
    const first = new URL(String(fetchMock.mock.calls[0][0]));
    expect(first.searchParams.get("x")).toBe("127.025749"); expect(first.searchParams.get("y")).toBe("37.650511");
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("query")).toBe("서울 도봉구 쌍문동 281-23");
    expect(JSON.stringify(result)).not.toContain("synthetic-server-key");
  });
  it("does not manufacture a parcel from empty or road-only reverse results", async () => {
    const { reverseGeocodeLocation } = await import("@/lib/integrations/kakao");
    for (const documents of [[], [{ address: null, road_address: { address_name: "도로" } }]]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ documents })));
      expect(await reverseGeocodeLocation(37.65, 127.02)).toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("propagates provider unavailability instead of selecting a fallback lot", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const { reverseGeocodeLocation } = await import("@/lib/integrations/kakao");
    await expect(reverseGeocodeLocation(37.65, 127.02)).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
