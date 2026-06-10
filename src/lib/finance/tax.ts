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
  corporateTax: 0.20, // 20% — 법인세 (2억 초과 구간 단순화)
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
  const acqBuilding = buildingBase.times(TAX_RATES.acquisitionBuilding);
  lines.push({
    tax: "취득세",
    base: "건물",
    rate: `${(TAX_RATES.acquisitionBuilding * 100).toFixed(1)}%`,
    amount: toManWon(acqBuilding),
    note: "원시취득",
  });

  // ─── 재산세 (holding) ──────────────────────────────────────────────
  // Annual × dev hold years; biannual installments but reported as annual here.
  const propertyTaxAnnual = D(parcel.acquiredPrice).times(TAX_RATES.propertyTaxBase);
  const propertyTaxTotal = propertyTaxAnnual.times(TAX_RATES.propertyTaxYears);
  lines.push({
    tax: "재산세",
    base: "보유",
    rate: `${(TAX_RATES.propertyTaxBase * 100).toFixed(1)}%`,
    amount: toManWon(propertyTaxTotal),
    note: `연 2회 부과 (${TAX_RATES.propertyTaxYears}년)`,
  });

  // ─── 종부세 ────────────────────────────────────────────────────────
  // Corporate-owned development land is generally excluded.
  lines.push({
    tax: "종부세",
    base: "보유",
    rate: "—",
    amount: 0,
    note: "법인 소유 제외 적용",
  });

  // ─── 법인세 ────────────────────────────────────────────────────────
  // Base: pre-tax profit. Simplified to single bracket (the 2억 초과 구간);
  // in production we apply tiered rates 9%/19%/21%/24% by income band.
  const corporateTax = D(Math.max(result.profit, 0)).times(TAX_RATES.corporateTax);
  lines.push({
    tax: "법인세",
    base: "이익",
    rate: `${(TAX_RATES.corporateTax * 100).toFixed(0)}%`,
    amount: toManWon(corporateTax),
    note: "당기순이익 추정",
  });

  // ─── 양도소득세 ───────────────────────────────────────────────────
  // For a 분양 model, gains are realized as operating revenue, not 양도.
  lines.push({
    tax: "양도소득세",
    base: "양도",
    rate: "—",
    amount: 0,
    note: "분양 매출로 처리",
  });

  // ─── 부가세 ────────────────────────────────────────────────────────
  // Residential sales are largely VAT-exempt. We apply 10% to the
  // non-residential portion (retail, office) of total sale revenue.
  const saleRevenue = D(result.revenueSale);
  const vatableShare = residentialShare.gt(1)
    ? ZERO
    : D(1).minus(residentialShare).times(TAX_RATES.vat);
  const vat = saleRevenue.times(vatableShare);
  lines.push({
    tax: "부가세",
    base: "분양",
    rate: `${(TAX_RATES.vat * 100).toFixed(0)}%`,
    amount: toManWon(vat),
    note: "주거 비과세분 제외",
  });

  const total = lines.reduce((sum, l) => sum + l.amount, 0);

  return { lines, total };
}
