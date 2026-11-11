import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compareLeaseRollNoi, type LeaseRollNoiComparison } from "@/lib/finance/lease-roll-noi-comparison";
import { createLeaseRollDraft, leaseRollBasis, type LeaseRollRow } from "@/lib/finance/lease-roll-contract";
import {
  buildOperatingBudgetDraftKey, createOperatingBudgetDraft, operatingBudgetBasis,
  operatingBudgetDraftSchema, OPERATING_BUDGET_VERSION, OPERATING_COST_CATEGORIES,
  resetOperatingBudgetCalendar, type OperatingBudgetDraft,
} from "@/lib/finance/operating-budget-contract";
import type { ScenarioResult } from "@/lib/finance/types";
import { precisionFixture } from "@/tests/helpers/finance-precision-fixture";

type Hold = ScenarioResult["hold"];
const NOW = "2024-01-01T00:00:00.000Z";
const MONTHS = [
  "2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06",
  "2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12",
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
];

function setup(leasePatch: Partial<LeaseRollRow> = {}, calendarStart = "2024-01-01") {
  const { scenario } = precisionFixture({ vacancyRate: 75 });
  scenario.program.areaContract!.revenueAreas.residentialLeaseSqm = 100;
  const projectId = "operating-project";
  const draft = createLeaseRollDraft(projectId, scenario, NOW);
  draft.calendarStart = calendarStart;
  draft.rows = [{
    id: "contract-1", unitId: "unit-1", unitLabel: "101", use: "residential", areaSqm: 60,
    monthlyRentWon: 1_000, depositWon: 10_000, startDate: "2024-01-01", endDate: "2025-12-31",
    sourceName: "Lease", sourceRef: "contracts/1", sourceAsOf: "2024-01-01", ...leasePatch,
  }];
  const budget = resetOperatingBudgetCalendar(createOperatingBudgetDraft(projectId, scenario, NOW), calendarStart);
  budget.scopeConfirmed = true;
  budget.allocationNote = "Entire retained portfolio including 40 sqm vacant space and owner common costs, net of recovery.";
  for (const [index, category] of budget.categories.entries()) {
    category.sourceName = `Owner budget ${index}`;
    category.sourceRef = `sources/${index}`;
    category.sourceAsOf = "2024-01-01";
    for (const amount of category.amounts) amount.amountWon = [100, 20, 30, 40, 50, 60][index];
  }
  return { projectId, scenario, draft, budget, baseline: null as Hold | null };
}

function hold(rows: Array<Record<string, unknown>>): Hold {
  return { status: "modeled-unverified", holdMonths: 24, rows } as unknown as Hold;
}

