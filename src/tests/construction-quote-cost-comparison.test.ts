import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { assessConstructionQuote, buildConstructionScopeLedger, constructionQuoteBasis } from "@/lib/planning/construction-quote";
import {
  CONSTRUCTION_QUOTE_COST_COMPARISON_VERSION, evaluateConstructionQuoteCostComparison,
} from "@/lib/planning/construction-quote-cost-comparison";
import { DEFAULT_DWELLING_PROGRAM } from "@/lib/planning/dwelling-program";
import { createDefaultPlanningMaterials } from "@/lib/planning/materials";
import { createQuantityCostDraft } from "@/lib/planning/quantity-cost";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";

const original = constructionQuoteFixture();
function fixture() {
  const f = structuredClone(original), row = f.quote.lines[0];
  const scopes = f.quote.coverage.filter(scope => scope.lineIds.includes(row.id));
  row.allocations = scopes.map((scope, index) => ({ scopeId: scope.id,
    amountWon: index === scopes.length - 1 ? 1_000_000 - 90_000 * (scopes.length - 1) : 90_000,
    source: `Synthetic allocation appendix ${scope.id}` }));
  return f;
}
type Fixture = ReturnType<typeof fixture>;
const compare = (f: Fixture) => evaluateConstructionQuoteCostComparison(f.scenario, f.inputs);
const rebind = (f: Fixture) => { f.quote.sourceBasis = constructionQuoteBasis(f.scenario, f.inputs); };
const base = (f: Fixture) => 432 * f.inputs.constructionCostPerSqmWon;
const totalQuote = (f: Fixture) => f.quote.lines.reduce((sum, line) => sum.plus(line.amountWon!), new Decimal(0)).toNumber();
function materials(f: Fixture, baselineRate = 300_000, selectedRate = 330_000) {
  f.scenario.materials = { ...createDefaultPlanningMaterials(), primaryFacadeMaterial: "standard-render",
    facadeAreaOverrideSqm: 100, baselineFacadeUnitCostPerSqmWon: baselineRate, selectedFacadeUnitCostPerSqmWon: selectedRate };
}
function dwellings(f: Fixture) {
  f.scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0, additionalDwellingCostWon: 100_000 };
}
function quantityPlan(f: Fixture, rate = 1_000_000) {
  const plan = createQuantityCostDraft(f.scenario, f.inputs);
  plan.lines.forEach(line => { line.treatment = "included"; line.source = "Synthetic base allowance"; line.scopeConfirmed = true; });
  Object.assign(plan.lines.find(line => line.id === "entryDoorCount")!, {
    treatment: "replace-allowance", unitRateWon: rate, includedAllowanceWon: 1_500_000, allowanceSource: "Synthetic same-scope allowance",
  });
  f.scenario.quantityCost = plan;
  return plan;
}
function stage2(f: Fixture) {
  return calculatePlanningScenario(f.scenario, {
    parcel: { address: "Synthetic comparison parcel", lotAreaSqm: 900, maxFARPct: 200, maxBCRPct: 60,
      heightLimitM: 30, acquisitionCostManwon: 50000, demolitionCostManwon: 1000 },
    assumptions: { ...planningEconomicsAssumptionsFromLegacy(f.data.scenarios[0]._raw.assumptions, "cost-comparison"), ...f.inputs },
  }).economicsPreview;
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freeze);
  Object.freeze(value);
}

