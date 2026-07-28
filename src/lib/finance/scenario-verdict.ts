/**
 * 시나리오 판정 — 권장안 + 최대안 + 정북일조·주차·배치 평가 (의사결정 도구).
 *
 * C 확정 기준:
 *  - 권장 = 1~법규상 최대 층수 후보를 건축 타당성 점수로 평가해 최고점 안 선택.
 *  - 최대 = 법적 용적률 상한까지 (정북일조/배치 리스크 있으면 점수↓).
 *  - 정북일조 판정 = "필요 이격 후 남는 배치 깊이"로:
 *      ≥ 7.0m 충족 / 6.0~7.0m 검토 / < 6.0m 불리.
 */

import type { Parcel } from "@/lib/finance/types";
import {
  calcEnvelope,
  type BuildableEnvelope,
} from "@/lib/finance/envelope";
import {
  type ScenarioType,
} from "@/lib/finance/scenario-envelope";
import {
  findNorthEdge,
  northSouthDepthM,
  evaluateSunSetback,
} from "@/lib/finance/sun-envelope";
import { calcParking } from "@/lib/finance/parking";
import { calcBuildableArea } from "@/lib/finance/buildable-area";
import { analyzeFrontage, edgeSetbacksFromFrontage } from "@/lib/geo/road-frontage";
import {
  layoutParkingFromBoundary,
  assessPilotiOverlap,
} from "@/lib/geo/parking-layout";
import { sunRestrictionApplies } from "@/lib/finance/sun-envelope";
import { computeScore, type ScoreDeduction } from "@/lib/finance/score-engine";
import type { BuildingType } from "@/lib/finance/types";
import { regulatoryConstraintIsDecisionGrade } from "@/lib/regulatory/constraints";

/** 최소 건물 깊이 (MVP — 주택/다가구) */
const MIN_BUILDING_DEPTH_M = 7.0;
/** 세대당 면적 (다가구) */
const VILLA_UNIT_AREA_SQM = 50;
/** 기본 층고 (m) — 기존 건물 실측값 있으면 대체 (C 하드코딩 제거) */
const DEFAULT_FLOOR_HEIGHT_M = 3.0;
/** 옥상 파라펫·슬래브 등 층고 밖 높이. 별도 실측 전 계획용 값이며 법정 높이와 분리 표시한다. */
const DEFAULT_ROOF_ALLOWANCE_M = 1.4;

function capFloorsByVerifiedConstraints(
  parcel: Parcel,
  farBasedFloors: number,
  floorHeightM: number
): number {
  const constraints = parcel.regulatoryConstraints;
  let result = Math.max(1, farBasedFloors);
  if (regulatoryConstraintIsDecisionGrade(constraints?.height)) {
    const occupiableHeightM = Math.max(
      floorHeightM,
      constraints!.height.value! - DEFAULT_ROOF_ALLOWANCE_M
    );
    result = Math.min(result, Math.max(1, Math.floor(occupiableHeightM / floorHeightM)));
  }
  if (regulatoryConstraintIsDecisionGrade(constraints?.floors)) {
    result = Math.min(result, Math.max(1, Math.floor(constraints!.floors.value!)));
  }
  return result;
}

export type VerdictMark = "ok" | "warn" | "fail";

export interface SunVerdict {
  mark: VerdictMark;
  label: string;
  /** 필요 북측 이격 (m) */
  requiredSetbackM: number;
  /** 이격 후 남는 배치 깊이 (m) — 미적용/완화 시 null */
  remainDepthM: number | null;
  detail: string;
}

export interface ParkingVerdict {
  requiredCars: number;
  basis: string;
}

export interface ScenarioOption {
  /** "input"(내 계획) | "recommended" | "max" */
  mode: "input" | "recommended" | "max";
  floors: number;
  gfaSqm: number;
  gfaPyeong: number;
  /** 실현 용적률 (%) = 실제 연면적 ÷ 대지면적 */
  farUsedPct: number;
  /** 법정 용적률 상한 (%) = 용도지역 허용 최대 용적률 */
  farCapPct: number;
  units: number;
  sun: SunVerdict;
  parking: ParkingVerdict;
  /** 법적 최대 건축면적 (건폐율, ㎡) — 참고 표시용 */
  maxBuildingAreaSqm: number;
  /** 정북일조 반영 2D 건축가능면적 (㎡) — 보수 안전영역 */
  buildable2DSqm: number;
  /** 시공성 (Score Engine) */
  buildability: { grade: "높음" | "보통" | "낮음"; note: string };
  /** 법적 리스크 (Score Engine) */
  legalRisk: { grade: "낮음" | "보통" | "높음"; note: string };
  /** 주차 충족 — 배치엔진 전이면 null */
  parkingSufficient: boolean | null;
  /** 필로티 자동 판정 (C 설계: 주차 동선 기반) — 배치·데이터 없으면 null */
  piloti: {
    recommended: boolean;
    overlapSqm: number;
    reason: string;
  } | null;
  /** 사업 타당성 점수 0~100 (감점식) */
  score: number;
  /** 감점 내역 */
  scoreBreakdown: ScoreDeduction[];
}

