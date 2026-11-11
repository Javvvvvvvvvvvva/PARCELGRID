import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullQuoteAdoptionFixture } from "./helpers/full-quote-adoption-fixture";
import { applyFullQuoteAdoption, assessFullQuoteAdoption, removeFullQuoteAdoption } from "@/lib/planning/full-quote-adoption";
import { validateFullQuoteCostContract } from "@/lib/planning/full-quote-cost-contract";
import { calculatePlanningScenario } from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { protectLockedPlanningGeometryPatch } from "@/lib/planning/geometry-source";
import { createQuantityCostDraft } from "@/lib/planning/quantity-cost";
import { constructionQuoteBasis } from "@/lib/planning/construction-quote";
import { createQuoteAdoptionReviewDraft } from "@/lib/planning/construction-quote-adoption-review";
import { DEFAULT_DWELLING_PROGRAM } from "@/lib/planning/dwelling-program";
import { createDefaultPlanningMaterials } from "@/lib/planning/materials";
import { recomputeFromPlanningScenarios } from "@/lib/services/recompute-from-planning-scenarios";
import { buildIntegratedVerification } from "@/lib/handoff/integrated-verification";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-11T00:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("explicit full quote adoption", () => {
  it("replaces hard cost and recalculates dependent costs without mutating evidence", () => {
    const f = fullQuoteAdoptionFixture(), before = structuredClone(f.scenario);
    const calculated = calculatePlanningScenario(f.adopted, f.context), preview = calculated.economicsPreview;
    expect(preview.fullQuoteCostIssue).toBeUndefined();
    expect(preview.fullQuoteCostStatus).toBe("ready");
    expect(preview.constructionCostManwon).toBeCloseTo(f.quote.statedTotalWon! / 10000, 2);
    expect(preview.softCostManwon).toBeCloseTo(f.quote.statedTotalWon! / 10000 * f.context.assumptions.softCostRatePct / 100, 2);
    expect(preview.totalCostManwon).not.toBe(f.before.economicsPreview.totalCostManwon);
    const program = planningScenarioToBuildingProgram(f.adopted, calculated, { geometry: f.geometry });
    expect(program.areaContract?.fullQuoteCost?.totalWon).toBe(f.quote.statedTotalWon);
    expect(program.areaContract?.quantityCostAdjustment).toBeUndefined();
    expect(f.scenario).toEqual(before);
  });
  it("removal restores the baseline and leaves the source quote intact", () => {
    const f = fullQuoteAdoptionFixture();
    const removed = { ...f.adopted, ...removeFullQuoteAdoption(f.adopted) };
    expect(calculatePlanningScenario(removed, f.context).economicsPreview.constructionCostManwon)
      .toBe(f.before.economicsPreview.constructionCostManwon);
    expect(removed.constructionQuote).toEqual(f.quote);
    expect(removed.fullQuoteAdoption).toBeUndefined();
  });
  it.each(["plan", "use", "quote", "inputs", "geometry", "total"])("rejects changed %s instead of silently using baseline", change => {
    const f = fullQuoteAdoptionFixture();
    if (change === "plan") f.adopted.floorPrograms[1].zones[0].areaSqm += 1;
    if (change === "use") f.adopted.primaryUse = "office";
    if (change === "quote") f.adopted.constructionQuote!.reference += " changed";
    if (change === "inputs") f.inputs.constructionCostPerSqmWon += 1;
    if (change === "geometry") f.geometry.parcel.officialAreaSqm += 1;
    if (change === "total") f.adopted.fullQuoteAdoption!.totalWon += 1;
    expect(() => assessFullQuoteAdoption(f.adopted, f.inputs, f.geometry)).toThrow();
  });
  it("retains visibly stale historical amounts and blocks finance conversion after raw input changes", () => {
    const f = fullQuoteAdoptionFixture();
    f.adopted.economicsPreview = calculatePlanningScenario(f.adopted, f.context).economicsPreview;
    f.adopted.floorPrograms[1].zones[0].areaSqm += 1;
    const calculated = calculatePlanningScenario(f.adopted, f.context);
    expect(calculated.economicsPreview.status).toBe("stale");
    expect(calculated.economicsPreview.fullQuoteCostStatus).toBe("stale");
    expect(calculated.economicsPreview.constructionCostManwon).toBe(f.adopted.economicsPreview.constructionCostManwon);
    expect(calculated.checks.find(check => check.code === "full-quote-cost")?.status).toBe("fail");
    expect(() => planningScenarioToBuildingProgram(f.adopted, calculated, { geometry: f.geometry })).toThrow();
  });
  it("requires current valid dates for adoption but can replay historical cost contracts", () => {
    const f = fullQuoteAdoptionFixture();
    expect(() => applyFullQuoteAdoption(f.scenario, f.inputs, f.geometry, f.draft, "2026-12-01")).toThrow();
    expect(validateFullQuoteCostContract(f.adopted.fullQuoteAdoption).totalWon).toBe(f.quote.statedTotalWon);
    expect(() => assessFullQuoteAdoption(f.adopted, f.inputs, f.geometry, "2026-12-01")).toThrow();
  });
  it("replays the original unrounded road snapshot but rejects a changed road with the same geometry hash", () => {
    const f = fullQuoteAdoptionFixture();
    const historical = structuredClone(f.geometry);
    historical.roads = [{ name: "Synthetic legacy road", source: "VWorld road centerline",
      points: [{ x: -24.00000000052653, z: 14.99999999962398 }, { x: 24.00000000052653, z: 14.99999999962398 }] }];
    const draft = { ...createQuoteAdoptionReviewDraft(f.scenario, f.inputs, historical),
      checkedOn: f.draft.checkedOn, scopes: f.draft.scopes };
    const adopted = { ...f.scenario, ...applyFullQuoteAdoption(f.scenario, f.inputs, historical, draft, draft.checkedOn) };
    const stored = JSON.parse(JSON.stringify({ adopted, historical }));
    expect(assessFullQuoteAdoption(stored.adopted, f.inputs, stored.historical, draft.checkedOn)?.totalWon)
      .toBe(adopted.fullQuoteAdoption!.totalWon);
    stored.historical.roads[0].points[0].x += 0.01;
    expect(stored.historical.geometryHash).toBe(historical.geometryHash);
    expect(() => assessFullQuoteAdoption(stored.adopted, f.inputs, stored.historical, draft.checkedOn)).toThrow(/기준/);
  });
  it("blocks locked edits at both action and store patch layers", () => {
    const f = fullQuoteAdoptionFixture();
    f.adopted.geometrySource = { mode: "engine-generated", exactGeometryAvailable: true, locked: true };
    expect(() => applyFullQuoteAdoption(f.adopted, f.inputs, f.geometry, f.draft, f.draft.checkedOn)).toThrow();
    expect(() => removeFullQuoteAdoption(f.adopted)).toThrow();
    expect(protectLockedPlanningGeometryPatch(f.adopted, { fullQuoteAdoption: undefined })).toEqual({});
  });
  it("rejects an embedded source substitution even when its total is unchanged", () => {
    const f = fullQuoteAdoptionFixture();
    f.adopted.fullQuoteAdoption!.quote.reference += " substitute";
    expect(() => assessFullQuoteAdoption(f.adopted, f.inputs, f.geometry)).toThrow();
  });
  it("rejects an old quote calculation after explicit adoption removal", () => {
    const f = fullQuoteAdoptionFixture();
    const old = calculatePlanningScenario(f.adopted, f.context);
    const removed = { ...f.adopted, ...removeFullQuoteAdoption(f.adopted) };
    expect(() => planningScenarioToBuildingProgram(removed, old, { geometry: f.geometry })).toThrow(/해제/);
  });
  it("defaults live calculator and bridge to current validity rather than the adoption date", () => {
    const f = fullQuoteAdoptionFixture();
    const old = calculatePlanningScenario(f.adopted, f.context);
    vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
    expect(calculatePlanningScenario(f.adopted, f.context).economicsPreview.status).toBe("stale");
    expect(() => planningScenarioToBuildingProgram(f.adopted, old, { geometry: f.geometry })).toThrow(/유효기간/);
    expect(assessFullQuoteAdoption(f.adopted, f.inputs, f.geometry, f.draft.checkedOn)?.totalWon).toBe(f.quote.statedTotalWon);
  });
  it.each(["", "2026-11-11x", "2026-11-31"])("rejects invalid replay dates %s", asOf => {
    const f = fullQuoteAdoptionFixture();
    expect(() => assessFullQuoteAdoption(f.adopted, f.inputs, f.geometry, asOf)).toThrow(/기준일/);
  });
  it.each(["expectedRevenueManwon", "interestEstimateManwon", "pfFeeManwon", "trustFeeManwon",
    "acquisitionTaxManwon", "acquisitionOtherCostManwon", "tenantRelocationCostManwon"] as const)("rejects a contradictory %s snapshot", field => {
    const f = fullQuoteAdoptionFixture(), calculation = calculatePlanningScenario(f.adopted, f.context);
    calculation.economicsPreview[field] = (calculation.economicsPreview[field] ?? 0) + 1;
    expect(() => planningScenarioToBuildingProgram(f.adopted, calculation, { geometry: f.geometry })).toThrow(/스냅샷/);
  });
  it("carries facade, dwelling and quantity evidence without adding any of it twice", () => {
    const f = fullQuoteAdoptionFixture();
    f.scenario.materials = { ...createDefaultPlanningMaterials(), primaryFacadeMaterial: "brick-veneer",
      facadeAreaOverrideSqm: 50, baselineFacadeUnitCostPerSqmWon: 100000, selectedFacadeUnitCostPerSqmWon: 150000 };
    f.scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0, additionalDwellingCostWon: 100000 };
    f.scenario.quantityCost = createQuantityCostDraft(f.scenario, f.inputs);
    f.scenario.quantityCost.lines.forEach(line => {
      line.treatment = "included"; line.source = "Synthetic included amount"; line.scopeConfirmed = true;
    });
    f.quote.sourceBasis = constructionQuoteBasis(f.scenario, f.inputs);
    const draft = { ...createQuoteAdoptionReviewDraft(f.scenario, f.inputs, f.geometry), checkedOn: f.draft.checkedOn, scopes: f.draft.scopes };
    const adopted = { ...f.scenario, ...applyFullQuoteAdoption(f.scenario, f.inputs, f.geometry, draft, draft.checkedOn) };
    const calculation = calculatePlanningScenario(adopted, f.context);
    expect(calculation.economicsPreview.status).toBe("estimated");
    expect(calculation.economicsPreview.constructionCostManwon).toBeCloseTo(f.quote.statedTotalWon! / 10000, 2);
    expect(calculation.economicsPreview.materialAdjustmentCostManwon).toBe(250);
    expect(calculation.economicsPreview.additionalDwellingCostManwon).toBe(20);
    const program = planningScenarioToBuildingProgram(adopted, calculation, { geometry: f.geometry });
    expect(program.areaContract?.quantityCostAdjustment).toBeUndefined();
    expect(adopted.quantityCost).toEqual(f.scenario.quantityCost);
  });
  it("recomputes the actual service path and binds the quote in independent handoff checks", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
    const f = fullQuoteAdoptionFixture();
    const data = recomputeFromPlanningScenarios(f.data.parcel, [f.adopted], f.adopted.id, f.data, {
      calculateMaxAcquisition: false, geometryHashes: { [f.adopted.id]: f.geometry.geometryHash }, startDate: "2026-11-01",
    });
    expect(data).not.toBeNull();
    expect(Math.abs(data!.scenarios[0].hardCost - f.quote.statedTotalWon! / 10000)).toBeLessThanOrEqual(0.51);
    const packet = { ...f, data: data!, planningScenario: f.adopted, geometryHash: f.geometry.geometryHash };
    expect(buildIntegratedVerification(packet).checks.find(check => check.id === "binding.full-quote-cost")?.status).toBe("checked");
    data!.scenarios[0].hardCost += 1;
    expect(buildIntegratedVerification(packet).checks.find(check => check.id === "binding.full-quote-cost")?.status).toBe("fail");
    vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
    expect(() => recomputeFromPlanningScenarios(f.data.parcel, [f.adopted], f.adopted.id, f.data)).toThrow(/유효기간/);
  });
});
