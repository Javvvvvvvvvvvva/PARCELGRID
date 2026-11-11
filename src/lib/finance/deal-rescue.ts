import { calculateScenario, FIXED_FULL_QUOTE_COST_REASON, minimumConstructionCostRate } from "./scenario";
import { ASSUMPTION_VALUE_RULES } from "./assumption-validation";
import { meetsIrrTarget } from "./return-metrics";
import {
  blendedRevenueUnitPrice,
  revenueAreaTotals,
  withScenarioRevenueUnitPrice,
  type RevenuePricingKind,
} from "./revenue-contract";
import type {
  AssumptionSet,
  Parcel,
  Scenario,
  ScenarioResult,
} from "./types";

export const DEAL_RESCUE_MODEL_VERSION = "deal-rescue-2026.2";

export type DealRescueStatus =
  | "already-viable"
  | "rescue-found"
  | "no-bounded-solution"
  | "geometry-blocked";

export type DealRescuePathStatus =
  | "reachable"
  | "unreachable"
  | "not-applicable";

export type DealRescueLever =
  | "land-price"
  | "revenue-price"
  | "construction-cost"
  | "pf-rate"
  | "balanced";

export interface DealRescueTarget {
  profit: 0;
  npv: 0;
  irr: number;
  requiresCalculatedIRR: true;
  requiresViableGeometry: true;
}

export interface DealRescueChange {
  field: "acquiredPrice" | keyof AssumptionSet;
  label: string;
  from: number;
  to: number;
  unit: "만원" | "원/㎡" | "원/㎡·월" | "%";
  pctChange: number | null;
}

export interface DealRescuePath {
  id: DealRescueLever;
  title: string;
  status: DealRescuePathStatus;
  changes: DealRescueChange[];
  result?: ScenarioResult;
  reason: string;
  /**
   * Equal-weight burden score within the disclosed balanced-search bounds.
   * It is a deterministic comparison aid, not a market preference model.
   */
  burdenScore?: number;
}

export interface DealRescueBounds {
  saleOrRentIncreasePct: number;
  constructionCostReductionPct: number;
  interestRateFloorPct: number;
  balanced: {
    landPriceReductionPct: number;
    revenuePriceIncreasePct: number;
    constructionCostReductionPct: number;
    interestRateReductionPctPoint: number;
  };
}

export interface DealRescueResult {
  modelVersion: typeof DEAL_RESCUE_MODEL_VERSION;
  status: DealRescueStatus;
  baseline: ScenarioResult;
  target: DealRescueTarget;
  paths: DealRescuePath[];
  bounds: DealRescueBounds;
  evidenceStatus: "engine-calculated-external-validation-required";
}

const BINARY_SEARCH_ITERATIONS = 18;
const SINGLE_REVENUE_MULTIPLIER = 3;
const SINGLE_CONSTRUCTION_COST_FLOOR = 0.4;
const BALANCED_BOUNDS = {
  landPriceReductionPct: 40,
  revenuePriceIncreasePct: 50,
  constructionCostReductionPct: 20,
  interestRateReductionPctPoint: 2,
} as const;

const BALANCED_PROFILES = [
  { land: 1, revenue: 1, cost: 1, rate: 1 },
  { land: 1, revenue: 1, cost: 0.5, rate: 0.5 },
  { land: 1, revenue: 0.5, cost: 1, rate: 0.5 },
  { land: 0.5, revenue: 1, cost: 1, rate: 1 },
] as const;

export function passesDealRescueTarget(
  result: ScenarioResult,
  targetIRR: number
): boolean {
  return (
    result.viable &&
    Number.isFinite(result.profitUnroundedManwon) && result.profitUnroundedManwon! >= 0 &&
    Number.isFinite(result.npvUnroundedManwon) && result.npvUnroundedManwon! >= 0 &&
    result.funding.status !== "shortfall" &&
    meetsIrrTarget(result, targetIRR)
  );
}

