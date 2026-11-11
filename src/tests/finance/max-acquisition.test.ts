import { afterEach, describe, expect, it, vi } from "vitest";
import { findMaxAcquisitionForScenario, findMaxLandCostForIRR } from "@/lib/finance/max-acquisition";
import * as engine from "@/lib/finance/scenario";
import { calculatedAnnualIrr } from "@/lib/finance/return-metrics";
import { precisionFixture } from "@/tests/helpers/finance-precision-fixture";
import {
  calculateScenario,
  defaultAssumptions,
  defaultProgram,
} from "@/lib/finance/scenario";
import type { Parcel, Scenario, ScenarioResult } from "@/lib/finance/types";

const parcel: Parcel = {
  id: "MAX-ACQ-FUNDING",
  address: "서울 테스트구 테스트동 1",
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
  acquiredPrice: 20_000,
};

function scenario(equityCommitmentManwon: number): Scenario {
  return {
    id: "MAX-ACQ-SCENARIO",
    name: "자금 한도 역산",
    shortName: "역산",
    program: defaultProgram("multi-family", parcel.maxFAR, parcel.maxBCR),
    assumptions: {
      ...defaultAssumptions(),
      salePricePerSqM: 15_000_000,
      equityCommitmentManwon,
    },
  };
}

describe("maximum acquisition funding gate", () => {
  it("does not return a land price whose required equity exceeds a confirmed limit", () => {
    const unconstrained = scenario(1_000_000);
    const minimumEquity = calculateScenario({
      parcel: { ...parcel, acquiredPrice: 0 },
      scenario: unconstrained,
    }).funding.requiredEquityManwon;
    const constrained = scenario(minimumEquity + 5_000);
    const result = findMaxLandCostForIRR(parcel, constrained, 10);
    expect(result.maxLandCost).not.toBeNull();
    const boundary = calculateScenario({
      parcel: { ...parcel, acquiredPrice: result.maxLandCost! },
      scenario: constrained,
    });

    expect(boundary.funding.status).not.toBe("shortfall");
    expect(boundary.irrStatus).toBe("calculated");
    expect(calculatedAnnualIrr(boundary)).toBeGreaterThanOrEqual(10);
    expect(result.achievedIRR).toBe(boundary.irrUnroundedPct);
  });
});

afterEach(() => vi.restoreAllMocks());

function mockCurve(curve: (price: number) => Partial<ScenarioResult> = () => ({})) {
  return vi.spyOn(engine, "calculateScenario").mockImplementation(({ parcel: p }) => ({
    viable: true, irr: 20, irrUnroundedPct: 20, irrStatus: "calculated",
    funding: { status: "funded" }, ...curve(p.acquiredPrice),
  } as ScenarioResult));
}

