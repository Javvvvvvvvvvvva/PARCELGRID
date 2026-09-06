import { describe, expect, it } from "vitest";
import type { CompVM } from "@/lib/adapters/view-model";
import type { Parcel } from "@/lib/finance/types";
import {
  buildDataReadinessInsight,
  buildExistingReviewOptions,
  buildMarketInsight,
  buildRoadOrientationInsight,
} from "@/lib/analysis/status-insights";

function sampleParcel(): Parcel {
  return {
    id: "1111010100100010001",
    address: "서울특별시 종로구 테스트동 1-1",
    addressRoad: "서울특별시 종로구 테스트로 1",
    lat: 37.0001,
    lng: 127.0,
    lotArea: 120,
    boundary: [
      [126.9999, 37.0],
      [127.0001, 37.0],
      [127.0001, 37.0002],
      [126.9999, 37.0002],
      [126.9999, 37.0],
    ],
    roads: [
      {
        name: "테스트로",
        points: [
          [126.9998, 36.99996],
          [127.0002, 36.99996],
        ],
      },
    ],
    zoning: "제2종일반주거지역",
    zoneCode: "UB20",
    maxFAR: 200,
    maxBCR: 60,
    heightLimit: 0,
    setback: { road: 3, side: 1.5, rear: 3 },
    currentBuilding: {
      hasBuilding: true,
      totalBuildingArea: 90,
      oldestApprovalDate: "1975-01-01",
      maxAgeYears: 51,
      averageAgeYears: 51,
      redevelopmentSignal: "rebuild",
      signalLabel: "노후 건물",
      signalReasoning: "30년 이상 경과",
      buildings: [
        {
          name: "",
          mainPurpose: "단독주택",
          detailPurpose: "다가구주택",
          groundFloors: 2,
          undergroundFloors: 1,
          totalArea: 90,
          buildingArea: 55,
          buildingCoverage: 45.8,
          floorAreaRatio: 75,
          structure: "철근콘크리트구조",
          height: 6,
          approvalDate: "1975-01-01",
          ageYears: 51,
          isMainBuilding: true,
          householdCount: 0,
          familyCount: 3,
          unitCount: 0,
        },
      ],
    },
    landPrice: 5_000_000,
    estMarketPrice: 9_000_000,
    acquired: "2026-07-01",
    acquiredPrice: 120_000,
    demolitionCost: 4_500,
  };
}

function comp(id: string, ppp: number, sameDong: boolean, buildYear?: number): CompVM {
  return {
    id,
    date: "2026-01-01",
    address: sameDong ? "테스트동 2-1" : "인접동 3-1",
    type: "단독주택",
    lotArea: 100,
    priceWon: ppp * 30 * 10_000,
    pricePerPyeong: ppp,
    distanceKm: null,
    sameDong,
    lawdCd: "1111010100",
    buildYear,
  };
}

describe("Stage 1 status insights", () => {
  it("derives front-road and north-orientation context without inventing road width", () => {
    const insight = buildRoadOrientationInsight(sampleParcel());

    expect(insight.orientationAvailable).toBe(true);
    expect(insight.frontageAvailable).toBe(true);
    expect(insight.roadName).toBe("테스트로");
    expect(insight.frontLengthM).toBeGreaterThan(0);
    expect(insight.notes.some((note) => note.includes("도로 폭"))).toBe(true);
  });

  it("also accepts an open parcel ring and closes it before orientation analysis", () => {
    const parcel = sampleParcel();
    parcel.boundary = parcel.boundary?.slice(0, -1);

    const insight = buildRoadOrientationInsight(parcel);

    expect(insight.orientationAvailable).toBe(true);
    expect(insight.frontageAvailable).toBe(true);
  });

  it("separates total market collection, same-dong evidence and map display", () => {
    const insight = buildMarketInsight(
      [comp("1", 1_000, true, 2024), comp("2", 1_400, true, 2010), comp("3", 2_000, false, 2025)],
      [
        { name: "먼역", distanceM: 900 },
        { name: "가까운역", distanceM: 420 },
      ],
      1_500,
      2,
      2021
    );

    expect(insight.collectedCount).toBe(3);
    expect(insight.sameDongCount).toBe(2);
    expect(insight.mapDisplayCount).toBe(2);
    expect(insight.sameDongMedianPricePerPyeong).toBe(1_200);
    expect(insight.nearestStation?.name).toBe("가까운역");
  });

  it("labels unavailable building facts as additional checks instead of false negatives", () => {
    const insight = buildDataReadinessInsight(sampleParcel(), [comp("1", 1_000, true)], []);

    expect(insight.items.find((item) => item.label === "기존 주차대수")?.status).toBe("missing");
    expect(insight.items.find((item) => item.label === "위반건축물 여부")?.status).toBe("missing");
    expect(insight.items.find((item) => item.label === "전면 도로 방향")?.status).toBe("derived");
    expect(insight.items.find((item) => item.label === "건폐율·용적률 상한"))
      .toMatchObject({ status: "derived" });
  });

  it("keeps rebuild as a preliminary option, not a final recommendation", () => {
    const options = buildExistingReviewOptions(sampleParcel());
    const rebuild = options.find((option) => option.id === "rebuild");

    expect(rebuild?.status).toBe("검토 여지 큼");
    expect(rebuild?.summary).toContain("결론을 내리지 않습니다");
    expect(rebuild?.points.some((point) => point.includes("Stage 2"))).toBe(true);
    expect(rebuild?.costImpact).toContain("철거");
    expect(rebuild?.requiredChecks).toContain("Stage 2 실제 배치·일조·주차 검증");
    expect(rebuild?.nextStep).toContain("Stage 3");
  });

  it("does not treat a missing registry response as confirmed vacant land", () => {
    const parcel = sampleParcel();
    parcel.currentBuilding = null;

    const readiness = buildDataReadinessInsight(parcel, [], []);
    const options = buildExistingReviewOptions(parcel);

    expect(
      readiness.items.find((item) => item.label === "기존 건물 면적·층수"),
    ).toMatchObject({ status: "missing", note: "조회 실패 가능성 확인 필요" });
    expect(options.every((option) => option.status.includes("확인"))).toBe(true);
    expect(options.find((option) => option.id === "rebuild")?.points).not.toContain(
      "등록 건물 없음",
    );
  });
});
