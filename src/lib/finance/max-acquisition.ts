/**
 * 예비 모델상 최대 인수가 역산 엔진.
 *
 * 본인 도구의 진짜 차별화 가치:
 *   "시장가 8.4억" ≠ "시행 가능 인수가"
 *
 * 시장가는 MOLIT 실거래에서 도출된 추정. 근데 시행사 형이 정작 알고 싶은 건:
 *   "내가 이 부지를 얼마에 사면 IRR 15% 달성 가능한가?"
 *
 * 알고리즘:
 *   - calculateScenario() 가 pure function (deterministic)
 *   - landCost (= parcel.acquiredPrice) 만 바꿔서 여러 번 호출
 *   - Binary search 로 target IRR 달성하는 최대 landCost 찾기
 *   - 시나리오 × 3 IRR 목표 = 12회 호출 (빠름, ~50-100ms)
 *
 * IRR 목표 (3단계):
 *   - 20%: 공격형 (높은 수익률 기대 — 더 싸게 사야 함)
 *   - 15%: 표준 (시장 일반)
 *   - 10%: 보수형 (안정적 수익 — 비교적 비싸게 사도 됨)
 */

import { calculateScenario } from "./scenario";
import type { Parcel, Scenario, ManWon, Pct } from "./types";

/** 단일 시나리오 + 단일 IRR 목표에 대한 역산 결과 */
export interface MaxAcquisitionResult {
  scenarioId: string;
  targetIRR: Pct;          // 목표 IRR (10, 15, 20)
  maxLandCost: ManWon;     // 예비 모델상 최대 인수가
  achievedIRR: Pct;        // 그 인수가에서 실제 IRR
  /** 시장가와의 차이 (음수 = 시장가가 더 비쌈 = 시행 부적합) */
  marketGap: ManWon;
  feasible: boolean;       // 시장가에서도 목표 달성 가능?
}

/** 한 시나리오에 대한 다중 IRR 목표 역산 */
export interface ScenarioMaxAcquisition {
  scenarioId: string;
  scenarioName: string;
  marketPrice: ManWon;      // 현재 시장가 (parcel.acquiredPrice)
  marketIRR: Pct;            // 시장가 기준 IRR
  results: MaxAcquisitionResult[]; // 3개 목표 (10/15/20%)
}

/** 기본 IRR 목표 */
export const DEFAULT_IRR_TARGETS: Pct[] = [10, 15, 20];

/**
 * 한 시나리오의 최대 시행 가능 인수가 — 단일 IRR 목표.
 *
 * Binary search:
 *   - lo = 0 (땅이 공짜면 무조건 IRR 달성)
 *   - hi = parcel.acquiredPrice × 3 (시장가의 3배 — 분명히 IRR 0% 이하)
 *   - 15회 반복 → 정확도 약 ±0.01%
 */
export function findMaxLandCostForIRR(
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: Pct,
  options: { maxIterations?: number; tolerance?: number } = {}
): MaxAcquisitionResult {
  const { maxIterations = 18, tolerance = 1 } = options; // tolerance: 1만원
  const marketPrice = parcel.acquiredPrice;

  let lo = 0;
  let hi = Math.max(marketPrice * 3, 100_000); // 최소 10억까지 탐색
  let bestFeasibleLandCost = 0;
  let bestIRR = 0;

  // 먼저 hi에서 IRR 확인 — hi에서도 IRR 달성하면 hi 늘리기 (드물지만 가능)
  for (let expandIter = 0; expandIter < 3; expandIter++) {
    const hiResult = calculateScenario({
      parcel: { ...parcel, acquiredPrice: hi },
      scenario,
    });
    if (
      hiResult.irrStatus === "calculated" &&
      hiResult.irr >= targetIRR
    ) {
      hi *= 2;
    } else {
      break;
    }
  }

  // Binary search
  for (let i = 0; i < maxIterations; i++) {
    const mid = (lo + hi) / 2;
    const testParcel = { ...parcel, acquiredPrice: mid };
    const result = calculateScenario({ parcel: testParcel, scenario });

    if (
      result.irrStatus === "calculated" &&
      result.irr >= targetIRR
    ) {
      // 이 가격에서 IRR 달성. 더 비싸게 살 수 있는지 시도
      bestFeasibleLandCost = mid;
      bestIRR = result.irr;
      lo = mid;
    } else {
      // 너무 비쌈. 더 싸게
      hi = mid;
    }

    if (hi - lo < tolerance) break;
  }

  // 시장가에서도 목표 달성 가능?
  const marketResult = calculateScenario({ parcel, scenario });
  const feasible =
    marketResult.irrStatus === "calculated" &&
    marketResult.irr >= targetIRR;

  return {
    scenarioId: scenario.id,
    targetIRR,
    maxLandCost: Math.round(bestFeasibleLandCost),
    achievedIRR: Number(bestIRR.toFixed(2)),
    marketGap: Math.round(bestFeasibleLandCost - marketPrice),
    feasible,
  };
}

/**
 * 한 시나리오의 다중 IRR 목표 역산 (10/15/20%).
 */
export function findMaxAcquisitionForScenario(
  parcel: Parcel,
  scenario: Scenario,
  targets: Pct[] = DEFAULT_IRR_TARGETS
): ScenarioMaxAcquisition {
  // 시장가 기준 IRR (정직히 표시)
  const marketResult = calculateScenario({ parcel, scenario });

  const results = targets.map((t) =>
    findMaxLandCostForIRR(parcel, scenario, t)
  );

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    marketPrice: parcel.acquiredPrice,
    marketIRR: Number(marketResult.irr.toFixed(2)),
    results,
  };
}

/**
 * 모든 시나리오에 대한 역산 (대시보드용).
 */
export function findMaxAcquisitionAll(
  parcel: Parcel,
  scenarios: Scenario[],
  targets: Pct[] = DEFAULT_IRR_TARGETS
): ScenarioMaxAcquisition[] {
  return scenarios.map((s) => findMaxAcquisitionForScenario(parcel, s, targets));
}
