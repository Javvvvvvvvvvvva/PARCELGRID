import { describe, expect, it } from "vitest";
import { generatePlanningRecommendations } from "@/lib/planning/recommendation-engine";
import type { PlanningEconomicsAssumptions } from "@/lib/planning/types";

const ORIGIN: [number, number] = [127.025749, 37.650511];

function localRingToLngLat(points: Array<[number, number]>): [number, number][] {
  const lngScale = 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return points.map(([x, z]) => [ORIGIN[0] + x / lngScale, ORIGIN[1] - z / 111_000]);
}

const assumptions: PlanningEconomicsAssumptions = {
  version: "recommendation-test-v1",
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
    [-20, 20],
    [20, 20],
    [20, -20],
    [-20, -20],
    [-20, 20],
  ]);
  return {
    projectId: "recommendation-project",
    generatedAt: "2026-07-16T00:00:00.000Z",
    assumptions,
    parcel: {
      lotAreaSqm: 1_600,
      maxFARPct: 200,
      maxBCRPct: 50,
      heightLimitM: 18,
      acquisitionCostManwon: 20_000,
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

describe("Stage 2 planning recommendation engine", () => {
  it("selects architecture and profit recommendations only from eligible candidates", () => {
    const result = generatePlanningRecommendations(input());

    expect(result.evaluatedCandidates).toBeGreaterThan(20);
    expect(result.eligibleCandidates).toBeGreaterThan(0);
    expect(result.architecturalFeasibility).not.toBeNull();
    expect(result.profitOptimal).not.toBeNull();
    expect(result.legalCeilingReference).not.toBeNull();
    expect(result.architecturalFeasibility?.origin).toBe("algorithm-safe");
    expect(result.profitOptimal?.origin).toBe("algorithm-profit");
    expect(result.legalCeilingReference?.origin).toBe("algorithm-max");
    expect(result.architecturalFeasibility?.recommendation?.eligible).toBe(true);
    expect(result.profitOptimal?.recommendation?.eligible).toBe(true);
  });

  it("keeps architectural feasibility and profit as separate ranking axes", () => {
    const result = generatePlanningRecommendations(input());
    const eligible = result.evaluations.filter((candidate) => candidate.eligible);
    const maxArchitectureScore = Math.max(
      ...eligible.map((candidate) => candidate.architectureScore)
    );
    const maxProfit = Math.max(
      ...eligible.map(
        (candidate) => candidate.calculation.economicsPreview.profitManwon
      )
    );

    expect(
      result.architecturalFeasibility?.recommendation?.architectureScore
    ).toBe(maxArchitectureScore);
    expect(result.profitOptimal?.economicsPreview.profitManwon).toBe(maxProfit);
    expect(result.profitOptimal?.recommendation?.reasons.join(" ")).toContain(
      "개략 이익 최대"
    );
  });

  it("marks the legal ceiling as a reference rather than an automatic recommendation", () => {
    const result = generatePlanningRecommendations(input());
    const maxFar = Math.max(
      ...result.evaluations.map(
        (candidate) => candidate.calculation.metrics.preliminaryFarPct
      )
    );

    expect(result.legalCeilingReference?.recommendation?.objective).toBe(
      "legal-ceiling"
    );
    expect(result.legalCeilingReference?.description).toContain("비교 기준");
    expect(
      result.evaluations.find(
        (candidate) =>
          candidate.scenario.id === result.legalCeilingReference?.id
      )
    ).toBeUndefined();
    expect(
      result.legalCeilingReference?.recommendation?.reasons.join(" ")
    ).toContain(maxFar.toFixed(1));
  });
});
