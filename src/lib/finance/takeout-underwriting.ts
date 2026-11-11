import { D, ZERO, monthlyMortgagePayment } from "@/lib/finance/math";

export const TAKEOUT_UNDERWRITING_MODEL_VERSION =
  "takeout-underwriting-2026.2" as const;

export interface TakeoutUnderwritingTerms {
  maxLtvPct: number;
  /** 고정금리 또는 변동금리 경로의 최초 all-in 연 금리. */
  annualInterestRatePct: number;
  amortizationYears: number;
  /** 계약 만기. 상환기간보다 짧으면 만기 잔액을 balloon으로 상환한다. */
  loanTermYears: number;
  /** 원리금 납부 없이 이자를 원금에 가산하는 최초 기간. */
  paymentDeferralMonths: number;
  /** 납부유예 뒤 이자만 현금 납부하는 기간. */
  interestOnlyMonths: number;
  /** 0이면 고정금리, 양수면 해당 개월마다 예상 금리를 재설정한다. */
  rateResetMonths: number;
  /** 변동금리 예상 경로의 연간 절대 변화폭(%p/년). */
  annualRateChangePct: number;
  /** 0이면 별도 floor 없음. */
  rateFloorPct: number;
  /** 0이면 별도 cap 없음. */
  rateCapPct: number;
  /** 최대 연간 정기 원리금의 월평균을 기준으로 적립하는 DSRA 개월 수. */
  dsraMonths: number;
  minimumDscr: number;
  loanCommitmentManwon: number;
  upfrontFeeRatePct: number;
}

export interface TakeoutUnderwritingInput {
  stabilizedValueManwon: number;
  stabilizedNoiManwon: number;
  pfBalanceToRefinanceManwon: number;
  terms: TakeoutUnderwritingTerms;
}

export type TakeoutUnderwritingStatus =
  | "not-applicable"
  | "terms-missing"
  | "terms-invalid"
  | "modeled-unverified"
  | "commitment-feasible"
  | "commitment-shortfall";

export type TakeoutBindingConstraint = "ltv" | "dscr" | "commitment";
export type TakeoutRateMode = "fixed" | "projected-variable";
export type TakeoutDebtPhase =
  | "payment-deferral"
  | "interest-only"
  | "amortizing"
  | "paid-off";

export interface TakeoutDebtScheduleRow {
  month: number;
  phase: TakeoutDebtPhase;
  annualRatePct: number;
  openingBalanceManwon: number;
  interestAccruedManwon: number;
  interestPaidManwon: number;
  capitalizedInterestManwon: number;
  scheduledPrincipalManwon: number;
  periodicDebtServiceManwon: number;
  balloonPaymentManwon: number;
  totalDebtPaymentManwon: number;
  closingBalanceManwon: number;
}

export interface TakeoutDebtSchedule {
  rows: TakeoutDebtScheduleRow[];
  termMonths: number;
  firstYearDebtServiceManwon: number;
  maximumAnnualDebtServiceManwon: number;
  maturityBalloonManwon: number;
  totalInterestPaidManwon: number;
  totalCapitalizedInterestManwon: number;
  minimumAnnualRatePct: number;
  maximumAnnualRatePct: number;
}

