/**
 * Transparent multi-objective comparison for project scenarios.
 *
 * No weighted aggregate score is produced. Each objective remains visible,
 * and the Pareto frontier contains every eligible scenario that is not
 * dominated across the comparable objectives.
 */

export const SCENARIO_DECISION_MODEL_VERSION =
  "scenario-decision-pareto-2026.5" as const;

export type ScenarioDecisionObjective =
  | "profit"
  | "downside-profit"
  | "npv"
  | "irr"
  | "required-equity"
  | "max-exposure"
  | "duration"
  | "regulatory";

export type ScenarioDecisionDirection = "maximize" | "minimize";

export interface ScenarioDecisionCandidate {
  id: string;
  viable: boolean;
  profit: number;
  downsideProfit: number | null;
  npv: number;
  irr: number | null;
  requiredEquity: number;
  maxExposure: number;
  durationMonths: number;
  regulatoryScore: number;
  fundingStatus: "unverified" | "funded" | "shortfall";
  blockingRegulatoryIssues?: string[];
  /** Review requirements remain visible but do not act as confirmed blockers. */
  regulatoryReviewIssues?: string[];
}

export interface ScenarioDecisionObjectiveLeader {
  objective: ScenarioDecisionObjective;
  label: string;
  direction: ScenarioDecisionDirection;
  scenarioIds: string[];
  bestValue: number | null;
}

export interface ScenarioDecisionEntry {
  scenarioId: string;
  status: "pareto" | "dominated" | "ineligible";
  exclusionReasons: string[];
  advisoryReasons: string[];
  dominatedByScenarioIds: string[];
  leaderObjectives: ScenarioDecisionObjective[];
}

export interface ScenarioDecisionSupport {
  modelVersion: typeof SCENARIO_DECISION_MODEL_VERSION;
  method: "pareto-no-weights";
  focusScenarioId: string;
  focusMode:
    | "explicit-selection"
    | "highest-profit"
    | "least-loss-fallback"
    | "ineligible-fallback";
  paretoScenarioIds: string[];
  objectiveLeaders: ScenarioDecisionObjectiveLeader[];
  entries: ScenarioDecisionEntry[];
  excludedMetrics: Array<{
    metric: "lease-takeout-dscr";
    reason: string;
  }>;
  warnings: string[];
}

interface ObjectiveDefinition {
  objective: ScenarioDecisionObjective;
  label: string;
  direction: ScenarioDecisionDirection;
  value: (candidate: ScenarioDecisionCandidate) => number | null;
}

const OBJECTIVES: ObjectiveDefinition[] = [
  {
    objective: "profit",
    label: "세전 손익",
    direction: "maximize",
    value: (candidate) => candidate.profit,
  },
  {
    objective: "downside-profit",
    label: "기본 공사단가 +20% 월별 손익",
    direction: "maximize",
    value: (candidate) => candidate.downsideProfit,
  },
  {
    objective: "npv",
    label: "NPV",
    direction: "maximize",
    value: (candidate) => candidate.npv,
  },
  {
    objective: "irr",
    label: "세전 IRR",
    direction: "maximize",
    value: (candidate) => candidate.irr,
  },
  {
    objective: "required-equity",
    label: "필요 자기자본",
    direction: "minimize",
    value: (candidate) => candidate.requiredEquity,
  },
  {
    objective: "max-exposure",
    label: "최대 자금노출",
    direction: "minimize",
    value: (candidate) => candidate.maxExposure,
  },
  {
    objective: "duration",
    label: "사업기간",
    direction: "minimize",
    value: (candidate) => candidate.durationMonths,
  },
  {
    objective: "regulatory",
    label: "법규 위험 점수",
    direction: "maximize",
    value: (candidate) => candidate.regulatoryScore,
  },
];

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function compareValues(
  a: number,
  b: number,
  direction: ScenarioDecisionDirection,
): "better" | "equal" | "worse" {
  const tolerance = Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);
  if (Math.abs(a - b) <= tolerance) return "equal";
  if (direction === "maximize") return a > b ? "better" : "worse";
  return a < b ? "better" : "worse";
}