export function findDealRescuePaths(
  parcel: Parcel,
  scenario: Scenario
): DealRescueResult {
  const baseline = calculateScenario({ parcel, scenario });
  const fixedQuote = scenario.program.areaContract?.fullQuoteCost !== undefined;
  const target: DealRescueTarget = {
    profit: 0,
    npv: 0,
    irr: scenario.assumptions.equityIRR,
    requiresCalculatedIRR: true,
    requiresViableGeometry: true,
  };
  const bounds: DealRescueBounds = {
    saleOrRentIncreasePct: (SINGLE_REVENUE_MULTIPLIER - 1) * 100,
    constructionCostReductionPct:
      fixedQuote ? 0 : (1 - SINGLE_CONSTRUCTION_COST_FLOOR) * 100,
    interestRateFloorPct: 0,
    balanced: { ...BALANCED_BOUNDS, ...(fixedQuote ? { constructionCostReductionPct: 0 } : {}) },
  };
  const baseResult: Omit<DealRescueResult, "status" | "paths"> = {
    modelVersion: DEAL_RESCUE_MODEL_VERSION,
    baseline,
    target,
    bounds,
    evidenceStatus:
      "engine-calculated-external-validation-required" as const,
  };

  if (!baseline.viable) {
    return {
      ...baseResult,
      status: "geometry-blocked",
      paths: [
        unavailablePath(
          "balanced",
          "계획 매스 재검토",
          "unreachable",
          baseline.viabilityNote ??
            "유효 매스가 성립하지 않아 금융 변수만으로 해결안을 만들 수 없습니다."
        ),
      ],
    };
  }

  if (passesDealRescueTarget(baseline, target.irr)) {
    return {
      ...baseResult,
      status: "already-viable",
      paths: [],
    };
  }

  const constructionCostFloor = fixedQuote ? 0 : minimumConstructionCostRate({ parcel, scenario });
  const paths = [
    findLandPricePath(parcel, scenario, target.irr),
    findRevenuePricePath(parcel, scenario, target.irr),
    findConstructionCostPath(parcel, scenario, target.irr, constructionCostFloor),
    findInterestRatePath(parcel, scenario, target.irr),
    findBalancedPath(parcel, scenario, target.irr, constructionCostFloor),
  ];

  return {
    ...baseResult,
    status: paths.some((path) => path.status === "reachable")
      ? "rescue-found"
      : "no-bounded-solution",
    paths,
  };
}

function findLandPricePath(
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: number
): DealRescuePath {
  const zeroLandResult = evaluate(parcel, scenario, {
    acquiredPrice: 0,
  });
  if (!passesDealRescueTarget(zeroLandResult, targetIRR)) {
    return unavailablePath(
      "land-price",
      "토지가 협상",
      "unreachable",
      "토지가를 0원까지 낮춰도 손익·NPV·IRR 목표를 동시에 충족하지 못합니다."
    );
  }

  let feasible = 0;
  let infeasible = parcel.acquiredPrice;
  for (let index = 0; index < BINARY_SEARCH_ITERATIONS; index += 1) {
    const candidate = (feasible + infeasible) / 2;
    const result = evaluate(parcel, scenario, {
      acquiredPrice: candidate,
    });
    if (passesDealRescueTarget(result, targetIRR)) feasible = candidate;
    else infeasible = candidate;
  }

  const value = Math.max(0, Math.floor(feasible));
  const result = evaluate(parcel, scenario, { acquiredPrice: value });
  return reachablePath(
    "land-price",
    "토지가 협상",
    [
      change(
        "acquiredPrice",
        "부동산 총 취득대금",
        parcel.acquiredPrice,
        value,
        "만원"
      ),
    ],
    result,
    "다른 가정은 고정한 제한 탐색의 토지 검토가 후보입니다.",
    targetIRR
  );
}

