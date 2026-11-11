import { afterEach, describe, expect, it, vi } from "vitest";
import * as engine from "../../lib/finance/scenario";
import { buildDealStressTest } from "../../lib/finance/deal-stress-test";
import { integratedVerificationFixture } from "../helpers/integrated-verification-fixture";

afterEach(() => vi.restoreAllMocks());

describe("bounded stress candidate retention", () => {
  it("retains a passing current price when the zero-price IRR is unavailable", () => {
    const fixture = integratedVerificationFixture();
    const parcel = { ...fixture.data.parcel, acquiredPrice: 100_000 };
    const scenario = fixture.data.scenarios[0]._raw;
    const base = engine.calculateScenario({ parcel, scenario });
    vi.spyOn(engine, "calculateScenario").mockImplementation(({ parcel: input }) => ({
      ...base, viable: true, profitUnroundedManwon: 10, npvUnroundedManwon: 10,
      funding: { ...base.funding, status: "unverified" },
      irrStatus: input.acquiredPrice === 0 ? "not-calculated" : "calculated",
      irrUnroundedPct: input.acquiredPrice === 0 ? undefined
        : input.acquiredPrice <= 110_000 ? scenario.assumptions.equityIRR + 1 : 0,
    }));
    const result = buildDealStressTest(parcel, scenario);
    expect(result.baselinePasses).toBe(true);
    expect(result.thresholds.find(row => row.id === "land-price")!.threshold).toBeGreaterThanOrEqual(parcel.acquiredPrice);
  });

  it("retains a passing revenue input when the far upper endpoint cannot calculate IRR", () => {
    const fixture = integratedVerificationFixture();
    const parcel = fixture.data.parcel;
    const scenario = fixture.data.scenarios[0]._raw;
    const base = engine.calculateScenario({ parcel, scenario });
    const current = scenario.assumptions.salePricePerSqM;
    vi.spyOn(engine, "calculateScenario").mockImplementation(({ scenario: input }) => {
      const price = input.assumptions.salePricePerSqM;
      return { ...base, viable: true, profitUnroundedManwon: 10, npvUnroundedManwon: 10,
        funding: { ...base.funding, status: "unverified" },
        irrStatus: price > current * 3 ? "not-calculated" : "calculated",
        irrUnroundedPct: price > current * 3 ? undefined
          : price >= current * 0.9 ? scenario.assumptions.equityIRR + 1 : 0 };
    });
    const result = buildDealStressTest(parcel, scenario);
    expect(result.baselinePasses).toBe(true);
    const threshold = result.thresholds.find(row => row.id === "revenue-price")!.threshold;
    expect(threshold).not.toBeNull();
    expect(threshold).toBeLessThanOrEqual(current);
  });
});
