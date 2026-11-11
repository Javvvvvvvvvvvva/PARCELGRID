import type { AssumptionSet } from "./types";

export interface AssumptionValueRule {
  label: string;
  min: number;
  max: number;
  integer?: boolean;
}

export const ASSUMPTION_VALUE_RULES: Record<
  keyof AssumptionSet,
  AssumptionValueRule
> = {
  rentPerSqMMonth: {
    label: "월 임대료",
    min: 0,
    max: 1_000_000_000,
  },
  salePricePerSqM: {
    label: "매각·분양 단가",
    min: 0,
    max: 1_000_000_000,
  },
  vacancyRate: { label: "공실률", min: 0, max: 100 },
  operatingExpenseRate: { label: "운영비율", min: 0, max: 100 },
  capRate: { label: "Exit cap rate", min: 0.01, max: 100 },
  constCostPerSqM: {
    label: "직접 공사비",
    min: 0,
    max: 1_000_000_000,
  },
  basementCostMultiplier: {
    label: "지하 공사비 가중치",
    min: 1,
    max: 10,
  },
  softCostRate: { label: "설계·감리·인허가 비율", min: 0, max: 100 },
  contingencyRate: { label: "예비비 비율", min: 0, max: 100 },
  acquisitionTaxManwon: {
    label: "취득세 반영액",
    min: 0,
    max: 100_000_000_000,
  },
  acquisitionOtherCostManwon: {
    label: "기타 취득 부대비",
    min: 0,
    max: 100_000_000_000,
  },
  tenantRelocationCostManwon: {
    label: "명도·임차인 정리비",
    min: 0,
    max: 100_000_000_000,
  },
  ltcTarget: { label: "PF 공사비 조달비율", min: 0, max: 100 },
  interestRate: { label: "PF 금리", min: 0, max: 100 },
  pfUpfrontFeeRate: { label: "PF 약정·취급 수수료율", min: 0, max: 100 },
  trustFeeManwon: {
    label: "신탁·자금관리비",
    min: 0,
    max: 100_000_000_000,
  },
  equityCommitmentManwon: {
    label: "확인 자기자본 한도",
    min: 0,
    max: 100_000_000_000,
  },
  takeoutLtv: { label: "장기대출 최대 LTV", min: 0, max: 100 },
  takeoutInterestRate: { label: "장기대출 금리", min: 0, max: 100 },
  takeoutAmortizationYears: {
    label: "장기대출 상환기간",
    min: 0,
    max: 50,
    integer: true,
  },
  takeoutLoanTermYears: {
    label: "장기대출 계약 만기",
    min: 0,
    max: 50,
    integer: true,
  },
  takeoutPaymentDeferralMonths: {
    label: "원리금 납부유예 기간",
    min: 0,
    max: 120,
    integer: true,
  },
  takeoutInterestOnlyMonths: {
    label: "이자만 납부 기간",
    min: 0,
    max: 600,
    integer: true,
  },
  takeoutRateResetMonths: {
    label: "금리 재설정 주기",
    min: 0,
    max: 120,
    integer: true,
  },
  takeoutAnnualRateChange: {
    label: "연 금리 변화 가정",
    min: -20,
    max: 20,
  },
  takeoutRateFloor: { label: "금리 floor", min: 0, max: 100 },
  takeoutRateCap: { label: "금리 cap", min: 0, max: 100 },
  takeoutDsraMonths: {
    label: "DSRA 적립 개월 수",
    min: 0,
    max: 24,
    integer: true,
  },
  takeoutMinDscr: { label: "장기대출 최소 DSCR", min: 0, max: 10 },
  takeoutLoanCommitmentManwon: {
    label: "장기대출 확약액",
    min: 0,
    max: 100_000_000_000,
  },
  takeoutFeeRate: {
    label: "장기대출 수수료율",
    min: 0,
    max: 100,
  },
  equityIRR: { label: "요구 IRR", min: 0, max: 100 },
  leaseUpMonths: {
    label: "임대 안정화 기간",
    min: 0,
    max: 120,
    integer: true,
  },
  salesPaceMonthlyPct: {
    label: "월 분양 속도",
    min: 0.1,
    max: 100,
  },
  holdPeriodYears: {
    label: "장기 보유기간",
    min: 0,
    max: 50,
    integer: true,
  },
  annualRentGrowthRate: {
    label: "연 임대료 성장률",
    min: -20,
    max: 50,
  },
  annualExpenseGrowthRate: {
    label: "연 운영비 성장률",
    min: -20,
    max: 50,
  },
  rentFreeMonths: {
    label: "초기 무상임대 기간",
    min: 0,
    max: 60,
    integer: true,
  },
  tenantImprovementPerSqM: {
    label: "임차인 공사비",
    min: 0,
    max: 1_000_000_000,
  },
  leasingCommissionRate: {
    label: "임대 중개수수료율",
    min: 0,
    max: 100,
  },
  securityDepositMonths: {
    label: "보증금 개월 수",
    min: 0,
    max: 120,
  },
  tenantLeaseTermMonths: {
    label: "가중 평균 임대차 기간",
    min: 0,
    max: 600,
    integer: true,
  },
  tenantRenewalProbability: {
    label: "임차인 갱신 확률",
    min: 0,
    max: 100,
  },
  renewalRentAdjustmentRate: {
    label: "갱신 임대료 조정률",
    min: -100,
    max: 100,
  },
  renewalRentFreeMonths: {
    label: "갱신 무상임대 기간",
    min: 0,
    max: 120,
    integer: true,
  },
  replacementDowntimeMonths: {
    label: "신규 임차인 유치 공실기간",
    min: 0,
    max: 120,
    integer: true,
  },
  replacementRentFreeMonths: {
    label: "신규 임차인 무상임대 기간",
    min: 0,
    max: 120,
    integer: true,
  },
  replacementTenantImprovementPerSqM: {
    label: "신규 임차인 공사비",
    min: 0,
    max: 1_000_000_000,
  },
  replacementLeasingCommissionRate: {
    label: "신규 임대 중개수수료율",
    min: 0,
    max: 100,
  },
  replacementReservePerSqMYear: {
    label: "연간 면적당 교체 준비금",
    min: 0,
    max: 1_000_000_000,
  },
  majorRepairYear: {
    label: "대수선 발생 연차",
    min: 0,
    max: 50,
    integer: true,
  },
  majorRepairCostManwon: {
    label: "대수선 비용",
    min: 0,
    max: 100_000_000_000,
  },
  holdExitCapRate: {
    label: "보유 종료 Exit cap rate",
    min: 0,
    max: 100,
  },
  exitSellingCostRate: {
    label: "매각 부대비율",
    min: 0,
    max: 100,
  },
  designMonths: {
    label: "설계·인허가 기간",
    min: 0,
    max: 120,
    integer: true,
  },
  constructionMonths: {
    label: "공사기간",
    min: 1,
    max: 240,
    integer: true,
  },
  saleOutMonths: {
    label: "분양·매각 기간",
    min: 1,
    max: 120,
    integer: true,
  },
};

