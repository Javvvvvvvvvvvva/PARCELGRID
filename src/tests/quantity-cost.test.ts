import { describe, expect, it } from "vitest";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";
import { createQuantityCostDraft, evaluateQuantityCost, applyQuantityCost } from "@/lib/planning/quantity-cost";
import { quantityAdjustmentForBase, quantityCostPlanSchema } from "@/lib/planning/quantity-cost-contract";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { calculateScenario } from "@/lib/finance/scenario";
import { DEFAULT_DWELLING_PROGRAM } from "@/lib/planning/dwelling-program";
import { protectLockedPlanningGeometryPatch } from "@/lib/planning/geometry-source";
import { clonePlanningScenario } from "@/lib/planning/scenario-utils";
import { buildIntegratedVerification, verificationApprovalBlockers } from "@/lib/handoff/integrated-verification";
import { computeProject } from "@/lib/services/compute-project";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";
import { validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { buildLayoutFinancePreview } from "@/lib/planning/layout-finance";
import { createDefaultPlanningMaterials } from "@/lib/planning/materials";

const original = integratedVerificationFixture();
function fixture() {
  const f = structuredClone(original), scenario = f.planningScenario!, financial = f.data.scenarios[0]._raw;
  const assumptions = planningEconomicsAssumptionsFromLegacy(financial.assumptions, "quantity-test");
  const inputs = { constructionCostPerSqmWon: assumptions.constructionCostPerSqmWon, basementCostMultiplier: assumptions.basementCostMultiplier };
  const context = { parcel: { address: "서울특별시 도봉구", lotAreaSqm: 900, maxFARPct: 200, maxBCRPct: 60,
    heightLimitM: 30, acquisitionCostManwon: 50000, demolitionCostManwon: 1000, parkingRuleAsOf: "2026-10-24" }, assumptions };
  const draft = createQuantityCostDraft(scenario, inputs);
  draft.lines.forEach(l => { l.treatment = "included"; l.source = "Synthetic base allowance evidence"; l.scopeConfirmed = true; });
  scenario.quantityCost = draft;
  return { ...f, scenario, financial, context, inputs, draft };
}
function priced() {
  const f = fixture(), doors = f.draft.lines.find(l => l.id === "entryDoorCount")!;
  Object.assign(doors, { treatment: "replace-allowance", unitRateWon: 1_000_000, includedAllowanceWon: 1_500_000,
    allowanceSource: "Synthetic same-scope allowance, VAT inclusive", evidenceStatus: "user-input" });
  return f;
}

describe("quantity cost adoption and replacement", () => {
  it("keeps legacy costs unchanged and starts new drafts unpriced", () => {
    const f = fixture(); delete f.scenario.quantityCost;
    expect(evaluateQuantityCost(f.scenario, f.inputs).status).toBe("absent");
    const draft = createQuantityCostDraft(f.scenario, f.inputs);
    expect(draft.lines.every(l => l.treatment === "unpriced" && l.unitRateWon === null)).toBe(true);
    expect(evaluateQuantityCost({ ...f.scenario, quantityCost: draft }, f.inputs)).toMatchObject({ status: "missing", adjustmentManwon: null });
  });

  it("does not add included quantities again and subtracts same-scope allowances exactly once", () => {
    const included = fixture();
    expect(evaluateQuantityCost(included.scenario, included.inputs)).toMatchObject({ status: "ready", adjustmentManwon: 0 });
    const f = priced(), result = evaluateQuantityCost(f.scenario, f.inputs);
    expect(result.status, result.issues.join(" ")).toBe("ready");
    // Two modeled entries per household: 4 x 1,000,000 - 1,500,000 = 250 manwon.
    expect(result.contract).toMatchObject({ allowanceWon: 1_500_000, replacementCostWon: 4_000_000, adjustmentManwon: 250 });
    expect(result.adjustmentManwon).toBe(250);
    const before = calculatePlanningScenario({ ...f.scenario, quantityCost: undefined }, f.context);
    const after = calculatePlanningScenario(f.scenario, f.context);
    expect(after.economicsPreview.constructionCostManwon - before.economicsPreview.constructionCostManwon).toBe(250);
    expect(after.economicsPreview.totalCostManwon).toBeGreaterThan(before.economicsPreview.totalCostManwon + 250);
    expect(after.economicsPreview.expectedRevenueManwon).toBe(before.economicsPreview.expectedRevenueManwon);
    expect(after.parking).toEqual(before.parking);
  });

  it("carries one hard cost through Stage3 and scales only remaining base scope in cost sensitivity", () => {
    const f = priced(), calculation = calculatePlanningScenario(f.scenario, f.context);
    const program = planningScenarioToBuildingProgram(f.scenario, calculation, { geometryHash: f.geometryHash });
    const updated = { ...f.financial, program };
    const result = calculateScenario({ parcel: f.data.parcel, scenario: updated });
    const baseline = calculateScenario({ parcel: f.data.parcel, scenario: f.financial });
    expect(result.hardCost - baseline.hardCost).toBe(250);
    expect(result.softCost - baseline.softCost).toBeCloseTo(250 * f.financial.assumptions.softCostRate / 100, 0);
    expect(result.totalRevenue).toBe(baseline.totalRevenue);
    const contract = program.areaContract!.quantityCostAdjustment!;
    expect(quantityAdjustmentForBase(contract, contract.baseConstructionCostWon * 1.1 / 10000)).toBeCloseTo(235, 8);
    const sensitivity = calculateScenario({ parcel: f.data.parcel, scenario: { ...updated,
      assumptions: { ...updated.assumptions, constCostPerSqM: updated.assumptions.constCostPerSqM * 1.1 } } });
    const expected = (contract.baseConstructionCostWon - 1_500_000) * 1.1 / 10000 + 400;
    expect(Math.abs(sensitivity.hardCost - expected)).toBeLessThanOrEqual(0.5);
  });

  it.each(["missing-rate", "missing-allowance", "missing-evidence", "missing-scope", "too-large"])("blocks %s without treating it as zero", kind => {
    const f = priced(), line = f.draft.lines.find(l => l.treatment === "replace-allowance")!;
    if (kind === "missing-rate") line.unitRateWon = null;
    if (kind === "missing-allowance") line.includedAllowanceWon = null;
    if (kind === "missing-evidence") line.allowanceSource = " ";
    if (kind === "missing-scope") line.scopeConfirmed = false;
    if (kind === "too-large") line.includedAllowanceWon = 1e13;
    expect(evaluateQuantityCost(f.scenario, f.inputs)).toMatchObject({ status: "missing", adjustmentManwon: null, contract: null });
    const calculation = calculatePlanningScenario(f.scenario, f.context);
    expect(calculation.checks).toContainEqual(expect.objectContaining({ code: "quantity-cost", status: "fail" }));
    expect(() => planningScenarioToBuildingProgram(f.scenario, calculation)).toThrow();
  });

  it("blocks duplicate kitchen/bathroom packages while additional dwelling premiums remain", () => {
    const f = fixture(); f.scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0 };
    f.draft.sourceBasis = createQuantityCostDraft(f.scenario, f.inputs).sourceBasis;
    Object.assign(f.draft.lines.find(l => l.id === "kitchenCount")!, { treatment: "replace-allowance",
      unitRateWon: 4_000_000, includedAllowanceWon: 5_000_000, allowanceSource: "Synthetic allowance" });
    expect(evaluateQuantityCost(f.scenario, f.inputs).issues.join(" ")).toContain("추가 세대 가산비");
  });

  it.each([null, "", "2000000"])("does not silently drop invalid existing dwelling rate %s", rate => {
    const f = fixture();
    f.scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0 };
    Object.assign(f.scenario.dwellingProgram, { additionalDwellingCostWon: rate });
    f.draft.sourceBasis = createQuantityCostDraft(f.scenario, f.inputs).sourceBasis;
    expect(evaluateQuantityCost(f.scenario, f.inputs).status).toBe("conflict");
  });

  it.each(["floor-height", "door", "placement", "base-cost"])("invalidates %s even with the same scenario version and geometry hash", field => {
    const f = priced();
    if (field === "floor-height") f.scenario.floorPrograms[1].floorHeightM += 0.1;
    if (field === "door") f.scenario.floorPrograms[1].interiorLayout!.roomLayouts![0].doors[0].widthM += 0.01;
    if (field === "placement") f.scenario.placement.offsetXM += 0.1;
    if (field === "base-cost") f.inputs.constructionCostPerSqmWon++;
    expect(evaluateQuantityCost(f.scenario, f.inputs).status).toBe("stale");
  });

  it("rejects tampered totals, duplicated items, fractional counts and ignored prices", () => {
    const f = priced(), good = evaluateQuantityCost(f.scenario, f.inputs).contract!;
    for (const mutate of [
      (c: typeof good) => { c.adjustmentManwon++; },
      (c: typeof good) => { c.allowanceWon++; },
      (c: typeof good) => { c.lines[1] = structuredClone(c.lines[0]); },
      (c: typeof good) => { c.lines.find(l => l.id === "entryDoorCount")!.quantity = 2.5; },
      (c: typeof good) => { c.lines.find(l => l.treatment === "included")!.unitRateWon = 1; },
    ]) {
      const c = structuredClone(good); mutate(c);
      expect(() => quantityAdjustmentForBase(c, 100000)).toThrow();
    }
    expect(quantityCostPlanSchema.safeParse({ ...f.draft, lines: [] }).success).toBe(false);
  });

  it("allows explicit zero quotes and negative adjustments with source evidence", () => {
    const f = priced(); f.draft.lines.find(l => l.id === "entryDoorCount")!.unitRateWon = 0;
    expect(evaluateQuantityCost(f.scenario, f.inputs)).toMatchObject({ status: "ready", adjustmentManwon: -150 });
  });

  it("does not clamp an impossible combined material deduction to a successful zero construction cost", () => {
    const f = fixture();
    f.scenario.materials = { ...createDefaultPlanningMaterials(), primaryFacadeMaterial: "standard-render",
      facadeAreaOverrideSqm: 1000, baselineFacadeUnitCostPerSqmWon: 100_000_000, selectedFacadeUnitCostPerSqmWon: 1 };
    f.draft.sourceBasis = createQuantityCostDraft(f.scenario, f.inputs).sourceBasis;
    expect(evaluateQuantityCost(f.scenario, f.inputs)).toMatchObject({ status: "conflict", contract: null, adjustmentManwon: null });
  });

  it("requires current geometry and protects locked or cloned scenarios", () => {
    const f = priced();
    expect(applyQuantityCost(f.scenario, f.draft, f.inputs, f.geometry).patch?.quantityCost).toEqual(f.draft);
    expect(applyQuantityCost(f.scenario, f.draft, f.inputs, null).error).toBeTruthy();
    f.scenario.geometrySource = { mode: "engine-generated", locked: true, exactGeometryAvailable: true };
    expect(applyQuantityCost(f.scenario, f.draft, f.inputs, f.geometry).error).toBeTruthy();
    expect(protectLockedPlanningGeometryPatch(f.scenario, { quantityCost: undefined })).not.toHaveProperty("quantityCost");
    expect(clonePlanningScenario(f.scenario).quantityCost).toBeUndefined();
  });

  it("preserves valid cost plans in workspace JSON but rejects malformed records", () => {
    const f = priced(), payload = projectWorkspaceFixture(f.projectId);
    payload.planningScenarios = [f.scenario];
    expect(validateProjectWorkspacePayload(payload, f.projectId).valid).toBe(true);
    expect(JSON.parse(JSON.stringify(payload)).planningScenarios[0].quantityCost).toEqual(f.draft);
    f.draft.lines[0].unitRateWon = Number.NaN;
    expect(validateProjectWorkspacePayload(payload, f.projectId).errors.join(" ")).toContain("상세 수량 원가");
  });

  it("does not preview or adopt area changes as if a stale quantity allowance were zero", () => {
    const f = priced();
    const preview = buildLayoutFinancePreview({ scenario: f.scenario, geometry: f.geometry, context: f.context,
      options: { areaBasis: "room-clear", floorIds: f.scenario.floorPrograms.slice(1).map(floor => floor.id) } });
    expect(preview.status).toBe("blocked");
    expect(preview.issues.join(" ")).toContain("상세 수량 원가");
    expect(preview.after).toBeNull();
  });

  it("recomputes sealed quantities and blocks stale/tampered financial contracts without claiming full BOQ coverage", () => {
    const f = priced(), calculation = calculatePlanningScenario(f.scenario, f.context);
    f.data = computeProject(f.data.parcel, [{ ...f.financial, program: planningScenarioToBuildingProgram(f.scenario, calculation,
      { geometryHash: f.geometryHash }) }], { recommendedId: f.scenario.id, calculateMaxAcquisition: false, startDate: "2026-10-01" });
    const report = buildIntegratedVerification(f);
    expect(report.checks.find(c => c.id === "binding.quantity-cost")).toMatchObject({ status: "checked" });
    expect(report.checks.find(c => c.id === "binding.quantity-hard-cost")).toMatchObject({ status: "checked" });
    expect(verificationApprovalBlockers(report, "finance-tax")).toContainEqual(expect.objectContaining({ id: "quantity-cost.finance-tax", status: "missing" }));
    f.data.scenarios[0]._raw.program.areaContract!.quantityCostAdjustment!.lines[0].quantity++;
    expect(buildIntegratedVerification(f).checks.find(c => c.id === "binding.quantity-cost")).toMatchObject({ status: "fail" });
  });

  it.each([null, "", "0", false])("does not coerce missing or nonnumeric snapshot money %s into a checked cost", value => {
    const f = priced(), calculation = calculatePlanningScenario(f.scenario, f.context);
    f.data = computeProject(f.data.parcel, [{ ...f.financial, program: planningScenarioToBuildingProgram(f.scenario, calculation,
      { geometryHash: f.geometryHash }) }], { recommendedId: f.scenario.id, calculateMaxAcquisition: false, startDate: "2026-10-01" });
    const raw = f.data.scenarios[0]._raw;
    Object.assign(raw.program.areaContract!.stage2Economics!.inputs, { constructionCostPerSqmWon: value });
    expect(buildIntegratedVerification(f).checks.find(c => c.id === "binding.quantity-cost")?.status).toBe("fail");
    Object.assign(raw.program.areaContract!.stage2Economics!.inputs, { constructionCostPerSqmWon: f.inputs.constructionCostPerSqmWon });
    Object.assign(raw.assumptions, { constCostPerSqM: value });
    expect(buildIntegratedVerification(f).checks.find(c => c.id === "binding.quantity-hard-cost")?.status).not.toBe("checked");
  });

  it("rejects an independently forged dwelling premium even when hard cost arithmetic is updated to match", () => {
    const f = priced(), calculation = calculatePlanningScenario(f.scenario, f.context);
    f.data = computeProject(f.data.parcel, [{ ...f.financial, program: planningScenarioToBuildingProgram(f.scenario, calculation,
      { geometryHash: f.geometryHash }) }], { recommendedId: f.scenario.id, calculateMaxAcquisition: false, startDate: "2026-10-01" });
    const vm = f.data.scenarios[0];
    vm._raw.program.areaContract!.dwellingCostAdjustment = { unitCount: 2, baselineDwellingCount: 0,
      costPerAdditionalUnitWon: 1_000_000, costManwon: 200, evidenceStatus: "assumed" };
    vm.hardCost += 200;
    const report = buildIntegratedVerification(f);
    expect(report.checks.find(c => c.id === "binding.quantity-existing-adjustments")?.status).toBe("fail");
    expect(report.checks.find(c => c.id === "binding.quantity-hard-cost")?.status).toBe("fail");
  });
});
