/**
 * Tests for the math primitives.
 *
 * Run with: `pnpm test`. Uses Vitest.
 *
 * Key test cases:
 *   1. NPV — known-answer from textbook
 *   2. IRR — single sign change, easy case
 *   3. IRR — multiple sign changes (real estate cashflows often have these)
 *   4. IRR — degenerate cases (all positive, all negative, zeros)
 *   5. DSCR — standard
 *   6. Equity multiple
 */

import { describe, it, expect } from "vitest";
import {
  D,
  npv,
  irr,
  annualizeIRR,
  dscr,
  annualMortgagePayment,
  equityMultiple,
} from "../../lib/finance/math";

describe("npv", () => {
  it("computes NPV of a simple stream", () => {
    // Investment -1000 today, receive 600 in y1 and 600 in y2 at 10%.
    // NPV = -1000 + 600/1.1 + 600/1.21 = 41.32...
    const result = npv(0.1, [-1000, 600, 600]);
    expect(result.toNumber()).toBeCloseTo(41.3223, 3);
  });

  it("NPV at 0% rate is just the sum", () => {
    const result = npv(0, [-100, 50, 50, 50]);
    expect(result.toNumber()).toBe(50);
  });

  it("NPV with very high rate approaches first cashflow only", () => {
    const result = npv(10, [-100, 50, 50, 50]);
    // At 1000% rate the future flows are crushed; result ≈ -100 + tiny
    expect(result.toNumber()).toBeLessThan(-95);
  });
});

describe("irr", () => {
  it("solves simple positive IRR", () => {
    // -1000 today, 1100 in one year → IRR = 10%
    const r = irr([-1000, 1100]);
    expect(r).not.toBeNull();
    expect(r!.toNumber()).toBeCloseTo(0.1, 4);
  });

  it("solves multi-period IRR", () => {
    // -1000 today, 400/400/400 → IRR ≈ 9.7%
    const r = irr([-1000, 400, 400, 400]);
    expect(r).not.toBeNull();
    expect(r!.toNumber()).toBeCloseTo(0.0971, 3);
  });

  it("handles negative IRR (loss)", () => {
    const r = irr([-1000, 500, 400]);
    expect(r).not.toBeNull();
    expect(r!.toNumber()).toBeLessThan(0);
  });

  it("returns null when no sign change (all negative)", () => {
    const r = irr([-100, -50, -20]);
    expect(r).toBeNull();
  });

  it("returns null when no sign change (all positive)", () => {
    const r = irr([100, 50, 20]);
    expect(r).toBeNull();
  });

  it("annualizes monthly IRR correctly", () => {
    // Monthly IRR of 1% → annual ≈ 12.68%
    const monthly = D(0.01);
    const annual = annualizeIRR(monthly, 12);
    expect(annual.toNumber()).toBeCloseTo(0.12683, 4);
  });

  it("handles real-estate-style cashflow with delayed inflows", () => {
    // Equity -110억, construction -50억 spread over months 4-18,
    // then revenue +200억 in months 19-24
    const cf: number[] = new Array(25).fill(0);
    cf[0] = -110_000; // 110억 in 만원
    for (let m = 4; m <= 18; m++) cf[m] = -50_000 / 15;
    for (let m = 19; m <= 24; m++) cf[m] = 200_000 / 6;
    const r = irr(cf, 0.01);
    expect(r).not.toBeNull();
    expect(r!.toNumber()).toBeGreaterThan(0);
    // Annualized should be a healthy double-digit %
    const annual = annualizeIRR(r!, 12);
    expect(annual.toNumber()).toBeGreaterThan(0.05);
  });
});

describe("dscr", () => {
  it("computes basic DSCR", () => {
    // NOI 100, debt service 70 → DSCR = 1.43
    const result = dscr(100, 70);
    expect(result.toNumber()).toBeCloseTo(1.4286, 3);
  });

  it("returns Infinity for zero debt", () => {
    const result = dscr(100, 0);
    expect(result.toNumber()).toBe(Infinity);
  });
});

describe("annualMortgagePayment", () => {
  it("computes level annual payment", () => {
    // $100k @ 5% over 30 years → ~$6,505.14
    const result = annualMortgagePayment(100_000, 0.05, 30);
    expect(result.toNumber()).toBeCloseTo(6505.14, 1);
  });

  it("zero-rate falls back to straight-line", () => {
    const result = annualMortgagePayment(1000, 0, 10);
    expect(result.toNumber()).toBe(100);
  });
});

describe("equityMultiple", () => {
  it("standard case", () => {
    expect(equityMultiple(280, 100).toNumber()).toBe(2.8);
  });
  it("zero equity returns zero (not crash)", () => {
    expect(equityMultiple(280, 0).toNumber()).toBe(0);
  });
});
