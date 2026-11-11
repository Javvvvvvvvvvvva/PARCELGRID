import { describe, expect, it } from "vitest";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";
import { createQuoteAdoptionReviewDraft, evaluateQuoteAdoptionReview, quoteAdoptionReviewKey,
  QUOTE_ADOPTION_SCOPE_IDS, quoteAdoptionBusinessDate, type QuoteAdoptionReviewDraft } from "@/lib/planning/construction-quote-adoption-review";

function fixture() {
  const f = constructionQuoteFixture();
  f.quote.lines[0].allocations = f.quote.coverage.filter(scope => scope.lineIds.includes("package"))
    .map(scope => ({ scopeId: scope.id, amountWon: 100000, source: `Synthetic allocation ${scope.id}` }));
  const draft = createQuoteAdoptionReviewDraft(f.scenario, f.inputs, f.geometry!);
  draft.checkedOn = "2026-11-11";
  draft.scopes.forEach(scope => { scope.confirmed = true; scope.source = "Synthetic contract p3, not real evidence"; });
  return { ...f, draft };
}
const evaluate = (f: ReturnType<typeof fixture>, raw: unknown = f.draft, asOf = "2026-11-11") =>
  evaluateQuoteAdoptionReview(f.scenario, f.inputs, f.geometry!, raw, asOf);

