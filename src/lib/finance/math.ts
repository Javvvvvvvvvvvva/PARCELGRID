/**
 * Decimal-based math primitives for financial calculations.
 *
 * Why Decimal: JavaScript's Number is IEEE 754 binary floating point.
 * `0.1 + 0.2 === 0.30000000000000004`. For a real estate model where
 * 1만원 errors compound across 9 quarters and dozens of line items,
 * this would produce visibly wrong DSCR / IRR. Use Decimal everywhere
 * intermediate math happens, then convert to Number only at the boundary
 * (display, storage, API response).
 *
 * Numerical methods here:
 *   - IRR via Newton-Raphson with bisection fallback
 *   - NPV (straightforward)
 *   - DSCR (NOI / debt service)
 *   - Equity multiple (cumulative distributions / equity)
 */

import Decimal from "decimal.js";

Decimal.set({
  precision: 30,
  rounding: Decimal.ROUND_HALF_EVEN, // banker's rounding
  toExpNeg: -9,
  toExpPos: 21,
});

export { Decimal };

export type DecimalLike = Decimal | number | string;

export const D = (x: DecimalLike): Decimal => new Decimal(x);
export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
export const HUNDRED = new Decimal(100);

/** Round to the nearest integer 만원 for display/storage. */
export const toManWon = (d: Decimal): number =>
  d.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber();

export const toPct = (d: Decimal, decimals = 1): number =>
  d.toDecimalPlaces(decimals).toNumber();

// ─────────────────────────── NPV ───────────────────────────

/**
 * Net Present Value at a given periodic rate.
 *
 * @param rate periodic rate (e.g. monthly = annual/12). Decimal.
 * @param cashflows period cashflows, cashflows[0] is period 0 (today).
 * @returns NPV as Decimal.
 */
export function npv(rate: DecimalLike, cashflows: DecimalLike[]): Decimal {
  const r = D(rate);
  let total = ZERO;
  let factor = ONE;
  const onePlusR = ONE.plus(r);
  for (let t = 0; t < cashflows.length; t++) {
    total = total.plus(D(cashflows[t]).div(factor));
    factor = factor.times(onePlusR);
  }
  return total;
}

// ─────────────────────────── IRR ───────────────────────────

/**
 * Internal Rate of Return.
 *
 * Strategy:
 *   1. Quick sanity check — needs at least one positive and one negative flow.
 *   2. Newton-Raphson from a sensible initial guess.
 *   3. If Newton diverges (rate becomes unreasonable or derivative ~0),
 *      fall back to bisection in a bracketed range.
 *
 * Returns the *periodic* IRR. For monthly cashflows the caller annualizes:
 *   annualIRR = (1 + monthlyIRR)^12 - 1
 *
 * Newton accepts rates in (-1, 10]; fallback searches only [-0.99, 10].
 * With multiple roots, returns the first converged Newton iterate for the
 * supplied guess, otherwise a converged fallback endpoint or bracketed root.
 * This does not establish uniqueness or guarantee finding every valid root.
 * Residuals must satisfy both absolute and relative (discounted magnitude)
 * tolerance. A narrow bracket alone does not establish convergence.
 *
 * @returns periodic IRR as Decimal, or null for invalid numeric inputs or when
 * no root converges within the search bounds and iteration budget.
 */
export function irr(
  cashflows: DecimalLike[],
  guess: DecimalLike = 0.01,
  maxIter = 200,
  tolerance = 1e-9
): Decimal | null {
  if (
    cashflows.length < 2 ||
    !Number.isSafeInteger(maxIter) || maxIter <= 0 ||
    !Number.isFinite(tolerance) || tolerance <= 0
  ) return null;

  // Need at least one sign change
  const flows = cashflows.map(D);
  if (flows.some((flow) => !flow.isFinite())) return null;
  const hasPos = flows.some((c) => c.gt(0));
  const hasNeg = flows.some((c) => c.lt(0));
  if (!hasPos || !hasNeg) return null;

  // Newton-Raphson
  let r = D(guess);
  if (!r.isFinite() || r.lte(-1) || r.gt(10)) return null;
  const flowScale = flows.reduce(
    (scale, flow) => Decimal.max(scale, flow.abs()), ZERO,
  );
  const derivativeTolerance = Decimal.min(ONE, flowScale).times(1e-15);
  for (let i = 0; i < maxIter; i++) {
    let f = ZERO;
    let df = ZERO;
    let magnitude = ZERO;
    const onePlusR = ONE.plus(r);
    let denom = ONE;

    for (let t = 0; t < flows.length; t++) {
      // The derivative's power is the next period's denominator. Reuse it
      // without replacing Decimal.pow with differently rounded multiplication.
      const nextDenom = onePlusR.pow(t + 1);
      const presentValue = flows[t].div(denom);
      f = f.plus(presentValue);
      magnitude = magnitude.plus(presentValue.abs());
      if (t > 0) {
        df = df.minus(flows[t].times(t).div(nextDenom));
      }
      denom = nextDenom;
    }

    if (irrResidualConverged(f, magnitude, tolerance)) return r;
    if (!f.isFinite() || !df.isFinite() || df.abs().lt(derivativeTolerance)) break;

    const next = r.minus(f.div(df));

    // Guard against runaway
    if (next.lte(-1) || next.gt(10) || !Number.isFinite(next.toNumber())) {
      break;
    }

    r = next;
  }

  // Fall back to bisection
  return irrBisection(flows, tolerance, maxIter);
}

