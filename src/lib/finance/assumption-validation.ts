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
  ltcTarget: { label: "PF 공사비 조달비율", min: 0, max: 100 },
  interestRate: { label: "PF 금리", min: 0, max: 100 },
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
    errors.push(`${rule.label}은(는) 정수 개월로 입력해야 합니다.`);
  }
  return errors;
}

export function validateAssumptionSet(
  assumptions: AssumptionSet,
): Array<{ field: keyof AssumptionSet; errors: string[] }> {
  return (Object.keys(ASSUMPTION_VALUE_RULES) as Array<keyof AssumptionSet>)
    .map((field) => ({
      field,
      errors: validateAssumptionValue(field, assumptions[field]),
    }))
    .filter((item) => item.errors.length > 0);
}
