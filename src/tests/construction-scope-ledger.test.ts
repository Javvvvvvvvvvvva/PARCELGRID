import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { assessConstructionQuote, buildConstructionScopeLedger, constructionQuoteSchema,
  MAX_QUOTE_ALLOCATIONS, QUOTE_SCOPE_IDS } from "@/lib/planning/construction-quote";
import { buildIntegratedVerification, verificationApprovalBlockers } from "@/lib/handoff/integrated-verification";
import { buildReviewSnapshotKey } from "@/lib/handoff/review-snapshot";
import { readConstructionQuoteFile, CONSTRUCTION_QUOTE_FILE_BYTES } from "@/lib/planning/construction-quote-import";
import { validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const original = constructionQuoteFixture();
function fixture() {
  const f = structuredClone(original), row = f.quote.lines[0];
  const scopes = f.quote.coverage.filter(scope => scope.lineIds.includes(row.id));
  row.allocations = scopes.map((scope, index) => ({ scopeId: scope.id,
    amountWon: index === scopes.length - 1 ? 1_000_000 - 90_000 * (scopes.length - 1) : 90_000,
    source: `Synthetic allocation appendix ${scope.id}` }));
  return f;
}
const ledger = (f: ReturnType<typeof fixture>) => buildConstructionScopeLedger(f.quote);
const report = (f: ReturnType<typeof fixture>) => buildIntegratedVerification(f);

describe("declared full-scope construction quote ledger", () => {
  it("leaves legacy shared packages unallocated without fabricating equal shares or erasing money", () => {
    const f = structuredClone(original), result = ledger(f);
    expect(result.status).toBe("incomplete");
    expect(result.knownAmountWon).toBeCloseTo(f.quote.statedTotalWon!, 6);
    expect(result.unallocatedAmountWon).toBe(1_000_000);
    expect(result.totalAmountWon).toBeNull();
    expect(result.scopes.filter(scope => scope.status === "missing")).toHaveLength(10);
    expect(result.scopes.filter(scope => scope.status === "allocated")).toHaveLength(7);
    expect(result.scopes.find(scope => scope.id === "structure")?.amountWon).toBeNull();
    expect(assessConstructionQuote(f.scenario, f.inputs).status).toBe("ready");
    expect(report(f).checks.find(check => check.id === "binding.construction-scope-ledger")?.status).toBe("missing");
  });

  it("reconciles 17 trades, counts packages once, and preserves source economics and approvals", () => {
    const f = fixture(), before = structuredClone(f), result = ledger(f);
    expect(result.status).toBe("reconciled");
    expect(result.scopes).toHaveLength(17);
    expect(result.scopes.every(scope => scope.status === "allocated")).toBe(true);
    expect(result.scopes.find(scope => scope.id === "structure")?.amountWon).toBe(90_000);
    expect(result.scopes.find(scope => scope.id === "siteworks")?.amountWon).toBe(190_000);
    expect(result.unallocatedAmountWon).toBe(0);
    expect(result.allocatedAmountWon).toBe(result.totalAmountWon);
    const expected = f.quote.lines.reduce((sum, line) => sum.plus(line.amountWon!), new Decimal(0));
    expect(result.totalAmountWon).toBe(expected.toNumber());
    expect(result.scopes.reduce((sum, scope) => sum.plus(scope.amountWon!), new Decimal(0)).toNumber()).toBe(expected.toNumber());
    expect(result.financialApplied).toBe(false);
    expect(result.approvalStatus).toBe("unverified");
    const verification = report(f);
    expect(verification.checks.find(check => check.id === "binding.construction-scope-ledger")?.status).toBe("checked");
    expect(verificationApprovalBlockers(verification, "finance-tax")).toContainEqual(expect.objectContaining({ id: "quantity-cost.finance-tax", status: "missing" }));
    expect(f).toEqual(before);
  });

  it.each(["under", "over", "tiny-difference", "wrong-scope", "missing-scope", "scope-state", "product", "total", "duplicate-source"])("rejects %s without a complete cost", kind => {
    const f = fixture(), row = f.quote.lines[0];
    if (kind === "under") row.allocations![0].amountWon! -= 1;
    if (kind === "over") row.allocations![0].amountWon! += 1;
    if (kind === "tiny-difference") row.allocations![0].amountWon! += .01;
    if (kind === "wrong-scope") row.allocations![0].scopeId = "entryDoorCount";
    if (kind === "missing-scope") row.allocations!.pop();
    if (kind === "scope-state") f.quote.coverage[0].status = "excluded";
    if (kind === "product") f.quote.lines[1].amountWon! += 10;
    if (kind === "total") f.quote.statedTotalWon! += 10;
    if (kind === "duplicate-source") f.quote.lines[1].sourceLocator = "  P1   ROW1  ";
    expect(ledger(f).status).toBe("conflict");
    expect(ledger(f).totalAmountWon).toBeNull();
    expect(report(f).checks.find(check => check.id === "binding.construction-scope-ledger")?.status).toBe("fail");
  });

  it.each(["missing-amount", "missing-source", "excluded", "unknown", "empty-note", "no-rows", "all-unpriced", "missing-total"])("keeps %s distinct from a zero-cost complete estimate", kind => {
    const f = fixture(), row = f.quote.lines[0];
    if (kind === "missing-amount") row.allocations![0].amountWon = null;
    if (kind === "missing-source") row.allocations![0].source = " ";
    if (kind === "excluded" || kind === "unknown") {
      const scope = f.quote.coverage.find(scope => scope.id === "entryDoorCount")!;
      const id = scope.lineIds[0]; scope.status = kind; scope.lineIds = [];
      f.quote.lines = f.quote.lines.filter(line => line.id !== id);
      f.quote.statedTotalWon = f.quote.lines.reduce((sum, line) => sum + line.amountWon!, 0);
    }
    if (kind === "empty-note") f.quote.coverage[0].note = "";
    if (kind === "no-rows") { f.quote.lines = []; f.quote.coverage.forEach(scope => { scope.lineIds = []; }); }
    if (kind === "all-unpriced") { f.quote.lines.forEach(line => { line.amountWon = null; }); }
    if (kind === "missing-total") f.quote.statedTotalWon = null;
    const result = ledger(f);
    expect(result.status).toBe("incomplete");
    expect(result.totalAmountWon).toBeNull();
    if (kind === "all-unpriced" || kind === "no-rows") expect(result.knownAmountWon).toBeNull();
  });

  it("displays declared not-applicable as unpriced, not a zero amount", () => {
    const f = fixture(), row = f.quote.lines[0], scope = f.quote.coverage[0];
    const amount = row.allocations![0].amountWon!;
    row.allocations!.shift(); row.amountWon! -= amount; f.quote.statedTotalWon! -= amount;
    scope.status = "not-applicable"; scope.lineIds = [];
    const result = ledger(f);
    expect(result.status).toBe("reconciled");
    expect(result.scopes[0]).toMatchObject({ status: "not-applicable", amountWon: null });
  });

  it("uses exact Decimal allocation sums and keeps explicit documented zero", () => {
    const f = fixture(), row = f.quote.lines[0];
    row.amountWon = .3;
    row.allocations!.forEach((part, index) => { part.amountWon = index === 0 ? .1 : index === 1 ? .2 : 0; });
    f.quote.statedTotalWon = f.quote.lines.reduce((sum, line) => sum.plus(line.amountWon!), new Decimal(0)).toNumber();
    expect(ledger(f).status).toBe("reconciled");
    expect(ledger(f).scopes[2].amountWon).toBe(0);
  });

  it.each(["unknown", "excluded", "exempt"] as const)("does not sum rows with a different VAT basis %s", vatBasis => {
    const f = fixture(); f.quote.lines[0].vatBasis = vatBasis;
    expect(ledger(f).totalAmountWon).toBeNull();
    expect(ledger(f).knownAmountWon).toBeNull();
    expect(ledger(f).allocatedAmountWon).toBeNull();
  });

  it.each(["duplicate", "negative", "nonfinite", "string", "unknown-field", "too-many"])("rejects malformed allocation %s", kind => {
    const f = fixture(), row = f.quote.lines[0];
    if (kind === "duplicate") row.allocations!.push({ ...row.allocations![0] });
    if (kind === "negative") row.allocations![0].amountWon = -1;
    if (kind === "nonfinite") row.allocations![0].amountWon = Infinity;
    if (kind === "string") Object.assign(row.allocations![0], { amountWon: "123" });
    if (kind === "unknown-field") Object.assign(row.allocations![0], { approved: true });
    if (kind === "too-many") f.quote.lines = Array.from({ length: 26 }, (_, i) => ({ ...row, id: String(i) }));
    expect(constructionQuoteSchema.safeParse(f.quote).success).toBe(false);
    expect(ledger(f).status).toBe("conflict");
    expect(ledger(f).knownAmountWon).toBeNull();
  });

  it("does not certify a numerically allocated stale or expired quote", () => {
    for (const mode of ["stale", "expired"]) {
      const f = fixture();
      if (mode === "stale") f.quote.sourceBasis = "old-basis";
      else f.quote.validUntil = "2026-10-01";
      expect(ledger(f).status).toBe("reconciled");
      expect(report(f).checks.find(check => check.id === "binding.construction-scope-ledger")?.status).toBe("fail");
    }
  });

  it("persists allocation provenance and changes the seal without changing saved economics", async () => {
    const f = fixture(), workspace = projectWorkspaceFixture(f.projectId);
    workspace.planningScenarios = [f.scenario];
    const data = structuredClone(f.data);
    expect(validateProjectWorkspacePayload(JSON.parse(JSON.stringify(workspace)), f.projectId).valid).toBe(true);
    const input = { snapshot: { projectId: f.projectId, representativeScenarioId: f.representativeScenarioId,
      representativeScenarioVersion: f.representativeScenarioVersion, geometryHash: f.geometryHash, savedAt: "2026-11-10T00:00:00Z", data: f.data },
      planningScenario: f.scenario, geometry: f.geometry, financialSources: {}, priceVerifications: {} };
    const before = buildReviewSnapshotKey(input);
    f.quote.lines[0].allocations![0].source += " revised";
    expect(buildReviewSnapshotKey(input)).not.toBe(before);
    const imported = await readConstructionQuoteFile(new File([JSON.stringify(f.quote, null, 2)], "quote.json"), new AbortController().signal);
    expect(imported).toEqual(f.quote);
    expect(f.data).toEqual(data);
  });

  it.each(["한", "\u0000"])("round-trips maximum allocation and quote bounds with %j", async char => {
    const f = fixture(), q = f.quote;
    q.sourceBasis = char.repeat(200);
    q.reference = q.issuer = q.projectReference = char.repeat(300);
    q.lines = Array.from({ length: 256 }, (_, index) => ({ ...q.lines[0],
      id: `${char.repeat(97)}${String(index).padStart(3, "0")}`, description: char.repeat(300), sourceLocator: char.repeat(300), note: char.repeat(2000),
      allocations: [{ scopeId: QUOTE_SCOPE_IDS[index % QUOTE_SCOPE_IDS.length], amountWon: 1e13, source: char.repeat(300) }] }));
    q.coverage.forEach(scope => { scope.lineIds = q.lines.map(line => line.id); scope.note = char.repeat(2000); });
    expect(q.lines.reduce((sum, line) => sum + line.allocations!.length, 0)).toBe(MAX_QUOTE_ALLOCATIONS);
    const file = new File([JSON.stringify(q, null, 2)], "max.json");
    expect(file.size).toBeLessThan(CONSTRUCTION_QUOTE_FILE_BYTES);
    expect(await readConstructionQuoteFile(file, new AbortController().signal)).toEqual(q);
  });
});
