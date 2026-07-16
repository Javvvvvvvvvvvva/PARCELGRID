import {
  generatePlanningRecommendations,
  PLANNING_RECOMMENDATION_ENGINE_VERSION,
  type PlanningRecommendationEngineInput,
  type PlanningRecommendationSet,
  type RecommendationCandidateEvaluation,
} from "@/lib/planning/recommendation-engine";
import {
  generateSteppedMaximumEvaluations,
  isSteppedMaximumEvaluation,
  STEPPED_MAXIMUM_ENGINE_VERSION,
} from "@/lib/planning/stepped-maximum-candidate";
import type {
  PlanningRecommendationMetadata,
  PlanningRecommendationObjective,
  PlanningScenario,
} from "@/lib/planning/types";

export type RecommendationProfitMode =
  | "profit-maximization"
  | "loss-minimization"
  | "break-even";

export interface RecommendationRejectionReason {
  code: string;
  label: string;
  count: number;
}

export interface RecommendationRejectionSummary {
  rejectedCandidates: number;
  reasons: RecommendationRejectionReason[];
  multipleReasonsPossible: true;
}

export interface PlanningRecommendationAnalysis extends PlanningRecommendationSet {
  sharedPrimaryCandidate: boolean;
  profitMode: RecommendationProfitMode | null;
  combinedPrimary: PlanningScenario | null;
  rejectionSummary: RecommendationRejectionSummary;
}

const ENGINE_VERSION = `${PLANNING_RECOMMENDATION_ENGINE_VERSION}+${STEPPED_MAXIMUM_ENGINE_VERSION}`;
const GEOMETRY_REFERENCE_ALLOWED_FAIL_CODES = new Set(["parking"]);

