import { describe, expect, it } from "vitest";
import { D, annualizeIRR, irr, npv } from "../../lib/finance/math";
import type { ProjectLedger } from "../../lib/finance/project-ledger";

// Expectations use Number/BigInt algebra only; Decimal is an input/output boundary.
function oracleNpv(rate: number, cashflows: readonly number[]): number {
  const discount = 1 / (1 + rate);
  return cashflows.reduceRight((value, flow) => value * discount + flow, 0);
}

function oracleRoot(cashflows: readonly number[], lower: number, upper: number): number {
  const scale = Math.max(...cashflows.map(Math.abs));
  const normalized = cashflows.map((flow) => flow / scale);
  let lowValue = oracleNpv(lower, normalized);
  const highValue = oracleNpv(upper, normalized);
  if (lowValue === 0) return lower;
  if (highValue === 0) return upper;
  if (!(lower > -1 && upper > lower && lowValue * highValue < 0)) {
    throw new Error("Oracle requires a finite, sign-changing bracket above -1");
  }

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (lower + upper) / 2;
    const value = oracleNpv(middle, normalized);
    if (value === 0 || upper - lower < 1e-13) return middle;
    if (Math.sign(value) === Math.sign(lowValue)) {
      lower = middle;
      lowValue = value;
    } else {
      upper = middle;
    }
  }
  throw new Error("Independent bisection did not converge");
}

function expectRoot(cashflows: number[], expected: number, guess?: number): number {
  const root = irr(cashflows, guess);
  expect(root).not.toBeNull();
  const rate = root!.toNumber();
  expect(Number.isFinite(rate)).toBe(true);
  expect(rate).toBeGreaterThan(-1);
  expect.soft(rate).toBeCloseTo(expected, 8);
  const discountedMagnitude = cashflows.reduce(
    (total, flow, period) => total + Math.abs(flow) / (1 + rate) ** period,
    0,
  );
  expect.soft(Math.abs(oracleNpv(rate, cashflows)) / discountedMagnitude)
    .toBeLessThan(2e-9);
  return rate;
}

describe("independent finance oracle: NPV", () => {
  it.each([
    { name: "no cashflow", rate: 0.1, flows: [], expected: 0 },
    { name: "all zero cashflows", rate: -0.25, flows: [0, 0, 0], expected: 0 },
    { name: "period zero is undiscounted", rate: -0.75, flows: [-123], expected: -123 },
    { name: "zero rate sums cashflows", rate: 0, flows: [-100, 30, 80], expected: 10 },
    { name: "positive rate", rate: 0.25, flows: [-100, 125, 125], expected: 80 },
    { name: "negative rate", rate: -0.5, flows: [-100, 25, 25], expected: 50 },
    { name: "near-total loss rate", rate: -0.99, flows: [-100, 1], expected: 0 },
    { name: "empty periods retain timing", rate: 0.25, flows: [0, -100, 0, 125], expected: -16 },
  ])("$name", ({ rate, flows, expected }) => {
    expect(npv(rate, flows).toNumber()).toBeCloseTo(expected, 10);
  });

  it("preserves an exact rational answer beyond Number integer precision", () => {
    const unit = 9_007_199_254_740_993n;
    // -4u + (5u + 5) / (5/4) = 4, without converting u to Number.
    const flows = [(-4n * unit).toString(), (5n * unit + 5n).toString()];
    expect(npv("0.25", flows).toString()).toBe("4");
  });

  it.each([1e-12, 1, 1e6, 1e12])("is linear at cashflow scale %s", (scale) => {
    expect(npv(0.1, [-4 * scale, 5 * scale]).toNumber() / scale)
      .toBeCloseTo(6 / 11, 12);
  });
});

