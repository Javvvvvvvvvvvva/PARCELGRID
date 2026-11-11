import { describe, expect, it } from "vitest";
import { compareLeaseRoll, type LeaseRollComparison } from "@/lib/finance/lease-roll-comparison";
import {
  createLeaseRollDraft,
  leaseRollBasis,
  MAX_LEASE_ROWS,
  type LeaseRollDraft,
  type LeaseRollRow,
  type LeaseUse,
} from "@/lib/finance/lease-roll-contract";
import { defaultAssumptions, defaultProgram } from "@/lib/finance/scenario";
import type { Scenario, ScenarioResult } from "@/lib/finance/types";

const PROJECT_ID = "lease-project";
type Hold = ScenarioResult["hold"];

function scenarioWithAreas(areas: Partial<Record<LeaseUse, number>> = {}): Scenario {
  return {
    id: "lease-scenario",
    name: "Lease comparison",
    shortName: "Lease",
    assumptions: { ...defaultAssumptions(), designMonths: 12, constructionMonths: 36, vacancyRate: 75 },
    program: {
      ...defaultProgram("mixed", 200, 60),
      areaContract: {
        schemaVersion: "stage2-finance-area-2026.1",
        source: "stage2-planning",
        sourceScenarioId: "lease-scenario",
        sourceScenarioVersion: 1,
        constructionAreaSqm: 200,
        aboveGroundAreaSqm: 200,
        basementAreaSqm: 0,
        farAreaSqm: 200,
        gradeFootprintAreaSqm: 100,
        parkingAreaSqm: 0,
        commonAreaSqm: 0,
        saleableAreaSqm: 100,
        rentableAreaSqm: 100,
        revenueAreas: {
          residentialSaleSqm: 100,
          retailSaleSqm: 0,
          officeSaleSqm: 0,
          residentialLeaseSqm: areas.residential ?? 100,
          retailLeaseSqm: areas.retail ?? 0,
          officeLeaseSqm: areas.office ?? 0,
        },
        providedParkingSpaces: 0,
        requiredParkingSpaces: 0,
        materialAdjustmentCostManwon: 0,
      },
    },
  };
}

function lease(overrides: Partial<LeaseRollRow> = {}): LeaseRollRow {
  return {
    id: "contract-1",
    unitId: "unit-1",
    unitLabel: "101",
    use: "residential",
    areaSqm: 100,
    monthlyRentWon: 3_100,
    depositWon: 10_000,
    startDate: "2024-01-01",
    endDate: "2025-12-31",
    sourceName: "Recorded contract",
    sourceRef: "contracts/1",
    sourceAsOf: "2024-01-01",
    ...overrides,
  };
}

function setup(
  rows: LeaseRollRow[] = [lease()],
  calendarStart = "2024-01-01",
  scenario = scenarioWithAreas(),
) {
  const draft: LeaseRollDraft = {
    ...createLeaseRollDraft(PROJECT_ID, scenario, "2024-01-01T00:00:00.000Z"),
    calendarStart,
    rows,
  };
  return { draft, projectId: PROJECT_ID, scenario, baseline: null as Hold | null };
}

function hold(
  entries: Array<[number, number]> = [[0, 999], [1, 0.25], [2, 0]],
  status: Hold["status"] = "commitment-feasible",
  holdMonths = 24,
): Hold {
  // Only these hold fields participate in the comparison contract.
  return {
    status,
    holdMonths,
    rows: entries.map(([holdMonth, effectiveGrossIncome]) => ({
      month: 48 + holdMonth,
      holdMonth,
      phase: holdMonth === 0 ? "refinance" : "operations",
      effectiveGrossIncome,
    })),
  } as Hold;
}