describe("bounded acquisition search", () => {
  it("rechecks the returned integer and its raw IRR without rounding across a boundary", () => {
    const calc = mockCurve((price) => ({ irrUnroundedPct: price <= 100.8 ? 10.01 : 9.99 }));
    const result = findMaxLandCostForIRR({ ...parcel, acquiredPrice: 101 }, scenario(1e6), 10);
    expect(result).toMatchObject({ status: "bracketed", maxLandCost: 100, achievedIRR: 10.01, feasible: false, upperBound: 101 });
    expect(calc.mock.calls.at(-1)![0].parcel.acquiredPrice).toBe(100);
    expect(calc.mock.calls.filter(([input]) => input.parcel.acquiredPrice === 100)).toHaveLength(2);
    expect(calc.mock.calls.every(([input]) => Number.isInteger(input.parcel.acquiredPrice))).toBe(true);
  });

  it("retains a real zero candidate and its evaluated IRR", () => {
    mockCurve((price) => ({ irrUnroundedPct: price === 0 ? 20 : 5 }));
    expect(findMaxLandCostForIRR(parcel, scenario(1e6), 10)).toMatchObject({ status: "bracketed", maxLandCost: 0, achievedIRR: 20 });
  });

  it("uses null rather than fabricated zero for an unsuccessful search", () => {
    mockCurve(() => ({ irrUnroundedPct: 5 }));
    expect(findMaxLandCostForIRR(parcel, scenario(1e6), 10)).toMatchObject({ status: "no-candidate", maxLandCost: null, achievedIRR: null, marketGap: null, feasible: false });
  });

  it("requires viability even with a qualifying return", () => {
    mockCurve(() => ({ viable: false }));
    expect(findMaxLandCostForIRR(parcel, scenario(1e6), 10)).toMatchObject({ status: "no-candidate", maxLandCost: null, feasible: false });
  });

  it("preserves funding-unverified as a preliminary state", () => {
    mockCurve(() => ({ funding: { status: "unverified" } as ScenarioResult["funding"] }));
    expect(findMaxLandCostForIRR(parcel, scenario(1e6), 10)).toMatchObject({ status: "search-limited", feasible: true, fundingStatus: "unverified", marketFundingStatus: "unverified" });
  });

  it("marks a tested expansion cap as limited with no invented upper bound", () => {
    const calc = mockCurve();
    const result = findMaxLandCostForIRR(parcel, scenario(1e6), 10);
    expect(result).toMatchObject({ status: "search-limited", stopReason: "expansion-limit", maxLandCost: 800_000, upperBound: null, expansions: 3 });
    expect(calc.mock.calls.at(-1)![0].parcel.acquiredPrice).toBe(800_000);
  });

  it("preserves a feasible market anchor despite iteration exhaustion", () => {
    mockCurve((price) => ({ irrUnroundedPct: price <= 1_000_000 ? 20 : 5 }));
    expect(findMaxLandCostForIRR({ ...parcel, acquiredPrice: 1_000_000 }, scenario(1e6), 10)).toMatchObject({ status: "search-limited", stopReason: "iteration-limit", maxLandCost: 1_000_000, marketGap: 0, feasible: true, iterations: 18 });
  });

  it("retains a feasible upper probe when no binary iterations are allowed", () => {
    mockCurve((price) => ({ irrUnroundedPct: price <= 100_000 ? 20 : 5 }));
    expect(findMaxLandCostForIRR(parcel, scenario(1e6), 10, { maxIterations: 0 })).toMatchObject({ status: "search-limited", maxLandCost: 100_000, upperBound: 200_000, achievedIRR: 20 });
  });

  it("does not use unavailable upper IRR as an infeasible bound", () => {
    mockCurve((price) => price < 200_000
      ? { irrStatus: "not-calculated", irrUnroundedPct: undefined }
      : { irrUnroundedPct: price <= 300_000 ? 20 : 5 });
    expect(findMaxLandCostForIRR(parcel, scenario(1e6), 10)).toMatchObject({ status: "bracketed", maxLandCost: 300_000, upperBound: 300_001, feasible: null });
  });

  it("does not fall back to rounded IRR and does not mutate inputs", () => {
    const p = structuredClone(parcel), s = scenario(1e6);
    const before = structuredClone({ p, s });
    mockCurve(() => ({ irrUnroundedPct: undefined }));
    expect(findMaxLandCostForIRR(p, s, 10)).toMatchObject({ status: "invalid", stopReason: "calculation-unavailable", maxLandCost: null, marketIRR: null, feasible: null });
    expect({ p, s }).toEqual(before);
  });

  it("invalidates an unavailable midpoint without changing the upper bound", () => {
    mockCurve((price) => price === 60_000
      ? { irrStatus: "ambiguous", irrUnroundedPct: undefined }
      : { irrUnroundedPct: price <= 20_000 ? 20 : 5 });
    expect(findMaxLandCostForIRR(parcel, scenario(1e6), 10)).toMatchObject({ status: "invalid", maxLandCost: 20_000, upperBound: 100_000, stopReason: "calculation-unavailable" });
  });

  it("keeps fractional market eligibility distinct from the integer candidate", () => {
    mockCurve((price) => ({ irrUnroundedPct: price <= 0.25 ? 20 : 5 }));
    expect(findMaxLandCostForIRR({ ...parcel, acquiredPrice: 0.1 }, scenario(1e6), 10)).toMatchObject({ maxLandCost: 0, achievedIRR: 20, feasible: true, marketGap: -0.1 });
  });

  it("removes a candidate whose mandatory final reevaluation fails", () => {
    let zeroCalls = 0;
    mockCurve((price) => ({ irrUnroundedPct: price === 0 && ++zeroCalls === 1 ? 20 : 5 }));
    expect(findMaxLandCostForIRR(parcel, scenario(1e6), 10)).toMatchObject({ status: "invalid", stopReason: "candidate-recheck-failed", maxLandCost: null, achievedIRR: null });
  });

  it.each([{ maxIterations: Infinity }, { maxIterations: -1 }, { tolerance: 0 }, { maxExpansions: NaN }])("rejects invalid search options %j before evaluating", (options) => {
    const calc = mockCurve();
    expect(findMaxLandCostForIRR(parcel, scenario(1e6), 10, options)).toMatchObject({ status: "invalid", stopReason: "invalid-input", maxLandCost: null });
    expect(calc).not.toHaveBeenCalled();
  });
});

