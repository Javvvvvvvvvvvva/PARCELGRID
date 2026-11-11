import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auditModule from "@/lib/finance/project-ledger-audit";
import * as ledgerModule from "@/lib/finance/project-ledger";
import { defaultAssumptions, defaultProgram } from "@/lib/finance/scenario";
import type { MonthlyProjectLedgerRow, ProjectLedgerInput } from "@/lib/finance/project-ledger";

const { auditProjectLedger, MAX_LEDGER_AUDIT_ROWS } = auditModule;
const { buildProjectLedger } = ledgerModule;
function fixture(): ProjectLedgerInput {
  return {
    parcel: { acquiredPrice: 100, demolitionCost: 20 },
    scenario: { id: "arithmetic-only", name: "Synthetic arithmetic", shortName: "Synthetic",
      program: defaultProgram("multi-family", 200, 60), assumptions: { ...defaultAssumptions(),
        designMonths: 0, constructionMonths: 1, saleOutMonths: 1, leaseUpMonths: 0, salesPaceMonthlyPct: 100,
        ltcTarget: 50, interestRate: 12, pfUpfrontFeeRate: 2, trustFeeManwon: 8,
        acquisitionTaxManwon: 10, acquisitionOtherCostManwon: 5, tenantRelocationCostManwon: 30 } },
    revenueByPool: { residentialSale: 1500, retailSale: 0, officeSale: 0, residentialLease: 0, retailLease: 0, officeLease: 0 },
    hardCost: 1000, softCost: 0, contingency: 0,
  };
}
afterEach(() => vi.restoreAllMocks());

