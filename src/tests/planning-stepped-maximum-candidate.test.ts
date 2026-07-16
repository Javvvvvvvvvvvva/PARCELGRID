import { describe, expect, it } from "vitest";
import {
  generatePlanningRecommendationsV2,
  isGeometryValidMaximumCandidate,
  recommendationCandidateKey,
} from "@/lib/planning/recommendation-analysis";
import { isSteppedMaximumEvaluation } from "@/lib/planning/stepped-maximum-candidate";
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
  version: "stepped-maximum-test-v1",
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

function input() {
  const boundary = localRingToLngLat([
    [-18, 20],
    [18, 20],
    [18, -20],
    [-18, -20],
    [-18, 20],
  ]);
  return {
    projectId: "stepped-maximum-project",
    generatedAt: "2026-07-16T00:00:00.000Z",
    assumptions,
    parcel: {
      lotAreaSqm: 1_440,
      maxFARPct: 250,
      maxBCRPct: 60,
      heightLimitM: 18,
      acquisitionCostManwon: 20_000,
      demolitionCostManwon: 1_000,
      boundary,
      zoning: "제2종일반주거지역",
      roads: [
        {
          name: "테스트로",
          points: localRingToLngLat([
            [21, 30],
            [21, -30],
          ]),
        },
      ],
      setback: { road: 0.5, side: 0.5, rear: 0.5 },
    },
  };
}

function floorArea(
  floor: ReturnType<typeof generatePlanningRecommendationsV2>["legalCeilingReference"] extends infer _T
    ? { zones: Array<{ areaSqm: number }> }
    : never
): number {
  return floor.zones.reduce((sum, zone) => sum + Math.max(0, zone.areaSqm), 0);
}

describe("Stage 2 stepped maximum candidate", () => {
  it("creates candidates from the same per-floor legal envelopes used by 3D validation", () => {
    const result = generatePlanningRecommendationsV2(input());
    const stepped = result.evaluations.filter(isSteppedMaximumEvaluation);

    expect(stepped.length).toBeGreaterThan(0);
    expect(stepped.some(isGeometryValidMaximumCandidate)).toBe(true);
    expect(result.legalCeilingReference).not.toBeNull();
    expect(result.legalCeilingReference?.name).toBe("배치 가능 상한 참고안");
    expect(
      result.legalCeilingReference?.recommendation?.reasons.join(" ")
    ).toContain("층별 법규 외곽선");
  });

  it("never opens a maximum 3D reference with envelope, placement, or support failures", () => {
    const result = generatePlanningRecommendationsV2(input());
    const maximum = result.legalCeilingReference;
    expect(maximum).not.toBeNull();
    if (!maximum) return;

    const failCodes = maximum.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.code);
    expect(failCodes.every((code) => code === "parking")).toBe(true);
    expect(failCodes).not.toContain("spatial-area-capacity");
    expect(failCodes).not.toContain("spatial-placement");
    expect(failCodes).not.toContain("spatial-floor-support");

    const residentialFloorAreas = maximum.floorPrograms
      .filter((floor) =>
        floor.zones.some((zone) => zone.useType === "residential")
      )
      .sort((a, b) => a.level - b.level)
      .map(floorArea);
    for (let index = 1; index < residentialFloorAreas.length; index += 1) {
      expect(residentialFloorAreas[index]).toBeLessThanOrEqual(
        residentialFloorAreas[index - 1] + 0.11
      );
    }
  });

  it("selects the highest realized FAR among geometry-valid candidates", () => {
    const result = generatePlanningRecommendationsV2(input());
    const maximum = result.legalCeilingReference;
    expect(maximum).not.toBeNull();
    if (!maximum) return;

    const valid = result.evaluations.filter(isGeometryValidMaximumCandidate);
    const selected = valid.find(
      (candidate) =>
        recommendationCandidateKey(candidate.scenario) ===
        recommendationCandidateKey(maximum)
    );
    const maxFar = Math.max(
      ...valid.map((candidate) => candidate.calculation.metrics.preliminaryFarPct)
    );

    expect(selected).toBeDefined();
    expect(selected?.calculation.metrics.preliminaryFarPct).toBeCloseTo(maxFar, 6);
    expect(selected?.calculation.metrics.preliminaryFarPct).toBeLessThanOrEqual(
      input().parcel.maxFARPct + 0.01
    );
  });
});
