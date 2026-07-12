import type { CompVM } from "@/lib/adapters/view-model";
import type { Parcel } from "@/lib/finance/types";
import { sunRestrictionApplies } from "@/lib/finance/sun-envelope";
import { computeExistingRatios, headroomPct } from "./existing-building-metrics";
import { analyzeOrientation, type Direction } from "@/lib/geo/orientation";
import { analyzeFrontage } from "@/lib/geo/road-frontage";

export interface StationSummaryInput {
  name: string;
  distanceM: number;
}

export interface RoadOrientationInsight {
  orientationAvailable: boolean;
  frontageAvailable: boolean;
  frontDirection: Direction | null;
  frontLengthM: number | null;
  roadName: string | null;
  roadCenterDistanceM: number | null;
  northDirection: Direction | null;
  northLengthM: number | null;
  northIsRoad: boolean | null;
  sunReviewApplies: boolean;
  notes: string[];
}

export interface MarketInsight {
  collectedCount: number;
  sameDongCount: number;
  mapDisplayCount: number;
  recentBuildCount: number;
  medianPricePerPyeong: number | null;
  sameDongMedianPricePerPyeong: number | null;
  nearestStation: StationSummaryInput | null;
  subjectPricePerPyeong: number | null;
  subjectVsMedianPct: number | null;
}

export type DataCheckStatus = "available" | "derived" | "missing";

export interface DataCheckItem {
  label: string;
  status: DataCheckStatus;
  source: string;
  note?: string;
}

export interface DataReadinessInsight {
  availableCount: number;
  derivedCount: number;
  missingCount: number;
  items: DataCheckItem[];
}

export type ReviewTone = "positive" | "warning" | "neutral";

export interface ExistingReviewOption {
  id: "keep" | "renovate" | "rebuild";
  title: string;
  status: string;
  tone: ReviewTone;
  summary: string;
  points: string[];
}

function mainBuilding(parcel: Parcel) {
  const info = parcel.currentBuilding;
  if (!info?.hasBuilding) return null;
  return info.buildings.find((b) => b.isMainBuilding) ?? info.buildings[0] ?? null;
}