describe("independent finance oracle: periodic IRR", () => {
  it.each([
    { name: "positive return", flows: [-100, 125], expected: 0.25 },
    { name: "negative return", flows: [-100, 80], expected: -0.2 },
    { name: "zero return", flows: [-100, 25, 75], expected: 0 },
    { name: "quadratic root", flows: [-100, 0, 121], expected: 0.1 },
    { name: "leading and trailing empty periods", flows: [0, -100, 0, 121, 0], expected: 0.1 },
    { name: "99 percent loss", flows: [-100, 1], expected: -0.99 },
  ])("solves $name and has a small independent residual", ({ flows, expected }) => {
    expectRoot(flows, expected);
  });

  it.each([
    { name: "irregular positive return", flows: [-1000, 300, 420, 580], lower: 0, upper: 1 },
    { name: "delayed loss", flows: [-1000, 0, 200, 200], lower: -0.8, upper: 0 },
    { name: "staged investment", flows: [-1000, -250, 0, 400, 1000], lower: 0, upper: 0.5 },
  ])("agrees with independent bisection for $name", ({ flows, lower, upper }) => {
    expectRoot(flows, oracleRoot(flows, lower, upper));
  });

  it("recovers a known root from a distant initial guess", () => {
    expectRoot([-100, 125], 0.25, 10);
  });

  it.each([1e-24, 1e-12, 1, 1e6, 1e12])("preserves IRR at cashflow scale %s", (scale) => {
    // -4 + 5/(1+r) = 0 has r = 1/4 regardless of the currency unit.
    expectRoot([-4 * scale, 5 * scale], 0.25);
    expectRoot([-4 * scale, 5 * scale], 0.25, 10);
  });

  it("returns exact fallback endpoint roots", () => {
    expect(irr([-100, 1])?.toString()).toBe("-0.99");
    expect(irr([-100, 1100], 0.01, 1)?.toString()).toBe("10");
  });

  it.each([0, 1, 2])("returns null rather than an unconverged midpoint after %s iterations", (maxIter) => {
    expect(irr([-100, 0, 0, 500], 10, maxIter)).toBeNull();
  });

  it("requires a residual small enough even after the rate bracket narrows", () => {
    const flows = [-1e12, 0, 0, 5e12];
    expect(irr(flows, 10, 40)).toBeNull();
    expectRoot(flows, Math.cbrt(5) - 1, 10);
  });

  it("does not accept tiny discounted values as a root without relative convergence", () => {
    expectRoot([0, 0, -1e-12, 1e-12], 0, 10);
  });

  it.each([NaN, Infinity, -Infinity])("rejects nonfinite cashflow %s", (flow) => {
    expect(irr([-100, 125, flow])).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, -1, -1.01, 10.01])("rejects invalid initial rate %s", (guess) => {
    expect(irr([-100, 125], guess)).toBeNull();
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid tolerance %s", (tolerance) => {
    expect(irr([-100, 125], 0.01, 200, tolerance)).toBeNull();
  });

  it.each([-1, 1.5, NaN, Infinity])("rejects invalid iteration budget %s", (maxIter) => {
    expect(irr([-100, 125], 0.01, maxIter)).toBeNull();
  });

  it.each([
    { name: "empty", flows: [] },
    { name: "one zero", flows: [0] },
    { name: "one positive", flows: [100] },
    { name: "one negative", flows: [-100] },
    { name: "all zero", flows: [0, 0, 0] },
    { name: "nonnegative", flows: [0, 100, 20] },
    { name: "nonpositive", flows: [-100, 0, -50] },
    // In x = 1/(1+r), both quadratics have negative discriminants.
    { name: "mixed signs without a real root", flows: [-100, 50, -10] },
    { name: "opposite mixed signs without a real root", flows: [1, -1, 1] },
  ])("returns null for $name cashflows", ({ flows }) => {
    expect(irr(flows)).toBeNull();
  });

  it.each([0.01, 0.15, 0.3])("returns a valid root for multiple sign changes, guess %s", (guess) => {
    // -100q^2 + 230q - 132 = -100(q-1.1)(q-1.2), q = 1+r.
    // The primitive returns one root; uniqueness/reportability is a caller policy.
    const flows = [-100, 230, -132];
    const root = irr(flows, guess);
    expect(root).not.toBeNull();
    const rate = root!.toNumber();
    expect(Math.min(Math.abs(rate - 0.1), Math.abs(rate - 0.2)))
      .toBeLessThan(1e-8);
    expect(Math.abs(oracleNpv(rate, flows)) / 462).toBeLessThan(2e-9);
  });

  it.each([0.1, 0.2])("retains an exact initial root %s when more than one exists", (guess) => {
    expect(irr([-100, 230, -132], guess)?.toString()).toBe(String(guess));
  });

  it("does not invent a multiple-root answer when Newton and the fallback cannot converge", () => {
    expect(irr([-100, 230, -132], 0.15, 1)).toBeNull();
  });
});

describe("independent finance oracle: monthly and annual periods", () => {
  it.each([-0.02, 0, 0.01])("compounds monthly rate %s over twelve periods", (monthlyRate) => {
    expect(annualizeIRR(D(monthlyRate), 12).toNumber())
      .toBeCloseTo((1 + monthlyRate) ** 12 - 1, 12);
  });

  it("honors a non-monthly compounding frequency", () => {
    expect(annualizeIRR(D(0.1), 4).toNumber()).toBeCloseTo(0.4641, 12);
  });

  const ledger: Pick<ProjectLedger, "equityCashFlows"> = {
    equityCashFlows: Array.from({ length: 25 }, (_, month) =>
      month === 0 ? -1000 : month === 12 || month === 24 ? 600 : 0,
    ),
  };

  it.each([-0.19, 0, 0.21])("discounts monthly ledger periods at effective annual rate %s", (annualRate) => {
    const monthlyRate = (1 + annualRate) ** (1 / 12) - 1;
    const expected = -1000 + 600 / (1 + annualRate) + 600 / (1 + annualRate) ** 2;
    expect(npv(monthlyRate, ledger.equityCashFlows).toNumber()).toBeCloseTo(expected, 9);
  });

  it("matches the analytic annual root for receipts in months 12 and 24", () => {
    // 1000q^2 - 600q - 600 = 0, q = 1 + annualIRR.
    const annualRoot = (3 + Math.sqrt(69)) / 10 - 1;
    const monthlyRoot = (1 + annualRoot) ** (1 / 12) - 1;
    const monthly = expectRoot(ledger.equityCashFlows, monthlyRoot);
    expect(annualizeIRR(D(monthly), 12).toNumber()).toBeCloseTo(annualRoot, 8);
  });
});
