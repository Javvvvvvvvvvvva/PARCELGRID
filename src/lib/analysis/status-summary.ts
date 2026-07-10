/**
 * Stage 1 현황 분석 — 규칙 기반 알고리즘 요약 (LLM 없음).
 *
 * 건축물대장·용도지역·필지 형상 데이터로 읽기 쉬운 bullet 생성.
 */

import type { Parcel } from "@/lib/finance/types";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { estimateFloorHeightM } from "@/lib/integrations/molit-building";
import {
  findNorthEdge,
  evaluateSunSetback,
  sunRestrictionApplies,
} from "@/lib/finance/sun-envelope";

export type SummaryTone = "neutral" | "positive" | "warning" | "negative";

export interface StatusSummaryBullet {
  text: string;
  tone: SummaryTone;
}

function mainBuilding(info: BuildingLookupResult) {
  return info.buildings.find((b) => b.isMainBuilding) ?? info.buildings[0] ?? null;
}

function unitCount(info: BuildingLookupResult): number {
  const b = mainBuilding(info);
  if (!b) return 0;
  return b.householdCount || b.familyCount || b.unitCount || 0;
}

/** 노후도·시행 적합성 */
function ageBullets(
  info: BuildingLookupResult | null | undefined
): StatusSummaryBullet[] {
  if (!info || !info.hasBuilding) {
    return [
      {
        text: "현재 건물이 없습니다. 신축 시행이 가능합니다.",
        tone: "positive",
      },
    ];
  }

  switch (info.redevelopmentSignal) {
    case "rebuild":
      return [
        {
          text: `노후도가 높습니다 (${info.maxAgeYears}년). 철거 후 신축을 검토할 수 있습니다.`,
          tone: "warning",
        },
      ];
    case "renovate":
      return [
        {
          text: `중간 노후입니다 (${info.maxAgeYears}년). 리모델링 또는 신축을 함께 검토할 수 있습니다.`,
          tone: "neutral",
        },
      ];
    case "keep":
      return [
        {
          text: `비교적 신축 상태입니다 (${info.maxAgeYears}년). 기존 건물 유지가 일반적입니다.`,
          tone: "positive",
        },
      ];
    default:
      return [];
  }
}

/** 용도지역·시그널 기반 신축 상품 적합성 */
function productFitBullet(
  zoning: string,
  info: BuildingLookupResult | null | undefined
): StatusSummaryBullet {
  const residential =
    zoning.includes("주거") || zoning.includes("준주거") || zoning.includes("일반");

  if (!residential) {
    return {
      text: "주거 외 용도지역입니다. 근린·업무 등 용도 검토가 필요합니다.",
      tone: "neutral",
    };
  }

  if (!info?.hasBuilding || info.redevelopmentSignal === "rebuild") {
    return {
      text: "다가구·소규모 주거 신축에 적합한 용도지역입니다.",
      tone: "positive",
    };
  }

  if (info.redevelopmentSignal === "vacant") {
    return {
      text: "빈 토지로, 다가구 신축에 적합합니다.",
      tone: "positive",
    };
  }

  if (info.redevelopmentSignal === "renovate") {
    return {
      text: "주거지역으로, 신축 또는 리모델링 모두 검토 가능합니다.",
      tone: "neutral",
    };
  }

  return {
    text: "기존 건물이 비교적 신축이라, 대규모 신축 시행은 일반적이지 않습니다.",
    tone: "neutral",
  };
}

/** 정북일조 — 신축 가정 3층 기준 부지 영향 평가 */
function sunBullet(parcel: Parcel): StatusSummaryBullet {
  if (!sunRestrictionApplies(parcel.zoning)) {
    return {
      text: "정북일조 제한이 적용되지 않는 용도지역입니다.",
      tone: "neutral",
    };
  }

  if (!parcel.boundary || parcel.boundary.length < 3) {
    return {
      text: "정북일조 영향은 필지 경계 데이터 확인 후 판단할 수 있습니다.",
      tone: "neutral",
    };
  }

  const northEdge = findNorthEdge(parcel.boundary);
  const floorH = parcel.currentBuilding
    ? estimateFloorHeightM(parcel.currentBuilding) ?? 3
    : 3;
  const refFloors = 3;
  const heightM = refFloors * floorH + 1.4;

  const ev = evaluateSunSetback(
    parcel.zoning,
    heightM,
    refFloors,
    northEdge,
    parcel.roads
  );

  if (!ev.applies) {
    return { text: ev.conclusion, tone: "neutral" };
  }

  if (ev.northIsRoad) {
    return {
      text: "정북일조: 북측이 도로에 접해 있어 영향이 상대적으로 작을 수 있습니다.",
      tone: "positive",
    };
  }

  if (ev.requiredSetbackM >= 5) {
    return {
      text: "정북일조 영향이 큽니다. 층수·배치 설계 시 북측 이격이 핵심입니다.",
      tone: "warning",
    };
  }

  if (ev.requiredSetbackM >= 2.5) {
    return {
      text: "정북일조 영향은 보통입니다. 2~3층 규모에서는 설계 여유가 있습니다.",
      tone: "neutral",
    };
  }

  return {
    text: "정북일조 영향이 작습니다.",
    tone: "positive",
  };
}

/** 주차 — 전면 길이·대지 규모 기반 */
function parkingBullet(parcel: Parcel): StatusSummaryBullet {
  const lot = parcel.lotArea;
  const roads = parcel.roads ?? [];

  if (lot < 120) {
    return {
      text: "소규모 필지입니다. 주차 확보가 핵심 제약이 될 수 있습니다.",
      tone: "warning",
    };
  }

  if (lot < 200) {
    return {
      text: "주차 확보가 핵심입니다. 전면 도로 길이와 필로티 여부를 검토하세요.",
      tone: "warning",
    };
  }

  if (roads.length === 0) {
    return {
      text: "도로 접합 정보가 제한적입니다. 주차 배치는 현장 확인이 필요합니다.",
      tone: "neutral",
    };
  }

  return {
    text: "대지 규모상 주차 배치 여유가 있습니다. 전면 진입 직각주차를 우선 검토합니다.",
    tone: "positive",
  };
}

/**
 * Stage 1 알고리즘 요약 bullet 목록 생성.
 */
export function buildStatusSummary(parcel: Parcel): StatusSummaryBullet[] {
  const info = parcel.currentBuilding;
  return [
    ...ageBullets(info),
    productFitBullet(parcel.zoning, info),
    sunBullet(parcel),
    parkingBullet(parcel),
  ];
}

/** 기존 건물 세대수 표시용 */
export function formatExistingUnits(info: BuildingLookupResult | null | undefined): string {
  if (!info?.hasBuilding) return "—";
  const n = unitCount(info);
  if (n > 0) return `${n}세대`;
  const b = mainBuilding(info);
  if (!b) return "—";
  if (b.detailPurpose.includes("다가구") || b.mainPurpose.includes("단독")) {
    return "미확인 (다가구)";
  }
  return "—";
}
