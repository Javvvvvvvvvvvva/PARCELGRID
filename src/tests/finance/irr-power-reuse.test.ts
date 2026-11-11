import { describe, expect, it, vi } from "vitest";
import { D, Decimal, ONE, ZERO, irr, npv, type DecimalLike } from "@/lib/finance/math";

// Freeze the former evaluation order to catch even sub-display rounding changes.
function referenceIrr(cashflows: DecimalLike[], guess: DecimalLike = .01, maxIter = 200, tolerance = 1e-9): Decimal | null {
  if (cashflows.length < 2) return null;
  const flows = cashflows.map(D);
  if (!flows.some(c => c.gt(0)) || !flows.some(c => c.lt(0))) return null;
  let r = D(guess);
  for (let i = 0; i < maxIter; i++) {
    let f = ZERO, df = ZERO;
    const onePlusR = ONE.plus(r);
    for (let t = 0; t < flows.length; t++) {
      f = f.plus(flows[t].div(onePlusR.pow(t)));
      if (t > 0) df = df.minus(flows[t].times(t).div(onePlusR.pow(t + 1)));
    }
    if (f.abs().lt(tolerance)) return r;
    if (df.abs().lt(1e-15)) break;
    const next = r.minus(f.div(df));
    if (next.lte(-1) || next.gt(10) || !Number.isFinite(next.toNumber())) break;
    r = next;
  }
  let lo = D(-.99), hi = D(10);
  const fLo = npv(lo, flows), fHi = npv(hi, flows);
  if (fLo.times(fHi).gt(0)) return null;
  for (let i = 0; i < maxIter; i++) {
    const mid = lo.plus(hi).div(2), fMid = npv(mid, flows);
    if (fMid.abs().lt(tolerance)) return mid;
    if (fLo.times(fMid).lt(0)) hi = mid;
    else lo = mid;
    if (hi.minus(lo).abs().lt(tolerance)) return mid;
  }
  return lo.plus(hi).div(2);
}

function expectIndependentResidual(root: Decimal | null, cashflows: DecimalLike[]): void {
  expect(root).not.toBeNull();
  const rate = root!.toNumber();
  expect(Number.isFinite(rate)).toBe(true);
  expect(rate).toBeGreaterThan(-1);
  expect(rate).toBeLessThanOrEqual(10);
  const discounted = cashflows.map((flow, period) => Number(flow.toString()) / (1 + rate) ** period);
  const magnitude = discounted.reduce((sum, flow) => sum + Math.abs(flow), 0);
  const residual = Math.abs(discounted.reduce((sum, flow) => sum + flow, 0));
  // Allow Number conversion/power/summation error when checking Decimal outputs.
  const roundingAllowance = 8 * cashflows.length * Number.EPSILON;
  expect(residual / magnitude).toBeLessThan(1e-9 / Math.max(1, magnitude) + roundingAllowance);
}

describe("IRR denominator reuse", () => {
  const largeFlows = ["-123456789012345.67890123456789", "50000000000000.00000000000001", "90000000000000.12345678901234"];
  const projectFlows = [-110000, ...Array(3).fill(0), ...Array(15).fill(-50000 / 15), ...Array(6).fill(200000 / 6)];
  const monthlyFlows = [D(-1000), ...Array(360).fill(D(8))];
  const flows: DecimalLike[][] = [[], [0], [0, 0], [1, 2], [-1, -2], [-100, 110],
    [-1000, 500, 400], [-100, 230, -132], [-100, 100], [-100, 2000],
    largeFlows, projectFlows,
  ];

  it.each(flows.map((cashflows, i) => ({ cashflows, name: `cashflow-${i}` })))(
    "preserves the complete Decimal result for $name", ({ cashflows }) => {
      for (const guess of [.01, 0, -.9]) {
        expect(irr(cashflows, guess)?.toString() ?? null).toBe(referenceIrr(cashflows, guess)?.toString() ?? null);
      }
    });

  it.each([.01, 0])("preserves exact converged monthly results from guess %s", guess => {
    const expected = referenceIrr(monthlyFlows, guess);
    expect(expected).not.toBeNull();
    expect(irr(monthlyFlows, guess)?.toString()).toBe(expected!.toString());
  });

  // The frozen fallback accepted bracket width without a converged residual.
  // Those results require an independent check, not exact parity with that bug.
  const fallbackFlows: DecimalLike[][] = [
    [-100, 110], [-1000, 500, 400], [-100, 100], largeFlows, projectFlows, monthlyFlows,
  ];
  it.each(fallbackFlows.map((cashflows, i) => ({ cashflows, name: `fallback-${i}` })))(
    "requires a converged independent residual for $name", ({ cashflows }) => {
      expectIndependentResidual(irr(cashflows, 10), cashflows);
    });

  it("converges after exhausting Newton on the long monthly stream", () => {
    expectIndependentResidual(irr(monthlyFlows, -.9), monthlyFlows);
  });

  it.each([.01, 0, -.9, 10])("returns the exact lower endpoint from guess %s", guess => {
    // Previously [-100, 1] returned a value near +10 instead of -0.99.
    expect(irr([-100, 1], guess)?.toString()).toBe("-0.99");
  });

  it("rejects the singular initial rate instead of entering the frozen fallback", () => {
    for (const cashflows of [...flows, [-100, 1], monthlyFlows]) {
      expect(irr(cashflows, -1)).toBeNull();
    }
  });

  it("returns null when multiple roots cannot be bracketed after Newton diverges", () => {
    expect(irr([-100, 230, -132], 10)).toBeNull();
  });

  it.each([0, 1, 2])("fails closed after an insufficient iteration budget (%s)", maxIter => {
    // The frozen implementation returned unconverged midpoints for these budgets.
    expect(irr([-100, 0, 0, 500], 10, maxIter)).toBeNull();
  });

  it("converges to the analytic cubic root with a sufficient iteration budget", () => {
    const cashflows = [-100, 0, 0, 500];
    const root = irr(cashflows, 10, 200);
    expectIndependentResidual(root, cashflows);
    expect(root!.toNumber()).toBeCloseTo(Math.cbrt(5) - 1, 10);
  });

  it("removes duplicate pow calls without changing Decimal precision", () => {
    const cashflows = [-1000, 400, 400, 400];
    const spy = vi.spyOn(Decimal.prototype, "pow");
    try {
      const before = referenceIrr(cashflows), beforeCalls = spy.mock.calls.length;
      spy.mockClear();
      const after = irr(cashflows), afterCalls = spy.mock.calls.length;
      expect(after?.toString()).toBe(before?.toString());
      expect(afterCalls * (2 * cashflows.length - 1)).toBe(beforeCalls * cashflows.length);
      expect(Decimal.precision).toBe(30);
    } finally { spy.mockRestore(); }
  });
});