describe("real acquisition precision regressions", () => {
  it("rejects the frozen rounded-IRR false positive and returns a rechecked qualifying integer", () => {
    const { parcel: p, scenario: s } = precisionFixture({}, 184_819);
    const market = calculateScenario({ parcel: p, scenario: s });
    expect(market.irr).toBe(10);
    expect(market.irrUnroundedPct).toBeLessThan(10);
    const result = findMaxLandCostForIRR(p, s, 10);
    expect(result.feasible).toBe(false);
    expect(result.maxLandCost).not.toBeNull();
    const checked = calculateScenario({ parcel: { ...p, acquiredPrice: result.maxLandCost! }, scenario: s });
    expect(checked.irrUnroundedPct).toBeGreaterThanOrEqual(10);
    expect(result.achievedIRR).toBe(checked.irrUnroundedPct);
    expect(checked.funding.status).toBe("funded");
  });

  it("does not cross the real confirmed-equity boundary", () => {
    const { parcel: p, scenario: s } = precisionFixture({ equityCommitmentManwon: 23202.207 }, 101);
    const result = findMaxLandCostForIRR(p, s, 10);
    expect(result).toMatchObject({ status: "bracketed", maxLandCost: 100, feasible: false });
    expect(calculateScenario({ parcel: { ...p, acquiredPrice: result.maxLandCost! }, scenario: s }).funding.status).toBe("funded");
  });

  it("preserves unavailable market IRR rather than inventing a zero in the wrapper", () => {
    const { parcel: p, scenario: s } = precisionFixture({ salePricePerSqM: 0 }, 0);
    const result = findMaxAcquisitionForScenario(p, s, [10]);
    expect(result).toMatchObject({ marketIRR: null, marketIRRStatus: "not-calculated" });
    expect(result.results[0]).toMatchObject({ status: "invalid", maxLandCost: null, achievedIRR: null, feasible: null });
  });

  it("keeps searching beyond the real solver rate limit and reports the cap", () => {
    const { parcel: p, scenario: s } = precisionFixture({ designMonths: 0, constructionMonths: 1, saleOutMonths: 1, salePricePerSqM: 1_000_000_000 }, 20_000);
    expect(calculateScenario({ parcel: { ...p, acquiredPrice: 100_000 }, scenario: s }).irrStatus).toBe("not-calculated");
    const result = findMaxLandCostForIRR(p, s, 10);
    expect(result).toMatchObject({ status: "search-limited", stopReason: "expansion-limit", maxLandCost: 800_000, feasible: null });
    expect(result.achievedIRR).toBeGreaterThan(10);
  });
});
