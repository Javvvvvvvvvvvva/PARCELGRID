import {
  D,
  HUNDRED,
  ZERO,
  annualizeIRR,
  equityMultiple,
  irr,
  npv,
  toManWon,
  toPct,
} from "@/lib/finance/math";
import {
  validateSourceDocumentMetadata,
  type SourceDocumentMetadata,
} from "@/lib/finance/source-document";

export const EXPERT_TAX_CONTRACT_SCHEMA_VERSION =
  "expert-tax-input-2026.3" as const;
export const AFTER_TAX_LEDGER_MODEL_VERSION =
  "after-tax-ledger-2026.3" as const;
export const AFTER_TAX_CALCULATION_BASIS_VERSION =
  "after-tax-calculation-basis-2026.1" as const;

export type AfterTaxStrategy = "stabilized-sale" | "long-term-hold";
export type TaxpayerType =
  | "undetermined"
  | "corporation"
  | "individual"
  | "other";

export type TaxAssessmentCategory =
  | "acquisition-tax-in-ledger"
  | "new-building-acquisition-tax"
  | "property-holding-tax"
  | "vat-settlement"
  | "corporate-or-income-tax"
  | "local-income-tax"
  | "additional-disposal-tax"
  | "other-tax";

export type TaxAssessmentStatus =
  | "pending"
  | "confirmed"
  | "not-applicable";

export interface ExpertTaxPayment {
  month: number;
  amountManwon: number;
  direction: "payment" | "refund";
}

export interface ExpertTaxCategoryAssessment {
  category: TaxAssessmentCategory;
  assessmentStatus: TaxAssessmentStatus;
  payments: ExpertTaxPayment[];
  note: string;
}

export interface ExpertTaxAttestation {
  userId: string;
  email: string;
  name: string;
  organization: string;
  reviewerRole: "accountant" | "tax-advisor";
  confirmedAt: string;
}

export interface AfterTaxCalculationBasis {
  version: typeof AFTER_TAX_CALCULATION_BASIS_VERSION;
  fingerprint: string;
  preTaxEquityCashFlowsManwon: number[];
  preTaxAcquisitionTaxManwon: number;
  equityHurdleRatePct: number;
}

export interface ExpertTaxInputContract {
  schemaVersion: typeof EXPERT_TAX_CONTRACT_SCHEMA_VERSION;
  projectId: string;
  scenarioId: string;
  strategy: AfterTaxStrategy;
  taxpayerType: TaxpayerType;
  reviewStatus: "draft" | "expert-confirmed";
  asOf: string;
  preparedBy: string;
  preparerRole: string;
  documentRef: string;
  document?: SourceDocumentMetadata;
  expertAttestation?: ExpertTaxAttestation;
  calculationBasis: AfterTaxCalculationBasis;
  assessments: ExpertTaxCategoryAssessment[];
  updatedAt: string;
}

export interface TaxAssessmentCategoryMeta {
  label: string;
  treatment: "included-in-pretax" | "incremental-after-tax";
  guidance: string;
}

export const TAX_ASSESSMENT_CATEGORY_META: Record<
  TaxAssessmentCategory,
  TaxAssessmentCategoryMeta
> = {
  "acquisition-tax-in-ledger": {
    label: "기존 부동산 취득세",
    treatment: "included-in-pretax",
    guidance:
      "Stage 3 세전 원장의 취득세와 대사합니다. 세후 원장에서 다시 차감하지 않습니다.",
  },
  "new-building-acquisition-tax": {
    label: "신축 건물 취득세",
    treatment: "incremental-after-tax",
    guidance: "신축 원시취득 과세표준과 부가세목을 검토한 납부 일정을 입력합니다.",
  },
  "property-holding-tax": {
    label: "재산세·보유세",
    treatment: "incremental-after-tax",
    guidance: "과세기준일별 재산세와 적용되는 보유세 납부 일정을 입력합니다.",
  },
  "vat-settlement": {
    label: "부가가치세 순정산",
    treatment: "incremental-after-tax",
    guidance: "과세·면세 안분 후 실제 납부 또는 환급 일정을 입력합니다.",
  },
  "corporate-or-income-tax": {
    label: "법인세·소득세",
    treatment: "incremental-after-tax",
    guidance: "사업주체와 세무조정을 반영한 신고·납부 일정을 입력합니다.",
  },
  "local-income-tax": {
    label: "지방소득세",
    treatment: "incremental-after-tax",
    guidance: "법인세·소득세와 구분한 지방소득세 납부 일정을 입력합니다.",
  },
  "additional-disposal-tax": {
    label: "토지·주택 처분 추가과세",
    treatment: "incremental-after-tax",
    guidance: "비사업용 토지·주택 등 추가과세 적용 여부와 금액을 입력합니다.",
  },
  "other-tax": {
    label: "기타 세금·공과",
    treatment: "incremental-after-tax",
    guidance: "위 세목에 포함되지 않는 세금·환급이 있으면 일정을 입력합니다.",
  },
};

