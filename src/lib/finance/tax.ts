/**
 * Korean real estate development tax engine.
 *
 * Covers the tax lines an investment committee report needs:
 *   - 취득세 (acquisition tax) — land + building
 *   - 재산세 (property tax) — annual holding
 *   - 종합부동산세 (comprehensive RE tax) — if applicable
 *   - 법인세 (corporate income tax) — on profit
 *   - 부가가치세 (VAT) — on non-residential sales
 *
 * Important: tax law in Korea changes frequently and has many exemptions
 * (e.g. 재개발/재건축 감면, 청년주택 특례). This engine encodes the
 * BASE rates for a corporate-owned mid-rise development. Always cross-
 * check final numbers with a tax accountant — the engine outputs an
 * AUDIT TRAIL with every rate citation so accountants can verify.
 *
 * Rates are stored as Decimals in a separate table so they can be updated
 * without code changes when the National Tax Service revises them.
 */

import { D, ZERO, HUNDRED, toManWon, Decimal } from "./math";
import type { Parcel, ScenarioResult, TaxBreakdown, TaxLine } from "./types";

/**
 * Tax rate table. Effective rates as of March 2025 for corporate-owned,
 * non-luxury residential mid-rise in Seoul.
 *
 * Sources cited per line for the auditor. In production this table is
 * versioned and date-stamped so historical reports stay reproducible.
 */
export const TAX_RATES = {
  acquisitionLand: 0.046, // 4.6% — 토지 매매 취득
  acquisitionBuilding: 0.028, // 2.8% — 원시취득 (신축)
  propertyTaxBase: 0.004, // 0.4% — 재산세 base
  propertyTaxYears: 4, // hold period during dev
  corporateTaxLow: 0.09, // 9% — 법인세 과표 2억 이하
  corporateTaxHigh: 0.19, // 19% — 법인세 과표 2억 초과
  corporateBracket: 200_000_000, // 2억 (원) 과표 구간
  acquisitionBuildingTotal: 0.0316, // 3.16% — 원시취득 + 농특세·지방교육세
  vat: 0.10, // 10% — 부가세
  vatExemptResidentialShare: 0.85, // 주거 비과세 비중
} as const;

export interface TaxInput {
  parcel: Parcel;
  result: ScenarioResult;
  // For VAT we need the share of revenue that is residential sale
  residentialSaleShare?: number; // 0..1
}

export function calculateTaxes(input: TaxInput): TaxBreakdown {
  const { parcel, result } = input;
  const residentialShare = D(input.residentialSaleShare ?? 0.7);

  const lines: TaxLine[] = [];

  // ─── 취득세 (토지) ─────────────────────────────────────────────────
  // Base: acquisition price (use higher of contract price vs. assessed value
  // in practice; here we use the actual price the buyer paid).
  const acqLand = D(parcel.acquiredPrice).times(TAX_RATES.acquisitionLand);
  lines.push({
    tax: "취득세",
    base: "토지",
    rate: `${(TAX_RATES.acquisitionLand * 100).toFixed(1)}%`,
    amount: toManWon(acqLand),
    note: "공시지가 기준",
  });

  // ─── 취득세 (건물) ─────────────────────────────────────────────────
  // Base: total hard + soft cost (the value of the building being created).
  const buildingBase = D(result.hardCost).plus(D(result.softCost));
  const acqBuilding = buildingBase.times(TAX_RATES.acquisitionBuildingTotal);
  lines.push({
    tax: "취득세",
    base: "건물",
    rate: `${(TAX_RATES.acquisitionBuildingTotal * 100).toFixed(2)}%`,
    amount: toManWon(acqBuilding),
    note: "원시취득 (농특세·교육세 포함)",
  });

  // ─── 재산세 (holding) ──────────────────────────────────────────────
  // Annual × dev hold years; biannual installments but reported as annual here.
  const holdYears = Math.max(1, result.totalMonths / 12);
  const propertyTaxAnnual = D(parcel.acquiredPrice).times(TAX_RATES.propertyTaxBase);
  const propertyTaxTotal = propertyTaxAnnual.times(D(holdYears));
  lines.push({
    tax: "재산세",
    base: "보유",
    rate: `${(TAX_RATES.propertyTaxBase * 100).toFixed(1)}%`,
    amount: toManWon(propertyTaxTotal),
    note: `시행기간 ${result.totalMonths}개월 (${holdYears.toFixed(1)}년)`,
  });

  // ─── 법인세 ────────────────────────────────────────────────────────
  // Base: pre-tax profit. Simplified to single bracket (the 2억 초과 구간);
  // in production we apply tiered rates 9%/19%/21%/24% by income band.
  // 과표 구간: 2억 이하 9%, 초과분 19% (원 단위로 환산해 계산)
  const profitWon = Math.max(result.profit, 0) * 10_000;
  const bracket = TAX_RATES.corporateBracket;
  const corpTaxWon =
    profitWon <= bracket
      ? profitWon * TAX_RATES.corporateTaxLow
      : bracket * TAX_RATES.corporateTaxLow +
        (profitWon - bracket) * TAX_RATES.corporateTaxHigh;
  lines.push({
    tax: "법인세",
    base: "처분이익",
    rate: profitWon <= bracket ? "9%" : "9~19%",
    amount: Math.round(corpTaxWon / 10_000),
    note: "2억 이하 9% · 초과 19% (분양 익금)",
  });

  // ─── 부가세 ────────────────────────────────────────────────────────
  // Residential sales are largely VAT-exempt. We apply 10% to the
  // non-residential portion (retail, office) of total sale revenue.
  const saleRevenue = D(result.revenueSale);
  const vatableShare = residentialShare.gt(1)
    ? ZERO
    : D(1).minus(residentialShare).times(TAX_RATES.vat);
  const vat = saleRevenue.times(vatableShare);
  const vatAmount = toManWon(vat);
  lines.push({
    tax: "부가세",
    base: "분양",
    rate: vatAmount > 0 ? `${(TAX_RATES.vat * 100).toFixed(0)}%` : "면세",
    amount: vatAmount,
    note: vatAmount > 0 ? "비주거분 과세" : "국민주택 면세",
  });

  const total = lines.reduce((sum, l) => sum + l.amount, 0);

  return { lines, total };
}
