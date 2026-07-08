/**
 * 시나리오 판정 — 권장안 + 최대안 + 정북일조·주차·배치 평가 (의사결정 도구).
 *
 * C 확정 기준:
 *  - 권장 = 정북일조·주차·배치 깊이를 봤을 때 무리 없는 안 (실무).
 *  - 최대 = 법적 용적률 상한까지 (정북일조/배치 리스크 있으면 별점↓).
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
import { sunRestrictionApplies } from "@/lib/finance/sun-envelope";
import { computeScore } from "@/lib/finance/score-engine";
import type { BuildingType } from "@/lib/finance/types";

/** 최소 건물 깊이 (MVP — 주택/다가구) */
const MIN_BUILDING_DEPTH_M = 7.0;
/** 세대당 면적 (다가구) */
const VILLA_UNIT_AREA_SQM = 50;
/** 기본 층고 (m) — 기존 건물 실측값 있으면 대체 (C 하드코딩 제거) */
const DEFAULT_FLOOR_HEIGHT_M = 3.0;
/** 권장 층수 (정북일조·실무 반영) */
const RECOMMENDED_FLOORS: Record<ScenarioType, number> = {
  "single-house": 2,
  "multi-family": 3,
  retail: 3,
};

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
  farUsedPct: number;
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
  /** 1~5 별점 */
  stars: number;
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

/** 한 옵션(권장 or 최대) 생성 */
function buildOption(
  type: ScenarioType,
  mode: "input" | "recommended" | "max",
  env: BuildableEnvelope,
  parcel: Parcel,
  northSouthM: number,
  inputFloors?: number,
  inputUnits?: number,
  unitAreaSqm: number = VILLA_UNIT_AREA_SQM,
  floorHeightM: number = DEFAULT_FLOOR_HEIGHT_M
): ScenarioOption {
  const { maxBuildingAreaSqm, maxFarFloorAreaSqm } = env;
  const maxFloorsByFar = Math.max(
    1,
    Math.floor(maxFarFloorAreaSqm / maxBuildingAreaSqm)
  );
  // input 모드: 사용자 입력 층수 그대로 (내 계획).
  const floors =
    mode === "max"
      ? maxFloorsByFar
      : mode === "input"
      ? Math.max(1, inputFloors ?? RECOMMENDED_FLOORS[type])
      : RECOMMENDED_FLOORS[type];
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
  const ba = calcBuildableArea(
    parcel.boundary,
    sideSetbackM,
    floors,
    floorHeightM,
    sunApplies,
    edgeSetbacksM
  );
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

  const heightM = floors * floorHeightM + 1.4;
  const sun = evalSunVerdict(parcel.zoning, heightM, floors, northSouthM, parcel);

  const pk = calcParking(
    type as BuildingType,
    gfaSqm,
    type === "retail" ? 0 : units,
    type === "retail" ? 1 : 0
  );

  const farUsedPct = Math.round((gfaSqm / parcel.lotArea) * 100);

  // Score Engine — 시공성·법적리스크·별점 종합 (최종형)
  // 주차 capacity는 아직 미확정(배치엔진 Level 2~3 전) → null.
  const score = computeScore({
    floors,
    sun: { mark: sun.mark, remainDepthM: sun.remainDepthM },
    parking: { required: pk.requiredCars, capacity: null },
    farUsedPct,
    farCapPct: parcel.maxFAR,
    bcrUsedPct: parcel.maxBCR,
    bcrCapPct: parcel.maxBCR,
  });

  return {
    mode,
    floors,
    gfaSqm,
    gfaPyeong: Math.round(gfaSqm / 3.3058),
    farUsedPct,
    units,
    sun,
    parking: { requiredCars: pk.requiredCars, basis: pk.basis },
    maxBuildingAreaSqm: Number(maxBuildingAreaSqm.toFixed(1)),
    buildable2DSqm: ba.buildable2DSqm,
    buildability: score.buildability,
    legalRisk: score.legalRisk,
    parkingSufficient: score.parkingSufficient,
    stars: score.stars,
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
    recommended: buildOption(type, "recommended", env, parcel, northSouthM, undefined, undefined, unitAreaSqm, floorHeightM),
    max: buildOption(type, "max", env, parcel, northSouthM, undefined, undefined, unitAreaSqm, floorHeightM),
    unitAreaSqm,
  };
}
