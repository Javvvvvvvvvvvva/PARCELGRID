import { passesDealRescueTarget } from "./deal-rescue";
import { calculatedAnnualIrr } from "./return-metrics";
import {
  blendedRevenueUnitPrice,
  revenuePricingKindForScenario,
  withScenarioRevenueUnitPrice,
} from "./revenue-contract";
import { calculateScenario, minimumConstructionCostRate } from "./scenario";
import { ASSUMPTION_VALUE_RULES } from "./assumption-validation";
import type { Parcel, Scenario, ScenarioResult } from "./types";

export const DEAL_STRESS_MODEL_VERSION = "deal-stress-2026.2";
const BINARY_SEARCH_ITERATIONS = 20;

export type DealStressThresholdId =
  | "land-price"
  | "revenue-price"
  | "construction-cost"
  | "pf-rate";

export type DealStressThresholdStatus =
  | "within-limit"
  | "change-required"
  | "unreachable"
  | "at-bound";

export interface DealStressCostItem {
  id:
    | "land"
    | "acquisition-tax"
    | "acquisition-other"
    | "demolition"
    | "tenant-relocation"
    | "hard-cost"
    | "soft-cost"
    | "interest"
    | "pf-fee"
    | "trust-fee"
    | "contingency"
    | "rounding";
  label: string;
  amount: number;
  shareOfTotalCost: number;
}

export interface DealStressThreshold {
  id: DealStressThresholdId;
  label: string;
  direction: "maximum" | "minimum";
  status: DealStressThresholdStatus;
  current: number;
  threshold: number | null;
  unit: "만원" | "원/㎡" | "원/㎡·월" | "%";
  deltaFromCurrentPct: number | null;
  note: string;
}

export interface DealStressCase {
  id:
    | "revenue-down-10"
    | "cost-up-10"
    | "rate-up-1_5"
    | "delay-3"
    | "combined-downside";
  label: string;
  changes: string[];
  result: ScenarioResult;
  passesTarget: boolean;
}

export interface DealStressResult {
  modelVersion: typeof DEAL_STRESS_MODEL_VERSION;
  targetIRR: number;
  baseline: ScenarioResult;
  baselinePasses: boolean;
  gateGap: {
    profit: number | null;
    npv: number | null;
    irrPctPoint: number | null;
  };
  costDna: DealStressCostItem[];
  reconciliationError: number;
  thresholds: DealStressThreshold[];
  stressCases: DealStressCase[];
  geometryPolicy: string;
  bounds: string[];
}

type ThresholdSearch = {
  value: number | null;
  hitBound: boolean;
};

function cloneScenario(
  scenario: Scenario,
  assumptions: Partial<Scenario["assumptions"]>,
): Scenario {
  return {
    ...scenario,
    assumptions: { ...scenario.assumptions, ...assumptions },
  };
}

function pass(parcel: Parcel, scenario: Scenario, targetIRR: number): boolean {
  return passesDealRescueTarget(
    calculateScenario({ parcel, scenario }),
    targetIRR,
  );
}

function findHighestPassing(
  low: number,
  high: number,
  evaluate: (value: number) => boolean,
  current: number,
): ThresholdSearch {
  if (evaluate(high)) return { value: high, hitBound: true };
  const candidates = [low, Math.max(low, Math.min(high, current)),
    ...Array.from({ length: 15 }, (_, i) => low + (high - low) * (i + 1) / 16)];
  const passingSeed = candidates.find(evaluate);
  if (passingSeed === undefined) return { value: null, hitBound: false };
  let passing = passingSeed;
  let failing = high;
  for (let i = 0; i < BINARY_SEARCH_ITERATIONS; i += 1) {
    const candidate = (passing + failing) / 2;
    if (evaluate(candidate)) passing = candidate;
    else failing = candidate;
  }
  return { value: passing, hitBound: false };
}

function findLowestPassing(
  low: number,
  high: number,
  evaluate: (value: number) => boolean,
  current: number,
): ThresholdSearch {
  if (evaluate(low)) return { value: low, hitBound: true };
  const candidates = [high, Math.max(low, Math.min(high, current)),
    ...Array.from({ length: 15 }, (_, i) => low + (high - low) * (16 - i - 1) / 16)];
  const passingSeed = candidates.find(evaluate);
  if (passingSeed === undefined) return { value: null, hitBound: false };
  let failing = low;
  let passing = passingSeed;
  for (let i = 0; i < BINARY_SEARCH_ITERATIONS; i += 1) {
    const candidate = (failing + passing) / 2;
    if (evaluate(candidate)) passing = candidate;
    else failing = candidate;
  }
  return { value: passing, hitBound: false };
}

function thresholdStatus(
  baselinePasses: boolean,
  search: ThresholdSearch,
): DealStressThresholdStatus {
  if (search.value === null) return "unreachable";
  if (search.hitBound) return "at-bound";
  return baselinePasses ? "within-limit" : "change-required";
}

function pctDelta(current: number, threshold: number | null): number | null {
  if (threshold === null || current === 0) return null;
  return ((threshold - current) / current) * 100;
}