export interface TakeoutUnderwritingResult {
  modelVersion: typeof TAKEOUT_UNDERWRITING_MODEL_VERSION;
  status: TakeoutUnderwritingStatus;
  terms: TakeoutUnderwritingTerms;
  missingTerms: Array<keyof TakeoutUnderwritingTerms>;
  invalidTerms: string[];
  rateMode: TakeoutRateMode | null;
  stabilizedValueManwon: number;
  stabilizedNoiManwon: number;
  pfBalanceToRefinanceManwon: number;
  ltvLimitManwon: number | null;
  dscrLimitManwon: number | null;
  commitmentLimitManwon: number | null;
  supportableLoanManwon: number | null;
  modeledLoanManwon: number | null;
  upfrontFeeManwon: number | null;
  dsraRequiredBalanceManwon: number | null;
  /** 대출 실행액에서 수수료와 DSRA를 차감한 실제 종결월 현금흐름. */
  netTakeoutCashFlowManwon: number | null;
  /** 위 현금흐름 중 PF 상환에 사용할 수 있는 0 이상 금액. */
  netTakeoutProceedsManwon: number | null;
  refinanceShortfallManwon: number | null;
  refinanceSurplusManwon: number | null;
  /** DSCR 심사에 사용한 최대 연간 정기 상환액. Balloon은 제외한다. */
  annualDebtServiceManwon: number | null;
  firstYearDebtServiceManwon: number | null;
  maximumAnnualDebtServiceManwon: number | null;
  maturityBalloonManwon: number | null;
  minimumProjectedRatePct: number | null;
  maximumProjectedRatePct: number | null;
  dscr: number | null;
  ltvPct: number | null;
  debtYieldPct: number | null;
  bindingConstraints: TakeoutBindingConstraint[];
  warnings: string[];
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number | null): number {
  return Math.max(minimum, maximum == null ? value : Math.min(maximum, value));
}

function rateMode(terms: TakeoutUnderwritingTerms): TakeoutRateMode {
  return terms.rateResetMonths > 0 ? "projected-variable" : "fixed";
}

