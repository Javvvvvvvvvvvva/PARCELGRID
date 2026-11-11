import type { ProjectLedger, ProjectLedgerInput } from "./project-ledger";

export const PROJECT_LEDGER_AUDIT_VERSION = "project-ledger-arithmetic-2026.1" as const;
// 120 design + 240 construction + 1000 presale months, plus month zero.
export const MAX_LEDGER_AUDIT_ROWS = 1361;
const MAX_FINDINGS = 32;
const COST_FIELDS = ["landCost", "acquisitionTax", "acquisitionOtherCost", "demolitionCost",
  "tenantRelocationCost", "hardCost", "softCost", "contingency", "interest", "pfFee", "trustFee"] as const;
const ROW_FIELDS = [...COST_FIELDS, "projectOutflow", "revenueInflow", "pfDraw", "pfBalanceBeforeRepayment",
  "pfRepayment", "pfBalance", "cashReserveBalance", "equityContribution", "equityDistribution",
  "equityCashFlow", "projectNet"] as const;
const POOLS = ["residentialSale", "retailSale", "officeSale", "residentialLease", "retailLease", "officeLease"] as const;

export interface ProjectLedgerAudit {
  version: typeof PROJECT_LEDGER_AUDIT_VERSION;
  scope: "internal-arithmetic";
  approvalStatus: "unverified";
  status: "checked" | "fail";
  checkedRows: number;
  checkedEquations: number;
  failureCount: number;
  findings: Array<{ id: string; month: number | null; actual: number | null; expected: number | null; toleranceManwon: number }>;
  zeroCostInputs: string[];
}

/** Independent conservation/allocation checks. No calculator, Decimal engine,
 * ledger builder or revenue-policy helpers are invoked; inputs are never changed.
 * This checks the stated model, not source evidence or a lender's real agreement. */
