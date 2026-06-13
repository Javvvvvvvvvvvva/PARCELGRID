/**
 * 주차장 + 코어(엘리베이터/계단/공용) 면적 계산기.
 *
 * 한국 시행 사업에서 GFA(연면적)은 단순 곱셈으로 나오지만, 진짜
 * "분양/임대 가능 면적"은 주차장과 코어를 빼야 함. 보통 GFA의
 * 25-40%가 빠짐.
 *
 * 본인 도구가 이걸 무시하면 IRR이 30-50% 과대 추정됨.
 *
 * 법적 근거:
 *   - 주차장법 시행령 별표1 (주차장 설치기준)
 *   - 건축법 시행령 제89조 (승강기 설치)
 *   - 건축법 시행령 제48조 (직통계단)
 *
 * 한계:
 *   - 80% 정확도 목표. 진짜 정확은 건축사 도면 필요.
 *   - 지역별 조례 차이 반영 안 함 (서울 기준).
 *   - 부설주차장 감면 (대중교통 인접 등) 반영 안 함.
 */

import type { BuildingProgram, BuildingType } from "@/lib/finance/types";

/* ─────────────────────────── 주차 의무대수 ─────────────────────────── */

/**
 * 용도별 주차 의무 (1대당 시설면적, m²).
 * 작을수록 더 많은 주차 필요.
 *
 * 서울시 부설주차장 설치기준 (2024-2025 기준).
 */
const PARKING_PER_SQM: Record<BuildingType, number> = {
  // 오피스텔: 호당 1대 → 전용 60-85m² 평균 기준 75m²/대
  officetel: 75,
  // 공유주거: 전용 30-50m² 평균, 완화 적용
  coliving: 100,
  // 도시형생활주택: 세대당 0.6-0.7대 → 평균 85m²/대
  "urban-housing": 85,
  // 근린생활시설: 시설면적 134m²당 1대
  retail: 134,
  "single-house": 250, // 단독: 1-2대 (가구당) — 가장 적음
  "multi-family": 130, // 다가구: 호당 0.5-0.7대
  // 사무실/업무시설: 시설면적 134m²당 1대
  office: 134,
  // 복합용도: 가중평균 (주거+상가 절반씩 가정)
  mixed: 100,
};

/**
 * 주차 1대당 점유 면적 (m², 차로 + 회전 공간 포함).
 *
 * - 지하주차장: 약 25-30m²/대
 * - 지상주차장: 약 30-35m²/대
 *
 * 평균 28m² 사용.
 */
const SQM_PER_PARKING_SPACE = 28;

export interface ParkingResult {
  /** 의무 주차대수 */
  requiredSpaces: number;
  /** 총 주차 면적 (m²) */
  parkingArea: number;
  /** 계산 근거 설명 */
  reasoning: string;
}

export function calculateParking(
  program: BuildingProgram,
  gfa: number
): ParkingResult {
  const type = program.type;
  const sqmPerSpace = PARKING_PER_SQM[type] ?? 100;

  // 용도별 GFA 분배
  // 주거 (분양 + 임대) vs 상가
  const residentialRatio =
    program.mix.residentialSale + program.mix.residentialLease;
  const retailRatio = program.mix.retail;

  const residentialGFA = gfa * residentialRatio;
  const retailGFA = gfa * retailRatio;

  // 주거: 용도 기준 (officetel/coliving 등)
  const residentialSpaces = residentialGFA > 0
    ? Math.ceil(residentialGFA / sqmPerSpace)
    : 0;

  // 상가: 134m²당 1대 고정
  const retailSpaces = retailGFA > 0
    ? Math.ceil(retailGFA / 134)
    : 0;

  const requiredSpaces = residentialSpaces + retailSpaces;
  const parkingArea = requiredSpaces * SQM_PER_PARKING_SPACE;

  const reasoning =
    residentialSpaces > 0 && retailSpaces > 0
      ? `주거 ${residentialSpaces}대 (${residentialGFA.toFixed(0)}m² ÷ ${sqmPerSpace}m²) + 상가 ${retailSpaces}대`
      : residentialSpaces > 0
        ? `주거 ${residentialSpaces}대 (${residentialGFA.toFixed(0)}m² ÷ ${sqmPerSpace}m²)`
        : `상가 ${retailSpaces}대 (${retailGFA.toFixed(0)}m² ÷ 134m²)`;

  return {
    requiredSpaces,
    parkingArea,
    reasoning,
  };
}

/* ─────────────────────────── 코어 면적 ─────────────────────────── */

/** 엘리베이터 1대당 면적 (m²/층) */
const ELEVATOR_AREA_PER_FLOOR = 5.5;

/** 직통계단 1개당 면적 (m²/층). 건축법 제48조. */
const STAIR_AREA_PER_FLOOR = 18;

/** 공용면적 비율 (복도/로비/화장실/기계실 등) */
const COMMON_AREA_RATIO = 0.10;

export interface CoreResult {
  elevatorArea: number;
  stairArea: number;
  commonArea: number;
  totalCoreArea: number;
  elevatorCount: number;
  stairCount: number;
  reasoning: string;
}

