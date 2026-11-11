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
  buildTakeoutDebtSchedule,
  type TakeoutUnderwritingResult,
} from "@/lib/finance/takeout-underwriting";

export const HOLD_PERIOD_LEDGER_MODEL_VERSION =
  "hold-period-ledger-2026.4" as const;

export interface HoldPeriodTerms {
  holdPeriodYears: number;
  annualRentGrowthRatePct: number;
  annualExpenseGrowthRatePct: number;
  rentFreeMonths: number;
  tenantImprovementPerSqMWon: number;
  leasingCommissionRatePct: number;
  securityDepositMonths: number;
  tenantLeaseTermMonths: number;
  tenantRenewalProbabilityPct: number;
  renewalRentAdjustmentRatePct: number;
  renewalRentFreeMonths: number;
  replacementDowntimeMonths: number;
  replacementRentFreeMonths: number;
  replacementTenantImprovementPerSqMWon: number;
  replacementLeasingCommissionRatePct: number;
  replacementReservePerSqMYearWon: number;
  majorRepairYear: number;
  majorRepairCostManwon: number;
  exitCapRatePct: number;
  exitSellingCostRatePct: number;
}

export interface HoldPeriodLedgerInput {
  developmentEquityCashFlowsManwon: number[];
  saleRevenueManwon: number;
  capitalizedLeaseValueManwon: number;
  stabilizedAnnualPotentialRentManwon: number;
  stabilizedAnnualOperatingExpenseManwon: number;
  stabilizedAnnualNoiManwon: number;
  leaseAreaSqm: number;
  vacancyRatePct: number;
  equityHurdleRatePct: number;
  takeout: TakeoutUnderwritingResult;
  terms: HoldPeriodTerms;
}

export type HoldPeriodLedgerStatus =
  | "not-applicable"
  | "not-configured"
  | "terms-missing"
  | "terms-invalid"
  | "modeled-unverified"
  | "refinance-shortfall"
  | "commitment-feasible";

export type HoldPeriodStrategyMode = "all-lease" | "mixed-sale-lease";

export interface TenantRolloverEvent {
  cycle: number;
  holdMonth: number;
  renewalSharePct: number;
  replacementSharePct: number;
  replacementTenantImprovementManwon: number;
  replacementLeasingCommissionManwon: number;
}

export interface HoldPeriodLedgerRow {
  month: number;
  holdMonth: number;
  phase: "refinance" | "operations" | "exit";
  potentialRent: number;
  scheduledRent: number;
  rentFreeConcession: number;
  rolloverDowntimeLoss: number;
  renewalRentFreeConcession: number;
  replacementRentFreeConcession: number;
  tenantCycle: number;
  tenantRolloverEvent: boolean;
  effectiveGrossIncome: number;
  operatingExpense: number;
  noi: number;
  replacementReserve: number;
  tenantImprovement: number;
  leasingCommission: number;
  majorRepair: number;
  debtAnnualRatePct: number;
  debtInterestAccrued: number;
  debtInterest: number;
  debtCapitalizedInterest: number;
  debtPrincipal: number;
  debtService: number;
  debtBalloon: number;
  loanDraw: number;
  takeoutFee: number;
  pfRepayment: number;
  refinanceShortfall: number;
  dsraTarget: number;
  dsraFunding: number;
  dsraDraw: number;
  dsraRelease: number;
  dsraBalance: number;
  securityDepositInflow: number;
  securityDepositRefund: number;
  restrictedDepositBalance: number;
  exitSaleGross: number;
  sellingCost: number;
  loanPayoff: number;
  takeoutBalance: number;
  equityCashFlow: number;
  cumulativeEquityCashFlow: number;
}

export interface HoldPeriodAnnualSummary {
  year: number;
  effectiveGrossIncome: number;
  operatingExpense: number;
  noi: number;
  rentFreeConcession: number;
  rolloverDowntimeLoss: number;
  tenantImprovement: number;
  leasingCommission: number;
  replacementReserve: number;
  majorRepair: number;
  minimumDebtRatePct: number | null;
  maximumDebtRatePct: number | null;
  debtCapitalizedInterest: number;
  debtInterest: number;
  debtPrincipal: number;
  debtService: number;
  debtBalloon: number;
  dsraFunding: number;
  dsraDraw: number;
  dsraRelease: number;
  equityCashFlowBeforeSale: number;
  dscr: number | null;
}

