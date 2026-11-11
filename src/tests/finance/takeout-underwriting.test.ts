import { describe, expect, it } from "vitest";
import {
  buildTakeoutDebtSchedule,
  underwriteTakeoutLoan,
} from "@/lib/finance/takeout-underwriting";

const completeTerms = {
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
  loanCommitmentManwon: 0,
  upfrontFeeRatePct: 1,
};

describe("take-out underwriting", () => {
  it("is not applicable without both stabilized value and NOI", () => {
    const result = underwriteTakeoutLoan({
      stabilizedValueManwon: 200_000,
      stabilizedNoiManwon: 0,
      pfBalanceToRefinanceManwon: 80_000,
      terms: completeTerms,
    });

    expect(result.status).toBe("not-applicable");
    expect(result.dscr).toBeNull();
    expect(result.modeledLoanManwon).toBeNull();
  });

  it("does not fabricate a DSCR when material loan terms are missing", () => {
    const result = underwriteTakeoutLoan({
      stabilizedValueManwon: 200_000,
      stabilizedNoiManwon: 15_000,
      pfBalanceToRefinanceManwon: 80_000,
      terms: { ...completeTerms, annualInterestRatePct: 0, minimumDscr: 0 },
    });

    expect(result.status).toBe("terms-missing");
    expect(result.missingTerms).toEqual([
      "annualInterestRatePct",
      "minimumDscr",
    ]);
    expect(result.annualDebtServiceManwon).toBeNull();
  });

  it("uses the lower of LTV and amortizing DSCR limits", () => {
    const ltvBound = underwriteTakeoutLoan({
      stabilizedValueManwon: 200_000,
      stabilizedNoiManwon: 15_000,
      pfBalanceToRefinanceManwon: 100_000,
      terms: completeTerms,
    });
    const dscrBound = underwriteTakeoutLoan({
      stabilizedValueManwon: 500_000,
      stabilizedNoiManwon: 10_000,
      pfBalanceToRefinanceManwon: 80_000,
      terms: {
        ...completeTerms,
        maxLtvPct: 70,
        annualInterestRatePct: 6,
        amortizationYears: 20,
        minimumDscr: 1.3,
        upfrontFeeRatePct: 0,
      },
    });

    expect(ltvBound.status).toBe("modeled-unverified");
    expect(ltvBound.modeledLoanManwon).toBeCloseTo(120_000, 6);
    expect(ltvBound.bindingConstraints).toEqual(["ltv"]);
    expect(ltvBound.ltvPct).toBeCloseTo(60, 8);
    expect(ltvBound.netTakeoutProceedsManwon).toBeCloseTo(118_800, 6);
    expect(ltvBound.refinanceSurplusManwon).toBeCloseTo(18_800, 6);

    expect(dscrBound.bindingConstraints).toEqual(["dscr"]);
    expect(dscrBound.modeledLoanManwon).toBeLessThan(
      dscrBound.ltvLimitManwon ?? 0,
    );
    expect(dscrBound.dscr).toBeCloseTo(1.3, 8);
  });

  it("caps the model at a commitment and reports the net refinance gap", () => {
    const result = underwriteTakeoutLoan({
      stabilizedValueManwon: 200_000,
      stabilizedNoiManwon: 15_000,
      pfBalanceToRefinanceManwon: 90_000,
      terms: {
        ...completeTerms,
        loanCommitmentManwon: 80_000,
      },
    });

    expect(result.status).toBe("commitment-shortfall");
    expect(result.bindingConstraints).toContain("commitment");
    expect(result.modeledLoanManwon).toBeCloseTo(80_000, 6);
    expect(result.upfrontFeeManwon).toBeCloseTo(800, 6);
    expect(result.netTakeoutProceedsManwon).toBeCloseTo(79_200, 6);
    expect(result.refinanceShortfallManwon).toBeCloseTo(10_800, 6);
  });

  it("reports feasibility when committed net proceeds repay the PF balance", () => {
    const result = underwriteTakeoutLoan({
      stabilizedValueManwon: 200_000,
      stabilizedNoiManwon: 15_000,
      pfBalanceToRefinanceManwon: 90_000,
      terms: {
        ...completeTerms,
        loanCommitmentManwon: 100_000,
      },
    });

    expect(result.status).toBe("commitment-feasible");
    expect(result.refinanceShortfallManwon).toBe(0);
    expect(result.refinanceSurplusManwon).toBeCloseTo(9_000, 6);
    expect(result.annualDebtServiceManwon).toBeGreaterThan(0);
    expect(result.debtYieldPct).toBeCloseTo(15, 8);
  });

  it("separates capitalized deferral, interest-only, amortization, and balloon", () => {
    const schedule = buildTakeoutDebtSchedule(100_000, {
      ...completeTerms,
      loanTermYears: 5,
      paymentDeferralMonths: 6,
      interestOnlyMonths: 6,
    });

    expect(schedule.rows).toHaveLength(60);
    expect(schedule.rows[0].phase).toBe("payment-deferral");
    expect(schedule.rows[0].periodicDebtServiceManwon).toBe(0);
    expect(schedule.rows[0].capitalizedInterestManwon).toBeGreaterThan(0);
    expect(schedule.rows[6].phase).toBe("interest-only");
    expect(schedule.rows[6].scheduledPrincipalManwon).toBe(0);
    expect(schedule.rows[12].phase).toBe("amortizing");
    expect(schedule.rows[12].scheduledPrincipalManwon).toBeGreaterThan(0);
    expect(schedule.maturityBalloonManwon).toBeGreaterThan(90_000);
    expect(schedule.rows.at(-1)?.closingBalanceManwon).toBe(0);
  });

  it("applies variable-rate resets with floor and cap to DSCR sizing", () => {
    const variable = underwriteTakeoutLoan({
      stabilizedValueManwon: 500_000,
      stabilizedNoiManwon: 20_000,
      pfBalanceToRefinanceManwon: 80_000,
      terms: {
        ...completeTerms,
        maxLtvPct: 90,
        loanTermYears: 5,
        rateResetMonths: 12,
        annualRateChangePct: 1,
        rateFloorPct: 4,
        rateCapPct: 6.5,
        loanCommitmentManwon: 100_000,
      },
    });
    const fixed = underwriteTakeoutLoan({
      stabilizedValueManwon: 500_000,
      stabilizedNoiManwon: 20_000,
      pfBalanceToRefinanceManwon: 80_000,
      terms: {
        ...completeTerms,
        maxLtvPct: 90,
        loanTermYears: 5,
        loanCommitmentManwon: 100_000,
      },
    });

    expect(variable.rateMode).toBe("projected-variable");
    expect(variable.minimumProjectedRatePct).toBe(5);
    expect(variable.maximumProjectedRatePct).toBe(6.5);
    expect(variable.maximumAnnualDebtServiceManwon ?? 0).toBeGreaterThan(
      fixed.maximumAnnualDebtServiceManwon ?? 0,
    );
    expect(variable.dscrLimitManwon ?? 0).toBeLessThan(
      fixed.dscrLimitManwon ?? 0,
    );
  });

  it("funds DSRA from gross proceeds and exposes the added refinance gap", () => {
    const noReserve = underwriteTakeoutLoan({
      stabilizedValueManwon: 200_000,
      stabilizedNoiManwon: 15_000,
      pfBalanceToRefinanceManwon: 79_000,
      terms: { ...completeTerms, loanCommitmentManwon: 80_000 },
    });
    const reserve = underwriteTakeoutLoan({
      stabilizedValueManwon: 200_000,
      stabilizedNoiManwon: 15_000,
      pfBalanceToRefinanceManwon: 79_000,
      terms: {
        ...completeTerms,
        loanCommitmentManwon: 80_000,
        dsraMonths: 6,
      },
    });

    expect(noReserve.refinanceShortfallManwon).toBe(0);
    expect(reserve.dsraRequiredBalanceManwon ?? 0).toBeGreaterThan(0);
    expect(reserve.netTakeoutProceedsManwon ?? 0).toBeLessThan(
      noReserve.netTakeoutProceedsManwon ?? 0,
    );
    expect(reserve.refinanceShortfallManwon ?? 0).toBeGreaterThan(0);
  });

  it("preserves a negative closing cash flow when fees and DSRA exceed the loan", () => {
    const result = underwriteTakeoutLoan({
      stabilizedValueManwon: 200_000,
      stabilizedNoiManwon: 15_000,
      pfBalanceToRefinanceManwon: 80_000,
      terms: {
        ...completeTerms,
        loanCommitmentManwon: 80_000,
        upfrontFeeRatePct: 100,
        dsraMonths: 24,
      },
    });

    expect(result.netTakeoutCashFlowManwon ?? 0).toBeLessThan(0);
    expect(result.netTakeoutProceedsManwon).toBe(0);
    expect(result.refinanceShortfallManwon ?? 0).toBeGreaterThan(80_000);
    expect(result.refinanceSurplusManwon).toBe(0);
  });

  it("rejects impossible grace, IO, and rate floor/cap terms", () => {
    const result = underwriteTakeoutLoan({
      stabilizedValueManwon: 200_000,
      stabilizedNoiManwon: 15_000,
      pfBalanceToRefinanceManwon: 80_000,
      terms: {
        ...completeTerms,
        loanTermYears: 2,
        paymentDeferralMonths: 12,
        interestOnlyMonths: 13,
        rateFloorPct: 8,
        rateCapPct: 7,
      },
    });

    expect(result.status).toBe("terms-invalid");
    expect(result.invalidTerms.join(" ")).toContain("계약 만기");
    expect(result.invalidTerms.join(" ")).toContain("floor");
  });
});
