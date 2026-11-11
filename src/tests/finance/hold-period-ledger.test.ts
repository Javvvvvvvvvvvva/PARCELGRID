import { describe, expect, it } from "vitest";
import {
  buildHoldPeriodLedger,
  type HoldPeriodLedgerInput,
  type HoldPeriodTerms,
} from "@/lib/finance/hold-period-ledger";
import {
  underwriteTakeoutLoan,
  type TakeoutUnderwritingTerms,
} from "@/lib/finance/takeout-underwriting";

const baseTerms: HoldPeriodTerms = {
  holdPeriodYears: 5,
  annualRentGrowthRatePct: 2,
  annualExpenseGrowthRatePct: 2,
  rentFreeMonths: 0,
  tenantImprovementPerSqMWon: 0,
  leasingCommissionRatePct: 0,
  securityDepositMonths: 3,
  tenantLeaseTermMonths: 120,
  tenantRenewalProbabilityPct: 100,
  renewalRentAdjustmentRatePct: 0,
  renewalRentFreeMonths: 0,
  replacementDowntimeMonths: 0,
  replacementRentFreeMonths: 0,
  replacementTenantImprovementPerSqMWon: 0,
  replacementLeasingCommissionRatePct: 0,
  replacementReservePerSqMYearWon: 0,
  majorRepairYear: 0,
  majorRepairCostManwon: 0,
  exitCapRatePct: 5.5,
  exitSellingCostRatePct: 1,
};

function takeout(
  commitmentManwon = 100_000,
  termOverrides: Partial<TakeoutUnderwritingTerms> = {},
) {
  return underwriteTakeoutLoan({
    stabilizedValueManwon: 200_000,
    stabilizedNoiManwon: 15_000,
    pfBalanceToRefinanceManwon: 80_000,
    terms: {
      maxLtvPct: 60,
      annualInterestRatePct: 5,
      amortizationYears: 30,
      loanTermYears: 30,
      paymentDeferralMonths: 0,
      interestOnlyMonths: 0,
      rateResetMonths: 0,
      annualRateChangePct: 0,
      rateFloorPct: 0,
      rateCapPct: 0,
      dsraMonths: 0,
      minimumDscr: 1.25,
      loanCommitmentManwon: commitmentManwon,
      upfrontFeeRatePct: 1,
      ...termOverrides,
    },
  });
}

function input(
  termOverrides: Partial<HoldPeriodTerms> = {},
  inputOverrides: Partial<HoldPeriodLedgerInput> = {},
): HoldPeriodLedgerInput {
  return {
    developmentEquityCashFlowsManwon: [-100_000, 0, 180_000],
    saleRevenueManwon: 0,
    capitalizedLeaseValueManwon: 200_000,
    stabilizedAnnualPotentialRentManwon: 20_000,
    stabilizedAnnualOperatingExpenseManwon: 4_000,
    stabilizedAnnualNoiManwon: 15_000,
    leaseAreaSqm: 1_000,
    vacancyRatePct: 5,
    equityHurdleRatePct: 12,
    takeout: takeout(),
    terms: { ...baseTerms, ...termOverrides },
    ...inputOverrides,
  };
}