function expectUnavailable(result: LeaseRollComparison, status: LeaseRollComparison["status"]) {
  expect(result).toMatchObject({
    version: "lease-roll-comparison-2026.1",
    status,
    financialApplied: false,
    approvalStatus: "unverified",
    rows: [],
    openingDepositWon: null,
    totalRentWon: null,
    closingDepositWon: null,
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

describe("lease-roll comparison calendar and deposits", () => {
  it("anchors exactly 24 operating months, keeps the exact result contract, and does not apply vacancy", () => {
    const result = compareLeaseRoll(setup());
    expect(result.status).toBe("ready");
    expect(result.rows).toHaveLength(24);
    expect(result.rows[0]).toEqual({
      month: "2024-01", contractRentWon: 3_100, depositInflowWon: 10_000,
      depositRefundWon: 0, closingDepositWon: 10_000, baselineRentWon: null, rentDeltaWon: null,
    });
    expect(result.rows[23].month).toBe("2025-12");
    expect(result.rows.every(row => row.contractRentWon === 3_100)).toBe(true);
    expect(result.totalRentWon).toBe(74_400);
    expect(Object.keys(result).sort()).toEqual([
      "version", "status", "financialApplied", "approvalStatus", "issues", "rows", "areas",
      "openingDepositWon", "totalRentWon", "closingDepositWon",
    ].sort());
    expect(result.financialApplied).toBe(false);
    expect(result.approvalStatus).toBe("unverified");
  });

  it.each([
    ["2024", 29, 20], ["2000", 29, 20], ["1900", 28, 19], ["2100", 28, 19],
  ])("prorates February %s using UTC calendar days", (year, days, occupied) => {
    const result = compareLeaseRoll(setup([lease({
      startDate: `${year}-02-10`, endDate: `${year}-02-${days}`, monthlyRentWon: Number(days) * 100,
    })], `${year}-02-01`));
    expect(result.status).toBe("ready");
    expect(result.rows[0].contractRentWon).toBe(Number(occupied) * 100);
    expect(result.rows[0].depositRefundWon).toBe(0);
    expect(result.rows[1].depositRefundWon).toBe(10_000);
    expect(result.rows[1].contractRentWon).toBe(0);
  });

  it("prorates both partial months with their own day counts and includes the final day", () => {
    const result = compareLeaseRoll(setup([lease({
      startDate: "2024-02-10", endDate: "2024-03-15", monthlyRentWon: 2_900,
    })], "2024-02-01"));
    expect(result.rows[0].contractRentWon).toBe(2_000);
    expect(result.rows[1].contractRentWon).toBeCloseTo(2_900 * 15 / 31, 10);
    expect(result.totalRentWon).toBeCloseTo(2_000 + 2_900 * 15 / 31, 10);
    expect(result.rows[1]).toMatchObject({ depositRefundWon: 10_000, closingDepositWon: 0 });
  });

  it("charges a single inclusive leap day and refunds on March 1", () => {
    const result = compareLeaseRoll(setup([lease({
      startDate: "2024-02-29", endDate: "2024-02-29", monthlyRentWon: 2_900,
    })], "2024-02-01"));
    expect(result.rows[0]).toMatchObject({ contractRentWon: 100, depositInflowWon: 10_000, closingDepositWon: 10_000 });
    expect(result.rows[1]).toMatchObject({ contractRentWon: 0, depositRefundWon: 10_000, closingDepositWon: 0 });
  });

  it("uses UTC days across a daylight-saving transition", () => {
    const result = compareLeaseRoll(setup([lease({ startDate: "2024-03-09", endDate: "2024-03-11" })], "2024-03-01"));
    expect(result.rows[0].contractRentWon).toBe(300);
    expect(result.totalRentWon).toBe(300);
  });

  it("counts a sequential unit once, supports adjacent contracts, and leaves gaps without rent", () => {
    const result = compareLeaseRoll(setup([
      lease({ id: "a", areaSqm: 10, endDate: "2024-01-15", depositWon: 1_000 }),
      lease({ id: "b", areaSqm: 10, startDate: "2024-01-16", endDate: "2024-01-31", monthlyRentWon: 6_200, depositWon: 2_000 }),
      lease({ id: "c", areaSqm: 10, startDate: "2024-03-01", endDate: "2024-03-31", depositWon: 3_000 }),
    ]));
    expect(result.status).toBe("ready");
    expect(result.areas[0]).toEqual({ use: "residential", expectedSqm: 100, scheduledSqm: 10, unassignedSqm: 90 });
    expect(result.rows[0]).toMatchObject({ contractRentWon: 4_700, depositInflowWon: 3_000, depositRefundWon: 1_000, closingDepositWon: 2_000 });
    expect(result.rows[1]).toMatchObject({ contractRentWon: 0, depositInflowWon: 0, depositRefundWon: 2_000, closingDepositWon: 0 });
    expect(result.rows[2]).toMatchObject({ contractRentWon: 3_100, depositInflowWon: 3_000, closingDepositWon: 3_000 });
    expect(result.rows[3].depositRefundWon).toBe(3_000);
    expect(result.totalRentWon).toBe(7_800);
  });

  it("reconciles staggered expiries across independent units", () => {
    const result = compareLeaseRoll(setup([
      lease({ id: "a", unitId: "a", areaSqm: 50, endDate: "2024-01-31", depositWon: 100 }),
      lease({ id: "b", unitId: "b", areaSqm: 50, startDate: "2024-01-15", endDate: "2024-02-14", depositWon: 200 }),
    ]));
    expect(result.rows[0]).toMatchObject({ contractRentWon: 4_800, depositInflowWon: 300, depositRefundWon: 0, closingDepositWon: 300 });
    expect(result.rows[1].contractRentWon).toBeCloseTo(3_100 * 14 / 29, 10);
    expect(result.rows[1]).toMatchObject({ depositRefundWon: 300, closingDepositWon: 0 });
  });

  it("includes prior-day expiry in opening liabilities and refunds it on the anchor", () => {
    const result = compareLeaseRoll(setup([
      lease({ id: "old", startDate: "2023-01-01", endDate: "2023-12-31", depositWon: 1_000 }),
      lease({ id: "new", depositWon: 2_000 }),
    ]));
    expect(result.openingDepositWon).toBe(1_000);
    expect(result.rows[0]).toMatchObject({ contractRentWon: 3_100, depositInflowWon: 2_000, depositRefundWon: 1_000, closingDepositWon: 2_000 });
    expect(result.closingDepositWon).toBe(2_000);
  });

  it("includes a lease expiring on the anchor for one day and excludes already-refunded leases", () => {
    const result = compareLeaseRoll(setup([
      lease({ id: "expired", startDate: "2023-01-01", endDate: "2023-12-30", depositWon: 99_000 }),
      lease({ id: "active", startDate: "2023-12-31", endDate: "2024-01-01", depositWon: 1_000 }),
    ]));
    expect(result.openingDepositWon).toBe(1_000);
    expect(result.rows[0]).toMatchObject({ contractRentWon: 100, depositInflowWon: 0, depositRefundWon: 1_000, closingDepositWon: 0 });
  });

  it("carries an existing deposit without receiving it again", () => {
    const result = compareLeaseRoll(setup([lease({ startDate: "2023-01-01" })]));
    expect(result.openingDepositWon).toBe(10_000);
    expect(result.rows.every(row => row.depositInflowWon === 0)).toBe(true);
    expect(result.closingDepositWon).toBe(10_000);
  });

  it.each(["2025-12-31", "2026-06-30"])("keeps deposits restricted when expiry is %s", endDate => {
    const result = compareLeaseRoll(setup([lease({ endDate })]));
    expect(result.rows[23]).toMatchObject({ depositRefundWon: 0, closingDepositWon: 10_000 });
    expect(result.closingDepositWon).toBe(10_000);
    expect(result.issues.join(" ")).toContain("사용이 제한된 부채");
  });

  it("refunds on the last horizon day when expiry is the preceding day", () => {
    const result = compareLeaseRoll(setup([lease({ endDate: "2025-12-30" })]));
    expect(result.rows[23]).toMatchObject({ contractRentWon: 3_000, depositRefundWon: 10_000, closingDepositWon: 0 });
    expect(result.closingDepositWon).toBe(0);
  });

  it("does not accelerate rent or deposits from a contract after the horizon", () => {
    const result = compareLeaseRoll(setup([lease({ startDate: "2026-01-01", endDate: "2027-12-31" })]));
    expect(result.status).toBe("ready");
    expect(result.totalRentWon).toBe(0);
    expect(result.openingDepositWon).toBe(0);
    expect(result.rows.every(row => row.depositInflowWon === 0 && row.depositRefundWon === 0 && row.closingDepositWon === 0)).toBe(true);
  });

  it("accepts the last complete 24-month horizon through December 2199", () => {
    const result = compareLeaseRoll(setup([lease({ startDate: "2198-01-01", endDate: "2199-12-31" })], "2198-01-01"));
    expect(result.status).toBe("ready");
    expect(result.rows[23].month).toBe("2199-12");
    expect(result.closingDepositWon).toBe(10_000);
  });

  it("rejects a horizon that extends into 2200", () => {
    const result = compareLeaseRoll(setup([lease({ startDate: "2198-02-01", endDate: "2199-12-31" })], "2198-02-01"));
    expectUnavailable(result, "conflict");
    expect(result.issues.join(" ")).toContain("2199-12-31");
  });
});

describe("lease-roll comparison validation and areas", () => {
  it.each([null, undefined])("keeps an absent draft (%s) incomplete", draft => {
    expectUnavailable(compareLeaseRoll({ ...setup(), draft }), "incomplete");
  });

  it("requires at least one recorded contract", () => {
    expectUnavailable(compareLeaseRoll(setup([])), "incomplete");
  });

  it("requires the operating calendar anchor", () => {
    const input = setup();
    input.draft.calendarStart = null;
    expectUnavailable(compareLeaseRoll(input), "incomplete");
  });

  it.each(["areaSqm", "monthlyRentWon", "depositWon", "startDate", "endDate", "sourceAsOf"] as const)(
    "keeps required null %s incomplete without zero totals", field => {
      expectUnavailable(compareLeaseRoll(setup([lease({ [field]: null })])), "incomplete");
    },
  );

  it.each(["unitLabel", "sourceName", "sourceRef"] as const)("requires a nonblank %s", field => {
    expectUnavailable(compareLeaseRoll(setup([lease({ [field]: " \t " })])), "incomplete");
  });

  it("treats an omitted amount as missing, never zero", () => {
    const input = setup();
    const { monthlyRentWon: omitted, ...row } = input.draft.rows[0];
    expect(omitted).toBe(3_100);
    expectUnavailable(compareLeaseRoll({ ...input, draft: { ...input.draft, rows: [row] } }), "incomplete");
  });

  it("preserves explicitly recorded zero rent and deposits", () => {
    const result = compareLeaseRoll(setup([lease({ monthlyRentWon: 0, depositWon: 0 })]));
    expect(result.status).toBe("ready");
    expect(result.totalRentWon).toBe(0);
    expect(result.openingDepositWon).toBe(0);
    expect(result.closingDepositWon).toBe(0);
    expect(result.rows.every(row => row.contractRentWon === 0 && row.depositInflowWon === 0 && row.depositRefundWon === 0)).toBe(true);
  });

  it.each([
    ["negative rent", { monthlyRentWon: -1 }],
    ["non-finite rent", { monthlyRentWon: Infinity }],
    ["NaN deposit", { depositWon: NaN }],
    ["excessive deposit", { depositWon: 1e13 + 1 }],
    ["zero area", { areaSqm: 0 }],
    ["excessive area", { areaSqm: 1e6 + 1 }],
    ["invalid leap day", { startDate: "2023-02-29" }],
    ["date before supported range", { startDate: "1899-12-31" }],
    ["date after supported range", { endDate: "2200-01-01" }],
    ["reversed dates", { startDate: "2026-01-01" }],
  ] satisfies Array<[string, Partial<LeaseRollRow>]>) ("rejects %s", (_label, patch) => {
    expectUnavailable(compareLeaseRoll(setup([lease(patch)])), "conflict");
  });

  it.each([
    { version: "lease-roll-other" }, { calendarStart: "2024-01-02" }, { unexpected: true },
  ])("rejects an invalid draft schema %j", patch => {
    const input = setup();
    expectUnavailable(compareLeaseRoll({ ...input, draft: { ...input.draft, ...patch } }), "conflict");
  });

  it("rejects duplicate contract IDs even across different units", () => {
    expectUnavailable(compareLeaseRoll(setup([
      lease({ areaSqm: 50 }), lease({ unitId: "second-unit", areaSqm: 50 }),
    ])), "conflict");
  });

  it("rejects a one-day overlap on the inclusive expiry date", () => {
    expectUnavailable(compareLeaseRoll(setup([
      lease({ id: "first", endDate: "2024-02-01" }),
      lease({ id: "second", startDate: "2024-02-01" }),
    ])), "conflict");
  });

  it.each([{ areaSqm: 99 }, { use: "retail" as const }])("rejects inconsistent sequential-unit attributes %j", patch => {
    expectUnavailable(compareLeaseRoll(setup([
      lease({ id: "first", endDate: "2024-01-31" }),
      lease({ id: "second", startDate: "2024-02-01", ...patch }),
    ])), "conflict");
  });

  it("rejects over-limit row counts before examining their contents", () => {
    const input = setup();
    const rows = Array(MAX_LEASE_ROWS + 1).fill(null);
    expectUnavailable(compareLeaseRoll({ ...input, draft: { ...input.draft, rows } }), "conflict");
  });

  it.each(["residential", "retail", "office"] as const)("rejects area overflow per %s use", use => {
    const scenario = scenarioWithAreas({ residential: 100, retail: 100, office: 100 });
    const result = compareLeaseRoll(setup([lease({ use, areaSqm: 100.000002 })], "2024-01-01", scenario));
    expectUnavailable(result, "conflict");
    expect(result.issues.join(" ")).toContain("계약 면적이 계획안 임대 면적을");
  });

  it("accepts exactly the 1e-6 area tolerance without negative unassigned area", () => {
    const result = compareLeaseRoll(setup([lease({ areaSqm: 100.000001 })]));
    expect(result.status).toBe("ready");
    expect(result.areas[0].unassignedSqm).toBe(0);
  });

  it("allows underfilled area with an explicit issue and no projected rent", () => {
    const result = compareLeaseRoll(setup([lease({ areaSqm: 20 })]));
    expect(result.status).toBe("ready");
    expect(result.areas[0]).toEqual({ use: "residential", expectedSqm: 100, scheduledSqm: 20, unassignedSqm: 80 });
    expect(result.issues.join(" ")).toContain("주거 미배정 임대 면적은 80㎡");
    expect(result.totalRentWon).toBe(74_400);
  });

  it("does not borrow sale area or another use's unassigned area", () => {
    expectUnavailable(compareLeaseRoll(setup([lease({ use: "retail", areaSqm: 1 })])), "conflict");
  });

  it.each([{ projectId: "another-project" }, { scenarioId: "another-scenario" }])("rejects wrong ownership %j", patch => {
    const input = setup();
    Object.assign(input.draft, patch);
    expectUnavailable(compareLeaseRoll(input), "conflict");
  });

  it("rejects a scenario linked to someone else's area contract before rebinding or comparison", () => {
    const input = setup();
    input.scenario.program.areaContract!.sourceScenarioId = "other-scenario";
    expect(() => leaseRollBasis(input.projectId, input.scenario)).toThrow();
    expectUnavailable(compareLeaseRoll(input), "conflict");
  });

  it("requires the scenario area contract", () => {
    const input = setup();
    delete input.scenario.program.areaContract;
    expectUnavailable(compareLeaseRoll(input), "incomplete");
  });

  it("rejects invalid scenario area data", () => {
    const input = setup();
    input.scenario.program.areaContract!.revenueAreas.residentialLeaseSqm = NaN;
    expectUnavailable(compareLeaseRoll(input), "conflict");
  });

  it.each([null, {}, { id: "lease-scenario", program: null }, { id: 12, program: {} }])(
    "fails closed for a malformed scenario %j", scenario => {
      expectUnavailable(compareLeaseRoll({ ...setup(), scenario: scenario as unknown as Scenario }), "conflict");
    },
  );

  it.each([
    { areaContract: "invalid" },
    { areaContract: { sourceScenarioId: "lease-scenario", sourceScenarioVersion: 1, revenueAreas: null } },
    { areaContract: { sourceScenarioId: "lease-scenario", sourceScenarioVersion: -1 } },
    { areaContract: { sourceScenarioId: "lease-scenario", sourceScenarioVersion: Number.MAX_SAFE_INTEGER + 1 } },
  ])("fails closed for malformed area-contract properties %j", patch => {
    const input = setup();
    Object.assign(input.scenario.program, patch);
    expectUnavailable(compareLeaseRoll(input), "conflict");
  });

  it.each(["version", "area", "digest"])("marks changed %s basis stale", change => {
    const input = setup();
    if (change === "version") input.scenario.program.areaContract!.sourceScenarioVersion++;
    if (change === "area") input.scenario.program.areaContract!.revenueAreas.residentialLeaseSqm++;
    if (change === "digest") input.draft.sourceBasis = "0".repeat(64);
    expectUnavailable(compareLeaseRoll(input), "stale");
  });
});

describe("lease-roll comparison baseline, precision and bounds", () => {
  it("matches holdMonth rather than array position or development month and preserves baseline zero", () => {
    const input = setup();
    input.baseline = hold([[2, 0], [0, 999], [25, 999], [1, 0.25], [24, 0.5]], "commitment-feasible", 30);
    const result = compareLeaseRoll(input);
    expect(result.rows[0]).toMatchObject({ baselineRentWon: 2_500, rentDeltaWon: 600 });
    expect(result.rows[1]).toMatchObject({ baselineRentWon: 0, rentDeltaWon: 3_100 });
    expect(result.rows[2]).toMatchObject({ baselineRentWon: null, rentDeltaWon: null });
    expect(result.rows[23]).toMatchObject({ baselineRentWon: 5_000, rentDeltaWon: -1_900 });
  });

  it.each(["modeled-unverified", "refinance-shortfall", "commitment-feasible"] as const)("allows calculated baseline status %s", status => {
    const result = compareLeaseRoll({ ...setup(), baseline: hold([[1, 0.25]], status) });
    expect(result.rows[0].baselineRentWon).toBe(2_500);
    expect(result.approvalStatus).toBe("unverified");
  });

  it.each(["not-applicable", "not-configured", "terms-missing", "terms-invalid"] as const)("ignores baseline rows in uncalculated status %s", status => {
    const result = compareLeaseRoll({ ...setup(), baseline: hold([[1, 0.25]], status) });
    expect(result.status).toBe("ready");
    expect(result.rows.every(row => row.baselineRentWon === null && row.rentDeltaWon === null)).toBe(true);
  });

  it("keeps absent and beyond-length baseline months null", () => {
    const input = setup();
    const absent = compareLeaseRoll(input);
    expect(absent.rows.every(row => row.baselineRentWon === null && row.rentDeltaWon === null)).toBe(true);
    input.baseline = hold([[1, 0]], "commitment-feasible", 1);
    const shorter = compareLeaseRoll(input);
    expect(shorter.rows[0]).toMatchObject({ baselineRentWon: 0, rentDeltaWon: 3_100 });
    expect(shorter.rows.slice(1).every(row => row.baselineRentWon === null && row.rentDeltaWon === null)).toBe(true);
  });

  it("does not use rows beyond the declared baseline hold period", () => {
    const result = compareLeaseRoll({ ...setup(), baseline: hold([[1, 0], [2, 1]], "commitment-feasible", 1) });
    expect(result.rows[1].baselineRentWon).toBeNull();
  });

  it("leaves ambiguous duplicate baseline months unavailable", () => {
    const result = compareLeaseRoll({ ...setup(), baseline: hold([[1, 1], [1, 2], [1, 3], [2, 0]]) });
    expect(result.rows[0]).toMatchObject({ baselineRentWon: null, rentDeltaWon: null });
    expect(result.rows[1].baselineRentWon).toBe(0);
    expect(result.issues.join(" ")).toContain("기준 holdMonth 1이 중복");
  });

  it.each([NaN, Infinity, -1, 1e9 + 1, null, undefined])("does not coerce invalid baseline rent %s to zero", amount => {
    const baseline = hold();
    Object.assign(baseline.rows[1], { effectiveGrossIncome: amount });
    const result = compareLeaseRoll({ ...setup(), baseline });
    expect(result.status).toBe("ready");
    expect(result.rows[0]).toMatchObject({ baselineRentWon: null, rentDeltaWon: null });
  });

  it("bounds baseline aggregate rent without discarding recorded contracts", () => {
    const result = compareLeaseRoll({ ...setup(), baseline: hold([[1, 1e9], [2, 1e9]]) });
    expect(result.status).toBe("ready");
    expect(result.totalRentWon).toBe(74_400);
    expect(result.rows.every(row => row.baselineRentWon === null)).toBe(true);
  });

  it("bounds baseline row processing to the hold engine's supported horizon", () => {
    const baseline = hold();
    baseline.rows = Array(602).fill(baseline.rows[1]);
    const result = compareLeaseRoll({ ...setup(), baseline });
    expect(result.status).toBe("ready");
    expect(result.rows.every(row => row.baselineRentWon === null)).toBe(true);
  });

  it("adds decimal rent, deposits and baseline conversions before converting to numbers", () => {
    const result = compareLeaseRoll({ ...setup([
      lease({ id: "a", unitId: "a", areaSqm: 0.1, monthlyRentWon: 0.1, depositWon: 0.1 }),
      lease({ id: "b", unitId: "b", areaSqm: 0.2, monthlyRentWon: 0.2, depositWon: 0.2 }),
    ], "2024-01-01", scenarioWithAreas({ residential: 0.3 })), baseline: hold([[1, 0.00003]]) });
    expect(result.status).toBe("ready");
    expect(result.areas[0].scheduledSqm).toBe(0.3);
    expect(result.areas[0].unassignedSqm).toBe(0);
    expect(result.rows[0]).toMatchObject({ contractRentWon: 0.3, depositInflowWon: 0.3, closingDepositWon: 0.3, baselineRentWon: 0.3, rentDeltaWon: 0 });
    expect(result.totalRentWon).toBe(7.2);
  });

  it("allows exactly the monetary ceiling for a one-month contract", () => {
    const result = compareLeaseRoll(setup([lease({ monthlyRentWon: 1e13, depositWon: 1e13, endDate: "2024-01-31" })]));
    expect(result.status).toBe("ready");
    expect(result.totalRentWon).toBe(1e13);
    expect(result.rows[1].depositRefundWon).toBe(1e13);
    expect(result.closingDepositWon).toBe(0);
  });

  it("rejects cumulative horizon rent above the monetary ceiling", () => {
    expectUnavailable(compareLeaseRoll(setup([lease({ monthlyRentWon: 5e11 })])), "conflict");
  });

  it.each(["2023-01-01", "2024-01-01"])("bounds aggregate deposits received from %s", startDate => {
    expectUnavailable(compareLeaseRoll(setup([
      lease({ id: "a", unitId: "a", areaSqm: 50, startDate, depositWon: 6e12 }),
      lease({ id: "b", unitId: "b", areaSqm: 50, startDate, depositWon: 6e12 }),
    ])), "conflict");
  });

  it("bounds cumulative deposit turnover even when each closing balance is small enough", () => {
    expectUnavailable(compareLeaseRoll(setup([
      lease({ id: "a", endDate: "2024-01-31", depositWon: 6e12 }),
      lease({ id: "b", startDate: "2024-02-01", endDate: "2024-02-29", depositWon: 6e12 }),
    ])), "conflict");
  });

  it("is deterministic with frozen inputs and independent of recorded contract order", () => {
    const input = setup([
      lease({ id: "a", endDate: "2024-01-31" }),
      lease({ id: "b", startDate: "2024-03-01" }),
    ]);
    input.baseline = hold();
    const snapshot = structuredClone(input);
    freezeDeep(input);
    const result = compareLeaseRoll(input);
    expect(compareLeaseRoll(input)).toEqual(result);
    expect(compareLeaseRoll({ ...input, draft: { ...input.draft, rows: [...input.draft.rows].reverse() } })).toEqual(result);
    expect(input).toEqual(snapshot);
  });
});