export interface HoldPeriodLedgerResult {
  modelVersion: typeof HOLD_PERIOD_LEDGER_MODEL_VERSION;
  status: HoldPeriodLedgerStatus;
  missingTerms: Array<keyof HoldPeriodTerms>;
  invalidTerms: string[];
  strategyMode: HoldPeriodStrategyMode | null;
  developmentSaleRevenueManwon: number;
  retainedLeaseValueManwon: number;
  holdMonths: number;
  rows: HoldPeriodLedgerRow[];
  annualSummaries: HoldPeriodAnnualSummary[];
  tenantRolloverEvents: TenantRolloverEvent[];
  combinedEquityCashFlowsManwon: number[];
  initialTenantImprovementManwon: number | null;
  initialLeasingCommissionManwon: number | null;
  securityDepositManwon: number | null;
  maximumSecurityDepositManwon: number | null;
  totalEffectiveGrossIncomeManwon: number | null;
  totalOperatingExpenseManwon: number | null;
  totalNoiManwon: number | null;
  totalRentFreeConcessionManwon: number | null;
  totalRolloverDowntimeLossManwon: number | null;
  totalReplacementTenantImprovementManwon: number | null;
  totalReplacementLeasingCommissionManwon: number | null;
  totalReplacementReserveManwon: number | null;
  totalMajorRepairManwon: number | null;
  totalTakeoutInterestManwon: number | null;
  totalTakeoutCapitalizedInterestManwon: number | null;
  totalTakeoutScheduledPrincipalManwon: number | null;
  totalTakeoutBalloonManwon: number | null;
  initialDsraManwon: number | null;
  totalDsraFundingManwon: number | null;
  totalDsraDrawManwon: number | null;
  totalDsraReleaseManwon: number | null;
  balloonPaymentMonth: number | null;
  exitAnnualNoiManwon: number | null;
  exitSaleGrossManwon: number | null;
  exitSellingCostManwon: number | null;
  exitLoanPayoffManwon: number | null;
  profitManwon: number | null;
  npvManwon: number | null;
  irrPct: number | null;
  irrStatus: "calculated" | "not-calculated" | "ambiguous";
  equityMultiple: number | null;
  equityInvestedManwon: number | null;
  equityDistributionsManwon: number | null;
  minimumAnnualDscr: number | null;
  paybackMonth: number | null;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function invalidOperatingInputMessages(input: HoldPeriodLedgerInput): string[] {
  const errors: string[] = [];
  for (const field of [
    "saleRevenueManwon",
    "stabilizedAnnualPotentialRentManwon",
    "stabilizedAnnualOperatingExpenseManwon",
    "leaseAreaSqm",
  ] as const) {
    if (!isFiniteNonNegative(input[field])) {
      errors.push(`${field}: 0 이상의 유한한 숫자가 필요합니다.`);
    }
  }
  if (!isFiniteNonNegative(input.vacancyRatePct) || input.vacancyRatePct > 100) {
    errors.push("vacancyRatePct: 0 이상 100 이하의 유한한 숫자가 필요합니다.");
  }
  if (
    !Number.isFinite(input.equityHurdleRatePct) ||
    input.equityHurdleRatePct <= -100
  ) {
    errors.push("equityHurdleRatePct: -100보다 큰 유한한 숫자가 필요합니다.");
  }
  const cashFlows = input.developmentEquityCashFlowsManwon;
  if (!Array.isArray(cashFlows) || cashFlows.length === 0) {
    errors.push("developmentEquityCashFlowsManwon: 개발 자기자본 원장이 없습니다.");
  } else {
    // Index iteration also checks sparse entries, which Array.some skips.
    for (let month = 0; month < cashFlows.length; month += 1) {
      if (!Number.isFinite(cashFlows[month])) {
        errors.push(`developmentEquityCashFlowsManwon[${month}]: 유한한 숫자가 필요합니다.`);
      }
    }
  }
  return errors;
}

function invalidTakeoutMessages(takeout: TakeoutUnderwritingResult): string[] {
  if (!isRecord(takeout)) return ["takeout: 장기대출 계산 결과가 필요합니다."];
  const errors: string[] = [];
  if (
    !["modeled-unverified", "commitment-feasible", "commitment-shortfall"].includes(
      takeout.status,
    )
  ) {
    errors.push("takeout.status: 계산 가능한 장기대출 상태가 아닙니다.");
  }
  for (const field of [
    "modeledLoanManwon",
    "netTakeoutProceedsManwon",
    "upfrontFeeManwon",
    "dsraRequiredBalanceManwon",
    "pfBalanceToRefinanceManwon",
    "refinanceShortfallManwon",
  ] as const) {
    if (!isFiniteNonNegative(takeout[field])) {
      errors.push(`takeout.${field}: 0 이상의 유한한 숫자가 필요합니다.`);
    }
  }
  if (!Number.isFinite(takeout.netTakeoutCashFlowManwon)) {
    errors.push("takeout.netTakeoutCashFlowManwon: 부호를 유지한 유한한 종결 현금흐름이 필요합니다.");
  }
  const { terms } = takeout;
  if (!isRecord(terms)) {
    return [...errors, "takeout.terms: 장기대출 원리금 조건이 필요합니다."];
  }
  // Match the existing takeout contract for terms consumed by its scheduler.
  for (const [field, minimum, maximum, integer] of [
    ["annualInterestRatePct", 0, 100, false],
    ["amortizationYears", 1, 50, true],
    ["loanTermYears", 1, 50, true],
    ["paymentDeferralMonths", 0, 120, true],
    ["interestOnlyMonths", 0, 600, true],
    ["rateResetMonths", 0, 120, true],
    ["annualRateChangePct", -20, 20, false],
    ["rateFloorPct", 0, 100, false],
    ["rateCapPct", 0, 100, false],
  ] as const) {
    const value = terms[field];
    if (
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum ||
      (integer && !Number.isInteger(value)) ||
      (field === "annualInterestRatePct" && value === 0)
    ) {
      errors.push(`takeout.terms.${field}: 장기대출 입력 범위를 확인해야 합니다.`);
    }
  }
  if (terms.rateCapPct > 0 && terms.rateFloorPct > terms.rateCapPct) {
    errors.push("takeout.terms.rateFloorPct: 금리 floor는 cap보다 클 수 없습니다.");
  }
  if (terms.paymentDeferralMonths >= terms.loanTermYears * 12) {
    errors.push("takeout.terms.paymentDeferralMonths: 납부유예는 계약 만기보다 짧아야 합니다.");
  }
  if (
    terms.paymentDeferralMonths + terms.interestOnlyMonths >
    terms.loanTermYears * 12
  ) {
    errors.push("takeout.terms.interestOnlyMonths: 납부유예와 이자만 납부 기간의 합은 계약 만기를 넘을 수 없습니다.");
  }
  return errors;
}

function hasNonFiniteNumbers(value: object): boolean {
  return Object.values(value).some(
    (entry) => typeof entry === "number" && !Number.isFinite(entry),
  );
}

function invalidResult(errors: string[]): HoldPeriodLedgerResult {
  return emptyResult("terms-invalid", [], errors, errors);
}

function overflowResult(): HoldPeriodLedgerResult {
  return invalidResult(["보유 원장 계산 결과가 유한한 수치 범위를 벗어났습니다."]);
}

function emptyResult(
  status: Extract<
    HoldPeriodLedgerStatus,
    "not-applicable" | "not-configured" | "terms-missing" | "terms-invalid"
  >,
  missingTerms: Array<keyof HoldPeriodTerms>,
  invalidTerms: string[],
  warnings: string[],
): HoldPeriodLedgerResult {
  return {
    modelVersion: HOLD_PERIOD_LEDGER_MODEL_VERSION,
    status,
    missingTerms,
    invalidTerms,
    strategyMode: null,
    developmentSaleRevenueManwon: 0,
    retainedLeaseValueManwon: 0,
    holdMonths: 0,
    rows: [],
    annualSummaries: [],
    tenantRolloverEvents: [],
    combinedEquityCashFlowsManwon: [],
    initialTenantImprovementManwon: null,
    initialLeasingCommissionManwon: null,
    securityDepositManwon: null,
    maximumSecurityDepositManwon: null,
    totalEffectiveGrossIncomeManwon: null,
    totalOperatingExpenseManwon: null,
    totalNoiManwon: null,
    totalRentFreeConcessionManwon: null,
    totalRolloverDowntimeLossManwon: null,
    totalReplacementTenantImprovementManwon: null,
    totalReplacementLeasingCommissionManwon: null,
    totalReplacementReserveManwon: null,
    totalMajorRepairManwon: null,
    totalTakeoutInterestManwon: null,
    totalTakeoutCapitalizedInterestManwon: null,
    totalTakeoutScheduledPrincipalManwon: null,
    totalTakeoutBalloonManwon: null,
    initialDsraManwon: null,
    totalDsraFundingManwon: null,
    totalDsraDrawManwon: null,
    totalDsraReleaseManwon: null,
    balloonPaymentMonth: null,
    exitAnnualNoiManwon: null,
    exitSaleGrossManwon: null,
    exitSellingCostManwon: null,
    exitLoanPayoffManwon: null,
    profitManwon: null,
    npvManwon: null,
    irrPct: null,
    irrStatus: "not-calculated",
    equityMultiple: null,
    equityInvestedManwon: null,
    equityDistributionsManwon: null,
    minimumAnnualDscr: null,
    paybackMonth: null,
    warnings,
  };
}

function growthFactor(annualRatePct: number, month: number): number {
  return Math.pow(1 + annualRatePct / 100, month / 12);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total.plus(value), ZERO).toNumber();
}