describe("read-only construction quote cost comparison", () => {
  it("requires allocation reconciliation even when quote assessment is ready", () => {
    const f = structuredClone(original);
    expect(assessConstructionQuote(f.scenario, f.inputs).status).toBe("ready");
    expect(buildConstructionScopeLedger(f.quote).status).toBe("incomplete");
    expect(compare(f)).toMatchObject({ status: "missing", baseConstructionCostWon: base(f),
      currentConstructionCostWon: base(f), quoteConstructionCostWon: null, differenceWon: null });
    expect(compare(f).issues.join(" ")).toContain("배분");
  });

  it("compares a package exactly once without applying it or granting approval", () => {
    const f = fixture(), result = compare(f);
    expect(result).toMatchObject({ version: CONSTRUCTION_QUOTE_COST_COMPARISON_VERSION,
      status: "ready", financialApplied: false, approvalStatus: "unverified", baseConstructionCostWon: base(f),
      materialAdjustmentWon: 0, additionalDwellingCostWon: 0, quantityAdjustmentWon: 0,
      currentConstructionCostWon: base(f), quoteConstructionCostWon: totalQuote(f), issues: [] });
    expect(CONSTRUCTION_QUOTE_COST_COMPARISON_VERSION).toBe("construction-quote-cost-comparison-2026.1");
    expect(result.differenceWon).toBe(new Decimal(totalQuote(f)).minus(base(f)).toNumber());
    const notes = result.scopeNotes.join(" ");
    for (const wording of ["추가 가산액", "확정 절감액이 아닙니다", "직접 공사비", "철거비", "간접비", "예비비", "금융비",
      "포함 범위", "중복 여부", "부가세", "입력자의 선언", "환급", "미확정", "전체 공종 물량", "전문가", "공식 승인", "외벽 공사가 무료"]) {
      expect(notes).toContain(wording);
    }
  });

  it("adds material and dwelling premiums to the raw baseline and agrees with Stage 2", () => {
    const f = fixture(); materials(f); dwellings(f); rebind(f);
    f.quote.lines[0].allocations!.forEach(part => { part.amountWon = 100_000; });
    const expected = base(f) + 3_000_000 + 2 * 100_000;
    f.scenario.economicsPreview.constructionCostManwon = 1;
    const result = compare(f);
    expect(result).toMatchObject({ status: "ready", materialAdjustmentWon: 3_000_000,
      additionalDwellingCostWon: 200_000, currentConstructionCostWon: expected });
    expect(result.differenceWon).toBe(new Decimal(totalQuote(f)).minus(expected).toNumber());
    expect(stage2(f).constructionCostManwon * 10_000).toBe(expected);
  });

  it("counts quantity replacement minus the existing allowance once alongside other premiums", () => {
    const f = fixture(); materials(f); dwellings(f); quantityPlan(f); rebind(f);
    const expected = base(f) + 3_000_000 + 200_000 + 4 * 1_000_000 - 1_500_000;
    expect(compare(f)).toMatchObject({ status: "ready", quantityAdjustmentWon: 2_500_000,
      currentConstructionCostWon: expected, differenceWon: new Decimal(totalQuote(f)).minus(expected).toNumber() });
    expect(stage2(f).constructionCostManwon * 10_000).toBe(expected);
  });

  it("preserves signed material and quantity credits", () => {
    const f = fixture(); materials(f, 330_000, 300_000); quantityPlan(f, 0); rebind(f);
    const expected = base(f) - 3_000_000 - 1_500_000;
    expect(compare(f)).toMatchObject({ status: "ready", materialAdjustmentWon: -3_000_000,
      quantityAdjustmentWon: -1_500_000, currentConstructionCostWon: expected });
    expect(stage2(f).constructionCostManwon * 10_000).toBe(expected);
  });

  it("rejects a negative final cost while preserving the legitimate signed material line", () => {
    const f = fixture(); materials(f, base(f) / 100 + 2, 1); rebind(f);
    const result = compare(f);
    expect(result).toMatchObject({ status: "conflict", baseConstructionCostWon: base(f),
      materialAdjustmentWon: -base(f) - 100, currentConstructionCostWon: null, differenceWon: null });
    expect(result.issues.join(" ")).toContain("현재 직접 공사비");
  });

  it("distinguishes valid documented zero from missing cost", () => {
    const f = fixture(); materials(f, base(f) / 100 + 1, 1); rebind(f);
    f.quote.lines.forEach(line => { line.amountWon = 0; if (line.pricing === "unit-price") line.unitRateWon = 0;
      line.allocations?.forEach(part => { part.amountWon = 0; }); });
    f.quote.statedTotalWon = 0;
    expect(compare(f)).toMatchObject({ status: "ready", currentConstructionCostWon: 0,
      quoteConstructionCostWon: 0, differenceWon: 0 });
  });

  it("keeps absence and incomplete quote amounts distinct from zero", () => {
    const f = fixture(); delete f.scenario.constructionQuote;
    expect(compare(f)).toMatchObject({ status: "absent", currentConstructionCostWon: base(f), quoteConstructionCostWon: null, differenceWon: null });
    f.scenario.constructionQuote = f.quote;
    f.quote.lines[0].amountWon = null;
    expect(compare(f)).toMatchObject({ status: "missing", currentConstructionCostWon: base(f), quoteConstructionCostWon: null, differenceWon: null });
  });

  it.each(["quote-basis", "material", "dwelling", "base-input"])("withholds a comparison after %s changes", field => {
    const f = fixture();
    if (field === "quote-basis") f.quote.sourceBasis = "stale-source";
    if (field === "material") materials(f);
    if (field === "dwelling") dwellings(f);
    if (field === "base-input") f.inputs.constructionCostPerSqmWon += 1;
    expect(compare(f)).toMatchObject({ status: "stale", quoteConstructionCostWon: null, differenceWon: null });
    expect(compare(f).currentConstructionCostWon).not.toBeNull();
  });

  it.each(["base-vat", "row-vat", "unknown-vat"])("does not compare a quote with %s uncertainty", field => {
    const f = fixture();
    if (field === "base-vat") f.quote.baseVatBasis = "excluded";
    if (field === "row-vat") f.quote.lines[0].vatBasis = "exempt";
    if (field === "unknown-vat") f.quote.baseVatBasis = "unknown";
    expect(compare(f)).toMatchObject({ status: field === "unknown-vat" ? "missing" : "conflict",
      currentConstructionCostWon: base(f), quoteConstructionCostWon: null, differenceWon: null });
  });

  it("does not describe declared not-applicable scope as zero-cost construction", () => {
    const f = fixture(), row = f.quote.lines[0], scope = f.quote.coverage[0];
    const part = row.allocations!.shift()!;
    row.amountWon! -= part.amountWon!;
    f.quote.statedTotalWon = totalQuote(f);
    scope.status = "not-applicable"; scope.lineIds = [];
    expect(buildConstructionScopeLedger(f.quote).scopes[0].amountWon).toBeNull();
    const result = compare(f);
    expect(result.status).toBe("ready");
    expect(result.quoteConstructionCostWon).toBe(totalQuote(f));
    expect(result.scopeNotes.join(" ")).toContain("0원 견적을 뜻하지 않습니다");
  });

  it.each([null, false, {}, { version: "future" }, { ...original.quote, statedTotalWon: NaN }])(
    "rejects malformed quote evidence %j without losing the current baseline", quote => {
      const f = fixture(); Object.assign(f.scenario, { constructionQuote: quote });
      expect(compare(f)).toMatchObject({ status: "conflict", currentConstructionCostWon: base(f), quoteConstructionCostWon: null, differenceWon: null });
    },
  );

  it.each([NaN, Infinity, -1, null, "2300000"])("rejects invalid base unit cost %s", rate => {
    const f = fixture(); Object.assign(f.inputs, { constructionCostPerSqmWon: rate });
    expect(compare(f)).toMatchObject({ status: "conflict", baseConstructionCostWon: null, materialAdjustmentWon: 0,
      additionalDwellingCostWon: 0, quantityAdjustmentWon: 0, currentConstructionCostWon: null, differenceWon: null });
  });

  it.each([NaN, Infinity, -1, null, "108"])("rejects invalid construction area %s", area => {
    const f = fixture(); Object.assign(f.scenario.floorPrograms[0].zones[0], { areaSqm: area });
    expect(compare(f)).toMatchObject({ status: "conflict", baseConstructionCostWon: null, currentConstructionCostWon: null, differenceWon: null });
  });

  it.each([undefined, null, [], [{ level: 1, zones: null }]])("does not treat missing floors %j as zero", floors => {
    const f = fixture(); Object.assign(f.scenario, { floorPrograms: floors });
    expect(compare(f)).toMatchObject({ status: "conflict", baseConstructionCostWon: null, currentConstructionCostWon: null, differenceWon: null });
  });

  it("uses weighted basement areas and Decimal accumulation for fractional inputs", () => {
    const f = fixture(); delete f.scenario.constructionQuote;
    f.inputs = { constructionCostPerSqmWon: 0.1, basementCostMultiplier: 1.25 };
    f.scenario.floorPrograms[0].level = -1;
    f.scenario.floorPrograms.forEach(floor => { floor.zones.forEach((zone, index) => { zone.areaSqm = index ? 0.2 : 0.1; }); });
    expect(compare(f)).toMatchObject({ status: "absent", baseConstructionCostWon: 0.0975, currentConstructionCostWon: 0.0975 });
  });

  it.each(["baseline-rate", "selected-rate", "zero-rate"])("keeps selected material %s missing rather than zero", field => {
    const f = fixture(); materials(f);
    if (field === "baseline-rate") delete f.scenario.materials!.baselineFacadeUnitCostPerSqmWon;
    if (field === "selected-rate") delete f.scenario.materials!.selectedFacadeUnitCostPerSqmWon;
    if (field === "zero-rate") f.scenario.materials!.selectedFacadeUnitCostPerSqmWon = 0;
    rebind(f);
    expect(compare(f)).toMatchObject({ status: "missing", baseConstructionCostWon: base(f), materialAdjustmentWon: null,
      currentConstructionCostWon: null, quoteConstructionCostWon: totalQuote(f), differenceWon: null });
  });

  it.each([
    ["baselineFacadeUnitCostPerSqmWon", NaN], ["selectedFacadeUnitCostPerSqmWon", -1],
    ["facadeAreaOverrideSqm", -1], ["facadeAreaOverrideSqm", Infinity], ["facadeAreaOverrideSqm", null],
    ["windowRatioPct", 90], ["windowRatioPct", NaN], ["primaryFacadeSharePct", -1],
    ["primaryFacadeMaterial", "unsupported"], ["rateEvidence", { status: "quoted" }],
  ])("rejects material input %s=%s before helper sanitization", (field, value) => {
    const f = fixture(); materials(f); Object.assign(f.scenario.materials!, { [field as string]: value });
    expect(compare(f)).toMatchObject({ status: "conflict", baseConstructionCostWon: base(f), materialAdjustmentWon: null,
      currentConstructionCostWon: null, differenceWon: null });
  });

  it.each([NaN, -1, 0, null])("rejects invalid material floor height %s", height => {
    const f = fixture(); materials(f); delete f.scenario.materials!.facadeAreaOverrideSqm;
    Object.assign(f.scenario.floorPrograms[1], { floorHeightM: height });
    expect(compare(f)).toMatchObject({ status: "conflict", baseConstructionCostWon: base(f), materialAdjustmentWon: null, currentConstructionCostWon: null });
  });

  it("uses the existing facade estimate when no override is supplied", () => {
    const f = fixture(); materials(f); delete f.scenario.materials!.facadeAreaOverrideSqm; rebind(f);
    // Enclosed floor areas are 36, 144 and 144 sqm; all heights are 3 m and windows occupy 25%.
    const expectedMaterial = (4 * 6 * 3 + 2 * 4 * 12 * 3) * 0.75 * 30_000;
    expect(compare(f)).toMatchObject({ status: "ready", materialAdjustmentWon: expectedMaterial,
      currentConstructionCostWon: base(f) + expectedMaterial });
    expect(stage2(f).constructionCostManwon * 10_000).toBe(base(f) + expectedMaterial);
  });

  it.each([null, false, { ...DEFAULT_DWELLING_PROGRAM, modelVersion: "future" },
    { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0.5 },
    { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: -1 },
    { ...DEFAULT_DWELLING_PROGRAM, additionalDwellingCostWon: NaN },
    { ...DEFAULT_DWELLING_PROGRAM, additionalDwellingCostWon: -1 },
    { ...DEFAULT_DWELLING_PROGRAM, additionalDwellingCostWon: "100000" },
  ])("rejects malformed dwelling assumptions %j", dwelling => {
    const f = fixture(); Object.assign(f.scenario, { dwellingProgram: dwelling });
    expect(compare(f)).toMatchObject({ status: "conflict", baseConstructionCostWon: base(f), additionalDwellingCostWon: null,
      currentConstructionCostWon: null, differenceWon: null });
  });

  it.each([NaN, -1, 0.5, "2"])("rejects invalid residential unit count %s", units => {
    const f = fixture(); dwellings(f); Object.assign(f.scenario.floorPrograms[1].zones[0], { unitCount: units });
    expect(compare(f)).toMatchObject({ status: "conflict", additionalDwellingCostWon: null, currentConstructionCostWon: null, differenceWon: null });
  });

  it.each([null, false, {}, { version: "future" }])("keeps malformed quantity plan %j unknown", quantity => {
    const f = fixture(); Object.assign(f.scenario, { quantityCost: quantity });
    expect(compare(f)).toMatchObject({ status: "conflict", baseConstructionCostWon: base(f), quantityAdjustmentWon: null,
      currentConstructionCostWon: null, quoteConstructionCostWon: totalQuote(f), differenceWon: null });
  });

  it.each(["unpriced", "stale", "invalid-rate", "missing-allowance", "dwelling-overlap"])("blocks %s quantity adjustment without a zero fallback", field => {
    const f = fixture();
    if (field === "dwelling-overlap") dwellings(f);
    const plan = quantityPlan(f);
    if (field === "unpriced") plan.lines[0].treatment = "unpriced";
    if (field === "stale") plan.sourceBasis = "stale-source";
    if (field === "invalid-rate") plan.lines[0].unitRateWon = NaN;
    if (field === "missing-allowance") plan.lines.find(line => line.id === "entryDoorCount")!.includedAllowanceWon = null;
    if (field === "dwelling-overlap") Object.assign(plan.lines.find(line => line.id === "kitchenCount")!, {
      treatment: "replace-allowance", unitRateWon: 1000, includedAllowanceWon: 1000, allowanceSource: "Synthetic kitchen allowance",
    });
    rebind(f);
    expect(compare(f)).toMatchObject({ status: field === "stale" ? "stale" : field === "invalid-rate" ? "conflict" : "missing",
      quantityAdjustmentWon: null, currentConstructionCostWon: null, differenceWon: null });
  });

  it("does not validate quantity costs using a silently unpriced material zero", () => {
    const f = fixture(); materials(f); delete f.scenario.materials!.selectedFacadeUnitCostPerSqmWon;
    quantityPlan(f); rebind(f);
    expect(compare(f)).toMatchObject({ status: "missing", materialAdjustmentWon: null, quantityAdjustmentWon: null,
      currentConstructionCostWon: null, differenceWon: null });
  });

  it.each(["materials", "dwellingProgram"] as const)("rejects unsupported cost fields in %s", field => {
    const f = fixture(); materials(f); dwellings(f);
    Object.assign(f.scenario[field]!, field === "materials" ? { additionalFacadeCostWon: 50_000_000 }
      : { additionalDwellingCostMultiplier: 2 });
    rebind(f);
    expect(compare(f)).toMatchObject({ status: "conflict", currentConstructionCostWon: null, differenceWon: null });
  });

  it("preserves legitimate source and nested sale-price metadata without applying it as construction cost", () => {
    const f = fixture(); materials(f); dwellings(f);
    f.scenario.materials!.rateEvidence = { status: "source-backed", sourceName: "Synthetic facade schedule",
      sourceUrl: "https://example.test/materials", observedAt: "2026-11-04", note: "Synthetic note" };
    f.scenario.dwellingProgram!.costSource = "Synthetic dwelling schedule";
    f.scenario.dwellingProgram!.salePriceBands = [{ minExclusiveSqm: 0, maxExclusiveSqm: null,
      unitPriceWon: 10_000, source: "Synthetic revenue source" }];
    Object.assign(f.scenario.dwellingProgram!.salePriceBands[0], { marketObservation: {
      methodVersion: "dwelling-market-2026.1", sourceUrl: "https://www.data.go.kr/data/15126467/openapi.do",
      asOf: "2026-11-04", projectId: f.scenario.projectId, lawdCd: "11320", dongName: "Synthetic",
      targetExclusiveSqm: 90, unitPriceWon: 10_000, addressCount: 3, sampleMinWon: 9000, sampleMaxWon: 11000,
      comparables: [], collection: { source: "MOLIT", status: "complete", sourceRetrievals: [] },
    } });
    rebind(f);
    const before = structuredClone(f.scenario);
    expect(compare(f)).toMatchObject({ status: "ready", currentConstructionCostWon: base(f) + 3_200_000 });
    expect(f.scenario).toEqual(before);
  });

  it("returns finite nullable money and does not mutate frozen inputs or stored economics", () => {
    const f = fixture(); materials(f); dwellings(f); quantityPlan(f); rebind(f);
    const before = structuredClone({ scenario: f.scenario, inputs: f.inputs });
    freeze(f.scenario); freeze(f.inputs);
    const result = compare(f);
    expect(result.status).toBe("ready");
    expect(compare(f)).toEqual(result);
    expect({ scenario: f.scenario, inputs: f.inputs }).toEqual(before);
    for (const [key, value] of Object.entries(result)) {
      if (key.endsWith("Won")) expect(value === null || typeof value === "number" && Number.isFinite(value)).toBe(true);
    }
  });
});
