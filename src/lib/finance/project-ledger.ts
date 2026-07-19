/**
 * Auditable monthly project ledger.
 *
 * This is the single source for project cash flow, PF exposure, financing
 * cost, equity IRR/NPV inputs, and the quarterly dashboard schedule.
 *
 * Model boundary (preliminary underwriting):
 * - Land and demolition are equity funded.
 * - PF funds the configured LTC share of hard, soft, and contingency costs.
 * - Interest is paid monthly by equity on average monthly PF balance
 *   (opening balance + half of the current draw).
 * - Sale receipts follow an explicit 10/60/30 collection assumption.
 * - Lease/retail capitalized value is treated as an exit receipt at project end.
 * - Available sale receipts sweep PF principal before distribution to equity.
 *
 * These are transparent assumptions, not a lender term sheet. A future
 * bank-validated model may replace the funding waterfall without changing
 * the ledger contract.
 */

import { D, ZERO, type Decimal } from "./math";
import type { Parcel, Scenario } from "./types";

export const PROJECT_LEDGER_MODEL_VERSION = "pre-audit-2026.1";

export interface ProjectLedgerInput {
  parcel: Pick<Parcel, "acquiredPrice" | "demolitionCost">;
  scenario: Scenario;
  revenueSale: number;
  revenueExit: number;
  hardCost: number;
  softCost: number;
  contingency: number;
}

export interface MonthlyProjectLedgerRow {
  month: number;
  phase: "land" | "design" | "construction" | "exit";
  landCost: number;
  demolitionCost: number;
  hardCost: number;
  softCost: number;
  contingency: number;
  interest: number;
  projectOutflow: number;
  revenueInflow: number;
  pfDraw: number;
  pfRepayment: number;
  pfBalance: number;
  equityCashFlow: number;
  projectNet: number;
}