export interface ScenarioComparison {
  type: ScenarioType;
  label: string;
  /** 내 계획 (사용자 입력값) — 3개 비교용 */
  input?: ScenarioOption;
  recommended: ScenarioOption;
  max: ScenarioOption;
  /** 세대당 기준면적 (㎡) — 시나리오 산정 가정값 (표시 필요) */
  unitAreaSqm: number;
}

const LABELS: Record<ScenarioType, string> = {
  "single-house": "단독주택 신축매매",
  "multi-family": "다가구주택 신축매매",
  retail: "근린생활시설",
};

/** 정북일조 — 배치 깊이 기준 판정 (C 확정) */
function evalSunVerdict(
  zoning: string,
  heightM: number,
  floors: number,
  northSouthM: number,
  parcel: Parcel
): SunVerdict {
  const northEdge = parcel.boundary ? findNorthEdge(parcel.boundary) : null;
  const ev = evaluateSunSetback(zoning, heightM, floors, northEdge, parcel.roads);

  if (!ev.applies) {
    return {
      mark: "ok",
      label: "미적용",
      requiredSetbackM: 0,
      remainDepthM: null,
      detail: ev.conclusion,
    };
  }
  if (ev.exemptByOrdinance) {
    return {
      mark: "ok",
      label: "완화 가능",
      requiredSetbackM: 0,
      remainDepthM: null,
      detail: ev.conclusion,
    };
  }

  const remain = northSouthM - ev.requiredSetbackM;
  let mark: VerdictMark;
  let label: string;
  if (remain >= MIN_BUILDING_DEPTH_M) {
    mark = "ok";
    label = "충족";
  } else if (remain >= MIN_BUILDING_DEPTH_M - 1.0) {
    mark = "warn";
    label = "검토 필요";
  } else {
    mark = "fail";
    label = "불리/불가";
  }
  return {
    mark,
    label,
    requiredSetbackM: ev.requiredSetbackM,
    remainDepthM: remain,
    detail: `북측 ${ev.requiredSetbackM.toFixed(1)}m 이격 후 배치깊이 ${remain.toFixed(1)}m`,
  };
}

/** 별점 — 정북일조 + 주차 종합 */
// calcStars 제거 — Score Engine(computeScore)으로 대체

/** 정북일조 충족도 순위 (동점 시 2순위) */
function sunRank(mark: VerdictMark): number {
  return mark === "ok" ? 2 : mark === "warn" ? 1 : 0;
}

/**
 * 권장안 후보 비교 — 동점 시:
 * 1) 건축 타당성 점수  2) 정북일조 충족  3) 주차 부담 낮음  4) 연면적 높음
 * @returns 양수면 a가 더 우수
 */
function compareRecommendedCandidates(a: ScenarioOption, b: ScenarioOption): number {
  if (a.score !== b.score) return a.score - b.score;
  const sunDiff = sunRank(a.sun.mark) - sunRank(b.sun.mark);
  if (sunDiff !== 0) return sunDiff;
  const parkDiff = b.parking.requiredCars - a.parking.requiredCars;
  if (parkDiff !== 0) return parkDiff;
  return a.gfaSqm - b.gfaSqm;
}

/** 1~maxFloors 후보를 점수로 평가해 최적 권장안 선택 */
function pickRecommendedOption(
  type: ScenarioType,
  env: BuildableEnvelope,
  parcel: Parcel,
  northSouthM: number,
  unitAreaSqm: number,
  floorHeightM: number
): ScenarioOption {
  const maxFloors = capFloorsByVerifiedConstraints(
    parcel,
    Math.max(1, Math.floor(env.maxFarFloorAreaSqm / env.maxBuildingAreaSqm)),
    floorHeightM
  );
  let best: ScenarioOption | null = null;
  for (let floors = 1; floors <= maxFloors; floors++) {
    const candidate = buildOption(
      type,
      "recommended",
      env,
      parcel,
      northSouthM,
      undefined,
      undefined,
      unitAreaSqm,
      floorHeightM,
      floors
    );
    if (!best || compareRecommendedCandidates(candidate, best) > 0) {
      best = candidate;
    }
  }
  return best!;
}

