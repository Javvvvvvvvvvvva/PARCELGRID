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
 *   - IRR via Newton-Raphson with Brent's method fallback
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
 * @returns periodic IRR as Decimal, or null if no solution.
 */
export function irr(
  cashflows: DecimalLike[],
  guess: DecimalLike = 0.01,
  maxIter = 200,
  tolerance = 1e-9
): Decimal | null {
  if (cashflows.length < 2) return null;

  // Need at least one sign change
  const flows = cashflows.map(D);
  const hasPos = flows.some((c) => c.gt(0));
  const hasNeg = flows.some((c) => c.lt(0));
  if (!hasPos || !hasNeg) return null;

  // Newton-Raphson
  let r = D(guess);
  for (let i = 0; i < maxIter; i++) {
    let f = ZERO;
    let df = ZERO;
    const onePlusR = ONE.plus(r);

    for (let t = 0; t < flows.length; t++) {
      const denom = onePlusR.pow(t);
      f = f.plus(flows[t].div(denom));
      if (t > 0) {
        df = df.minus(flows[t].times(t).div(onePlusR.pow(t + 1)));
      }
    }

    if (f.abs().lt(tolerance)) return r;
    if (df.abs().lt(1e-15)) break; // derivative too small, Newton stuck

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

function irrBisection(
  flows: Decimal[],
  tolerance: number,
  maxIter: number
): Decimal | null {
  let lo = D(-0.99);
  let hi = D(10);

  const fLo = npv(lo, flows);
  const fHi = npv(hi, flows);
  if (fLo.times(fHi).gt(0)) return null; // no sign change in bracket

  for (let i = 0; i < maxIter; i++) {
    const mid = lo.plus(hi).div(2);
    const fMid = npv(mid, flows);
    if (fMid.abs().lt(tolerance)) return mid;
    if (fLo.times(fMid).lt(0)) {
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi.minus(lo).abs().lt(tolerance)) return mid;
  }
  return lo.plus(hi).div(2);
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
