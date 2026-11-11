import { describe, expect, it } from "vitest";
import {
  buildStage3Sensitivity,
  findStage3BreakEvenRevenuePrice,
} from "@/lib/stage3/feasibility-analysis";
import {
  calculateScenario,
  defaultAssumptions,
  defaultProgram,
} from "@/lib/finance/scenario";
import {
  revenuePricingFromAssumptions,
  withScenarioRevenueUnitPrice,
} from "@/lib/finance/revenue-contract";
import type { Parcel, Scenario } from "@/lib/finance/types";

const parcel: Parcel = {
  id: "stage3-test",
  address: "서울 도봉구 테스트동 1-1",
  addressRoad: "서울 도봉구 테스트로 1",
  lotArea: 300,
  zoning: "제2종일반주거지역",
  zoneCode: "UQA122",
  maxFAR: 220,
  maxBCR: 60,
  heightLimit: 30,
  setback: { road: 0, side: 0, rear: 0 },
  landPrice: 2_000_000,
  estMarketPrice: 4_000_000,
  acquired: "2026-01-01",
  acquiredPrice: 50_000,
};

function makeScenario(type: "multi-family" | "coliving" = "multi-family"): Scenario {
  const assumptions = defaultAssumptions();
  assumptions.salePricePerSqM = 6_000_000;
  return {
    id: `test-${type}`,
    name: type,
    shortName: type,
    program: defaultProgram(type, parcel.maxFAR, parcel.maxBCR),
    assumptions,
  };
}

describe("Stage 3 feasibility analysis", () => {
  it("keeps the center sensitivity cell identical to the active pro forma", () => {
    const scenario = makeScenario();
    const base = calculateScenario({ parcel, scenario });
    const grid = buildStage3Sensitivity(parcel, scenario);
    expect(grid.rows[2][2].profit).toBeCloseTo(base.profit, 6);
    expect(grid.rows[2][2].profitUnroundedManwon).toBe(base.profitUnroundedManwon);
    expect(grid.rows[2][2].irr).toBeCloseTo(base.irr, 6);
  });

  it("is monotone for higher exit price and higher construction cost", () => {
    const grid = buildStage3Sensitivity(parcel, makeScenario());
    const center = grid.rows[2][2].profit;
    expect(grid.rows[2][4].profit).toBeGreaterThan(center);
    expect(grid.rows[4][2].profit).toBeLessThan(center);
  });

  it("finds a sale break-even price close to zero profit", () => {
    const scenario = makeScenario();
    const breakEven = findStage3BreakEvenRevenuePrice(parcel, scenario);
    expect(breakEven.kind).toBe("sale");
    expect(breakEven.value).not.toBeNull();
    const result = calculateScenario({
      parcel,
      scenario: withScenarioRevenueUnitPrice(
        scenario,
        "sale",
        breakEven.value!,
      ),
    });
    expect(Math.abs(result.profit)).toBeLessThan(1);
    expect(result.profitUnroundedManwon).toBeGreaterThanOrEqual(0);
    expect(result.profitUnroundedManwon).toBeLessThan(0.001);
    const below = calculateScenario({
      parcel,
      scenario: withScenarioRevenueUnitPrice(scenario, "sale", breakEven.value! - 1),
    });
    expect(below.profitUnroundedManwon).toBeLessThan(0);
  });

  it("uses rent as the revenue driver for hold scenarios", () => {
    const scenario = makeScenario("coliving");
    const grid = buildStage3Sensitivity(parcel, scenario);
    const breakEven = findStage3BreakEvenRevenuePrice(parcel, scenario);
    expect(grid.revenueLabel).toBe("임대료");
    expect(breakEven.kind).toBe("rent");
  });

  it("keeps an independent pricing snapshot live across the grid and break-even", () => {
    const scenario = makeScenario();
    scenario.revenuePricing = revenuePricingFromAssumptions({
      ...scenario.assumptions,
      salePricePerSqM: 9_000_000,
    });
    scenario.assumptions.salePricePerSqM = 1_000_000;

    const base = calculateScenario({ parcel, scenario });
    const grid = buildStage3Sensitivity(parcel, scenario);
    const breakEven = findStage3BreakEvenRevenuePrice(parcel, scenario);

    expect(grid.rows[2][2].profit).toBeCloseTo(base.profit, 6);
    expect(grid.rows[2][4].profit).toBeGreaterThan(grid.rows[2][2].profit);
    expect(breakEven.current).toBe(9_000_000);
    expect(breakEven.value).not.toBeNull();
    expect(
      calculateScenario({
        parcel,
        scenario: withScenarioRevenueUnitPrice(
          scenario,
          "sale",
          breakEven.value!,
        ),
      }).profit,
    ).toBeCloseTo(0, 0);
  });
});
