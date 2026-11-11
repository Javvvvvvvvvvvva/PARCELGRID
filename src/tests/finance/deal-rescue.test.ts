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
import { revenuePricingFromAssumptions, withScenarioRevenueUnitPrice } from "../../lib/finance/revenue-contract";
import type { Parcel, Scenario } from "../../lib/finance/types";
import { integratedVerificationFixture } from "../helpers/integrated-verification-fixture";

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
  it("never uses rounded display values for target gates or missing precision", () => {
    const result = calculateScenario({ parcel: { ...parcel, acquiredPrice: 5_000 }, scenario: makeScenario({ salePricePerSqM: 15_000_000 }) });
    const atTarget = { ...result, profit: 0, npv: 0, irr: 10, profitUnroundedManwon: 0, npvUnroundedManwon: 0, irrUnroundedPct: 10 };
    expect(passesDealRescueTarget(atTarget, 10)).toBe(true);
    expect(passesDealRescueTarget({ ...atTarget, irrUnroundedPct: 9.95025875484114 }, 10)).toBe(false);
    expect(passesDealRescueTarget({ ...atTarget, profitUnroundedManwon: -0.4 }, 10)).toBe(false);
    expect(passesDealRescueTarget({ ...atTarget, npvUnroundedManwon: -0.4 }, 10)).toBe(false);
    for (const field of ["profitUnroundedManwon", "npvUnroundedManwon", "irrUnroundedPct"] as const) {
      expect(passesDealRescueTarget({ ...atTarget, [field]: undefined }, 10)).toBe(false);
      expect(passesDealRescueTarget({ ...atTarget, [field]: Number.NaN }, 10)).toBe(false);
    }
  });

  it("returns only paths that actually pass profit, NPV and IRR targets", () => {
    const scenario = makeScenario();
    scenario.revenuePricing = revenuePricingFromAssumptions(
      scenario.assumptions,
    );
    scenario.assumptions.salePricePerSqM = 1_000_000;
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
    const revenuePath = rescue.paths.find((path) => path.id === "revenue-price");
    expect(revenuePath?.changes[0]?.from).toBe(4_000_000);
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

  it("does not call a profitable result viable when confirmed equity is short", () => {
    const healthyParcel = { ...parcel, acquiredPrice: 5_000 };
    const constrainedScenario = makeScenario({
      salePricePerSqM: 15_000_000,
      equityCommitmentManwon: 1,
    });
    const result = calculateScenario({
      parcel: healthyParcel,
      scenario: constrainedScenario,
    });

    expect(result.profit).toBeGreaterThan(0);
    expect(result.funding.status).toBe("shortfall");
    expect(
      passesDealRescueTarget(
        result,
        constrainedScenario.assumptions.equityIRR,
      ),
    ).toBe(false);
  });

  it("keeps single and balanced cost probes valid with a large fixed material credit", () => {
    const fixture = integratedVerificationFixture();
    const creditParcel = { ...fixture.data.parcel, acquiredPrice: 55_000 };
    const scenario = fixture.data.scenarios[0]._raw;
    scenario.program.areaContract!.materialAdjustmentCostManwon = -fixture.data.scenarios[0].hardCost * 0.95;
    const before = structuredClone(scenario);
    expect(() => calculateScenario({
      parcel: creditParcel,
      scenario: { ...scenario, assumptions: { ...scenario.assumptions, constCostPerSqM: scenario.assumptions.constCostPerSqM * 0.4 } },
    })).toThrow("음수 공사비");

    const rescue = findDealRescuePaths(creditParcel, scenario);
    expect(rescue.status).toBe("rescue-found");
    for (const id of ["construction-cost", "balanced"]) {
      const path = rescue.paths.find(row => row.id === id)!;
      expect(path.status).toBe("reachable");
      const patchedParcel = { ...creditParcel };
      const patchedScenario = structuredClone(scenario);
      for (const change of path.changes) {
        if (change.field === "acquiredPrice") patchedParcel.acquiredPrice = change.to;
        else patchedScenario.assumptions[change.field] = change.to;
      }
      // The locked revenue pools are independently repriced by the rescue engine.
      const revenueChange = path.changes.find(change => change.field === "salePricePerSqM");
      const replay = calculateScenario({ parcel: patchedParcel, scenario: revenueChange
        ? withScenarioRevenueUnitPrice(patchedScenario, "sale", revenueChange.to) : patchedScenario });
      expect(replay.hardCost).toBeGreaterThanOrEqual(0);
      expect(passesDealRescueTarget(replay, rescue.target.irr)).toBe(true);
      expect(passesDealRescueTarget(path.result!, rescue.target.irr)).toBe(true);
    }
    expect(scenario).toEqual(before);
  });

  it("keeps revenue and balanced search probes within the input ceiling", () => {
    const scenario = makeScenario({ constCostPerSqM: 900_000_000, salePricePerSqM: 800_000_000 });
    const rescue = findDealRescuePaths(parcel, scenario);
    expect(rescue.paths.length).toBeGreaterThan(0);
    for (const path of rescue.paths) {
      const revenue = path.changes.find(change => change.field === "salePricePerSqM");
      if (revenue) expect(revenue.to).toBeLessThanOrEqual(1_000_000_000);
      if (path.status === "reachable") expect(passesDealRescueTarget(path.result!, rescue.target.irr)).toBe(true);
    }
  });

  it("does not turn an invalid baseline into a successful rescue", () => {
    const fixture = integratedVerificationFixture();
    const scenario = fixture.data.scenarios[0]._raw;
    scenario.program.areaContract!.materialAdjustmentCostManwon = -fixture.data.scenarios[0].hardCost - 1;
    expect(() => findDealRescuePaths(fixture.data.parcel, scenario)).toThrow("음수 공사비");
  });
});