function findRevenuePricePath(
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: number
): DealRescuePath {
  const revenueField = getRevenueField(scenario);
  if (!revenueField) {
    return unavailablePath(
      "revenue-price",
      "매출 단가 검토",
      "not-applicable",
      "현재 프로그램에는 역산할 수 있는 분양·임대 매출 풀이 없습니다."
    );
  }

  const baseValue = blendedRevenueUnitPrice(scenario, revenueField.kind);
  if (baseValue <= 0) {
    return unavailablePath(
      "revenue-price",
      revenueField.title,
      "not-applicable",
      "기준 단가가 0이어서 배율 기반 역산을 실행하지 않았습니다."
    );
  }

  let infeasible = baseValue;
  let feasible = Math.min(baseValue * SINGLE_REVENUE_MULTIPLIER, ASSUMPTION_VALUE_RULES[revenueField.field].max);
  if (feasible <= baseValue) {
    return unavailablePath("revenue-price", revenueField.title, "unreachable", "단가 입력 상한 안에서 매출 단가를 더 높일 수 없습니다.");
  }
  const upperResult = calculateScenario({
    parcel,
    scenario: withScenarioRevenueUnitPrice(
      scenario,
      revenueField.kind,
      feasible,
    ),
  });
  if (!passesDealRescueTarget(upperResult, targetIRR)) {
    return unavailablePath(
      "revenue-price",
      revenueField.title,
      "unreachable",
      `입력 상한 안의 단가 ${feasible}원까지 높여도 손익·NPV·IRR 목표를 동시에 충족하지 못합니다.`
    );
  }

  for (let index = 0; index < BINARY_SEARCH_ITERATIONS; index += 1) {
    const candidate = (infeasible + feasible) / 2;
    const result = calculateScenario({
      parcel,
      scenario: withScenarioRevenueUnitPrice(
        scenario,
        revenueField.kind,
        candidate,
      ),
    });
    if (passesDealRescueTarget(result, targetIRR)) feasible = candidate;
    else infeasible = candidate;
  }

  const value = Math.ceil(feasible);
  const result = calculateScenario({
    parcel,
    scenario: withScenarioRevenueUnitPrice(
      scenario,
      revenueField.kind,
      value,
    ),
  });
  return reachablePath(
    "revenue-price",
    revenueField.title,
    [
      change(
        revenueField.field,
        revenueField.label,
        baseValue,
        value,
        revenueField.unit
      ),
    ],
    result,
    "토지가·공사비·금융조건은 고정한 제한 탐색의 매출 단가 후보입니다.",
    targetIRR
  );
}

function findConstructionCostPath(
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: number,
  constructionCostFloor: number,
): DealRescuePath {
  if (scenario.program.areaContract?.fullQuoteCost !== undefined) {
    return unavailablePath("construction-cost", "공사비 VE", "not-applicable", FIXED_FULL_QUOTE_COST_REASON);
  }
  const baseValue = scenario.assumptions.constCostPerSqM;
  if (baseValue <= 0) {
    return unavailablePath(
      "construction-cost",
      "공사비 VE",
      "not-applicable",
      "기준 직접 공사비가 0이어서 역산하지 않았습니다."
    );
  }

  const lowerBound = Math.max(baseValue * SINGLE_CONSTRUCTION_COST_FLOOR, constructionCostFloor);
  let feasible = lowerBound;
  let infeasible = baseValue;
  const floorResult = evaluate(parcel, scenario, {
    assumptions: { constCostPerSqM: feasible },
  });
  if (!passesDealRescueTarget(floorResult, targetIRR)) {
    return unavailablePath(
      "construction-cost",
      "공사비 VE",
      "unreachable",
      `음수 공사비가 되지 않는 탐색 하한 ${lowerBound}원/㎡에서도 손익·NPV·IRR 목표를 동시에 충족하지 못합니다.`
    );
  }

  for (let index = 0; index < BINARY_SEARCH_ITERATIONS; index += 1) {
    const candidate = (feasible + infeasible) / 2;
    const result = evaluate(parcel, scenario, {
      assumptions: { constCostPerSqM: candidate },
    });
    if (passesDealRescueTarget(result, targetIRR)) feasible = candidate;
    else infeasible = candidate;
  }

  const value = Math.max(lowerBound, Math.floor(feasible));
  const result = evaluate(parcel, scenario, {
    assumptions: { constCostPerSqM: value },
  });
  return reachablePath(
    "construction-cost",
    "공사비 VE",
    [
      change(
        "constCostPerSqM",
        "직접 공사비",
        baseValue,
        value,
        "원/㎡"
      ),
    ],
    result,
    "다른 가정은 고정한 제한 탐색의 직접 공사비 후보입니다.",
    targetIRR
  );
}