/** 한 옵션 생성 */
function buildOption(
  type: ScenarioType,
  mode: "input" | "recommended" | "max",
  env: BuildableEnvelope,
  parcel: Parcel,
  northSouthM: number,
  inputFloors?: number,
  inputUnits?: number,
  unitAreaSqm: number = VILLA_UNIT_AREA_SQM,
  floorHeightM: number = DEFAULT_FLOOR_HEIGHT_M,
  /** 권장안 탐색 시 명시 층수 (1~maxFloors) */
  floorOverride?: number
): ScenarioOption {
  const { maxBuildingAreaSqm, maxFarFloorAreaSqm } = env;
  const maxFloorsByFar = Math.max(
    1,
    Math.floor(maxFarFloorAreaSqm / maxBuildingAreaSqm)
  );
  const maxCandidateFloors = capFloorsByVerifiedConstraints(
    parcel,
    maxFloorsByFar,
    floorHeightM
  );
  const floors =
    floorOverride != null
      ? floorOverride
      : mode === "max"
        ? maxCandidateFloors
        : mode === "input"
          ? Math.max(1, inputFloors ?? 1)
          : maxCandidateFloors; // recommended는 pickRecommendedOption 경유
  // Buildable Area 엔진 (#2) — 정북일조 반영 실제 건축가능면적 (계단식 합)
  const sunApplies = sunRestrictionApplies(parcel.zoning);
  // 대지경계 최소 이격 0.5m만 사실 기반 반영 (C 확정).
  // 도로 3m·후면 3m 하드코딩 가정값은 제외 — Buildable Area 과소 방지.
  // 건축선 후퇴·도로사선·조례는 추가 검토 항목 (실제 데이터 확보 시 방향별 적용).
  const MIN_BOUNDARY_SETBACK_M = 0.5; // 민법 하한 (법정 — 항상 보장)
  const sideSetbackM = MIN_BOUNDARY_SETBACK_M;
  // 변별 이격 (도로 접면 기반) — 전면·후면·측면 값은 실무 기본값(가정, parcel.setback).
  // 도로 데이터 없거나 분석 불가(맹지 등)면 기존 균일 0.5m 유지.
  const frontage =
    parcel.boundary && parcel.roads && parcel.roads.length > 0
      ? analyzeFrontage(parcel.boundary, parcel.roads)
      : null;
  const edgeSetbacksM = edgeSetbacksFromFrontage(frontage, parcel.setback);
  if (frontage) {
    console.log(
      `[frontage] 전면=변${frontage.frontIndex} (도로 "${frontage.roadName ?? "?"}", ${frontage.frontDistM.toFixed(1)}m) | 변별: ` +
        frontage.edges
          .map((e) => `#${e.index}:${e.role}(${e.setbackM}m,도로${e.roadDistM.toFixed(1)}m,${e.lengthM.toFixed(1)}m)`)
          .join(" ")
    );
  } else if (parcel.roads && parcel.roads.length > 0) {
    console.log("[frontage] 분석 불가 (경계·도로 데이터 확인 — 균일 0.5m 적용)");
  } else {
    console.log("[frontage] 도로 데이터 없음 — 균일 0.5m 적용");
  }

  // 주차 배치 v1 — 전면 변 직접 진입 직각주차의 "물리적 최대 배치 가능 대수".
  // 법정 대수(pk)와 독립 계산 — capacity로 verdict에 주입되어 충족 여부 판단.
  const parkingLayout =
    frontage && parcel.boundary
      ? layoutParkingFromBoundary(parcel.boundary, frontage.frontIndex, 20)
      : null;
  if (parkingLayout) {
    console.log(
      `[parking] 전면 직접진입 배치 가능 ${parkingLayout.placed}대 (전면 ${parkingLayout.frontEdgeUsedM.toFixed(1)}m 사용) — ${parkingLayout.basis}`
    );
  }
  const ba = calcBuildableArea(
    parcel.boundary,
    sideSetbackM,
    floors,
    floorHeightM,
    sunApplies,
    edgeSetbacksM
  );

  // 필로티 자동 판정 (C 확정: 토글도 기본값도 아닌 — 주차 동선의 결과)
  // 1층 플레이트 기준 (buildable2DRing은 최고높이 보수 링 — 겹침 과소평가)
  const groundPlateRing =
    ba.stepped3D.length > 0 && ba.stepped3D[0].ringLngLat
      ? ba.stepped3D[0].ringLngLat
      : ba.buildable2DRing;
  const piloti =
    parkingLayout && parcel.boundary && groundPlateRing
      ? assessPilotiOverlap(parcel.boundary, parkingLayout, groundPlateRing)
      : null;
  if (piloti) {
    console.log(`[piloti] ${piloti.reason}`);
  }
  // 연면적 = 계단식 각 층 floorPlate 합 (건폐율 상한 반영), 용적률 상한 clip.
  // boundary 없으면 fallback: envelope 최대 (건폐율×층수).
  const steppedSum = ba.stepped3D.reduce(
    (sum, s) => sum + Math.min(s.floorPlateSqm || maxBuildingAreaSqm, maxBuildingAreaSqm),
    0
  );
  const gfaSqm =
    ba.buildable2DRing && steppedSum > 0
      ? Math.min(maxFarFloorAreaSqm, steppedSum)
      : Math.min(maxFarFloorAreaSqm, maxBuildingAreaSqm * floors);
  // input 모드: 사용자 입력 세대수 우선 (C 확정 — 내 조건으로 검토).
  // 권장·최대: 엔진 산정 최대 가능 세대수 (세대당 50㎡ 가정, 표시 필요).
  const autoUnits =
    type === "multi-family"
      ? Math.max(1, Math.floor(gfaSqm / unitAreaSqm))
      : type === "single-house"
      ? 1
      : 0;
  const units =
    mode === "input" && inputUnits != null && type !== "retail"
      ? Math.max(1, inputUnits)
      : autoUnits;

  const heightM = floors * floorHeightM + DEFAULT_ROOF_ALLOWANCE_M;
  const sun = evalSunVerdict(parcel.zoning, heightM, floors, northSouthM, parcel);

  const pk = calcParking(
    type as BuildingType,
    gfaSqm,
    type === "retail" ? 0 : units,
    type === "retail" ? 1 : 0
  );

  const farUsedPct = Math.round((gfaSqm / parcel.lotArea) * 100);

  // Score Engine — 시공성·법적리스크·사업 타당성 점수 종합 (최종형)
  // 주차 capacity는 아직 미확정(배치엔진 Level 2~3 전) → null.
  // 세대 계획 적정성 — 실제 세대당 면적 ÷ 선택 상품 기준면적 (다가구 등만).
  const unitAdequacyRatio =
    type === "multi-family" && units > 0 && unitAreaSqm > 0
      ? gfaSqm / units / unitAreaSqm
      : null;

  const score = computeScore({
    floors,
    sun: { mark: sun.mark, remainDepthM: sun.remainDepthM },
    parking: {
      required: pk.requiredCars,
      capacity: parkingLayout ? parkingLayout.placed : null,
    },
    farUsedPct,
    farCapPct: parcel.maxFAR,
    bcrUsedPct: parcel.maxBCR,
    bcrCapPct: parcel.maxBCR,
    unitAdequacyRatio,
  });

  return {
    mode,
    floors,
    gfaSqm,
    gfaPyeong: Math.round(gfaSqm / 3.3058),
    farUsedPct,
    farCapPct: parcel.maxFAR,
    units,
    sun,
    parking: { requiredCars: pk.requiredCars, basis: pk.basis },
    piloti: piloti
      ? {
          recommended: piloti.recommended,
          overlapSqm: piloti.overlapSqm,
          reason: piloti.reason,
        }
      : null,
    maxBuildingAreaSqm: Number(maxBuildingAreaSqm.toFixed(1)),
    buildable2DSqm: ba.buildable2DSqm,
    buildability: score.buildability,
    legalRisk: score.legalRisk,
    parkingSufficient: score.parkingSufficient,
    score: score.score,
    scoreBreakdown: score.breakdown,
  };
}

