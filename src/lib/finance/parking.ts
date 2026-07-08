/**
 * 법정 주차대수 계산 — 건물 유형 + 규모에 따라 동적 산정.
 *
 * 근거:
 *  - 주차장법 시행령 별표1 (단독주택, 근린생활 등)
 *  - 주택건설기준 등에 관한 규정 §27 (다가구·공동주택·도시형생활)
 *
 * "사실만" 원칙:
 *  - 단독주택은 연면적 기준 (정확).
 *  - 세대형(다가구 등)은 세대당 전용면적이 필요하나 우리는 연면적만 알아
 *    전용률 0.75로 추정 → estimated 플래그로 명시.
 *  - 소규모 단독은 면제 가능 (조례 확인 필요) → exemptPossible.
 *  - 지자체 조례로 강화/완화 가능 → 항상 "조례 확인" 여지 있음.
 */

import type { BuildingType } from "./types";

/** 전용률 추정 (연면적 → 전용면적). 공용부 제외 통상치. */
const EXCLUSIVE_RATIO = 0.75;
/** 근린생활 1대당 면적 (㎡) — 별표1 시설면적 134㎡당 1대 */
const RETAIL_AREA_PER_CAR = 134;

export interface ParkingResult {
  /** 법정 최소 주차대수 */
  requiredCars: number;
  /** 산정 근거 설명 */
  basis: string;
  /** 부설주차장 면제 가능 (소규모 단독 등) — 조례 확인 필요 */
  exemptPossible: boolean;
  /** 전용면적 추정이 들어갔는지 (세대형) */
  estimated: boolean;
  /** 참조 법령 */
  reference: string;
}

/**
 * 법정 주차대수 계산.
 * @param type 건물 유형
 * @param gfaSqm 연면적 (㎡)
 * @param residentialUnits 주거 세대수
 * @param retailUnits 근생 호실수 (대략 50㎡/호 가정)
 */
export function calcParking(
  type: BuildingType,
  gfaSqm: number,
  residentialUnits: number,
  retailUnits: number
): ParkingResult {
  let requiredCars = 0;
  let basis = "";
  let exemptPossible = false;
  let estimated = false;
  let reference = "주차장법 시행령 별표1";

  if (type === "single-house") {
    // 단독주택: 연면적 기준 (별표1)
    if (gfaSqm <= 50) {
      requiredCars = 0;
      exemptPossible = true;
      basis = "연면적 50㎡ 이하 — 부설주차장 면제 가능";
    } else if (gfaSqm <= 150) {
      requiredCars = 1;
      basis = "연면적 50~150㎡ — 1대";
    } else {
      // 서울시 주차장 조례: 150㎡ 초과분 100㎡당 1대 (다가구 제외 단독주택)
      // ※ 전국 서비스 확장 시 지자체별 조례 테이블로 분리 예정
      requiredCars = 1 + Math.ceil((gfaSqm - 150) / 100);
      basis = `연면적 150㎡ 초과 — 1대 + 초과 100㎡당 1대`;
    }
  } else if (
    type === "multi-family" ||
    type === "urban-housing" ||
    type === "coliving"
  ) {
    // 세대형: 세대당 전용면적 추정 → 세대당 대수 (주택건설기준 §27)
    estimated = true;
    reference = "주택건설기준 §27 (전용면적 추정)";
    const exclusivePerUnit =
      residentialUnits > 0
        ? (gfaSqm / residentialUnits) * EXCLUSIVE_RATIO
        : 0;
    let perUnit: number;
    if (type === "urban-housing") {
      // 도시형생활(소형): 30~60㎡ 0.6, 30㎡↓ 0.5
      perUnit = exclusivePerUnit < 30 ? 0.5 : 0.6;
    } else {
      // 다가구·공유주거: 60㎡↓ 0.7, 60㎡↑ 1.0 (30㎡↓ 0.5)
      if (exclusivePerUnit < 30) perUnit = 0.5;
      else if (exclusivePerUnit <= 60) perUnit = 0.7;
      else perUnit = 1.0;
    }
    requiredCars = Math.ceil(residentialUnits * perUnit);
    basis = `세대당 전용 ~${exclusivePerUnit.toFixed(0)}㎡ → ${perUnit}대/세대 × ${residentialUnits}세대`;
  } else if (type === "officetel") {
    // 오피스텔: 별표1 — 전용면적 기준, 통상 세대(호)당 ~1대 수준 (간이)
    estimated = true;
    requiredCars = Math.ceil(residentialUnits * 1.0);
    basis = `오피스텔 ${residentialUnits}호 — 호당 약 1대`;
    reference = "주차장법 별표1 (오피스텔)";
  } else {
    // retail / office / mixed: 시설 면적당 (1대 / 134㎡)
    requiredCars = Math.ceil(gfaSqm / RETAIL_AREA_PER_CAR);
    basis = `시설 ${gfaSqm.toFixed(0)}㎡ — 134㎡당 1대`;
  }

  // 근생 호실 추가 (주거형 건물에 근생이 섞인 경우)
  if (
    retailUnits > 0 &&
    type !== "retail" &&
    type !== "office" &&
    type !== "mixed"
  ) {
    const retailArea = retailUnits * 50;
    requiredCars += Math.ceil(retailArea / RETAIL_AREA_PER_CAR);
  }

  return { requiredCars, basis, exemptPossible, estimated, reference };
}