function findInterestRatePath(
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: number
): DealRescuePath {
  const baseValue = scenario.assumptions.interestRate;
  if (baseValue <= 0) {
    return unavailablePath(
      "pf-rate",
      "PF 조건 조정",
      "not-applicable",
      "현재 PF 금리가 이미 0%이므로 추가 금리 인하를 역산하지 않았습니다."
    );
  }

  let feasible = 0;
  let infeasible = baseValue;
  const zeroRateResult = evaluate(parcel, scenario, {
    assumptions: { interestRate: 0 },
  });
  if (!passesDealRescueTarget(zeroRateResult, targetIRR)) {
    return unavailablePath(
      "pf-rate",
      "PF 조건 조정",
      "unreachable",
      "PF 금리를 0%까지 낮춰도 손익·NPV·IRR 목표를 동시에 충족하지 못합니다."
    );
  }

  for (let index = 0; index < BINARY_SEARCH_ITERATIONS; index += 1) {
    const candidate = (feasible + infeasible) / 2;
    const result = evaluate(parcel, scenario, {
      assumptions: { interestRate: candidate },
    });
    if (passesDealRescueTarget(result, targetIRR)) feasible = candidate;
    else infeasible = candidate;
  }

  const value = Math.max(0, Math.floor(feasible * 10_000) / 10_000);
  const result = evaluate(parcel, scenario, {
    assumptions: { interestRate: value },
  });
  return reachablePath(
    "pf-rate",
    "PF 조건 조정",
    [change("interestRate", "PF 금리", baseValue, value, "%")],
    result,
    "다른 가정은 고정한 제한 탐색의 PF 금리 후보입니다.",
    targetIRR
  );
}

