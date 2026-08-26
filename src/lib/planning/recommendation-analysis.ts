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
  /** 층별 외곽선·배치·층간 연결을 통과해 3D 상한 비교가 가능한 후보 수. */
  legalGeometryCandidateCount: number;
  /** 입력된 산술 법정 용적률 상한. 3D 실현 용적률과 구분한다. */
  arithmeticLegalFarCapPct: number | null;
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

/**
 * 법적 상한 3D 후보를 차단하는 물리·법규 항목.
 * 주차는 별도 실현 제약이므로 상한 비교안 생성 자체는 허용하되 경고한다.
 */
const LEGAL_GEOMETRY_BLOCKING_CODES = new Set([
  "bcr",
  "far",
  "height",
  "floor-area-vs-lot",
  "spatial-area-capacity",
  "spatial-placement",
  "spatial-floor-support",
  "floor-levels",
]);

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface AcquisitionCapacity {
  /** Stage 2 가정에서 손익 0이 되는 최대 토지 매입가(만원). */
  breakEvenAcquisitionCostManwon: number;
  /** 양수면 추가 매입 여력, 음수면 현재 매입가 초과분(만원). */
  acquisitionHeadroomManwon: number;
}

/**
 * 토지비만 변동한다고 가정한 Stage 2 손익분기 매입가.
 * 금융·세금·공정까지 반영한 최종 매입 한도는 Stage 3에서 다시 계산한다.
 */
