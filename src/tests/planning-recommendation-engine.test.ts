import { describe, expect, it } from "vitest";
import {
  buildSteppedEnvelopeProfile,
  generatePlanningRecommendations,
} from "@/lib/planning/recommendation-engine";
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
  version: "recommendation-test-v2",
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

const GEOMETRY_CODES = new Set([
  "bcr",
  "far",
  "height",
  "floor-area-vs-lot",
  "spatial-area-capacity",
  "spatial-placement",
  "spatial-floor-support",
  "floor-levels",
]);

describe("Stage 2 planning recommendation engine", () => {
  it("selects architecture and profit recommendations only from eligible candidates", () => {
    const result = generatePlanningRecommendations(input());

    expect(result.evaluatedCandidates).toBeGreaterThan(20);
    expect(result.eligibleCandidates).toBeGreaterThan(0);
    expect(result.architecturalFeasibility).not.toBeNull();
    expect(result.profitOptimal).not.toBeNull();
    expect(result.legalCeilingReference).not.toBeNull();
    expect(result.architecturalFeasibility?.origin).toBe("algorithm-safe");
    expect(result.profitOptimal?.origin).toBe("algorithm-balanced");
    expect(result.profitOptimal?.recommendation?.objective).toBe("profit");
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

  it("builds non-increasing floor capacities from the stepped legal envelope", () => {
    const profile = buildSteppedEnvelopeProfile(input().parcel, 5);

    expect(profile.source).toBe("legal-envelope");
    expect(profile.capacitiesSqm).toHaveLength(5);
    expect(profile.capacitiesSqm.every((area) => area > 0)).toBe(true);
    for (let index = 1; index < profile.capacitiesSqm.length; index += 1) {
      expect(profile.capacitiesSqm[index]).toBeLessThanOrEqual(
        profile.capacitiesSqm[index - 1]
      );
    }
  });

  it("selects the legal ceiling only from geometry-feasible stepped candidates", () => {
    const result = generatePlanningRecommendations(input());
    const geometryEligible = result.evaluations.filter(
      (candidate) => candidate.geometryEligible
    );
    const maxFar = Math.max(
      ...geometryEligible.map(
        (candidate) => candidate.calculation.metrics.preliminaryFarPct
      )
    );
    const reference = result.legalCeilingReference;

    expect(reference?.recommendation?.objective).toBe("legal-ceiling");
    expect(reference?.name).toBe("배치 가능 상한 참고안");
    expect(reference?.description).toContain("층별 정북일조");
    expect(reference?.recommendation?.reasons.join(" ")).toContain(
      maxFar.toFixed(1)
    );

    const selected = geometryEligible.find(
      (candidate) =>
        candidate.scenario.floorPrograms.length === reference?.floorPrograms.length &&
        Math.abs(
          candidate.calculation.metrics.preliminaryFarPct -
            (reference?.economicsPreview.status
              ? maxFar
              : Number.NaN)
        ) < 0.01
    );
    expect(selected).toBeDefined();
    expect(
      selected?.calculation.checks.filter(
        (check) => check.status === "fail" && GEOMETRY_CODES.has(check.code)
      )
    ).toHaveLength(0);

    const floorAreas = reference?.floorPrograms
      .filter((floor) => floor.level > 0)
      .sort((a, b) => a.level - b.level)
      .map((floor) =>
        floor.zones.reduce((sum, zone) => sum + Math.max(0, zone.areaSqm), 0)
      );
    expect(floorAreas?.length).toBeGreaterThan(0);
    for (let index = 1; index < (floorAreas?.length ?? 0); index += 1) {
      expect(floorAreas?.[index]).toBeLessThanOrEqual(floorAreas?.[index - 1] ?? 0);
    }
  });
});