function sustainedPaybackMonth(cashFlows: number[]): number | null {
  let cumulative = ZERO;
  const cumulativeByMonth = cashFlows.map((cashFlow) => {
    cumulative = cumulative.plus(cashFlow);
    return cumulative;
  });
  const index = cumulativeByMonth.findIndex(
    (value, month) =>
      month > 0 &&
      value.gte(0) &&
      cumulativeByMonth.slice(month).every((later) => later.gte(0)),
  );
  return index >= 0 ? index : null;
}

function annualSummaries(
  rows: HoldPeriodLedgerRow[],
): HoldPeriodAnnualSummary[] {
  const operationRows = rows.filter((row) => row.holdMonth > 0);
  const years = new Map<number, HoldPeriodLedgerRow[]>();
  for (const row of operationRows) {
    const year = Math.ceil(row.holdMonth / 12);
    years.set(year, [...(years.get(year) ?? []), row]);
  }
  return Array.from(years.entries()).map(([year, yearRows]) => {
    const noi = sum(yearRows.map((row) => row.noi));
    const debtService = sum(yearRows.map((row) => row.debtService));
    const activeDebtRates = yearRows
      .filter(
        (row) =>
          row.takeoutBalance > 0 ||
          row.debtService > 0 ||
          row.debtBalloon > 0,
      )
      .map((row) => row.debtAnnualRatePct);
    return {
      year,
      effectiveGrossIncome: sum(
        yearRows.map((row) => row.effectiveGrossIncome),
      ),
      operatingExpense: sum(yearRows.map((row) => row.operatingExpense)),
      noi,
      rentFreeConcession: sum(
        yearRows.map((row) => row.rentFreeConcession),
      ),
      rolloverDowntimeLoss: sum(
        yearRows.map((row) => row.rolloverDowntimeLoss),
      ),
      tenantImprovement: sum(
        yearRows.map((row) => row.tenantImprovement),
      ),
      leasingCommission: sum(
        yearRows.map((row) => row.leasingCommission),
      ),
      replacementReserve: sum(
        yearRows.map((row) => row.replacementReserve),
      ),
      majorRepair: sum(yearRows.map((row) => row.majorRepair)),
      minimumDebtRatePct:
        activeDebtRates.length > 0 ? Math.min(...activeDebtRates) : null,
      maximumDebtRatePct:
        activeDebtRates.length > 0 ? Math.max(...activeDebtRates) : null,
      debtCapitalizedInterest: sum(
        yearRows.map((row) => row.debtCapitalizedInterest),
      ),
      debtInterest: sum(yearRows.map((row) => row.debtInterest)),
      debtPrincipal: sum(yearRows.map((row) => row.debtPrincipal)),
      debtService,
      debtBalloon: sum(yearRows.map((row) => row.debtBalloon)),
      dsraFunding: sum(yearRows.map((row) => row.dsraFunding)),
      dsraDraw: sum(yearRows.map((row) => row.dsraDraw)),
      dsraRelease: sum(yearRows.map((row) => row.dsraRelease)),
      equityCashFlowBeforeSale: sum(
        yearRows.map(
          (row) =>
            row.equityCashFlow -
            row.exitSaleGross +
            row.sellingCost +
            row.loanPayoff,
        ),
      ),
      dscr: debtService > 0 ? noi / debtService : null,
    };
  });
}

