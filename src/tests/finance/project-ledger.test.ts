import { describe, expect, it } from "vitest";
import { buildProjectLedger } from "@/lib/finance/project-ledger";
import { defaultAssumptions, defaultProgram } from "@/lib/finance/scenario";
import type {
  FinancialRevenuePoolAmounts,
  Parcel,
  Scenario,
} from "@/lib/finance/types";

const parcel: Parcel = {
  id: "ledger-test",
  address: "서울 테스트구 테스트동 1-1",
  addressRoad: "서울 테스트구 테스트로 1",
  lotArea: 300,
  zoning: "제2종일반주거지역",
  zoneCode: "UQA122",
  maxFAR: 220,
  maxBCR: 60,
  heightLimit: 30,
  setback: { road: 0, side: 0, rear: 0 },
  landPrice: 2_000_000,
  estMarketPrice: 4_000_000,
  acquired: "2026-01-01",
  acquiredPrice: 50_000,
  demolitionCost: 2_000,
};

function scenarioAtRate(interestRate: number): Scenario {
  const assumptions = defaultAssumptions();
  assumptions.designMonths = 4;
  assumptions.constructionMonths = 12;
  assumptions.saleOutMonths = 3;
  assumptions.interestRate = interestRate;
  assumptions.ltcTarget = 70;
  return {
    id: "LEDGER",
    name: "원장 테스트",
    shortName: "원장",
    program: defaultProgram("multi-family", parcel.maxFAR, parcel.maxBCR),
    assumptions,
  };
}

function build(interestRate = 6, scenario = scenarioAtRate(interestRate)) {
  return buildProjectLedger({
    parcel,
    scenario,
    revenueSale: 130_000,
    revenueExit: 0,
    hardCost: 40_000,
    softCost: 4_800,
    contingency: 2_240,
  });
}

function revenuePools(
  overrides: Partial<FinancialRevenuePoolAmounts>,
): FinancialRevenuePoolAmounts {
  return {
    residentialSale: 0,
    retailSale: 0,
    officeSale: 0,
    residentialLease: 0,
    retailLease: 0,
    officeLease: 0,
    ...overrides,
  };
}

