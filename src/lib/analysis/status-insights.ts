import type { CompVM } from "@/lib/adapters/view-model";
import type { Parcel } from "@/lib/finance/types";
import { sunRestrictionApplies } from "@/lib/finance/sun-envelope";
import { computeExistingRatios, headroomPct } from "./existing-building-metrics";
import { analyzeOrientation, type Direction } from "@/lib/geo/orientation";
import { analyzeFrontage } from "@/lib/geo/road-frontage";
import { getExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";
import { getBuildingRegistryStatus } from "./status-summary";
import { regulatoryConstraintIsDecisionGrade } from "@/lib/regulatory/constraints";

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
  costImpact: string;
  requiredChecks: string[];
  nextStep: string;
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
  const manualParcel = parcel.inputProvenance?.mode === "manual";

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
    notes.push(
      manualParcel
        ? "전면 방향은 연결된 도로 선형과 사용자 필지 경계의 근접도를 이용한 추정입니다."
        : "전면 방향은 VWorld 도로 중심선과 필지 경계의 근접도를 이용한 추정입니다.",
    );
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
  const buildingStatus = getBuildingRegistryStatus(parcel.currentBuilding);
  const hasBuilding = buildingStatus === "present";
  const hasRegistryResponse = buildingStatus !== "unknown";
  const geometry = getExistingBuildingGeometry(parcel.currentBuilding);
  const actualGeometry = geometry?.status === "matched" && geometry.footprints.length > 0;
  const knownViolationCount =
    geometry?.footprints.filter((footprint) => footprint.violationStatus !== "unknown").length ?? 0;
  const violationYesCount =
    geometry?.footprints.filter((footprint) => footprint.violationStatus === "yes").length ?? 0;
  const constraints = parcel.regulatoryConstraints;
  const zoningSourceBacked = constraints?.zoningSource.status === "source-backed";
  const regulationDecisionGrade =
    regulatoryConstraintIsDecisionGrade(constraints?.far) &&
    regulatoryConstraintIsDecisionGrade(constraints?.bcr);
  const hasRegulationReference = parcel.maxFAR > 0 && parcel.maxBCR > 0;
  const manualParcel = parcel.inputProvenance?.mode === "manual";
  const userEnteredRegulation =
    constraints?.far.status === "user-entered" ||
    constraints?.bcr.status === "user-entered";

  const items: DataCheckItem[] = [
    {
      label: "주소·좌표",
      status: parcel.lat != null && parcel.lng != null ? "available" : "missing",
      source: "Kakao 지오코딩",
    },
    {
      label: "대지면적·PNU",
      status:
        parcel.lotArea > 0 && parcel.id.length > 0
          ? manualParcel
            ? "derived"
            : "available"
          : "missing",
      source: manualParcel ? "Kakao 주소 기반 PNU · 사용자 면적" : "VWorld 지적",
    },
    {
      label: "필지 경계",
      status:
        parcel.boundary && parcel.boundary.length >= 3
          ? manualParcel
            ? "derived"
            : "available"
          : "missing",
      source:
        parcel.inputProvenance?.geometry === "user-geojson"
          ? "사용자 GeoJSON · WGS84"
          : "VWorld 연속지적도",
    },
    {
      label: "용도지역",
      status: zoningSourceBacked
        ? "available"
        : parcel.zoning
          ? "derived"
          : "missing",
      source: zoningSourceBacked
        ? constraints.zoningSource.sourceName
        : manualParcel
          ? "사용자 입력 · 원문 미확인"
          : "용도지역 조회값 · 원문 미확인",
      note: zoningSourceBacked ? undefined : "원문 출처와 기준일 확인 필요",
    },
    {
      label: "건폐율·용적률 상한",
      status: regulationDecisionGrade
        ? "available"
        : hasRegulationReference
          ? "derived"
          : "missing",
      source: regulationDecisionGrade
        ? `${constraints?.bcr.sourceName ?? "건폐율 원문"} · ${constraints?.far.sourceName ?? "용적률 원문"}`
        : userEnteredRegulation
          ? "사용자 입력 · 관할 원문 미확인"
          : "국토계획법 시행령 전국 범위 참고",
      note: regulationDecisionGrade
        ? undefined
        : "관할 조례·지구단위계획 원문 확인 전에는 필지별 법정 상한이 아님",
    },
    {
      label: "기존 건물 면적·층수",
      status: hasRegistryResponse ? "available" : "missing",
      source: actualGeometry ? "MOLIT 건축물대장 + V월드 GIS건물통합정보" : "MOLIT 건축물대장",
      note: hasBuilding
        ? undefined
        : hasRegistryResponse
          ? "공공 데이터상 등록 건물 없음"
          : "조회 실패 가능성 확인 필요",
    },
    {
      label: "전면 도로 방향",
      status: parcel.roads && parcel.roads.length > 0 ? "derived" : "missing",
      source: manualParcel
        ? "도로 선형 미연결 · 사용자 필지 경계"
        : "VWorld 도로 중심선 + 필지 경계",
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
        status: actualGeometry ? "available" : "missing",
        source: actualGeometry
          ? "V월드 GIS건물통합정보 dt_d010"
          : geometry?.status === "error"
            ? "V월드 GIS건물통합정보 조회 실패"
            : "V월드 GIS건물통합정보 미매칭",
        note: actualGeometry
          ? `${geometry.footprints.length}개 형상 · ${geometry.footprints[0]?.matchMethod === "pnu" ? "PNU 직접 매칭" : "필지 겹침 매칭"}`
          : "현재 3D는 건폐율 기반 개략 매스",
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
        status: knownViolationCount > 0 ? "available" : "missing",
        source: knownViolationCount > 0 ? "V월드 GIS건물통합정보 violt_bild" : "추가 확인 필요",
        note:
          knownViolationCount > 0
            ? violationYesCount > 0
              ? `${violationYesCount}개 형상에서 위반 값 확인 · 원문 대장 재확인 필요`
              : `${knownViolationCount}개 형상에서 비위반 값 확인 · 원문 대장 재확인 권장`
            : "코드값 미제공 또는 해석 불가",
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
  const buildingStatus = getBuildingRegistryStatus(parcel.currentBuilding);
  const age = parcel.currentBuilding?.maxAgeYears ?? main?.ageYears ?? null;
  const ratios = main ? computeExistingRatios(main, parcel.lotArea) : null;
  const farHeadroom = ratios ? headroomPct(ratios.farPct, parcel.maxFAR) : null;
  const oldBuilding = age != null && age >= 30;
  const veryOldBuilding = age != null && age >= 40;
  const highFarHeadroom = farHeadroom != null && farHeadroom >= parcel.maxFAR * 0.3;

  if (buildingStatus === "unknown") {
    return [
      {
        id: "keep",
        title: "기존 건물 유지",
        status: "자료 확인 필요",
        tone: "warning",
        summary: "건축물대장 조회 결과가 없어 유지 가능성을 아직 평가할 수 없습니다.",
        points: ["기존 건물 유무와 대장 일치 여부 미확인"],
        costImpact: "건물 현황을 확인하기 전에는 유지비와 보수비를 산정하지 않습니다.",
        requiredChecks: ["건축물대장 원문", "현장 건물 존재 여부", "임대차·사용 현황"],
        nextStep: "건축물대장과 현장 현황을 확보한 뒤 유지안을 다시 평가합니다.",
      },
      {
        id: "renovate",
        title: "리모델링",
        status: "자료 확인 필요",
        tone: "warning",
        summary: "대상 건물의 구조·면적·노후도를 알 수 없어 리모델링안을 평가할 수 없습니다.",
        points: ["건물 구조·면적·사용승인일 미확인"],
        costImpact: "대상 건물과 공사 범위를 확인하기 전에는 리모델링 비용을 산정하지 않습니다.",
        requiredChecks: ["건축물대장 원문", "구조·설비 상태", "위반건축물 여부"],
        nextStep: "대장과 현장조사를 확보한 뒤 리모델링 범위와 비용을 검토합니다.",
      },
      {
        id: "rebuild",
        title: "신축",
        status: "대장 확인 선행",
        tone: "warning",
        summary: "기존 건물 유무가 확인되지 않아 철거 범위와 신축 착수 조건을 확정할 수 없습니다.",
        points: ["철거 대상·멸실 상태 미확인", "Stage 2 가능 규모는 예비 검토만 가능"],
        costImpact: "철거비, 명도비, 석면 조사비가 누락될 수 있어 취득 판단에 사용하지 않습니다.",
        requiredChecks: ["건축물대장 원문", "현장 건물 존재 여부", "멸실·위반·임차권 상태"],
        nextStep: "기존 건물 상태를 확인한 뒤 Stage 2 배치안과 Stage 3 사업비를 갱신합니다.",
      },
    ];
  }

  if (!main) {
    return [
      {
        id: "keep",
        title: "기존 건물 유지",
        status: "해당 없음",
        tone: "neutral",
        summary: "건축물대장에 등록된 현재 건물이 없어 유지안을 평가하지 않습니다.",
        points: ["실제 빈 토지 여부와 멸실 신고 상태 확인 필요"],
        costImpact: "등록 건물이 확인되지 않아 유지비를 산정하지 않습니다.",
        requiredChecks: ["현장 건물 존재 여부", "멸실 신고 및 미등재 건물 여부"],
        nextStep: "현장 확인 후 빈 토지가 맞으면 Stage 2 신축 검토로 이동합니다.",
      },
      {
        id: "renovate",
        title: "리모델링",
        status: "해당 없음",
        tone: "neutral",
        summary: "등록 건물이 없어 리모델링안을 평가하지 않습니다.",
        points: ["현장에 미등재 건물이 있는지 확인 필요"],
        costImpact: "대상 건물이 확인되기 전에는 리모델링 비용을 산정하지 않습니다.",
        requiredChecks: ["미등재 건물 여부", "실제 구조·면적·사용 상태"],
        nextStep: "미등재 건물이 확인되면 건축물대장 정리와 현장 실측을 먼저 진행합니다.",
      },
      {
        id: "rebuild",
        title: "신축",
        status: "가능 규모 검토",
        tone: "positive",
        summary: "Stage 2에서 법규·일조·도로·주차를 반영한 신축 가능 규모를 계산합니다.",
        points: ["등록 건물 없음", "건축선·접도·주차 확인 필요"],
        costImpact: "철거비는 제외할 수 있지만 지반·인입·정지 비용은 별도 확인이 필요합니다.",
        requiredChecks: ["실제 빈 토지 여부", "접도·건축선", "지반·상하수도 인입 상태"],
        nextStep: "Stage 2에서 법규·일조·도로·주차를 반영한 배치안을 비교합니다.",
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
      costImpact:
        "철거·신축비를 피할 수 있지만 즉시 보수비, 장기수선비, 공실·임대차 정리비를 별도로 확인해야 합니다.",
      requiredChecks: [
        "구조·누수·전기·소방·설비 상태",
        "위반건축물·대장 일치 여부",
        "임대차·보증금·현재 임대수익",
        "3~5년 유지보수 예산",
      ],
      nextStep: "현장 상태조사와 임대차 자료를 확보한 뒤 유지안 현금흐름을 Stage 3에서 비교합니다.",
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
      costImpact:
        "골조를 재사용할 수 있지만 구조보강·설비교체·피난·주차 보완과 공사 중 임대손실이 추가될 수 있습니다.",
      requiredChecks: [
        "정밀안전진단 또는 구조기술사 검토",
        "대수선·용도변경 인허가 범위",
        "기존 주차·피난·내진 기준",
        "리모델링 개략견적과 공사 중 운영 중단",
      ],
      nextStep: "구조·설비 조사 결과와 견적서를 받은 뒤 동일 기간의 신축안과 비용·수익을 비교합니다.",
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
      costImpact:
        "철거·명도·신축·금융비가 발생하지만 새 상품과 법규 범위 안의 면적을 다시 구성할 수 있습니다.",
      requiredChecks: [
        "석면·폐기물·철거 견적",
        "명도·보증금·임차인 정리",
        "Stage 2 실제 배치·일조·주차 검증",
        "Stage 3 총사업비·매출·금융조건",
      ],
      nextStep: "Stage 2 검증 계획안을 확정한 뒤 철거비와 총 취득대금을 포함해 Stage 3 사업성을 비교합니다.",
    },
  ];
}
