import { describe, expect, it } from "vitest";
import {
  buildDealStressTest,
  DEAL_STRESS_MODEL_VERSION,
} from "../../lib/finance/deal-stress-test";
import { passesDealRescueTarget } from "../../lib/finance/deal-rescue";
import {
  calculateScenario,
  defaultAssumptions,
  defaultProgram,
} from "../../lib/finance/scenario";
import type { Parcel, Scenario } from "../../lib/finance/types";

const parcel: Parcel = {
  id: "DEAL-STRESS-PARCEL",
  address: "서울특별시 테스트구 테스트동 2",
  addressRoad: "테스트로 2",
  lotArea: 300,
  zoning: "제2종일반주거지역",
  zoneCode: "UQA122",
  maxFAR: 250,
  maxBCR: 60,
  heightLimit: 20,
  setback: { road: 1, side: 0.5, rear: 0.5 },
  landPrice: 3_000_000,
  estMarketPrice: 8_000_000,
  acquired: "2026-01-01",
  acquiredPrice: 150_000,
};

function makeScenario(
  overrides: Partial<Scenario["assumptions"]> = {}
): Scenario {
  return {
    id: "DEAL-STRESS-SCENARIO",
    name: "다가구 통매각",
    shortName: "스트레스 검증",
    program: defaultProgram(
      "multi-family",
      parcel.maxFAR,
      parcel.maxBCR
    ),
    assumptions: {
      ...defaultAssumptions(),
      salePricePerSqM: 4_000_000,
      ...overrides,
    },
  };
}

describe("Deal stress test", () => {
  it("reconciles the loss DNA to the exact scenario ledger", () => {
    const stress = buildDealStressTest(parcel, makeScenario());
    const costSum = stress.costDna.reduce((sum, row) => sum + row.amount, 0);

    expect(stress.modelVersion).toBe(DEAL_STRESS_MODEL_VERSION);
    expect(costSum).toBeCloseTo(stress.baseline.totalCost, 6);
    expect(stress.reconciliationError).toBeCloseTo(0, 8);
    expect(stress.gateGap.profit).toBe(Math.max(0, -stress.baseline.profit));
  });

  it("finds land and revenue survival lines at the full profit/NPV/IRR gate", () => {
    const scenario = makeScenario();
    const stress = buildDealStressTest(parcel, scenario);
    const land = stress.thresholds.find((row) => row.id === "land-price")!;
    const revenue = stress.thresholds.find(
      (row) => row.id === "revenue-price"
    )!;

    expect(land.threshold).not.toBeNull();
    expect(revenue.threshold).not.toBeNull();

    const atLand = calculateScenario({
      parcel: { ...parcel, acquiredPrice: land.threshold! },
      scenario,
    });
    const aboveLand = calculateScenario({
      parcel: { ...parcel, acquiredPrice: land.threshold! + 100 },
      scenario,
    });
    expect(passesDealRescueTarget(atLand, stress.targetIRR)).toBe(true);
    expect(passesDealRescueTarget(aboveLand, stress.targetIRR)).toBe(false);

    const atRevenue = calculateScenario({
      parcel,
      scenario: {
        ...scenario,
        assumptions: {
          ...scenario.assumptions,
          salePricePerSqM: revenue.threshold!,
        },
      },
    });
    const belowRevenue = calculateScenario({
      parcel,
      scenario: {
        ...scenario,
        assumptions: {
          ...scenario.assumptions,
          salePricePerSqM: revenue.threshold! - 1_000,
        },
      },
    });
    expect(passesDealRescueTarget(atRevenue, stress.targetIRR)).toBe(true);
    expect(passesDealRescueTarget(belowRevenue, stress.targetIRR)).toBe(false);
  });

  it("stress cases recalculate the ledger without mutating inputs", () => {
    const scenario = makeScenario({ salePricePerSqM: 15_000_000 });
    const healthyParcel = { ...parcel, acquiredPrice: 5_000 };
    const beforeParcel = JSON.stringify(healthyParcel);
    const beforeScenario = JSON.stringify(scenario);
    const stress = buildDealStressTest(healthyParcel, scenario);

    expect(stress.baselinePasses).toBe(true);
    expect(stress.stressCases).toHaveLength(5);
    expect(stress.stressCases.every((row) => row.result.totalMonths > 0)).toBe(
      true
    );
    expect(JSON.stringify(healthyParcel)).toBe(beforeParcel);
    expect(JSON.stringify(scenario)).toBe(beforeScenario);
  });

  it("marks bounded thresholds unavailable instead of inventing a solution", () => {
    const impossible = makeScenario({
      salePricePerSqM: 1_000,
      constCostPerSqM: 20_000_000,
    });
    const stress = buildDealStressTest(
      { ...parcel, acquiredPrice: 1_000_000 },
      impossible
    );

    expect(stress.baselinePasses).toBe(false);
    expect(stress.thresholds.some((row) => row.status === "unreachable")).toBe(
      true
    );
    expect(stress.geometryPolicy).toContain("저장된 법규·배치 검증 계획안");
  });
});
