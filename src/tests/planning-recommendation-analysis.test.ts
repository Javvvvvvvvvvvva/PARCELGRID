import { describe, expect, it } from "vitest";
import {
  analyzePlanningRecommendations,
  generatePlanningRecommendationsV2,
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

    const forcedShared = analyzePlanningRecommendations({
      ...raw,
      architecturalFeasibility: raw.profitOptimal,
    });

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

    const analyzed = analyzePlanningRecommendations(raw);
    expect(
      analyzed.architecturalFeasibility?.recommendation?.rejectedCandidates
    ).toBe(summary.rejectedCandidates);
    expect(
      analyzed.architecturalFeasibility?.recommendation?.rejectionReasons
        ?.length
    ).toBe(summary.reasons.length);
  });
});
