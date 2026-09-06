import { describe, expect, it } from "vitest";
import type { Parcel } from "@/lib/finance/types";
import {
  buildStatusSummary,
  getBuildingRegistryStatus,
} from "@/lib/analysis/status-summary";

function parcelWithBuildingState(
  currentBuilding: Parcel["currentBuilding"],
): Parcel {
  return {
    id: "1111010100100010001",
    address: "서울특별시 종로구 테스트동 1-1",
    addressRoad: "서울특별시 종로구 테스트로 1",
    lat: 37,
    lng: 127,
    lotArea: 120,
    zoning: "제2종일반주거지역",
    zoneCode: "UB20",
    maxFAR: 200,
    maxBCR: 60,
    heightLimit: 0,
    setback: { road: 3, side: 1.5, rear: 3 },
    currentBuilding,
    landPrice: 5_000_000,
    estMarketPrice: 9_000_000,
    acquired: "2026-07-01",
    acquiredPrice: 120_000,
    demolitionCost: 0,
  };
}

describe("building registry status", () => {
  it("keeps an unavailable lookup distinct from a confirmed empty registry", () => {
    const unknownParcel = parcelWithBuildingState(null);
    const emptyParcel = parcelWithBuildingState({
      buildings: [],
      hasBuilding: false,
      totalBuildingArea: 0,
      oldestApprovalDate: "",
      maxAgeYears: 0,
      averageAgeYears: 0,
      redevelopmentSignal: "vacant",
      signalLabel: "빈 토지",
      signalReasoning: "건축물대장상 등록 건물 없음",
    });

    expect(getBuildingRegistryStatus(unknownParcel.currentBuilding)).toBe("unknown");
    expect(getBuildingRegistryStatus(emptyParcel.currentBuilding)).toBe(
      "confirmed-empty",
    );
    expect(buildStatusSummary(unknownParcel)[0]).toMatchObject({
      kind: "check",
      tone: "warning",
    });
    expect(buildStatusSummary(unknownParcel)[0].text).toContain("확보하지 못했습니다");
    expect(buildStatusSummary(emptyParcel)[0].text).toContain("등록된 현재 건물이 없습니다");
  });
});
