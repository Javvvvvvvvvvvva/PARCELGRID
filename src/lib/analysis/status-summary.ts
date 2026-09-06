import type { Parcel } from "@/lib/finance/types";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { estimateFloorHeightM } from "@/lib/integrations/molit-building";
import {
  findNorthEdge,
  evaluateSunSetback,
  sunRestrictionApplies,
} from "@/lib/finance/sun-envelope";

export type SummaryTone = "neutral" | "positive" | "warning" | "negative";
export type SummaryKind = "observation" | "check";
export type BuildingRegistryStatus =
  | "present"
  | "confirmed-empty"
  | "unknown";

export interface StatusSummaryBullet {
  text: string;
  tone: SummaryTone;
  kind: SummaryKind;
}

function mainBuilding(info: BuildingLookupResult) {
  return info.buildings.find((b) => b.isMainBuilding) ?? info.buildings[0] ?? null;
}

export function getBuildingRegistryStatus(
  info: BuildingLookupResult | null | undefined
): BuildingRegistryStatus {
  if (!info) return "unknown";
  if (!info.hasBuilding) return "confirmed-empty";
  return mainBuilding(info) ? "present" : "unknown";
}

function unitCount(info: BuildingLookupResult): number {
  const b = mainBuilding(info);
  if (!b) return 0;
  return b.householdCount || b.familyCount || b.unitCount || 0;
}

function ageBullet(
  info: BuildingLookupResult | null | undefined
): StatusSummaryBullet | null {
  const status = getBuildingRegistryStatus(info);
  if (status === "unknown") {
    return {
      text: "건축물대장 조회 결과를 확보하지 못했습니다. 기존 건물 유무를 원문과 현장에서 확인해야 합니다.",
      tone: "warning",
      kind: "check",
    };
  }
  if (status === "confirmed-empty") {
    return {
      text: "건축물대장에 등록된 현재 건물이 없습니다. 실제 빈 토지 여부는 현장과 추가 자료로 확인해야 합니다.",
      tone: "neutral",
      kind: "observation",
    };
  }
  if (!info) return null;

  switch (info.redevelopmentSignal) {
    case "rebuild":
      return {
        text: `가장 오래된 건물이 ${info.maxAgeYears}년 경과했습니다. 노후도 기준상 철거 후 신축을 검토할 여지가 있습니다.`,
        tone: "warning",
        kind: "observation",
      };
    case "renovate":
      return {
        text: `가장 오래된 건물이 ${info.maxAgeYears}년 경과했습니다. 유지·리모델링·신축을 함께 비교할 구간입니다.`,
        tone: "neutral",
        kind: "observation",
      };
    case "keep":
      return {
        text: `가장 오래된 건물이 ${info.maxAgeYears}년 경과했습니다. 노후도만으로 철거를 판단하기 어려운 상태입니다.`,
        tone: "positive",
        kind: "observation",
      };
    default:
      return null;
  }
}

function zoningBullet(zoning: string): StatusSummaryBullet {
  const residential =
    zoning.includes("주거") || zoning.includes("준주거") || zoning.includes("일반");

  if (!residential) {
    return {
      text: `${zoning}입니다. 허용 용도와 개발 방식은 Stage 2에서 별도로 검토해야 합니다.`,
      tone: "neutral",
      kind: "observation",
    };
  }

  return {
    text: `${zoning}입니다. 주거계열 계획 검토가 가능하지만 실제 규모는 일조·도로·주차 검토 후 결정됩니다.`,
    tone: "neutral",
    kind: "observation",
  };
}

function sunBullet(parcel: Parcel): StatusSummaryBullet {
  if (!sunRestrictionApplies(parcel.zoning)) {
    return {
      text: "현재 용도지역 기준으로 정북일조 제한 적용 여부가 낮습니다. 세부 용도와 조례는 별도 확인이 필요합니다.",
      tone: "neutral",
      kind: "check",
    };
  }

  if (!parcel.boundary || parcel.boundary.length < 3) {
    return {
      text: "필지 경계 데이터가 부족해 정북일조 영향을 아직 판정할 수 없습니다.",
      tone: "neutral",
      kind: "check",
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
    return { text: ev.conclusion, tone: "neutral", kind: "check" };
  }

  if (ev.northIsRoad) {
    return {
      text: "북측 도로 접면 가능성이 확인됩니다. 정북일조 완화 여부는 Stage 2에서 실제 배치와 함께 검토합니다.",
      tone: "positive",
      kind: "check",
    };
  }

  if (ev.requiredSetbackM >= 5) {
    return {
      text: "3층 가정 시 정북일조 이격 부담이 큽니다. 층수와 상층부 후퇴가 핵심 검토 항목입니다.",
      tone: "warning",
      kind: "check",
    };
  }

  if (ev.requiredSetbackM >= 2.5) {
    return {
      text: "3층 가정 시 정북일조 영향이 예상됩니다. 정확한 가능 규모는 Stage 2 배치 계산이 필요합니다.",
      tone: "neutral",
      kind: "check",
    };
  }

  return {
    text: "3층 가정 기준 정북일조 이격 부담은 상대적으로 작게 계산됩니다.",
    tone: "positive",
    kind: "check",
  };
}

function parkingBullet(parcel: Parcel): StatusSummaryBullet {
  const lot = parcel.lotArea;
  const roads = parcel.roads ?? [];

  if (lot < 120) {
    return {
      text: "소규모 필지입니다. 법정 주차 대수와 실제 배치 가능 대수가 주요 제약이 될 수 있습니다.",
      tone: "warning",
      kind: "check",
    };
  }

  if (lot < 200) {
    return {
      text: "전면 도로 길이와 주차 진입 동선을 확인해야 합니다. 필로티 여부는 배치 결과로 판단합니다.",
      tone: "warning",
      kind: "check",
    };
  }

  if (roads.length === 0) {
    return {
      text: "도로 접합 정보가 제한적입니다. 주차 배치와 진입 조건은 현장 확인이 필요합니다.",
      tone: "neutral",
      kind: "check",
    };
  }

  return {
    text: "대지 규모상 주차 배치 검토 여지가 있습니다. 실제 가능 대수는 Stage 2 배치 계산으로 확인합니다.",
    tone: "positive",
    kind: "check",
  };
}

export function buildStatusSummary(parcel: Parcel): StatusSummaryBullet[] {
  const age = ageBullet(parcel.currentBuilding);
  return [
    ...(age ? [age] : []),
    zoningBullet(parcel.zoning),
    sunBullet(parcel),
    parkingBullet(parcel),
  ];
}

export function formatExistingUnits(info: BuildingLookupResult | null | undefined): string {
  if (!info?.hasBuilding) return "—";
  const n = unitCount(info);
  if (n > 0) return `${n}세대`;
  const b = mainBuilding(info);
  if (!b) return "—";
  if (b.detailPurpose.includes("다가구") || b.mainPurpose.includes("단독")) {
    return "건축물대장 미제공";
  }
  return "건축물대장 미제공";
}