const LEGACY_ASSUMPTION_DEFAULTS: Partial<
  Record<keyof AssumptionSet, number>
> = {
  operatingExpenseRate: 20,
  acquisitionTaxManwon: 0,
  acquisitionOtherCostManwon: 0,
  tenantRelocationCostManwon: 0,
  pfUpfrontFeeRate: 0,
  trustFeeManwon: 0,
  equityCommitmentManwon: 0,
  takeoutLtv: 0,
  takeoutInterestRate: 0,
  takeoutAmortizationYears: 0,
  takeoutLoanTermYears: 0,
  takeoutPaymentDeferralMonths: 0,
  takeoutInterestOnlyMonths: 0,
  takeoutRateResetMonths: 0,
  takeoutAnnualRateChange: 0,
  takeoutRateFloor: 0,
  takeoutRateCap: 0,
  takeoutDsraMonths: 0,
  takeoutMinDscr: 0,
  takeoutLoanCommitmentManwon: 0,
  takeoutFeeRate: 0,
  holdPeriodYears: 0,
  annualRentGrowthRate: 0,
  annualExpenseGrowthRate: 0,
  rentFreeMonths: 0,
  tenantImprovementPerSqM: 0,
  leasingCommissionRate: 0,
  securityDepositMonths: 0,
  tenantLeaseTermMonths: 0,
  tenantRenewalProbability: 0,
  renewalRentAdjustmentRate: 0,
  renewalRentFreeMonths: 0,
  replacementDowntimeMonths: 0,
  replacementRentFreeMonths: 0,
  replacementTenantImprovementPerSqM: 0,
  replacementLeasingCommissionRate: 0,
  replacementReservePerSqMYear: 0,
  majorRepairYear: 0,
  majorRepairCostManwon: 0,
  holdExitCapRate: 0,
  exitSellingCostRate: 0,
};

export function assumptionValueWithLegacyDefault(
  assumptions: AssumptionSet,
  field: keyof AssumptionSet,
): number {
  return assumptions[field] ?? LEGACY_ASSUMPTION_DEFAULTS[field] ?? Number.NaN;
}

export function validateAssumptionValue(
  field: keyof AssumptionSet,
  value: number,
): string[] {
  const rule = ASSUMPTION_VALUE_RULES[field];
  const errors: string[] = [];

  if (!Number.isFinite(value)) {
    return [`${rule.label}은(는) 유한한 숫자여야 합니다.`];
  }
  if (value < rule.min || value > rule.max) {
    errors.push(
      `${rule.label}은(는) ${rule.min} 이상 ${rule.max} 이하여야 합니다.`,
    );
  }
  if (rule.integer && !Number.isInteger(value)) {
    const integerUnit = [
      "takeoutAmortizationYears",
      "takeoutLoanTermYears",
      "holdPeriodYears",
      "majorRepairYear",
    ].includes(field)
      ? "정수 년"
      : "정수 개월";
    errors.push(
      `${rule.label}은(는) ${integerUnit}로 입력해야 합니다.`,
    );
  }
  return errors;
}

export function validateAssumptionSet(
  assumptions: AssumptionSet,
): Array<{ field: keyof AssumptionSet; errors: string[] }> {
  return (Object.keys(ASSUMPTION_VALUE_RULES) as Array<keyof AssumptionSet>)
    .map((field) => ({
      field,
      errors: validateAssumptionValue(
        field,
        assumptionValueWithLegacyDefault(assumptions, field),
      ),
    }))
    .filter((item) => item.errors.length > 0);
}