export const TAX_ASSESSMENT_CATEGORIES = Object.keys(
  TAX_ASSESSMENT_CATEGORY_META,
) as TaxAssessmentCategory[];

export type AfterTaxLedgerStatus =
  | "not-configured"
  | "incomplete"
  | "invalid"
  | "stale"
  | "draft"
  | "expert-confirmed";

export interface AfterTaxLedgerRow {
  month: number;
  preTaxEquityCashFlow: number;
  taxPayment: number;
  taxRefund: number;
  netTaxCashFlow: number;
  afterTaxEquityCashFlow: number;
  cumulativePreTaxEquityCashFlow: number;
  cumulativeAfterTaxEquityCashFlow: number;
  entries: Array<{
    category: TaxAssessmentCategory;
    direction: ExpertTaxPayment["direction"];
    amountManwon: number;
  }>;
}

export interface AfterTaxLedgerResult {
  modelVersion: typeof AFTER_TAX_LEDGER_MODEL_VERSION;
  status: AfterTaxLedgerStatus;
  strategy: AfterTaxStrategy;
  decisionGrade: boolean;
  calculationBasisFingerprint: string;
  contractBasisFingerprint: string | null;
  missingCategories: TaxAssessmentCategory[];
  errors: string[];
  rows: AfterTaxLedgerRow[];
  includedInPretaxTaxManwon: number;
  grossIncrementalTaxPaymentsManwon: number | null;
  grossIncrementalTaxRefundsManwon: number | null;
  netIncrementalTaxManwon: number | null;
  preTaxProfitManwon: number | null;
  afterTaxProfitManwon: number | null;
  npvManwon: number | null;
  irrPct: number | null;
  /** Optional for historical snapshots; comparisons require the unrounded values. */
  afterTaxProfitUnroundedManwon?: number | null;
  npvUnroundedManwon?: number | null;
  irrUnroundedPct?: number | null;
  irrStatus: "calculated" | "not-calculated" | "ambiguous";
  equityMultiple: number | null;
  equityInvestedManwon: number | null;
  equityDistributionsManwon: number | null;
  paybackMonth: number | null;
  warnings: string[];
}

export function buildExpertTaxContractKey(
  projectId: string,
  scenarioId: string,
  strategy: AfterTaxStrategy,
): string {
  return `${projectId}::${scenarioId}::${strategy}`;
}

export interface AfterTaxCalculationBasisInput {
  preTaxEquityCashFlowsManwon: number[];
  preTaxAcquisitionTaxManwon: number;
  equityHurdleRatePct: number;
}

function canonicalCalculationBasis(
  value: Omit<AfterTaxCalculationBasis, "fingerprint">,
): string {
  return JSON.stringify(value);
}

function stableBasisHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`.toUpperCase();
}

/** Bind an expert tax opinion to the exact pretax cash-flow series it reviewed. */
export function buildAfterTaxCalculationBasis(
  input: AfterTaxCalculationBasisInput,
): AfterTaxCalculationBasis {
  const payload = {
    version: AFTER_TAX_CALCULATION_BASIS_VERSION,
    preTaxEquityCashFlowsManwon: [...input.preTaxEquityCashFlowsManwon],
    preTaxAcquisitionTaxManwon: input.preTaxAcquisitionTaxManwon,
    equityHurdleRatePct: input.equityHurdleRatePct,
  };
  return {
    ...payload,
    fingerprint: `PG-TAX-BASIS-${stableBasisHash(
      canonicalCalculationBasis(payload),
    )}`,
  };
}

function calculationBasisMatches(
  contractBasis: AfterTaxCalculationBasis | undefined,
  currentBasis: AfterTaxCalculationBasis,
): boolean {
  if (!contractBasis) return false;
  const contractPayload = {
    version: contractBasis.version,
    preTaxEquityCashFlowsManwon: contractBasis.preTaxEquityCashFlowsManwon,
    preTaxAcquisitionTaxManwon: contractBasis.preTaxAcquisitionTaxManwon,
    equityHurdleRatePct: contractBasis.equityHurdleRatePct,
  };
  const currentPayload = {
    version: currentBasis.version,
    preTaxEquityCashFlowsManwon: currentBasis.preTaxEquityCashFlowsManwon,
    preTaxAcquisitionTaxManwon: currentBasis.preTaxAcquisitionTaxManwon,
    equityHurdleRatePct: currentBasis.equityHurdleRatePct,
  };
  return (
    contractBasis.fingerprint === currentBasis.fingerprint &&
    canonicalCalculationBasis(contractPayload) ===
      canonicalCalculationBasis(currentPayload)
  );
}

export function createDraftExpertTaxContract(input: {
  projectId: string;
  scenarioId: string;
  strategy: AfterTaxStrategy;
  preTaxEquityCashFlowsManwon: number[];
  preTaxAcquisitionTaxManwon: number;
  equityHurdleRatePct: number;
  updatedAt?: string;
}): ExpertTaxInputContract {
  const acquisitionTax = Number.isFinite(input.preTaxAcquisitionTaxManwon)
    ? Math.max(0, input.preTaxAcquisitionTaxManwon)
    : 0;
  return {
    schemaVersion: EXPERT_TAX_CONTRACT_SCHEMA_VERSION,
    projectId: input.projectId,
    scenarioId: input.scenarioId,
    strategy: input.strategy,
    taxpayerType: "undetermined",
    reviewStatus: "draft",
    asOf: "",
    preparedBy: "",
    preparerRole: "",
    documentRef: "",
    calculationBasis: buildAfterTaxCalculationBasis(input),
    assessments: TAX_ASSESSMENT_CATEGORIES.map((category) => ({
      category,
      assessmentStatus: "pending",
      payments:
        category === "acquisition-tax-in-ledger" && acquisitionTax > 0
          ? [{ month: 0, amountManwon: acquisitionTax, direction: "payment" }]
          : [],
      note: "",
    })),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export interface BuildAfterTaxLedgerInput {
  projectId: string;
  scenarioId: string;
  strategy: AfterTaxStrategy;
  preTaxEquityCashFlowsManwon: number[];
  preTaxAcquisitionTaxManwon: number;
  equityHurdleRatePct: number;
  contract?: ExpertTaxInputContract | null;
}

interface ContractValidation {
  hardErrors: string[];
  completenessErrors: string[];
  missingCategories: TaxAssessmentCategory[];
  basisStale: boolean;
}

function paymentNetAmount(payments: ExpertTaxPayment[]): number {
  return payments.reduce(
    (total, payment) =>
      total +
      (payment.direction === "payment"
        ? payment.amountManwon
        : -payment.amountManwon),
    0,
  );
}

function validateContract(
  input: BuildAfterTaxLedgerInput,
  contract: ExpertTaxInputContract,
): ContractValidation {
  const hardErrors: string[] = [];
  const completenessErrors: string[] = [];
  const currentBasis = buildAfterTaxCalculationBasis(input);
  const basisStale = !calculationBasisMatches(
    contract.calculationBasis,
    currentBasis,
  );
  if (contract.schemaVersion !== EXPERT_TAX_CONTRACT_SCHEMA_VERSION) {
    hardErrors.push("지원하지 않는 세무 입력 계약 버전입니다.");
  }
  if (contract.projectId !== input.projectId) {
    hardErrors.push("세무 입력 계약의 프로젝트가 현재 프로젝트와 다릅니다.");
  }
  if (contract.scenarioId !== input.scenarioId) {
    hardErrors.push("세무 입력 계약의 계획안이 현재 계획안과 다릅니다.");
  }
  if (contract.strategy !== input.strategy) {
    hardErrors.push("세무 입력 계약의 처분전략이 현재 계산과 다릅니다.");
  }
  if (basisStale) {
    completenessErrors.push(
      "세무 검토 후 세전 현금흐름·취득세 또는 요구수익률이 변경됐습니다. 현재 계산 기준으로 다시 저장하고 전문가 확인을 받아야 합니다.",
    );
  }

  const categories = new Map<
    TaxAssessmentCategory,
    ExpertTaxCategoryAssessment
  >();
  for (const assessment of contract.assessments) {
    if (!TAX_ASSESSMENT_CATEGORIES.includes(assessment.category)) {
      hardErrors.push("알 수 없는 세무 검토 항목이 포함돼 있습니다.");
      continue;
    }
    if (categories.has(assessment.category)) {
      hardErrors.push(
        `${TAX_ASSESSMENT_CATEGORY_META[assessment.category].label} 항목이 중복됐습니다.`,
      );
      continue;
    }
    categories.set(assessment.category, assessment);

    const label = TAX_ASSESSMENT_CATEGORY_META[assessment.category].label;
    if (assessment.assessmentStatus === "pending") continue;
    if (!assessment.note.trim()) {
      completenessErrors.push(
        assessment.assessmentStatus === "not-applicable"
          ? `${label}의 해당 없음 근거가 필요합니다.`
          : `${label}의 세무 검토 메모가 필요합니다.`,
      );
    }
    if (
      assessment.assessmentStatus === "not-applicable" &&
      assessment.payments.length > 0
    ) {
      hardErrors.push(`${label}은(는) 해당 없음 상태에서 금액을 가질 수 없습니다.`);
    }
    for (const payment of assessment.payments) {
      if (
        !Number.isInteger(payment.month) ||
        payment.month < 0 ||
        payment.month > 1_200
      ) {
        hardErrors.push(`${label}의 납부·환급 월은 0~1200 사이 정수여야 합니다.`);
      }
      if (!Number.isFinite(payment.amountManwon) || payment.amountManwon < 0) {
        hardErrors.push(`${label}의 납부·환급 금액은 0 이상의 숫자여야 합니다.`);
      }
      if (payment.direction !== "payment" && payment.direction !== "refund") {
        hardErrors.push(`${label}의 현금흐름 방향이 올바르지 않습니다.`);
      }
    }
  }

  const missingCategories = TAX_ASSESSMENT_CATEGORIES.filter(
    (category) =>
      !categories.has(category) ||
      categories.get(category)?.assessmentStatus === "pending",
  );
  if (missingCategories.length > 0) {
    completenessErrors.push(
      `미검토 세목: ${missingCategories
        .map((category) => TAX_ASSESSMENT_CATEGORY_META[category].label)
        .join(" · ")}`,
    );
  }

  const acquisitionAssessment = categories.get("acquisition-tax-in-ledger");
  if (
    acquisitionAssessment &&
    acquisitionAssessment.assessmentStatus !== "pending"
  ) {
    const acquisitionTaxInContract = paymentNetAmount(
      acquisitionAssessment.payments,
    );
    if (
      acquisitionAssessment.assessmentStatus === "confirmed" &&
      Math.abs(acquisitionTaxInContract - input.preTaxAcquisitionTaxManwon) > 1
    ) {
      hardErrors.push(
        "기존 부동산 취득세가 세전 원장의 취득세 반영액과 일치하지 않습니다. Stage 3 취득세 입력을 먼저 수정하세요.",
      );
    }
    if (
      acquisitionAssessment.assessmentStatus === "not-applicable" &&
      input.preTaxAcquisitionTaxManwon > 1
    ) {
      hardErrors.push(
        "세전 원장에 취득세가 포함돼 있어 기존 부동산 취득세를 해당 없음으로 표시할 수 없습니다.",
      );
    }
  }

  if (contract.reviewStatus === "expert-confirmed") {
    if (contract.taxpayerType === "undetermined") {
      completenessErrors.push("납세의무자 유형을 확정해야 합니다.");
    }
    if (!contract.preparedBy.trim()) {
      completenessErrors.push("세무 검토 작성자 이름이 필요합니다.");
    }
    if (!contract.preparerRole.trim()) {
      completenessErrors.push("세무 검토 작성자의 자격·역할이 필요합니다.");
    }
    if (!contract.expertAttestation) {
      completenessErrors.push("로그인한 세무·회계 전문가의 확인 주체가 필요합니다.");
    } else {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          contract.expertAttestation.userId,
        )
      ) {
        hardErrors.push("세무 전문가 사용자 ID가 올바르지 않습니다.");
      }
      if (
        contract.expertAttestation.reviewerRole !== "accountant" &&
        contract.expertAttestation.reviewerRole !== "tax-advisor"
      ) {
        hardErrors.push("세후 원장은 회계사 또는 세무사 역할만 확인할 수 있습니다.");
      }
      if (
        !contract.expertAttestation.confirmedAt ||
        Number.isNaN(Date.parse(contract.expertAttestation.confirmedAt))
      ) {
        completenessErrors.push("세무 전문가 확인 시각이 필요합니다.");
      }
      if (
        contract.preparedBy.trim() !== contract.expertAttestation.name.trim()
      ) {
        hardErrors.push("세무 계약 작성자와 로그인 확인 주체가 일치하지 않습니다.");
      }
    }
    if (!contract.asOf || Number.isNaN(Date.parse(contract.asOf))) {
      completenessErrors.push("세무 검토 기준일이 필요합니다.");
    }
    if (!contract.documentRef.trim()) {
      completenessErrors.push("세무 검토 문서 번호가 필요합니다.");
    }
    if (!contract.document) {
      completenessErrors.push("세무 검토 원문 파일이 필요합니다.");
    } else {
      const documentErrors = validateSourceDocumentMetadata(contract.document);
      if (documentErrors.length > 0) {
        hardErrors.push(...documentErrors.map((error) => `세무 원문: ${error}`));
      }
      if (
        !contract.document.pathname.startsWith(
          `projects/${encodeURIComponent(input.projectId)}/source-documents/`,
        )
      ) {
        hardErrors.push("세무 검토 원문이 현재 프로젝트 경로에 속하지 않습니다.");
      }
    }
  }

  return {
    hardErrors: [...new Set(hardErrors)],
    completenessErrors: [...new Set(completenessErrors)],
    missingCategories,
    basisStale,
  };
}

function emptyResult(
  input: BuildAfterTaxLedgerInput,
  status: "not-configured" | "invalid" | "stale",
  errors: string[],
  contract?: ExpertTaxInputContract | null,
): AfterTaxLedgerResult {
  const calculationBasis = buildAfterTaxCalculationBasis(input);
  return {
    modelVersion: AFTER_TAX_LEDGER_MODEL_VERSION,
    status,
    strategy: input.strategy,
    decisionGrade: false,
    calculationBasisFingerprint: calculationBasis.fingerprint,
    contractBasisFingerprint: contract?.calculationBasis?.fingerprint ?? null,
    missingCategories: [],
    errors,
    rows: [],
    includedInPretaxTaxManwon: Math.max(
      0,
      Number.isFinite(input.preTaxAcquisitionTaxManwon)
        ? input.preTaxAcquisitionTaxManwon
        : 0,
    ),
    grossIncrementalTaxPaymentsManwon: null,
    grossIncrementalTaxRefundsManwon: null,
    netIncrementalTaxManwon: null,
    preTaxProfitManwon: null,
    afterTaxProfitManwon: null,
    npvManwon: null,
    irrPct: null,
    afterTaxProfitUnroundedManwon: null,
    npvUnroundedManwon: null,
    irrUnroundedPct: null,
    irrStatus: "not-calculated",
    equityMultiple: null,
    equityInvestedManwon: null,
    equityDistributionsManwon: null,
    paybackMonth: null,
    warnings:
      status === "not-configured"
        ? [
            "세무 전문가 입력 계약이 없어 세후 수익지표를 계산하지 않습니다.",
          ]
        : status === "stale"
          ? [
              "세무 확인의 계산 기준과 현재 세전 원장이 달라 세후 수익지표를 사용하지 않습니다.",
            ]
          : ["세무 입력 계약 오류를 수정하기 전에는 세후 수익지표를 계산하지 않습니다."],
  };
}

function sustainedPaybackMonth(cashFlows: number[]): number | null {
  let cumulative = 0;
  const cumulativeByMonth = cashFlows.map((cashFlow) => {
    cumulative += cashFlow;
    return cumulative;
  });
  const index = cumulativeByMonth.findIndex(
    (value, month) =>
      month > 0 &&
      value >= 0 &&
      cumulativeByMonth.slice(month).every((later) => later >= 0),
  );
  return index >= 0 ? index : null;
}

export function buildAfterTaxLedger(
  input: BuildAfterTaxLedgerInput,
): AfterTaxLedgerResult {
  if (!Array.isArray(input.preTaxEquityCashFlowsManwon)) {
    return emptyResult({ ...input, preTaxEquityCashFlowsManwon: [] }, "invalid", [
      "저장된 세전 월별 현금흐름이 없습니다. 현재 계획으로 재계산한 저장본이 필요합니다.",
    ], input.contract);
  }
  if (!input.contract) return emptyResult(input, "not-configured", []);
  if (
    input.preTaxEquityCashFlowsManwon.length === 0 ||
    input.preTaxEquityCashFlowsManwon.some((cashFlow) => !Number.isFinite(cashFlow))
  ) {
    return emptyResult(input, "invalid", [
      "유효한 세전 자기자본 월별 현금흐름이 필요합니다.",
    ], input.contract);
  }
  if (
    !Number.isFinite(input.preTaxAcquisitionTaxManwon) ||
    input.preTaxAcquisitionTaxManwon < 0
  ) {
    return emptyResult(input, "invalid", [
      "세전 원장의 취득세 반영액이 올바르지 않습니다.",
    ], input.contract);
  }
  if (
    !Number.isFinite(input.equityHurdleRatePct) ||
    input.equityHurdleRatePct <= -100
  ) {
    return emptyResult(
      input,
      "invalid",
      ["요구수익률 입력값이 올바르지 않습니다."],
      input.contract,
    );
  }

  const validation = validateContract(input, input.contract);
  const allErrors = [
    ...validation.hardErrors,
    ...validation.completenessErrors,
  ];
  if (validation.hardErrors.length > 0) {
    const invalid = emptyResult(input, "invalid", allErrors, input.contract);
    invalid.missingCategories = validation.missingCategories;
    return invalid;
  }
  if (validation.basisStale) {
    const stale = emptyResult(input, "stale", allErrors, input.contract);
    stale.missingCategories = validation.missingCategories;
    return stale;
  }

  const incrementalEntries = input.contract.assessments.flatMap((assessment) =>
    assessment.assessmentStatus === "confirmed" &&
    TAX_ASSESSMENT_CATEGORY_META[assessment.category].treatment ===
      "incremental-after-tax"
      ? assessment.payments.map((payment) => ({
          ...payment,
          category: assessment.category,
        }))
      : [],
  );
  const maxTaxMonth = incrementalEntries.reduce(
    (maximum, payment) => Math.max(maximum, payment.month),
    0,
  );
  const finalMonth = Math.max(
    input.preTaxEquityCashFlowsManwon.length - 1,
    maxTaxMonth,
  );
  let cumulativePreTax = ZERO;
  let cumulativeAfterTax = ZERO;
  const rows: AfterTaxLedgerRow[] = [];
  for (let month = 0; month <= finalMonth; month += 1) {
    const entries = incrementalEntries.filter((entry) => entry.month === month);
    const taxPayment = entries
      .filter((entry) => entry.direction === "payment")
      .reduce((total, entry) => total.plus(entry.amountManwon), ZERO);
    const taxRefund = entries
      .filter((entry) => entry.direction === "refund")
      .reduce((total, entry) => total.plus(entry.amountManwon), ZERO);
    const preTaxEquityCashFlow =
      input.preTaxEquityCashFlowsManwon[month] ?? 0;
    const netTaxCashFlow = taxRefund.minus(taxPayment);
    const afterTaxEquityCashFlow = D(preTaxEquityCashFlow).plus(netTaxCashFlow);
    cumulativePreTax = cumulativePreTax.plus(preTaxEquityCashFlow);
    cumulativeAfterTax = cumulativeAfterTax.plus(afterTaxEquityCashFlow);
    rows.push({
      month,
      preTaxEquityCashFlow,
      taxPayment: taxPayment.toNumber(),
      taxRefund: taxRefund.toNumber(),
      netTaxCashFlow: netTaxCashFlow.toNumber(),
      afterTaxEquityCashFlow: afterTaxEquityCashFlow.toNumber(),
      cumulativePreTaxEquityCashFlow: cumulativePreTax.toNumber(),
      cumulativeAfterTaxEquityCashFlow: cumulativeAfterTax.toNumber(),
      entries: entries.map((entry) => ({
        category: entry.category,
        direction: entry.direction,
        amountManwon: entry.amountManwon,
      })),
    });
  }

  const afterTaxCashFlows = rows.map((row) => row.afterTaxEquityCashFlow);
  const cashflowDecimals = afterTaxCashFlows.map(D);
  const signs = cashflowDecimals
    .filter((cashflow) => !cashflow.eq(0))
    .map((cashflow) => (cashflow.gt(0) ? 1 : -1));
  const signChanges = signs.reduce(
    (count, sign, index) =>
      index > 0 && sign !== signs[index - 1] ? count + 1 : count,
    0,
  );
  const monthlyIrr = signChanges === 1 ? irr(cashflowDecimals, 0.01) : null;
  const irrStatus: AfterTaxLedgerResult["irrStatus"] =
    signChanges > 1
      ? "ambiguous"
      : monthlyIrr
        ? "calculated"
        : "not-calculated";
  const monthlyHurdleRate =
    Math.pow(1 + input.equityHurdleRatePct / 100, 1 / 12) - 1;
  const negativeCashFlows = cashflowDecimals.filter((cashflow) => cashflow.lt(0));
  const positiveCashFlows = cashflowDecimals.filter((cashflow) => cashflow.gt(0));
  const invested = negativeCashFlows.reduce(
    (total, cashflow) => total.plus(cashflow.abs()),
    ZERO,
  );
  const distributed = positiveCashFlows.reduce(
    (total, cashflow) => total.plus(cashflow),
    ZERO,
  );
  const grossPayments = rows.reduce((total, row) => total.plus(row.taxPayment), ZERO);
  const grossRefunds = rows.reduce((total, row) => total.plus(row.taxRefund), ZERO);
  const status: AfterTaxLedgerStatus =
    validation.completenessErrors.length > 0
      ? "incomplete"
      : input.contract.reviewStatus === "expert-confirmed"
        ? "expert-confirmed"
        : "draft";

  const afterTaxProfit = cashflowDecimals.reduce((total, value) => total.plus(value), ZERO);
  const afterTaxNpv = npv(monthlyHurdleRate, cashflowDecimals);
  const afterTaxIrr = monthlyIrr ? annualizeIRR(monthlyIrr, 12).times(HUNDRED) : null;

  return {
    modelVersion: AFTER_TAX_LEDGER_MODEL_VERSION,
    status,
    strategy: input.strategy,
    decisionGrade: status === "expert-confirmed",
    calculationBasisFingerprint: input.contract.calculationBasis.fingerprint,
    contractBasisFingerprint: input.contract.calculationBasis.fingerprint,
    missingCategories: validation.missingCategories,
    errors: allErrors,
    rows,
    includedInPretaxTaxManwon: toManWon(D(input.preTaxAcquisitionTaxManwon)),
    grossIncrementalTaxPaymentsManwon: toManWon(D(grossPayments)),
    grossIncrementalTaxRefundsManwon: toManWon(D(grossRefunds)),
    netIncrementalTaxManwon: toManWon(D(grossPayments).minus(grossRefunds)),
    preTaxProfitManwon: toManWon(
      input.preTaxEquityCashFlowsManwon.reduce((total, value) => total.plus(value), ZERO),
    ),
    afterTaxProfitManwon: toManWon(afterTaxProfit),
    npvManwon: toManWon(afterTaxNpv),
    irrPct: afterTaxIrr ? toPct(afterTaxIrr) : null,
    afterTaxProfitUnroundedManwon: afterTaxProfit.toNumber(),
    npvUnroundedManwon: afterTaxNpv.toNumber(),
    irrUnroundedPct: afterTaxIrr?.toNumber() ?? null,
    irrStatus,
    equityMultiple: invested.gt(0)
      ? equityMultiple(distributed, invested).toDecimalPlaces(2).toNumber()
      : null,
    equityInvestedManwon: toManWon(invested),
    equityDistributionsManwon: toManWon(distributed),
    paybackMonth: sustainedPaybackMonth(afterTaxCashFlows),
    warnings: [
      "세후 현금흐름은 입력된 세무 검토 계약의 납부·환급 시점만 반영합니다.",
      "기존 부동산 취득세는 세전 사업비 원장에 이미 포함되어 세후에서 다시 차감하지 않습니다.",
      ...(status === "expert-confirmed"
        ? ["세무 원문과 작성자 정보가 연결된 전문가 확인 입력입니다."]
        : ["미검토 세목 또는 전문가 확인이 남아 있어 의사결정 확정값이 아닙니다."]),
    ],
  };
}
