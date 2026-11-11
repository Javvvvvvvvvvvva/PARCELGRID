/**
 * Auditable monthly project ledger.
 *
 * This is the single source for project cash flow, PF exposure, financing
 * cost, equity IRR/NPV inputs, and the quarterly dashboard schedule.
 *
 * Model boundary (preliminary underwriting):
 * - Land, acquisition incidentals, relocation, PF/trust fees and demolition
 *   are equity funded unless a future lender contract says otherwise.
 * - PF funds the configured LTC share of hard, soft, and contingency costs.
 * - Interest is paid monthly by equity on average monthly PF balance
 *   (opening balance + half of the current draw).
 * - Single-house and multi-family whole-asset sales are collected at exit.
 * - Other residential sale programs use an explicit 10/60/30 collection
 *   assumption over a horizon that cannot be shorter than the configured
 *   monthly sales pace.
 * - Retail and office sales remain separate and are collected at exit.
 * - Lease capitalized value is received only after the configured
 *   lease-up period has elapsed.
 * - Available sale receipts sweep PF principal, then fund project costs; any
 *   surplus stays in the project account until exit.
 *
 * These are transparent assumptions, not a lender term sheet. A future
 * bank-validated model may replace the funding waterfall without changing
 * the ledger contract.
 */

import { D, ZERO, type Decimal } from "./math";
import type {
  FinancialRevenuePoolAmounts,
  FinancialRevenuePoolKey,
  Parcel,
  Scenario,
} from "./types";
import { validateAssumptionSet } from "./assumption-validation";
import { auditProjectLedger } from "./project-ledger-audit";

export const PROJECT_LEDGER_MODEL_VERSION = "project-ledger-2026.6";

export type RevenueCollectionPolicy =
  | "bulk-exit"
  | "presale-10-60-30"
  | "mixed";

export type RevenueStreamPolicy =
  | "none"
  | "bulk-exit"
  | "presale-10-60-30"
  | "stabilized-exit";

export interface ProjectLedgerInput {
  parcel: Pick<Parcel, "acquiredPrice" | "demolitionCost">;
  scenario: Scenario;
  /** 2026.4부터 풀별 회수 정책을 적용하는 권위 입력. */
  revenueByPool?: FinancialRevenuePoolAmounts;
  /** 구버전 직접 호출 호환용 매각 합계. */
  revenueSale?: number;
  /** 구버전 직접 호출 호환용 임대 출구가치 합계. */
  revenueExit?: number;
  hardCost: number;
  softCost: number;
  contingency: number;
}

export interface MonthlyProjectLedgerRow {
  month: number;
  phase: "land" | "design" | "construction" | "exit";
  landCost: number;
  acquisitionTax: number;
  acquisitionOtherCost: number;
  demolitionCost: number;
  tenantRelocationCost: number;
  hardCost: number;
  softCost: number;
  contingency: number;
  interest: number;
  pfFee: number;
  trustFee: number;
  projectOutflow: number;
  revenueInflow: number;
  pfDraw: number;
  /** PF principal immediately before the current month's cash sweep. */
  pfBalanceBeforeRepayment: number;
  pfRepayment: number;
  pfBalance: number;
  cashReserveBalance: number;
  equityContribution: number;
  equityDistribution: number;
  equityCashFlow: number;
  projectNet: number;
}

