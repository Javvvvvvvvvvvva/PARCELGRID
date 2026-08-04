import type { AssumptionSet, Parcel, Scenario } from "./types";
import {
  validateSourceDocumentMetadata,
  type SourceDocumentMetadata,
} from "./source-document";

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
  document?: SourceDocumentMetadata;
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
    label: "부동산 총 취득대금",
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
  basementCostMultiplier: {
    label: "지하 공사비 가중치",
    unit: "배",
    allowedKinds: [...CONTRACT_OR_QUOTE, "approved-policy"],
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

export interface FinancialSourceGuidance {
  group: "취득" | "매출·임대" | "공사비" | "금융" | "사업 일정";
  why: string;
  recommendedEvidence: string;
}

/**
 * 일반 사용자가 어떤 원문을 준비해야 하는지 설명하는 등록 가이드.
 * 예시는 허용되는 근거의 종류를 설명할 뿐, 실제 원문을 대신하지 않는다.
 */
export const FINANCIAL_SOURCE_GUIDANCE: Record<
  FinancialSourceField,
  FinancialSourceGuidance
> = {
  acquisitionPrice: {
    group: "취득",
    why: "토지비와 자기자본 규모의 출발점입니다.",
    recommendedEvidence: "서명 매매계약서, 감정평가서 또는 공식 취득가격 원문",
  },
  salePricePerSqM: {
    group: "매출·임대",
    why: "예상 매출과 최대 매입가를 직접 결정합니다.",
    recommendedEvidence: "유사 건물 실거래 사례표, 감정평가서 또는 매각 계약서",
  },
  rentPerSqMMonth: {
    group: "매출·임대",
    why: "안정화 NOI와 임대 자산가치의 기준입니다.",
    recommendedEvidence: "인근 임대차계약 사례, 감정평가서 또는 임대시장 보고서",
  },
  vacancyRate: {
    group: "매출·임대",
    why: "안정화 후 실제 임대수익을 조정합니다.",
    recommendedEvidence: "임대시장 보고서, 운영 실적 또는 승인된 내부 기준",
  },
  capRate: {
    group: "매출·임대",
    why: "임대 NOI를 매각가치로 환산합니다.",
    recommendedEvidence: "감정평가서, 거래사례 분석 또는 승인된 투자 기준",
  },
  constCostPerSqM: {
    group: "공사비",
    why: "전체 직접공사비의 기준 단가입니다.",
    recommendedEvidence: "시공사 개산견적서 또는 서명된 공사계약서",
  },
  basementCostMultiplier: {
    group: "공사비",
    why: "굴토·흙막이·지하수 조건에 따른 지하 공사비를 조정합니다.",
    recommendedEvidence: "지하공사 세부견적, 지반조사 검토 또는 승인된 원가 기준",
  },
  softCostRate: {
    group: "공사비",
    why: "설계·감리·인허가 등 간접비를 반영합니다.",
    recommendedEvidence: "건축사·감리 견적서, 용역계약서 또는 승인된 예산 기준",
  },
  contingencyRate: {
    group: "공사비",
    why: "설계변경과 물가 변동의 예비비를 반영합니다.",
    recommendedEvidence: "승인된 사업예산 기준 또는 시공사 리스크 견적",
  },
  ltcTarget: {
    group: "금융",
    why: "PF 가능액과 필요한 자기자본을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet 또는 대출약정서",
  },
  interestRate: {
    group: "금융",
    why: "월별 금융비와 최종 IRR을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet 또는 대출약정서",
  },
  equityIRR: {
    group: "금융",
    why: "사업 통과 여부와 최대 매입가 역산의 목표값입니다.",
    recommendedEvidence: "대표자 승인 투자기준 또는 투자심의 기준서",
  },
  leaseUpMonths: {
    group: "매출·임대",
    why: "임대 안정화까지 걸리는 기간을 설명합니다.",
    recommendedEvidence: "임대대행 계획서, 감정평가서 또는 운영계획",
  },
  salesPaceMonthlyPct: {
    group: "매출·임대",
    why: "월별 분양대금 회수 속도를 설명합니다.",
    recommendedEvidence: "분양대행 계획서, 유사 사업 실적 또는 승인된 판매계획",
  },
  designMonths: {
    group: "사업 일정",
    why: "토지 취득 후 착공 전 자금 묶임 기간을 결정합니다.",
    recommendedEvidence: "건축사 설계·인허가 일정표 또는 승인된 사업 일정",
  },
  constructionMonths: {
    group: "사업 일정",
    why: "공사비 집행기간과 PF 이자기간을 결정합니다.",
    recommendedEvidence: "시공사 공정표 또는 공사계약 일정",
  },
  saleOutMonths: {
    group: "사업 일정",
    why: "준공 후 매각·잔금 회수기간을 결정합니다.",
    recommendedEvidence: "매각계획, 분양대행 계획서 또는 승인된 사업 일정",
  },
};

export interface SourceValidationResult {
  valid: boolean;
  errors: string[];
}

const UPLOAD_REQUIRED_KINDS: FinancialSourceKind[] = [
  "signed-contract",
  "professional-quote",
  "lender-term-sheet",
  "appraisal",
];

export function sourceKindRequiresDocument(
  sourceKind: FinancialSourceKind,
): boolean {
  return UPLOAD_REQUIRED_KINDS.includes(sourceKind);
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

export function validateFinancialSourceEvidence(
  record: FinancialSourceRecord,
): SourceValidationResult {
  const base = validateFinancialSource(record);
  const errors = [...base.errors];
  if (record.document) {
    errors.push(...validateSourceDocumentMetadata(record.document));
  } else if (sourceKindRequiresDocument(record.sourceKind)) {
    errors.push("이 출처 유형은 비공개 원문 파일 업로드가 필요합니다.");
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
  if (
    (scenario.program.areaContract?.basementAreaSqm ?? 0) > 0 ||
    scenario.program.floorsBelow > 0
  ) {
    fields.push("basementCostMultiplier");
  }
  if (scenario.program.mix.residentialSale > 0) {
    fields.push("salePricePerSqM");
  }
  if (
    scenario.program.mix.residentialLease > 0 ||
    scenario.program.mix.retail > 0
  ) {
    fields.push("rentPerSqMMonth", "vacancyRate", "capRate");
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
    const validation = validateFinancialSourceEvidence(record);
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