function irrResidualConverged(
  residual: Decimal,
  magnitude: Decimal,
  tolerance: number,
): boolean {
  return residual.isFinite() && magnitude.isFinite() && magnitude.gt(0) &&
    residual.abs().lt(Decimal.min(ONE, magnitude).times(tolerance));
}

function irrBisection(
  flows: Decimal[],
  tolerance: number,
  maxIter: number
): Decimal | null {
  let lo = D(-0.99);
  let hi = D(10);
  const absoluteFlows = flows.map((flow) => flow.abs());
  const converged = (rate: Decimal, residual: Decimal) =>
    irrResidualConverged(residual, npv(rate, absoluteFlows), tolerance);

  let fLo = npv(lo, flows);
  const fHi = npv(hi, flows);
  if (converged(lo, fLo)) return lo;
  if (converged(hi, fHi)) return hi;
  if (
    !fLo.isFinite() || !fHi.isFinite() || fLo.isZero() || fHi.isZero() ||
    fLo.isPositive() === fHi.isPositive()
  ) return null;

  for (let i = 0; i < maxIter; i++) {
    const mid = lo.plus(hi).div(2);
    const fMid = npv(mid, flows);
    if (converged(mid, fMid)) return mid;
    if (!fMid.isFinite() || fMid.isZero() || mid.eq(lo) || mid.eq(hi)) return null;
    if (fLo.isPositive() !== fMid.isPositive()) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return null;
}

/** Convert periodic IRR to annual. */
export function annualizeIRR(periodicIRR: Decimal, periodsPerYear: number): Decimal {
  return ONE.plus(periodicIRR).pow(periodsPerYear).minus(ONE);
}

// ─────────────────────────── DSCR ───────────────────────────

/**
 * Debt Service Coverage Ratio = NOI / annual debt service.
 *
 * For a development project we evaluate DSCR at stabilized year-1 NOI
 * against the PF's first full year of principal+interest.
 */
export function dscr(noi: DecimalLike, debtService: DecimalLike): Decimal {
  const ds = D(debtService);
  if (ds.lte(0)) return D(Infinity);
  return D(noi).div(ds);
}

// ─────────────────────────── Annuity ───────────────────────────

/** Level annual payment for a fully-amortizing loan. */
export function annualMortgagePayment(
  principal: DecimalLike,
  annualRate: DecimalLike,
  years: number
): Decimal {
  const p = D(principal);
  const r = D(annualRate);
  if (r.eq(0)) return p.div(years);
  const onePlusR = ONE.plus(r);
  const factor = onePlusR.pow(years);
  return p.times(r).times(factor).div(factor.minus(ONE));
}

/** Level monthly payment for a fully-amortizing loan. */
export function monthlyMortgagePayment(
  principal: DecimalLike,
  annualRate: DecimalLike,
  years: number,
): Decimal {
  const p = D(principal);
  const periods = years * 12;
  const r = D(annualRate).div(12);
  if (r.eq(0)) return p.div(periods);
  const factor = ONE.plus(r).pow(periods);
  return p.times(r).times(factor).div(factor.minus(ONE));
}

/** Interest-only annual payment. */
export function interestOnly(principal: DecimalLike, annualRate: DecimalLike): Decimal {
  return D(principal).times(D(annualRate));
}

// ─────────────────────────── Equity multiple ───────────────────────────

export function equityMultiple(
  cumulativeDistributions: DecimalLike,
  equityInvested: DecimalLike
): Decimal {
  const e = D(equityInvested);
  if (e.lte(0)) return ZERO;
  return D(cumulativeDistributions).div(e);
}
