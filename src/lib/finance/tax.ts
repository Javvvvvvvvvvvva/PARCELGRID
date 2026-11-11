/**
 * Statutory tax boundary for preliminary feasibility.
 *
 * Reference rates are shown to help a reviewer identify the applicable law.
 * They are never multiplied by project-model proxies and presented as tax due.
 * Filing facts and expert-confirmed payment timing belong in the separate
 * after-tax ledger contract.
 */

import type { Parcel, ScenarioResult, TaxBreakdown, TaxLine } from "./types";

export const TAX_MODEL_AS_OF = "2026-09-09";
export const TAX_MODEL_VERSION = "tax-pretax-ledger-2026.1";

export const TAX_RATES = {
  realEstateAcquisitionGeneral: 0.04,
  originalBuildingAcquisitionBase: 0.028,
  corporateBrackets: [
    { upperWon: 200_000_000, rate: 0.1 },
    { upperWon: 20_000_000_000, rate: 0.2 },
    { upperWon: 300_000_000_000, rate: 0.22 },
    { upperWon: Number.POSITIVE_INFINITY, rate: 0.25 },
  ],
} as const;

export const TAX_REFERENCE_URLS = {
  acquisitionTax:
    "https://law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1021846727",
  corporateTaxRates:
    "https://j.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7746&mi=2372",
  corporateTaxAct:
    "https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900180725",
  vatExemptions:
    "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1027278361",
  localCorporateIncomeTax:
    "https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=21&joNo=0103&lsiSeq=282559&urlMode=lsScJoRltInfoR",
} as const;

export interface TaxInput {
  parcel: Parcel;
  result: ScenarioResult;
  residentialSaleShare?: number;
}

export function calculateTaxes(input: TaxInput): TaxBreakdown {
  const { parcel, result } = input;
  const lines: TaxLine[] = [];

  if (result.acquisitionTax > 0) {
    lines.push({
      tax: "기존 부동산 취득세",
      base: "세전 사업비 원장",
      rate: "원장 입력",
      amount: result.acquisitionTax,
      note:
        "세전 총사업비와 자기자본 현금흐름에 이미 포함된 금액입니다. 세후 원장에서 다시 차감하지 않습니다.",
      status: "included-in-pretax",
      source: "Stage 3 acquisitionTaxManwon 입력 · 신고 근거 대사 필요",
    });
  } else {
    const buildingFact = parcel.currentBuilding?.hasBuilding;
    lines.push({
      tax: "기존 부동산 취득세",
      base: "계약상 취득 과세표준",
      rate: "일반 부동산 본세 4% 참고",
      amount: 0,
      note:
        buildingFact === true
          ? "기존 건축물이 있어 토지·건물 안분, 매수인과 물건 사실관계, 부가세목 검토가 필요합니다."
          : buildingFact === false
            ? "빈 토지로 확인됐지만 과세표준, 매수인, 중과·감면과 부가세목을 검토하지 않아 세액을 계산하지 않습니다."
            : "건축물 존재 여부, 토지·건물 안분, 매수인과 물건 사실관계가 확인되지 않았습니다.",
      status: "not-calculated",
      source: TAX_REFERENCE_URLS.acquisitionTax,
    });
  }

  lines.push({
    tax: "신축 건물 취득세",
    base: "지방세법상 원시취득 과세표준",
    rate: "본세 2.8% 참고",
    amount: 0,
    note:
      "공사비와 간접비 합계는 법정 과세표준이 아닙니다. 과세표준과 지방교육세·농어촌특별세 등 적용 세목을 확인해야 합니다.",
    status: "reference-only",
    source: TAX_REFERENCE_URLS.acquisitionTax,
  });

  lines.push({
    tax: "재산세·보유세",
    base: "보유기간별 과세표준",
    rate: "사실관계별",
    amount: 0,
    note:
      "시가표준액, 과세기준일, 사업주체와 보유기간 자료가 없어 계산하지 않습니다.",
    status: "not-calculated",
    source: "지방세법상 과세표준과 과세기준일 확인 필요",
  });

  lines.push({
    tax: "부가가치세 순정산",
    base: "과세·면세 공급 및 공통매입세액",
    rate: "사실관계별",
    amount: 0,
    note:
      "토지·건물 안분, 주택 면세, 국민주택규모와 매입세액 공제 자료가 없어 납부·환급액을 계산하지 않습니다.",
    status: "not-calculated",
    source: TAX_REFERENCE_URLS.vatExemptions,
  });

  lines.push({
    tax: "법인세·소득세",
    base: "세무조정 후 과세표준",
    rate: "법인 기본세율 10~25% 참고",
    amount: 0,
    note:
      "프로젝트 세전손익은 신고 과세표준이 아닙니다. 사업주체, 손금·익금 조정, 결손금과 처분 추가과세를 반영해야 합니다.",
    status: "reference-only",
    source: TAX_REFERENCE_URLS.corporateTaxRates,
  });

  lines.push({
    tax: "지방소득세",
    base: "확정된 법인세·소득세 과세표준",
    rate: "사실관계별",
    amount: 0,
    note: "국세와 분리해 납세지·과세표준·신고 일정을 확인해야 합니다.",
    status: "not-calculated",
    source: TAX_REFERENCE_URLS.localCorporateIncomeTax,
  });

  lines.push({
    tax: "토지·주택 처분 추가과세",
    base: "자산·사업주체별 처분소득",
    rate: "적용 여부 확인",
    amount: 0,
    note:
      "비사업용 토지와 주택 등 추가과세 여부를 판정할 사실관계가 없어 계산하지 않습니다.",
    status: "not-calculated",
    source: TAX_REFERENCE_URLS.corporateTaxAct,
  });

  const includedInPretaxTotal = lines
    .filter((line) => line.status === "included-in-pretax")
    .reduce((sum, line) => sum + line.amount, 0);

  return {
    modelVersion: TAX_MODEL_VERSION,
    lines,
    total: includedInPretaxTotal,
    includedInPretaxTotal,
    incrementalAfterTaxTotal: 0,
    asOf: TAX_MODEL_AS_OF,
    complete: false,
    warnings: [
      "표시된 취득세 반영액은 세전 사업비에 이미 포함되어 추가 세후 차감액이 아닙니다.",
      "법정 참고세율은 세액 추정에 직접 적용하지 않습니다.",
      "세후 수익은 세무 전문가가 세목별 납부·환급액과 시점을 입력한 별도 원장에서만 계산합니다.",
    ],
  };
}