export interface ProjectLedger {
  modelVersion: string;
  rows: MonthlyProjectLedgerRow[];
  financingCost: number;
  maxPfBalance: number;
  equityInvested: number;
  equityDistributions: number;
  equityCashFlows: number[];
  maxProjectExposure: number;
  projectBreakEvenMonth: number | null;
  totalProjectOutflow: number;
  totalRevenue: number;
  warnings: string[];
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

export function buildProjectLedger(input: ProjectLedgerInput): ProjectLedger {
  const { parcel, scenario } = input;
  const assumptions = scenario.assumptions;

  const designMonths = Math.max(0, Math.round(assumptions.designMonths));
  const constructionMonths = Math.max(
    1,
    Math.round(assumptions.constructionMonths)
  );
  const saleOutMonths = Math.max(1, Math.round(assumptions.saleOutMonths));
  const occupancyMonth = designMonths + constructionMonths;
  const totalMonths = occupancyMonth + saleOutMonths;

  const landByMonth = new Map<number, Decimal>([
    [0, D(parcel.acquiredPrice)],
  ]);
  const demolitionByMonth = new Map<number, Decimal>();
  const hardByMonth = new Map<number, Decimal>();
  const softByMonth = new Map<number, Decimal>();
  const contingencyByMonth = new Map<number, Decimal>();
  const revenueByMonth = new Map<number, Decimal>();

  const constructionPeriod = monthRange(designMonths + 1, occupancyMonth);
  const preCompletionPeriod = monthRange(1, occupancyMonth);

  allocate(demolitionByMonth, D(parcel.demolitionCost ?? 0), [
    designMonths + 1,
  ]);
  allocate(hardByMonth, D(input.hardCost), constructionPeriod);
  allocate(softByMonth, D(input.softCost), preCompletionPeriod);
  allocate(
    contingencyByMonth,
    D(input.contingency),
    constructionPeriod
  );

  const saleRevenue = D(input.revenueSale);
  if (saleRevenue.gt(0)) {
    const presaleMonth = Math.min(
      occupancyMonth,
      designMonths + Math.max(1, Math.floor(constructionMonths * 0.4))
    );
    const interimMonths = monthRange(presaleMonth + 1, occupancyMonth);
    const finalMonths = monthRange(occupancyMonth + 1, totalMonths);

    allocate(revenueByMonth, saleRevenue.times(0.1), [presaleMonth]);
    allocate(
      revenueByMonth,
      saleRevenue.times(0.6),
      interimMonths.length > 0 ? interimMonths : [occupancyMonth]
    );
    allocate(
      revenueByMonth,
      saleRevenue.times(0.3),
      finalMonths.length > 0 ? finalMonths : [totalMonths]
    );
  }
  allocate(revenueByMonth, D(input.revenueExit), [totalMonths]);

  const monthlyRate = D(assumptions.interestRate).div(100).div(12);
  const ltc = D(assumptions.ltcTarget).div(100);

  const rows: MonthlyProjectLedgerRow[] = [];
  const equityCashFlows: number[] = [];
  let pfBalance = ZERO;
  let maxPfBalance = ZERO;
  let financingCost = ZERO;
  let equityInvested = ZERO;
  let equityDistributions = ZERO;
  let cumulativeProject = ZERO;
  let maxProjectExposure = ZERO;
  let projectBreakEvenMonth: number | null = null;

  for (let month = 0; month <= totalMonths; month += 1) {
    const landCost = valueAt(landByMonth, month);
    const demolitionCost = valueAt(demolitionByMonth, month);
    const hardCost = valueAt(hardByMonth, month);
    const softCost = valueAt(softByMonth, month);
    const contingency = valueAt(contingencyByMonth, month);
    const eligibleCost = hardCost.plus(softCost).plus(contingency);
    const pfDraw = eligibleCost.times(ltc);
    const openingBalance = pfBalance;
    const interest = openingBalance.plus(pfDraw.div(2)).times(monthlyRate);
    const debtBeforeRepayment = openingBalance.plus(pfDraw);
    const revenueInflow = valueAt(revenueByMonth, month);
    const pfRepayment =
      month === totalMonths
        ? debtBeforeRepayment
        : DecimalMin(revenueInflow, debtBeforeRepayment);

    pfBalance = debtBeforeRepayment.minus(pfRepayment);
    if (pfBalance.gt(maxPfBalance)) maxPfBalance = pfBalance;
    if (debtBeforeRepayment.gt(maxPfBalance)) {
      maxPfBalance = debtBeforeRepayment;
    }

    const equityContribution = landCost
      .plus(demolitionCost)
      .plus(eligibleCost.minus(pfDraw))
      .plus(interest);
    const equityCashFlow = revenueInflow
      .minus(pfRepayment)
      .minus(equityContribution);
    const projectOutflow = landCost
      .plus(demolitionCost)
      .plus(eligibleCost)
      .plus(interest);
    const projectNet = revenueInflow.minus(projectOutflow);

    financingCost = financingCost.plus(interest);
    if (equityCashFlow.lt(0)) {
      equityInvested = equityInvested.plus(equityCashFlow.abs());
    } else {
      equityDistributions = equityDistributions.plus(equityCashFlow);
    }

    cumulativeProject = cumulativeProject.plus(projectNet);
    if (cumulativeProject.lt(maxProjectExposure)) {
      maxProjectExposure = cumulativeProject;
    }
    if (
      projectBreakEvenMonth === null &&
      month > 0 &&
      cumulativeProject.gte(0)
    ) {
      projectBreakEvenMonth = month;
    }

    const numericEquityCashFlow = equityCashFlow.toNumber();
    equityCashFlows.push(numericEquityCashFlow);
    rows.push({
      month,
      phase: phaseAt(month, designMonths, occupancyMonth),
      landCost: landCost.toNumber(),
      demolitionCost: demolitionCost.toNumber(),
      hardCost: hardCost.toNumber(),
      softCost: softCost.toNumber(),
      contingency: contingency.toNumber(),
      interest: interest.toNumber(),
      projectOutflow: projectOutflow.toNumber(),
      revenueInflow: revenueInflow.toNumber(),
      pfDraw: pfDraw.toNumber(),
      pfRepayment: pfRepayment.toNumber(),
      pfBalance: pfBalance.toNumber(),
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

  return {
    modelVersion: PROJECT_LEDGER_MODEL_VERSION,
    rows,
    financingCost: financingCost.toNumber(),
    maxPfBalance: maxPfBalance.toNumber(),
    equityInvested: equityInvested.toNumber(),
    equityDistributions: equityDistributions.toNumber(),
    equityCashFlows,
    maxProjectExposure: maxProjectExposure.toNumber(),
    projectBreakEvenMonth,
    totalProjectOutflow,
    totalRevenue,
    warnings: [
      "PF 조건은 금융기관 약정이 아닌 LTC·금리 입력 기반 예비 모델입니다.",
      "분양 수입은 10/60/30, 임대·근생 가치는 사업 종료 시 회수하는 것으로 가정합니다.",
      "PF 이자는 월초잔액과 당월 인출액의 절반을 사용한 월평균잔액 기준입니다.",
    ],
  };
}

function DecimalMin(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}