function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function ensureClosedBoundary(boundary: [number, number][]): [number, number][] {
  if (boundary.length < 3) return boundary;
  const first = boundary[0];
  const last = boundary[boundary.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return boundary;
  return [...boundary, first];
}

export function buildRoadOrientationInsight(parcel: Parcel): RoadOrientationInsight {
  const rawBoundary = parcel.boundary;
  const boundary = rawBoundary && rawBoundary.length >= 3 ? ensureClosedBoundary(rawBoundary) : null;
  const roads = parcel.roads ?? [];
  const orientation = boundary ? analyzeOrientation(boundary) : null;
  const frontage = boundary && roads.length > 0 ? analyzeFrontage(boundary, roads) : null;

  const northEdge = orientation?.edges.find((e) => e.index === orientation.northEdgeIndex) ?? null;
  const frontEdge =
    frontage && frontage.frontIndex >= 0
      ? orientation?.edges.find((e) => e.index === frontage.frontIndex) ?? null
      : null;

  const notes: string[] = [];
  if (!orientation) notes.push("필지 경계 좌표가 부족해 방위 분석을 완료하지 못했습니다.");
  if (!frontage) {
    notes.push("도로 중심선 데이터가 부족해 전면 도로를 판정하지 못했습니다.");
  } else if (frontage.frontIndex < 0) {
    notes.push("가까운 도로 중심선이 12m 이상 떨어져 있어 접도 여부를 추가 확인해야 합니다.");
  } else {
    notes.push("전면 방향은 V월드 도로 중심선과 필지 경계의 근접도를 이용한 추정입니다.");
  }
  notes.push("도로 폭은 현재 연동 데이터에 포함되지 않아 별도 확인이 필요합니다.");

  return {
    orientationAvailable: Boolean(orientation),
    frontageAvailable: Boolean(frontage && frontage.frontIndex >= 0),
    frontDirection: frontEdge?.direction ?? null,
    frontLengthM:
      frontage && frontage.frontIndex >= 0
        ? frontage.edges.find((e) => e.index === frontage.frontIndex)?.lengthM ?? null
        : null,
    roadName: frontage?.roadName ?? null,
    roadCenterDistanceM:
      frontage && frontage.frontIndex >= 0 ? frontage.frontDistM : null,
    northDirection: northEdge?.direction ?? null,
    northLengthM: northEdge?.lengthM ?? null,
    northIsRoad:
      frontage && frontage.frontIndex >= 0 && orientation
        ? frontage.frontIndex === orientation.northEdgeIndex
        : null,
    sunReviewApplies: sunRestrictionApplies(parcel.zoning),
    notes,
  };
}

export function buildMarketInsight(
  comps: CompVM[],
  stations: StationSummaryInput[],
  subjectPricePerPyeong: number | null,
  mapDisplayCount: number,
  newBuildCutoffYear: number
): MarketInsight {
  const validPrices = comps.map((c) => c.pricePerPyeong).filter((v) => v > 0);
  const sameDong = comps.filter((c) => c.sameDong);
  const sameDongPrices = sameDong.map((c) => c.pricePerPyeong).filter((v) => v > 0);
  const marketMedian = median(validPrices);
  const nearestStation =
    stations.length > 0
      ? [...stations].sort((a, b) => a.distanceM - b.distanceM)[0]
      : null;

  return {
    collectedCount: comps.length,
    sameDongCount: sameDong.length,
    mapDisplayCount,
    recentBuildCount: comps.filter(
      (c) => c.buildYear != null && c.buildYear >= newBuildCutoffYear
    ).length,
    medianPricePerPyeong: marketMedian,
    sameDongMedianPricePerPyeong: median(sameDongPrices),
    nearestStation,
    subjectPricePerPyeong,
    subjectVsMedianPct:
      subjectPricePerPyeong != null && marketMedian != null && marketMedian > 0
        ? ((subjectPricePerPyeong - marketMedian) / marketMedian) * 100
        : null,
  };
}

export function buildDataReadinessInsight(
  parcel: Parcel,
  comps: CompVM[],
  stations: StationSummaryInput[]
): DataReadinessInsight {
  const hasBuilding = Boolean(parcel.currentBuilding?.hasBuilding);
  const hasRegistryResponse = parcel.currentBuilding != null;
  const items: DataCheckItem[] = [
    {
      label: "주소·좌표",
      status: parcel.lat != null && parcel.lng != null ? "available" : "missing",
      source: "Kakao 지오코딩",
    },
    {
      label: "대지면적·PNU",
      status: parcel.lotArea > 0 && parcel.id.length > 0 ? "available" : "missing",
      source: "V월드 지적",
    },
    {
      label: "필지 경계",
      status: parcel.boundary && parcel.boundary.length >= 3 ? "available" : "missing",
      source: "V월드 연속지적도",
    },
    {
      label: "용도지역·법정 상한",
      status: parcel.zoning && parcel.maxFAR > 0 && parcel.maxBCR > 0 ? "available" : "missing",
      source: "V월드 토지이용계획",
    },
    {
      label: "기존 건물 면적·층수",
      status: hasRegistryResponse ? "available" : "missing",
      source: "MOLIT 건축물대장",
      note: hasBuilding
        ? undefined
        : hasRegistryResponse
          ? "건축물대장상 등록 건물 없음"
          : "조회 실패 가능성 확인 필요",
    },
    {
      label: "전면 도로 방향",
      status: parcel.roads && parcel.roads.length > 0 ? "derived" : "missing",
      source: "V월드 도로 중심선 + 필지 경계",
      note: "근접도 기반 추정",
    },
    {
      label: "주변 실거래",
      status: comps.length > 0 ? "available" : "missing",
      source: "MOLIT 실거래",
    },
    {
      label: "역세권 거리",
      status: stations.length > 0 ? "derived" : "missing",
      source: "Kakao 장소 + 직선거리",
    },
  ];

  if (hasBuilding) {
    items.push(
      {
        label: "실제 건물 외곽선·위치",
        status: "missing",
        source: "미연동",
        note: "현재 3D는 건폐율 기반 개략 매스",
      },
      {
        label: "기존 주차대수",
        status: "missing",
        source: "건축물대장 추가 API 필요",
      },
      {
        label: "승강기 유무",
        status: "missing",
        source: "건축물대장 추가 API 필요",
      },
      {
        label: "위반건축물 여부",
        status: "missing",
        source: "건축물대장 추가 조회 필요",
      },
      {
        label: "지붕·층별 용도",
        status: "missing",
        source: "층별개요 추가 API 필요",
      },
      {
        label: "구조 안전 상태",
        status: "missing",
        source: "현장조사·구조 검토 필요",
      }
    );
  }

  items.push({
    label: "도로 폭·건축선",
    status: "missing",
    source: "토지이용계획·현장 확인 필요",
  });

  return {
    availableCount: items.filter((i) => i.status === "available").length,
    derivedCount: items.filter((i) => i.status === "derived").length,
    missingCount: items.filter((i) => i.status === "missing").length,
    items,
  };
}

export function buildExistingReviewOptions(parcel: Parcel): ExistingReviewOption[] {
  const main = mainBuilding(parcel);
  const age = parcel.currentBuilding?.maxAgeYears ?? main?.ageYears ?? null;
  const ratios = main ? computeExistingRatios(main, parcel.lotArea) : null;
  const farHeadroom = ratios ? headroomPct(ratios.farPct, parcel.maxFAR) : null;
  const oldBuilding = age != null && age >= 30;
  const veryOldBuilding = age != null && age >= 40;
  const highFarHeadroom = farHeadroom != null && farHeadroom >= parcel.maxFAR * 0.3;

  if (!main) {
    return [
      {
        id: "keep",
        title: "기존 건물 유지",
        status: "해당 없음",
        tone: "neutral",
        summary: "건축물대장에 등록된 현재 건물이 없어 유지안을 평가하지 않습니다.",
        points: ["실제 빈 토지 여부와 멸실 신고 상태 확인 필요"],
      },
      {
        id: "renovate",
        title: "리모델링",
        status: "해당 없음",
        tone: "neutral",
        summary: "등록 건물이 없어 리모델링안을 평가하지 않습니다.",
        points: ["현장에 미등재 건물이 있는지 확인 필요"],
      },
      {
        id: "rebuild",
        title: "신축",
        status: "가능 규모 검토",
        tone: "positive",
        summary: "Stage 2에서 법규·일조·도로·주차를 반영한 신축 가능 규모를 계산합니다.",
        points: ["등록 건물 없음", "건축선·접도·주차 확인 필요"],
      },
    ];
  }

  return [
    {
      id: "keep",
      title: "기존 건물 유지",
      status: oldBuilding ? "상태 확인 우선" : "비교 검토",
      tone: oldBuilding ? "warning" : "positive",
      summary: oldBuilding
        ? "노후도가 높아 유지 결정 전에 구조·설비·누수·내진 상태 확인이 필요합니다."
        : "비교적 최근 건물이라면 유지 가치와 현재 임대·사용 수익을 먼저 검토할 수 있습니다.",
      points: [
        `건물 연령 ${age ?? "미확인"}년`,
        "현장 상태와 유지보수 비용 데이터 미확보",
      ],
    },
    {
      id: "renovate",
      title: "리모델링",
      status: veryOldBuilding ? "구조 검토 선행" : "비교 검토",
      tone: veryOldBuilding ? "warning" : "neutral",
      summary:
        "구조 안전성과 대수선 범위, 기존 주차·피난 조건을 확인한 뒤 신축안과 비용을 비교해야 합니다.",
      points: [
        "증축 가능 여부는 현재 용적률 여유만으로 판단 불가",
        "구조·설비 조사와 리모델링 개략견적 필요",
      ],
    },
    {
      id: "rebuild",
      title: "철거 후 신축",
      status: oldBuilding && highFarHeadroom ? "검토 여지 큼" : "비교 검토",
      tone: oldBuilding && highFarHeadroom ? "positive" : "neutral",
      summary:
        "노후도와 법정 용적률 미사용 여유는 신축 검토 근거지만, 실제 가능 규모와 사업성 확인 전에는 결론을 내리지 않습니다.",
      points: [
        farHeadroom != null ? `법정 용적률 잔여 ${farHeadroom.toFixed(1)}%p` : "용적률 잔여 미확인",
        parcel.demolitionCost && parcel.demolitionCost > 0
          ? `개략 철거비 ${parcel.demolitionCost.toLocaleString("ko-KR")}만원 반영`
          : "철거비 개략값 확인 필요",
        "Stage 2 일조·도로·주차 검토 필요",
      ],
    },
  ];
}