export function calculateCore(
  floorsAbove: number,
  gfa: number,
  type?: BuildingType
): CoreResult {
  // ─── 단독주택 — 엘리베이터 X, 계단 1개, 공용 거의 없음 ───
  // 단독은 1가구라서 엘리베이터 의무 X, 공용 복도 없음, 화장실 1-2개만
  if (type === "single-house") {
    const stairArea = STAIR_AREA_PER_FLOOR * floorsAbove;
    const commonArea = gfa * 0.03; // 공용 3% (현관, 기계실 약간)
    const totalCoreArea = stairArea + commonArea;
    return {
      elevatorArea: 0,
      stairArea,
      commonArea,
      totalCoreArea,
      elevatorCount: 0,
      stairCount: 1,
      reasoning: `단독주택: 엘리베이터 X · 계단 1개 × ${floorsAbove}층 + 공용 3% (효율 ~95%)`,
    };
  }

  // ─── 다가구주택 — 6층 미만 엘리베이터 X, 공용 7% ───
  // 다가구는 1동 통매매, 호수 5-15개. 보통 3-5층이라 엘리베이터 의무 X
  if (type === "multi-family") {
    const needsElevator = floorsAbove >= 6 || gfa >= 2000;
    const elevatorCount = needsElevator ? 1 : 0;
    const elevatorArea = elevatorCount * ELEVATOR_AREA_PER_FLOOR * floorsAbove;
    const stairArea = STAIR_AREA_PER_FLOOR * floorsAbove; // 계단 1개 (5층 이하)
    const commonArea = gfa * 0.07; // 공용 7% (복도 + 화장실 + 기계실)
    const totalCoreArea = elevatorArea + stairArea + commonArea;
    return {
      elevatorArea,
      stairArea,
      commonArea,
      totalCoreArea,
      elevatorCount,
      stairCount: 1,
      reasoning: needsElevator
        ? `다가구: 엘리베이터 1대 + 계단 1개 × ${floorsAbove}층 + 공용 7% (효율 ~83%)`
        : `다가구: 엘리베이터 X · 계단 1개 × ${floorsAbove}층 + 공용 7% (저층, 효율 ~88%)`,
    };
  }

  // ─── 기존 다세대 (오피스텔/도시형/근생/코리빙/사무실) ───
  // 엘리베이터 의무: 6층 이상 또는 연면적 2,000m² 이상
  const needsElevator = floorsAbove >= 6 || gfa >= 2000;
  // 16층 이상: 비상용 엘리베이터 추가
  const needsEmergencyElevator = floorsAbove >= 16;

  let elevatorCount = 0;
  if (needsElevator) {
    elevatorCount = 1;
    const avgFloorArea = floorsAbove > 0 ? gfa / floorsAbove : 0;
    // 대규모 (층당 1,000m² 초과): 대당 추가
    if (avgFloorArea >= 1000) {
      elevatorCount += Math.floor(avgFloorArea / 1000);
    }
    if (needsEmergencyElevator) elevatorCount += 1;
  }

  const elevatorArea = elevatorCount * ELEVATOR_AREA_PER_FLOOR * floorsAbove;

  // 계단실: 모든 층에 1개, 16층 이상은 피난계단 추가
  const stairCount = floorsAbove >= 16 ? 2 : 1;
  const stairArea = stairCount * STAIR_AREA_PER_FLOOR * floorsAbove;

  const commonArea = gfa * COMMON_AREA_RATIO;

  const totalCoreArea = elevatorArea + stairArea + commonArea;

  const reasoning = needsElevator
    ? `엘리베이터 ${elevatorCount}대 + 계단 ${stairCount}개소 × ${floorsAbove}층 + 공용 10%`
    : `계단 ${stairCount}개소 × ${floorsAbove}층 + 공용 10% (저층 — 엘리베이터 불필요)`;

  return {
    elevatorArea,
    stairArea,
    commonArea,
    totalCoreArea,
    elevatorCount,
    stairCount,
    reasoning,
  };
}

/* ─────────────────────────── 통합 — 전용률 ─────────────────────────── */

export interface EffectiveGFAResult {
  rawGFA: number;
  parkingArea: number;
  coreArea: number;
  effectiveGFA: number;
  efficiencyRatio: number;
  parkingSpaces: number;
  elevatorCount: number;
  reasoning: string;
}

export function calculateEffectiveGFA(
  program: BuildingProgram,
  rawGFA: number
): EffectiveGFAResult {
  const parking = calculateParking(program, rawGFA);
  const core = calculateCore(program.floorsAbove, rawGFA, program.type);

  // 보수적 계산: 주차 + 코어 + 공용 모두 GFA에서 차감
  const effectiveGFA = Math.max(0, rawGFA - parking.parkingArea - core.totalCoreArea);
  const efficiencyRatio = rawGFA > 0 ? effectiveGFA / rawGFA : 0;

  const reasoning = `${rawGFA.toFixed(0)}m² (원시) − ${parking.parkingArea.toFixed(0)}m² (주차 ${parking.requiredSpaces}대) − ${core.totalCoreArea.toFixed(0)}m² (코어) = ${effectiveGFA.toFixed(0)}m² (전용률 ${(efficiencyRatio * 100).toFixed(1)}%)`;

  return {
    rawGFA,
    parkingArea: parking.parkingArea,
    coreArea: core.totalCoreArea,
    effectiveGFA,
    efficiencyRatio,
    parkingSpaces: parking.requiredSpaces,
    elevatorCount: core.elevatorCount,
    reasoning,
  };
}