export interface ProjectLedger {
  modelVersion: string;
  revenueCollectionPolicy: RevenueCollectionPolicy;
  revenueStreamPolicies: Record<FinancialRevenuePoolKey, RevenueStreamPolicy>;
  rows: MonthlyProjectLedgerRow[];
  interestCost: number;
  financingCost: number;
  additionalCosts: {
    acquisitionTax: number;
    acquisitionOtherCost: number;
    tenantRelocationCost: number;
    pfFee: number;
    trustFee: number;
  };
  maxPfBalance: number;
  pfCommitment: number;
  leaseStabilizationMonth: number | null;
  /** PF principal that a take-out loan would need to refinance at stabilization. */
  pfBalanceAtLeaseStabilization: number;
  /**
   * 사업 종료월까지 확보된 매각대금·유보현금을 먼저 사용한 뒤, 보유하는
   * 임대자산의 장기대출이 상환해야 하는 잔존 PF 원금.
   */
  pfBalanceAtRetainedLeaseRefinance: number;
  equityInvested: number;
  equityDistributions: number;
  equityCashFlows: number[];
  maxCashReserve: number;
  maxProjectExposure: number;
  projectBreakEvenMonth: number | null;
  totalProjectOutflow: number;
  totalRevenue: number;
  funding: {
    status: "unverified" | "funded" | "shortfall";
    equityCommitmentManwon: number | null;
    requiredEquityManwon: number;
    shortfallManwon: number;
    firstShortfallMonth: number | null;
    pfCommitmentManwon: number;
    maxPfBalanceManwon: number;
  };
  warnings: string[];
}

function emptyRevenuePools(): FinancialRevenuePoolAmounts {
  return {
    residentialSale: 0,
    retailSale: 0,
    officeSale: 0,
    residentialLease: 0,
    retailLease: 0,
    officeLease: 0,
  };
}

function normalizedRevenuePools(
  input: ProjectLedgerInput,
): FinancialRevenuePoolAmounts {
  if (input.revenueByPool) {
    return Object.fromEntries(
      Object.entries(input.revenueByPool).map(([pool, value]) => [
        pool,
        Number.isFinite(value) ? Math.max(0, value) : 0,
      ]),
    ) as FinancialRevenuePoolAmounts;
  }
  return {
    ...emptyRevenuePools(),
    residentialSale: Math.max(0, input.revenueSale ?? 0),
    residentialLease: Math.max(0, input.revenueExit ?? 0),
  };
}

