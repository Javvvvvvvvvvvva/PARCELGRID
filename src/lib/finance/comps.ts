/**
 * Comparable sales analysis — 실거래 비교.
 *
 * Given a target parcel and a set of recent transactions, produce:
 *   1. Distance-weighted median price/평
 *   2. Hedonic adjustments per comp (size, FAR, age, distance)
 *   3. Per-comp "applied to target" estimated price
 *
 * Hedonic model:
 *   Adjusted price/평 = comp price/평 × Π(adjustment factors)
 *
 *   Adjustment factors (multiplicative, conservative defaults):
 *     - Distance: 1 + (distKm × -0.02)         price drops 2%/km
 *     - FAR delta: 1 + (FAR_target − FAR_comp) × 0.003   3%/100bp FAR
 *     - Lot size delta: 1 + ((target − comp) / comp) × -0.05   diseconomies of scale
 *     - Recency: 1 + monthsAgo × 0.003          0.3%/month appreciation in 강남
 *
 * These coefficients are deliberately mild. In production we'd fit them
 * to the regional KAB dataset via OLS regression, but the user should be
 * able to override each coefficient — every adjustment shown in the UI
 * cites the coefficient that produced it.
 */

import { D, ONE, HUNDRED, toPct } from "./math";

export interface Comp {
  id: string;
  date: string; // ISO date
  address: string;
  type: string;
  area: number; // 대지면적 m²
  gfa: number; // 연면적 m²
  price: number; // 만원
  pricePerPyeong: number; // 만원/평
  far: number; // %
  dist: number; // km
}

export interface CompTarget {
  lotArea: number; // m²
  plannedFAR: number; // %
}

export interface CompAdjustment {
  comp: Comp;
  factors: {
    distance: number;
    far: number;
    size: number;
    recency: number;
  };
  totalFactor: number;
  adjustedPricePerPyeong: number; // 만원/평
  /** Percent adjustment from raw comp price to adjusted, e.g. +1.8 */
  adjustmentPct: number;
}

export interface CompAnalysis {
  adjustments: CompAdjustment[];
  /** Weighted median adjusted 만원/평 — the headline estimate. */
  estimatedPricePerPyeong: number;
  /** Distribution: 5th, 25th, 50th, 75th, 95th percentiles of adjusted prices. */
  distribution: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
}

const COEFF = {
  distancePerKm: -0.02,
  farPerPctPoint: 0.003,
  sizeDiseconomy: -0.05,
  recencyPerMonth: 0.003,
} as const;

export function analyzeComps(
  target: CompTarget,
  comps: Comp[],
  asOf: string = new Date().toISOString()
): CompAnalysis {
  const asOfDate = new Date(asOf);

  const adjustments: CompAdjustment[] = comps.map((comp) => {
    // Distance factor
    const fDist = ONE.plus(D(comp.dist).times(COEFF.distancePerKm));

    // FAR factor (positive if target FAR > comp FAR — denser → higher value)
    const farDelta = target.plannedFAR - comp.far;
    const fFAR = ONE.plus(D(farDelta).times(COEFF.farPerPctPoint));

    // Size factor — diseconomy with deviation in either direction
    // (smaller comp than target → comp price slightly inflated; larger comp → deflated)
    const sizeDelta = (target.lotArea - comp.area) / comp.area;
    const fSize = ONE.plus(D(sizeDelta).times(COEFF.sizeDiseconomy));

    // Recency factor
    const monthsAgo = monthsBetween(new Date(comp.date), asOfDate);
    const fRecency = ONE.plus(D(monthsAgo).times(COEFF.recencyPerMonth));

    const total = fDist.times(fFAR).times(fSize).times(fRecency);
    const adjPrice = D(comp.pricePerPyeong).times(total);

    return {
      comp,
      factors: {
        distance: fDist.toDecimalPlaces(4).toNumber(),
        far: fFAR.toDecimalPlaces(4).toNumber(),
        size: fSize.toDecimalPlaces(4).toNumber(),
        recency: fRecency.toDecimalPlaces(4).toNumber(),
      },
      totalFactor: total.toDecimalPlaces(4).toNumber(),
      adjustedPricePerPyeong: Math.round(adjPrice.toNumber()),
      adjustmentPct: toPct(total.minus(ONE).times(HUNDRED), 2),
    };
  });

  // Distance-weighted median for the headline estimate
  const estimated = weightedMedian(
    adjustments.map((a) => a.adjustedPricePerPyeong),
    adjustments.map((a) => 1 / Math.max(0.1, a.comp.dist))
  );

  // Distribution percentiles (unweighted, for the box plot)
  const sorted = [...adjustments]
    .map((a) => a.adjustedPricePerPyeong)
    .sort((x, y) => x - y);

  return {
    adjustments,
    estimatedPricePerPyeong: Math.round(estimated),
    distribution: {
      p5: percentile(sorted, 5),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p95: percentile(sorted, 95),
    },
  };
}

function monthsBetween(a: Date, b: Date): number {
  return (
    (b.getFullYear() - a.getFullYear()) * 12 +
    (b.getMonth() - a.getMonth())
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function weightedMedian(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  const pairs = values
    .map((v, i) => ({ v, w: weights[i] }))
    .sort((a, b) => a.v - b.v);
  const totalW = pairs.reduce((s, p) => s + p.w, 0);
  let cum = 0;
  for (const p of pairs) {
    cum += p.w;
    if (cum >= totalW / 2) return p.v;
  }
  return pairs[pairs.length - 1].v;
}