function exclusionReasons(candidate: ScenarioDecisionCandidate): string[] {
  const reasons: string[] = [];
  if (!candidate.viable) reasons.push("유효 사업면적이 없어 물리적으로 실행할 수 없습니다.");
  if (candidate.profit < 0) reasons.push("현재 가정에서 세전 손실입니다.");
  if (candidate.fundingStatus === "shortfall") {
    reasons.push("확인된 자기자본 한도보다 필요 자기자본이 큽니다.");
  }
  if (!finite(candidate.downsideProfit)) {
    reasons.push("기본 공사단가 +20%의 월별 손익을 재계산하지 못했습니다.");
  }
  for (const issue of candidate.blockingRegulatoryIssues ?? []) {
    reasons.push(`확인된 법규 차단: ${issue}`);
  }
  if (
    OBJECTIVES.some((objective) => {
      const value = objective.value(candidate);
      return objective.objective !== "irr" && !finite(value);
    })
  ) {
    reasons.push("필수 비교 지표에 유효하지 않은 값이 있습니다.");
  }
  return reasons;
}

function dominates(
  candidate: ScenarioDecisionCandidate,
  other: ScenarioDecisionCandidate,
): boolean {
  let compared = 0;
  let strictlyBetter = false;

  for (const objective of OBJECTIVES) {
    const candidateValue = objective.value(candidate);
    const otherValue = objective.value(other);
    // Missing IRR is not evidence that a candidate is no worse on that axis.
    if (finite(candidateValue) !== finite(otherValue)) return false;
    if (!finite(candidateValue) || !finite(otherValue)) continue;
    compared += 1;
    // Exact weak inequalities prevent tolerance-induced domination cycles.
    if (objective.direction === "maximize" ? candidateValue < otherValue : candidateValue > otherValue) return false;
    const comparison = compareValues(
      candidateValue,
      otherValue,
      objective.direction,
    );
    if (comparison === "better") strictlyBetter = true;
  }

  return compared > 0 && strictlyBetter;
}

function objectiveLeaders(
  frontier: ScenarioDecisionCandidate[],
): ScenarioDecisionObjectiveLeader[] {
  return OBJECTIVES.map((objective) => {
    const comparable = frontier
      .map((candidate) => ({
        candidate,
        value: objective.value(candidate),
      }))
      .filter(
        (item): item is { candidate: ScenarioDecisionCandidate; value: number } =>
          finite(item.value),
      );
    if (comparable.length === 0) {
      return {
        objective: objective.objective,
        label: objective.label,
        direction: objective.direction,
        scenarioIds: [],
        bestValue: null,
      };
    }

    const bestValue = comparable.reduce((best, item) => objective.direction === "maximize"
      ? Math.max(best, item.value) : Math.min(best, item.value), comparable[0].value);
    const scenarioIds = comparable
      .filter(
        (item) =>
          compareValues(item.value, bestValue, objective.direction) === "equal",
      )
      .map((item) => item.candidate.id);

    return {
      objective: objective.objective,
      label: objective.label,
      direction: objective.direction,
      scenarioIds,
      bestValue,
    };
  });
}

