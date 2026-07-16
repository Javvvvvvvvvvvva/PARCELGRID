import { describe, expect, it } from "vitest";
import {
  analyzePlanningRecommendations,
  generatePlanningRecommendationsV2,
  isLegalGeometryCandidate,
  legalGeometryFailureCodes,
  recommendationCandidateKey,
  summarizeRecommendationRejections,
} from "@/lib/planning/recommendation-analysis";
import { generatePlanningRecommendations } from "@/lib/planning/recommendation-engine";
import type { PlanningEconomicsAssumptions } from "@/lib/planning/types";

const ORIGIN: [number, number] = [127.025749, 37.650511];

function localRingToLngLat(points: Array<[number, number]>): [number, number][] {
  const lngScale = 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return points.map(([x, z]) => [
    ORIGIN[0] + x / lngScale,
    ORIGIN[1] - z / 111_000,
  ]);
}

const assumptions: PlanningEconomicsAssumptions = {
  version: "recommendation-analysis-v1",
  constructionCostPerSqmWon: 2_000_000,
  basementCostMultiplier: 1.25,
  softCostRatePct: 10,
  contingencyRatePct: 5,
  financingCostRatePct: 2,
  residentialSalePricePerSqmWon: 5_500_000,
  commercialSalePricePerSqmWon: 5_000_000,
  residentialRentPerSqmMonthWon: 25_000,
  retailRentPerSqmMonthWon: 50_000,
  officeRentPerSqmMonthWon: 40_000,
  vacancyRatePct: 5,
  capRatePct: 5,
};

function input(acquisitionCostManwon = 20_000) {
  const boundary = localRingToLngLat([
    [-20, 20],
    [20, 20],
    [20, -20],
    [-20, -20],
    [-20, 20],
  ]);
  return {
    projectId: "recommendation-analysis-project",
    generatedAt: "2026-07-16T00:00:00.000Z",
    assumptions,
    parcel: {
      lotAreaSqm: 1_600,
      maxFARPct: 200,
      maxBCRPct: 50,
      heightLimitM: 18,
      acquisitionCostManwon,
      demolitionCostManwon: 1_000,
      boundary,
      zoning: "제2종일반주거지역",
      roads: [
        {
          name: "테스트로",
          points: localRingToLngLat([
            [23, 30],
            [23, -30],
          ]),
        },
      ],
      setback: { road: 0.5, side: 0.5, rear: 0.5 },
    },
  };
}