export function auditProjectLedger(input: ProjectLedgerInput, ledger: ProjectLedger): ProjectLedgerAudit {
  const report: ProjectLedgerAudit = { version: PROJECT_LEDGER_AUDIT_VERSION, scope: "internal-arithmetic",
    approvalStatus: "unverified", status: "checked", checkedRows: 0, checkedEquations: 0,
    failureCount: 0, findings: [], zeroCostInputs: [] };
  const fail = (id: string, month: number | null = null, actual?: number, expected?: number, toleranceManwon = 0) => {
    report.status = "fail"; report.failureCount++;
    if (report.findings.length < MAX_FINDINGS) report.findings.push({ id, month,
      actual: Number.isFinite(actual) ? actual! : null, expected: Number.isFinite(expected) ? expected! : null, toleranceManwon });
  };
  const equal = (id: string, actual: number, expected: number, month: number | null = null, scale = 0) => {
    report.checkedEquations++;
    // Allow only Number serialization/arithmetic roundoff, not whole-manwon display rounding.
    const tolerance = Math.max(1e-7, 32 * Number.EPSILON * (Math.abs(actual) + Math.abs(expected) + Math.abs(scale)));
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || !Number.isFinite(tolerance) || Math.abs(actual - expected) > tolerance) {
      fail(id, month, actual, expected, Number.isFinite(tolerance) ? tolerance : 0);
    }
  };
  if (!input?.scenario?.assumptions || !input.scenario.program || !input.parcel || !ledger || !Array.isArray(ledger.rows) ||
      !ledger.rows.length || ledger.rows.length > MAX_LEDGER_AUDIT_ROWS) {
    fail("input.rows-or-source"); return report;
  }
  const a = input.scenario.assumptions;
  const { designMonths: design, constructionMonths: construction, saleOutMonths: saleMonths, leaseUpMonths: leaseMonths } = a;
  if (!Number.isInteger(design) || design < 0 || design > 120 || !Number.isInteger(construction) || construction < 1 || construction > 240 ||
      !Number.isInteger(saleMonths) || saleMonths < 1 || saleMonths > 120 || !Number.isInteger(leaseMonths) || leaseMonths < 0 || leaseMonths > 120 ||
      !Number.isFinite(a.salesPaceMonthlyPct) || a.salesPaceMonthlyPct < .1 || a.salesPaceMonthlyPct > 100) {
    fail("input.schedule"); return report;
  }
  const costs = { landCost: input.parcel.acquiredPrice, demolitionCost: input.parcel.demolitionCost ?? 0,
    acquisitionTax: a.acquisitionTaxManwon ?? 0, acquisitionOtherCost: a.acquisitionOtherCostManwon ?? 0,
    tenantRelocationCost: a.tenantRelocationCostManwon ?? 0, trustFee: a.trustFeeManwon ?? 0,
    hardCost: input.hardCost, softCost: input.softCost, contingency: input.contingency };
  const pools = input.revenueByPool ?? { residentialSale: input.revenueSale ?? 0, residentialLease: input.revenueExit ?? 0,
    retailSale: 0, officeSale: 0, retailLease: 0, officeLease: 0 };
  for (const [field, value] of Object.entries(costs)) {
    if (!Number.isFinite(value) || value < 0) fail(`input.${field}`);
    else if (value === 0) report.zeroCostInputs.push(field);
  }
  for (const field of POOLS) if (!Number.isFinite(pools[field]) || pools[field] < 0) fail(`input.${field}`);
  for (const [field, value] of [["ltc", a.ltcTarget], ["interest-rate", a.interestRate], ["pf-fee-rate", a.pfUpfrontFeeRate ?? 0]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) fail(`input.${field}`);
  }
  if (report.status === "fail") return report;
  const ltc = a.ltcTarget / 100, occupancy = design + construction;
  const lease = pools.residentialLease + pools.retailLease + pools.officeLease;
  const sale = pools.residentialSale + pools.retailSale + pools.officeSale;
  const presale = pools.residentialSale > 0 && !["single-house", "multi-family"].includes(input.scenario.program.type);
  const end = occupancy + Math.max(sale > 0 ? saleMonths : 0, presale ? Math.ceil(100 / a.salesPaceMonthlyPct) : 0, lease > 0 ? leaseMonths : 0);
  const contractMonth = design + Math.max(1, Math.floor(construction * .4));
  const eligible = costs.hardCost + costs.softCost + costs.contingency;
  const commitment = eligible * ltc, fee = commitment * (a.pfUpfrontFeeRate ?? 0) / 100;
  if (fee === 0) report.zeroCostInputs.push("pfFee");
  equal("schedule.row-count", ledger.rows.length, end + 1);
  if (ledger.rows.length !== end + 1 || !Array.isArray(ledger.equityCashFlows) || ledger.equityCashFlows.length !== end + 1) {
    fail("schedule.complete-months"); return report;
  }
  if (ledger.rows.some((row, month) => !row || row.month !== month || ROW_FIELDS.some(field =>
    !Number.isFinite(row[field]) || (!["projectNet", "equityCashFlow"].includes(field) && row[field] < 0)))) {
    fail("rows.invalid-number-or-order"); return report;
  }
  const sums = Object.fromEntries(ROW_FIELDS.map(field => [field, 0])) as Record<typeof ROW_FIELDS[number], number>;
  const oneTime = (total: number, at: number, month: number) => month === at ? total : 0;
  const spread = (total: number, from: number, to: number, month: number) => month >= from && month <= to ? total / (to - from + 1) : 0;
  let openingPf = 0, openingCash = 0, peakPf = 0, peakCash = 0;
  for (const row of ledger.rows) {
    const month = row.month;
    report.checkedRows++;
    const expectedCosts = { landCost: oneTime(costs.landCost, 0, month), acquisitionTax: oneTime(costs.acquisitionTax, 0, month),
      acquisitionOtherCost: oneTime(costs.acquisitionOtherCost, 0, month), demolitionCost: oneTime(costs.demolitionCost, design + 1, month),
      tenantRelocationCost: oneTime(costs.tenantRelocationCost, design + 1, month), trustFee: oneTime(costs.trustFee, 1, month),
      hardCost: spread(costs.hardCost, design + 1, occupancy, month), softCost: spread(costs.softCost, 1, occupancy, month),
      contingency: spread(costs.contingency, design + 1, occupancy, month), pfFee: oneTime(fee, design + 1, month) };
    for (const [field, expected] of Object.entries(expectedCosts)) equal(`allocation.${field}`, row[field as keyof typeof expectedCosts], expected, month);
    let receipt = oneTime(pools.retailSale + pools.officeSale + lease, end, month);
    receipt += presale
      ? oneTime(pools.residentialSale / 10, contractMonth, month) +
        (contractMonth < occupancy ? spread(pools.residentialSale * .6, contractMonth + 1, occupancy, month) : oneTime(pools.residentialSale * .6, occupancy, month)) +
        spread(pools.residentialSale * .3, occupancy + 1, end, month)
      : oneTime(pools.residentialSale, end, month);
    equal("allocation.revenue", row.revenueInflow, receipt, month);
    const phase = month === 0 ? "land" : month <= design ? "design" : month <= occupancy ? "construction" : "exit";
    if (row.phase !== phase) fail("schedule.phase", month);
    const outflow = COST_FIELDS.reduce((total, field) => total + row[field], 0);
    equal("cost.components", row.projectOutflow, outflow, month);
    equal("debt.draw", row.pfDraw, (row.hardCost + row.softCost + row.contingency) * ltc, month);
    equal("debt.opening", row.pfBalanceBeforeRepayment, openingPf + row.pfDraw, month);
    equal("cost.interest", row.interest, (2 * openingPf + row.pfDraw) * a.interestRate / 2400, month);
    equal("debt.repayment", row.pfRepayment, month === end ? row.pfBalanceBeforeRepayment : Math.min(openingCash + row.revenueInflow, row.pfBalanceBeforeRepayment), month);
    equal("debt.closing", row.pfBalance, row.pfBalanceBeforeRepayment - row.pfRepayment, month, row.pfBalanceBeforeRepayment);
    const availableAfterDebt = Math.max(0, openingCash + row.revenueInflow - row.pfBalanceBeforeRepayment);
    const finalDebtGap = month === end ? Math.max(0, row.pfBalanceBeforeRepayment - openingCash - row.revenueInflow) : 0;
    equal("equity.contribution", row.equityContribution, Math.max(0, outflow - row.pfDraw - availableAfterDebt) + finalDebtGap, month, outflow + row.pfDraw + availableAfterDebt);
    const sources = openingCash + row.revenueInflow + row.pfDraw + row.equityContribution;
    const uses = outflow + row.pfRepayment + row.equityDistribution + row.cashReserveBalance;
    equal("cash.sources-uses", sources, uses, month);
    equal("equity.cashflow", row.equityCashFlow, row.equityDistribution - row.equityContribution, month);
    equal("equity.series", ledger.equityCashFlows[month], row.equityCashFlow, month);
    equal("project.net", row.projectNet, row.revenueInflow - outflow, month, outflow + row.revenueInflow);
    if (month < end) equal("equity.early-distribution", row.equityDistribution, 0, month);
    else { equal("closing.cash", row.cashReserveBalance, 0, month); equal("closing.debt", row.pfBalance, 0, month); }
    for (const field of ROW_FIELDS) sums[field] += row[field];
    peakPf = Math.max(peakPf, row.pfBalanceBeforeRepayment, row.pfBalance);
    peakCash = Math.max(peakCash, row.cashReserveBalance);
    openingCash = row.cashReserveBalance; openingPf = row.pfBalance;
  }
  for (const [field, value] of Object.entries(costs)) equal(`total.${field}`, sums[field as keyof typeof costs], value);
  equal("total.pf-fee", sums.pfFee, fee);
  equal("total.revenue-input", sums.revenueInflow, sale + lease);
  for (const [field, expected] of Object.entries({ interestCost: sums.interest, financingCost: sums.interest + sums.pfFee + sums.trustFee,
    totalProjectOutflow: sums.projectOutflow, totalRevenue: sums.revenueInflow, equityInvested: sums.equityContribution,
    equityDistributions: sums.equityDistribution, pfCommitment: commitment, maxPfBalance: peakPf, maxCashReserve: peakCash })) {
    equal(`summary.${field}`, ledger[field as keyof ProjectLedger] as number, expected, null,
      ledger.rows.length * Math.max(Math.abs(expected), 1));
  }
  for (const field of ["acquisitionTax", "acquisitionOtherCost", "tenantRelocationCost", "pfFee", "trustFee"] as const) {
    equal(`summary.additional.${field}`, ledger.additionalCosts?.[field], sums[field]);
  }
  equal("project.equity-profit", sums.equityCashFlow, sums.revenueInflow - sums.projectOutflow, null,
    ledger.rows.length * (sums.revenueInflow + sums.projectOutflow));
  return report;
}