const FAIL_REASON_LABELS: Record<string, string> = {
  bcr: "건폐율 초과",
  far: "용적률 초과",
  height: "높이 한도 초과",
  parking: "법정 주차 미충족",
  "floor-area-vs-lot": "층 면적이 대지면적 초과",
  "spatial-area-capacity": "층별 법규 외곽선 초과",
  "spatial-placement": "이동·회전 후 배치 외곽선 이탈",
  "spatial-floor-support": "층간 구조 연결 부족",
  "floor-levels": "층 레벨 중복",
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableZone(
  zone: PlanningScenario["floorPrograms"][number]["zones"][number]
) {
  return {
    useType: zone.useType,
    label: zone.label ?? "",
    areaSqm: round(zone.areaSqm, 3),
    unitCount: zone.unitCount,
    revenueModel: zone.revenueModel ?? "",
    saleableAreaSqm:
      zone.saleableAreaSqm == null ? null : round(zone.saleableAreaSqm, 3),
    rentableAreaSqm:
      zone.rentableAreaSqm == null ? null : round(zone.rentableAreaSqm, 3),
  };
}

/**
 * 추천 슬롯별로 새 ID가 붙어도 물리·프로그램 계획이 같은 후보인지 판정한다.
 */
export function recommendationCandidateKey(
  scenario: PlanningScenario
): string {
  return JSON.stringify({
    primaryUse: scenario.primaryUse,
    floors: [...scenario.floorPrograms]
      .sort((a, b) => a.level - b.level)
      .map((floor) => ({
        level: floor.level,
        floorHeightM: round(floor.floorHeightM, 3),
        footprintScalePct: round(floor.footprintScalePct, 3),
        northSetbackM: round(floor.northSetbackM, 3),
        zones: floor.zones.map(stableZone),
      })),
    placement: {
      rotationDeg: round(scenario.placement.rotationDeg, 3),
      offsetXM: round(scenario.placement.offsetXM, 3),
      offsetZM: round(scenario.placement.offsetZM, 3),
      roadSetbackM: round(scenario.placement.roadSetbackM, 3),
      northSetbackM: round(scenario.placement.northSetbackM, 3),
    },
    parking: {
      strategy: scenario.parking.strategy,
      providedCars: scenario.parking.providedCars,
      orientation: scenario.parking.orientation ?? "auto",
      stallWidthM: scenario.parking.stallWidthM ?? null,
      stallDepthM: scenario.parking.stallDepthM ?? null,
      aisleWidthM: scenario.parking.aisleWidthM ?? null,
      entryWidthM: scenario.parking.entryWidthM ?? null,
      coreAreaSqm: scenario.parking.coreAreaSqm ?? null,
      columnLossPct: scenario.parking.columnLossPct ?? null,
    },
  });
}

function candidateRejectionReasons(
  candidate: RecommendationCandidateEvaluation
): Map<string, string> {
  const reasons = new Map<string, string>();

  for (const check of candidate.calculation.checks) {
    if (check.status !== "fail") continue;
    reasons.set(
      check.code,
      FAIL_REASON_LABELS[check.code] ?? `${check.label} 미충족`
    );
  }

  if (!candidate.parkingLayout.supportedStrategy) {
    reasons.set("parking-layout", "주차면·통로 실제 배치 불가");
  } else if (
    candidate.parkingLayout.shortfallCars > 0 ||
    candidate.calculation.parking.shortfallCars > 0
  ) {
    reasons.set("parking-shortfall", "실제 배치 가능한 주차대수 부족");
  }

  if (reasons.size === 0 && !candidate.eligible) {
    reasons.set("other", "기타 실행 가능 조건 미충족");
  }
  return reasons;
}

export function summarizeRecommendationRejections(
  evaluations: RecommendationCandidateEvaluation[]
): RecommendationRejectionSummary {
  const rejected = evaluations.filter((candidate) => !candidate.eligible);
  const counts = new Map<string, { label: string; count: number }>();

  for (const candidate of rejected) {
    for (const [code, label] of candidateRejectionReasons(candidate)) {
      const current = counts.get(code);
      counts.set(code, { label, count: (current?.count ?? 0) + 1 });
    }
  }

  return {
    rejectedCandidates: rejected.length,
    reasons: [...counts.entries()]
      .map(([code, value]) => ({ code, ...value }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    multipleReasonsPossible: true,
  };
}

function profitMode(profitManwon: number): RecommendationProfitMode {
  if (profitManwon < 0) return "loss-minimization";
  if (profitManwon > 0) return "profit-maximization";
  return "break-even";
}

function rawMetadata(input: {
  objective: PlanningRecommendationObjective;
  generatedAt: string;
  evaluatedCandidates: number;
  eligibleCandidates: number;
  evaluation: RecommendationCandidateEvaluation;
  reasons: string[];
  warnings?: string[];
}): PlanningRecommendationMetadata {
  return {
    engineVersion: ENGINE_VERSION,
    objective: input.objective,
    generatedAt: input.generatedAt,
    evaluatedCandidates: input.evaluatedCandidates,
    eligibleCandidates: input.eligibleCandidates,
    architectureScore: input.evaluation.architectureScore,
    eligible: input.evaluation.eligible,
    reasons: input.reasons,
    warnings: input.warnings ?? [],
  };
}

function recommendationFromEvaluation(
  evaluation: RecommendationCandidateEvaluation,
  input: {
    slot: "safe" | "profit" | "max";
    origin: PlanningScenario["origin"];
    name: string;
    description: string;
    recommendation: PlanningRecommendationMetadata;
  }
): PlanningScenario {
  return {
    ...evaluation.scenario,
    id: `${evaluation.scenario.id}-${input.slot}`,
    name: input.name,
    description: input.description,
    origin: input.origin,
    status: "saved",
    recommendation: input.recommendation,
  };
}

function enhanceMetadata(
  metadata: PlanningRecommendationMetadata,
  input: {
    scenario: PlanningScenario;
    rejectionSummary: RecommendationRejectionSummary;
    evaluatedCandidates: number;
    eligibleCandidates: number;
    profitSelectionMode?: RecommendationProfitMode;
    alsoSelectedFor?: PlanningRecommendationObjective[];
  }
): PlanningRecommendationMetadata {
  return {
    ...metadata,
    engineVersion: ENGINE_VERSION,
    evaluatedCandidates: input.evaluatedCandidates,
    eligibleCandidates: input.eligibleCandidates,
    candidateKey: recommendationCandidateKey(input.scenario),
    profitSelectionMode: input.profitSelectionMode,
    alsoSelectedFor: input.alsoSelectedFor,
    rejectedCandidates: input.rejectionSummary.rejectedCandidates,
    rejectionReasons: input.rejectionSummary.reasons,
  };
}

function enhancedScenario(
  scenario: PlanningScenario | null,
  input: {
    rejectionSummary: RecommendationRejectionSummary;
    evaluatedCandidates: number;
    eligibleCandidates: number;
    profitSelectionMode?: RecommendationProfitMode;
  }
): PlanningScenario | null {
  if (!scenario?.recommendation) return scenario;
  return {
    ...scenario,
    recommendation: enhanceMetadata(scenario.recommendation, {
      scenario,
      rejectionSummary: input.rejectionSummary,
      evaluatedCandidates: input.evaluatedCandidates,
      eligibleCandidates: input.eligibleCandidates,
      profitSelectionMode: input.profitSelectionMode,
    }),
  };
}

export function isGeometryValidMaximumCandidate(
  candidate: RecommendationCandidateEvaluation
): boolean {
  return candidate.calculation.checks
    .filter((check) => check.status === "fail")
    .every((check) => GEOMETRY_REFERENCE_ALLOWED_FAIL_CODES.has(check.code));
}

export function selectMaximumReferenceEvaluation(
  evaluations: RecommendationCandidateEvaluation[]
): RecommendationCandidateEvaluation | null {
  return (
    [...evaluations]
      .filter(isGeometryValidMaximumCandidate)
      .sort(
        (a, b) =>
          b.calculation.metrics.preliminaryFarPct -
            a.calculation.metrics.preliminaryFarPct ||
          b.calculation.metrics.preliminaryBcrPct -
            a.calculation.metrics.preliminaryBcrPct ||
          Number(isSteppedMaximumEvaluation(b)) -
            Number(isSteppedMaximumEvaluation(a)) ||
          b.architectureScore - a.architectureScore
      )[0] ?? null
  );
}

function maximumReferenceScenario(input: {
  evaluation: RecommendationCandidateEvaluation;
  generatedAt: string;
  evaluatedCandidates: number;
  eligibleCandidates: number;
}): PlanningScenario {
  const evaluation = input.evaluation;
  const floorAreas = evaluation.scenario.floorPrograms
    .filter((floor) => floor.level > 0)
    .sort((a, b) => a.level - b.level)
    .map((floor) => ({
      level: floor.level,
      areaSqm: floor.zones.reduce(
        (sum, zone) => sum + Math.max(0, zone.areaSqm),
        0
      ),
    }));
  const parkingShortfall = Math.max(
    evaluation.calculation.parking.shortfallCars,
    evaluation.parkingLayout.shortfallCars
  );
  const stepped = isSteppedMaximumEvaluation(evaluation);

  return recommendationFromEvaluation(evaluation, {
    slot: "max",
    origin: "algorithm-max",
    name: "배치 가능 상한 참고안",
    description:
      "산술 법정 용적률 자체가 아니라 층별 법규 외곽선·실제 배치·층간 연결을 통과한 후보 중 실현 용적률이 가장 높은 비교안입니다.",
    recommendation: rawMetadata({
      objective: "legal-ceiling",
      generatedAt: input.generatedAt,
      evaluatedCandidates: input.evaluatedCandidates,
      eligibleCandidates: input.eligibleCandidates,
      evaluation,
      reasons: [
        `실현 용적률 ${evaluation.calculation.metrics.preliminaryFarPct.toFixed(1)}%`,
        `법정 용적률의 ${evaluation.farUtilizationPct.toFixed(1)}% 사용`,
        stepped
          ? "층별 법규 외곽선 면적을 직접 반영한 stepped 후보"
          : "기존 후보 중 층별 외곽선·배치·층간 연결 통과",
        `층별 프로그램 ${floorAreas
          .map((floor) => `${floor.level}층 ${floor.areaSqm.toFixed(1)}㎡`)
          .join(" · ")}`,
        parkingShortfall > 0
          ? `주차 ${parkingShortfall}대 부족 · 대표안 확정 전 해결 필요`
          : `주차 ${evaluation.parkingLayout.capacityCars}/${evaluation.calculation.parking.requiredCars}대`,
      ],
      warnings: [
        "배치 가능한 상한 비교 기준이며 수익 또는 건축 타당성 추천안은 아닙니다.",
        ...(parkingShortfall > 0
          ? [
              "건축 매스는 배치 가능하지만 법정 주차가 부족합니다. 주차 전략을 해결하기 전에는 대표안으로 확정할 수 없습니다.",
            ]
          : []),
      ],
    }),
  });
}

export function analyzePlanningRecommendations(
  result: PlanningRecommendationSet
): PlanningRecommendationAnalysis {
  const rejectionSummary = summarizeRecommendationRejections(result.evaluations);
  const safe = enhancedScenario(result.architecturalFeasibility, {
    rejectionSummary,
    evaluatedCandidates: result.evaluatedCandidates,
    eligibleCandidates: result.eligibleCandidates,
  });
  const rawProfit = result.profitOptimal;
  const selectedProfitMode = rawProfit
    ? profitMode(rawProfit.economicsPreview.profitManwon)
    : null;
  const profit = enhancedScenario(rawProfit, {
    rejectionSummary,
    evaluatedCandidates: result.evaluatedCandidates,
    eligibleCandidates: result.eligibleCandidates,
    profitSelectionMode: selectedProfitMode ?? undefined,
  });
  const maximum = enhancedScenario(result.legalCeilingReference, {
    rejectionSummary,
    evaluatedCandidates: result.evaluatedCandidates,
    eligibleCandidates: result.eligibleCandidates,
  });
  const sharedPrimaryCandidate = Boolean(
    safe &&
      profit &&
      recommendationCandidateKey(safe) === recommendationCandidateKey(profit)
  );

  let combinedPrimary: PlanningScenario | null = null;
  if (sharedPrimaryCandidate && safe?.recommendation && profit?.recommendation) {
    const lossMode = selectedProfitMode === "loss-minimization";
    const combinedReasons = [
      ...safe.recommendation.reasons,
      ...profit.recommendation.reasons,
    ].filter((reason, index, all) => all.indexOf(reason) === index);
    combinedPrimary = {
      ...safe,
      name: "통합 추천안",
      description: lossMode
        ? "건축 타당성 1위이면서 실행 가능 후보 중 예상 손실이 가장 작은 동일 계획안입니다."
        : "건축 타당성 1위이면서 실행 가능 후보 중 개략 이익이 가장 높은 동일 계획안입니다.",
      recommendation: enhanceMetadata(
        {
          ...safe.recommendation,
          reasons: combinedReasons,
          warnings: [
            ...safe.recommendation.warnings,
            ...profit.recommendation.warnings,
          ].filter((warning, index, all) => all.indexOf(warning) === index),
        },
        {
          scenario: safe,
          rejectionSummary,
          evaluatedCandidates: result.evaluatedCandidates,
          eligibleCandidates: result.eligibleCandidates,
          profitSelectionMode: selectedProfitMode ?? undefined,
          alsoSelectedFor: ["profit"],
        }
      ),
    };
  }

  return {
    ...result,
    engineVersion: ENGINE_VERSION,
    architecturalFeasibility: safe,
    profitOptimal: profit,
    legalCeilingReference: maximum,
    sharedPrimaryCandidate,
    profitMode: selectedProfitMode,
    combinedPrimary,
    rejectionSummary,
  };
}

export function generatePlanningRecommendationsV2(
  input: PlanningRecommendationEngineInput
): PlanningRecommendationAnalysis {
  const raw = generatePlanningRecommendations(input);
  const steppedEvaluations = generateSteppedMaximumEvaluations(input);
  const evaluations = [...raw.evaluations, ...steppedEvaluations];
  const eligible = evaluations.filter((candidate) => candidate.eligible);
  const safeEvaluation = [...eligible].sort(
    (a, b) =>
      b.architectureScore - a.architectureScore ||
      b.calculation.economicsPreview.profitManwon -
        a.calculation.economicsPreview.profitManwon
  )[0];
  const profitEvaluation = [...eligible].sort(
    (a, b) =>
      b.calculation.economicsPreview.profitManwon -
        a.calculation.economicsPreview.profitManwon ||
      b.calculation.economicsPreview.profitMarginPct -
        a.calculation.economicsPreview.profitMarginPct ||
      b.architectureScore - a.architectureScore
  )[0];
  const maximumEvaluation = selectMaximumReferenceEvaluation(evaluations);
  const evaluatedCandidates = evaluations.length;
  const eligibleCandidates = eligible.length;
  const generatedAt = raw.generatedAt;

  const architecturalFeasibility = safeEvaluation
    ? recommendationFromEvaluation(safeEvaluation, {
        slot: "safe",
        origin: "algorithm-safe",
        name: "건축 타당성안",
        description:
          "법규 외곽선·배치·층간 연결·실제 주차 배치를 통과한 후보 중 건축 여유와 단순성이 가장 높은 안입니다.",
        recommendation: rawMetadata({
          objective: "architectural-feasibility",
          generatedAt,
          evaluatedCandidates,
          eligibleCandidates,
          evaluation: safeEvaluation,
          reasons: [
            `건축 타당성 ${safeEvaluation.architectureScore.toFixed(1)}점`,
            `법규·배치 필수 미충족 ${safeEvaluation.failCount}건`,
            `주차 ${safeEvaluation.parkingLayout.capacityCars}/${safeEvaluation.calculation.parking.requiredCars}대`,
            `법정 용적률의 ${safeEvaluation.farUtilizationPct.toFixed(1)}% 사용`,
          ],
        }),
      })
    : null;
  const profitOptimal = profitEvaluation
    ? recommendationFromEvaluation(profitEvaluation, {
        slot: "profit",
        origin: "algorithm-balanced",
        name: "수익 최적안",
        description:
          "법규 외곽선과 실제 주차 배치를 통과한 후보만 대상으로 Stage 2 개략 이익이 가장 높은 안을 선택했습니다.",
        recommendation: rawMetadata({
          objective: "profit",
          generatedAt,
          evaluatedCandidates,
          eligibleCandidates,
          evaluation: profitEvaluation,
          reasons: [
            `실행 가능 후보 ${eligibleCandidates}개 중 개략 이익 최대`,
            `개략 이익 ${round(
              profitEvaluation.calculation.economicsPreview.profitManwon,
              0
            ).toLocaleString()}만원`,
            `이익률 ${profitEvaluation.calculation.economicsPreview.profitMarginPct.toFixed(1)}%`,
            `건축 타당성 ${profitEvaluation.architectureScore.toFixed(1)}점`,
          ],
        }),
      })
    : null;
  const legalCeilingReference = maximumEvaluation
    ? maximumReferenceScenario({
        evaluation: maximumEvaluation,
        generatedAt,
        evaluatedCandidates,
        eligibleCandidates,
      })
    : null;
  const warnings = [...raw.warnings];
  if (steppedEvaluations.length === 0) {
    warnings.push(
      "층별 법규 외곽선 기반 상한 후보를 생성하지 못했습니다. 대지 경계·도로·이격 데이터를 확인하세요."
    );
  }
  if (!maximumEvaluation) {
    warnings.push(
      "층별 법규 외곽선·배치·층간 연결을 통과하는 상한 참고 후보가 없습니다. 산술 법정 상한만 지표로 확인하세요."
    );
  }

  return analyzePlanningRecommendations({
    ...raw,
    engineVersion: ENGINE_VERSION,
    evaluatedCandidates,
    eligibleCandidates,
    architecturalFeasibility,
    profitOptimal,
    legalCeilingReference,
    warnings,
    evaluations,
  });
}
