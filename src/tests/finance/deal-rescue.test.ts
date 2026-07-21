import { describe, expect, it } from "vitest";
import {
  findDealRescuePaths,
  passesDealRescueTarget,
} from "../../lib/finance/deal-rescue";
import {
  calculateScenario,
  defaultAssumptions,
  defaultProgram,
} from "../../lib/finance/scenario";
import type { Parcel, Scenario } from "../../lib/finance/types";

const parcel: Parcel = {
  id: "DEAL-RESCUE-PARCEL",
  address: "서울특별시 테스트구 테스트동 1",
  addressRoad: "테스트로 1",
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
    id: "DEAL-RESCUE-SCENARIO",
    name: "다가구 통매각",
    shortName: "구조 검증",
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

describe("Deal Rescue", () => {
  it("returns only paths that actually pass profit, NPV and IRR targets", () => {
    const scenario = makeScenario();
    const rescue = findDealRescuePaths(parcel, scenario);

    expect(
      passesDealRescueTarget(rescue.baseline, rescue.target.irr)
    ).toBe(false);
    const reachable = rescue.paths.filter(
      (path) => path.status === "reachable"
    );
    expect(reachable.length).toBeGreaterThan(0);
    for (const path of reachable) {
      expect(path.result).toBeDefined();
      expect(
        passesDealRescueTarget(path.result!, rescue.target.irr)
      ).toBe(true);
    }
  });

  it("finds a near-boundary maximum land price without mutating inputs", () => {
    const scenario = makeScenario();
    const parcelBefore = JSON.stringify(parcel);
    const scenarioBefore = JSON.stringify(scenario);
    const rescue = findDealRescuePaths(parcel, scenario);
    const landPath = rescue.paths.find(
      (path) => path.id === "land-price"
    );

    expect(landPath?.status).toBe("reachable");
    const threshold = landPath!.changes[0].to;
    expect(threshold).toBeLessThan(parcel.acquiredPrice);
    const justAbove = calculateScenario({
      parcel: { ...parcel, acquiredPrice: threshold + 100 },
      scenario,
    });
    expect(
      passesDealRescueTarget(justAbove, scenario.assumptions.equityIRR)
    ).toBe(false);
    expect(JSON.stringify(parcel)).toBe(parcelBefore);
    expect(JSON.stringify(scenario)).toBe(scenarioBefore);
  });

  it("does not invent a rescue when every disclosed bound still fails", () => {
    const impossible = makeScenario({
      salePricePerSqM: 1_000,
      constCostPerSqM: 20_000_000,
    });
    const rescue = findDealRescuePaths(
      { ...parcel, acquiredPrice: 1_000_000 },
      impossible
    );

    expect(rescue.status).toBe("no-bounded-solution");
    expect(
      rescue.paths.some((path) => path.status === "reachable")
    ).toBe(false);
  });

  it("does not prescribe changes when the baseline already meets the gate", () => {
    const healthyParcel = { ...parcel, acquiredPrice: 5_000 };
    const healthyScenario = makeScenario({
      salePricePerSqM: 15_000_000,
    });
    const rescue = findDealRescuePaths(healthyParcel, healthyScenario);

    expect(rescue.status).toBe("already-viable");
    expect(rescue.paths).toEqual([]);
    expect(
      passesDealRescueTarget(rescue.baseline, rescue.target.irr)
    ).toBe(true);
  });
});