export function calculateAcquisitionCapacity(
  preview: PlanningScenario["economicsPreview"]
): AcquisitionCapacity {
  const breakEvenAcquisitionCostManwon = Math.max(
    0,
    preview.expectedRevenueManwon -
      (preview.totalCostManwon - preview.acquisitionCostManwon)
  );
  return {
    breakEvenAcquisitionCostManwon: round(breakEvenAcquisitionCostManwon),
    acquisitionHeadroomManwon: round(
      breakEvenAcquisitionCostManwon - preview.acquisitionCostManwon
    ),
  };
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

export function recommendationsSharePhysicalPlan(
  architecturalFeasibility: PlanningScenario | null,
  profitOptimal: PlanningScenario | null
): boolean {
  return Boolean(
    architecturalFeasibility &&
      profitOptimal &&
      recommendationCandidateKey(architecturalFeasibility) ===
        recommendationCandidateKey(profitOptimal)
  );
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

export function legalGeometryFailureCodes(
  candidate: RecommendationCandidateEvaluation
): string[] {
  return candidate.calculation.checks
    .filter(
      (check) =>
        check.status === "fail" && LEGAL_GEOMETRY_BLOCKING_CODES.has(check.code)
    )
    .map((check) => check.code);
}

/**
 * 산술 FAR이 높다는 이유만으로 3D 상한안이 되지 않게 한다.
 * 각 층 프로그램이 법규 외곽선 안에 있고, 이동·회전 배치와 층간 연결까지
 * 통과한 후보만 3D로 열 수 있는 법적 상한 비교안 후보가 된다.
 */
export function isLegalGeometryCandidate(
  candidate: RecommendationCandidateEvaluation
): boolean {
  return (
    candidate.calculation.metrics.aboveGroundFloors > 0 &&
    legalGeometryFailureCodes(candidate).length === 0
  );
}

function inferLegalFarCapPct(
  candidate: RecommendationCandidateEvaluation,
  explicitCapPct?: number
): number | null {
  if (explicitCapPct != null && Number.isFinite(explicitCapPct) && explicitCapPct > 0) {
    return explicitCapPct;
  }
  if (candidate.farUtilizationPct <= 0) return null;
  return (
    candidate.calculation.metrics.preliminaryFarPct /
    (candidate.farUtilizationPct / 100)
  );
}

function buildableLegalReference(
  result: PlanningRecommendationSet,
  rejectionSummary: RecommendationRejectionSummary,
  legalFarCapPct?: number
): {
  scenario: PlanningScenario | null;
  candidateCount: number;
} {
  const candidates = result.evaluations.filter(isLegalGeometryCandidate);
  const maximumFarPct = candidates.reduce(
    (maximum, candidate) =>
      Math.max(maximum, candidate.calculation.metrics.preliminaryFarPct),
    0
  );
  const inferredCapPct =
    candidates.length > 0
      ? inferLegalFarCapPct(candidates[0], legalFarCapPct)
      : null;
  // 법정 FAR 2% 이내의 사실상 동률 후보는 작은 상층을 하나 더 얹는 대신
  // 층판 균형과 단순한 매스를 우선한다. 예: 250% 상한이면 5%p 범위.
  const nearMaximumTolerancePct = Math.max(
    1,
    (inferredCapPct ?? maximumFarPct) * 0.02
  );
  const floorShape = (candidate: RecommendationCandidateEvaluation) => {
    const areas = candidate.scenario.floorPrograms
      .filter((floor) => floor.level > 0)
      .map((floor) =>
        floor.zones.reduce(
          (sum, zone) => sum + Math.max(0, zone.areaSqm),
          0
        )
      )
      .filter((area) => area > 0);
    const maximum = Math.max(0, ...areas);
    const minimum = areas.length > 0 ? Math.min(...areas) : 0;
    return {
      balance: maximum > 0 ? minimum / maximum : 0,
      floors: areas.length,
      surface: candidate.scenario.parking.strategy === "surface" ? 1 : 0,
    };
  };
  const nearMaximum = candidates
    .filter(
      (candidate) =>
        maximumFarPct - candidate.calculation.metrics.preliminaryFarPct <=
        nearMaximumTolerancePct + 1e-6
    )
    .sort((a, b) => {
      const aShape = floorShape(a);
      const bShape = floorShape(b);
      return (
        bShape.balance - aShape.balance ||
        bShape.surface - aShape.surface ||
        aShape.floors - bShape.floors ||
        b.calculation.metrics.preliminaryFarPct -
          a.calculation.metrics.preliminaryFarPct ||
        b.calculation.metrics.preliminaryBcrPct -
          a.calculation.metrics.preliminaryBcrPct ||
        b.architectureScore - a.architectureScore
      );
    });
  const selected = nearMaximum[0];
  if (!selected) return { scenario: null, candidateCount: 0 };

  const realizedFarPct = selected.calculation.metrics.preliminaryFarPct;
  const realizedBcrPct = selected.calculation.metrics.preliminaryBcrPct;
  const capPct = inferLegalFarCapPct(selected, legalFarCapPct);
  const maximumFarGapPct = Math.max(0, maximumFarPct - realizedFarPct);
  const parkingShortfall = Math.max(
    selected.calculation.parking.shortfallCars,
    selected.parkingLayout.shortfallCars
  );
  const reviewCount = selected.calculation.checks.filter(
    (check) => check.status === "review" || check.status === "unknown"
  ).length;
  const warnings = [
    "산술 법정 상한 자체가 아니라 층별 법규 외곽선·배치·층간 연결을 통과한 상위 실현 용적률 후보 중 층판이 안정적인 비교안입니다.",
  ];
  if (maximumFarGapPct > 0.05) {
    warnings.push(
      `지나치게 작은 상층을 피하기 위해 최고 실현 용적률 ${maximumFarPct.toFixed(
        1
      )}%보다 ${maximumFarGapPct.toFixed(1)}%p 낮은 균형형 매스를 선택했습니다.`
    );
  }
  if (parkingShortfall > 0) {
    warnings.push(
      `법정·실제 배치 기준 주차가 ${parkingShortfall}대 부족합니다. 주차 해결 전에는 대표안으로 확정할 수 없습니다.`
    );
  }
  if (!selected.parkingLayout.supportedStrategy) {
    warnings.push("선택된 주차 전략의 실제 주차면·통로 배치를 생성하지 못했습니다.");
  }
  if (reviewCount > 0) {
    warnings.push(`확인 필요 또는 미확인 항목이 ${reviewCount}건 있습니다.`);
  }

  const reasons = [
    `배치 가능 실현 용적률 ${realizedFarPct.toFixed(1)}%`,
    ...(capPct != null
      ? [
          `산술 법정 용적률 ${capPct.toFixed(1)}% 대비 ${(
            (realizedFarPct / capPct) *
            100
          ).toFixed(1)}% 실현`,
        ]
      : []),
    `실현 건폐율 ${realizedBcrPct.toFixed(1)}%`,
    `층판 균형도 ${(floorShape(selected).balance * 100).toFixed(1)}%`,
    "층별 법규 외곽선·이동·회전·층간 연결 통과",
    `주차 ${selected.calculation.parking.providedCars}/${selected.calculation.parking.requiredCars}대`,
  ];

  const scenario: PlanningScenario = {
    ...selected.scenario,
    id: `${selected.scenario.id}-legal-buildable`,
    name: "배치 가능 상한 참고안",
    description:
      "법규 외곽선과 실제 배치·층간 연결을 통과한 최고 실현 용적률 2% 범위 안에서, 지나치게 작은 상층과 불필요한 층수를 피한 3D 비교안입니다. 산술 법정 용적률 상한과는 구분하며 주차는 별도 제약으로 남을 수 있습니다.",
    origin: "algorithm-max",
    status: "saved",
    recommendation: enhanceMetadata(
      {
        engineVersion: `${result.engineVersion}-legal-geometry-v3-balanced-plates`,
        objective: "legal-ceiling",
        generatedAt: result.generatedAt,
        evaluatedCandidates: result.evaluatedCandidates,
        eligibleCandidates: result.eligibleCandidates,
        architectureScore: selected.architectureScore,
        eligible: selected.eligible,
        reasons,
        warnings,
      },
      {
        scenario: selected.scenario,
        rejectionSummary,
      }
    ),
  };

  return { scenario, candidateCount: candidates.length };
}

export function analyzePlanningRecommendations(
  result: PlanningRecommendationSet,
  legalFarCapPct?: number
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
  const legalReference = buildableLegalReference(
    result,
    rejectionSummary,
    legalFarCapPct
  );
  const sharedPrimaryCandidate = Boolean(
    recommendationsSharePhysicalPlan(safe, profit)
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

  const warnings = [...result.warnings];
  if (!legalReference.scenario) {
    warnings.push(
      "층별 법규 외곽선·배치·층간 연결을 통과하는 상한 비교 후보가 없어 3D 법적 상한안을 생성하지 않았습니다. 산술 법정 상한은 필지 지표에서만 확인하세요."
    );
  }

  return {
    ...result,
    warnings,
    architecturalFeasibility: safe,
    profitOptimal: profit,
    legalCeilingReference: legalReference.scenario,
    sharedPrimaryCandidate,
    profitMode: selectedProfitMode,
    combinedPrimary,
    rejectionSummary,
    legalGeometryCandidateCount: legalReference.candidateCount,
    arithmeticLegalFarCapPct:
      legalFarCapPct != null && Number.isFinite(legalFarCapPct)
        ? legalFarCapPct
        : null,
  };
}

export function generatePlanningRecommendationsV2(
  input: PlanningRecommendationEngineInput
): PlanningRecommendationAnalysis {
  return analyzePlanningRecommendations(
    generatePlanningRecommendations(input),
    input.parcel.maxFARPct
  );
}
