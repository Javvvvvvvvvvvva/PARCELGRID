import type {
  AfterTaxLedgerResult,
  AfterTaxStrategy,
} from "@/lib/finance/after-tax-ledger";
import type {
  ScenarioDecisionDirection,
  ScenarioDecisionSupport,
} from "@/lib/finance/scenario-decision-support";

export const AFTER_TAX_DECISION_MODEL_VERSION =
  "after-tax-decision-pareto-2026.2" as const;

export type AfterTaxDecisionObjective =
  | "after-tax-profit"
  | "after-tax-npv"
  | "after-tax-irr"
  | "required-equity"
  | "max-exposure"
  | "duration"
  | "regulatory";

export type AfterTaxDecisionTier =
  | "confirmed"
  | "preliminary"
  | "unavailable";

export interface AfterTaxDecisionCandidate {
  scenarioId: string;
  ledger: Pick<
    AfterTaxLedgerResult,
    | "status"
    | "strategy"
    | "decisionGrade"
    | "afterTaxProfitManwon"
    | "npvManwon"
    | "irrPct"
    | "afterTaxProfitUnroundedManwon"
    | "npvUnroundedManwon"
    | "irrUnroundedPct"
    | "irrStatus"
    | "errors"
  >;
  requiredEquityManwon: number;
  maxExposureManwon: number;
  durationMonths: number;
  regulatoryScore: number;
}

export interface AfterTaxDecisionObjectiveLeader {
  objective: AfterTaxDecisionObjective;
  label: string;
  direction: ScenarioDecisionDirection;
  scenarioIds: string[];
  bestValue: number | null;
}

export interface AfterTaxDecisionEntry {
  scenarioId: string;
  tier: AfterTaxDecisionTier;
  status: "pareto" | "dominated" | "ineligible" | "not-ranked";
  reasons: string[];
  advisoryReasons: string[];
  dominatedByScenarioIds: string[];
  leaderObjectives: AfterTaxDecisionObjective[];
  metrics: {
    afterTaxProfitManwon: number | null;
    npvManwon: number | null;
    irrPct: number | null;
    afterTaxProfitUnroundedManwon?: number | null;
    npvUnroundedManwon?: number | null;
    irrUnroundedPct?: number | null;
  };
}

export interface AfterTaxDecisionSupport {
  modelVersion: typeof AFTER_TAX_DECISION_MODEL_VERSION;
  method: "pareto-no-weights";
  strategy: AfterTaxStrategy;
  confirmedEligibleScenarioCount: number;
  preliminaryEligibleScenarioCount: number;
  confirmedParetoScenarioIds: string[];
  preliminaryParetoScenarioIds: string[];
  confirmedObjectiveLeaders: AfterTaxDecisionObjectiveLeader[];
  preliminaryObjectiveLeaders: AfterTaxDecisionObjectiveLeader[];
  entries: AfterTaxDecisionEntry[];
  warnings: string[];
}

interface ComparableCandidate extends AfterTaxDecisionCandidate {
  tier: Exclude<AfterTaxDecisionTier, "unavailable">;
}

interface ObjectiveDefinition {
  objective: AfterTaxDecisionObjective;
  label: string;
  direction: ScenarioDecisionDirection;
  value: (candidate: AfterTaxDecisionCandidate) => number | null;
}

