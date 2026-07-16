import {
  generatePlanningRecommendations,
  type PlanningRecommendationEngineInput,
  type PlanningRecommendationSet,
  type RecommendationCandidateEvaluation,
} from "@/lib/planning/recommendation-engine";
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

function stableZone(zone: PlanningScenario["floorPrograms"][number]["zones"][number]) {
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
export function recommendationCandidateKey(scenario: PlanningScenario): string {
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

function enhanceMetadata(
  metadata: PlanningRecommendationMetadata,
  input: {
    scenario: PlanningScenario;
    rejectionSummary: RecommendationRejectionSummary;
    profitSelectionMode?: RecommendationProfitMode;
    alsoSelectedFor?: PlanningRecommendationObjective[];
  }
): PlanningRecommendationMetadata {
  return {
    ...metadata,
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
    profitSelectionMode?: RecommendationProfitMode;
  }
): PlanningScenario | null {
  if (!scenario?.recommendation) return scenario;
  return {
    ...scenario,
    recommendation: enhanceMetadata(scenario.recommendation, {
      scenario,
      rejectionSummary: input.rejectionSummary,
      profitSelectionMode: input.profitSelectionMode,
    }),
  };
}

export function analyzePlanningRecommendations(
  result: PlanningRecommendationSet
): PlanningRecommendationAnalysis {
  const rejectionSummary = summarizeRecommendationRejections(result.evaluations);
  const safe = enhancedScenario(result.architecturalFeasibility, {
    rejectionSummary,
  });
  const rawProfit = result.profitOptimal;
  const selectedProfitMode = rawProfit
    ? profitMode(rawProfit.economicsPreview.profitManwon)
    : null;
  const profit = enhancedScenario(rawProfit, {
    rejectionSummary,
    profitSelectionMode: selectedProfitMode ?? undefined,
  });
  const maximum = enhancedScenario(result.legalCeilingReference, {
    rejectionSummary,
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
          profitSelectionMode: selectedProfitMode ?? undefined,
          alsoSelectedFor: ["profit"],
        }
      ),
    };
  }

  return {
    ...result,
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
  return analyzePlanningRecommendations(generatePlanningRecommendations(input));
}