function buildCostDna(result: ScenarioResult): DealStressCostItem[] {
  const rows: Array<Omit<DealStressCostItem, "shareOfTotalCost">> = [
    { id: "land", label: "부동산 취득대금", amount: result.landCost },
    { id: "acquisition-tax", label: "취득세 반영액", amount: result.acquisitionTax },
    { id: "acquisition-other", label: "기타 취득 부대비", amount: result.acquisitionOtherCost },
    { id: "demolition", label: "철거비", amount: result.demolitionCost },
    { id: "tenant-relocation", label: "명도·임차인 정리비", amount: result.tenantRelocationCost },
    { id: "hard-cost", label: "직접 공사비", amount: result.hardCost },
    { id: "soft-cost", label: "설계·인허가·간접비", amount: result.softCost },
    { id: "interest", label: "PF 이자", amount: result.interestCost },
    { id: "pf-fee", label: "PF 약정·취급 수수료", amount: result.pfFee },
    { id: "trust-fee", label: "신탁·자금관리비", amount: result.trustFee },
    { id: "contingency", label: "예비비", amount: result.contingency },
  ];
  const componentTotal = rows.reduce((sum, row) => sum + row.amount, 0);
  const roundingAdjustment = result.totalCost - componentTotal;
  if (Math.abs(roundingAdjustment) > 1e-9) {
    rows.push({
      id: "rounding",
      label: "원장 반올림 조정",
      amount: roundingAdjustment,
    });
  }
  return rows
    .map((row) => ({
      ...row,
      shareOfTotalCost:
        result.totalCost > 0 ? (row.amount / result.totalCost) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function stressCase(
  id: DealStressCase["id"],
  label: string,
  changes: string[],
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: number,
): DealStressCase {
  let result: ScenarioResult;
  try {
    result = calculateScenario({ parcel, scenario });
  } catch (error) {
    throw new Error(`${label} 분석을 완료하지 못했습니다. ${error instanceof Error ? error.message : "입력값과 계산 범위를 확인하세요."}`);
  }
  return {
    id,
    label,
    changes,
    result,
    passesTarget: passesDealRescueTarget(result, targetIRR),
  };
}

/**
 * Builds an auditable Stage 3 stress view from the exact same scenario ledger.
 * Thresholds are rechecked candidates inside disclosed search ranges, not
 * appraisals, lender terms, construction quotes, or legal buildability advice.
 */
export function buildDealStressTest(
  parcel: Parcel,
  scenario: Scenario,
): DealStressResult {
  const targetIRR = scenario.assumptions.equityIRR;
  const baseline = calculateScenario({ parcel, scenario });
  const baselinePasses = passesDealRescueTarget(baseline, targetIRR);
  const revenueKind = revenuePricingKindForScenario(scenario);
  const revenueField =
    revenueKind === "sale" ? "salePricePerSqM" : "rentPerSqMMonth";
  const revenueCurrent = blendedRevenueUnitPrice(scenario, revenueKind);

  const landHigh = Math.max(
    parcel.acquiredPrice * 4,
    baseline.totalRevenue * 2,
    10_000,
  );
  const land = findHighestPassing(0, landHigh, (value) =>
    pass({ ...parcel, acquiredPrice: value }, scenario, targetIRR),
    parcel.acquiredPrice,
  );

  const revenueHigh = Math.min(Math.max(revenueCurrent * 4, 1), ASSUMPTION_VALUE_RULES[revenueField].max);
  const revenue = findLowestPassing(0, revenueHigh, (value) =>
    pass(
      parcel,
      withScenarioRevenueUnitPrice(scenario, revenueKind, value),
      targetIRR,
    ),
    revenueCurrent,
  );

  const constructionCurrent = scenario.assumptions.constCostPerSqM;
  const quantityCostScope = scenario.program.areaContract?.quantityCostAdjustment
    ? "수량 교체 견적액 고정 · 잔여 기본 공종만 증감" : "직접 공사비 단가 변동";
  const constructionLow = minimumConstructionCostRate({ parcel, scenario });
  const constructionHigh = Math.min(Math.max(constructionCurrent * 2.5, 1), ASSUMPTION_VALUE_RULES.constCostPerSqM.max);
  const construction = findHighestPassing(constructionLow, constructionHigh, (value) =>
    pass(
      parcel,
      cloneScenario(scenario, { constCostPerSqM: value }),
      targetIRR,
    ),
    constructionCurrent,
  );

  const rateCurrent = scenario.assumptions.interestRate;
  const rate = findHighestPassing(0, 25, (value) =>
    pass(parcel, cloneScenario(scenario, { interestRate: value }), targetIRR),
    rateCurrent,
  );

  const thresholds: DealStressThreshold[] = [
    {
      id: "land-price",
      label: "부동산 총 취득대금",
      direction: "maximum",
      status: thresholdStatus(baselinePasses, land),
      current: parcel.acquiredPrice,
      threshold: land.value,
      unit: "만원",
      deltaFromCurrentPct: pctDelta(parcel.acquiredPrice, land.value),
      note: "수익·원가·금융·기간 고정 · 탐색에서 확인한 상방 후보 (전역 최대 보장 아님)",
    },
    {
      id: "revenue-price",
      label:
        revenueField === "salePricePerSqM" ? "매각·분양 단가" : "월 임대 단가",
      direction: "minimum",
      status: thresholdStatus(baselinePasses, revenue),
      current: revenueCurrent,
      threshold: revenue.value,
      unit: revenueField === "salePricePerSqM" ? "원/㎡" : "원/㎡·월",
      deltaFromCurrentPct: pctDelta(revenueCurrent, revenue.value),
      note: "다른 입력 고정 · 탐색에서 확인한 하방 후보 (전역 최소 보장 아님)",
    },
    {
      id: "construction-cost",
      label: "직접 공사비 단가",
      direction: "maximum",
      status: thresholdStatus(baselinePasses, construction),
      current: constructionCurrent,
      threshold: construction.value,
      unit: "원/㎡",
      deltaFromCurrentPct: pctDelta(constructionCurrent, construction.value),
      note: `설계·간접비·예비비 연동 상방 후보 (전역 최대 보장 아님) · ${quantityCostScope}`,
    },
    {
      id: "pf-rate",
      label: "PF 금리",
      direction: "maximum",
      status: thresholdStatus(baselinePasses, rate),
      current: rateCurrent,
      threshold: rate.value,
      unit: "%",
      deltaFromCurrentPct: pctDelta(rateCurrent, rate.value),
      note: "0~25% 탐색에서 확인한 상방 후보 (전역 최대 보장 아님)",
    },
  ];

  const revenueDown = withScenarioRevenueUnitPrice(
    scenario,
    revenueKind,
    revenueCurrent * 0.9,
  );
  const costUp = cloneScenario(scenario, {
    constCostPerSqM: constructionCurrent * 1.1,
  });
  const rateUp = cloneScenario(scenario, {
    interestRate: rateCurrent + 1.5,
  });
  const delay = cloneScenario(scenario, {
    constructionMonths: scenario.assumptions.constructionMonths + 3,
  });
  const combined = cloneScenario(
    withScenarioRevenueUnitPrice(
      scenario,
      revenueKind,
      revenueCurrent * 0.95,
    ),
    {
    constCostPerSqM: constructionCurrent * 1.1,
    interestRate: rateCurrent + 1,
    constructionMonths: scenario.assumptions.constructionMonths + 3,
    },
  );

  const stressCases: DealStressCase[] = [
    stressCase(
      "revenue-down-10",
      "매출 단가 -10%",
      ["매각·분양 또는 임대 단가 -10%"],
      parcel,
      revenueDown,
      targetIRR,
    ),
    stressCase(
      "cost-up-10",
      "기본 공사단가 +10%",
      ["직접 공사비 단가 +10%", quantityCostScope, "연동 간접비·예비비 재계산"],
      parcel,
      costUp,
      targetIRR,
    ),
    stressCase(
      "rate-up-1_5",
      "PF 금리 +1.5%p",
      ["PF 금리 +1.5%p"],
      parcel,
      rateUp,
      targetIRR,
    ),
    stressCase(
      "delay-3",
      "공사 3개월 지연",
      ["공사기간 +3개월", "금융비·현금흐름 재계산"],
      parcel,
      delay,
      targetIRR,
    ),
    stressCase(
      "combined-downside",
      "복합 하방",
      ["매출 -5%", "기본 공사단가 +10%", quantityCostScope, "PF +1.0%p", "공사 +3개월"],
      parcel,
      combined,
      targetIRR,
    ),
  ];

  const summedCost = buildCostDna(baseline);
  const annualIrr = calculatedAnnualIrr(baseline);
  return {
    modelVersion: DEAL_STRESS_MODEL_VERSION,
    targetIRR,
    baseline,
    baselinePasses,
    gateGap: {
      profit: Number.isFinite(baseline.profitUnroundedManwon)
        ? Math.max(0, -baseline.profitUnroundedManwon!) : null,
      npv: Number.isFinite(baseline.npvUnroundedManwon)
        ? Math.max(0, -baseline.npvUnroundedManwon!) : null,
      irrPctPoint:
        annualIrr !== null
          ? Math.max(0, targetIRR - annualIrr)
          : null,
    },
    costDna: summedCost,
    reconciliationError:
      baseline.totalRevenue - baseline.totalCost - baseline.profit,
    thresholds,
    stressCases,
    geometryPolicy:
      "계획 규모·용적률은 연속 보간하지 않습니다. Stage 2에서 저장된 법규·배치 검증 계획안끼리만 별도 비교합니다.",
    bounds: [
      `부동산 총 취득대금 0~${Math.round(landHigh)}만원`,
      `매출 단가 0~${revenueHigh}원 (현재의 4배와 입력 상한 중 작은 값)`,
      `직접 공사비 ${constructionLow}~${constructionHigh}원/㎡ (음수 공사비 제외 · 현재의 2.5배와 입력 상한 중 작은 값)`,
      `PF 금리 0~25%`,
    ],
  };
}
