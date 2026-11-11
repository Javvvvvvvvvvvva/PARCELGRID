import { describe, expect, it } from "vitest";
import { assessConstructionQuote, constructionQuoteBasis, constructionQuoteSchema, createConstructionQuoteDraft,
  saveConstructionQuote, QUOTE_SCOPE_IDS } from "@/lib/planning/construction-quote";
import { clonePlanningScenario } from "@/lib/planning/scenario-utils";
import { protectLockedPlanningGeometryPatch } from "@/lib/planning/geometry-source";
import { validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { buildIntegratedVerification, verificationApprovalBlockers } from "@/lib/handoff/integrated-verification";
import { buildReviewSnapshotKey } from "@/lib/handoff/review-snapshot";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const original = constructionQuoteFixture();
const fixture = () => structuredClone(original);
const inspect = (f: ReturnType<typeof fixture>) => assessConstructionQuote(f.scenario, f.inputs);

describe("construction quote evidence reconciliation", () => {
  it("keeps absence, an incomplete draft and internal readiness distinct", () => {
    const f = fixture(); delete f.scenario.constructionQuote;
    expect(inspect(f)).toMatchObject({ status: "absent", approvalStatus: "unverified", financialApplied: false });
    f.scenario.constructionQuote = createConstructionQuoteDraft(f.scenario, f.inputs, "2026-11-04");
    const missing = inspect(f);
    expect(missing.status).toBe("missing");
    expect(missing.lineTotalWon).toBeNull();
    expect(missing.issues.filter(issue => issue.code.startsWith("coverage."))).toHaveLength(QUOTE_SCOPE_IDS.length);
    expect(inspect(fixture())).toMatchObject({ status: "ready", approvalStatus: "unverified", financialApplied: false });
  });

  it("counts a multi-trade package once and compares against base allowance, not adopted costs", () => {
    const f = fixture(), result = inspect(f);
    expect(f.quote.coverage.filter(scope => scope.lineIds.includes("package")).length).toBeGreaterThan(1);
    expect(result.lineTotalWon).toBeCloseTo(f.quote.statedTotalWon!, 6);
    expect(result.baseEstimateWon).toBe(432 * f.inputs.constructionCostPerSqmWon);
    expect(result.differenceFromBaseWon).toBeCloseTo(result.lineTotalWon! - result.baseEstimateWon!, 5);
    expect(result.quantities.every(item => item.status === "checked")).toBe(true);
  });

  it.each(["unknown-scope", "excluded-scope", "missing-source", "expired", "total", "product", "duplicate-source", "quantity"])(
    "withholds the whole-construction difference for %s while preserving entered amounts", kind => {
      const f = fixture();
      if (kind === "unknown-scope" || kind === "excluded-scope") {
        f.quote.coverage[0].status = kind === "unknown-scope" ? "unknown" : "excluded";
        f.quote.coverage[0].lineIds = [];
      }
      if (kind === "missing-source") f.quote.reference = "";
      if (kind === "expired") f.quote.validUntil = "2026-11-03";
      if (kind === "total") f.quote.statedTotalWon! += 2;
      if (kind === "product") f.quote.lines[1].amountWon! += 2;
      if (kind === "duplicate-source") f.quote.lines[1].sourceLocator = f.quote.lines[0].sourceLocator;
      if (kind === "quantity") {
        const line = f.quote.lines[1];
        line.quantity! += 1;
        line.amountWon! += line.unitRateWon!;
        f.quote.statedTotalWon! += line.unitRateWon!;
      }
      const before = structuredClone(f), result = inspect(f);
      expect(result.status).not.toBe("ready");
      expect(result.lineTotalWon).not.toBeNull();
      expect(result.baseEstimateWon).not.toBeNull();
      expect(result.differenceFromBaseWon).toBeNull();
      expect(result.financialApplied).toBe(false);
      expect(f).toEqual(before);
    }
  );

  it.each(["unknown", "excluded", "not-applicable"] as const)("does not certify unknown/excluded or unexplained scope %s", state => {
    const f = fixture(), scope = f.quote.coverage[0];
    scope.status = state; scope.lineIds = []; scope.note = "";
    expect(inspect(f).status).toBe("missing");
  });

  it.each(["reference", "issuer", "projectReference", "issuedOn", "validUntil", "reviewDate"] as const)("requires %s evidence", field => {
    const f = fixture(); f.quote[field] = "";
    expect(inspect(f).issues).toContainEqual(expect.objectContaining({ code: `header.${field}`, status: "missing" }));
  });

  it.each(["duplicate-id", "duplicate-scope", "duplicate-link", "unknown-field", "invalid-date", "negative", "nonfinite", "too-many"])("rejects malformed %s", kind => {
    const f = fixture();
    if (kind === "duplicate-id") f.quote.lines[1].id = f.quote.lines[0].id;
    if (kind === "duplicate-scope") f.quote.coverage[1].id = f.quote.coverage[0].id;
    if (kind === "duplicate-link") f.quote.coverage[0].lineIds.push(f.quote.coverage[0].lineIds[0]);
    if (kind === "unknown-field") Object.assign(f.quote, { expertApproved: true });
    if (kind === "invalid-date") f.quote.issuedOn = "2026-02-30";
    if (kind === "negative") f.quote.lines[0].amountWon = -1;
    if (kind === "nonfinite") f.quote.lines[0].amountWon = Infinity;
    if (kind === "too-many") f.quote.lines = Array.from({ length: 257 }, (_, i) => ({ ...f.quote.lines[0], id: `${i}` }));
    expect(constructionQuoteSchema.safeParse(f.quote).success).toBe(false);
    expect(inspect(f).status).toBe("conflict");
  });

  it.each(["2026-10-31", "2026-12-01"])("rejects a review date outside issued/valid dates %s", date => {
    const f = fixture(); f.quote.reviewDate = date;
    expect(inspect(f).status).toBe("conflict");
  });

  it("does not use the wall clock or mutate quote/source data", () => {
    const f = fixture(), before = structuredClone(f);
    expect(inspect(f)).toEqual(inspect(f));
    expect(f).toEqual(before);
  });

  it.each(["header-unknown", "base-mismatch", "row-mismatch", "row-unknown"])("keeps VAT %s explicit instead of guessing tax", kind => {
    const f = fixture();
    if (kind === "header-unknown") f.quote.vatBasis = "unknown";
    if (kind === "base-mismatch") f.quote.baseVatBasis = "excluded";
    if (kind === "row-mismatch") f.quote.lines[0].vatBasis = "exempt";
    if (kind === "row-unknown") f.quote.lines[0].vatBasis = "unknown";
    expect(inspect(f).status).not.toBe("ready");
    expect(inspect(f).differenceFromBaseWon).toBeNull();
  });

  it.each(["total", "product", "duplicate-source", "unallocated", "orphan", "false-exclusion", "mixed-lump", "fractional-count", "zero-evidence"])("finds %s without publishing a verified quote", kind => {
    const f = fixture(), count = f.quote.lines.find(line => line.unit === "count")!;
    if (kind === "total") f.quote.statedTotalWon! += 2;
    if (kind === "product") f.quote.lines[1].amountWon! += 2;
    if (kind === "duplicate-source") f.quote.lines[1].sourceLocator = "  P1   ROW1  ";
    if (kind === "unallocated") f.quote.coverage.forEach(scope => { scope.lineIds = scope.lineIds.filter(id => id !== count.id); });
    if (kind === "orphan") f.quote.coverage[0].lineIds = ["nonexistent"];
    if (kind === "false-exclusion") { const scope = f.quote.coverage.find(scope => scope.id === count.quantityItemId)!; scope.status = "not-applicable"; scope.lineIds = []; }
    if (kind === "mixed-lump") f.quote.lines[0].quantity = 1;
    if (kind === "fractional-count") count.quantity = 1.5;
    if (kind === "zero-evidence") { f.quote.lines[0].amountWon = 0; f.quote.lines[0].note = ""; f.quote.statedTotalWon! -= 1_000_000; }
    expect(inspect(f).status).not.toBe("ready");
    expect(inspect(f).approvalStatus).toBe("unverified");
  });

  it.each(["unit", "quantity", "scope", "unmapped"])("checks model quantity %s independently of matching totals", kind => {
    const f = fixture(), row = f.quote.lines[1];
    if (kind === "unit") row.unit = "m3";
    if (kind === "quantity") { row.quantity! += 1; row.amountWon! += row.unitRateWon!; f.quote.statedTotalWon! += row.unitRateWon!; }
    if (kind === "scope") f.quote.coverage.find(scope => scope.id === row.quantityItemId)!.lineIds = ["package"];
    if (kind === "unmapped") row.quantityItemId = null;
    expect(inspect(f).status).not.toBe("ready");
  });

  it("detects duplicated quantity under a different row reference even when the total is updated", () => {
    const f = fixture(), line = f.quote.lines[1], duplicate = { ...line, id: "dup", sourceLocator: "p3 row7" };
    f.quote.lines.push(duplicate); f.quote.statedTotalWon! += line.amountWon!;
    f.quote.coverage.find(scope => scope.id === line.quantityItemId)!.lineIds.push("dup");
    expect(inspect(f).issues).toContainEqual(expect.objectContaining({ code: `quantity.${line.quantityItemId}`, status: "fail" }));
  });

  it.each(["untagged", "lump-sum", "wrong-tag"])("does not hide an additional coverage-linked %s row from quantity reconciliation", kind => {
    const f = fixture(), row = f.quote.lines.find(line => line.quantityItemId === "entryDoorCount")!;
    const duplicate = { ...row, id: "duplicate-door", sourceLocator: "p3 row7", quantityItemId: null };
    if (kind === "lump-sum") Object.assign(duplicate, { pricing: "lump-sum", unit: "lot", quantity: null, unitRateWon: null });
    if (kind === "wrong-tag") Object.assign(duplicate, { quantityItemId: "bathroomCount" });
    f.quote.lines.push(duplicate);
    f.quote.coverage.find(scope => scope.id === "entryDoorCount")!.lineIds.push(duplicate.id);
    f.quote.statedTotalWon! += row.amountWon!;
    const result = inspect(f);
    expect(result.status).not.toBe("ready");
    expect(result.quantities.find(item => item.id === "entryDoorCount")).toMatchObject({ status: "missing", quoted: null });
    expect(buildIntegratedVerification(f).checks.find(check => check.id === "binding.construction-quote")?.status).not.toBe("checked");
  });

  it.each(["layout", "parking", "core", "base-rate", "basement-rate", "other-project"])("invalidates stale %s and prevents saving it as current evidence", kind => {
    const f = fixture();
    if (kind === "layout") f.scenario.floorPrograms[0].floorHeightM += .1;
    if (kind === "parking") f.scenario.parking.providedCars++;
    if (kind === "core") f.scenario.egressPlan!.exit!.widthM += .1;
    if (kind === "base-rate") f.inputs.constructionCostPerSqmWon++;
    if (kind === "basement-rate") f.inputs.basementCostMultiplier += .1;
    if (kind === "other-project") f.scenario.projectId = "OTHER";
    expect(inspect(f).status).toBe("stale");
    expect(() => saveConstructionQuote(f.scenario, f.quote, f.inputs)).toThrow();
  });

  it("saves a valid incomplete draft without changing financial amounts, parking or approvals", () => {
    const f = fixture(), before = structuredClone(f.scenario);
    const draft = createConstructionQuoteDraft(f.scenario, f.inputs, "2026-11-04");
    const patch = saveConstructionQuote(f.scenario, draft, f.inputs);
    expect(Object.keys(patch).sort()).toEqual(["checks", "constructionQuote"]);
    expect(f.scenario).toEqual(before);
    expect(patch.constructionQuote).toEqual(draft);
    expect(patch.constructionQuote).not.toBe(draft);
  });

  it("protects locked scenarios and clears copied quote provenance on scenario duplication", () => {
    const f = fixture(); f.scenario.geometrySource = { mode: "engine-generated", locked: true, exactGeometryAvailable: true };
    expect(() => saveConstructionQuote(f.scenario, f.quote, f.inputs)).toThrow();
    expect(protectLockedPlanningGeometryPatch(f.scenario, { constructionQuote: undefined })).not.toHaveProperty("constructionQuote");
    expect(clonePlanningScenario(f.scenario).constructionQuote).toBeUndefined();
  });

  it("roundtrips bounded quote evidence and rejects malformed workspace records", () => {
    const f = fixture(), payload = projectWorkspaceFixture(f.projectId); payload.planningScenarios = [f.scenario];
    expect(validateProjectWorkspacePayload(JSON.parse(JSON.stringify(payload)), f.projectId).valid).toBe(true);
    Object.assign(f.scenario, { constructionQuote: null });
    expect(validateProjectWorkspacePayload(payload, f.projectId).errors.join(" ")).toContain("공종 견적");
  });

  it("keeps unrelated timestamps out of the quantity basis", () => {
    const f = fixture(), basis = constructionQuoteBasis(f.scenario, f.inputs);
    f.scenario.updatedAt = "2026-11-05T12:00:00Z";
    expect(constructionQuoteBasis(f.scenario, f.inputs)).toBe(basis);
  });

  it("preserves the quote basis after canonical JSON key ordering", () => {
    const f = fixture(), reordered = JSON.parse(JSON.stringify(f.scenario, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => b.localeCompare(a))) : value));
    expect(constructionQuoteBasis(reordered, f.inputs)).toBe(f.quote.sourceBasis);
    expect(assessConstructionQuote(reordered, f.inputs).status).toBe("ready");
  });
});