describe("hold-period ledger", () => {
  it("replaces the stabilization sale with refinancing and appends monthly hold operations", () => {
    const source = input();
    const originalCashFlows = [...source.developmentEquityCashFlowsManwon];
    const result = buildHoldPeriodLedger(source);

    expect(result.modelVersion).toBe("hold-period-ledger-2026.4");
    expect(result.status).toBe("commitment-feasible");
    expect(result.holdMonths).toBe(60);
    expect(result.rows).toHaveLength(61);
    expect(result.combinedEquityCashFlowsManwon).toHaveLength(63);
    expect(result.combinedEquityCashFlowsManwon[2]).toBeCloseTo(79_000, 6);
    expect(result.rows[0]).toMatchObject({
      phase: "refinance",
      holdMonth: 0,
      loanDraw: 100_000,
      takeoutFee: 1_000,
      pfRepayment: 80_000,
    });
    expect(result.profitManwon).not.toBeNull();
    expect(result.npvManwon).not.toBeNull();
    expect(source.developmentEquityCashFlowsManwon).toEqual(originalCashFlows);
  });

  it("fully reconciles permanent-loan principal and restricted deposits at exit", () => {
    const result = buildHoldPeriodLedger(input());
    const principalPaid = result.rows.reduce(
      (total, row) => total + row.debtPrincipal,
      0,
    );
    const final = result.rows.at(-1)!;

    expect(principalPaid + final.loanPayoff).toBeCloseTo(100_000, 6);
    expect(final.takeoutBalance).toBe(0);
    expect(result.rows[0].securityDepositInflow).toBeCloseTo(4_750, 6);
    expect(final.securityDepositRefund).toBeCloseTo(4_750, 6);
    expect(final.restrictedDepositBalance).toBe(0);

    const noDeposit = buildHoldPeriodLedger(
      input({ securityDepositMonths: 0 }),
    );
    expect(result.profitManwon).toBeCloseTo(noDeposit.profitManwon ?? 0, 6);
    expect(result.npvManwon).toBeCloseTo(noDeposit.npvManwon ?? 0, 6);
  });

  it("reduces returns for concessions, TI, leasing costs, reserves, and repairs", () => {
    const clean = buildHoldPeriodLedger(input());
    const burdened = buildHoldPeriodLedger(
      input({
        rentFreeMonths: 6,
        tenantImprovementPerSqMWon: 100_000,
        leasingCommissionRatePct: 5,
        replacementReservePerSqMYearWon: 5_000,
        majorRepairYear: 3,
        majorRepairCostManwon: 5_000,
      }),
    );

    expect(burdened.totalRentFreeConcessionManwon).toBeGreaterThan(0);
    expect(burdened.initialTenantImprovementManwon).toBe(10_000);
    expect(burdened.initialLeasingCommissionManwon).toBe(950);
    expect(burdened.totalReplacementReserveManwon).toBeGreaterThan(0);
    expect(burdened.totalMajorRepairManwon).toBe(5_000);
    expect(burdened.profitManwon ?? 0).toBeLessThan(clean.profitManwon ?? 0);
    expect(burdened.npvManwon ?? 0).toBeLessThan(clean.npvManwon ?? 0);
  });

  it("raises exit value when the exit cap rate falls", () => {
    const lowerCap = buildHoldPeriodLedger(input({ exitCapRatePct: 4.5 }));
    const higherCap = buildHoldPeriodLedger(input({ exitCapRatePct: 6.5 }));

    expect(lowerCap.exitSaleGrossManwon ?? 0).toBeGreaterThan(
      higherCap.exitSaleGrossManwon ?? 0,
    );
  });

  it("flags a refinance shortfall, supports mixed revenue, and rejects incomplete hold cases", () => {
    const shortfall = buildHoldPeriodLedger(
      input({}, { takeout: takeout(50_000) }),
    );
    const mixed = buildHoldPeriodLedger(input({}, { saleRevenueManwon: 1 }));
    const missingExit = buildHoldPeriodLedger(input({ exitCapRatePct: 0 }));
    const invalid = buildHoldPeriodLedger(input({ holdPeriodYears: 51 }));

    expect(shortfall.status).toBe("refinance-shortfall");
    expect(shortfall.rows[0].refinanceShortfall).toBeGreaterThan(0);
    expect(mixed.status).toBe("commitment-feasible");
    expect(mixed.strategyMode).toBe("mixed-sale-lease");
    expect(mixed.developmentSaleRevenueManwon).toBe(1);
    expect(missingExit.status).toBe("terms-missing");
    expect(missingExit.missingTerms).toEqual(["exitCapRatePct"]);
    expect(invalid.status).toBe("terms-invalid");
  });

  it("carries deferral, IO, variable rates, and a mid-hold balloon into the ledger", () => {
    const advancedTakeout = takeout(100_000, {
      loanTermYears: 3,
      paymentDeferralMonths: 6,
      interestOnlyMonths: 6,
      rateResetMonths: 12,
      annualRateChangePct: 1,
      rateFloorPct: 4,
      rateCapPct: 7,
      dsraMonths: 6,
    });
    const result = buildHoldPeriodLedger(
      input({}, { takeout: advancedTakeout }),
    );

    expect(result.rows[1].debtCapitalizedInterest).toBeGreaterThan(0);
    expect(result.rows[1].debtService).toBe(0);
    expect(result.rows[7].debtInterest).toBeGreaterThan(0);
    expect(result.rows[7].debtPrincipal).toBe(0);
    expect(result.rows[13].debtPrincipal).toBeGreaterThan(0);
    expect(result.rows[25].debtAnnualRatePct).toBe(7);
    expect(result.balloonPaymentMonth).toBe(36);
    expect(result.totalTakeoutBalloonManwon ?? 0).toBeGreaterThan(0);
    expect(result.totalTakeoutCapitalizedInterestManwon ?? 0).toBeGreaterThan(
      0,
    );
    expect(result.rows[36].takeoutBalance).toBe(0);
    expect(result.rows[36].dsraRelease).toBeGreaterThan(0);

    const totalPrincipalPaid =
      (result.totalTakeoutScheduledPrincipalManwon ?? 0) +
      (result.totalTakeoutBalloonManwon ?? 0) +
      (result.exitLoanPayoffManwon ?? 0);
    expect(totalPrincipalPaid).toBeCloseTo(
      (advancedTakeout.modeledLoanManwon ?? 0) +
        (result.totalTakeoutCapitalizedInterestManwon ?? 0),
      5,
    );
  });

  it("uses DSRA only for periodic debt-service gaps and replenishes it from surplus", () => {
    const result = buildHoldPeriodLedger(
      input(
        { rentFreeMonths: 6 },
        { takeout: takeout(100_000, { dsraMonths: 6 }) },
      ),
    );

    expect(result.initialDsraManwon ?? 0).toBeGreaterThan(0);
    expect(result.totalDsraDrawManwon ?? 0).toBeGreaterThan(0);
    expect(result.totalDsraFundingManwon ?? 0).toBeGreaterThan(
      result.initialDsraManwon ?? 0,
    );
    expect(result.totalDsraReleaseManwon ?? 0).toBeGreaterThan(0);
    expect(result.rows.at(-1)?.dsraBalance).toBe(0);
  });

  it("charges negative take-out closing cash flow to equity instead of clamping it", () => {
    const burdenedTakeout = takeout(80_000, {
      upfrontFeeRatePct: 100,
      dsraMonths: 24,
    });
    const result = buildHoldPeriodLedger(
      input({}, { takeout: burdenedTakeout }),
    );
    const expectedClosingCashFlow =
      180_000 -
      200_000 +
      (burdenedTakeout.netTakeoutCashFlowManwon ?? 0);

    expect(burdenedTakeout.netTakeoutCashFlowManwon ?? 0).toBeLessThan(0);
    expect(result.rows[0].equityCashFlow).toBeCloseTo(
      expectedClosingCashFlow,
      6,
    );
    expect(result.rows[0].equityCashFlow).toBeLessThan(-20_000);
  });

  it("models renewal and replacement vacancy, concessions, TI, and commission at each lease expiry", () => {
    const clean = buildHoldPeriodLedger(
      input({
        tenantLeaseTermMonths: 24,
        tenantRenewalProbabilityPct: 100,
      }),
    );
    const rollover = buildHoldPeriodLedger(
      input({
        tenantLeaseTermMonths: 24,
        tenantRenewalProbabilityPct: 40,
        renewalRentAdjustmentRatePct: -5,
        renewalRentFreeMonths: 1,
        replacementDowntimeMonths: 3,
        replacementRentFreeMonths: 2,
        replacementTenantImprovementPerSqMWon: 100_000,
        replacementLeasingCommissionRatePct: 5,
      }),
    );

    expect(rollover.tenantRolloverEvents).toHaveLength(2);
    expect(rollover.tenantRolloverEvents[0]).toMatchObject({
      cycle: 1,
      holdMonth: 25,
      renewalSharePct: 40,
      replacementSharePct: 60,
    });
    expect(rollover.rows[25].tenantRolloverEvent).toBe(true);
    expect(rollover.rows[25].rolloverDowntimeLoss).toBeGreaterThan(0);
    expect(rollover.rows[25].renewalRentFreeConcession).toBeGreaterThan(0);
    expect(rollover.rows[25].tenantImprovement).toBeCloseTo(6_000, 6);
    expect(rollover.rows[25].securityDepositRefund).toBeGreaterThan(0);
    expect(rollover.rows[28].replacementRentFreeConcession).toBeGreaterThan(0);
    expect(rollover.rows[28].securityDepositInflow).toBeGreaterThan(0);
    expect(rollover.totalRolloverDowntimeLossManwon ?? 0).toBeGreaterThan(0);
    expect(
      rollover.totalReplacementTenantImprovementManwon ?? 0,
    ).toBeCloseTo(12_000, 6);
    expect(
      rollover.totalReplacementLeasingCommissionManwon ?? 0,
    ).toBeGreaterThan(0);
    expect(rollover.maximumSecurityDepositManwon ?? 0).toBeGreaterThan(0);
    expect(rollover.rows.at(-1)?.restrictedDepositBalance).toBe(0);
    expect(rollover.profitManwon ?? 0).toBeLessThan(clean.profitManwon ?? 0);
    expect(rollover.npvManwon ?? 0).toBeLessThan(clean.npvManwon ?? 0);
  });

  it("requires a lease term and rejects rollover periods that overlap the next expiry", () => {
    const missing = buildHoldPeriodLedger(
      input({ tenantLeaseTermMonths: 0 }),
    );
    const invalid = buildHoldPeriodLedger(
      input({
        tenantLeaseTermMonths: 12,
        tenantRenewalProbabilityPct: 50,
        replacementDowntimeMonths: 8,
        replacementRentFreeMonths: 4,
      }),
    );

    expect(missing.status).toBe("terms-missing");
    expect(missing.missingTerms).toContain("tenantLeaseTermMonths");
    expect(invalid.status).toBe("terms-invalid");
    expect(invalid.invalidTerms.join(" ")).toContain("임대차 기간보다 짧아야");
  });

  it("does not use DSRA to fund rollover TI when NOI already covers debt service", () => {
    const result = buildHoldPeriodLedger(
      input(
        {
          tenantLeaseTermMonths: 24,
          tenantRenewalProbabilityPct: 50,
          replacementTenantImprovementPerSqMWon: 500_000,
        },
        { takeout: takeout(100_000, { dsraMonths: 6 }) },
      ),
    );
    const rolloverMonth = result.rows[25];

    expect(rolloverMonth.tenantImprovement).toBeGreaterThan(0);
    expect(rolloverMonth.noi).toBeGreaterThan(rolloverMonth.debtService);
    expect(rolloverMonth.equityCashFlow).toBeLessThan(0);
    expect(rolloverMonth.dsraDraw).toBe(0);
  });
});