function findBalancedPath(
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: number,
  constructionCostFloor: number,
): DealRescuePath {
  const fixedQuote = scenario.program.areaContract?.fullQuoteCost !== undefined;
  const revenueField = getRevenueField(scenario);
  const revenueBase = revenueField
    ? blendedRevenueUnitPrice(scenario, revenueField.kind)
    : 0;
  let best:
    | {
        result: ScenarioResult;
        changes: DealRescueChange[];
        score: number;
      }
    | undefined;

  for (const profile of BALANCED_PROFILES) {
    const evaluateProfile = (intensity: number) => {
      const landReduction =
        (BALANCED_BOUNDS.landPriceReductionPct / 100) *
        profile.land *
        intensity;
      const revenueIncrease =
        (BALANCED_BOUNDS.revenuePriceIncreasePct / 100) *
        profile.revenue *
        intensity;
      const costReduction = fixedQuote ? 0 :
        (BALANCED_BOUNDS.constructionCostReductionPct / 100) *
        profile.cost *
        intensity;
      const rateReduction =
        BALANCED_BOUNDS.interestRateReductionPctPoint *
        profile.rate *
        intensity;
      const candidateParcel: Parcel = {
        ...parcel,
        acquiredPrice: Math.max(
          0,
          Math.floor(parcel.acquiredPrice * (1 - landReduction))
        ),
      };
      let candidateScenario: Scenario = {
        ...scenario,
        assumptions: {
          ...scenario.assumptions,
          constCostPerSqM: fixedQuote ? scenario.assumptions.constCostPerSqM : Math.max(
            constructionCostFloor,
            Math.floor(
              scenario.assumptions.constCostPerSqM *
                (1 - costReduction)
            )
          ),
          interestRate: Math.max(
            0,
            Math.floor(
              (scenario.assumptions.interestRate - rateReduction) *
                10_000
            ) / 10_000
          ),
        },
      };
      if (revenueField && revenueBase > 0 && revenueBase < ASSUMPTION_VALUE_RULES[revenueField.field].max) {
        candidateScenario = withScenarioRevenueUnitPrice(
          candidateScenario,
          revenueField.kind,
          Math.min(Math.ceil(revenueBase * (1 + revenueIncrease)), ASSUMPTION_VALUE_RULES[revenueField.field].max)
        );
      }
      return {
        parcel: candidateParcel,
        scenario: candidateScenario,
        result: calculateScenario({
          parcel: candidateParcel,
          scenario: candidateScenario,
        }),
        landReduction,
        revenueIncrease:
          revenueField && revenueBase > 0
            ? blendedRevenueUnitPrice(candidateScenario, revenueField.kind) / revenueBase - 1 : 0,
        costReduction: scenario.assumptions.constCostPerSqM > 0
          ? 1 - candidateScenario.assumptions.constCostPerSqM / scenario.assumptions.constCostPerSqM : 0,
        rateReduction,
      };
    };

    const upper = evaluateProfile(1);
    if (!passesDealRescueTarget(upper.result, targetIRR)) continue;

    let infeasible = 0;
    let feasible = 1;
    for (let index = 0; index < BINARY_SEARCH_ITERATIONS; index += 1) {
      const candidate = (infeasible + feasible) / 2;
      const attempt = evaluateProfile(candidate);
      if (passesDealRescueTarget(attempt.result, targetIRR)) {
        feasible = candidate;
      } else {
        infeasible = candidate;
      }
    }

    const candidate = evaluateProfile(feasible);
    if (!passesDealRescueTarget(candidate.result, targetIRR)) continue;

    const changes: DealRescueChange[] = [];
    if (candidate.landReduction > 0) {
      changes.push(
        change(
          "acquiredPrice",
          "부동산 총 취득대금",
          parcel.acquiredPrice,
          candidate.parcel.acquiredPrice,
          "만원"
        )
      );
    }
    if (
      revenueField &&
      candidate.revenueIncrease > 0
    ) {
      changes.push(
        change(
          revenueField.field,
          revenueField.label,
          revenueBase,
          blendedRevenueUnitPrice(candidate.scenario, revenueField.kind),
          revenueField.unit
        )
      );
    }
    if (candidate.costReduction > 0) {
      changes.push(
        change(
          "constCostPerSqM",
          "직접 공사비",
          scenario.assumptions.constCostPerSqM,
          candidate.scenario.assumptions.constCostPerSqM,
          "원/㎡"
        )
      );
    }
    if (candidate.rateReduction > 0) {
      changes.push(
        change(
          "interestRate",
          "PF 금리",
          scenario.assumptions.interestRate,
          candidate.scenario.assumptions.interestRate,
          "%"
        )
      );
    }
    if (changes.length < 2) continue;

    const score =
      candidate.landReduction /
        (BALANCED_BOUNDS.landPriceReductionPct / 100) +
      candidate.revenueIncrease /
        (BALANCED_BOUNDS.revenuePriceIncreasePct / 100) +
      candidate.costReduction /
        (BALANCED_BOUNDS.constructionCostReductionPct / 100) +
      candidate.rateReduction /
        BALANCED_BOUNDS.interestRateReductionPctPoint;
    if (!best || score < best.score) {
      best = {
        result: candidate.result,
        changes,
        score,
      };
    }
  }

  if (!best) {
    return unavailablePath(
      "balanced",
      "균형 조정안",
      "unreachable",
      `토지가 -${BALANCED_BOUNDS.landPriceReductionPct}%, 매출 단가 +${BALANCED_BOUNDS.revenuePriceIncreasePct}%, ${fixedQuote ? "전체 견적 고정" : `공사비 -${BALANCED_BOUNDS.constructionCostReductionPct}%`}, 금리 -${BALANCED_BOUNDS.interestRateReductionPctPoint}%p 범위의 공개 조합 프로필에서도 목표를 충족하지 못했습니다.`
    );
  }

  return {
    ...reachablePath(
      "balanced",
      "균형 조정안",
      best.changes,
      best.result,
      `공개된 4개 조합 프로필 안에서 동일 가중치 부담 점수가 가장 낮은 다중 변수 조합입니다.${fixedQuote ? ` ${FIXED_FULL_QUOTE_COST_REASON}` : ""}`,
      targetIRR
    ),
    burdenScore: Number(best.score.toFixed(4)),
  };
}
function evaluate(
  parcel: Parcel,
  scenario: Scenario,
  overrides: {
    acquiredPrice?: number;
    assumptions?: Partial<AssumptionSet>;
  }
): ScenarioResult {
  return calculateScenario({
    parcel: {
      ...parcel,
      acquiredPrice: overrides.acquiredPrice ?? parcel.acquiredPrice,
    },
    scenario: {
      ...scenario,
      assumptions: {
        ...scenario.assumptions,
        ...(overrides.assumptions ?? {}),
      },
    },
  });
}

