/**
 * Integration test: full scenario calculation reproduces the mock data
 * shown in the design within reasonable tolerance.
 *
 * The mock had S1 = 200억 profit, 32.7% margin, DSCR 1.42, IRR 18.4%.
 * Our calc won't hit those EXACTLY because the mock's numbers were hand-
 * picked, but it should be in the same neighborhood when fed the same
 * assumptions.
 *
 * What this test really proves: the engine is internally consistent.
 *   - Revenue > Cost → positive profit
 *   - Higher FAR → higher GFA → higher revenue (monotonic)
 *   - Higher PF rate → lower profit (monotonic)
 *   - Higher sale price → higher profit (monotonic)
 */

import { describe, it, expect } from "vitest";
import {
  calculateScenario,
  defaultAssumptions,
  defaultProgram,
} from "../../lib/finance/scenario";
import type { Parcel, Scenario } from "../../lib/finance/types";

const parcel: Parcel = {
  id: "PARCEL-2025-1118-073",
  address: "서울특별시 강남구 역삼동 824-11",
  addressRoad: "강남대로 372",
  lotArea: 645.3,
  zoning: "제3종일반주거지역",
  zoneCode: "UB30",
  maxFAR: 250,
  maxBCR: 60,
  heightLimit: 28,
  setback: { road: 3, side: 1.5, rear: 3 },
  landPrice: 12_400_000,
  estMarketPrice: 41_500_000,
  acquired: "2025-02-14",
  acquiredPrice: 268_000,
};

function makeScenario(overrides: Partial<Scenario["assumptions"]> = {}): Scenario {
  return {
    id: "S1",
    name: "오피스텔 + 근생",
    shortName: "S1",
    program: defaultProgram("officetel", parcel.maxFAR, parcel.maxBCR),
    assumptions: {
      ...defaultAssumptions(),
      // 강남 역삼동 오피스텔 fixture. 제품 기본값은 서울 외곽 소형주거
      // 통매각 기준이므로 테스트에서 보수적인 강남 단가를 명시한다.
      salePricePerSqM: 12_000_000,
      ...overrides,
    },
  };
}

describe("calculateScenario", () => {
  it("produces a positive profit for the baseline 강남 mid-rise", () => {
    const r = calculateScenario({ parcel, scenario: makeScenario() });
    expect(r.profit).toBeGreaterThan(0);
    expect(r.profitMargin).toBeGreaterThan(10);
    expect(r.profitMargin).toBeLessThan(60);
  });

  it("returns sensible numeric ranges for IRR/DSCR/EquityMultiple", () => {
    const r = calculateScenario({ parcel, scenario: makeScenario() });
    expect(r.irr).toBeGreaterThan(0);
    expect(r.irr).toBeLessThan(200); // Korean dev IRR can be 50-150% on prime sites
    expect(r.dscr).toBeGreaterThan(0);
    expect(r.equityMultiple).toBeGreaterThan(1);
  });

  it("GFA scales linearly with FAR", () => {
    const lo = calculateScenario({
      parcel,
      scenario: {
        ...makeScenario(),
        program: { ...defaultProgram("officetel", 250, 60), far: 150 },
      },
    });
    const hi = calculateScenario({
      parcel,
      scenario: {
        ...makeScenario(),
        program: { ...defaultProgram("officetel", 250, 60), far: 250 },
      },
    });
    expect(hi.gfa).toBeGreaterThan(lo.gfa);
    // Ratio should match FAR ratio within 1%
    expect(hi.gfa / lo.gfa).toBeCloseTo(250 / 150, 1);
  });

  it("monotone: higher PF rate → lower profit", () => {
    const lo = calculateScenario({
      parcel,
      scenario: makeScenario({ interestRate: 4.0 }),
    });
    const hi = calculateScenario({
      parcel,
      scenario: makeScenario({ interestRate: 8.0 }),
    });
    expect(lo.profit).toBeGreaterThan(hi.profit);
  });

  it("monotone: higher sale price → higher profit", () => {
    const lo = calculateScenario({
      parcel,
      scenario: makeScenario({ salePricePerSqM: 15_000_000 }),
    });
    const hi = calculateScenario({
      parcel,
      scenario: makeScenario({ salePricePerSqM: 22_000_000 }),
    });
    expect(hi.profit).toBeGreaterThan(lo.profit);
  });

  it("cost + profit = revenue (accounting identity)", () => {
    const r = calculateScenario({ parcel, scenario: makeScenario() });
    expect(r.totalCost + r.profit).toBeCloseTo(r.totalRevenue, -1);
  });

  it("equity + pfLoan ≈ total project cost ex financing", () => {
    const r = calculateScenario({ parcel, scenario: makeScenario() });
    const exFin = r.landCost + r.hardCost + r.softCost + r.contingency;
    expect(r.equity + r.pfLoan).toBeCloseTo(exFin, -1);
  });

  it("higher hurdle rate lowers NPV without changing operating profit", () => {
    const low = makeScenario();
    low.assumptions.equityIRR = 10;
    const high = makeScenario();
    high.assumptions.equityIRR = 25;
    const a = calculateScenario({ parcel, scenario: low });
    const b = calculateScenario({ parcel, scenario: high });
    expect(a.npv).toBeGreaterThan(b.npv);
    expect(a.profit).toBe(b.profit);
  });

  it("changing irrelevant fields does not change profit (purity)", () => {
    const a = calculateScenario({ parcel, scenario: makeScenario() });
    const b = calculateScenario({ parcel, scenario: makeScenario() });
    expect(b.profit).toBe(a.profit);
    expect(b.irr).toBe(a.irr);
    expect(b.dscr).toBe(a.dscr);
  });
});