describe("auditable project ledger", () => {
  it("allocates 100% of every project cost", () => {
    const ledger = build();
    const sum = (field: "hardCost" | "softCost" | "contingency") =>
      ledger.rows.reduce((total, row) => total + row[field], 0);

    expect(sum("hardCost")).toBeCloseTo(40_000, 8);
    expect(sum("softCost")).toBeCloseTo(4_800, 8);
    expect(sum("contingency")).toBeCloseTo(2_240, 8);
    expect(ledger.totalProjectOutflow).toBeCloseTo(
      50_000 + 2_000 + 40_000 + 4_800 + 2_240 + ledger.financingCost,
      8
    );
  });

  it("uses the configured timeline and allocates 100% of revenue", () => {
    const ledger = build();
    expect(ledger.rows).toHaveLength(4 + 12 + 3 + 1);
    expect(ledger.totalRevenue).toBeCloseTo(130_000, 8);
  });

  it("collects single-house and multi-family whole-asset sales at exit", () => {
    const ledger = build();
    expect(ledger.revenueCollectionPolicy).toBe("bulk-exit");
    expect(ledger.rows.slice(0, -1).every((row) => row.revenueInflow === 0)).toBe(true);
    expect(ledger.rows.at(-1)?.revenueInflow).toBeCloseTo(130_000, 8);
    expect(ledger.projectBreakEvenMonth).toBe(ledger.rows.at(-1)?.month);
  });

  it("keeps the explicit presale policy for non-bulk residential sales", () => {
    const base = scenarioAtRate(6);
    const presaleScenario: Scenario = {
      ...base,
      program: { ...base.program, type: "officetel" },
    };
    const ledger = build(6, presaleScenario);
    expect(ledger.revenueCollectionPolicy).toBe("presale-10-60-30");
    expect(
      ledger.rows.slice(0, -1).some((row) => row.revenueInflow > 0)
    ).toBe(true);
    expect(ledger.totalRevenue).toBeCloseTo(130_000, 8);
  });

  it("retains early presale surplus inside the project until exit", () => {
    const presaleScenario = scenarioAtRate(6);
    presaleScenario.program = {
      ...presaleScenario.program,
      type: "officetel",
    };
    const ledger = buildProjectLedger({
      parcel,
      scenario: presaleScenario,
      revenueByPool: revenuePools({ residentialSale: 1_000_000 }),
      hardCost: 40_000,
      softCost: 4_800,
      contingency: 2_240,
    });

    expect(
      ledger.rows.slice(0, -1).every((row) => row.equityDistribution === 0),
    ).toBe(true);
    expect(
      ledger.rows.slice(0, -1).some((row) => row.cashReserveBalance > 0),
    ).toBe(true);
    expect(ledger.rows.at(-1)!.equityDistribution).toBeGreaterThan(0);
    expect(ledger.rows.at(-1)!.cashReserveBalance).toBeCloseTo(0, 8);
  });

  it("keeps commercial sale proceeds out of the residential presale schedule", () => {
    const presaleScenario = scenarioAtRate(6);
    presaleScenario.program = {
      ...presaleScenario.program,
      type: "mixed",
    };
    const ledger = buildProjectLedger({
      parcel,
      scenario: presaleScenario,
      revenueByPool: revenuePools({
        residentialSale: 90_000,
        retailSale: 40_000,
      }),
      hardCost: 40_000,
      softCost: 4_800,
      contingency: 2_240,
    });
    const residentialOnly = buildProjectLedger({
      parcel,
      scenario: presaleScenario,
      revenueByPool: revenuePools({ residentialSale: 90_000 }),
      hardCost: 40_000,
      softCost: 4_800,
      contingency: 2_240,
    });
    const finalMonth = ledger.rows.at(-1)!.month;

    expect(ledger.revenueCollectionPolicy).toBe("mixed");
    expect(ledger.revenueStreamPolicies).toMatchObject({
      residentialSale: "presale-10-60-30",
      retailSale: "bulk-exit",
    });
    expect(
      ledger.rows
        .filter((row) => row.month < finalMonth)
        .map((row) => row.revenueInflow),
    ).toEqual(
      residentialOnly.rows
        .filter((row) => row.month < finalMonth)
        .map((row) => row.revenueInflow),
    );
    expect(
      ledger.rows.at(-1)!.revenueInflow -
        residentialOnly.rows.at(-1)!.revenueInflow,
    ).toBeCloseTo(40_000, 8);
  });

  it("sizes retained-lease refinancing after sale cash and reserves reduce PF", () => {
    const mixedScenario = scenarioAtRate(6);
    mixedScenario.program = {
      ...mixedScenario.program,
      type: "mixed",
    };
    mixedScenario.assumptions.leaseUpMonths = 2;
    mixedScenario.assumptions.saleOutMonths = 8;
    const leaseValue = 130_000;
    const ledger = buildProjectLedger({
      parcel,
      scenario: mixedScenario,
      revenueByPool: revenuePools({
        residentialSale: 30_000,
        retailLease: leaseValue,
      }),
      hardCost: 40_000,
      softCost: 4_800,
      contingency: 2_240,
    });
    const finalRow = ledger.rows.at(-1)!;
    const priorReserve = ledger.rows.at(-2)?.cashReserveBalance ?? 0;
    const finalSaleRevenue = Math.max(
      0,
      finalRow.revenueInflow - leaseValue,
    );
    const expectedResidualPf = Math.max(
      0,
      finalRow.pfBalanceBeforeRepayment - priorReserve - finalSaleRevenue,
    );

    expect(ledger.revenueCollectionPolicy).toBe("mixed");
    expect(ledger.pfBalanceAtRetainedLeaseRefinance).toBeCloseTo(
      expectedResidualPf,
      8,
    );
    expect(ledger.pfBalanceAtRetainedLeaseRefinance).toBeLessThanOrEqual(
      finalRow.pfBalanceBeforeRepayment,
    );
  });

  it("repays PF completely by the final month", () => {
    const ledger = build();
    expect(ledger.maxPfBalance).toBeGreaterThan(0);
    expect(ledger.rows.at(-1)?.pfBalance).toBeCloseTo(0, 8);
  });

  it("higher PF rate increases financing cost", () => {
    expect(build(9).financingCost).toBeGreaterThan(build(4).financingCost);
  });

  it("equity cash flows reconcile to project profit", () => {
    const ledger = build();
    const equityProfit = ledger.equityCashFlows.reduce(
      (sum, value) => sum + value,
      0
    );
    expect(equityProfit).toBeCloseTo(
      ledger.totalRevenue - ledger.totalProjectOutflow,
      8
    );
  });

  it("uses monthly sales pace as the minimum presale collection horizon", () => {
    const fast = scenarioAtRate(6);
    fast.program = { ...fast.program, type: "officetel" };
    fast.assumptions.saleOutMonths = 3;
    fast.assumptions.salesPaceMonthlyPct = 25;

    const slow = scenarioAtRate(6);
    slow.program = { ...slow.program, type: "officetel" };
    slow.assumptions.saleOutMonths = 3;
    slow.assumptions.salesPaceMonthlyPct = 5;

    const fastLedger = build(6, fast);
    const slowLedger = build(6, slow);

    expect(fastLedger.rows).toHaveLength(4 + 12 + 4 + 1);
    expect(slowLedger.rows).toHaveLength(4 + 12 + 20 + 1);
    expect(slowLedger.totalRevenue).toBeCloseTo(fastLedger.totalRevenue, 8);
    expect(
      slowLedger.warnings.some((warning) => warning.includes("최소 20개월")),
    ).toBe(true);
  });

  it("delays lease exit value until the configured lease-up period", () => {
    const fast = scenarioAtRate(6);
    fast.program = {
      ...fast.program,
      type: "retail",
      mix: { residentialSale: 0, residentialLease: 0, retail: 1 },
    };
    fast.assumptions.saleOutMonths = 3;
    fast.assumptions.leaseUpMonths = 4;

    const slow = {
      ...fast,
      assumptions: { ...fast.assumptions, leaseUpMonths: 18 },
    };

    const buildLease = (leaseScenario: Scenario) =>
      buildProjectLedger({
        parcel,
        scenario: leaseScenario,
        revenueSale: 0,
        revenueExit: 130_000,
        hardCost: 40_000,
        softCost: 4_800,
        contingency: 2_240,
      });

    const fastLedger = buildLease(fast);
    const slowLedger = buildLease(slow);

    expect(fastLedger.rows).toHaveLength(4 + 12 + 4 + 1);
    expect(slowLedger.rows).toHaveLength(4 + 12 + 18 + 1);
    expect(slowLedger.financingCost).toBeGreaterThan(
      fastLedger.financingCost,
    );
    const stabilizationRow = fastLedger.rows.find(
      (row) => row.month === fastLedger.leaseStabilizationMonth,
    );
    expect(fastLedger.leaseStabilizationMonth).toBe(20);
    expect(stabilizationRow?.pfBalanceBeforeRepayment).toBeGreaterThan(0);
    expect(fastLedger.pfBalanceAtLeaseStabilization).toBeCloseTo(
      stabilizationRow?.pfBalanceBeforeRepayment ?? 0,
      8,
    );
    expect(stabilizationRow?.pfBalance).toBeCloseTo(0, 8);
  });

  it("ignores the sale-out duration when an all-lease case has no sale proceeds", () => {
    const leaseScenario = scenarioAtRate(6);
    leaseScenario.program = {
      ...leaseScenario.program,
      type: "retail",
      mix: { residentialSale: 0, residentialLease: 0, retail: 1 },
    };
    leaseScenario.assumptions.saleOutMonths = 24;
    leaseScenario.assumptions.leaseUpMonths = 4;

    const ledger = buildProjectLedger({
      parcel,
      scenario: leaseScenario,
      revenueByPool: revenuePools({ retailLease: 130_000 }),
      hardCost: 40_000,
      softCost: 4_800,
      contingency: 2_240,
    });

    expect(ledger.leaseStabilizationMonth).toBe(20);
    expect(ledger.rows).toHaveLength(21);
    expect(ledger.rows.at(-1)?.revenueInflow).toBeCloseTo(130_000, 8);
  });

  it("allocates explicit acquisition, relocation, PF and trust costs without dropping them", () => {
    const inputScenario = scenarioAtRate(6);
    inputScenario.assumptions = {
      ...inputScenario.assumptions,
      acquisitionTaxManwon: 1_000,
      acquisitionOtherCostManwon: 500,
      tenantRelocationCostManwon: 750,
      pfUpfrontFeeRate: 2,
      trustFeeManwon: 400,
    };
    const ledger = build(6, inputScenario);
    const sum = (field: keyof (typeof ledger.rows)[number]) =>
      ledger.rows.reduce((total, row) => {
        const value = row[field];
        return total + (typeof value === "number" ? value : 0);
      }, 0);
    const expectedPfFee = (40_000 + 4_800 + 2_240) * 0.7 * 0.02;

    expect(sum("acquisitionTax")).toBeCloseTo(1_000, 8);
    expect(sum("acquisitionOtherCost")).toBeCloseTo(500, 8);
    expect(sum("tenantRelocationCost")).toBeCloseTo(750, 8);
    expect(sum("pfFee")).toBeCloseTo(expectedPfFee, 8);
    expect(sum("trustFee")).toBeCloseTo(400, 8);
    expect(ledger.additionalCosts).toMatchObject({
      acquisitionTax: 1_000,
      acquisitionOtherCost: 500,
      tenantRelocationCost: 750,
      trustFee: 400,
    });
    expect(ledger.additionalCosts.pfFee).toBeCloseTo(expectedPfFee, 8);
    expect(ledger.totalProjectOutflow).toBeCloseTo(
      50_000 +
        2_000 +
        40_000 +
        4_800 +
        2_240 +
        1_000 +
        500 +
        750 +
        expectedPfFee +
        400 +
        ledger.interestCost,
      8,
    );
  });

  it("reports unverified, sufficient and breached equity commitments explicitly", () => {
    const unverified = build();
    expect(unverified.funding.status).toBe("unverified");
    expect(unverified.funding.equityCommitmentManwon).toBeNull();

    const lowCommitment = scenarioAtRate(6);
    lowCommitment.assumptions.equityCommitmentManwon = 10_000;
    const breached = build(6, lowCommitment);
    expect(breached.funding.status).toBe("shortfall");
    expect(breached.funding.shortfallManwon).toBeGreaterThan(0);
    expect(breached.funding.firstShortfallMonth).not.toBeNull();

    const highCommitment = scenarioAtRate(6);
    highCommitment.assumptions.equityCommitmentManwon = 200_000;
    const funded = build(6, highCommitment);
    expect(funded.funding.status).toBe("funded");
    expect(funded.funding.shortfallManwon).toBe(0);
    expect(funded.funding.requiredEquityManwon).toBeCloseTo(
      unverified.equityInvested,
      8,
    );
  });

  it("rejects impossible financial inputs instead of silently clamping them", () => {
    const invalid = scenarioAtRate(6);
    invalid.assumptions.salesPaceMonthlyPct = 0;
    expect(() => build(6, invalid)).toThrow("월 분양 속도");
  });
});
