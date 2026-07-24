import { passesDealRescueTarget } from "./deal-rescue";
import { calculateScenario } from "./scenario";
import type { Parcel, Scenario, ScenarioResult } from "./types";

export const DEAL_STRESS_MODEL_VERSION = "deal-stress-2026.1";
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
    | "demolition"
    | "hard-cost"
    | "soft-cost"
    | "financing"
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
    profit: number;
    npv: number;
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
): ThresholdSearch {
  if (!evaluate(low)) return { value: null, hitBound: false };
  if (evaluate(high)) return { value: high, hitBound: true };

  let passing = low;
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
): ThresholdSearch {
  if (!evaluate(high)) return { value: null, hitBound: false };
  if (evaluate(low)) return { value: low, hitBound: true };

  let failing = low;
  let passing = high;
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
    { id: "demolition", label: "철거비", amount: result.demolitionCost },
    { id: "hard-cost", label: "직접 공사비", amount: result.hardCost },
    { id: "soft-cost", label: "설계·인허가·간접비", amount: result.softCost },
    { id: "financing", label: "금융비", amount: result.financingCost },
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
  const result = calculateScenario({ parcel, scenario });
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
 * Thresholds are mathematical boundaries inside disclosed search ranges, not
 * appraisals, lender terms, construction quotes, or legal buildability advice.
 */
export function buildDealStressTest(
  parcel: Parcel,
  scenario: Scenario,
): DealStressResult {
  const targetIRR = scenario.assumptions.equityIRR;
  const baseline = calculateScenario({ parcel, scenario });
  const baselinePasses = passesDealRescueTarget(baseline, targetIRR);
  const revenueField =
    scenario.program.mix.residentialSale > 0
      ? "salePricePerSqM"
      : "rentPerSqMMonth";
  const revenueCurrent = scenario.assumptions[revenueField];

  const landHigh = Math.max(
    parcel.acquiredPrice * 4,
    baseline.totalRevenue * 2,
    10_000,
  );
  const land = findHighestPassing(0, landHigh, (value) =>
    pass({ ...parcel, acquiredPrice: value }, scenario, targetIRR),
  );

  const revenueHigh = Math.max(revenueCurrent * 4, 1);
  const revenue = findLowestPassing(0, revenueHigh, (value) =>
    pass(parcel, cloneScenario(scenario, { [revenueField]: value }), targetIRR),
  );

  const constructionCurrent = scenario.assumptions.constCostPerSqM;
  const constructionHigh = Math.max(constructionCurrent * 2.5, 1);
  const construction = findHighestPassing(0, constructionHigh, (value) =>
    pass(
      parcel,
      cloneScenario(scenario, { constCostPerSqM: value }),
      targetIRR,
    ),
  );

  const rateCurrent = scenario.assumptions.interestRate;
  const rate = findHighestPassing(0, 25, (value) =>
    pass(parcel, cloneScenario(scenario, { interestRate: value }), targetIRR),
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
      note: "수익·원가·금융·기간을 고정한 최대 통과값",
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
      note: "다른 입력을 고정한 최소 통과값",
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
      note: "설계·간접비와 예비비의 연동을 포함한 최대 통과값",
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
      note: "0~25% 탐색 범위 안의 최대 통과값",
    },
  ];

  const revenueDown = cloneScenario(scenario, {
    [revenueField]: revenueCurrent * 0.9,
  });
  const costUp = cloneScenario(scenario, {
    constCostPerSqM: constructionCurrent * 1.1,
  });
  const rateUp = cloneScenario(scenario, {
    interestRate: rateCurrent + 1.5,
  });
  const delay = cloneScenario(scenario, {
    constructionMonths: scenario.assumptions.constructionMonths + 3,
  });
  const combined = cloneScenario(scenario, {
    [revenueField]: revenueCurrent * 0.95,
    constCostPerSqM: constructionCurrent * 1.1,
    interestRate: rateCurrent + 1,
    constructionMonths: scenario.assumptions.constructionMonths + 3,
  });

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
      "공사비 +10%",
      ["직접 공사비 단가 +10%", "연동 간접비·예비비 재계산"],
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
      ["매출 -5%", "공사비 +10%", "PF +1.0%p", "공사 +3개월"],
      parcel,
      combined,
      targetIRR,
    ),
  ];

  const summedCost = buildCostDna(baseline);
  return {
    modelVersion: DEAL_STRESS_MODEL_VERSION,
    targetIRR,
    baseline,
    baselinePasses,
    gateGap: {
      profit: Math.max(0, -baseline.profit),
      npv: Math.max(0, -baseline.npv),
      irrPctPoint:
        baseline.irrStatus === "calculated"
          ? Math.max(0, targetIRR - baseline.irr)
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
      `매출 단가 0~현재의 4배`,
      `직접 공사비 0~현재의 2.5배`,
      `PF 금리 0~25%`,
    ],
  };
}