describe("hold-period input validation", () => {
  const source = input();
  const malformedNumbers = [NaN, Infinity, -Infinity, null, undefined, "1"];

  function expectInvalid(overrides: Record<string, unknown>, field: string) {
    const result = buildHoldPeriodLedger({
      ...source,
      ...overrides,
    } as HoldPeriodLedgerInput);
    expect(result.status).toBe("terms-invalid");
    expect(result.invalidTerms.join(" ")).toContain(field);
    expect(result.rows).toEqual([]);
    expect(result.combinedEquityCashFlowsManwon).toEqual([]);
    expect(result.profitManwon).toBeNull();
    expect(result.npvManwon).toBeNull();
    expect(result.irrPct).toBeNull();
  }

  it.each([
    "saleRevenueManwon",
    "capitalizedLeaseValueManwon",
    "stabilizedAnnualPotentialRentManwon",
    "stabilizedAnnualOperatingExpenseManwon",
    "leaseAreaSqm",
  ])("rejects malformed or negative %s without substituting zero", (field) => {
    for (const value of [...malformedNumbers, -1]) {
      expectInvalid({ [field]: value }, field);
    }
  });

  it("rejects malformed NOI but retains nonpositive NOI as non-applicable", () => {
    for (const value of malformedNumbers) {
      expectInvalid(
        { stabilizedAnnualNoiManwon: value },
        "stabilizedAnnualNoiManwon",
      );
    }
    for (const value of [0, -1_000]) {
      const result = buildHoldPeriodLedger({
        ...source,
        stabilizedAnnualNoiManwon: value,
      });
      expect(result.status).toBe("not-applicable");
      expect(result.invalidTerms).toEqual([]);
      expect(result.profitManwon).toBeNull();
    }
  });

  it("rejects invalid vacancy and discount rates without clamping", () => {
    for (const value of [...malformedNumbers, -1, 101]) {
      expectInvalid({ vacancyRatePct: value }, "vacancyRatePct");
    }
    for (const value of [...malformedNumbers, -100, -101]) {
      expectInvalid({ equityHurdleRatePct: value }, "equityHurdleRatePct");
    }
  });

  it.each([0, 1, 2])("rejects malformed cash flows at index %s", (index) => {
    for (const value of malformedNumbers) {
      const flows: unknown[] = [-100_000, 0, 180_000];
      flows[index] = value;
      expectInvalid(
        { developmentEquityCashFlowsManwon: flows },
        `developmentEquityCashFlowsManwon[${index}]`,
      );
    }
    const sparse = [-100_000, 0, 180_000];
    delete sparse[index];
    expectInvalid(
      { developmentEquityCashFlowsManwon: sparse },
      `developmentEquityCashFlowsManwon[${index}]`,
    );
  });

  it("rejects missing, non-array, or empty development cash flows", () => {
    for (const value of [null, undefined, {}, "100", []]) {
      expectInvalid(
        { developmentEquityCashFlowsManwon: value },
        "developmentEquityCashFlowsManwon",
      );
    }
  });

  it.each([
    "modeledLoanManwon",
    "netTakeoutProceedsManwon",
    "upfrontFeeManwon",
    "dsraRequiredBalanceManwon",
    "pfBalanceToRefinanceManwon",
    "refinanceShortfallManwon",
  ])("rejects invalid consumed takeout amount %s", (field) => {
    for (const value of [...malformedNumbers, -1]) {
      expectInvalid(
        { takeout: { ...source.takeout, [field]: value } },
        `takeout.${field}`,
      );
    }
  });

  it("requires the signed takeout closing cash flow instead of falling back to proceeds", () => {
    for (const value of malformedNumbers) {
      expectInvalid(
        { takeout: { ...source.takeout, netTakeoutCashFlowManwon: value } },
        "takeout.netTakeoutCashFlowManwon",
      );
    }
  });

  it.each([
    "annualInterestRatePct",
    "amortizationYears",
    "loanTermYears",
    "paymentDeferralMonths",
    "interestOnlyMonths",
    "rateResetMonths",
    "annualRateChangePct",
    "rateFloorPct",
    "rateCapPct",
  ])("rejects malformed consumed takeout term %s", (field) => {
    for (const value of malformedNumbers) {
      expectInvalid(
        {
          takeout: {
            ...source.takeout,
            terms: { ...source.takeout.terms, [field]: value },
          },
        },
        `takeout.terms.${field}`,
      );
    }
  });

  it.each([
    ["annualInterestRatePct", -1],
    ["annualInterestRatePct", 101],
    ["amortizationYears", 0],
    ["amortizationYears", 1.5],
    ["amortizationYears", 51],
    ["loanTermYears", 0],
    ["loanTermYears", 1.5],
    ["loanTermYears", 51],
    ["paymentDeferralMonths", -1],
    ["paymentDeferralMonths", 0.5],
    ["paymentDeferralMonths", 121],
    ["interestOnlyMonths", -1],
    ["interestOnlyMonths", 0.5],
    ["interestOnlyMonths", 601],
    ["rateResetMonths", -1],
    ["rateResetMonths", 0.5],
    ["rateResetMonths", 121],
    ["annualRateChangePct", -21],
    ["annualRateChangePct", 21],
    ["rateFloorPct", -1],
    ["rateCapPct", 101],
  ])("rejects takeout term %s outside its existing domain: %s", (field, value) => {
    expectInvalid(
      {
        takeout: {
          ...source.takeout,
          terms: { ...source.takeout.terms, [field]: value },
        },
      },
      `takeout.terms.${field}`,
    );
  });

  it("rejects takeout schedule period and rate contradictions", () => {
    for (const terms of [
      { loanTermYears: 1, paymentDeferralMonths: 12 },
      { loanTermYears: 1, paymentDeferralMonths: 6, interestOnlyMonths: 7 },
      { rateFloorPct: 6, rateCapPct: 5 },
    ]) {
      expectInvalid(
        {
          takeout: {
            ...source.takeout,
            terms: { ...source.takeout.terms, ...terms },
          },
        },
        "takeout.terms",
      );
    }
  });

  it("refuses absent or invalid takeout objects and terms", () => {
    for (const value of [null, undefined, {}]) {
      expectInvalid({ takeout: value }, "takeout");
      expectInvalid(
        { takeout: { ...source.takeout, terms: value } },
        "takeout.terms",
      );
    }
    expectInvalid(
      { takeout: { ...source.takeout, status: "unknown" } },
      "takeout.status",
    );
    const invalidTakeout = takeout(100_000, { rateFloorPct: 6, rateCapPct: 5 });
    const result = buildHoldPeriodLedger({ ...source, takeout: invalidTakeout });
    expect(result.status).toBe("terms-invalid");
    expect(result.invalidTerms.length).toBeGreaterThan(0);
    const missingTakeout = takeout(100_000, { loanTermYears: 0 });
    expect(
      buildHoldPeriodLedger({ ...source, takeout: missingTakeout }).status,
    ).toBe("terms-missing");
  });

  it("refuses missing hold terms", () => {
    for (const terms of [null, undefined]) {
      expectInvalid({ terms }, "terms");
    }
  });

  it("keeps disabled and non-applicable cases independent of unused inputs", () => {
    const unused = {
      takeout: null,
      developmentEquityCashFlowsManwon: null,
      leaseAreaSqm: NaN,
    };
    const disabled = buildHoldPeriodLedger({
      ...source,
      ...unused,
      terms: { ...source.terms, holdPeriodYears: 0 },
    } as unknown as HoldPeriodLedgerInput);
    const noLease = buildHoldPeriodLedger({
      ...source,
      ...unused,
      capitalizedLeaseValueManwon: 0,
    } as unknown as HoldPeriodLedgerInput);
    expect(disabled.status).toBe("not-configured");
    expect(noLease.status).toBe("not-applicable");
  });

  it("preserves explicit zero inputs, negative monthly NOI, and a negative valid hurdle", () => {
    const result = buildHoldPeriodLedger({
      ...source,
      saleRevenueManwon: 0,
      leaseAreaSqm: 0,
      stabilizedAnnualPotentialRentManwon: 0,
      vacancyRatePct: 100,
      equityHurdleRatePct: -5,
    });
    expect(result.status).toBe("commitment-feasible");
    expect(result.rows[1].noi).toBeLessThan(0);
    expect(Number.isFinite(result.npvManwon)).toBe(true);
  });

  it("rejects non-finite derived output from finite extreme rent", () => {
    expectInvalid(
      { stabilizedAnnualPotentialRentManwon: Number.MAX_VALUE },
      "계산 결과",
    );
  });

  it("keeps exact decimal break-even at the correct development month", () => {
    const flows = [-0.1, -0.2, 0.3, 101_000];
    const result = buildHoldPeriodLedger({
      ...source,
      developmentEquityCashFlowsManwon: flows,
    });
    expect(result.rows[0].equityCashFlow).toBe(0);
    expect(result.rows[0].cumulativeEquityCashFlow).toBe(0);
    expect(result.paybackMonth).toBe(2);
    expect(flows).toEqual([-0.1, -0.2, 0.3, 101_000]);
  });
});