describe("construction quote review binding", () => {
  it("checks declared evidence but retains external full-BOQ and expert blockers", () => {
    const f = fixture(), report = buildIntegratedVerification(f);
    expect(report.checks.find(check => check.id === "binding.construction-quote")).toMatchObject({ status: "checked" });
    expect(report.approvalStatus).toBe("unverified");
    expect(verificationApprovalBlockers(report, "finance-tax")).toContainEqual(expect.objectContaining({ id: "quantity-cost.finance-tax", status: "missing" }));
    f.quote.statedTotalWon! += 2;
    const failed = buildIntegratedVerification(f);
    for (const discipline of ["architect", "developer", "finance-tax"] as const) {
      expect(verificationApprovalBlockers(failed, discipline)).toContainEqual(expect.objectContaining({ id: "binding.construction-quote", status: "fail" }));
    }
  });

  it("changes the review key for a quote edit without changing stored financial results", () => {
    const f = fixture(), data = structuredClone(f.data);
    const input = { snapshot: { projectId: f.projectId, representativeScenarioId: f.representativeScenarioId,
      representativeScenarioVersion: f.representativeScenarioVersion, geometryHash: f.geometryHash, savedAt: "2026-11-04T00:00:00Z", data: f.data },
      planningScenario: f.scenario, geometry: f.geometry, financialSources: {}, priceVerifications: {} };
    const before = buildReviewSnapshotKey(input);
    f.quote.reference = "Changed document";
    expect(buildReviewSnapshotKey(input)).not.toBe(before);
    expect(f.data).toEqual(data);
  });
});