describe("Stage 2 recommendation result analysis", () => {
  it("uses a stable physical-plan key that ignores scenario and zone IDs", () => {
    const result = generatePlanningRecommendations(input());
    const scenario = result.architecturalFeasibility;
    expect(scenario).not.toBeNull();
    if (!scenario) return;

    const copy = {
      ...scenario,
      id: "different-scenario-id",
      floorPrograms: scenario.floorPrograms.map((floor, floorIndex) => ({
        ...floor,
        id: `different-floor-${floorIndex}`,
        zones: floor.zones.map((zone, zoneIndex) => ({
          ...zone,
          id: `different-zone-${floorIndex}-${zoneIndex}`,
        })),
      })),
    };

    expect(recommendationCandidateKey(copy)).toBe(
      recommendationCandidateKey(scenario)
    );
  });

  it("consolidates one physical candidate selected by both ranking axes", () => {
    const raw = generatePlanningRecommendations(input());
    expect(raw.profitOptimal).not.toBeNull();
    if (!raw.profitOptimal) return;

    const forcedShared = analyzePlanningRecommendations(
      {
        ...raw,
        architecturalFeasibility: raw.profitOptimal,
      },
      input().parcel.maxFARPct
    );

    expect(forcedShared.sharedPrimaryCandidate).toBe(true);
    expect(forcedShared.combinedPrimary?.name).toBe("통합 추천안");
    expect(
      forcedShared.combinedPrimary?.recommendation?.alsoSelectedFor
    ).toContain("profit");
    expect(forcedShared.combinedPrimary?.recommendation?.candidateKey).toBe(
      recommendationCandidateKey(raw.profitOptimal)
    );
  });

  it("labels the best negative result as loss minimization instead of profit", () => {
    const result = generatePlanningRecommendationsV2(input(2_000_000));

    expect(result.eligibleCandidates).toBeGreaterThan(0);
    expect(result.profitOptimal).not.toBeNull();
    expect(result.profitOptimal?.economicsPreview.profitManwon).toBeLessThan(0);
    expect(result.profitMode).toBe("loss-minimization");
    expect(
      result.profitOptimal?.recommendation?.profitSelectionMode
    ).toBe("loss-minimization");
  });

  it("counts rejected candidates by transparent, possibly overlapping causes", () => {
    const raw = generatePlanningRecommendations(input());
    const summary = summarizeRecommendationRejections(raw.evaluations);

    expect(summary.rejectedCandidates).toBe(
      raw.evaluatedCandidates - raw.eligibleCandidates
    );
    expect(summary.reasons.length).toBeGreaterThan(0);
    expect(summary.reasons.every((reason) => reason.count > 0)).toBe(true);
    expect(summary.multipleReasonsPossible).toBe(true);

    const analyzed = analyzePlanningRecommendations(
      raw,
      input().parcel.maxFARPct
    );
    expect(
      analyzed.architecturalFeasibility?.recommendation?.rejectedCandidates
    ).toBe(summary.rejectedCandidates);
    expect(
      analyzed.architecturalFeasibility?.recommendation?.rejectionReasons
        ?.length
    ).toBe(summary.reasons.length);
  });

  it("never exposes a floor-envelope failure as the 3D legal ceiling reference", () => {
    const raw = generatePlanningRecommendations(input());
    const result = analyzePlanningRecommendations(
      raw,
      input().parcel.maxFARPct
    );
    const legal = result.legalCeilingReference;

    expect(legal).not.toBeNull();
    expect(result.legalGeometryCandidateCount).toBeGreaterThan(0);
    expect(result.arithmeticLegalFarCapPct).toBe(200);
    expect(legal?.name).toBe("배치 가능 상한 참고안");
    expect(legal?.recommendation?.engineVersion).toContain("legal-geometry-v2");
    expect(legal?.recommendation?.reasons.join(" ")).toContain(
      "배치 가능 실현 용적률"
    );

    const selectedEvaluation = raw.evaluations.find(
      (candidate) =>
        legal != null &&
        recommendationCandidateKey(candidate.scenario) ===
          recommendationCandidateKey(legal)
    );
    expect(selectedEvaluation).toBeDefined();
    if (!selectedEvaluation) return;

    expect(isLegalGeometryCandidate(selectedEvaluation)).toBe(true);
    expect(legalGeometryFailureCodes(selectedEvaluation)).toEqual([]);
    expect(
      selectedEvaluation.calculation.checks.some(
        (check) =>
          check.status === "fail" &&
          [
            "bcr",
            "far",
            "height",
            "floor-area-vs-lot",
            "spatial-area-capacity",
            "spatial-placement",
            "spatial-floor-support",
            "floor-levels",
          ].includes(check.code)
      )
    ).toBe(false);
  });

  it("uses the highest realized FAR only among geometry-valid candidates", () => {
    const raw = generatePlanningRecommendations(input());
    const result = generatePlanningRecommendationsV2(input());
    const valid = raw.evaluations.filter(isLegalGeometryCandidate);
    const expectedFar = Math.max(
      ...valid.map(
        (candidate) => candidate.calculation.metrics.preliminaryFarPct
      )
    );

    const selected = raw.evaluations.find(
      (candidate) =>
        result.legalCeilingReference != null &&
        recommendationCandidateKey(candidate.scenario) ===
          recommendationCandidateKey(result.legalCeilingReference)
    );

    expect(selected).toBeDefined();
    expect(selected?.calculation.metrics.preliminaryFarPct).toBeCloseTo(
      expectedFar,
      6
    );
    expect(
      result.legalCeilingReference?.recommendation?.warnings.join(" ")
    ).toContain("산술 법정 상한 자체가 아니라");
  });
});
