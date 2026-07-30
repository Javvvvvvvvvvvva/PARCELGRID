import { describe, expect, it } from "vitest";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { planningScenarioToFinanceScenario } from "@/lib/planning/finance-adapter";
import {
  createFloorProgram,
  createFloorZone,
  emptyEconomicsPreview,
} from "@/lib/planning/scenario-utils";
import type { PlanningScenario } from "@/lib/planning/types";

function mixedPlan(): PlanningScenario {
  const preview = emptyEconomicsPreview(10_000);
  return {
    id: "PLAN-STAGE3",
    projectId: "PROJECT-1",
    name: "대표 복합 계획",
    origin: "custom",
    status: "saved",
    version: 4,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    primaryUse: "mixed",
    floorPrograms: [
      createFloorProgram(1, [
        {
          ...createFloorZone("residential", 30, 1),
          revenueModel: "sale",
        },
        {
          ...createFloorZone("retail", 20, 1),
          revenueModel: "lease",
        },
      ]),
      createFloorProgram(2, [
        {
          ...createFloorZone("residential", 50, 2),
          revenueModel: "sale",
        },
      ]),
    ],
    placement: {
      rotationDeg: 0,
      offsetXM: 0,
      offsetZM: 0,
      roadSetbackM: 0,
      northSetbackM: 0,
    },
    parking: { strategy: "surface", providedCars: 2 },
    checks: [],
    economicsPreview: {
      ...preview,
      status: "estimated",
      constructionCostManwon: 30_000,
    },
  };
}

describe("planning finance adapter", () => {
  it("preserves the representative ID and exact Stage 2 program totals", () => {
    const result = planningScenarioToFinanceScenario(
      mixedPlan(),
      { lotArea: 100 },
      defaultAssumptions()
    );

    expect(result.id).toBe("PLAN-STAGE3");
    expect(result.program.type).toBe("mixed");
    expect(result.program.far).toBeCloseTo(100, 6);
    expect(result.program.bcr).toBeCloseTo(50, 6);
    expect(result.program.floorsAbove).toBe(2);
    expect(result.program.floorsBelow).toBe(0);
    expect(result.program.units).toEqual({ residential: 3, retail: 1 });
  });

  it("maps per-zone sale and lease areas into the finance revenue mix", () => {
    const result = planningScenarioToFinanceScenario(
      mixedPlan(),
      { lotArea: 100 },
      defaultAssumptions()
    );

    expect(result.program.mix.residentialSale).toBeCloseTo(0.8, 6);
    expect(result.program.mix.residentialLease).toBeCloseTo(0, 6);
    expect(result.program.mix.retail).toBeCloseTo(0.2, 6);
  });

  it("carries the saved Stage 2 construction and material total into Stage 3", () => {
    const result = planningScenarioToFinanceScenario(
      mixedPlan(),
      { lotArea: 100 },
      defaultAssumptions()
    );

    expect(result.assumptions.constCostPerSqM).toBeCloseTo(3_000_000, 2);
  });
});
