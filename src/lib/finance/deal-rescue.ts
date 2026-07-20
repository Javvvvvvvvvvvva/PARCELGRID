import { calculateScenario } from "./scenario";
import type {
  AssumptionSet,
  Parcel,
  Scenario,
  ScenarioResult,
} from "./types";

export const DEAL_RESCUE_MODEL_VERSION = "deal-rescue-2026.1";

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
    result.profit >= 0 &&
    result.npv >= 0 &&
    result.irrStatus === "calculated" &&
    result.irr >= targetIRR
  );
}

export function findDealRescuePaths(
  parcel: Parcel,
  scenario: Scenario
): DealRescueResult {
  const baseline = calculateScenario({ parcel, scenario });
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
      (1 - SINGLE_CONSTRUCTION_COST_FLOOR) * 100,
    interestRateFloorPct: 0,
    balanced: { ...BALANCED_BOUNDS },
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

  const paths = [
    findLandPricePath(parcel, scenario, target.irr),
    findRevenuePricePath(parcel, scenario, target.irr),
    findConstructionCostPath(parcel, scenario, target.irr),
    findInterestRatePath(parcel, scenario, target.irr),
    findBalancedPath(parcel, scenario, target.irr),
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
        "토지 검토 매입가",
        parcel.acquiredPrice,
        value,
        "만원"
      ),
    ],
    result,
    "다른 가정은 고정하고 목표를 통과하는 최대 토지 검토가를 역산했습니다."
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

  const baseValue = scenario.assumptions[revenueField.field];
  if (baseValue <= 0) {
    return unavailablePath(
      "revenue-price",
      revenueField.title,
      "not-applicable",
      "기준 단가가 0이어서 배율 기반 역산을 실행하지 않았습니다."
    );
  }

  let infeasible = baseValue;
  let feasible = baseValue * SINGLE_REVENUE_MULTIPLIER;
  const upperResult = evaluate(parcel, scenario, {
    assumptions: { [revenueField.field]: feasible },
  });
  if (!passesDealRescueTarget(upperResult, targetIRR)) {
    return unavailablePath(
      "revenue-price",
      revenueField.title,
      "unreachable",
      `현재 단가의 ${SINGLE_REVENUE_MULTIPLIER.toFixed(0)}배까지 높여도 손익·NPV·IRR 목표를 동시에 충족하지 못합니다.`
    );
  }

  for (let index = 0; index < BINARY_SEARCH_ITERATIONS; index += 1) {
    const candidate = (infeasible + feasible) / 2;
    const result = evaluate(parcel, scenario, {
      assumptions: { [revenueField.field]: candidate },
    });
    if (passesDealRescueTarget(result, targetIRR)) feasible = candidate;
    else infeasible = candidate;
  }

  const value = Math.ceil(feasible);
  const result = evaluate(parcel, scenario, {
    assumptions: { [revenueField.field]: value },
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
    "토지가·공사비·금융조건은 고정하고 목표를 통과하는 최소 매출 단가를 역산했습니다."
  );
}

function findConstructionCostPath(
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: number
): DealRescuePath {
  const baseValue = scenario.assumptions.constCostPerSqM;
  if (baseValue <= 0) {
    return unavailablePath(
      "construction-cost",
      "공사비 VE",
      "not-applicable",
      "기준 직접 공사비가 0이어서 역산하지 않았습니다."
    );
  }

  let feasible = baseValue * SINGLE_CONSTRUCTION_COST_FLOOR;
  let infeasible = baseValue;
  const floorResult = evaluate(parcel, scenario, {
    assumptions: { constCostPerSqM: feasible },
  });
  if (!passesDealRescueTarget(floorResult, targetIRR)) {
    return unavailablePath(
      "construction-cost",
      "공사비 VE",
      "unreachable",
      `직접 공사비를 ${Math.round(
        (1 - SINGLE_CONSTRUCTION_COST_FLOOR) * 100
      )}% 낮춰도 손익·NPV·IRR 목표를 동시에 충족하지 못합니다.`
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

  const value = Math.max(0, Math.floor(feasible));
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
    "다른 가정은 고정하고 목표를 통과하는 최대 직접 공사비를 역산했습니다."
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
    "다른 가정은 고정하고 목표를 통과하는 최대 PF 금리를 역산했습니다."
  );
}

function findBalancedPath(
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: number
): DealRescuePath {
  const revenueField = getRevenueField(scenario);
  const revenueBase = revenueField
    ? scenario.assumptions[revenueField.field]
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
      const costReduction =
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
          constCostPerSqM: Math.max(
            0,
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
      if (revenueField && revenueBase > 0) {
        candidateScenario = withAssumption(
          candidateScenario,
          revenueField.field,
          Math.ceil(revenueBase * (1 + revenueIncrease))
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
          revenueField && revenueBase > 0 ? revenueIncrease : 0,
        costReduction,
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
          "토지 검토 매입가",
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
          candidate.scenario.assumptions[revenueField.field],
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
      `토지가 -${BALANCED_BOUNDS.landPriceReductionPct}%, 매출 단가 +${BALANCED_BOUNDS.revenuePriceIncreasePct}%, 공사비 -${BALANCED_BOUNDS.constructionCostReductionPct}%, 금리 -${BALANCED_BOUNDS.interestRateReductionPctPoint}%p 범위의 공개 조합 프로필에서도 목표를 충족하지 못했습니다.`
    );
  }

  return {
    ...reachablePath(
      "balanced",
      "균형 조정안",
      best.changes,
      best.result,
      "공개된 4개 조합 프로필 안에서 동일 가중치 부담 점수가 가장 낮은 다중 변수 조합입니다."
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

function withAssumption<K extends keyof AssumptionSet>(
  scenario: Scenario,
  field: K,
  value: AssumptionSet[K]
): Scenario {
  return {
    ...scenario,
    assumptions: {
      ...scenario.assumptions,
      [field]: value,
    },
  };
}

function getRevenueField(scenario: Scenario):
  | {
      field: "salePricePerSqM" | "rentPerSqMMonth";
      title: string;
      label: string;
      unit: "원/㎡" | "원/㎡·월";
    }
  | undefined {
  if (scenario.program.mix.residentialSale > 0) {
    return {
      field: "salePricePerSqM",
      title: "매각·분양 단가 검토",
      label: "매각·분양 단가",
      unit: "원/㎡",
    };
  }
  if (
    scenario.program.mix.residentialLease > 0 ||
    scenario.program.mix.retail > 0
  ) {
    return {
      field: "rentPerSqMMonth",
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
  reason: string
): DealRescuePath {
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
