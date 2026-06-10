/**
 * 철거 비용 계산기.
 *
 * 시행 사업에서 기존 건물 철거는 큰 비용 항목 — 빠뜨리면 IRR 계산이
 * 비현실적으로 높게 나옴.
 *
 * 단가 (2024-2025 한국 평균, 평당 만원):
 *   단독주택/다세대:    12
 *   근린생활시설:        18
 *   공동주택/아파트:     22
 *   오피스/오피스텔:     25
 *   대형 빌딩 (5층+):   30
 *
 * 위 단가는 안전관리비, 폐기물 처리비, 소운반비 포함.
 * 실제는 현장 조건에 따라 ±30% 변동. 1차 추정치.
 *
 * 자동 분기 — redevelopmentSignal === "rebuild" 시에만 계산:
 *   - vacant (빈 땅)    → 0
 *   - rebuild (재건축)  → 모든 동 합계
 *   - renovate         → 0 (리모델링은 철거 안 함)
 *   - keep (신축)       → 0
 */

import type {
  BuildingInfo,
  RedevelopmentSignal,
} from "@/lib/integrations/molit-building";

const SQM_PER_PYEONG = 3.305785;

const COST_PER_PYEONG_MANWON: Record<string, number> = {
  단독주택: 12,
  다가구주택: 12,
  다세대주택: 12,
  연립주택: 12,
  근린생활시설: 18,
  근린생활: 18,
  "제1종근린생활시설": 18,
  "제2종근린생활시설": 18,
  공동주택: 22,
  아파트: 22,
  업무시설: 25,
  오피스텔: 25,
  판매시설: 25,
  교육연구시설: 22,
  의료시설: 25,
};

const FALLBACK_PER_PYEONG = 18;
const HIGHRISE_THRESHOLD_FLOORS = 5;
const HIGHRISE_PER_PYEONG = 30;

export interface DemolitionCostResult {
  /** 총 철거비 (만원) */
  totalManwon: number;
  /** 적용된 평당 단가 (만원/평). 여러 동이면 가중평균 */
  effectivePerPyeong: number;
  /** 총 철거 평수 */
  totalPyeong: number;
  /** 사람이 읽을 수 있는 설명 */
  reasoning: string;
  /** 시행 사업에 철거비 적용되는가 */
  applies: boolean;
}

/**
 * 건물 한 동의 평당 단가 결정.
 * 5층 이상이면 고층 단가 적용, 그 외엔 용도별 단가.
 */
function perPyeongFor(building: BuildingInfo): number {
  // 5층 이상은 고층 단가 (안전관리비 큼)
  if (building.groundFloors >= HIGHRISE_THRESHOLD_FLOORS) {
    return HIGHRISE_PER_PYEONG;
  }

  // 주용도 매칭
  const purpose = building.mainPurpose.trim();
  if (purpose in COST_PER_PYEONG_MANWON) {
    return COST_PER_PYEONG_MANWON[purpose];
  }

  // 세부용도 fallback
  const detailKeys = Object.keys(COST_PER_PYEONG_MANWON);
  for (const key of detailKeys) {
    if (building.detailPurpose.includes(key)) {
      return COST_PER_PYEONG_MANWON[key];
    }
  }

  return FALLBACK_PER_PYEONG;
}

export function calculateDemolitionCost(
  buildings: BuildingInfo[],
  signal: RedevelopmentSignal
): DemolitionCostResult {
  // 빈 땅 또는 시행 부적합 → 철거비 없음
  if (signal === "vacant" || signal === "keep" || signal === "renovate") {
    return {
      totalManwon: 0,
      effectivePerPyeong: 0,
      totalPyeong: 0,
      reasoning:
        signal === "vacant"
          ? "빈 토지 — 철거 불필요"
          : signal === "keep"
            ? "신축 건물 — 시행 부적합 (철거 적용 안 됨)"
            : "리모델링 — 철거 적용 안 됨",
      applies: false,
    };
  }

  // 건물 없으면 계산 불가
  if (buildings.length === 0) {
    return {
      totalManwon: 0,
      effectivePerPyeong: 0,
      totalPyeong: 0,
      reasoning: "건물 정보 없음",
      applies: false,
    };
  }

  // 재건축 — 모든 동 철거비 합계
  let totalManwon = 0;
  let totalPyeong = 0;

  for (const b of buildings) {
    const pyeong = b.totalArea / SQM_PER_PYEONG;
    const perPyeong = perPyeongFor(b);
    totalManwon += pyeong * perPyeong;
    totalPyeong += pyeong;
  }

  const effectivePerPyeong =
    totalPyeong > 0 ? Math.round(totalManwon / totalPyeong) : 0;

  const reasoning =
    buildings.length === 1
      ? `${buildings[0].mainPurpose} ${Math.round(totalPyeong)}평 × ${effectivePerPyeong}만/평`
      : `${buildings.length}개 동 합계 ${Math.round(totalPyeong)}평 (가중평균 ${effectivePerPyeong}만/평)`;

  return {
    totalManwon: Math.round(totalManwon),
    effectivePerPyeong,
    totalPyeong: Math.round(totalPyeong * 100) / 100,
    reasoning,
    applies: true,
  };
}