export function projectedTakeoutAnnualRatePct(
  terms: TakeoutUnderwritingTerms,
  month: number,
): number {
  const initialRate = finiteNonNegative(terms.annualInterestRatePct);
  if (terms.rateResetMonths <= 0) return initialRate;
  const completedResetMonths =
    Math.floor(Math.max(0, month - 1) / terms.rateResetMonths) *
    terms.rateResetMonths;
  const projectedRate =
    initialRate + terms.annualRateChangePct * (completedResetMonths / 12);
  return clamp(
    projectedRate,
    finiteNonNegative(terms.rateFloorPct),
    terms.rateCapPct > 0 ? terms.rateCapPct : null,
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function annualDebtServiceTotals(rows: TakeoutDebtScheduleRow[]): number[] {
  const years = new Map<number, number>();
  for (const row of rows) {
    const year = Math.ceil(row.month / 12);
    years.set(
      year,
      (years.get(year) ?? 0) + row.periodicDebtServiceManwon,
    );
  }
  return [...years.values()];
}

/** 월별 장기대출 상환표. 정기 원리금과 만기 balloon을 분리한다. */
export function buildTakeoutDebtSchedule(
  principalManwon: number,
  terms: TakeoutUnderwritingTerms,
): TakeoutDebtSchedule {
  const termMonths = Math.max(0, Math.trunc(terms.loanTermYears * 12));
  const amortizationMonths = Math.max(
    1,
    Math.trunc(terms.amortizationYears * 12),
  );
  const deferralMonths = Math.max(0, Math.trunc(terms.paymentDeferralMonths));
  const interestOnlyMonths = Math.max(
    0,
    Math.trunc(terms.interestOnlyMonths),
  );
  let balance = D(finiteNonNegative(principalManwon));
  const rows: TakeoutDebtScheduleRow[] = [];

  for (let month = 1; month <= termMonths; month += 1) {
    const openingBalance = balance;
    const annualRatePct = projectedTakeoutAnnualRatePct(terms, month);
    const annualRate = D(annualRatePct).div(100);
    const interestAccrued = openingBalance.times(annualRate).div(12);
    let phase: TakeoutDebtPhase = "paid-off";
    let interestPaid = ZERO;
    let capitalizedInterest = ZERO;
    let scheduledPrincipal = ZERO;
    let periodicDebtService = ZERO;

    if (openingBalance.gt(0) && month <= deferralMonths) {
      phase = "payment-deferral";
      capitalizedInterest = interestAccrued;
      balance = openingBalance.plus(capitalizedInterest);
    } else if (
      openingBalance.gt(0) &&
      month <= deferralMonths + interestOnlyMonths
    ) {
      phase = "interest-only";
      interestPaid = interestAccrued;
      periodicDebtService = interestPaid;
      balance = openingBalance;
    } else if (openingBalance.gt(0)) {
      phase = "amortizing";
      const amortizingMonth = month - deferralMonths - interestOnlyMonths;
      const remainingAmortizationMonths = Math.max(
        1,
        amortizationMonths - amortizingMonth + 1,
      );
      const scheduledPayment = monthlyMortgagePayment(
        openingBalance,
        annualRate,
        remainingAmortizationMonths / 12,
      );
      periodicDebtService = DecimalMin(
        scheduledPayment,
        openingBalance.plus(interestAccrued),
      );
      interestPaid = DecimalMin(interestAccrued, periodicDebtService);
      scheduledPrincipal = DecimalMax(
        periodicDebtService.minus(interestPaid),
        ZERO,
      );
      balance = DecimalMax(openingBalance.minus(scheduledPrincipal), ZERO);
    }

    let balloonPayment = ZERO;
    if (month === termMonths && balance.gt(0)) {
      balloonPayment = balance;
      balance = ZERO;
    }

    rows.push({
      month,
      phase,
      annualRatePct,
      openingBalanceManwon: openingBalance.toNumber(),
      interestAccruedManwon: interestAccrued.toNumber(),
      interestPaidManwon: interestPaid.toNumber(),
      capitalizedInterestManwon: capitalizedInterest.toNumber(),
      scheduledPrincipalManwon: scheduledPrincipal.toNumber(),
      periodicDebtServiceManwon: periodicDebtService.toNumber(),
      balloonPaymentManwon: balloonPayment.toNumber(),
      totalDebtPaymentManwon: periodicDebtService.plus(balloonPayment).toNumber(),
      closingBalanceManwon: balance.toNumber(),
    });
  }

  const annualDebtService = annualDebtServiceTotals(rows);
  const rates = rows.map((row) => row.annualRatePct);
  return {
    rows,
    termMonths,
    firstYearDebtServiceManwon: sum(
      rows.slice(0, 12).map((row) => row.periodicDebtServiceManwon),
    ),
    maximumAnnualDebtServiceManwon:
      annualDebtService.length > 0 ? Math.max(...annualDebtService) : 0,
    maturityBalloonManwon: rows.at(-1)?.balloonPaymentManwon ?? 0,
    totalInterestPaidManwon: sum(
      rows.map((row) => row.interestPaidManwon),
    ),
    totalCapitalizedInterestManwon: sum(
      rows.map((row) => row.capitalizedInterestManwon),
    ),
    minimumAnnualRatePct: rates.length > 0 ? Math.min(...rates) : 0,
    maximumAnnualRatePct: rates.length > 0 ? Math.max(...rates) : 0,
  };
}

function emptyResult(
  input: TakeoutUnderwritingInput,
  status: "not-applicable" | "terms-missing" | "terms-invalid",
  missingTerms: Array<keyof TakeoutUnderwritingTerms>,
  invalidTerms: string[],
  warnings: string[],
): TakeoutUnderwritingResult {
  return {
    modelVersion: TAKEOUT_UNDERWRITING_MODEL_VERSION,
    status,
    terms: { ...input.terms },
    missingTerms,
    invalidTerms,
    rateMode: status === "not-applicable" ? null : rateMode(input.terms),
    stabilizedValueManwon: finiteNonNegative(input.stabilizedValueManwon),
    stabilizedNoiManwon: finiteNonNegative(input.stabilizedNoiManwon),
    pfBalanceToRefinanceManwon: finiteNonNegative(
      input.pfBalanceToRefinanceManwon,
    ),
    ltvLimitManwon: null,
    dscrLimitManwon: null,
    commitmentLimitManwon: null,
    supportableLoanManwon: null,
    modeledLoanManwon: null,
    upfrontFeeManwon: null,
    dsraRequiredBalanceManwon: null,
    netTakeoutCashFlowManwon: null,
    netTakeoutProceedsManwon: null,
    refinanceShortfallManwon: null,
    refinanceSurplusManwon: null,
    annualDebtServiceManwon: null,
    firstYearDebtServiceManwon: null,
    maximumAnnualDebtServiceManwon: null,
    maturityBalloonManwon: null,
    minimumProjectedRatePct: null,
    maximumProjectedRatePct: null,
    dscr: null,
    ltvPct: null,
    debtYieldPct: null,
    bindingConstraints: [],
    warnings,
  };
}

function nearlyEqual(a: number, b: number): boolean {
  return (
    Math.abs(a - b) <=
    Math.max(0.01, Math.max(Math.abs(a), Math.abs(b)) * 1e-9)
  );
}

function missingTermKeys(
  terms: TakeoutUnderwritingTerms,
): Array<keyof TakeoutUnderwritingTerms> {
  const missing: Array<keyof TakeoutUnderwritingTerms> = [];
  if (!Number.isFinite(terms.maxLtvPct) || terms.maxLtvPct <= 0) {
    missing.push("maxLtvPct");
  }
  if (
    !Number.isFinite(terms.annualInterestRatePct) ||
    terms.annualInterestRatePct <= 0
  ) {
    missing.push("annualInterestRatePct");
  }
  if (
    !Number.isInteger(terms.amortizationYears) ||
    terms.amortizationYears <= 0
  ) {
    missing.push("amortizationYears");
  }
  if (!Number.isInteger(terms.loanTermYears) || terms.loanTermYears <= 0) {
    missing.push("loanTermYears");
  }
  if (!Number.isFinite(terms.minimumDscr) || terms.minimumDscr <= 0) {
    missing.push("minimumDscr");
  }
  return missing;
}

function invalidTermMessages(terms: TakeoutUnderwritingTerms): string[] {
  const errors: string[] = [];
  if (Number.isFinite(terms.maxLtvPct) && terms.maxLtvPct > 100) {
    errors.push("장기대출 최대 LTV는 100% 이하여야 합니다.");
  }
  if (
    Number.isFinite(terms.annualInterestRatePct) &&
    terms.annualInterestRatePct > 100
  ) {
    errors.push("장기대출 최초 적용금리는 100% 이하여야 합니다.");
  }
  if (Number.isFinite(terms.amortizationYears) && terms.amortizationYears > 50) {
    errors.push("장기대출 상환기간은 50년 이하여야 합니다.");
  }
  if (Number.isFinite(terms.loanTermYears) && terms.loanTermYears > 50) {
    errors.push("장기대출 계약 만기는 50년 이하여야 합니다.");
  }
  const integerRanges: Array<
    [keyof TakeoutUnderwritingTerms, string, number]
  > = [
    ["paymentDeferralMonths", "원리금 납부유예 기간", 120],
    ["interestOnlyMonths", "이자만 납부 기간", 600],
    ["rateResetMonths", "금리 재설정 주기", 120],
    ["dsraMonths", "DSRA 적립 개월 수", 24],
  ];
  for (const [field, label, maximum] of integerRanges) {
    const value = terms[field];
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      errors.push(`${label}은(는) 0 이상 ${maximum} 이하의 정수 개월이어야 합니다.`);
    }
  }
  if (
    !Number.isFinite(terms.annualRateChangePct) ||
    terms.annualRateChangePct < -20 ||
    terms.annualRateChangePct > 20
  ) {
    errors.push("연 금리 변화 가정은 -20%p 이상 20%p 이하여야 합니다.");
  }
  for (const [value, label] of [
    [terms.rateFloorPct, "금리 floor"],
    [terms.rateCapPct, "금리 cap"],
    [terms.upfrontFeeRatePct, "장기대출 수수료율"],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      errors.push(`${label}은(는) 0% 이상 100% 이하여야 합니다.`);
    }
  }
  if (terms.rateCapPct > 0 && terms.rateFloorPct > terms.rateCapPct) {
    errors.push("금리 floor는 금리 cap보다 클 수 없습니다.");
  }
  if (
    !Number.isFinite(terms.loanCommitmentManwon) ||
    terms.loanCommitmentManwon < 0
  ) {
    errors.push("장기대출 확약액은 0 이상의 유한한 금액이어야 합니다.");
  }
  if (Number.isInteger(terms.loanTermYears) && terms.loanTermYears > 0) {
    const termMonths = terms.loanTermYears * 12;
    if (terms.paymentDeferralMonths >= termMonths) {
      errors.push("원리금 납부유예 기간은 계약 만기보다 짧아야 합니다.");
    }
    if (
      terms.paymentDeferralMonths + terms.interestOnlyMonths >
      termMonths
    ) {
      errors.push("납부유예와 이자만 납부 기간의 합은 계약 만기를 넘을 수 없습니다.");
    }
  }
  return [...new Set(errors)];
}

/**
 * LTV와 실제 상환표의 최대 연간 정기 원리금 DSCR 중 작은 한도로 장기대출을
 * 산정한다. Balloon은 DSCR에서 제외하고 별도 만기위험으로 표시한다.
 */
export function underwriteTakeoutLoan(
  input: TakeoutUnderwritingInput,
): TakeoutUnderwritingResult {
  const stabilizedValue = finiteNonNegative(input.stabilizedValueManwon);
  const stabilizedNoi = finiteNonNegative(input.stabilizedNoiManwon);
  const pfBalance = finiteNonNegative(input.pfBalanceToRefinanceManwon);
  if (stabilizedValue <= 0 || stabilizedNoi <= 0) {
    return emptyResult(input, "not-applicable", [], [], [
      "안정화 임대가치와 NOI가 모두 있어야 장기대출을 검토할 수 있습니다.",
    ]);
  }

  const { terms } = input;
  const missingTerms = missingTermKeys(terms);
  if (missingTerms.length > 0) {
    return emptyResult(input, "terms-missing", missingTerms, [], [
      "LTV·최초 금리·상환기간·계약 만기·최소 DSCR을 입력해야 장기대출을 산정합니다.",
    ]);
  }
  const invalidTerms = invalidTermMessages(terms);
  if (invalidTerms.length > 0) {
    return emptyResult(
      input,
      "terms-invalid",
      [],
      invalidTerms,
      invalidTerms,
    );
  }

  const unitSchedule = buildTakeoutDebtSchedule(1, terms);
  const annualDebtServicePerManwon =
    unitSchedule.maximumAnnualDebtServiceManwon;
  if (annualDebtServicePerManwon <= 0) {
    const message =
      "계약 만기 안에 현금으로 납부하는 정기 원리금이 없어 DSCR을 계산할 수 없습니다.";
    return emptyResult(input, "terms-invalid", [], [message], [message]);
  }

  const ltvLimit = stabilizedValue * (terms.maxLtvPct / 100);
  const dscrLimit =
    stabilizedNoi / terms.minimumDscr / annualDebtServicePerManwon;
  const supportableLoan = Math.max(0, Math.min(ltvLimit, dscrLimit));
  const commitment = finiteNonNegative(terms.loanCommitmentManwon);
  const modeledLoan =
    commitment > 0 ? Math.min(supportableLoan, commitment) : supportableLoan;
  const feeRate = finiteNonNegative(terms.upfrontFeeRatePct);
  const upfrontFee = modeledLoan * (feeRate / 100);
  const debtSchedule = buildTakeoutDebtSchedule(modeledLoan, terms);
  const dsraRequired =
    (debtSchedule.maximumAnnualDebtServiceManwon / 12) * terms.dsraMonths;
  const netTakeoutCashFlow = modeledLoan - upfrontFee - dsraRequired;
  const netProceeds = Math.max(0, netTakeoutCashFlow);
  const refinanceShortfall = Math.max(0, pfBalance - netTakeoutCashFlow);
  const refinanceSurplus = Math.max(0, netTakeoutCashFlow - pfBalance);
  const annualDebtService = debtSchedule.maximumAnnualDebtServiceManwon;
  const actualDscr =
    annualDebtService > 0 ? stabilizedNoi / annualDebtService : null;
  const actualLtv =
    stabilizedValue > 0 ? (modeledLoan / stabilizedValue) * 100 : null;
  const debtYield =
    modeledLoan > 0 ? (stabilizedNoi / modeledLoan) * 100 : null;
  const bindingConstraints: TakeoutBindingConstraint[] = [];
  if (nearlyEqual(supportableLoan, ltvLimit)) bindingConstraints.push("ltv");
  if (nearlyEqual(supportableLoan, dscrLimit)) bindingConstraints.push("dscr");
  if (commitment > 0 && nearlyEqual(modeledLoan, commitment)) {
    bindingConstraints.push("commitment");
  }

  const status: TakeoutUnderwritingStatus =
    commitment <= 0
      ? "modeled-unverified"
      : refinanceShortfall > 0
        ? "commitment-shortfall"
        : "commitment-feasible";
  const warnings = [
    "DSCR은 안정화 NOI를 계약기간 중 최대 연간 정기 원리금 상환액으로 나눕니다. 만기 balloon은 별도 위험으로 표시합니다.",
    "장기대출 한도는 LTV 한도와 최소 DSCR 한도 중 작은 금액을 적용합니다.",
  ];
  if (rateMode(terms) === "projected-variable") {
    warnings.push(
      "변동금리는 초기 적용금리에 연 변화 가정을 리셋 주기별로 반영한 예측 경로이며 시장 선도금리 확정값이 아닙니다.",
    );
  }
  if (terms.paymentDeferralMonths > 0) {
    warnings.push("원리금 납부유예 중 발생 이자는 대출 원금에 가산합니다.");
  }
  if (terms.interestOnlyMonths > 0) {
    warnings.push("이자만 납부 기간에는 원금이 줄지 않습니다.");
  }
  if (debtSchedule.maturityBalloonManwon > 0.01) {
    warnings.push(
      `계약 만기에 ${debtSchedule.maturityBalloonManwon.toFixed(0)}만원의 balloon 상환이 필요합니다. DSCR 한도에는 이 금액을 포함하지 않았습니다.`,
    );
  }
  if (dsraRequired > 0) {
    warnings.push(
      `DSRA ${dsraRequired.toFixed(0)}만원을 제한현금으로 적립해 PF 상환 가능 순유입액에서 차감합니다.`,
    );
  }
  if (commitment <= 0) {
    warnings.push(
      "확인된 장기대출 확약액이 없어 계산 한도는 금융기관 승인액이 아닙니다.",
    );
  }
  if (refinanceShortfall > 0) {
    warnings.push(
      `수수료·DSRA 차감 후 장기대출 순유입액이 PF 상환 필요액보다 ${refinanceShortfall.toFixed(0)}만원 부족합니다.`,
    );
  }

  return {
    modelVersion: TAKEOUT_UNDERWRITING_MODEL_VERSION,
    status,
    terms: { ...terms },
    missingTerms: [],
    invalidTerms: [],
    rateMode: rateMode(terms),
    stabilizedValueManwon: stabilizedValue,
    stabilizedNoiManwon: stabilizedNoi,
    pfBalanceToRefinanceManwon: pfBalance,
    ltvLimitManwon: ltvLimit,
    dscrLimitManwon: dscrLimit,
    commitmentLimitManwon: commitment > 0 ? commitment : null,
    supportableLoanManwon: supportableLoan,
    modeledLoanManwon: modeledLoan,
    upfrontFeeManwon: upfrontFee,
    dsraRequiredBalanceManwon: dsraRequired,
    netTakeoutCashFlowManwon: netTakeoutCashFlow,
    netTakeoutProceedsManwon: netProceeds,
    refinanceShortfallManwon: refinanceShortfall,
    refinanceSurplusManwon: refinanceSurplus,
    annualDebtServiceManwon: annualDebtService,
    firstYearDebtServiceManwon: debtSchedule.firstYearDebtServiceManwon,
    maximumAnnualDebtServiceManwon: annualDebtService,
    maturityBalloonManwon: debtSchedule.maturityBalloonManwon,
    minimumProjectedRatePct: debtSchedule.minimumAnnualRatePct,
    maximumProjectedRatePct: debtSchedule.maximumAnnualRatePct,
    dscr: actualDscr,
    ltvPct: actualLtv,
    debtYieldPct: debtYield,
    bindingConstraints,
    warnings,
  };
}

function DecimalMin(left: ReturnType<typeof D>, right: ReturnType<typeof D>) {
  return left.lte(right) ? left : right;
}

function DecimalMax(left: ReturnType<typeof D>, right: ReturnType<typeof D>) {
  return left.gte(right) ? left : right;
}