function pickProfitFocus(candidates: ScenarioDecisionCandidate[]): string {
  return [...candidates].sort((a, b) => {
    const comparisons: Array<[number | null, number | null, ScenarioDecisionDirection]> = [
      [a.profit, b.profit, "maximize"],
      [a.downsideProfit, b.downsideProfit, "maximize"],
      [a.npv, b.npv, "maximize"],
      [a.irr, b.irr, "maximize"],
      [a.requiredEquity, b.requiredEquity, "minimize"],
      [a.maxExposure, b.maxExposure, "minimize"],
      [a.durationMonths, b.durationMonths, "minimize"],
      [a.regulatoryScore, b.regulatoryScore, "maximize"],
    ];
    for (const [aValue, bValue, direction] of comparisons) {
      const aFinite = finite(aValue);
      const bFinite = finite(bValue);
      if (aFinite !== bFinite) return aFinite ? -1 : 1;
      if (!aFinite || !bFinite) continue;
      if (aValue === bValue) continue;
      return direction === "maximize" ? (aValue > bValue ? -1 : 1) : (aValue < bValue ? -1 : 1);
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0].id;
}

export function buildScenarioDecisionSupport(
  candidates: ScenarioDecisionCandidate[],
  explicitFocusScenarioId?: string,
): ScenarioDecisionSupport {
  if (candidates.length === 0) {
    throw new Error("시나리오 다목적 비교에는 후보가 한 개 이상 필요합니다.");
  }
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new Error("시나리오 다목적 비교 후보 ID는 서로 달라야 합니다.");
  }

  const reasonsById = new Map(
    candidates.map((candidate) => [candidate.id, exclusionReasons(candidate)]),
  );
  const eligible = candidates.filter(
    (candidate) => (reasonsById.get(candidate.id)?.length ?? 0) === 0,
  );
  const dominatedBy = new Map<string, string[]>();
  for (const candidate of eligible) {
    dominatedBy.set(
      candidate.id,
      eligible
        .filter(
          (other) => other.id !== candidate.id && dominates(other, candidate),
        )
        .map((other) => other.id),
    );
  }
  const frontier = eligible.filter(
    (candidate) => (dominatedBy.get(candidate.id)?.length ?? 0) === 0,
  );
  const leaders = objectiveLeaders(frontier);
  const leaderObjectivesById = new Map<string, ScenarioDecisionObjective[]>();
  for (const leader of leaders) {
    for (const scenarioId of leader.scenarioIds) {
      leaderObjectivesById.set(scenarioId, [
        ...(leaderObjectivesById.get(scenarioId) ?? []),
        leader.objective,
      ]);
    }
  }

  const explicitFocus = candidates.find(
    (candidate) => candidate.id === explicitFocusScenarioId,
  );
  const fallbackPool = frontier.length > 0 ? frontier : eligible.length > 0 ? eligible : candidates;
  const focusScenarioId = explicitFocus?.id ?? pickProfitFocus(fallbackPool);
  const focusMode: ScenarioDecisionSupport["focusMode"] = explicitFocus
    ? "explicit-selection"
    : eligible.length > 0
      ? "highest-profit"
      : candidates.every((candidate) => candidate.profit < 0)
        ? "least-loss-fallback"
        : "ineligible-fallback";

  const warnings = [
    "가중 합산 점수를 만들지 않으며 각 판단 축을 독립적으로 비교합니다.",
    "세금·가격·공사비·금융 입력이 예비값이면 파레토 결과도 예비 비교입니다.",
  ];
  if (candidates.some((candidate) => !finite(candidate.irr))) {
    warnings.push(
      "세전 IRR이 미확정인 후보가 있습니다. IRR 확인 여부가 다른 후보 간 지배 관계는 판정하지 않으며 IRR 선두는 계산 가능한 후보만 비교합니다.",
    );
  }
  if (candidates.some((candidate) => candidate.fundingStatus === "unverified")) {
    warnings.push(
      "확인 자기자본 한도가 없는 후보는 조달 가능성이 검증되지 않았습니다.",
    );
  }
  if (
    candidates.some(
      (candidate) => (candidate.regulatoryReviewIssues?.length ?? 0) > 0,
    )
  ) {
    warnings.push(
      "용도지역 스크리닝은 예비 후보 생성 근거이며 관할 조례·지구단위계획 확인 전에는 허가 가능 판정이 아닙니다.",
    );
  }
  if (eligible.length === 0) {
    warnings.push(
      focusMode === "least-loss-fallback"
        ? "최소 비교 조건을 충족한 후보가 없어 세전 손실이 가장 작은 후보를 임시 비교 기준으로 표시합니다."
        : "최소 비교 조건을 충족한 후보가 없어 세전 손익이 가장 큰 후보를 임시 비교 기준으로만 표시합니다.",
    );
  }
  if (explicitFocus && (reasonsById.get(explicitFocus.id)?.length ?? 0) > 0) {
    warnings.push(
      "사용자가 선택한 대표안은 비교 기준으로 유지되지만 파레토 후보 자격은 충족하지 못합니다.",
    );
  }

  return {
    modelVersion: SCENARIO_DECISION_MODEL_VERSION,
    method: "pareto-no-weights",
    focusScenarioId,
    focusMode,
    paretoScenarioIds: frontier.map((candidate) => candidate.id),
    objectiveLeaders: leaders,
    entries: candidates.map((candidate) => {
      const exclusion = reasonsById.get(candidate.id) ?? [];
      const candidateDominators = dominatedBy.get(candidate.id) ?? [];
      return {
        scenarioId: candidate.id,
        status:
          exclusion.length > 0
            ? "ineligible"
            : candidateDominators.length > 0
              ? "dominated"
              : "pareto",
        exclusionReasons: exclusion,
        advisoryReasons: [
          ...(candidate.regulatoryReviewIssues ?? []),
          ...(!finite(candidate.irr)
            ? ["세전 IRR이 미확정이므로 IRR이 확인된 후보와 지배 관계를 판정하지 않습니다."]
            : []),
        ],
        dominatedByScenarioIds: candidateDominators,
        leaderObjectives: leaderObjectivesById.get(candidate.id) ?? [],
      };
    }),
    excludedMetrics: [
      {
        metric: "lease-takeout-dscr",
        reason:
          "장기대출 DSCR은 안정화 임대 NOI와 대출 조건이 있는 후보에만 적용되므로 매각형과 임대형의 공통 순위 축에서 제외합니다.",
      },
    ],
    warnings,
  };
}