function monthRange(start: number, end: number): number[] {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function allocate(
  target: Map<number, Decimal>,
  total: Decimal,
  months: number[]
): void {
  if (total.eq(0)) return;
  const slots = months.length > 0 ? months : [0];
  const perMonth = total.div(slots.length);
  let allocated = ZERO;
  slots.forEach((month, index) => {
    const value =
      index === slots.length - 1 ? total.minus(allocated) : perMonth;
    target.set(month, (target.get(month) ?? ZERO).plus(value));
    allocated = allocated.plus(value);
  });
}

function valueAt(values: Map<number, Decimal>, month: number): Decimal {
  return values.get(month) ?? ZERO;
}

function phaseAt(
  month: number,
  designMonths: number,
  occupancyMonth: number
): MonthlyProjectLedgerRow["phase"] {
  if (month === 0) return "land";
  if (month <= designMonths) return "design";
  if (month <= occupancyMonth) return "construction";
  return "exit";
}

export function revenueCollectionPolicyForScenario(
  scenario: Scenario,
  revenueByPool?: FinancialRevenuePoolAmounts,
): RevenueCollectionPolicy {
  if (!revenueByPool) {
    return scenario.program.type === "single-house" ||
      scenario.program.type === "multi-family"
      ? "bulk-exit"
      : "presale-10-60-30";
  }

  const residentialPresale =
    revenueByPool.residentialSale > 0 &&
    scenario.program.type !== "single-house" &&
    scenario.program.type !== "multi-family";
  const otherExitRevenue =
    revenueByPool.retailSale > 0 ||
    revenueByPool.officeSale > 0 ||
    revenueByPool.residentialLease > 0 ||
    revenueByPool.retailLease > 0 ||
    revenueByPool.officeLease > 0 ||
    (revenueByPool.residentialSale > 0 && !residentialPresale);
  if (residentialPresale && otherExitRevenue) return "mixed";
  return residentialPresale ? "presale-10-60-30" : "bulk-exit";
}

export function buildProjectLedger(input: ProjectLedgerInput): ProjectLedger {
  const { parcel, scenario } = input;
  const assumptions = scenario.assumptions;

  const invalidAssumptions = validateAssumptionSet(assumptions);
  if (invalidAssumptions.length > 0) {
    throw new Error(
      `사업성 원장 입력값을 확인하세요: ${invalidAssumptions
        .flatMap((item) => item.errors)
        .join(" ")}`,
    );
  }

  const designMonths = assumptions.designMonths;
  const constructionMonths = assumptions.constructionMonths;
  const saleOutMonths = assumptions.saleOutMonths;
  const leaseUpMonths = assumptions.leaseUpMonths;
  const occupancyMonth = designMonths + constructionMonths;
  const revenuePools = normalizedRevenuePools(input);
  const residentialPresale =
    revenuePools.residentialSale > 0 &&
    scenario.program.type !== "single-house" &&
    scenario.program.type !== "multi-family";
  const revenueCollectionPolicy = revenueCollectionPolicyForScenario(
    scenario,
    revenuePools,
  );
  const revenueStreamPolicies: Record<
    FinancialRevenuePoolKey,
    RevenueStreamPolicy
  > = {
    residentialSale:
      revenuePools.residentialSale <= 0
        ? "none"
        : residentialPresale
          ? "presale-10-60-30"
          : "bulk-exit",
    retailSale: revenuePools.retailSale > 0 ? "bulk-exit" : "none",
    officeSale: revenuePools.officeSale > 0 ? "bulk-exit" : "none",
    residentialLease:
      revenuePools.residentialLease > 0 ? "stabilized-exit" : "none",
    retailLease:
      revenuePools.retailLease > 0 ? "stabilized-exit" : "none",
    officeLease:
      revenuePools.officeLease > 0 ? "stabilized-exit" : "none",
  };
  const salesPaceMonths =
    residentialPresale
      ? Math.ceil(100 / assumptions.salesPaceMonthlyPct)
      : 0;
  const leaseExitValue =
    revenuePools.residentialLease +
    revenuePools.retailLease +
    revenuePools.officeLease;
  const saleExitValue =
    revenuePools.residentialSale +
    revenuePools.retailSale +
    revenuePools.officeSale;
  const effectiveLeaseUpMonths =
    leaseExitValue > 0 ? leaseUpMonths : 0;
  const leaseStabilizationMonth =
    leaseExitValue > 0 ? occupancyMonth + effectiveLeaseUpMonths : null;
  const exitMonths = Math.max(
    saleExitValue > 0 ? saleOutMonths : 0,
    salesPaceMonths,
    effectiveLeaseUpMonths,
  );
  const totalMonths = occupancyMonth + exitMonths;

  const landByMonth = new Map<number, Decimal>([
    [0, D(parcel.acquiredPrice)],
  ]);
  const acquisitionTaxByMonth = new Map<number, Decimal>();
  const acquisitionOtherByMonth = new Map<number, Decimal>();
  const demolitionByMonth = new Map<number, Decimal>();
  const tenantRelocationByMonth = new Map<number, Decimal>();
  const hardByMonth = new Map<number, Decimal>();
  const softByMonth = new Map<number, Decimal>();
  const contingencyByMonth = new Map<number, Decimal>();
  const pfFeeByMonth = new Map<number, Decimal>();
  const trustFeeByMonth = new Map<number, Decimal>();
  const revenueByMonth = new Map<number, Decimal>();

  const constructionPeriod = monthRange(designMonths + 1, occupancyMonth);
  const preCompletionPeriod = monthRange(1, occupancyMonth);
  const ltc = D(assumptions.ltcTarget).div(100);
  const eligibleCostTotal = D(input.hardCost)
    .plus(D(input.softCost))
    .plus(D(input.contingency));
  const pfCommitment = eligibleCostTotal.times(ltc);
  const pfFee = pfCommitment.times(
    D(assumptions.pfUpfrontFeeRate ?? 0).div(100),
  );

  allocate(
    acquisitionTaxByMonth,
    D(assumptions.acquisitionTaxManwon ?? 0),
    [0],
  );
  allocate(
    acquisitionOtherByMonth,
    D(assumptions.acquisitionOtherCostManwon ?? 0),
    [0],
  );

  allocate(demolitionByMonth, D(parcel.demolitionCost ?? 0), [
    designMonths + 1,
  ]);
  allocate(
    tenantRelocationByMonth,
    D(assumptions.tenantRelocationCostManwon ?? 0),
    [designMonths + 1],
  );
  allocate(hardByMonth, D(input.hardCost), constructionPeriod);
  allocate(softByMonth, D(input.softCost), preCompletionPeriod);
  allocate(
    contingencyByMonth,
    D(input.contingency),
    constructionPeriod
  );
  allocate(pfFeeByMonth, pfFee, [designMonths + 1]);
  allocate(trustFeeByMonth, D(assumptions.trustFeeManwon ?? 0), [
    Math.min(totalMonths, 1),
  ]);

  const residentialSaleRevenue = D(revenuePools.residentialSale);
  if (residentialSaleRevenue.gt(0)) {
    if (residentialPresale) {
      const presaleMonth = Math.min(
        occupancyMonth,
        designMonths + Math.max(1, Math.floor(constructionMonths * 0.4))
      );
      const interimMonths = monthRange(presaleMonth + 1, occupancyMonth);
      const finalMonths = monthRange(occupancyMonth + 1, totalMonths);

      allocate(
        revenueByMonth,
        residentialSaleRevenue.times(0.1),
        [presaleMonth],
      );
      allocate(
        revenueByMonth,
        residentialSaleRevenue.times(0.6),
        interimMonths.length > 0 ? interimMonths : [occupancyMonth]
      );
      allocate(
        revenueByMonth,
        residentialSaleRevenue.times(0.3),
        finalMonths.length > 0 ? finalMonths : [totalMonths]
      );
    } else {
      allocate(revenueByMonth, residentialSaleRevenue, [totalMonths]);
    }
  }
  const commercialSaleRevenue = D(revenuePools.retailSale).plus(
    D(revenuePools.officeSale),
  );
  allocate(revenueByMonth, commercialSaleRevenue, [totalMonths]);
  allocate(revenueByMonth, D(leaseExitValue), [totalMonths]);

  const monthlyRate = D(assumptions.interestRate).div(100).div(12);

  const rows: MonthlyProjectLedgerRow[] = [];
  const equityCashFlows: number[] = [];
  const cumulativeProjectByMonth: number[] = [];
  let pfBalance = ZERO;
  let cashReserve = ZERO;
  let maxCashReserve = ZERO;
  let maxPfBalance = ZERO;
  let financingCost = ZERO;
  let equityInvested = ZERO;
  let equityDistributions = ZERO;
  let firstShortfallMonth: number | null = null;
  let cumulativeProject = ZERO;
  let maxProjectExposure = ZERO;
  const equityCommitment =
    Number.isFinite(assumptions.equityCommitmentManwon) &&
    assumptions.equityCommitmentManwon > 0
      ? D(assumptions.equityCommitmentManwon)
      : null;

  for (let month = 0; month <= totalMonths; month += 1) {
    const landCost = valueAt(landByMonth, month);
    const acquisitionTax = valueAt(acquisitionTaxByMonth, month);
    const acquisitionOtherCost = valueAt(acquisitionOtherByMonth, month);
    const demolitionCost = valueAt(demolitionByMonth, month);
    const tenantRelocationCost = valueAt(tenantRelocationByMonth, month);
    const hardCost = valueAt(hardByMonth, month);
    const softCost = valueAt(softByMonth, month);
    const contingency = valueAt(contingencyByMonth, month);
    const pfFeeForMonth = valueAt(pfFeeByMonth, month);
    const trustFee = valueAt(trustFeeByMonth, month);
    const eligibleCost = hardCost.plus(softCost).plus(contingency);
    const pfDraw = eligibleCost.times(ltc);
    const openingBalance = pfBalance;
    const interest = openingBalance.plus(pfDraw.div(2)).times(monthlyRate);
    const debtBeforeRepayment = openingBalance.plus(pfDraw);
    const revenueInflow = valueAt(revenueByMonth, month);
    const cashBeforeDebt = cashReserve.plus(revenueInflow);
    const pfRepaymentFromCash = DecimalMin(
      cashBeforeDebt,
      debtBeforeRepayment,
    );
    const finalDebtShortfall =
      month === totalMonths
        ? debtBeforeRepayment.minus(pfRepaymentFromCash)
        : ZERO;
    const pfRepayment = pfRepaymentFromCash.plus(finalDebtShortfall);

    pfBalance = debtBeforeRepayment.minus(pfRepayment);
    if (pfBalance.gt(maxPfBalance)) maxPfBalance = pfBalance;
    if (debtBeforeRepayment.gt(maxPfBalance)) {
      maxPfBalance = debtBeforeRepayment;
    }

    const equityFundedOutflow = landCost
      .plus(acquisitionTax)
      .plus(acquisitionOtherCost)
      .plus(demolitionCost)
      .plus(tenantRelocationCost)
      .plus(eligibleCost.minus(pfDraw))
      .plus(pfFeeForMonth)
      .plus(trustFee)
      .plus(interest);
    const cashAfterDebt = cashBeforeDebt.minus(pfRepaymentFromCash);
    const cashAppliedToEquityCosts = DecimalMin(
      cashAfterDebt,
      equityFundedOutflow,
    );
    const equityContribution = equityFundedOutflow
      .minus(cashAppliedToEquityCosts)
      .plus(finalDebtShortfall);
    const cashAfterCosts = cashAfterDebt.minus(cashAppliedToEquityCosts);
    const equityDistribution =
      month === totalMonths ? cashAfterCosts : ZERO;
    cashReserve =
      month === totalMonths ? ZERO : cashAfterCosts;
    if (cashReserve.gt(maxCashReserve)) maxCashReserve = cashReserve;
    const equityCashFlow = equityDistribution.minus(equityContribution);
    const projectOutflow = landCost
      .plus(acquisitionTax)
      .plus(acquisitionOtherCost)
      .plus(demolitionCost)
      .plus(tenantRelocationCost)
      .plus(eligibleCost)
      .plus(pfFeeForMonth)
      .plus(trustFee)
      .plus(interest);
    const projectNet = revenueInflow.minus(projectOutflow);

    financingCost = financingCost.plus(interest);
    equityInvested = equityInvested.plus(equityContribution);
    equityDistributions = equityDistributions.plus(equityDistribution);
    if (
      equityCommitment &&
      firstShortfallMonth === null &&
      equityInvested.gt(equityCommitment)
    ) {
      firstShortfallMonth = month;
    }

    cumulativeProject = cumulativeProject.plus(projectNet);
    cumulativeProjectByMonth.push(cumulativeProject.toNumber());
    if (cumulativeProject.lt(maxProjectExposure)) {
      maxProjectExposure = cumulativeProject;
    }

    const numericEquityCashFlow = equityCashFlow.toNumber();
    equityCashFlows.push(numericEquityCashFlow);
    rows.push({
      month,
      phase: phaseAt(month, designMonths, occupancyMonth),
      landCost: landCost.toNumber(),
      acquisitionTax: acquisitionTax.toNumber(),
      acquisitionOtherCost: acquisitionOtherCost.toNumber(),
      demolitionCost: demolitionCost.toNumber(),
      tenantRelocationCost: tenantRelocationCost.toNumber(),
      hardCost: hardCost.toNumber(),
      softCost: softCost.toNumber(),
      contingency: contingency.toNumber(),
      interest: interest.toNumber(),
      pfFee: pfFeeForMonth.toNumber(),
      trustFee: trustFee.toNumber(),
      projectOutflow: projectOutflow.toNumber(),
      revenueInflow: revenueInflow.toNumber(),
      pfDraw: pfDraw.toNumber(),
      pfBalanceBeforeRepayment: debtBeforeRepayment.toNumber(),
      pfRepayment: pfRepayment.toNumber(),
      pfBalance: pfBalance.toNumber(),
      cashReserveBalance: cashReserve.toNumber(),
      equityContribution: equityContribution.toNumber(),
      equityDistribution: equityDistribution.toNumber(),
      equityCashFlow: numericEquityCashFlow,
      projectNet: projectNet.toNumber(),
    });
  }

  const totalProjectOutflow = rows.reduce(
    (sum, row) => sum + row.projectOutflow,
    0
  );
  const totalRevenue = rows.reduce(
    (sum, row) => sum + row.revenueInflow,
    0
  );
  const projectBreakEvenMonth =
    cumulativeProjectByMonth.findIndex(
      (value, month) =>
        month > 0 &&
        value >= 0 &&
        cumulativeProjectByMonth
          .slice(month)
          .every((laterValue) => laterValue >= 0)
    );
  const sustainedBreakEvenMonth =
    projectBreakEvenMonth >= 0 ? projectBreakEvenMonth : null;
  const scheduleWarnings: string[] = [];
  if (salesPaceMonths > 0) {
    scheduleWarnings.push(
      `월 분양 속도 ${assumptions.salesPaceMonthlyPct}%를 적용해 분양 회수기간을 최소 ${salesPaceMonths}개월로 설정했습니다.`,
    );
  }
  if (effectiveLeaseUpMonths > 0) {
    scheduleWarnings.push(
      `임대·근생 출구가치는 임대 안정화 ${effectiveLeaseUpMonths}개월 이후에 회수합니다.`,
    );
  }
  const equityCommitmentManwon = equityCommitment?.toNumber() ?? null;
  const shortfallManwon = equityCommitment
    ? DecimalMax(equityInvested.minus(equityCommitment), ZERO).toNumber()
    : 0;
  const fundingStatus: ProjectLedger["funding"]["status"] =
    equityCommitment === null
      ? "unverified"
      : shortfallManwon > 0
        ? "shortfall"
        : "funded";
  const pfBalanceAtLeaseStabilization =
    leaseStabilizationMonth == null
      ? 0
      : rows.find((row) => row.month === leaseStabilizationMonth)
          ?.pfBalanceBeforeRepayment ?? 0;
  const finalRow = rows.at(-1)!;
  const cashReserveEnteringFinalMonth =
    totalMonths > 0 ? rows[totalMonths - 1]?.cashReserveBalance ?? 0 : 0;
  const nonLeaseRevenueInFinalMonth = Math.max(
    0,
    finalRow.revenueInflow - leaseExitValue,
  );
  const pfBalanceAtRetainedLeaseRefinance = DecimalMax(
    D(finalRow.pfBalanceBeforeRepayment)
      .minus(cashReserveEnteringFinalMonth)
      .minus(nonLeaseRevenueInFinalMonth),
    ZERO,
  ).toNumber();
  const missingCostWarnings = [
    [assumptions.acquisitionTaxManwon ?? 0, "취득세"],
    [assumptions.acquisitionOtherCostManwon ?? 0, "기타 취득 부대비"],
    [assumptions.tenantRelocationCostManwon ?? 0, "명도·임차인 정리비"],
    [assumptions.pfUpfrontFeeRate ?? 0, "PF 약정·취급 수수료"],
    [assumptions.trustFeeManwon ?? 0, "신탁·자금관리비"],
  ]
    .filter(([value]) => Number(value) === 0)
    .map(([, label]) => String(label));

  const ledger: ProjectLedger = {
    modelVersion: PROJECT_LEDGER_MODEL_VERSION,
    revenueCollectionPolicy,
    revenueStreamPolicies,
    rows,
    interestCost: financingCost.toNumber(),
    financingCost: financingCost.plus(pfFee).plus(
      D(assumptions.trustFeeManwon ?? 0),
    ).toNumber(),
    additionalCosts: {
      acquisitionTax: assumptions.acquisitionTaxManwon ?? 0,
      acquisitionOtherCost: assumptions.acquisitionOtherCostManwon ?? 0,
      tenantRelocationCost: assumptions.tenantRelocationCostManwon ?? 0,
      pfFee: pfFee.toNumber(),
      trustFee: assumptions.trustFeeManwon ?? 0,
    },
    maxPfBalance: maxPfBalance.toNumber(),
    pfCommitment: pfCommitment.toNumber(),
    leaseStabilizationMonth,
    pfBalanceAtLeaseStabilization,
    pfBalanceAtRetainedLeaseRefinance,
    equityInvested: equityInvested.toNumber(),
    equityDistributions: equityDistributions.toNumber(),
    equityCashFlows,
    maxCashReserve: maxCashReserve.toNumber(),
    maxProjectExposure: maxProjectExposure.toNumber(),
    projectBreakEvenMonth: sustainedBreakEvenMonth,
    totalProjectOutflow,
    totalRevenue,
    funding: {
      status: fundingStatus,
      equityCommitmentManwon,
      requiredEquityManwon: equityInvested.toNumber(),
      shortfallManwon,
      firstShortfallMonth,
      pfCommitmentManwon: pfCommitment.toNumber(),
      maxPfBalanceManwon: maxPfBalance.toNumber(),
    },
    warnings: [
      "PF 조건은 금융기관 약정이 아닌 LTC·금리 입력 기반 예비 모델입니다.",
      ...(residentialPresale
        ? [
            "주거 분양 수입은 10/60/30 회수 가정이며 실제 분양·신탁 약정으로 교체해야 합니다.",
          ]
        : []),
      ...(revenuePools.residentialSale > 0 && !residentialPresale
        ? ["단독·다가구 통매각 매출은 사업 종료 시 100% 회수하는 것으로 가정합니다."]
        : []),
      ...(revenuePools.retailSale + revenuePools.officeSale > 0
        ? ["상가·업무 매각대금은 주거 분양대금과 분리해 사업 종료 시 회수합니다."]
        : []),
      ...scheduleWarnings,
      ...(leaseExitValue > 0
        ? ["임대 자산가치는 설정된 임대 안정화 기간 이후 사업 종료 시 회수합니다."]
        : []),
      "PF 이자는 월초잔액과 당월 인출액의 절반을 사용한 월평균잔액 기준입니다.",
      "조기 매출의 PF 상환 후 잉여금은 프로젝트 계정에 유보하고 종료월에만 자기자본에 배당합니다.",
      ...(missingCostWarnings.length > 0
        ? [
            `${missingCostWarnings.join(" · ")} 입력이 0입니다. 0원 확정이 아니라면 현재 총사업비와 손익에서 누락됩니다.`,
          ]
        : []),
      ...(fundingStatus === "unverified"
        ? ["확인된 자기자본 한도가 없어 필요 자기자본의 조달 가능성을 판정하지 않았습니다."]
        : fundingStatus === "shortfall"
          ? [
              `확인 자기자본 한도보다 ${shortfallManwon.toFixed(0)}만원이 부족하며 ${firstShortfallMonth}개월차부터 자금 부족 상태입니다.`,
            ]
          : []),
    ],
  };
  const audit = auditProjectLedger(input, ledger);
  if (audit.status === "fail") {
    throw new Error(`월별 원장 산술 검증에 실패했습니다: ${audit.findings.map(f => `${f.id}${f.month === null ? "" : `@${f.month}`}`).join(", ")}`);
  }
  return ledger;
}

function DecimalMin(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}

function DecimalMax(a: Decimal, b: Decimal): Decimal {
  return a.gte(b) ? a : b;
}
