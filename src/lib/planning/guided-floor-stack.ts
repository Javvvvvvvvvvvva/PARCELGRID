import { regulatoryConstraintIsDecisionGrade } from "@/lib/regulatory/constraints";
import {
  cloneFloorProgramAtLevel,
  nextGroundLevel,
  normalizeFloorLevels,
  removeFloorProgram,
} from "@/lib/planning/floor-program-editor";
import type { RegulatoryConstraintSet } from "@/lib/regulatory/constraints";
import type {
  FloorProgram,
  FloorUseType,
  PlanningScenario,
} from "@/lib/planning/types";

const DEFAULT_ROOF_ALLOWANCE_M = 1.4;
const MIN_GUIDED_FLOOR_AREA_SQM = 10;

export interface GuidedPlanningParcel {
  lotAreaSqm: number;
  regulatoryConstraints?: RegulatoryConstraintSet;
}

export interface GuidedFloorActionResult {
  floorPrograms: FloorProgram[];
  status: "applied" | "adjusted" | "blocked";
  message: string;
  createdFloorId?: string;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function guidedFloorArea(floor: FloorProgram): number {
  return floor.zones.reduce(
    (sum, zone) => sum + nonNegative(zone.areaSqm),
    0
  );
}

function farCountedArea(floor: FloorProgram): number {
  if (floor.level < 1) return 0;
  return floor.zones.reduce((sum, zone) => {
    if (zone.useType === "parking" || zone.useType === "piloti") return sum;
    return sum + nonNegative(zone.areaSqm);
  }, 0);
}

function occupiedHeightM(floors: FloorProgram[]): number {
  return floors
    .filter((floor) => floor.level > 0)
    .reduce((sum, floor) => sum + nonNegative(floor.floorHeightM), 0);
}

function decisionLimit(
  constraints: RegulatoryConstraintSet | undefined,
  field: "bcr" | "far" | "height" | "floors"
): number | null {
  const evidence = constraints?.[field];
  return regulatoryConstraintIsDecisionGrade(evidence) &&
    evidence?.value != null &&
    evidence.value > 0
    ? evidence.value
    : null;
}

function cloneZonesAtScale(
  source: FloorProgram,
  level: number,
  scale: number
): FloorProgram {
  const next = cloneFloorProgramAtLevel(source, level);
  return {
    ...next,
    zones: next.zones.map((zone) => ({
      ...zone,
      areaSqm: Math.max(0, zone.areaSqm * scale),
      saleableAreaSqm:
        zone.saleableAreaSqm == null
          ? undefined
          : Math.max(0, zone.saleableAreaSqm * scale),
      rentableAreaSqm:
        zone.rentableAreaSqm == null
          ? undefined
          : Math.max(0, zone.rentableAreaSqm * scale),
    })),
  };
}

function constraintReviewSuffix(parcel: GuidedPlanningParcel): string {
  const constraints = parcel.regulatoryConstraints;
  const missing = (["far", "height", "floors"] as const).filter(
    (field) => decisionLimit(constraints, field) == null
  );
  return missing.length > 0
    ? " 미확정 규제는 법규·데이터 점검에서 계속 확인해야 합니다."
    : "";
}

export function addGuidedGroundFloor(
  scenario: Pick<PlanningScenario, "floorPrograms">,
  parcel: GuidedPlanningParcel,
  sourceFloorId?: string
): GuidedFloorActionResult {
  const groundFloors = scenario.floorPrograms
    .filter((floor) => floor.level > 0)
    .sort((a, b) => a.level - b.level);
  const source =
    groundFloors.find((floor) => floor.id === sourceFloorId) ??
    groundFloors[groundFloors.length - 1];
  if (!source) {
    return {
      floorPrograms: scenario.floorPrograms,
      status: "blocked",
      message: "복제할 지상층이 없습니다. 정밀 편집에서 1층을 먼저 만드세요.",
    };
  }

  const floorLimit = decisionLimit(
    parcel.regulatoryConstraints,
    "floors"
  );
  if (floorLimit != null && groundFloors.length + 1 > floorLimit) {
    return {
      floorPrograms: scenario.floorPrograms,
      status: "blocked",
      message: `확인된 층수 한도 ${floorLimit}층을 초과하므로 층을 추가하지 않았습니다.`,
    };
  }

  const heightLimit = decisionLimit(
    parcel.regulatoryConstraints,
    "height"
  );
  const projectedHeight =
    occupiedHeightM(scenario.floorPrograms) +
    nonNegative(source.floorHeightM) +
    DEFAULT_ROOF_ALLOWANCE_M;
  if (heightLimit != null && projectedHeight > heightLimit + 0.01) {
    return {
      floorPrograms: scenario.floorPrograms,
      status: "blocked",
      message: `확인된 높이 한도 ${heightLimit.toFixed(1)}m를 초과하므로 층을 추가하지 않았습니다.`,
    };
  }

  const farLimit = decisionLimit(parcel.regulatoryConstraints, "far");
  const currentFarArea = scenario.floorPrograms.reduce(
    (sum, floor) => sum + farCountedArea(floor),
    0
  );
  const sourceFarArea = farCountedArea(source);
  let scale = 1;
  let adjusted = false;

  if (farLimit != null && sourceFarArea > 0) {
    const maxFarArea = parcel.lotAreaSqm * (farLimit / 100);
    const remainingFarArea = Math.max(0, maxFarArea - currentFarArea);
    if (remainingFarArea < MIN_GUIDED_FLOOR_AREA_SQM) {
      return {
        floorPrograms: scenario.floorPrograms,
        status: "blocked",
        message: `확인된 용적률 상한 안에 새 층을 위한 ${MIN_GUIDED_FLOOR_AREA_SQM}㎡ 이상 면적이 남지 않았습니다.`,
      };
    }
    if (remainingFarArea < sourceFarArea) {
      scale = remainingFarArea / sourceFarArea;
      adjusted = true;
    }
  }

  const level = nextGroundLevel(scenario.floorPrograms);
  const created = cloneZonesAtScale(source, level, scale);
  const floorPrograms = normalizeFloorLevels([
    ...scenario.floorPrograms,
    created,
  ]);
  return {
    floorPrograms,
    status: adjusted ? "adjusted" : "applied",
    message: adjusted
      ? `남은 확인 용적률에 맞춰 ${created.label} 면적을 ${guidedFloorArea(created).toFixed(1)}㎡로 줄여 추가했습니다.`
      : `${created.label}을 추가했습니다.${constraintReviewSuffix(parcel)}`,
    createdFloorId: created.id,
  };
}

export function resizeGuidedFloor(
  scenario: Pick<PlanningScenario, "floorPrograms">,
  parcel: GuidedPlanningParcel,
  floorId: string,
  factor: number
): GuidedFloorActionResult {
  const source = scenario.floorPrograms.find((floor) => floor.id === floorId);
  if (!source) {
    return {
      floorPrograms: scenario.floorPrograms,
      status: "blocked",
      message: "선택한 층을 찾을 수 없습니다.",
    };
  }
  const currentArea = guidedFloorArea(source);
  if (currentArea <= 0) {
    return {
      floorPrograms: scenario.floorPrograms,
      status: "blocked",
      message: "선택한 층에 조정할 면적이 없습니다.",
    };
  }

  let targetArea = Math.max(
    MIN_GUIDED_FLOOR_AREA_SQM,
    currentArea * Math.max(0.1, factor)
  );
  let adjusted = false;

  if (source.level > 0) {
    const bcrLimit = decisionLimit(parcel.regulatoryConstraints, "bcr");
    if (bcrLimit != null) {
      const maxFootprint = parcel.lotAreaSqm * (bcrLimit / 100);
      if (targetArea > maxFootprint) {
        targetArea = maxFootprint;
        adjusted = true;
      }
    }

    const farLimit = decisionLimit(parcel.regulatoryConstraints, "far");
    if (farLimit != null) {
      const otherFarArea = scenario.floorPrograms.reduce(
        (sum, floor) =>
          floor.id === floorId ? sum : sum + farCountedArea(floor),
        0
      );
      const maxFarArea = parcel.lotAreaSqm * (farLimit / 100);
      const sourceFarRatio =
        currentArea > 0 ? farCountedArea(source) / currentArea : 0;
      if (sourceFarRatio > 0) {
        const maxTargetArea = Math.max(
          0,
          (maxFarArea - otherFarArea) / sourceFarRatio
        );
        if (targetArea > maxTargetArea) {
          targetArea = maxTargetArea;
          adjusted = true;
        }
      }
    }
  }

  if (targetArea < MIN_GUIDED_FLOOR_AREA_SQM) {
    return {
      floorPrograms: scenario.floorPrograms,
      status: "blocked",
      message: "확인된 건폐율·용적률 상한 안에서 최소 계획면적을 확보할 수 없습니다.",
    };
  }

  const scale = targetArea / currentArea;
  const floorPrograms = scenario.floorPrograms.map((floor) =>
    floor.id === floorId
      ? {
          ...floor,
          zones: floor.zones.map((zone) => ({
            ...zone,
            areaSqm: Math.max(0, zone.areaSqm * scale),
            saleableAreaSqm:
              zone.saleableAreaSqm == null
                ? undefined
                : Math.max(0, zone.saleableAreaSqm * scale),
            rentableAreaSqm:
              zone.rentableAreaSqm == null
                ? undefined
                : Math.max(0, zone.rentableAreaSqm * scale),
          })),
        }
      : floor
  );
  return {
    floorPrograms,
    status: adjusted ? "adjusted" : "applied",
    message: adjusted
      ? `확인된 상한에 맞춰 ${source.label} 면적을 ${targetArea.toFixed(1)}㎡까지만 조정했습니다.`
      : `${source.label} 면적을 ${targetArea.toFixed(1)}㎡로 조정했습니다.`,
  };
}

export function removeGuidedFloor(
  scenario: Pick<PlanningScenario, "floorPrograms">,
  floorId: string
): GuidedFloorActionResult {
  const source = scenario.floorPrograms.find((floor) => floor.id === floorId);
  const floorPrograms = removeFloorProgram(scenario.floorPrograms, floorId);
  if (floorPrograms === scenario.floorPrograms) {
    return {
      floorPrograms,
      status: "blocked",
      message: "계획에는 최소 1개 층이 필요합니다.",
    };
  }
  return {
    floorPrograms,
    status: "applied",
    message: `${source?.label ?? "선택한 층"}을 삭제하고 층 번호를 다시 정리했습니다.`,
  };
}

export function guidedFloorUseLabel(useType: FloorUseType): string {
  const labels: Record<FloorUseType, string> = {
    residential: "주거",
    retail: "상가",
    office: "업무",
    parking: "주차",
    piloti: "필로티",
    common: "공용",
    mechanical: "기계실",
    storage: "창고",
    other: "기타",
  };
  return labels[useType];
}
