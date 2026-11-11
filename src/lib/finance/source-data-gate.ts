import type {
  AssumptionSet,
  FinancialRevenuePricingSnapshot,
  Parcel,
  RevenuePoolPricingSnapshot,
  RevenuePriceSourceField,
  Scenario,
} from "./types";
import {
  applyRevenuePoolSource,
  FINANCIAL_REVENUE_POOL_KEYS,
  normalizeRevenueAreaPools,
  revenuePoolForPriceSourceField,
  revenuePriceSourceFieldForPool,
  revenueAreaTotals,
  revenuePricingFromAssumptions,
} from "./revenue-contract";
import { validateAssumptionValue } from "./assumption-validation";
import {
  validateSourceDocumentMetadata,
  type SourceDocumentMetadata,
} from "./source-document";

export type FinancialSourceField =
  | "acquisitionPrice"
  | keyof AssumptionSet
  | RevenuePriceSourceField;

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
  priceReviewOrigin?: {
    version: "price-review-source-2026.1";
    projectId: string;
    target: "acquisition" | "sale";
    recordHash: string;
  };
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
  residentialSalePricePerSqM: {
    label: "주거 매각·분양 단가",
    unit: "원/㎡",
    allowedKinds: ["appraisal", "signed-contract", "official-api"],
  },
  retailSalePricePerSqM: {
    label: "상가 매각 단가",
    unit: "원/㎡",
    allowedKinds: ["appraisal", "signed-contract", "official-api"],
  },
  officeSalePricePerSqM: {
    label: "업무 매각 단가",
    unit: "원/㎡",
    allowedKinds: ["appraisal", "signed-contract", "official-api"],
  },
  residentialRentPerSqMMonth: {
    label: "주거 월 임대료",
    unit: "원/㎡·월",
    allowedKinds: ["appraisal", "signed-contract", "official-api"],
  },
  retailRentPerSqMMonth: {
    label: "상가 월 임대료",
    unit: "원/㎡·월",
    allowedKinds: ["appraisal", "signed-contract", "official-api"],
  },
  officeRentPerSqMMonth: {
    label: "업무 월 임대료",
    unit: "원/㎡·월",
    allowedKinds: ["appraisal", "signed-contract", "official-api"],
  },
  vacancyRate: {
    label: "공실률",
    unit: "%",
    allowedKinds: ["appraisal", "official-api", "approved-policy"],
  },
  operatingExpenseRate: {
    label: "운영비율",
    unit: "% of 유효총수입",
    allowedKinds: ["appraisal", "professional-quote", "approved-policy"],
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
  acquisitionTaxManwon: {
    label: "취득세 반영액",
    unit: "만원",
    allowedKinds: ["professional-quote", "approved-policy", "signed-contract"],
  },
  acquisitionOtherCostManwon: {
    label: "기타 취득 부대비",
    unit: "만원",
    allowedKinds: CONTRACT_OR_QUOTE,
  },
  tenantRelocationCostManwon: {
    label: "명도·임차인 정리비",
    unit: "만원",
    allowedKinds: CONTRACT_OR_QUOTE,
  },
  ltcTarget: {
    label: "PF 적격 공사비 조달비율",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  interestRate: {
    label: "PF 금리",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  pfUpfrontFeeRate: {
    label: "PF 약정·취급 수수료율",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  trustFeeManwon: {
    label: "신탁·자금관리비",
    unit: "만원",
    allowedKinds: CONTRACT_OR_QUOTE,
  },
  equityCommitmentManwon: {
    label: "확인 자기자본 한도",
    unit: "만원",
    allowedKinds: ["signed-contract", "approved-policy"],
  },
  takeoutLtv: {
    label: "장기대출 최대 LTV",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutInterestRate: {
    label: "장기대출 금리",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutAmortizationYears: {
    label: "장기대출 상환기간",
    unit: "년",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutLoanTermYears: {
    label: "장기대출 계약 만기",
    unit: "년",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutPaymentDeferralMonths: {
    label: "원리금 납부유예 기간",
    unit: "개월",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutInterestOnlyMonths: {
    label: "이자만 납부 기간",
    unit: "개월",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutRateResetMonths: {
    label: "금리 재설정 주기",
    unit: "개월",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutAnnualRateChange: {
    label: "연 금리 변화 가정",
    unit: "%p/년",
    allowedKinds: ["approved-policy", "appraisal", "lender-term-sheet"],
  },
  takeoutRateFloor: {
    label: "금리 floor",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutRateCap: {
    label: "금리 cap",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutDsraMonths: {
    label: "DSRA 적립 개월 수",
    unit: "개월",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutMinDscr: {
    label: "장기대출 최소 DSCR",
    unit: "배",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutLoanCommitmentManwon: {
    label: "장기대출 확약액",
    unit: "만원",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  takeoutFeeRate: {
    label: "장기대출 수수료율",
    unit: "%",
    allowedKinds: ["lender-term-sheet", "signed-contract"],
  },
  holdPeriodYears: {
    label: "장기 보유기간",
    unit: "년",
    allowedKinds: ["approved-policy", "appraisal", "signed-contract"],
  },
  annualRentGrowthRate: {
    label: "연 임대료 성장률",
    unit: "%/년",
    allowedKinds: ["appraisal", "official-api", "approved-policy"],
  },
  annualExpenseGrowthRate: {
    label: "연 운영비 성장률",
    unit: "%/년",
    allowedKinds: ["appraisal", "professional-quote", "approved-policy"],
  },
  rentFreeMonths: {
    label: "초기 무상임대 기간",
    unit: "개월",
    allowedKinds: ["signed-contract", "professional-quote", "appraisal"],
  },
  tenantImprovementPerSqM: {
    label: "임차인 공사비",
    unit: "원/㎡",
    allowedKinds: ["signed-contract", "professional-quote", "appraisal"],
  },
  leasingCommissionRate: {
    label: "임대 중개수수료율",
    unit: "%",
    allowedKinds: ["signed-contract", "professional-quote"],
  },
  securityDepositMonths: {
    label: "보증금 개월 수",
    unit: "개월",
    allowedKinds: ["signed-contract", "appraisal", "approved-policy"],
  },
  tenantLeaseTermMonths: {
    label: "가중 평균 임대차 기간",
    unit: "개월",
    allowedKinds: ["signed-contract", "appraisal", "approved-policy"],
  },
  tenantRenewalProbability: {
    label: "임차인 갱신 확률",
    unit: "%",
    allowedKinds: ["appraisal", "official-api", "approved-policy"],
  },
  renewalRentAdjustmentRate: {
    label: "갱신 임대료 조정률",
    unit: "%",
    allowedKinds: ["signed-contract", "appraisal", "approved-policy"],
  },
  renewalRentFreeMonths: {
    label: "갱신 무상임대 기간",
    unit: "개월",
    allowedKinds: ["signed-contract", "appraisal", "approved-policy"],
  },
  replacementDowntimeMonths: {
    label: "신규 임차인 유치 공실기간",
    unit: "개월",
    allowedKinds: ["appraisal", "official-api", "approved-policy"],
  },
  replacementRentFreeMonths: {
    label: "신규 임차인 무상임대 기간",
    unit: "개월",
    allowedKinds: ["signed-contract", "appraisal", "approved-policy"],
  },
  replacementTenantImprovementPerSqM: {
    label: "신규 임차인 공사비",
    unit: "원/㎡",
    allowedKinds: ["signed-contract", "professional-quote", "appraisal"],
  },
  replacementLeasingCommissionRate: {
    label: "신규 임대 중개수수료율",
    unit: "%",
    allowedKinds: ["signed-contract", "professional-quote", "appraisal"],
  },
  replacementReservePerSqMYear: {
    label: "연간 면적당 교체 준비금",
    unit: "원/㎡·년",
    allowedKinds: ["professional-quote", "appraisal", "approved-policy"],
  },
  majorRepairYear: {
    label: "대수선 발생 연차",
    unit: "년차",
    allowedKinds: ["professional-quote", "approved-policy"],
  },
  majorRepairCostManwon: {
    label: "대수선 비용",
    unit: "만원",
    allowedKinds: ["professional-quote", "signed-contract", "approved-policy"],
  },
  holdExitCapRate: {
    label: "보유 종료 Exit cap rate",
    unit: "%",
    allowedKinds: ["appraisal", "official-api", "approved-policy"],
  },
  exitSellingCostRate: {
    label: "매각 부대비율",
    unit: "%",
    allowedKinds: ["professional-quote", "signed-contract", "approved-policy"],
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
  group:
    | "취득"
    | "매출·임대"
    | "공사비"
    | "금융"
    | "보유 운영·Exit"
    | "사업 일정";
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
  residentialSalePricePerSqM: {
    group: "매출·임대",
    why: "주거 매각·분양 면적에만 적용되는 독립 매출 단가입니다.",
    recommendedEvidence: "동일 주거상품의 실거래·분양 사례표 또는 감정평가서",
  },
  retailSalePricePerSqM: {
    group: "매출·임대",
    why: "상가 매각 면적에만 적용되는 독립 매출 단가입니다.",
    recommendedEvidence: "상가 층·전용면적·신축 여부가 유사한 거래사례 또는 감정평가서",
  },
  officeSalePricePerSqM: {
    group: "매출·임대",
    why: "업무시설 매각 면적에만 적용되는 독립 매출 단가입니다.",
    recommendedEvidence: "동일 권역 업무시설 거래사례 또는 감정평가서",
  },
  residentialRentPerSqMMonth: {
    group: "매출·임대",
    why: "주거 임대 면적의 잠재 임대료와 NOI를 결정합니다.",
    recommendedEvidence: "동일 주거상품 임대차 사례, 임대운영표 또는 감정평가서",
  },
  retailRentPerSqMMonth: {
    group: "매출·임대",
    why: "상가 임대 면적의 잠재 임대료와 NOI를 결정합니다.",
    recommendedEvidence: "층·가시성·전용면적이 유사한 상가 임대차 사례 또는 감정평가서",
  },
  officeRentPerSqMMonth: {
    group: "매출·임대",
    why: "업무시설 임대 면적의 잠재 임대료와 NOI를 결정합니다.",
    recommendedEvidence: "동일 권역·등급 업무시설 임대차 사례 또는 감정평가서",
  },
  vacancyRate: {
    group: "매출·임대",
    why: "안정화 후 실제 임대수익을 조정합니다.",
    recommendedEvidence: "임대시장 보고서, 운영 실적 또는 승인된 내부 기준",
  },
  operatingExpenseRate: {
    group: "매출·임대",
    why: "유효총수입에서 소유자 부담 관리·수선·보험비를 차감해 NOI를 계산합니다.",
    recommendedEvidence: "운영예산, 유사 자산 운영실적, 관리업체 견적 또는 감정평가서",
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
  acquisitionTaxManwon: {
    group: "취득",
    why: "취득 단계의 실제 현금유출과 세전 사업비를 결정합니다.",
    recommendedEvidence: "세무 검토서, 취득세 신고 예산 또는 승인된 세금 계산서",
  },
  acquisitionOtherCostManwon: {
    group: "취득",
    why: "중개·법무·등기 등 취득에 필요한 현금유출을 반영합니다.",
    recommendedEvidence: "중개계약서, 법무 견적서 또는 승인된 취득 부대비 예산",
  },
  tenantRelocationCostManwon: {
    group: "취득",
    why: "점유자·임차인 정리와 착공 가능 시점을 함께 결정합니다.",
    recommendedEvidence: "임대차 현황, 명도합의서 또는 전문업체 견적",
  },
  ltcTarget: {
    group: "금융",
    why: "직접공사비·간접비·예비비 중 PF로 조달하는 비율과 필요한 자기자본을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet 또는 대출약정서",
  },
  interestRate: {
    group: "금융",
    why: "월별 금융비와 최종 IRR을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet 또는 대출약정서",
  },
  pfUpfrontFeeRate: {
    group: "금융",
    why: "PF 한도 설정 시 선지급되는 약정·취급 수수료를 반영합니다.",
    recommendedEvidence: "금융기관 Term Sheet 또는 대출약정서",
  },
  trustFeeManwon: {
    group: "금융",
    why: "신탁·자금관리 구조에 필요한 고정 비용을 반영합니다.",
    recommendedEvidence: "신탁사 제안서, 자금관리 계약서 또는 전문 견적",
  },
  equityCommitmentManwon: {
    group: "금융",
    why: "필요 자기자본이 실제 확약 한도를 넘는지 판정합니다.",
    recommendedEvidence: "투자확약서, 출자 승인서 또는 승인된 자금조달 계획",
  },
  takeoutLtv: {
    group: "금융",
    why: "안정화 자산가치가 지지하는 장기대출 상한을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet 또는 장기대출 약정서",
  },
  takeoutInterestRate: {
    group: "금융",
    why: "장기대출의 연간 원리금과 DSCR을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet 또는 장기대출 약정서",
  },
  takeoutAmortizationYears: {
    group: "금융",
    why: "원리금 상환액과 재융자 위험을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet 또는 장기대출 상환표",
  },
  takeoutLoanTermYears: {
    group: "금융",
    why: "상환기간보다 짧은 계약 만기에서 발생하는 balloon 상환액을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet의 만기일·대출기간 조항",
  },
  takeoutPaymentDeferralMonths: {
    group: "금융",
    why: "납부유예 중 자본화되는 이자와 만기 잔액을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet의 납부유예·이자 자본화 조항",
  },
  takeoutInterestOnlyMonths: {
    group: "금융",
    why: "초기 이자만 납부하는 기간과 이후 원리금 상환액을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet의 interest-only 조항",
  },
  takeoutRateResetMonths: {
    group: "금융",
    why: "고정금리와 변동금리를 구분하고 예상 금리 재설정 시점을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet의 기준금리·가산금리·리셋 조항",
  },
  takeoutAnnualRateChange: {
    group: "금융",
    why: "변동금리 경로의 상환액·DSCR 하방을 시나리오로 계산합니다.",
    recommendedEvidence: "승인된 금리 스트레스 정책, 금융기관 전망 또는 감정평가 가정",
  },
  takeoutRateFloor: {
    group: "금융",
    why: "변동금리의 최저 적용금리를 제한합니다.",
    recommendedEvidence: "금융기관 Term Sheet의 금리 floor 조항",
  },
  takeoutRateCap: {
    group: "금융",
    why: "약정 또는 헤지로 제한되는 최대 적용금리를 반영합니다.",
    recommendedEvidence: "금융기관 Term Sheet 또는 금리 cap·헤지 계약",
  },
  takeoutDsraMonths: {
    group: "금융",
    why: "재융자 때 제한현금으로 적립할 원리금 상환준비금을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet의 DSRA 적립·보충·해제 조항",
  },
  takeoutMinDscr: {
    group: "금융",
    why: "NOI가 지지할 수 있는 장기대출 한도를 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet의 최소 DSCR 조항",
  },
  takeoutLoanCommitmentManwon: {
    group: "금융",
    why: "계산상 한도와 실제 승인 한도를 분리하고 PF 상환 부족액을 판정합니다.",
    recommendedEvidence: "금융기관 장기대출 확약서 또는 대출약정서",
  },
  takeoutFeeRate: {
    group: "금융",
    why: "장기대출 순유입액과 PF 상환 가능액을 결정합니다.",
    recommendedEvidence: "금융기관 Term Sheet의 취급·약정 수수료 조항",
  },
  holdPeriodYears: {
    group: "보유 운영·Exit",
    why: "재융자 이후 운영 현금흐름과 최종 매각 시점을 결정합니다.",
    recommendedEvidence: "승인된 자산 운용계획, 투자심의 기준서 또는 감정평가 가정",
  },
  annualRentGrowthRate: {
    group: "보유 운영·Exit",
    why: "보유기간 월 임대수입과 종료 시점 NOI를 결정합니다.",
    recommendedEvidence: "감정평가서, 임대시장 전망 또는 승인된 운용 가정",
  },
  annualExpenseGrowthRate: {
    group: "보유 운영·Exit",
    why: "보유기간 운영비와 종료 시점 NOI를 결정합니다.",
    recommendedEvidence: "자산 운영예산, 유사 자산 실적 또는 관리업체 견적",
  },
  rentFreeMonths: {
    group: "보유 운영·Exit",
    why: "최초 임대 유치 과정의 무상임대 손실을 반영합니다.",
    recommendedEvidence: "임대조건표, 임대차계약 사례 또는 임대대행 계획서",
  },
  tenantImprovementPerSqM: {
    group: "보유 운영·Exit",
    why: "최초 임차인 유치를 위한 공사비를 자기자본 현금흐름에 반영합니다.",
    recommendedEvidence: "임대차 제안서, 임차인 공사 계약서 또는 전문공사 견적",
  },
  leasingCommissionRate: {
    group: "보유 운영·Exit",
    why: "최초 임대 중개·대행 비용을 반영합니다.",
    recommendedEvidence: "중개계약서 또는 임대대행사 견적",
  },
  securityDepositMonths: {
    group: "보유 운영·Exit",
    why: "반환 의무가 있는 제한현금 규모를 표시합니다.",
    recommendedEvidence: "임대조건표, 임대차계약 사례 또는 감정평가서",
  },
  tenantLeaseTermMonths: {
    group: "보유 운영·Exit",
    why: "보유 중 임차인 갱신·교체가 발생하는 주기를 결정합니다.",
    recommendedEvidence: "임대차 현황표, 표준 임대조건 또는 감정평가서",
  },
  tenantRenewalProbability: {
    group: "보유 운영·Exit",
    why: "만기 면적을 갱신분과 신규 임차인 유치분으로 나눕니다.",
    recommendedEvidence: "자산·업종별 갱신 실적, 임대대행 계획 또는 승인된 운용 가정",
  },
  renewalRentAdjustmentRate: {
    group: "보유 운영·Exit",
    why: "갱신 임대료의 당시 시장임대료 대비 할인·할증을 반영합니다.",
    recommendedEvidence: "임대차 갱신 조항, 갱신 제안서 또는 감정평가 임대조건",
  },
  renewalRentFreeMonths: {
    group: "보유 운영·Exit",
    why: "기존 임차인 갱신 때 제공하는 무상임대 손실을 반영합니다.",
    recommendedEvidence: "갱신 제안서, 임대차 사례 또는 승인된 임대정책",
  },
  replacementDowntimeMonths: {
    group: "보유 운영·Exit",
    why: "미갱신 면적의 신규 임차인 유치 전 추가 공실 손실을 반영합니다.",
    recommendedEvidence: "유사 자산 공실기간 실적, 임대시장 분석 또는 임대대행 계획",
  },
  replacementRentFreeMonths: {
    group: "보유 운영·Exit",
    why: "신규 임차인 입주 뒤 제공하는 무상임대 손실을 반영합니다.",
    recommendedEvidence: "신규 임대 제안서, 임대차 사례 또는 승인된 임대정책",
  },
  replacementTenantImprovementPerSqM: {
    group: "보유 운영·Exit",
    why: "미갱신 기대 면적의 신규 임차인 공사비를 반영합니다.",
    recommendedEvidence: "신규 임대 제안서, 임차인 공사 견적 또는 공사계약 사례",
  },
  replacementLeasingCommissionRate: {
    group: "보유 운영·Exit",
    why: "미갱신 기대 면적을 다시 임대하는 중개·대행 비용을 반영합니다.",
    recommendedEvidence: "중개계약, 임대대행사 견적 또는 유사 자산 집행 실적",
  },
  replacementReservePerSqMYear: {
    group: "보유 운영·Exit",
    why: "운영 중 교체·수선에 적립할 연간 준비금을 반영합니다.",
    recommendedEvidence: "장기수선계획, 기술실사 보고서 또는 승인된 운영예산",
  },
  majorRepairYear: {
    group: "보유 운영·Exit",
    why: "일회성 대수선 비용이 발생할 시점을 결정합니다.",
    recommendedEvidence: "장기수선계획 또는 기술실사 보고서",
  },
  majorRepairCostManwon: {
    group: "보유 운영·Exit",
    why: "지정 연차의 일회성 대수선 현금유출을 반영합니다.",
    recommendedEvidence: "기술실사 보고서, 전문공사 견적 또는 공사계약서",
  },
  holdExitCapRate: {
    group: "보유 운영·Exit",
    why: "보유 종료 다음 12개월 NOI를 예상 매각가로 환산합니다.",
    recommendedEvidence: "감정평가서, 거래사례 분석 또는 승인된 Exit 기준",
  },
  exitSellingCostRate: {
    group: "보유 운영·Exit",
    why: "최종 매각 때 중개·법무·처분 비용을 차감합니다.",
    recommendedEvidence: "매각 자문 견적, 중개계약 또는 승인된 처분비 예산",
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
  if (record.field === "acquisitionPrice") {
    if (!Number.isFinite(record.value) || record.value < 0) {
      errors.push("부동산 총 취득대금은 0 이상의 유한한 숫자여야 합니다.");
    }
  } else if (revenuePoolForPriceSourceField(record.field)) {
    if (!Number.isFinite(record.value) || record.value <= 0) {
      errors.push(`${meta.label}은(는) 0보다 큰 유한한 숫자여야 합니다.`);
    }
  } else {
    errors.push(
      ...validateAssumptionValue(record.field as keyof AssumptionSet, record.value),
    );
    if (record.field === "equityCommitmentManwon" && record.value <= 0) {
      errors.push("확인 자기자본 한도는 0보다 커야 합니다.");
    }
    if (
      [
        "takeoutLtv",
        "takeoutInterestRate",
        "takeoutAmortizationYears",
        "takeoutLoanTermYears",
        "takeoutMinDscr",
        "takeoutLoanCommitmentManwon",
        "holdPeriodYears",
        "tenantLeaseTermMonths",
        "holdExitCapRate",
      ].includes(record.field as keyof AssumptionSet) &&
      record.value <= 0
    ) {
      errors.push(`${meta.label}은(는) 0보다 커야 합니다.`);
    }
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

export const HOLD_PERIOD_SOURCE_FIELDS: FinancialSourceField[] = [
  "holdPeriodYears",
  "annualRentGrowthRate",
  "annualExpenseGrowthRate",
  "rentFreeMonths",
  "tenantImprovementPerSqM",
  "leasingCommissionRate",
  "securityDepositMonths",
  "tenantLeaseTermMonths",
  "replacementReservePerSqMYear",
  "majorRepairYear",
  "majorRepairCostManwon",
  "holdExitCapRate",
  "exitSellingCostRate",
];

export const TENANT_ROLLOVER_SOURCE_FIELDS: FinancialSourceField[] = [
  "tenantRenewalProbability",
  "renewalRentAdjustmentRate",
  "renewalRentFreeMonths",
  "replacementDowntimeMonths",
  "replacementRentFreeMonths",
  "replacementTenantImprovementPerSqM",
  "replacementLeasingCommissionRate",
];

export function requiredSourceFields(
  scenario: Scenario,
): FinancialSourceField[] {
  const fields: FinancialSourceField[] = [
    "acquisitionPrice",
    "constCostPerSqM",
    "softCostRate",
    "contingencyRate",
    "acquisitionTaxManwon",
    "acquisitionOtherCostManwon",
    "tenantRelocationCostManwon",
    "ltcTarget",
    "interestRate",
    "pfUpfrontFeeRate",
    "trustFeeManwon",
    "equityCommitmentManwon",
    "equityIRR",
    "designMonths",
    "constructionMonths",
  ];
  if (
    (scenario.program.areaContract?.basementAreaSqm ?? 0) > 0 ||
    scenario.program.floorsBelow > 0
  ) {
    fields.push("basementCostMultiplier");
  }
  const contractedRevenue = scenario.program.areaContract
    ? revenueAreaTotals(scenario.program.areaContract.revenueAreas)
    : null;
  const hasSaleRevenue = contractedRevenue
    ? contractedRevenue.saleSqm > 0
    : scenario.program.mix.residentialSale > 0;
  const hasResidentialSale = scenario.program.areaContract
    ? normalizeRevenueAreaPools(scenario.program.areaContract.revenueAreas)
        .residentialSaleSqm > 0
    : scenario.program.mix.residentialSale > 0;
  const hasLeaseRevenue = contractedRevenue
    ? contractedRevenue.leaseSqm > 0
    : scenario.program.mix.residentialLease > 0 ||
      scenario.program.mix.retail > 0;
  if (hasSaleRevenue) {
    if (scenario.program.areaContract) {
      const areas = normalizeRevenueAreaPools(
        scenario.program.areaContract.revenueAreas,
      );
      for (const pool of FINANCIAL_REVENUE_POOL_KEYS) {
        if (!pool.endsWith("Sale")) continue;
        const area =
          pool === "residentialSale"
            ? areas.residentialSaleSqm
            : pool === "retailSale"
              ? areas.retailSaleSqm
              : areas.officeSaleSqm;
        if (area > 0) fields.push(revenuePriceSourceFieldForPool(pool));
      }
    } else {
      fields.push("salePricePerSqM");
    }
    fields.push("saleOutMonths");
    if (
      hasResidentialSale &&
      scenario.program.type !== "single-house" &&
      scenario.program.type !== "multi-family"
    ) {
      fields.push("salesPaceMonthlyPct");
    }
  }
  if (hasLeaseRevenue) {
    if (scenario.program.areaContract) {
      const areas = normalizeRevenueAreaPools(
        scenario.program.areaContract.revenueAreas,
      );
      for (const pool of FINANCIAL_REVENUE_POOL_KEYS) {
        if (!pool.endsWith("Lease")) continue;
        const area =
          pool === "residentialLease"
            ? areas.residentialLeaseSqm
            : pool === "retailLease"
              ? areas.retailLeaseSqm
              : areas.officeLeaseSqm;
        if (area > 0) fields.push(revenuePriceSourceFieldForPool(pool));
      }
    } else {
      fields.push("rentPerSqMMonth");
    }
    fields.push(
      "vacancyRate",
      "operatingExpenseRate",
      "capRate",
      "leaseUpMonths",
      "takeoutLtv",
      "takeoutInterestRate",
      "takeoutAmortizationYears",
      "takeoutLoanTermYears",
      "takeoutPaymentDeferralMonths",
      "takeoutInterestOnlyMonths",
      "takeoutRateResetMonths",
      "takeoutDsraMonths",
      "takeoutMinDscr",
      "takeoutLoanCommitmentManwon",
      "takeoutFeeRate",
    );
    if ((scenario.assumptions.takeoutRateResetMonths ?? 0) > 0) {
      fields.push(
        "takeoutAnnualRateChange",
        "takeoutRateFloor",
        "takeoutRateCap",
      );
    }
    if ((scenario.assumptions.holdPeriodYears ?? 0) > 0) {
      fields.push(...HOLD_PERIOD_SOURCE_FIELDS);
      const tenantLeaseTermMonths =
        scenario.assumptions.tenantLeaseTermMonths ?? 0;
      if (
        tenantLeaseTermMonths > 0 &&
        tenantLeaseTermMonths <
          (scenario.assumptions.holdPeriodYears ?? 0) * 12
      ) {
        const renewalProbability =
          scenario.assumptions.tenantRenewalProbability ?? 0;
        fields.push("tenantRenewalProbability");
        if (renewalProbability > 0) {
          fields.push(
            "renewalRentAdjustmentRate",
            "renewalRentFreeMonths",
          );
        }
        if (renewalProbability < 100) {
          fields.push(
            "replacementDowntimeMonths",
            "replacementRentFreeMonths",
            "replacementTenantImprovementPerSqM",
            "replacementLeasingCommissionRate",
          );
        }
      }
    }
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
    else if (!revenuePoolForPriceSourceField(field)) {
      nextAssumptions[field as keyof AssumptionSet] = record.value;
    }
    applied.push(field);
  }

  const scenarioWithAssumptions = {
    ...scenario,
    assumptions: nextAssumptions,
  };

  return {
    parcel: nextParcel,
    scenario: {
      ...scenarioWithAssumptions,
      revenuePricing: applyRevenuePricingSources(
        scenarioWithAssumptions,
        records,
      ),
    },
    applied,
  };
}

export function applyRevenuePricingSources(
  scenario: Scenario,
  records: FinancialSourceMap | undefined,
): FinancialRevenuePricingSnapshot {
  const pricing =
    scenario.revenuePricing ??
    scenario.program.areaContract?.revenueProjection?.pricing ??
    revenuePricingFromAssumptions(scenario.assumptions);
  return applyRevenuePricingSourceRecords(pricing, records);
}

export function applyRevenuePricingSourceRecords(
  basePricing: FinancialRevenuePricingSnapshot,
  records: FinancialSourceMap | undefined,
): FinancialRevenuePricingSnapshot {
  let pricing = basePricing;
  if (!records) return pricing;

  const apply = (
    pool: (typeof FINANCIAL_REVENUE_POOL_KEYS)[number],
    record: FinancialSourceRecord,
  ) => {
    const evidenceValid = validateFinancialSourceEvidence(record).valid;
    pricing = applyRevenuePoolSource(pricing, pool, {
      value: record.value,
      field: record.field as RevenuePoolPricingSnapshot["sourceField"],
      status: evidenceValid ? "source-backed" : "user-input",
      name: evidenceValid
        ? record.sourceName
        : `원문 미확인 · ${record.sourceName}`,
      ref: record.documentRef,
      asOf: record.asOf,
    });
  };

  const genericSale = records.salePricePerSqM;
  const genericRent = records.rentPerSqMMonth;
  if (genericSale && validateFinancialSource(genericSale).valid) {
    for (const pool of FINANCIAL_REVENUE_POOL_KEYS.filter((key) =>
      key.endsWith("Sale"),
    )) {
      apply(pool, genericSale);
    }
  }
  if (genericRent && validateFinancialSource(genericRent).valid) {
    for (const pool of FINANCIAL_REVENUE_POOL_KEYS.filter((key) =>
      key.endsWith("Lease"),
    )) {
      apply(pool, genericRent);
    }
  }
  for (const [field, record] of Object.entries(records) as Array<
    [FinancialSourceField, FinancialSourceRecord | undefined]
  >) {
    const pool = revenuePoolForPriceSourceField(field);
    if (!pool || !record || !validateFinancialSource(record).valid) continue;
    apply(pool, record);
  }
  return pricing;
}