/** 한 타입의 권장 + 최대 비교 생성 */
export function buildScenarioComparison(
  type: ScenarioType,
  parcel: Parcel,
  inputFloors?: number,
  inputUnits?: number,
  unitAreaSqmOverride?: number,
  floorHeightMOverride?: number
): ScenarioComparison {
  const env = calcEnvelope(parcel.lotArea, parcel.maxBCR, parcel.maxFAR);
  const northSouthM = parcel.boundary
    ? northSouthDepthM(parcel.boundary)
    : 0;

  // 세대당 면적: 기존 건물 기반 실제값 우선, 없으면 기본 가정값 (C 확정).
  const unitAreaSqm =
    unitAreaSqmOverride && unitAreaSqmOverride > 0
      ? unitAreaSqmOverride
      : VILLA_UNIT_AREA_SQM;

  // 층고: 기존 건물 실측(높이÷층수) 우선, 없으면 기본 3.0m (C 하드코딩 제거).
  const floorHeightM =
    floorHeightMOverride && floorHeightMOverride > 0
      ? floorHeightMOverride
      : DEFAULT_FLOOR_HEIGHT_M;

  // 내 계획 (사용자 입력값) — 층수 있으면 생성
  const input =
    inputFloors != null
      ? buildOption(type, "input", env, parcel, northSouthM, inputFloors, inputUnits, unitAreaSqm, floorHeightM)
      : undefined;

  return {
    type,
    label: LABELS[type],
    input,
    recommended: pickRecommendedOption(
      type,
      env,
      parcel,
      northSouthM,
      unitAreaSqm,
      floorHeightM
    ),
    max: buildOption(type, "max", env, parcel, northSouthM, undefined, undefined, unitAreaSqm, floorHeightM),
    unitAreaSqm,
  };
}