const OBJECTIVES: ObjectiveDefinition[] = [
  {
    objective: "after-tax-profit",
    label: "세후 손익",
    direction: "maximize",
    value: (candidate) => candidate.ledger.afterTaxProfitUnroundedManwon ?? null,
  },
  {
    objective: "after-tax-npv",
    label: "세후 NPV",
    direction: "maximize",
    value: (candidate) => candidate.ledger.npvUnroundedManwon ?? null,
  },
  {
    objective: "after-tax-irr",
    label: "세후 IRR",
    direction: "maximize",
    value: comparableIrr,
  },
  {
    objective: "required-equity",
    label: "필요 자기자본",
    direction: "minimize",
    value: (candidate) => candidate.requiredEquityManwon,
  },
  {
    objective: "max-exposure",
    label: "최대 자금노출",
    direction: "minimize",
    value: (candidate) => candidate.maxExposureManwon,
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

function comparableIrr(candidate: AfterTaxDecisionCandidate): number | null {
  return candidate.ledger.irrStatus === "calculated"
    ? candidate.ledger.irrUnroundedPct ?? null : null;
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function compareValues(
  left: number,
  right: number,
  direction: ScenarioDecisionDirection,
): "better" | "equal" | "worse" {
  const tolerance = Math.max(
    1e-6,
    Math.max(Math.abs(left), Math.abs(right)) * 1e-9,
  );
  if (Math.abs(left - right) <= tolerance) return "equal";
  if (direction === "maximize") return left > right ? "better" : "worse";
  return left < right ? "better" : "worse";
}

function dominates(
  candidate: ComparableCandidate,
  other: ComparableCandidate,
): boolean {
  let compared = 0;
  let strictlyBetter = false;
  for (const objective of OBJECTIVES) {
    const candidateValue = objective.value(candidate);
    const otherValue = objective.value(other);
    // Compare only matching availability masks; an unknown IRR proves no ordering.
    if (finite(candidateValue) !== finite(otherValue)) return false;
    if (!finite(candidateValue) || !finite(otherValue)) continue;
    compared += 1;
    // Tolerance applies only to strict gains, never to a disadvantage.
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

function buildFrontier(candidates: ComparableCandidate[]) {
  const dominatedBy = new Map<string, string[]>();
  for (const candidate of candidates) {
    dominatedBy.set(
      candidate.scenarioId,
      candidates
        .filter(
          (other) =>
            other.scenarioId !== candidate.scenarioId &&
            dominates(other, candidate),
        )
        .map((other) => other.scenarioId),
    );
  }
  return {
    dominatedBy,
    frontier: candidates.filter(
      (candidate) =>
        (dominatedBy.get(candidate.scenarioId)?.length ?? 0) === 0,
    ),
  };
}

function buildLeaders(
  frontier: ComparableCandidate[],
): AfterTaxDecisionObjectiveLeader[] {
  return OBJECTIVES.map((objective) => {
    const comparable = frontier
      .map((candidate) => ({
        scenarioId: candidate.scenarioId,
        value: objective.value(candidate),
      }))
      .filter(
        (item): item is { scenarioId: string; value: number } =>
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
    return {
      objective: objective.objective,
      label: objective.label,
      direction: objective.direction,
      scenarioIds: comparable
        .filter(
          (item) =>
            compareValues(item.value, bestValue, objective.direction) ===
            "equal",
        )
        .map((item) => item.scenarioId),
      bestValue,
    };
  });
}

function unavailableReason(candidate: AfterTaxDecisionCandidate): string {
  if (candidate.ledger.status === "stale") {
    return "세전 계산 기준이 변경되어 세무 전문가 재확인이 필요합니다.";
  }
  if (candidate.ledger.status === "incomplete") {
    return "미검토 세목이 있어 세후 비교에 포함하지 않습니다.";
  }
  if (candidate.ledger.status === "invalid") {
    return candidate.ledger.errors[0] ?? "세무 입력 계약이 유효하지 않습니다.";
  }
  return "완결된 세무 입력 계약이 없습니다.";
}

/**
 * Builds two isolated frontiers. Expert-confirmed ledgers can never be
 * dominated by, or selected alongside, an unconfirmed tax draft.
 */
export function buildAfterTaxDecisionSupport(input: {
  strategy: AfterTaxStrategy;
  preTaxDecisionSupport: ScenarioDecisionSupport;
  candidates: AfterTaxDecisionCandidate[];
}): AfterTaxDecisionSupport {
  const { candidates, preTaxDecisionSupport, strategy } = input;
  if (
    new Set(candidates.map((candidate) => candidate.scenarioId)).size !==
    candidates.length
  ) {
    throw new Error("세후 다목적 비교 후보 ID는 서로 달라야 합니다.");
  }

  const preTaxEntries = new Map(
    preTaxDecisionSupport.entries.map((entry) => [entry.scenarioId, entry]),
  );
  const reasonsById = new Map<string, string[]>();
  const tierById = new Map<string, AfterTaxDecisionTier>();
  const rankable: ComparableCandidate[] = [];

  for (const candidate of candidates) {
    const reasons: string[] = [];
    const preTaxEntry = preTaxEntries.get(candidate.scenarioId);
    if (!preTaxEntry) {
      reasons.push("세전 다목적 비교 기준이 없는 계획안입니다.");
    } else if (preTaxEntry.status === "ineligible") {
      reasons.push(...preTaxEntry.exclusionReasons);
    }
    if (candidate.ledger.strategy !== strategy) {
      reasons.push("세후 원장의 처분전략이 비교 전략과 다릅니다.");
    }

    const requiredMetrics = [
      candidate.requiredEquityManwon,
      candidate.maxExposureManwon,
      candidate.durationMonths,
      candidate.regulatoryScore,
    ];
    if (requiredMetrics.some((value) => !finite(value))) {
      reasons.push("필수 세후 비교 지표에 유효하지 않은 값이 있습니다.");
    }
    if (!finite(candidate.ledger.afterTaxProfitUnroundedManwon) || !finite(candidate.ledger.npvUnroundedManwon)) {
      reasons.push("반올림 전 세후 손익·NPV가 없거나 유효하지 않습니다. 현재 계산으로 원장을 다시 확인해야 합니다.");
    }
    if (
      finite(candidate.ledger.afterTaxProfitUnroundedManwon) &&
      candidate.ledger.afterTaxProfitUnroundedManwon < 0
    ) {
      reasons.push("전문가 세후 원장에서 손실입니다.");
    }

    let tier: AfterTaxDecisionTier = "unavailable";
    if (
      candidate.ledger.status === "expert-confirmed" &&
      candidate.ledger.decisionGrade
    ) {
      tier = "confirmed";
    } else if (candidate.ledger.status === "draft") {
      tier = "preliminary";
    } else {
      reasons.push(unavailableReason(candidate));
    }

    reasonsById.set(candidate.scenarioId, [...new Set(reasons)]);
    tierById.set(candidate.scenarioId, tier);
    if (tier !== "unavailable" && reasons.length === 0) {
      rankable.push({ ...candidate, tier });
    }
  }

  const confirmed = rankable.filter(
    (candidate) => candidate.tier === "confirmed",
  );
  const preliminary = rankable.filter(
    (candidate) => candidate.tier === "preliminary",
  );
  const confirmedComparison = buildFrontier(confirmed);
  const preliminaryComparison = buildFrontier(preliminary);
  const confirmedLeaders = buildLeaders(confirmedComparison.frontier);
  const preliminaryLeaders = buildLeaders(preliminaryComparison.frontier);

  const confirmedLeaderObjectives = new Map<
    string,
    AfterTaxDecisionObjective[]
  >();
  for (const leader of confirmedLeaders) {
    for (const scenarioId of leader.scenarioIds) {
      confirmedLeaderObjectives.set(scenarioId, [
        ...(confirmedLeaderObjectives.get(scenarioId) ?? []),
        leader.objective,
      ]);
    }
  }
  const preliminaryLeaderObjectives = new Map<
    string,
    AfterTaxDecisionObjective[]
  >();
  for (const leader of preliminaryLeaders) {
    for (const scenarioId of leader.scenarioIds) {
      preliminaryLeaderObjectives.set(scenarioId, [
        ...(preliminaryLeaderObjectives.get(scenarioId) ?? []),
        leader.objective,
      ]);
    }
  }

  return {
    modelVersion: AFTER_TAX_DECISION_MODEL_VERSION,
    method: "pareto-no-weights",
    strategy,
    confirmedEligibleScenarioCount: confirmed.length,
    preliminaryEligibleScenarioCount: preliminary.length,
    confirmedParetoScenarioIds: confirmedComparison.frontier.map(
      (candidate) => candidate.scenarioId,
    ),
    preliminaryParetoScenarioIds: preliminaryComparison.frontier.map(
      (candidate) => candidate.scenarioId,
    ),
    confirmedObjectiveLeaders: confirmedLeaders,
    preliminaryObjectiveLeaders: preliminaryLeaders,
    entries: candidates.map((candidate) => {
      const tier = tierById.get(candidate.scenarioId) ?? "unavailable";
      const reasons = reasonsById.get(candidate.scenarioId) ?? [];
      const dominatedByScenarioIds =
        tier === "confirmed"
          ? confirmedComparison.dominatedBy.get(candidate.scenarioId) ?? []
          : tier === "preliminary"
            ? preliminaryComparison.dominatedBy.get(candidate.scenarioId) ?? []
            : [];
      return {
        scenarioId: candidate.scenarioId,
        tier,
        status:
          tier === "unavailable"
            ? "not-ranked"
            : reasons.length > 0
              ? "ineligible"
              : dominatedByScenarioIds.length > 0
                ? "dominated"
                : "pareto",
        reasons,
        advisoryReasons: !finite(comparableIrr(candidate))
          ? ["세후 IRR이 미확정이므로 IRR이 확인된 후보와 지배 관계를 판정하지 않습니다."]
          : [],
        dominatedByScenarioIds,
        leaderObjectives:
          tier === "confirmed"
            ? confirmedLeaderObjectives.get(candidate.scenarioId) ?? []
            : tier === "preliminary"
              ? preliminaryLeaderObjectives.get(candidate.scenarioId) ?? []
              : [],
        metrics: {
          afterTaxProfitManwon: candidate.ledger.afterTaxProfitManwon,
          npvManwon: candidate.ledger.npvManwon,
          afterTaxProfitUnroundedManwon: candidate.ledger.afterTaxProfitUnroundedManwon,
          npvUnroundedManwon: candidate.ledger.npvUnroundedManwon,
          irrUnroundedPct: comparableIrr(candidate),
          irrPct:
            candidate.ledger.irrStatus === "calculated"
              ? candidate.ledger.irrPct
              : null,
        },
      };
    }),
    warnings: [
      "전문가 확인 세후 원장만 확정 Pareto 집합에 포함합니다.",
      "완결된 세무 초안은 별도 예비 집합에서만 비교하며 대표안이나 확정 후보를 변경하지 않습니다.",
      "세전 현금흐름 기준이 바뀐 세무 계약은 자동으로 stale 처리해 모든 세후 순위에서 제외합니다.",
      ...(candidates.some((candidate) => !finite(candidate.ledger.afterTaxProfitUnroundedManwon) || !finite(candidate.ledger.npvUnroundedManwon))
        ? ["정밀 세후 손익·NPV가 없거나 유효하지 않은 후보는 비교에서 제외합니다. 반올림 표시값으로 대체하지 않으며 현재 계산으로 원장을 다시 확인해야 합니다."]
        : []),
      ...(candidates.some((candidate) => !finite(comparableIrr(candidate)))
        ? ["세후 IRR이 미확정인 후보가 있습니다. IRR 확인 여부가 다른 후보 간 지배 관계는 판정하지 않으며 IRR 선두는 계산 가능한 후보만 비교합니다."]
        : []),
      ...(confirmed.length < 2
        ? ["전문가 확인 세후 원장이 2개 미만이어서 확정 후보 간 우열 비교는 제한적입니다."]
        : []),
    ],
  };
}
