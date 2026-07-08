/**
 * STEP 2 추천 시나리오 — 각 건물유형의 최대 가능 규모 (envelope 기반).
 *
 * "사실만" + "최대값 기준" (C 철학):
 *  - 각 시나리오의 최대 규모를 제시 (수익성 판단 기준점).
 *  - 사용자가 STEP 3에서 조정, 최대 초과시 불가능 경고.
 *  - 단독: 세대 1 고정. 빌라: 최대 세대수 제시.
 *
 * 규모는 envelope(최대 건축면적·용적률 연면적) + 정북일조 층수에서 도출.
 * 세대당 전용면적 등 추정값엔 estimated 플래그.
 */

import type { BuildableEnvelope } from "./envelope";
import { sqmToPyeong } from "./envelope";
import { DEFAULT_UNIT_AREA_SQM } from "./unit-area-standards";

export type ScenarioType = "single-house" | "multi-family" | "retail";

export interface ScenarioScale {
  type: ScenarioType;
  /** 표시명 */
  label: string;
  /** 태그 (표준형/수익형/보수형) */
  tag: string;
  /** 권장 층수 (정북일조·실무 반영) */
  floors: number;
  /** 최대 연면적 (㎡) — envelope 한계 내 */
  maxGfaSqm: number;
  /** 최대 세대수 (단독=1, 빌라=계산) */
  maxUnits: number;
  /** 세대당 면적이 추정인지 */
  unitsEstimated: boolean;
  /** 세대수 조정 가능 여부 (단독 false) */
  unitsAdjustable: boolean;
}

/**
 * 건물유형별 최대 규모 계산.
 * @param type 건물 유형
 * @param env envelope (최대치 엔진 결과)
 * @param tag 시나리오 태그
 * @param unitAreaSqm 세대당 면적 (㎡) — 신축 상품 유형 표준값. 미지정 시 기본값(투룸형 50㎡).
 */
export function calcScenarioScale(
  type: ScenarioType,
  env: BuildableEnvelope,
  tag: string,
  unitAreaSqm: number = DEFAULT_UNIT_AREA_SQM
): ScenarioScale {
  const { maxBuildingAreaSqm, maxFarFloorAreaSqm } = env;

  if (type === "single-house") {
    // 단독: 세대 1 고정. 보통 2층 (정북일조로 저층).
    // 연면적 = 건축면적 × 층수 (용적률 한계 내)
    const floors = 2;
    const gfa = Math.min(maxFarFloorAreaSqm, maxBuildingAreaSqm * floors);
    return {
      type,
      label: "단독주택 신축매매",
      tag,
      floors,
      maxGfaSqm: gfa,
      maxUnits: 1,
      unitsEstimated: false,
      unitsAdjustable: false,
    };
  }

  if (type === "multi-family") {
    // 다가구: 3층, 용적률 최대. 최대 세대수 = 연면적 / 세대당 면적.
    const floors = 3;
    const gfa = Math.min(maxFarFloorAreaSqm, maxBuildingAreaSqm * floors);
    const maxUnits = Math.max(1, Math.floor(gfa / unitAreaSqm));
    return {
      type,
      label: "다가구주택 신축매매",
      tag,
      floors,
      maxGfaSqm: gfa,
      maxUnits,
      unitsEstimated: true,
      unitsAdjustable: true,
    };
  }

  // retail: 근생 3층, 세대 개념 없음
  const floors = 3;
  const gfa = Math.min(maxFarFloorAreaSqm, maxBuildingAreaSqm * floors);
  return {
    type,
    label: "근린생활시설",
    tag,
    floors,
    maxGfaSqm: gfa,
    maxUnits: 0,
    unitsEstimated: false,
    unitsAdjustable: false,
  };
}

/** ㎡ → 평 문자열 */
export function gfaPyeong(sqm: number): string {
  return sqmToPyeong(sqm).toFixed(1);
}

/**
 * 부지 크기로 시나리오 타입 선택 (Smart Picker 간소화 — 주거지역).
 * 38평<50평 → 단독·다가구·근생.
 */
export function pickScenarioTypes(
  lotAreaSqm: number,
  zoning: string
): { type: ScenarioType; tag: string }[] {
  const isResidential = /주거지역/.test(zoning);
  if (!isResidential) {
    return [{ type: "retail", tag: "보수형" }];
  }
  const lotPyeong = lotAreaSqm / 3.305785;
  if (lotPyeong < 50) {
    return [
      { type: "single-house", tag: "표준형" },
      { type: "multi-family", tag: "수익형" },
      { type: "retail", tag: "보수형" },
    ];
  }
  // 50평 이상: 다가구 위주
  return [
    { type: "multi-family", tag: "수익형" },
    { type: "single-house", tag: "안정형" },
    { type: "retail", tag: "보수형" },
  ];
}
