/**
 * Preliminary Korean development tax reference.
 *
 * This module deliberately does not claim to produce a filing-ready tax
 * amount. Only items that can be estimated from the current project model are
 * calculated. Items requiring a statutory tax base, VAT allocation, entity
 * facts or tax adjustments are marked not-calculated.
 */

import { D, toManWon } from "./math";
import type { Parcel, ScenarioResult, TaxBreakdown, TaxLine } from "./types";

export const TAX_MODEL_AS_OF = "2026-01-01";

/**
 * General-case reference rates. Acquisition taxes still depend on the asset,
 * buyer, location and available exemptions. Corporate brackets follow the
 * National Tax Service table for fiscal years beginning on/after 2026-01-01.
 */
export const TAX_RATES = {
  acquisitionLandGeneral: 0.046,
  acquisitionBuildingOriginalEstimate: 0.0316,
  corporateBrackets: [
    { upperWon: 200_000_000, rate: 0.10 },
    { upperWon: 20_000_000_000, rate: 0.20 },
    { upperWon: 300_000_000_000, rate: 0.22 },
    { upperWon: Number.POSITIVE_INFINITY, rate: 0.25 },
  ],
} as const;

export interface TaxInput {
  parcel: Parcel;
  result: ScenarioResult;
  residentialSaleShare?: number;
}

function progressiveCorporateTaxWon(taxableIncomeWon: number): number {
  let remaining = Math.max(0, taxableIncomeWon);
  let lower = 0;
  let tax = 0;

  for (const bracket of TAX_RATES.corporateBrackets) {
    if (remaining <= 0) break;
    const width = Number.isFinite(bracket.upperWon)
      ? bracket.upperWon - lower
      : remaining;
    const taxableInBracket = Math.min(remaining, width);
    tax += taxableInBracket * bracket.rate;
    remaining -= taxableInBracket;
    lower = bracket.upperWon;
  }
  return tax;
}

export function calculateTaxes(input: TaxInput): TaxBreakdown {
  const { parcel, result } = input;
  const lines: TaxLine[] = [];

  const currentBuildingStatus = parcel.currentBuilding?.hasBuilding;

  if (currentBuildingStatus === false) {
    const acquisitionLand = D(parcel.acquiredPrice).times(
      TAX_RATES.acquisitionLandGeneral
    );
    lines.push({
      tax: "취득세",
      base: "토지",
      rate: "일반 4.6% 가정",
      amount: toManWon(acquisitionLand),
      note:
        "건축물대장상 빈 토지로 확인된 부동산 총 취득대금 기준 · 법인 비농지 일반 유상취득 예비값",
      status: "estimated",
      source: "지방세법 일반세율 참고",
    });
  } else {
    lines.push({
      tax: "취득세",
      base: "부동산 총 취득대금",
      rate: "미산정",
      amount: 0,
      note:
        currentBuildingStatus === true
          ? "기존 건축물이 있어 계약대금의 토지·건물 안분과 매수인·물건 사실관계가 필요합니다."
          : "건축물 존재 여부와 계약대금의 토지·건물 안분이 확인되지 않았습니다.",
      status: "not-calculated",
      source: "계약서·건축물대장·토지/건물 안분 자료 필요",
    });
  }

  const buildingBase = D(result.hardCost).plus(D(result.softCost));
  const acquisitionBuilding = buildingBase.times(
    TAX_RATES.acquisitionBuildingOriginalEstimate
  );
  lines.push({
    tax: "취득세",
    base: "신축 건물",
    rate: "3.16% 가정",
    amount: toManWon(acquisitionBuilding),
    note: "원시취득 부가세목 포함 예비값 · 실제 과세표준 확인 필요",
    status: "estimated",
    source: "지방세법 원시취득 일반 기준 참고",
  });

  lines.push({
    tax: "재산세",
    base: "보유",
    rate: "미산정",
    amount: 0,
    note: "시가표준액·공정시장가액비율·과세기준일 정보가 없어 계산하지 않음",
    status: "not-calculated",
    source: "지방세법상 과세표준 입력 필요",
  });

  const profitWon = Math.max(result.profit, 0) * 10_000;
  const corporateTaxWon = progressiveCorporateTaxWon(profitWon);
  lines.push({
    tax: "법인세",
    base: "세전 모델 손익",
    rate: "10~25%",
    amount: Math.round(corporateTaxWon / 10_000),
    note: "2026 기본세율 단순 적용 · 세무조정과 토지 등 양도소득 추가과세 미반영",
    status: "estimated",
    source: "국세청 2026년 이후 법인세율",
  });

  lines.push({
    tax: "부가세",
    base: "분양·공급",
    rate: "미산정",
    amount: 0,
    note: "토지·건물 안분, 주택 면세, 국민주택규모, 매입세액 자료가 없어 계산하지 않음",
    status: "not-calculated",
    source: "부가가치세 과세·면세 사실관계 확인 필요",
  });

  const total = lines
    .filter((line) => line.status === "estimated")
    .reduce((sum, line) => sum + line.amount, 0);

  return {
    lines,
    total,
    asOf: TAX_MODEL_AS_OF,
    complete: false,
    warnings: [
      "표시 합계는 계산 가능한 항목의 부분 추정액이며 총 세부담이 아닙니다.",
      ...(currentBuildingStatus === false
        ? []
        : [
            "기존 건축물 상태 또는 토지·건물 안분이 미확정되어 취득세를 계산하지 않았습니다.",
          ]),
      "재산세와 부가세는 필수 과세자료가 없어 금액을 계산하지 않았습니다.",
      "법인세는 세무조정 전 모델 손익에 기본세율만 적용했습니다.",
    ],
  };
}
