import { describe, expect, it } from "vitest";
import {
  calculatePlanningScenario,
  type PlanningCalculationContext,
} from "@/lib/planning/scenario-calculator";
import { diffPlanningScenarios } from "@/lib/planning/scenario-diff";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";
import type { PlanningScenario } from "@/lib/planning/types";

const context: PlanningCalculationContext = {
  parcel: {
    lotAreaSqm: 120,
    maxFARPct: 200,
    maxBCRPct: 60,
    heightLimitM: 15,
    acquisitionCostManwon: 50_000,
    demolitionCostManwon: 1_000,
  },
  assumptions: {
    version: "diff-test-v1",
    constructionCostPerSqmWon: 2_000_000,
    basementCostMultiplier: 1.25,
    softCostRatePct: 10,
    contingencyRatePct: 5,
    financingCostRatePct: 2,
    residentialSalePricePerSqmWon: 5_000_000,
    commercialSalePricePerSqmWon: 4_000_000,
    residentialRentPerSqmMonthWon: 25_000,
    retailRentPerSqmMonthWon: 50_000,
    officeRentPerSqmMonthWon: 40_000,
    vacancyRatePct: 5,
    capRatePct: 5,
  },
};

function baseScenario(): PlanningScenario {
  const scenario = createBlankPlanningScenario({ name: "기준안" });
  scenario.primaryUse = "multi-family";
  scenario.parking = { strategy: "surface", providedCars: 1 };
  scenario.floorPrograms = [
    createFloorProgram(1, [createFloorZone("residential", 50, 1)]),
    createFloorProgram(2, [createFloorZone("residential", 50, 1)]),
  ];
  return scenario;
}

function mixedTarget(): PlanningScenario {
  const scenario = createBlankPlanningScenario({ name: "혼합안" });
  scenario.primaryUse = "mixed";
  scenario.parking = { strategy: "basement", providedCars: 2 };
  scenario.floorPrograms = [
    createFloorProgram(1, [
      createFloorZone("retail", 40, 1),
      createFloorZone("common", 10, 0),
    ], 3.6),
    createFloorProgram(2, [createFloorZone("residential", 60, 2)]),
    createFloorProgram(3, [createFloorZone("residential", 50, 1)]),
    createFloorProgram(-1, [createFloorZone("parking", 60, 0)], 3.3),
  ];
  return scenario;
}

describe("Stage 2 planning scenario diff", () => {
  it("reports floor, program, parking and economics changes", () => {
    const base = baseScenario();
    const target = mixedTarget();
    const baseCalculation = calculatePlanningScenario(base, context);
    const targetCalculation = calculatePlanningScenario(target, context);
    const result = diffPlanningScenarios(
      base,
      target,
      baseCalculation,
      targetCalculation
    );

    const codes = result.items.map((item) => item.code);
    expect(codes).toContain("primary-use");
    expect(codes).toContain("floor-1-program");
    expect(codes).toContain("floor-3-added");
    expect(codes).toContain("floor--1-added");
    expect(codes).toContain("commercial-units");
    expect(codes).toContain("parking-strategy");
    expect(codes).toContain("total-cost");
    expect(codes).toContain("profit");
    expect(result.summary.residentialUnitDelta).toBe(1);
    expect(result.summary.commercialUnitDelta).toBe(1);
    expect(result.summary.totalCostDeltaManwon).toBeGreaterThan(0);
  });

  it("returns no changes for the same scenario and calculation", () => {
    const scenario = baseScenario();
    const calculation = calculatePlanningScenario(scenario, context);
    const result = diffPlanningScenarios(
      scenario,
      scenario,
      calculation,
      calculation
    );

    expect(result.items).toEqual([]);
    expect(result.summary.profitDeltaManwon).toBe(0);
    expect(result.summary.failCheckDelta).toBe(0);
  });

  it("marks added regulatory failures as a negative change", () => {
    const base = baseScenario();
    const target = baseScenario();
    target.name = "과밀안";
    target.floorPrograms = [
      createFloorProgram(1, [createFloorZone("residential", 90, 2)]),
      createFloorProgram(2, [createFloorZone("residential", 90, 2)]),
      createFloorProgram(3, [createFloorZone("residential", 90, 2)]),
    ];
    const result = diffPlanningScenarios(
      base,
      target,
      calculatePlanningScenario(base, context),
      calculatePlanningScenario(target, context)
    );
    const failedChecks = result.items.find((item) => item.code === "failed-checks");

    expect(failedChecks?.impact).toBe("negative");
    expect(result.summary.failCheckDelta).toBeGreaterThan(0);
  });
});