function invalidTermMessages(terms: HoldPeriodTerms): string[] {
  const errors: string[] = [];
  if (
    !Number.isInteger(terms.holdPeriodYears) ||
    terms.holdPeriodYears < 0 ||
    terms.holdPeriodYears > 50
  ) {
    errors.push("보유기간은 0 이상 50 이하의 정수 년이어야 합니다.");
  }
  if (
    !Number.isFinite(terms.annualRentGrowthRatePct) ||
    terms.annualRentGrowthRatePct < -20 ||
    terms.annualRentGrowthRatePct > 50
  ) {
    errors.push("연 임대료 성장률은 -20% 이상 50% 이하여야 합니다.");
  }
  if (
    !Number.isFinite(terms.annualExpenseGrowthRatePct) ||
    terms.annualExpenseGrowthRatePct < -20 ||
    terms.annualExpenseGrowthRatePct > 50
  ) {
    errors.push("연 운영비 성장률은 -20% 이상 50% 이하여야 합니다.");
  }
  if (
    !Number.isInteger(terms.rentFreeMonths) ||
    terms.rentFreeMonths < 0 ||
    terms.rentFreeMonths > 60
  ) {
    errors.push("무상임대 기간은 0 이상 60 이하의 정수 개월이어야 합니다.");
  }
  for (const [value, label, maximum] of [
    [terms.tenantLeaseTermMonths, "가중 평균 임대차 기간", 600],
    [terms.renewalRentFreeMonths, "갱신 무상임대 기간", 120],
    [terms.replacementDowntimeMonths, "신규 임차인 유치 공실기간", 120],
    [terms.replacementRentFreeMonths, "신규 임차인 무상임대 기간", 120],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      errors.push(`${label}은(는) 0 이상 ${maximum} 이하의 정수 개월이어야 합니다.`);
    }
  }
  if (
    !Number.isFinite(terms.renewalRentAdjustmentRatePct) ||
    terms.renewalRentAdjustmentRatePct < -100 ||
    terms.renewalRentAdjustmentRatePct > 100
  ) {
    errors.push("갱신 임대료 조정률은 -100% 이상 100% 이하여야 합니다.");
  }
  if (
    !Number.isInteger(terms.majorRepairYear) ||
    terms.majorRepairYear < 0 ||
    terms.majorRepairYear > 50
  ) {
    errors.push("대수선 연차는 0 이상 50 이하의 정수 년이어야 합니다.");
  }
  const rangedTerms: Array<
    [keyof HoldPeriodTerms, string, number]
  > = [
    ["tenantImprovementPerSqMWon", "임차인 공사비", 1_000_000_000],
    ["leasingCommissionRatePct", "임대 중개수수료율", 100],
    ["securityDepositMonths", "보증금 개월 수", 120],
    ["tenantRenewalProbabilityPct", "임차인 갱신 확률", 100],
    [
      "replacementTenantImprovementPerSqMWon",
      "신규 임차인 공사비",
      1_000_000_000,
    ],
    [
      "replacementLeasingCommissionRatePct",
      "신규 임대 중개수수료율",
      100,
    ],
    ["replacementReservePerSqMYearWon", "대수선 준비금", 1_000_000_000],
    ["majorRepairCostManwon", "대수선 비용", 100_000_000_000],
    ["exitCapRatePct", "보유 종료 Exit cap rate", 100],
    ["exitSellingCostRatePct", "매각 부대비율", 100],
  ];
  for (const [field, label, maximum] of rangedTerms) {
    if (
      !Number.isFinite(terms[field]) ||
      terms[field] < 0 ||
      terms[field] > maximum
    ) {
      errors.push(`${label}은(는) 0 이상 ${maximum} 이하여야 합니다.`);
    }
  }
  if (terms.holdPeriodYears > 0) {
    const holdMonths = terms.holdPeriodYears * 12;
    if (terms.rentFreeMonths > holdMonths) {
      errors.push("무상임대 기간은 전체 보유기간을 넘을 수 없습니다.");
    }
    if (terms.majorRepairYear > terms.holdPeriodYears) {
      errors.push("대수선 연차는 전체 보유기간을 넘을 수 없습니다.");
    }
  }
  if (terms.tenantLeaseTermMonths > 0) {
    if (
      terms.tenantRenewalProbabilityPct > 0 &&
      terms.renewalRentFreeMonths >= terms.tenantLeaseTermMonths
    ) {
      errors.push("갱신 무상임대 기간은 임대차 기간보다 짧아야 합니다.");
    }
    if (
      terms.tenantRenewalProbabilityPct < 100 &&
      terms.replacementDowntimeMonths + terms.replacementRentFreeMonths >=
        terms.tenantLeaseTermMonths
    ) {
      errors.push(
        "신규 임차인 공실과 무상임대 기간의 합은 임대차 기간보다 짧아야 합니다.",
      );
    }
  }
  return errors;
}

/**
 * Builds a separate long-term-hold lens after the development sale program
 * ends. Sale-pool cash flows stay in the development ledger, while only the
 * retained lease value is replaced by take-out proceeds.
 */