function expectUnavailable(result: LeaseRollNoiComparison, status: LeaseRollNoiComparison["status"]) {
  expect(result).toMatchObject({
    version: "lease-roll-noi-comparison-2026.1", status, financialApplied: false,
    approvalStatus: "unverified", rows: [], totalRentWon: null, totalOperatingExpenseWon: null, totalNoiWon: null,
  });
  expect(result.issues.length).toBeGreaterThan(0);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

describe("operating-budget draft contract", () => {
  it("creates an incomplete six-category draft and stable, distinct JSON tuple bindings", () => {
    const { projectId, scenario } = setup();
    const draft = createOperatingBudgetDraft(projectId, scenario, NOW);
    expect(draft).toEqual({
      version: OPERATING_BUDGET_VERSION, projectId, scenarioId: scenario.id,
      sourceBasis: operatingBudgetBasis(projectId, scenario), revision: 0, updatedAt: NOW,
      calendarStart: null, baselineCalendarStart: null, scopeConfirmed: false, allocationNote: "",
      categories: OPERATING_COST_CATEGORIES.map(category => ({ category, sourceName: "", sourceRef: "", sourceAsOf: null, amounts: [] })),
    });
    expect(buildOperatingBudgetDraftKey("a|b", "c")).toBe('["a|b","c"]');
    expect(buildOperatingBudgetDraftKey("a|b", "c")).not.toBe(buildOperatingBudgetDraftKey("a", "b|c"));
    expect(draft.sourceBasis).toBe(createHash("sha256").update(JSON.stringify([
      OPERATING_BUDGET_VERSION, leaseRollBasis(projectId, scenario),
    ])).digest("hex"));
    expect(operatingBudgetDraftSchema.safeParse({ ...draft, categories: [] }).success).toBe(true);
  });

  it("survives JSONB key order, binds owner and physical changes, and ignores financial assumptions", () => {
    const { scenario, projectId } = setup();
    const reverse = (value: unknown): unknown => Array.isArray(value) ? value.map(reverse)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value;
    const original = operatingBudgetBasis(projectId, scenario);
    expect(operatingBudgetBasis(projectId, reverse(scenario) as typeof scenario)).toBe(original);
    expect(operatingBudgetBasis("other-project", scenario)).not.toBe(original);
    scenario.assumptions.rentPerSqMMonth *= 2;
    scenario.assumptions.constCostPerSqM *= 2;
    expect(operatingBudgetBasis(projectId, scenario)).toBe(original);
    scenario.program.areaContract!.sourceScenarioVersion++;
    expect(operatingBudgetBasis(projectId, scenario)).not.toBe(original);
    const versionBasis = operatingBudgetBasis(projectId, scenario);
    scenario.program.areaContract!.revenueAreas.officeLeaseSqm = 1;
    expect(operatingBudgetBasis(projectId, scenario)).not.toBe(versionBasis);
    const areaBasis = operatingBudgetBasis(projectId, scenario);
    scenario.program.areaContract!.geometrySource = { mode: "engine-generated", locked: true, exactGeometryAvailable: true, geometryHash: "new-geometry" };
    expect(operatingBudgetBasis(projectId, scenario)).not.toBe(areaBasis);
  });

  it("resets every category without mutating sources, revision, binding or explicit baseline calendar", () => {
    const { budget } = setup();
    budget.revision = 17;
    budget.baselineCalendarStart = "2023-01-01";
    const before = structuredClone(budget);
    freezeDeep(budget);
    const reset = resetOperatingBudgetCalendar(budget, "2024-02-01");
    expect(budget).toEqual(before);
    expect(reset).toMatchObject({ ...before, scopeConfirmed: false, calendarStart: "2024-02-01", categories: expect.any(Array) });
    for (const [index, item] of reset.categories.entries()) {
      expect(item).toMatchObject({ ...before.categories[index], amounts: expect.any(Array) });
      expect(item.amounts).toHaveLength(24);
      expect(item.amounts[0]).toEqual({ month: "2024-02", amountWon: null });
      expect(item.amounts[23]).toEqual({ month: "2026-01", amountWon: null });
      expect(item.amounts.every(amount => amount.amountWon === null)).toBe(true);
    }
    reset.categories[0].sourceName = "Changed";
    expect(budget.categories[0].sourceName).toBe(before.categories[0].sourceName);
    const cleared = resetOperatingBudgetCalendar(budget, null);
    expect(cleared.baselineCalendarStart).toBe("2023-01-01");
    expect(cleared.categories.every(item => item.amounts.length === 0)).toBe(true);
    expect(resetOperatingBudgetCalendar({ ...before, categories: [] }, "2024-01-01").categories).toHaveLength(6);
  });

  it("accepts only real dates and a complete horizon ending no later than December 2199", () => {
    const { budget } = setup();
    expect(resetOperatingBudgetCalendar(budget, "2198-01-01").categories[0].amounts[23].month).toBe("2199-12");
    for (const anchor of ["2198-02-01", "2200-01-01", "1899-01-01", "2024-02-29", "2023-02-29"]) {
      expect(() => resetOperatingBudgetCalendar(budget, anchor)).toThrow();
    }
    for (const date of ["1900-02-29", "2100-02-29", "2024-04-31", "2200-01-01"]) {
      budget.categories[0].sourceAsOf = date;
      expect(operatingBudgetDraftSchema.safeParse(budget).success).toBe(false);
    }
    budget.categories[0].sourceAsOf = "2000-02-29";
    expect(operatingBudgetDraftSchema.safeParse(budget).success).toBe(true);
    budget.baselineCalendarStart = "2024-01-02";
    expect(operatingBudgetDraftSchema.safeParse(budget).success).toBe(false);
  });
});

describe("lease-roll NOI arithmetic", () => {
  it("reconciles independent monthly expectations over all 24 months without applying modeled vacancy", () => {
    const args = setup();
    args.budget.categories[0].amounts[0].amountWon = 200;
    args.budget.categories[1].amounts[1].amountWon = 0;
    const result = compareLeaseRollNoi(args);
    expect(result.status).toBe("ready");
    expect(result.rows).toEqual(MONTHS.map((month, index) => ({
      month, contractRentWon: 1_000, operatingExpenseWon: index === 0 ? 400 : index === 1 ? 280 : 300,
      noiWon: index === 0 ? 600 : index === 1 ? 720 : 700, baselineNoiWon: null, noiDeltaWon: null,
    })));
    expect(result).toMatchObject({
      version: "lease-roll-noi-comparison-2026.1", financialApplied: false, approvalStatus: "unverified",
      totalRentWon: 24_000, totalOperatingExpenseWon: 7_280, totalNoiWon: 16_720,
    });
    expect(Object.keys(result).sort()).toEqual([
      "version", "status", "financialApplied", "approvalStatus", "issues", "rows",
      "totalRentWon", "totalOperatingExpenseWon", "totalNoiWon",
    ].sort());
  });

  it("inherits leap-day proration, keeps expenses after expiry, and excludes deposit receipt and refund", () => {
    const args = setup({ monthlyRentWon: 2_900, startDate: "2024-02-10", endDate: "2024-03-15", depositWon: 9e12 }, "2024-02-01");
    const result = compareLeaseRollNoi(args);
    expect(result.status).toBe("ready");
    expect(result.rows[0]).toMatchObject({ month: "2024-02", contractRentWon: 2_000, operatingExpenseWon: 300, noiWon: 1_700 });
    expect(result.rows[1].noiWon).toBeCloseTo(2_900 * 15 / 31 - 300, 10);
    expect(result.rows.slice(2).every(row => row.contractRentWon === 0 && row.operatingExpenseWon === 300 && row.noiWon === -300)).toBe(true);
    expect(result.totalOperatingExpenseWon).toBe(7_200);
    expect(result.totalNoiWon).toBeCloseTo(2_000 + 2_900 * 15 / 31 - 7_200, 10);
    args.draft.rows[0].depositWon = 0;
    expect(compareLeaseRollNoi(args)).toEqual(result);
  });

  it("uses Decimal for expense totals and permits explicit zero costs", () => {
    const args = setup({ monthlyRentWon: 1 });
    for (const [index, item] of args.budget.categories.entries()) {
      item.amounts.forEach(amount => { amount.amountWon = index === 0 ? .1 : index === 1 ? .2 : 0; });
    }
    const result = compareLeaseRollNoi(args);
    expect(result.rows.every(row => row.operatingExpenseWon === .3 && row.noiWon === .7)).toBe(true);
    expect(result.totalOperatingExpenseWon).toBe(7.2);
    expect(result.totalNoiWon).toBe(16.8);
    for (const item of args.budget.categories) item.amounts.forEach(amount => { amount.amountWon = 0; });
    expect(compareLeaseRollNoi(args).totalOperatingExpenseWon).toBe(0);
  });

  it("allows the exact aggregate cap, rejects cross-category/month overflow, and returns no partial rows", () => {
    const args = setup();
    for (const item of args.budget.categories) item.amounts.forEach(amount => { amount.amountWon = 0; });
    args.budget.categories[0].amounts[0].amountWon = 1e13;
    expect(compareLeaseRollNoi(args)).toMatchObject({ status: "ready", totalOperatingExpenseWon: 1e13, totalNoiWon: -9_999_999_976_000 });
    args.budget.categories[1].amounts[0].amountWon = 1;
    expectUnavailable(compareLeaseRollNoi(args), "conflict");
    args.budget.categories[1].amounts[0].amountWon = 0;
    args.budget.categories[0].amounts[23].amountWon = 1;
    expectUnavailable(compareLeaseRollNoi(args), "conflict");
  });

  it("does not mutate frozen budget, lease, baseline or financial scenario", () => {
    const args = setup();
    args.budget.baselineCalendarStart = args.draft.calendarStart;
    args.baseline = hold([{ holdMonth: 1, effectiveGrossIncome: .3, operatingExpense: .2, noi: .1 }]);
    const before = structuredClone(args);
    expect(compareLeaseRollNoi(freezeDeep(args)).status).toBe("ready");
    expect(args).toEqual(before);
  });
});

describe("NOI completeness and conflict gates", () => {
  it.each([
    ["scope", (budget: OperatingBudgetDraft) => { budget.scopeConfirmed = false; }],
    ["allocation", (budget: OperatingBudgetDraft) => { budget.allocationNote = " \n "; }],
    ["category", (budget: OperatingBudgetDraft) => { budget.categories.pop(); }],
    ["month", (budget: OperatingBudgetDraft) => { budget.categories[0].amounts.pop(); }],
    ["null amount", (budget: OperatingBudgetDraft) => { budget.categories[0].amounts[0].amountWon = null; }],
    ["name", (budget: OperatingBudgetDraft) => { budget.categories[0].sourceName = " "; }],
    ["reference", (budget: OperatingBudgetDraft) => { budget.categories[0].sourceRef = " "; }],
    ["source date", (budget: OperatingBudgetDraft) => { budget.categories[0].sourceAsOf = null; }],
    ["anchor", (budget: OperatingBudgetDraft) => { budget.calendarStart = null; }],
    ["missing amount", (budget: OperatingBudgetDraft) => { Reflect.deleteProperty(budget.categories[0].amounts[0], "amountWon"); }],
  ])("never guesses missing %s", (_name, change) => {
    const args = setup(); change(args.budget);
    expectUnavailable(compareLeaseRollNoi(args), "incomplete");
  });

  it("requires the lease schedule and budget even when the other side is complete", () => {
    const args = setup();
    expectUnavailable(compareLeaseRollNoi({ ...args, budget: null }), "incomplete");
    expectUnavailable(compareLeaseRollNoi({ ...args, draft: null }), "incomplete");
    args.draft.rows[0].sourceRef = "";
    expectUnavailable(compareLeaseRollNoi(args), "incomplete");
  });

  it.each([
    ["project", { projectId: "other" }, "conflict"],
    ["scenario", { scenarioId: "other" }, "conflict"],
    ["calendar", { calendarStart: "2024-02-01" }, "conflict"],
    ["basis", { sourceBasis: "b".repeat(64) }, "stale"],
    ["unknown approval", { approvalStatus: "approved" }, "conflict"],
    ["unknown financial state", { financialApplied: true }, "conflict"],
    ["fractional revision", { revision: .5 }, "conflict"],
    ["over-limit revision", { revision: 1e9 + 1 }, "conflict"],
    ["long allocation", { allocationNote: "a".repeat(2001) }, "conflict"],
  ] as const)("rejects invalid %s", (_name, patch, status) => {
    const args = setup();
    expectUnavailable(compareLeaseRollNoi({ ...args, budget: { ...args.budget, ...patch } }), status);
  });

  it("rejects stale leases, duplicate categories/months, unsupported costs and nested injected fields", () => {
    const original = setup();
    const cases = [
      (budget: OperatingBudgetDraft) => { budget.categories[1] = structuredClone(budget.categories[0]); },
      (budget: OperatingBudgetDraft) => { budget.categories[0].amounts[1] = { ...budget.categories[0].amounts[0] }; },
      (budget: OperatingBudgetDraft) => { budget.categories[0].amounts[0].month = "2023-12"; },
      (budget: OperatingBudgetDraft) => { budget.categories[0].amounts[0].month = "2024-13"; },
      (budget: OperatingBudgetDraft) => { budget.categories[0].amounts.push({ month: "2026-01", amountWon: 0 }); },
      (budget: OperatingBudgetDraft) => { budget.categories.push(structuredClone(budget.categories[0])); },
      (budget: OperatingBudgetDraft) => { Object.assign(budget.categories[0], { category: "capex" }); },
      (budget: OperatingBudgetDraft) => { Object.assign(budget.categories[0], { debtService: 10 }); },
      (budget: OperatingBudgetDraft) => { Object.assign(budget.categories[0].amounts[0], { approved: true }); },
    ];
    for (const change of cases) {
      const args = structuredClone(original); change(args.budget);
      expectUnavailable(compareLeaseRollNoi(args), "conflict");
    }
    original.draft.sourceBasis = "b".repeat(64);
    expectUnavailable(compareLeaseRollNoi(original), "stale");
  });

  it.each([NaN, Infinity, -Infinity, -1, 1e13 + 1, "0"])("rejects malformed cost %s without coercion", amountWon => {
    const args = setup(); Object.assign(args.budget.categories[0].amounts[0], { amountWon });
    expectUnavailable(compareLeaseRollNoi(args), "conflict");
  });
});

describe("optional baseline NOI", () => {
  it("matches holdMonth regardless of array order and development month, preserving negative and zero NOI", () => {
    const args = setup(); args.budget.baselineCalendarStart = args.draft.calendarStart;
    args.baseline = hold([
      { holdMonth: 2, month: 72, effectiveGrossIncome: .2, operatingExpense: .25, noi: -.05 },
      { holdMonth: 0, effectiveGrossIncome: 999, operatingExpense: 0, noi: 999 },
      { holdMonth: 1, month: 71, effectiveGrossIncome: .3, operatingExpense: .2, noi: .1 },
      { holdMonth: 3, effectiveGrossIncome: 0, operatingExpense: 0, noi: 0 },
    ]);
    const result = compareLeaseRollNoi(args);
    expect(result.status).toBe("ready");
    expect(result.rows.slice(0, 4).map(row => [row.baselineNoiWon, row.noiDeltaWon])).toEqual([
      [1_000, -300], [-500, 1_200], [0, 700], [null, null],
    ]);
    expect(result.totalNoiWon).toBe(16_800);
  });

  it.each([null, "2023-01-01"])("requires explicit matching calendar, received %s", baselineCalendarStart => {
    const args = setup(); args.budget.baselineCalendarStart = baselineCalendarStart;
    args.baseline = hold([{ holdMonth: 1, effectiveGrossIncome: 1, operatingExpense: 0, noi: 1 }]);
    const result = compareLeaseRollNoi(args);
    expect(result.status).toBe("ready");
    expect(result.rows.every(row => row.baselineNoiWon === null && row.noiDeltaWon === null)).toBe(true);
    expect(result.issues.join(" ")).toContain("baselineCalendarStart");
  });

  it("isolates duplicate, malformed, nonfinite, inconsistent and over-limit baseline rows", () => {
    const args = setup(); args.budget.baselineCalendarStart = args.draft.calendarStart;
    args.baseline = hold([
      { holdMonth: 1, effectiveGrossIncome: .1, operatingExpense: 0, noi: .1 },
      { holdMonth: 2, effectiveGrossIncome: .1, operatingExpense: 0, noi: .1 },
      { holdMonth: 2, effectiveGrossIncome: .1, operatingExpense: 0, noi: .1 },
      { holdMonth: 2, effectiveGrossIncome: .1, operatingExpense: 0, noi: .1 },
      { holdMonth: 3, effectiveGrossIncome: .1, operatingExpense: 0, noi: NaN },
      { holdMonth: 4, effectiveGrossIncome: .1, operatingExpense: Infinity, noi: .1 },
      { holdMonth: 5, effectiveGrossIncome: .1, operatingExpense: 0, noi: .2 },
      { holdMonth: 6, effectiveGrossIncome: 1e9 + 1, operatingExpense: 0, noi: 1e9 + 1 },
      { holdMonth: 7, effectiveGrossIncome: -1, operatingExpense: 0, noi: -1 },
      { holdMonth: 8, effectiveGrossIncome: .1, operatingExpense: -1, noi: 1.1 },
      { holdMonth: 9, effectiveGrossIncome: .1, operatingExpense: 0 },
      { holdMonth: 10, effectiveGrossIncome: .1, operatingExpense: 0, noi: ".1" },
      { holdMonth: 11.5, effectiveGrossIncome: .1, operatingExpense: 0, noi: .1 },
      { holdMonth: 24, effectiveGrossIncome: 0, operatingExpense: .1, noi: -.1 },
    ]);
    const result = compareLeaseRollNoi(args);
    expect(result.status).toBe("ready");
    expect(result.rows[0].baselineNoiWon).toBe(1_000);
    expect(result.rows[23].baselineNoiWon).toBe(-1_000);
    expect(result.rows.slice(1, 23).every(row => row.baselineNoiWon === null && row.noiDeltaWon === null)).toBe(true);
    expect(result.issues.join(" ")).toContain("holdMonth 2");
  });

  it("tolerates serialization noise but rejects even a one-won identity error at the cap", () => {
    const args = setup(); args.budget.baselineCalendarStart = args.draft.calendarStart;
    const small = compareLeaseRollNoi({ ...args, baseline: hold([
      { holdMonth: 1, effectiveGrossIncome: .3, operatingExpense: .2, noi: .3 - .2 },
    ]) });
    expect(small.rows[0].baselineNoiWon).toBeCloseTo(1_000, 8);
    args.baseline = hold([
      { holdMonth: 2, effectiveGrossIncome: 1e9, operatingExpense: .0000001, noi: 1e9 - .0000001 },
      { holdMonth: 3, effectiveGrossIncome: 1e9, operatingExpense: 0, noi: 1e9 - .0001 },
    ]);
    const result = compareLeaseRollNoi(args);
    expect(result.rows[1].baselineNoiWon).not.toBeNull();
    expect(result.rows[2].baselineNoiWon).toBeNull();
  });

  it.each(["income", "expense", "offsetting"])("withholds over-limit aggregate baseline %s without changing contractual NOI", kind => {
    const args = setup(); args.budget.baselineCalendarStart = args.draft.calendarStart;
    args.baseline = hold(Array.from({ length: 24 }, (_, index) => ({ holdMonth: index + 1,
      effectiveGrossIncome: kind === "expense" ? 0 : 1e9,
      operatingExpense: kind === "income" ? 0 : 1e9,
      noi: kind === "income" ? 1e9 : kind === "expense" ? -1e9 : 0 })));
    const result = compareLeaseRollNoi(args);
    expect(result.status).toBe("ready");
    expect(result.totalNoiWon).toBe(16_800);
    expect(result.rows.every(row => row.baselineNoiWon === null && row.noiDeltaWon === null)).toBe(true);
    expect(result.issues.join(" ")).toContain("24개월 합계가 10조 원");
  });
  it("accepts aggregate source totals exactly at the cap without netting or discarding a loss", () => {
    const args = setup(); args.budget.baselineCalendarStart = args.draft.calendarStart;
    args.baseline = hold(Array.from({ length: 24 }, (_, index) => ({ holdMonth: index + 1,
      effectiveGrossIncome: index === 0 ? 1e9 : 0, operatingExpense: index === 1 ? 1e9 : 0,
      noi: index === 0 ? 1e9 : index === 1 ? -1e9 : 0 })));
    const result = compareLeaseRollNoi(args);
    expect(result.rows[0].baselineNoiWon).toBe(1e13);
    expect(result.rows[1].baselineNoiWon).toBe(-1e13);
    expect(result.rows.slice(2).every(row => row.baselineNoiWon === 0)).toBe(true);
  });
  it("removes a duplicate month's source amounts from aggregate validation", () => {
    const args = setup(); args.budget.baselineCalendarStart = args.draft.calendarStart;
    args.baseline = hold([
      { holdMonth: 1, effectiveGrossIncome: 1e9, operatingExpense: 0, noi: 1e9 },
      { holdMonth: 1, effectiveGrossIncome: 1e9, operatingExpense: 0, noi: 1e9 },
      { holdMonth: 2, effectiveGrossIncome: 1, operatingExpense: 0, noi: 1 },
    ]);
    const result = compareLeaseRollNoi(args);
    expect(result.rows[0].baselineNoiWon).toBeNull();
    expect(result.rows[1].baselineNoiWon).toBe(10_000);
  });

  it("keeps contract NOI available for absent, uncalculated, oversized or malformed baseline envelopes", () => {
    const args = setup(); args.budget.baselineCalendarStart = args.draft.calendarStart;
    for (const baseline of [null, {}, { status: "terms-invalid", rows: [], holdMonths: 24 },
      { status: "modeled-unverified", rows: null, holdMonths: 24 },
      { status: "modeled-unverified", rows: Array(602).fill(null), holdMonths: 24 },
      { status: "modeled-unverified", rows: [], holdMonths: Infinity }]) {
      const result = compareLeaseRollNoi({ ...args, baseline: baseline as Hold | null });
      expect(result).toMatchObject({ status: "ready", totalNoiWon: 16_800 });
      expect(result.rows.every(row => row.baselineNoiWon === null)).toBe(true);
      expect(result.issues.join(" ")).toContain("기준 NOI");
    }
  });
});