describe("full quote adoption preflight, never financial adoption", () => {
  it("returns one replacement total, not base plus quote or a savings claim", () => {
    const f = fixture(), before = structuredClone(f);
    const result = evaluate(f);
    expect(result.issues).toEqual([]);
    expect(result.status).toBe("ready");
    expect(result.proposedConstructionCostWon).toBe(f.quote.statedTotalWon);
    expect(result.differenceWon).toBe(result.proposedConstructionCostWon! - result.replacedConstructionCostWon!);
    expect(result).toMatchObject({ financialApplied: false, approvalStatus: "unverified" });
    expect(result).not.toHaveProperty("patch");
    expect(f).toEqual(before);
  });
  it("starts with no date, no consent and no inferred source", () => {
    const f = fixture(), draft = createQuoteAdoptionReviewDraft(f.scenario, f.inputs, f.geometry!);
    expect(draft.checkedOn).toBe("");
    expect(draft.scopes.every(scope => !scope.confirmed && scope.source === "")).toBe(true);
    expect(evaluate(f, draft)).toMatchObject({ status: "missing", proposedConstructionCostWon: null });
  });
  it.each(QUOTE_ADOPTION_SCOPE_IDS)("requires explicit scope and source for %s", id => {
    const f = fixture(), scope = f.draft.scopes.find(scope => scope.id === id)!;
    scope.confirmed = false;
    expect(evaluate(f).status).toBe("missing");
    scope.confirmed = true; scope.source = " \n ";
    expect(evaluate(f).status).toBe("missing");
  });
  it.each(["unknown", "excluded", "exempt"] as const)("never guesses tax cash flows for %s", vat => {
    const f = fixture();
    f.quote.vatBasis = vat; f.quote.baseVatBasis = vat;
    f.quote.lines.forEach(line => { line.vatBasis = vat; });
    f.draft.sourceKey = quoteAdoptionReviewKey(f.scenario, f.inputs, f.geometry!);
    const result = evaluate(f);
    expect(result.status).not.toBe("ready");
    expect(result.proposedConstructionCostWon).toBeNull();
    expect(result.issues.join(" ")).toContain("부가세 포함");
  });
  it.each(["2026-11-10", "2026-11-12"])("rejects a non-current review date %s", date => {
    expect(quoteAdoptionBusinessDate(new Date("2026-11-10T14:59:59Z"))).toBe("2026-11-10");
    expect(quoteAdoptionBusinessDate(new Date("2026-11-10T15:00:00Z"))).toBe("2026-11-11");
    const f = fixture(); f.draft.checkedOn = date;
    expect(evaluate(f)).toMatchObject({ status: "stale", proposedConstructionCostWon: null });
  });
  it("rejects an expired quote even if its historic comparison date was valid", () => {
    const f = fixture(); f.draft.checkedOn = "2026-12-01";
    expect(evaluate(f, f.draft, "2026-12-01")).toMatchObject({ status: "stale", proposedConstructionCostWon: null });
  });
  it.each(["", "2026-99-99"])("rejects missing or malformed validity %s", value => {
    const f = fixture(); f.quote.validUntil = value;
    expect(evaluate(f).status).not.toBe("ready");
  });
  it.each(["2026-02-30", "not-a-date"])("rejects an invalid runtime date %s", value => {
    expect(evaluate(fixture(), undefined, value).status).toBe("conflict");
  });
  it.each(["reference", "issuer", "projectReference"] as const)("invalidates consent when quote %s changes", key => {
    const f = fixture(); f.quote[key] += " changed";
    expect(evaluate(f).status).toBe("stale");
  });
  it("binds raw scope allocation sources even when the plan basis and totals are unchanged", () => {
    const f = fixture(); f.quote.lines[0].allocations![0].source += " changed";
    expect(evaluate(f)).toMatchObject({ status: "stale", proposedConstructionCostWon: null });
  });
  it("binds raw geometry, not just a caller-provided geometry hash", () => {
    const f = fixture(); f.geometry!.building.floors[0].shape[0].x += 0.01;
    expect(evaluate(f)).toMatchObject({ status: "stale", proposedConstructionCostWon: null });
  });
  it("requires geometry and rejects failed or stale geometry", () => {
    const f = fixture();
    const noGeometry = createQuoteAdoptionReviewDraft(f.scenario, f.inputs);
    Object.assign(noGeometry, { scopes: f.draft.scopes, checkedOn: f.draft.checkedOn });
    expect(evaluateQuoteAdoptionReview(f.scenario, f.inputs, undefined, noGeometry, "2026-11-11").status).toBe("missing");
    f.geometry!.validation.status = "fail";
    f.draft.sourceKey = quoteAdoptionReviewKey(f.scenario, f.inputs, f.geometry!);
    expect(evaluate(f).status).toBe("conflict");
    f.geometry!.validation.status = "pass"; f.geometry!.scenarioVersion += 1;
    f.draft.sourceKey = quoteAdoptionReviewKey(f.scenario, f.inputs, f.geometry!);
    expect(evaluate(f).status).toBe("stale");
  });
  it("cannot confirm away unresolved package allocation", () => {
    const f = fixture(); delete f.quote.lines[0].allocations;
    f.draft.sourceKey = quoteAdoptionReviewKey(f.scenario, f.inputs, f.geometry!);
    expect(evaluate(f)).toMatchObject({ status: "missing", proposedConstructionCostWon: null });
  });
  it.each([null, {}, { version: "unknown" }])("fails closed for malformed declarations %#", raw => {
    expect(evaluate(fixture(), raw)).toMatchObject({ status: "conflict", proposedConstructionCostWon: null });
  });
  it("rejects duplicate scopes, unknown fields and oversized sources", () => {
    const f = fixture();
    const duplicate = structuredClone(f.draft); duplicate.scopes[0] = duplicate.scopes[1];
    expect(evaluate(f, duplicate).status).toBe("conflict");
    expect(evaluate(f, { ...f.draft, approved: true }).status).toBe("conflict");
    f.draft.scopes[0].source = "x".repeat(2001);
    expect(evaluate(f).status).toBe("conflict");
  });
  it("preserves the key through object-key reorder and ignores render timestamps only", () => {
    const f = fixture();
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
    const other = reorder(f) as typeof f;
    expect(quoteAdoptionReviewKey(other.scenario, other.inputs, other.geometry!)).toBe(f.draft.sourceKey);
    f.geometry!.generatedAt = "2030-01-01T00:00:00Z";
    expect(evaluate(f).status).toBe("ready");
  });
  it("retains unverified status on every failing path", () => {
    const f = fixture();
    for (const raw of [null, f.draft, { ...f.draft, checkedOn: "" } satisfies QuoteAdoptionReviewDraft]) {
      expect(evaluate(f, raw)).toMatchObject({ financialApplied: false, approvalStatus: "unverified" });
    }
  });
});
