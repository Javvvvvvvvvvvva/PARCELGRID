/**
 * 건축 최대치 엔진 — 대지의 법적 최대 규모 계산.
 *
 * "사실만" 원칙: 법규로 계산되는 최대치만. 실제 규모는 시행사가 조정.
 * (하우빌드·플렉시티 방식: 최대치 제시 → 유저 조정 → 실시간 재계산)
 *
 * 면적 필드 분리 (건축 데이터 엔진 핵심):
 *  - 대지면적(lot): 건폐율·이격 기준
 *  - 건축면적(building): 대지 × 건폐율 (1층 바닥 최대)
 *  - 용적률 연면적(FAR): 대지 × 용적률 (법규용, 제외항 빠진 면적)
 *  ※ 실제 연면적(GFA, 주차·제외분 포함)은 세대계획 단계에서 별도 산정.
 *
 * 층수: "최대 층수" 공식은 실무상 존재 안 함 (높이·일조·도로 사선이 결정).
 *  - 이론 층수 = 용적률 ÷ 건폐율 (버림) — 용적률 꽉 채운 가정
 *  - 추천 층수 = 이론 비율 구간 — 실무 사례 반영
 *  - STEP3 법규필터(높이·북측사선·도로폭)는 데이터 확보 후 (미구현)
 */

export interface BuildableEnvelope {
  /** 대지면적 (㎡) */
  lotAreaSqm: number;
  /** 최대 건축면적 (㎡) = 대지 × 건폐율 */
  maxBuildingAreaSqm: number;
  /** 최대 용적률 연면적 (㎡) = 대지 × 용적률 */
  maxFarFloorAreaSqm: number;
  /** 이론 층수 (용적률 ÷ 건폐율, 버림) */
  theoreticalFloors: number;
  /** 이론 층수 원시 비율 (구간 판정용) */
  floorRatio: number;
  /** 추천 층수 (실무 구간 — 범위 문자열) */
  recommendedFloors: string;
  /** 입력 건폐율 (%) */
  bcrPct: number;
  /** 입력 용적률 (%) */
  farPct: number;
}

/**
 * 대지 + 용도지역 규제로 건축 최대치 계산.
 * @param lotAreaSqm 대지면적 (㎡)
 * @param bcrPct 건폐율 상한 (%)
 * @param farPct 용적률 상한 (%)
 */
export function calcEnvelope(
  lotAreaSqm: number,
  bcrPct: number,
  farPct: number
): BuildableEnvelope {
  const maxBuildingAreaSqm = lotAreaSqm * (bcrPct / 100);
  const maxFarFloorAreaSqm = lotAreaSqm * (farPct / 100);

  // 이론 층수 = 용적률 ÷ 건폐율
  const floorRatio = bcrPct > 0 ? farPct / bcrPct : 0;
  const theoreticalFloors = Math.floor(floorRatio);

  // 추천 층수 구간 (실무 사례 기반)
  let recommendedFloors: string;
  if (floorRatio < 1.5) recommendedFloors = "2층";
  else if (floorRatio < 2.5) recommendedFloors = "2~3층";
  else if (floorRatio < 3.5) recommendedFloors = "3층";
  else recommendedFloors = "4층 이상";

  return {
    lotAreaSqm,
    maxBuildingAreaSqm,
    maxFarFloorAreaSqm,
    theoreticalFloors,
    floorRatio,
    recommendedFloors,
    bcrPct,
    farPct,
  };
}

/** ㎡ → 평 (1평 = 3.3058㎡) */
export function sqmToPyeong(sqm: number): number {
  return sqm / 3.3058;
}
