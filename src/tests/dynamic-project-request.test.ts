import { describe, expect, it } from "vitest";
import {
  buildDynamicProjectRequest,
  type StoredParcel,
} from "@/lib/hooks/use-dynamic-project";
import { createRegulatoryReferenceSet } from "@/lib/regulatory/constraints";

function storedParcel(): StoredParcel {
  return {
    id: "parcel-1",
    address: "서울 도봉구 쌍문동 281-23",
    addressRoad: null,
    lat: 37.650511,
    lng: 127.025749,
    lawdCd: "11320",
    pnu: "1132010500102810023",
    lotArea: 118.02,
    zoning: "제2종일반주거지역",
    zoneCode: "UB20",
    maxFAR: 250,
    maxBCR: 60,
    heightLimit: 18,
    regulatoryConstraints: createRegulatoryReferenceSet({
      farPct: 250,
      bcrPct: 60,
      heightM: 18,
      retrievedAt: "2026-08-26T00:00:00.000Z",
    }),
    overlays: [{ code: "TEST", name: "테스트 지구", conflict: "review" }],
    landPrice: 5_000_000,
    landPriceYear: "2026",
    acquired: "2026-08-26",
    acquiredPrice: 80_000,
  };
}

describe("dynamic project request", () => {
  it("preserves legal provenance and normalizes nullable fields", () => {
    const stored = storedParcel();
    const request = buildDynamicProjectRequest(stored);

    expect(request.parcel.addressRoad).toBe("");
    expect(request.parcel.regulatoryConstraints).toEqual(
      stored.regulatoryConstraints,
    );
    expect(request.parcel.overlays).toEqual(stored.overlays);
    expect(request.parcel.estMarketPrice).toBe(stored.landPrice);
    expect(request.parcel.setback).toEqual({ road: 0, side: 0, rear: 0 });
    expect(request.parcelDong).toBe("쌍문동");
  });
});
