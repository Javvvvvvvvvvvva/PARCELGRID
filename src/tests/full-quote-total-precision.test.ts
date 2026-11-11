import { describe, expect, it } from "vitest";
import { fullQuoteAdoptionFixture } from "./helpers/full-quote-adoption-fixture";
import { buildConstructionScopeLedger, quoteTotalsMatchWithinRoundoff } from "@/lib/planning/construction-quote";
import { createQuoteAdoptionReviewDraft, evaluateQuoteAdoptionReview } from "@/lib/planning/construction-quote-adoption-review";
import { applyFullQuoteAdoption } from "@/lib/planning/full-quote-adoption";
import { validateFullQuoteCostContract } from "@/lib/planning/full-quote-cost-contract";

describe("full quote document-total precision", () => {
  it.each([[0.1 + 0.2, 0.3], [1_028_349.9340842303, 1_028_349.9340842305], [1e13, 1e13]])(
    "accepts binary representation noise between %s and %s", (left, right) => {
      expect(quoteTotalsMatchWithinRoundoff(left, right)).toBe(true);
    },
  );
  it.each([[null, 1], [NaN, 1], [1, Infinity], [1e-20, 2e-20], [1e6, 1e6 + 0.000001],
    [1e13, 1e13 - 0.01], [1e9, 1e9 + 0.5]])("rejects a real difference or invalid total %s/%s", (left, right) => {
    expect(quoteTotalsMatchWithinRoundoff(left, right)).toBe(false);
  });
  it("adopts the canonical ledger total while preserving the original document number", () => {
    const f = fullQuoteAdoptionFixture();
    const ledgerTotal = buildConstructionScopeLedger(f.quote).totalAmountWon!;
    f.quote.statedTotalWon = ledgerTotal + Number.EPSILON * ledgerTotal;
    expect(f.quote.statedTotalWon).not.toBe(ledgerTotal);
    const source = structuredClone(f.quote);
    const draft = { ...createQuoteAdoptionReviewDraft(f.scenario, f.inputs, f.geometry),
      checkedOn: f.draft.checkedOn, scopes: f.draft.scopes };
    const review = evaluateQuoteAdoptionReview(f.scenario, f.inputs, f.geometry, draft, draft.checkedOn);
    expect(review.status).toBe("ready");
    const patch = applyFullQuoteAdoption(f.scenario, f.inputs, f.geometry, draft, draft.checkedOn);
    expect(patch.fullQuoteAdoption!.totalWon).toBe(ledgerTotal);
    expect(patch.fullQuoteAdoption!.quote).toEqual(source);
    expect(f.quote).toEqual(source);
    const forged = structuredClone(patch.fullQuoteAdoption!);
    forged.totalWon += Number.EPSILON * ledgerTotal;
    expect(() => validateFullQuoteCostContract(forged)).toThrow();
  });
  it("blocks a half-won document mismatch in preflight as well as the adoption action", () => {
    const f = fullQuoteAdoptionFixture();
    f.quote.statedTotalWon! += 0.5;
    const draft = { ...createQuoteAdoptionReviewDraft(f.scenario, f.inputs, f.geometry),
      checkedOn: f.draft.checkedOn, scopes: f.draft.scopes };
    expect(evaluateQuoteAdoptionReview(f.scenario, f.inputs, f.geometry, draft, draft.checkedOn))
      .toMatchObject({ status: "conflict", proposedConstructionCostWon: null });
    expect(() => applyFullQuoteAdoption(f.scenario, f.inputs, f.geometry, draft, draft.checkedOn)).toThrow(/정확한 합계/);
  });
  it("does not let roundoff tolerance bypass the adopted ledger amount ceiling", () => {
    const f = fullQuoteAdoptionFixture();
    for (const line of f.quote.lines) {
      line.amountWon = 0;
      if (line.unitRateWon !== null) line.unitRateWon = 0;
    }
    f.quote.lines[0].amountWon = 1e13;
    f.quote.lines[0].allocations!.forEach((allocation, index) => { allocation.amountWon = index === 0 ? 1e13 : 0; });
    f.quote.lines[1].amountWon = 0.002;
    f.quote.lines[1].unitRateWon = 0.002 / f.quote.lines[1].quantity!;
    f.quote.statedTotalWon = 1e13;
    const ledger = buildConstructionScopeLedger(f.quote);
    expect(ledger.status).toBe("reconciled");
    expect(ledger.totalAmountWon).toBeGreaterThan(1e13);
    expect(quoteTotalsMatchWithinRoundoff(ledger.totalAmountWon, f.quote.statedTotalWon)).toBe(true);
    const draft = { ...createQuoteAdoptionReviewDraft(f.scenario, f.inputs, f.geometry),
      checkedOn: f.draft.checkedOn, scopes: f.draft.scopes };
    expect(evaluateQuoteAdoptionReview(f.scenario, f.inputs, f.geometry, draft, draft.checkedOn))
      .toMatchObject({ status: "conflict", proposedConstructionCostWon: null });
    expect(() => applyFullQuoteAdoption(f.scenario, f.inputs, f.geometry, draft, draft.checkedOn)).toThrow(/금액 한도/);
  });
});