describe("independent monthly arithmetic audit", () => {
  it("matches a hand-calculated three-month cash ledger", () => {
    const input = fixture(), ledger = buildProjectLedger(input);
    expect(ledger.rows.map(r => [r.month, r.projectOutflow, r.revenueInflow, r.pfDraw,
      r.pfRepayment, r.pfBalance, r.interest, r.equityContribution, r.equityDistribution, r.equityCashFlow])).toEqual([
      [0, 115, 0, 0, 0, 0, 0, 115, 0, -115],
      [1, 1070.5, 0, 500, 0, 500, 2.5, 570.5, 0, -570.5],
      [2, 5, 1500, 0, 500, 0, 5, 0, 995, 995],
    ]);
    expect(ledger.totalProjectOutflow).toBe(1190.5);
    expect(ledger.financingCost).toBe(25.5);
    expect(ledger.equityInvested).toBe(685.5);
    const audit = auditProjectLedger(input, ledger);
    expect(audit).toMatchObject({ status: "checked", scope: "internal-arithmetic", approvalStatus: "unverified",
      checkedRows: 3, failureCount: 0, findings: [], zeroCostInputs: ["softCost", "contingency"] });
    expect(audit.checkedEquations).toBeGreaterThan(90);
  });

  it("requires fresh equity to close unpaid PF in a loss case", () => {
    const input = fixture(); input.revenueByPool!.residentialSale = 100;
    const ledger = buildProjectLedger(input);
    expect(ledger.rows.at(-1)).toMatchObject({ pfRepayment: 500, pfBalance: 0, equityContribution: 405, equityDistribution: 0 });
    expect(ledger.equityInvested).toBe(1090.5);
    expect(auditProjectLedger(input, ledger).status).toBe("checked");
  });

  it("keeps commercial/lease receipts out of residential 10/60/30 installments", () => {
    const input = fixture(); input.scenario.program.type = "mixed";
    input.scenario.assumptions.constructionMonths = 2;
    input.scenario.assumptions.leaseUpMonths = 1;
    input.revenueByPool = { residentialSale: 10000, retailSale: 3000, officeSale: 0, residentialLease: 0, retailLease: 7000, officeLease: 0 };
    const ledger = buildProjectLedger(input);
    expect(ledger.rows.map(r => r.revenueInflow)).toEqual([0, 1000, 6000, 13000]);
    expect(auditProjectLedger(input, ledger).status).toBe("checked");
  });

  it.each([1, 12, 240])("matches a separate BigInt bulk-interest formula over %s construction months", months => {
    for (const ltc of [0, 25, 100]) for (const rate of [0, 6, 100]) {
      const input = fixture(), exitMonths = 120;
      Object.assign(input.scenario.assumptions, { designMonths: 4, constructionMonths: months, saleOutMonths: exitMonths,
        ltcTarget: ltc, interestRate: rate });
      input.revenueByPool!.residentialSale = 1;
      // Sum (k - 1/2) * equal draw plus exit-month full-balance interest.
      const numerator = BigInt(input.hardCost) * BigInt(ltc) * BigInt(rate) * BigInt(months + 2 * exitMonths);
      const expected = Number(numerator) / 240000;
      const ledger = buildProjectLedger(input);
      expect(ledger.interestCost).toBeCloseTo(expected, 9);
      expect(auditProjectLedger(input, ledger).status).toBe("checked");
    }
  });

  it("checks the maximum supported timeline without early success", () => {
    const input = fixture(); input.scenario.program.type = "officetel";
    Object.assign(input.scenario.assumptions, { designMonths: 120, constructionMonths: 240, salesPaceMonthlyPct: .1 });
    const ledger = buildProjectLedger(input), audit = auditProjectLedger(input, ledger);
    expect(ledger.rows).toHaveLength(MAX_LEDGER_AUDIT_ROWS);
    expect(audit).toMatchObject({ status: "checked", checkedRows: MAX_LEDGER_AUDIT_ROWS, failureCount: 0 });
  });

  it("keeps zero/missing evidence distinct from arithmetic success", () => {
    const input = fixture(); input.scenario.assumptions.acquisitionTaxManwon = 0;
    const audit = auditProjectLedger(input, buildProjectLedger(input));
    expect(audit.status).toBe("checked");
    expect(audit.zeroCostInputs).toContain("acquisitionTax");
    expect(audit.approvalStatus).toBe("unverified");
  });

  const rowFields: Array<keyof Omit<MonthlyProjectLedgerRow, "month" | "phase">> = ["landCost", "acquisitionTax", "acquisitionOtherCost",
    "demolitionCost", "tenantRelocationCost", "hardCost", "softCost", "contingency", "interest", "pfFee", "trustFee",
    "projectOutflow", "revenueInflow", "pfDraw", "pfBalanceBeforeRepayment", "pfRepayment", "pfBalance",
    "cashReserveBalance", "equityContribution", "equityDistribution", "equityCashFlow", "projectNet"];
  it.each(rowFields)("rejects altered row field %s", field => {
    const input = fixture(), ledger = buildProjectLedger(input);
    ledger.rows[1][field] += 1;
    const audit = auditProjectLedger(input, ledger);
    expect(audit.status).toBe("fail");
    expect(audit.findings.some(f => f.month === 1)).toBe(true);
  });

  it("detects offsetting cost errors even when row and project totals still match", () => {
    const input = fixture(); input.softCost = 100;
    const ledger = buildProjectLedger(input);
    ledger.rows[1].hardCost += 10; ledger.rows[1].softCost -= 10;
    const audit = auditProjectLedger(input, ledger);
    expect(audit.findings.map(f => f.id)).toEqual(expect.arrayContaining(["allocation.hardCost", "allocation.softCost"]));
  });

  it("rejects extra equity contributions/distributions that cancel each other", () => {
    const input = fixture(), ledger = buildProjectLedger(input);
    ledger.rows[1].equityContribution += 1; ledger.rows[1].equityDistribution += 1;
    expect(auditProjectLedger(input, ledger).findings.map(f => f.id))
      .toEqual(expect.arrayContaining(["equity.contribution", "equity.early-distribution"]));
  });

  it.each(["interestCost", "financingCost", "totalProjectOutflow", "totalRevenue", "equityInvested", "equityDistributions",
    "pfCommitment", "maxPfBalance", "maxCashReserve"] as const)("rejects altered summary %s", field => {
    const input = fixture(), ledger = buildProjectLedger(input); ledger[field] += 1;
    expect(auditProjectLedger(input, ledger).findings).toContainEqual(expect.objectContaining({ id: `summary.${field}` }));
  });

  it.each(["missing", "duplicate", "reordered", "oversize", "nonfinite", "negative", "series"])("rejects incomplete/invalid rows: %s", kind => {
    const input = fixture(), ledger = buildProjectLedger(input);
    if (kind === "missing") ledger.rows.pop();
    if (kind === "duplicate") ledger.rows[1] = { ...ledger.rows[0] };
    if (kind === "reordered") ledger.rows.reverse();
    if (kind === "oversize") ledger.rows = Array(MAX_LEDGER_AUDIT_ROWS + 1).fill(ledger.rows[0]);
    if (kind === "nonfinite") ledger.rows[1].hardCost = NaN;
    if (kind === "negative") ledger.rows[1].hardCost = -1;
    if (kind === "series") ledger.equityCashFlows.pop();
    expect(auditProjectLedger(input, ledger).status).toBe("fail");
  });

  it("bounds findings without losing the failure count", () => {
    const input = fixture(); input.scenario.assumptions.constructionMonths = 12;
    const ledger = buildProjectLedger(input);
    for (const row of ledger.rows) for (const field of rowFields) row[field] += 100;
    const audit = auditProjectLedger(input, ledger);
    expect(audit.failureCount).toBeGreaterThan(32);
    expect(audit.findings).toHaveLength(32);
    expect(audit.checkedRows).toBe(ledger.rows.length);
  });

  it.each(["negative-revenue", "nonfinite-revenue", "missing-pool", "negative-cost"])("blocks silent normalization: %s", kind => {
    const input = fixture();
    if (kind === "negative-revenue") input.revenueByPool!.residentialSale = -1;
    if (kind === "nonfinite-revenue") input.revenueByPool!.residentialSale = NaN;
    if (kind === "missing-pool") delete (input.revenueByPool as Partial<NonNullable<ProjectLedgerInput["revenueByPool"]>>).officeSale;
    if (kind === "negative-cost") input.hardCost = -1;
    expect(() => buildProjectLedger(input)).toThrow();
  });

  it("does not call the engine or mutate data when auditing an existing ledger", () => {
    const input = fixture(), ledger = buildProjectLedger(input), before = structuredClone({ input, ledger });
    const builder = vi.spyOn(ledgerModule, "buildProjectLedger");
    auditProjectLedger(input, ledger);
    expect(builder).not.toHaveBeenCalled();
    expect({ input, ledger }).toEqual(before);
    const source = readFileSync(new URL("../../lib/finance/project-ledger-audit.ts", import.meta.url), "utf8");
    const parsed = ts.createSourceFile("audit.ts", source, ts.ScriptTarget.Latest, true);
    const imports = parsed.statements.filter(ts.isImportDeclaration);
    expect(imports.every(node => node.importClause?.isTypeOnly)).toBe(true);
  });

  it("refuses to return a calculated ledger if the separate checker fails", () => {
    const input = fixture(), failure = auditProjectLedger(input, buildProjectLedger(input));
    failure.status = "fail"; failure.failureCount = 1;
    failure.findings = [{ id: "test-fault", month: 1, actual: 2, expected: 1, toleranceManwon: 1e-7 }];
    vi.spyOn(auditModule, "auditProjectLedger").mockReturnValue(failure);
    expect(() => buildProjectLedger(input)).toThrow("test-fault@1");
  });
});