export function buildHoldPeriodLedger(
  input: HoldPeriodLedgerInput,
): HoldPeriodLedgerResult {
  if (!isFiniteNonNegative(input.capitalizedLeaseValueManwon)) {
    return invalidResult(["capitalizedLeaseValueManwon: 0 이상의 유한한 숫자가 필요합니다."]);
  }
  if (!Number.isFinite(input.stabilizedAnnualNoiManwon)) {
    return invalidResult(["stabilizedAnnualNoiManwon: 유한한 숫자가 필요합니다."]);
  }
  const leaseValue = input.capitalizedLeaseValueManwon;
  const stabilizedNoi = input.stabilizedAnnualNoiManwon;
  if (leaseValue <= 0 || stabilizedNoi <= 0) {
    return emptyResult("not-applicable", [], [], [
      "안정화 임대가치와 NOI가 모두 있는 안에만 장기 보유 대안을 계산합니다.",
    ]);
  }
  const { terms } = input;
  if (!isRecord(terms)) {
    return invalidResult(["terms: 보유기간 조건이 필요합니다."]);
  }
  if (terms.holdPeriodYears === 0) {
    return emptyResult("not-configured", [], [], [
      "보유기간을 입력하면 안정화 후 장기 보유 대안을 계산합니다.",
    ]);
  }

  const invalidTerms = [
    ...invalidTermMessages(terms),
    ...invalidOperatingInputMessages(input),
  ];
  if (invalidTerms.length > 0) {
    return emptyResult("terms-invalid", [], invalidTerms, invalidTerms);
  }

  const missingTerms: Array<keyof HoldPeriodTerms> = [];
  if (!Number.isFinite(terms.exitCapRatePct) || terms.exitCapRatePct <= 0) {
    missingTerms.push("exitCapRatePct");
  }
  if (
    !Number.isInteger(terms.tenantLeaseTermMonths) ||
    terms.tenantLeaseTermMonths <= 0
  ) {
    missingTerms.push("tenantLeaseTermMonths");
  }
  if (
    input.takeout?.status === "terms-missing" ||
    input.takeout?.status === "not-applicable"
  ) {
    return emptyResult("terms-missing", missingTerms, [], [
      ...(Array.isArray(input.takeout.warnings) ? input.takeout.warnings : []),
      "장기대출 원리금 조건을 먼저 입력해야 보유 원장을 계산합니다.",
    ]);
  }
  const invalidTakeout = invalidTakeoutMessages(input.takeout);
  if (invalidTakeout.length > 0) return invalidResult(invalidTakeout);
  if (missingTerms.length > 0) {
    return emptyResult("terms-missing", missingTerms, [], [
      "보유 종료 Exit cap rate와 가중 평균 임대차 기간을 입력해야 보유 현금흐름을 계산합니다.",
    ]);
  }
  const holdMonths = terms.holdPeriodYears * 12;
  const developmentSaleRevenue = input.saleRevenueManwon;
  const strategyMode: HoldPeriodStrategyMode =
    developmentSaleRevenue > 0 ? "mixed-sale-lease" : "all-lease";
  const leaseAreaSqm = input.leaseAreaSqm;
  const annualPotentialRent = D(input.stabilizedAnnualPotentialRentManwon);
  const annualOperatingExpense = D(input.stabilizedAnnualOperatingExpenseManwon);
  const vacancyFactor = D(1).minus(D(input.vacancyRatePct).div(100));
  const tenantLeaseTermMonths = terms.tenantLeaseTermMonths;
  const renewalShare = D(terms.tenantRenewalProbabilityPct).div(100);
  const replacementShare = D(1).minus(renewalShare);
  const renewalRentMultiplier = D(1).plus(
    D(terms.renewalRentAdjustmentRatePct).div(100),
  );
  const modeledLoan = D(input.takeout.modeledLoanManwon!);
  const netTakeoutCashFlow = D(input.takeout.netTakeoutCashFlowManwon!);
  const initialTenantImprovement = D(leaseAreaSqm)
    .times(terms.tenantImprovementPerSqMWon)
    .div(10_000);
  const stabilizedScheduledAnnualRent = annualPotentialRent.times(
    vacancyFactor,
  );
  const initialLeasingCommission = stabilizedScheduledAnnualRent.times(
    D(terms.leasingCommissionRatePct).div(100),
  );
  const securityDeposit = stabilizedScheduledAnnualRent
    .div(12)
    .times(terms.securityDepositMonths);
  const developmentEndMonth = input.developmentEquityCashFlowsManwon.length - 1;
  const combinedCashFlows = [...input.developmentEquityCashFlowsManwon];
  combinedCashFlows[developmentEndMonth] = D(
    combinedCashFlows[developmentEndMonth],
  )
    .minus(leaseValue)
    .plus(netTakeoutCashFlow)
    .minus(initialTenantImprovement)
    .minus(initialLeasingCommission)
    .toNumber();

  let cumulativeEquityCashFlow = combinedCashFlows.reduce(
    (total, cashFlow) => total.plus(cashFlow),
    ZERO,
  );
  let takeoutBalance = modeledLoan;
  const takeoutSchedule = buildTakeoutDebtSchedule(
    modeledLoan.toNumber(),
    input.takeout.terms,
  );
  if (takeoutSchedule.rows.some(hasNonFiniteNumbers)) return overflowResult();
  const dsraTarget = D(input.takeout.dsraRequiredBalanceManwon!);
  let dsraBalance = dsraTarget;
  let restrictedDepositBalance = securityDeposit;
  let maximumSecurityDeposit = securityDeposit;
  let exitAnnualNoi = ZERO;
  const tenantRolloverEvents: TenantRolloverEvent[] = [];

  const rows: HoldPeriodLedgerRow[] = [
    {
      month: developmentEndMonth,
      holdMonth: 0,
      phase: "refinance",
      potentialRent: 0,
      scheduledRent: 0,
      rentFreeConcession: 0,
      rolloverDowntimeLoss: 0,
      renewalRentFreeConcession: 0,
      replacementRentFreeConcession: 0,
      tenantCycle: 0,
      tenantRolloverEvent: false,
      effectiveGrossIncome: 0,
      operatingExpense: 0,
      noi: 0,
      replacementReserve: 0,
      tenantImprovement: initialTenantImprovement.toNumber(),
      leasingCommission: initialLeasingCommission.toNumber(),
      majorRepair: 0,
      debtAnnualRatePct: input.takeout.terms.annualInterestRatePct,
      debtInterestAccrued: 0,
      debtInterest: 0,
      debtCapitalizedInterest: 0,
      debtPrincipal: 0,
      debtService: 0,
      debtBalloon: 0,
      loanDraw: modeledLoan.toNumber(),
      takeoutFee: input.takeout.upfrontFeeManwon!,
      pfRepayment: input.takeout.pfBalanceToRefinanceManwon,
      refinanceShortfall: input.takeout.refinanceShortfallManwon!,
      dsraTarget: dsraTarget.toNumber(),
      dsraFunding: dsraTarget.toNumber(),
      dsraDraw: 0,
      dsraRelease: 0,
      dsraBalance: dsraBalance.toNumber(),
      securityDepositInflow: securityDeposit.toNumber(),
      securityDepositRefund: 0,
      restrictedDepositBalance: restrictedDepositBalance.toNumber(),
      exitSaleGross: 0,
      sellingCost: 0,
      loanPayoff: 0,
      takeoutBalance: takeoutBalance.toNumber(),
      equityCashFlow: combinedCashFlows[developmentEndMonth],
      cumulativeEquityCashFlow: cumulativeEquityCashFlow.toNumber(),
    },
  ];

  for (let holdMonth = 1; holdMonth <= holdMonths; holdMonth += 1) {
    const rentGrowth = D(
      growthFactor(terms.annualRentGrowthRatePct, holdMonth - 1),
    );
    const expenseGrowth = D(
      growthFactor(terms.annualExpenseGrowthRatePct, holdMonth - 1),
    );
    const potentialRent = annualPotentialRent.div(12).times(rentGrowth);
    const marketScheduledRent = potentialRent.times(vacancyFactor);
    const tenantCycle = Math.floor(
      (holdMonth - 1) / tenantLeaseTermMonths,
    );
    const monthInTenantCycle =
      ((holdMonth - 1) % tenantLeaseTermMonths) + 1;
    const tenantRolloverEvent =
      tenantCycle > 0 && monthInTenantCycle === 1;
    let scheduledRent = marketScheduledRent;
    let rolloverDowntimeLoss = ZERO;
    let renewalRentFreeConcession = ZERO;
    let replacementRentFreeConcession = ZERO;
    let tenantImprovement = ZERO;
    let leasingCommission = ZERO;

    if (tenantCycle > 0) {
      const renewalScheduledRent = marketScheduledRent
        .times(renewalShare)
        .times(renewalRentMultiplier);
      const replacementScheduledRent = marketScheduledRent.times(
        replacementShare,
      );
      scheduledRent = renewalScheduledRent.plus(replacementScheduledRent);
      if (monthInTenantCycle <= terms.renewalRentFreeMonths) {
        renewalRentFreeConcession = renewalScheduledRent;
      }
      if (monthInTenantCycle <= terms.replacementDowntimeMonths) {
        rolloverDowntimeLoss = replacementScheduledRent;
      } else if (
        monthInTenantCycle <=
        terms.replacementDowntimeMonths + terms.replacementRentFreeMonths
      ) {
        replacementRentFreeConcession = replacementScheduledRent;
      }
      if (tenantRolloverEvent) {
        tenantImprovement = D(leaseAreaSqm)
          .times(replacementShare)
          .times(terms.replacementTenantImprovementPerSqMWon)
          .div(10_000);
        leasingCommission = marketScheduledRent
          .times(12)
          .times(replacementShare)
          .times(
            D(terms.replacementLeasingCommissionRatePct).div(100),
          );
        tenantRolloverEvents.push({
          cycle: tenantCycle,
          holdMonth,
          renewalSharePct: renewalShare.times(100).toNumber(),
          replacementSharePct: replacementShare.times(100).toNumber(),
          replacementTenantImprovementManwon:
            tenantImprovement.toNumber(),
          replacementLeasingCommissionManwon:
            leasingCommission.toNumber(),
        });
      }
    }
    const initialRentFreeConcession =
      tenantCycle === 0 && holdMonth <= terms.rentFreeMonths
        ? scheduledRent
        : ZERO;
    const rentFreeConcession = initialRentFreeConcession
      .plus(renewalRentFreeConcession)
      .plus(replacementRentFreeConcession);
    const effectiveGrossIncome = DecimalMax(
      scheduledRent
        .minus(rentFreeConcession)
        .minus(rolloverDowntimeLoss),
      ZERO,
    );
    const operatingExpense = annualOperatingExpense
      .div(12)
      .times(expenseGrowth);
    const noi = effectiveGrossIncome.minus(operatingExpense);
    let securityDepositInflow = ZERO;
    let securityDepositRefund = ZERO;
    if (tenantRolloverEvent) {
      const renewalDepositTarget = marketScheduledRent
        .times(renewalShare)
        .times(renewalRentMultiplier)
        .times(terms.securityDepositMonths);
      if (renewalDepositTarget.gte(restrictedDepositBalance)) {
        securityDepositInflow = renewalDepositTarget.minus(
          restrictedDepositBalance,
        );
      } else {
        securityDepositRefund = restrictedDepositBalance.minus(
          renewalDepositTarget,
        );
      }
      restrictedDepositBalance = renewalDepositTarget;
    }
    if (
      tenantCycle > 0 &&
      monthInTenantCycle === terms.replacementDowntimeMonths + 1 &&
      replacementShare.gt(0)
    ) {
      const replacementDeposit = marketScheduledRent
        .times(replacementShare)
        .times(terms.securityDepositMonths);
      securityDepositInflow = securityDepositInflow.plus(
        replacementDeposit,
      );
      restrictedDepositBalance = restrictedDepositBalance.plus(
        replacementDeposit,
      );
    }
    maximumSecurityDeposit = DecimalMax(
      maximumSecurityDeposit,
      restrictedDepositBalance,
    );
    const replacementReserve = D(leaseAreaSqm)
      .times(terms.replacementReservePerSqMYearWon)
      .div(10_000)
      .div(12)
      .times(expenseGrowth);
    const majorRepair =
      terms.majorRepairYear > 0 && holdMonth === terms.majorRepairYear * 12
        ? D(terms.majorRepairCostManwon)
        : ZERO;
    const debtRow = takeoutSchedule.rows[holdMonth - 1];
    const debtAnnualRatePct = debtRow?.annualRatePct ?? 0;
    const debtInterestAccrued = D(
      debtRow?.interestAccruedManwon ?? 0,
    );
    const debtInterest = D(debtRow?.interestPaidManwon ?? 0);
    const debtCapitalizedInterest = D(
      debtRow?.capitalizedInterestManwon ?? 0,
    );
    const debtPrincipal = D(debtRow?.scheduledPrincipalManwon ?? 0);
    const debtService = D(debtRow?.periodicDebtServiceManwon ?? 0);
    const debtBalloon = D(debtRow?.balloonPaymentManwon ?? 0);
    if (debtRow) takeoutBalance = D(debtRow.closingBalanceManwon);

    const preDebtCashFlow = noi
      .minus(replacementReserve)
      .minus(tenantImprovement)
      .minus(leasingCommission)
      .minus(majorRepair);
    const debtServiceShortfall = DecimalMax(
      debtService.minus(DecimalMax(noi, ZERO)),
      ZERO,
    );
    const dsraDraw = DecimalMin(dsraBalance, debtServiceShortfall);
    dsraBalance = DecimalMax(dsraBalance.minus(dsraDraw), ZERO);
    let equityCashFlow = preDebtCashFlow
      .minus(debtService)
      .minus(debtBalloon)
      .plus(dsraDraw);
    let dsraFunding = ZERO;
    let dsraRelease = ZERO;
    if (
      takeoutBalance.gt(0) &&
      holdMonth < holdMonths &&
      dsraBalance.lt(dsraTarget) &&
      equityCashFlow.gt(0)
    ) {
      dsraFunding = DecimalMin(
        equityCashFlow,
        dsraTarget.minus(dsraBalance),
      );
      dsraBalance = dsraBalance.plus(dsraFunding);
      equityCashFlow = equityCashFlow.minus(dsraFunding);
    }
    let exitSaleGross = ZERO;
    let sellingCost = ZERO;
    let loanPayoff = ZERO;

    if (holdMonth === holdMonths) {
      const exitRentGrowth = D(
        growthFactor(terms.annualRentGrowthRatePct, holdMonths),
      );
      const exitExpenseGrowth = D(
        growthFactor(terms.annualExpenseGrowthRatePct, holdMonths),
      );
      const exitTenantCycle = Math.floor(
        holdMonths / tenantLeaseTermMonths,
      );
      const exitRentMultiplier =
        exitTenantCycle > 0
          ? renewalShare
              .times(renewalRentMultiplier)
              .plus(replacementShare)
          : D(1);
      exitAnnualNoi = annualPotentialRent
        .times(exitRentGrowth)
        .times(vacancyFactor)
        .times(exitRentMultiplier)
        .minus(annualOperatingExpense.times(exitExpenseGrowth));
      exitSaleGross = DecimalMax(exitAnnualNoi, ZERO).div(
        D(terms.exitCapRatePct).div(100),
      );
      sellingCost = exitSaleGross.times(
        D(terms.exitSellingCostRatePct).div(100),
      );
      loanPayoff = takeoutBalance;
      takeoutBalance = ZERO;
      securityDepositRefund = securityDepositRefund.plus(
        restrictedDepositBalance,
      );
      restrictedDepositBalance = ZERO;
      equityCashFlow = equityCashFlow
        .plus(exitSaleGross)
        .minus(sellingCost)
        .minus(loanPayoff);
    }

    if (
      dsraBalance.gt(0) &&
      (holdMonth === holdMonths || takeoutBalance.lte(0.000001))
    ) {
      dsraRelease = dsraBalance;
      dsraBalance = ZERO;
      equityCashFlow = equityCashFlow.plus(dsraRelease);
    }

    combinedCashFlows.push(equityCashFlow.toNumber());
    cumulativeEquityCashFlow = cumulativeEquityCashFlow.plus(
      equityCashFlow.toNumber(),
    );
    rows.push({
      month: developmentEndMonth + holdMonth,
      holdMonth,
      phase: holdMonth === holdMonths ? "exit" : "operations",
      potentialRent: potentialRent.toNumber(),
      scheduledRent: scheduledRent.toNumber(),
      rentFreeConcession: rentFreeConcession.toNumber(),
      rolloverDowntimeLoss: rolloverDowntimeLoss.toNumber(),
      renewalRentFreeConcession: renewalRentFreeConcession.toNumber(),
      replacementRentFreeConcession:
        replacementRentFreeConcession.toNumber(),
      tenantCycle,
      tenantRolloverEvent,
      effectiveGrossIncome: effectiveGrossIncome.toNumber(),
      operatingExpense: operatingExpense.toNumber(),
      noi: noi.toNumber(),
      replacementReserve: replacementReserve.toNumber(),
      tenantImprovement: tenantImprovement.toNumber(),
      leasingCommission: leasingCommission.toNumber(),
      majorRepair: majorRepair.toNumber(),
      debtAnnualRatePct,
      debtInterestAccrued: debtInterestAccrued.toNumber(),
      debtInterest: debtInterest.toNumber(),
      debtCapitalizedInterest: debtCapitalizedInterest.toNumber(),
      debtPrincipal: debtPrincipal.toNumber(),
      debtService: debtService.toNumber(),
      debtBalloon: debtBalloon.toNumber(),
      loanDraw: 0,
      takeoutFee: 0,
      pfRepayment: 0,
      refinanceShortfall: 0,
      dsraTarget: takeoutBalance.gt(0) ? dsraTarget.toNumber() : 0,
      dsraFunding: dsraFunding.toNumber(),
      dsraDraw: dsraDraw.toNumber(),
      dsraRelease: dsraRelease.toNumber(),
      dsraBalance: dsraBalance.toNumber(),
      securityDepositInflow: securityDepositInflow.toNumber(),
      securityDepositRefund: securityDepositRefund.toNumber(),
      restrictedDepositBalance: restrictedDepositBalance.toNumber(),
      exitSaleGross: exitSaleGross.toNumber(),
      sellingCost: sellingCost.toNumber(),
      loanPayoff: loanPayoff.toNumber(),
      takeoutBalance: takeoutBalance.toNumber(),
      equityCashFlow: equityCashFlow.toNumber(),
      cumulativeEquityCashFlow: cumulativeEquityCashFlow.toNumber(),
    });
  }

  if (
    rows.some(hasNonFiniteNumbers) ||
    tenantRolloverEvents.some(hasNonFiniteNumbers) ||
    combinedCashFlows.some((cashFlow) => !Number.isFinite(cashFlow))
  ) {
    return overflowResult();
  }
  const summaries = annualSummaries(rows);
  const cashflowDecimals = combinedCashFlows.map(D);
  const signs = cashflowDecimals
    .filter((cashflow) => !cashflow.eq(0))
    .map((cashflow) => (cashflow.gt(0) ? 1 : -1));
  const signChanges = signs.reduce(
    (count, sign, index) =>
      index > 0 && sign !== signs[index - 1] ? count + 1 : count,
    0,
  );
  const monthlyIrr = signChanges === 1 ? irr(cashflowDecimals, 0.01) : null;
  const irrStatus: HoldPeriodLedgerResult["irrStatus"] =
    signChanges > 1
      ? "ambiguous"
      : monthlyIrr
        ? "calculated"
        : "not-calculated";
  const hurdleRate = Math.pow(1 + input.equityHurdleRatePct / 100, 1 / 12) - 1;
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
  const minimumAnnualDscr = summaries
    .map((summary) => summary.dscr)
    .filter((value): value is number => value != null)
    .reduce<number | null>(
      (minimum, value) => (minimum == null ? value : Math.min(minimum, value)),
      null,
    );
  const lastRow = rows.at(-1)!;
  const balloonRow = rows.find((row) => row.debtBalloon > 0.01);
  const status: HoldPeriodLedgerStatus =
    input.takeout.refinanceShortfallManwon! > 0
      ? "refinance-shortfall"
      : input.takeout.status === "commitment-feasible"
        ? "commitment-feasible"
        : "modeled-unverified";

  const result: HoldPeriodLedgerResult = {
    modelVersion: HOLD_PERIOD_LEDGER_MODEL_VERSION,
    status,
    missingTerms: [],
    invalidTerms: [],
    strategyMode,
    developmentSaleRevenueManwon: toManWon(D(developmentSaleRevenue)),
    retainedLeaseValueManwon: toManWon(D(leaseValue)),
    holdMonths,
    rows,
    annualSummaries: summaries,
    tenantRolloverEvents,
    combinedEquityCashFlowsManwon: combinedCashFlows,
    initialTenantImprovementManwon: toManWon(initialTenantImprovement),
    initialLeasingCommissionManwon: toManWon(initialLeasingCommission),
    securityDepositManwon: toManWon(securityDeposit),
    maximumSecurityDepositManwon: toManWon(maximumSecurityDeposit),
    totalEffectiveGrossIncomeManwon: toManWon(
      D(sum(rows.map((row) => row.effectiveGrossIncome))),
    ),
    totalOperatingExpenseManwon: toManWon(
      D(sum(rows.map((row) => row.operatingExpense))),
    ),
    totalNoiManwon: toManWon(D(sum(rows.map((row) => row.noi)))),
    totalRentFreeConcessionManwon: toManWon(
      D(sum(rows.map((row) => row.rentFreeConcession))),
    ),
    totalRolloverDowntimeLossManwon: toManWon(
      D(sum(rows.map((row) => row.rolloverDowntimeLoss))),
    ),
    totalReplacementTenantImprovementManwon: toManWon(
      D(
        sum(
          rows
            .filter((row) => row.holdMonth > 0)
            .map((row) => row.tenantImprovement),
        ),
      ),
    ),
    totalReplacementLeasingCommissionManwon: toManWon(
      D(
        sum(
          rows
            .filter((row) => row.holdMonth > 0)
            .map((row) => row.leasingCommission),
        ),
      ),
    ),
    totalReplacementReserveManwon: toManWon(
      D(sum(rows.map((row) => row.replacementReserve))),
    ),
    totalMajorRepairManwon: toManWon(
      D(sum(rows.map((row) => row.majorRepair))),
    ),
    totalTakeoutInterestManwon: toManWon(
      D(sum(rows.map((row) => row.debtInterest))),
    ),
    totalTakeoutCapitalizedInterestManwon: toManWon(
      D(sum(rows.map((row) => row.debtCapitalizedInterest))),
    ),
    totalTakeoutScheduledPrincipalManwon: toManWon(
      D(sum(rows.map((row) => row.debtPrincipal))),
    ),
    totalTakeoutBalloonManwon: toManWon(
      D(sum(rows.map((row) => row.debtBalloon))),
    ),
    initialDsraManwon: toManWon(dsraTarget),
    totalDsraFundingManwon: toManWon(
      D(sum(rows.map((row) => row.dsraFunding))),
    ),
    totalDsraDrawManwon: toManWon(
      D(sum(rows.map((row) => row.dsraDraw))),
    ),
    totalDsraReleaseManwon: toManWon(
      D(sum(rows.map((row) => row.dsraRelease))),
    ),
    balloonPaymentMonth: balloonRow?.holdMonth ?? null,
    exitAnnualNoiManwon: toManWon(DecimalMax(exitAnnualNoi, ZERO)),
    exitSaleGrossManwon: toManWon(D(lastRow.exitSaleGross)),
    exitSellingCostManwon: toManWon(D(lastRow.sellingCost)),
    exitLoanPayoffManwon: toManWon(D(lastRow.loanPayoff)),
    profitManwon: toManWon(D(sum(combinedCashFlows))),
    npvManwon: toManWon(npv(hurdleRate, cashflowDecimals)),
    irrPct: monthlyIrr
      ? toPct(annualizeIRR(monthlyIrr, 12).times(HUNDRED))
      : null,
    irrStatus,
    equityMultiple: equityMultiple(distributed, invested)
      .toDecimalPlaces(2)
      .toNumber(),
    equityInvestedManwon: toManWon(invested),
    equityDistributionsManwon: toManWon(distributed),
    minimumAnnualDscr,
    paybackMonth: sustainedPaybackMonth(combinedCashFlows),
    warnings: [
      "장기 보유 결과는 기존 임대 안정화 후 매각 결과와 분리된 대안 원장입니다.",
      ...(strategyMode === "mixed-sale-lease"
        ? [
            `개발 매각대금 ${developmentSaleRevenue.toFixed(0)}만원은 기존 개발 원장에 유지하고, 사업 종료 후 남은 임대자산 ${leaseValue.toFixed(0)}만원만 보유·재융자합니다.`,
          ]
        : []),
      "보증금은 반환 의무가 있는 제한 현금으로 기록하며 PF 상환이나 투자자 배당에 사용하지 않습니다.",
      "초기 임차인 공사비와 임대 중개수수료는 안정화·재융자 월에 일괄 반영합니다.",
      "임차인 교체는 가중 평균 임대차 기간마다 전체 임대면적이 동시에 만기되는 기대값 모델입니다. 갱신분은 임대료 조정·무상임대를, 미갱신분은 공실·무상임대·TI·중개수수료를 반영합니다.",
      "DSRA는 제한현금으로 기록하고 정기 원리금 부족분에만 사용한 뒤 잉여현금으로 보충합니다.",
      "만기 balloon은 정기 원리금 DSCR에서 제외하고 발생월의 자기자본 상환액으로 별도 반영합니다.",
      "재산세·반복 보험료와 임차인별 비동기 만기·대손·중도해지는 아직 포함하지 않습니다.",
      ...(balloonRow && balloonRow.holdMonth < holdMonths
        ? [
            `보유 종료 전 ${balloonRow.holdMonth}개월차에 ${balloonRow.debtBalloon.toFixed(0)}만원의 만기 balloon 상환이 필요하며 후속 재융자는 모델링하지 않았습니다.`,
          ]
        : []),
      ...(input.takeout.status === "modeled-unverified"
        ? ["장기대출 확약액이 없어 계산상 대출 한도는 금융기관 승인액이 아닙니다."]
        : []),
    ],
  };
  if (hasNonFiniteNumbers(result) || summaries.some(hasNonFiniteNumbers)) {
    return overflowResult();
  }
  return result;
}

function DecimalMin(left: ReturnType<typeof D>, right: ReturnType<typeof D>) {
  return left.lte(right) ? left : right;
}

function DecimalMax(left: ReturnType<typeof D>, right: ReturnType<typeof D>) {
  return left.gte(right) ? left : right;
}