function getRevenueField(scenario: Scenario):
  | {
      field: "salePricePerSqM" | "rentPerSqMMonth";
      kind: RevenuePricingKind;
      title: string;
      label: string;
      unit: "원/㎡" | "원/㎡·월";
    }
  | undefined {
  const contractedRevenue = scenario.program.areaContract
    ? revenueAreaTotals(scenario.program.areaContract.revenueAreas)
    : null;
  const hasSale = contractedRevenue
    ? contractedRevenue.saleSqm > 0
    : scenario.program.mix.residentialSale > 0;
  const hasLease = contractedRevenue
    ? contractedRevenue.leaseSqm > 0
    : scenario.program.mix.residentialLease > 0 ||
      scenario.program.mix.retail > 0;
  if (hasSale) {
    return {
      field: "salePricePerSqM",
      kind: "sale",
      title: "매각·분양 단가 검토",
      label: "매각·분양 단가",
      unit: "원/㎡",
    };
  }
  if (hasLease) {
    return {
      field: "rentPerSqMMonth",
      kind: "lease",
      title: "임대료 검토",
      label: "월 임대료",
      unit: "원/㎡·월",
    };
  }
  return undefined;
}

function change(
  field: DealRescueChange["field"],
  label: string,
  from: number,
  to: number,
  unit: DealRescueChange["unit"]
): DealRescueChange {
  return {
    field,
    label,
    from,
    to,
    unit,
    pctChange: from === 0 ? null : ((to - from) / from) * 100,
  };
}

function reachablePath(
  id: DealRescueLever,
  title: string,
  changes: DealRescueChange[],
  result: ScenarioResult,
  reason: string,
  targetIRR: number
): DealRescuePath {
  if (!passesDealRescueTarget(result, targetIRR)) {
    return unavailablePath(id, title, "unreachable", "표시 단위로 확정한 후보의 재계산에서 목표를 충족하지 못했습니다. 탐색 범위 내 해결안을 확정하지 않았습니다.");
  }
  return {
    id,
    title,
    status: "reachable",
    changes,
    result,
    reason,
  };
}

function unavailablePath(
  id: DealRescueLever,
  title: string,
  status: Exclude<DealRescuePathStatus, "reachable">,
  reason: string
): DealRescuePath {
  return {
    id,
    title,
    status,
    changes: [],
    reason,
  };
}
