import type { AssumptionSet, Parcel, Scenario } from "./types";

export type FinancialSourceField = "acquisitionPrice" | keyof AssumptionSet;

export type FinancialSourceKind =
  | "official-api"
  | "signed-contract"
  | "professional-quote"
  | "lender-term-sheet"
  | "appraisal"
  | "approved-policy";

export interface FinancialSourceRecord {
  field: FinancialSourceField;
  value: number;
  sourceKind: FinancialSourceKind;
  sourceName: string;
  documentRef: string;
  asOf: string;
  verifiedBy: string;
  recordedAt: string;
}

export type FinancialSourceMap = Partial<
  Record<FinancialSourceField, FinancialSourceRecord>
>;

export interface FinancialSourceFieldMeta {
  label: string;
  unit: string;
  allowedKinds: FinancialSourceKind[];
}

const CONTRACT_OR_QUOTE: FinancialSourceKind[] = [
  "signed-contract",
  "professional-quote",
];

export const FINANCIAL_SOURCE_FIELD_META: Record<
  FinancialSourceField,
  FinancialSourceFieldMeta
> = {
  acquisitionPrice: {
    label: "토지 총매입가",
    unit: "만원",
    allowedKinds: ["signed-contract", "appraisal", "official-api"],
  },
  salePricePerSqM: {
    label: "매각·분양 단가",
    unit: "원/㎡",
    allowedKinds: ["appraisal", "signed-contract", "official-api"],
  },
  rentPerSqMMonth: {
    label: "월 임대료",
    unit: "원/㎡·월",
    allowedKinds: ["appraisal", "signed-contract", "official-api"],
  },
  vacancyRate: {
    label: "공실률",
    unit: "%",
    allowedKinds: ["appraisal", "official-api", "approved-policy"],
  },
  capRate: {
    label: "Exit cap rate",
    unit: "%",
    allowedKinds: ["appraisal", "official-api", "approved-policy"],
  },
  constCostPerSqM: {
    label: "직접 공사비",
    unit: "원/㎡",
    allowedKinds: CONTRACT_OR_QUOTE,
  },
  softCostRate: {
    label: "설계·감리·인허가",
    unit: "%",
    allowedKinds: [...CONTRACT_OR_QUOTE, "approved-policy"],
  },
  contingencyRate: {
    label: "예비비",
    unit: "%",
    allowedKinds: ["approved-policy", "professional-quote"],
  },
  ltcTarget: {
    label: "목표 LTC",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  interestRate: {
    label: "PF 금리",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  equityIRR: {
    label: "요구 IRR",
    unit: "%",
    allowedKinds: ["approved-policy"],
  },
  leaseUpMonths: {
    label: "임대 안정화 기간",
    unit: "개월",
    allowedKinds: ["appraisal", "approved-policy", "professional-quote"],
  },
  salesPaceMonthlyPct: {
    label: "월 분양 속도",
    unit: "%/월",
    allowedKinds: ["appraisal", "official-api", "approved-policy"],
  },
  designMonths: {
    label: "설계·인허가 기간",
    unit: "개월",
    allowedKinds: [...CONTRACT_OR_QUOTE, "approved-policy"],
  },
  constructionMonths: {
    label: "공사기간",
    unit: "개월",
    allowedKinds: CONTRACT_OR_QUOTE,
  },
  saleOutMonths: {
    label: "분양·매각 기간",
    unit: "개월",
    allowedKinds: ["appraisal", "approved-policy", "professional-quote"],
  },
};

export interface SourceValidationResult {
  valid: boolean;
  errors: string[];
}

export interface SourceDataGateResult {
  status: "source-backed" | "blocked";
  requiredFields: FinancialSourceField[];
  validRecords: FinancialSourceRecord[];
  missingFields: FinancialSourceField[];
  invalidFields: Array<{
    field: FinancialSourceField;
    errors: string[];
  }>;
  coveragePct: number;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateFinancialSource(
  record: FinancialSourceRecord,
): SourceValidationResult {
  const errors: string[] = [];
  const meta = FINANCIAL_SOURCE_FIELD_META[record.field];
  if (!Number.isFinite(record.value) || record.value < 0) {
    errors.push("유효한 0 이상의 값을 입력해야 합니다.");
  }
  if (!record.sourceName.trim()) errors.push("발급기관·출처명이 필요합니다.");
  if (!record.documentRef.trim())
    errors.push("문서번호·URL·파일 참조가 필요합니다.");
  if (!record.verifiedBy.trim()) errors.push("확인자 이름이 필요합니다.");
  if (!isIsoDate(record.asOf))
    errors.push("기준일을 YYYY-MM-DD로 입력해야 합니다.");
  if (!isIsoDate(record.recordedAt)) errors.push("등록일이 올바르지 않습니다.");
  if (!meta.allowedKinds.includes(record.sourceKind)) {
    errors.push(`${meta.label}에 허용되지 않는 출처 유형입니다.`);
  }
  return { valid: errors.length === 0, errors };
}

export function requiredSourceFields(
  scenario: Scenario,
): FinancialSourceField[] {
  const fields: FinancialSourceField[] = [
    "acquisitionPrice",
    "constCostPerSqM",
    "softCostRate",
    "contingencyRate",
    "ltcTarget",
    "interestRate",
    "equityIRR",
    "designMonths",
    "constructionMonths",
    "saleOutMonths",
  ];
  if (scenario.program.mix.residentialSale > 0) {
    fields.push("salePricePerSqM", "salesPaceMonthlyPct");
  }
  if (
    scenario.program.mix.residentialLease > 0 ||
    scenario.program.mix.retail > 0
  ) {
    fields.push("rentPerSqMMonth", "vacancyRate", "capRate", "leaseUpMonths");
  }
  return Array.from(new Set(fields));
}

export function buildSourceDataGate(
  scenario: Scenario,
  records: FinancialSourceMap,
): SourceDataGateResult {
  const requiredFields = requiredSourceFields(scenario);
  const validRecords: FinancialSourceRecord[] = [];
  const missingFields: FinancialSourceField[] = [];
  const invalidFields: SourceDataGateResult["invalidFields"] = [];

  for (const field of requiredFields) {
    const record = records[field];
    if (!record) {
      missingFields.push(field);
      continue;
    }
    const validation = validateFinancialSource(record);
    if (!validation.valid) {
      invalidFields.push({ field, errors: validation.errors });
      continue;
    }
    validRecords.push(record);
  }

  return {
    status:
      missingFields.length === 0 && invalidFields.length === 0
        ? "source-backed"
        : "blocked",
    requiredFields,
    validRecords,
    missingFields,
    invalidFields,
    coveragePct:
      requiredFields.length > 0
        ? (validRecords.length / requiredFields.length) * 100
        : 100,
  };
}

export function applyFinancialSources(
  parcel: Parcel,
  scenario: Scenario,
  records: FinancialSourceMap,
): { parcel: Parcel; scenario: Scenario; applied: FinancialSourceField[] } {
  const nextParcel = { ...parcel };
  const nextAssumptions = { ...scenario.assumptions };
  const applied: FinancialSourceField[] = [];

  for (const [field, record] of Object.entries(records) as Array<
    [FinancialSourceField, FinancialSourceRecord | undefined]
  >) {
    if (!record || !validateFinancialSource(record).valid) continue;
    if (field === "acquisitionPrice") nextParcel.acquiredPrice = record.value;
    else nextAssumptions[field] = record.value;
    applied.push(field);
  }

  return {
    parcel: nextParcel,
    scenario: { ...scenario, assumptions: nextAssumptions },
    applied,
  };
}
