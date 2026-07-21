/**
 * Acquisition price input conversions for Stage 1 and Stage 3.
 *
 * Finance stores acquisition prices as 만원 total. UI may display either
 * total 만원 or 만원/평, but must convert back to the same total value.
 */

export const ACQUISITION_SQM_PER_PYEONG = 3.305785;

export type AcquisitionPriceMode = "total" | "per-pyeong";
export type AcquisitionPriceAssessment =
  | { status: "unknown"; ratioPct: 0 }
  | { status: "extreme-low" | "within-range" | "extreme-high"; ratioPct: number };

export function acquisitionLotPyeong(lotAreaSqm: number): number {
  if (!Number.isFinite(lotAreaSqm) || lotAreaSqm <= 0) return 0;
  return lotAreaSqm / ACQUISITION_SQM_PER_PYEONG;
}

export function acquisitionPricePerPyeong(
  totalManwon: number,
  lotAreaSqm: number
): number {
  const lotPyeong = acquisitionLotPyeong(lotAreaSqm);
  if (!Number.isFinite(totalManwon) || totalManwon < 0 || lotPyeong <= 0) {
    return 0;
  }
  return totalManwon / lotPyeong;
}

export function acquisitionPriceTotal(
  perPyeongManwon: number,
  lotAreaSqm: number
): number {
  const lotPyeong = acquisitionLotPyeong(lotAreaSqm);
  if (
    !Number.isFinite(perPyeongManwon) ||
    perPyeongManwon < 0 ||
    lotPyeong <= 0
  ) {
    return 0;
  }
  return Math.round(perPyeongManwon * lotPyeong);
}

/**
 * Flags likely unit mistakes without blocking scenario testing.
 * The 0.3x–3.0x band matches the acquisition estimator's disclosed
 * cross-check band; values outside it require explicit user review.
 */
export function assessAcquisitionPrice(
  totalManwon: number,
  referenceManwon: number
): AcquisitionPriceAssessment {
  if (
    !Number.isFinite(totalManwon) ||
    !Number.isFinite(referenceManwon) ||
    totalManwon < 0 ||
    referenceManwon <= 0
  ) {
    return { status: "unknown", ratioPct: 0 };
  }

  const ratio = totalManwon / referenceManwon;
  const ratioPct = ratio * 100;
  if (ratio < 0.3) return { status: "extreme-low", ratioPct };
  if (ratio > 3) return { status: "extreme-high", ratioPct };
  return { status: "within-range", ratioPct };
}
