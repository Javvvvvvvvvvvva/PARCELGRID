import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { calculateScenario } from "@/lib/finance/scenario";
import { DEFAULT_DWELLING_PROGRAM } from "@/lib/planning/dwelling-program";
import { interiorProgramBasis } from "@/lib/planning/interior-layout";
import { createQuantityCostDraft, evaluateQuantityCost } from "@/lib/planning/quantity-cost";
import { quantityAdjustmentForBase, quantityCostPlanBasis, type QuantityCostContract } from "@/lib/planning/quantity-cost-contract";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";
import { createDefaultPlanningMaterials } from "@/lib/planning/materials";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { recomputeFromPlanningScenarios } from "@/lib/services/recompute-from-planning-scenarios";

const original = integratedVerificationFixture();

function fixture(itemId: "entryDoorCount" | "kitchenCount" | "bathroomCount" = "entryDoorCount") {
  const input = structuredClone(original);
  const scenario = input.planningScenario!;
  const financial = input.data.scenarios[0]._raw;
  const assumptions = planningEconomicsAssumptionsFromLegacy(financial.assumptions, "quantity-binding-test");
  const inputs = {
    constructionCostPerSqmWon: assumptions.constructionCostPerSqmWon,
    basementCostMultiplier: assumptions.basementCostMultiplier,
  };
  const context = {
    parcel: { address: "서울특별시 도봉구", lotAreaSqm: 900, maxFARPct: 200, maxBCRPct: 60,
      heightLimitM: 30, acquisitionCostManwon: 50000, demolitionCostManwon: 1000, parkingRuleAsOf: "2026-10-24" },
    assumptions,
    calculatedAt: "2026-10-26T00:00:00.000Z",
  };
  const draft = createQuantityCostDraft(scenario, inputs);
  draft.lines.forEach(line => {
    line.treatment = "included";
    line.source = "Synthetic baseline scope evidence";
    line.scopeConfirmed = true;
  });
  const pricedLine = draft.lines.find(line => line.id === itemId)!;
  Object.assign(pricedLine, { treatment: "replace-allowance", unitRateWon: 1_000_000,
    includedAllowanceWon: 1_500_000, allowanceSource: "Synthetic same-scope allowance" });
  scenario.quantityCost = draft;
  const calculation = calculatePlanningScenario(scenario, context);
  const program = planningScenarioToBuildingProgram(scenario, calculation, { geometryHash: input.geometryHash });
  return { scenario, financial: { ...financial, program }, calculation, context, inputs, draft, pricedLine,
    parcel: input.data.parcel, area: program.areaContract!, contract: program.areaContract!.quantityCostAdjustment! };
}

function updateOriginalBase(contract: QuantityCostContract) {
  contract.baseConstructionCostWon = new Decimal(contract.constructionAreas.aboveGroundSqm)
    .plus(new Decimal(contract.constructionAreas.basementSqm).times(contract.inputs.basementCostMultiplier))
    .times(contract.inputs.constructionCostPerSqmWon).toNumber();
}

describe("Stage 3 original quantity cost binding", () => {
  it("keeps geometry-derived facade costs when quantity replacement is also active", () => {
    const f = fixture();
    f.scenario.materials = { ...createDefaultPlanningMaterials(), primaryFacadeMaterial: "brick-veneer",
      baselineFacadeUnitCostPerSqmWon: 100000, selectedFacadeUnitCostPerSqmWon: 150000 };
    f.draft.sourceBasis = createQuantityCostDraft(f.scenario, f.inputs).sourceBasis;
    const context = { ...f.context, parcel: { ...f.context.parcel, boundary: f.parcel.boundary,
      roads: f.parcel.roads, zoning: "일반상업지역", setback: { road: 0, side: 0, rear: 0 } } };
    const calculation = calculatePlanningScenario(f.scenario, context);
    const geometry = buildPlanningGeometry({ projectId: f.scenario.projectId!, scenario: f.scenario,
      boundary: context.parcel.boundary, roads: context.parcel.roads, zoning: context.parcel.zoning,
      setback: context.parcel.setback, lotAreaSqm: 900, sunlight: calculation.sunlight,
      roofAllowanceM: calculation.metrics.roofAllowanceM }).snapshot;
    expect(calculation.economicsPreview.facadeCost?.areaBasis).toBe("geometry-derived");
    const program = planningScenarioToBuildingProgram(f.scenario, calculation, { geometry });
    const result = calculateScenario({ parcel: f.parcel, scenario: { ...f.financial, program } });
    expect(Math.abs(result.hardCost - calculation.economicsPreview.constructionCostManwon)).toBeLessThanOrEqual(0.51);
    const recomputed = recomputeFromPlanningScenarios({ ...f.parcel, zoning: "일반상업지역",
      setback: { road: 0, side: 0, rear: 0 } }, [f.scenario], f.scenario.id, null, { calculateMaxAcquisition: false });
    expect(recomputed?.scenarios[0]._raw.program.areaContract?.facadeCost?.areaBasis).toBe("geometry-derived");
    expect(recomputed?.scenarios[0]._raw.program.areaContract?.quantityCostAdjustment).toBeDefined();
    expect(() => planningScenarioToBuildingProgram(f.scenario, calculation)).toThrow(/형상/);
    geometry.scenarioVersion += 1;
    expect(() => planningScenarioToBuildingProgram(f.scenario, calculation, { geometry })).toThrow(/형상/);
  });
  it("rejects a forged base that would otherwise subtract the entire current GFA cost", () => {
    const f = fixture();
    f.contract.baseConstructionCostWon = f.contract.allowanceWon;
    expect(() => calculateScenario({ parcel: f.parcel, scenario: f.financial })).toThrow(/상세 수량 원가/);
  });

  it.each(["constructionCostPerSqmWon", "basementCostMultiplier"] as const)("binds original %s to the locked Stage 2 inputs", key => {
    const f = fixture();
    f.contract.inputs[key] += 1;
    updateOriginalBase(f.contract);
    expect(() => quantityAdjustmentForBase(f.contract, f.contract.baseConstructionCostWon / 10000)).not.toThrow();
    expect(() => calculateScenario({ parcel: f.parcel, scenario: f.financial })).toThrow(/잠금 입력/);
  });

  it("requires locked inputs even when the quantity contract is internally consistent", () => {
    const f = fixture();
    delete f.area.stage2Economics;
    expect(() => calculateScenario({ parcel: f.parcel, scenario: f.financial })).toThrow(/잠금 입력/);
  });

  it.each(["aboveGroundSqm", "basementSqm"] as const)("rejects mismatched exact %s even with recalculated contract arithmetic", key => {
    const f = fixture();
    f.contract.constructionAreas[key] += 0.006;
    updateOriginalBase(f.contract);
    expect(() => quantityAdjustmentForBase(f.contract, f.contract.baseConstructionCostWon / 10000)).not.toThrow();
    expect(() => calculateScenario({ parcel: f.parcel, scenario: f.financial })).toThrow(/원래 면적/);
  });

  it("checks total construction area with the same rounding bound", () => {
    const f = fixture();
    f.area.constructionAreaSqm += 0.02;
    expect(() => calculateScenario({ parcel: f.parcel, scenario: f.financial })).toThrow(/원래 면적/);
  });

  it("accepts sub-centisquare-metre rounding without treating exact areas as sensitivity inputs", () => {
    const f = fixture();
    f.contract.constructionAreas.aboveGroundSqm += 0.0049;
    updateOriginalBase(f.contract);
    expect(() => calculateScenario({ parcel: f.parcel, scenario: f.financial })).not.toThrow();
  });

  it.each([0, 0.6, 1.1, 1.2])("preserves the original contract while applying current cost multiplier %s", multiplier => {
    const f = fixture();
    const before = structuredClone(f.contract);
    f.financial.assumptions.constCostPerSqM *= multiplier;
    f.financial.assumptions.basementCostMultiplier = 1.8;
    const result = calculateScenario({ parcel: f.parcel, scenario: f.financial });
    const expected = ((f.contract.baseConstructionCostWon - f.contract.allowanceWon) * multiplier +
      f.contract.replacementCostWon) / 10000;
    expect(Math.abs(result.hardCost - expected)).toBeLessThanOrEqual(0.500001);
    expect(f.contract).toEqual(before);
  });

  it.each(["above-ground", "basement"] as const)("uses exact fractional %s areas at high rates and during sensitivity", level => {
    const f = fixture();
    const floor = level === "basement" ? structuredClone(f.scenario.floorPrograms[0]) : f.scenario.floorPrograms[0];
    if (level === "basement") {
      floor.id = "fractional-basement";
      floor.level = -1;
      floor.label = "B1";
      f.scenario.floorPrograms.push(floor);
    }
    floor.zones.find(zone => zone.useType === "common")!.areaSqm += 0.0049;
    floor.interiorLayout!.programBasis = interiorProgramBasis(floor);
    f.inputs.constructionCostPerSqmWon = 100_000_000;
    f.context.assumptions.constructionCostPerSqmWon = f.inputs.constructionCostPerSqmWon;
    f.draft.inputs = { ...f.inputs };
    f.draft.sourceBasis = createQuantityCostDraft(f.scenario, f.inputs).sourceBasis;
    expect(evaluateQuantityCost(f.scenario, f.inputs).status).toBe("ready");
    const calculation = calculatePlanningScenario(f.scenario, f.context);
    const program = planningScenarioToBuildingProgram(f.scenario, calculation);
    const contract = program.areaContract!.quantityCostAdjustment!;
    const financial = { ...f.financial, program, assumptions: { ...f.financial.assumptions,
      constCostPerSqM: f.inputs.constructionCostPerSqmWon } };
    const baseline = calculateScenario({ parcel: f.parcel, scenario: financial });
    expect(Math.abs(baseline.hardCost - calculation.economicsPreview.constructionCostManwon)).toBeLessThanOrEqual(0.5051);
    const roundedBase = (program.areaContract!.aboveGroundAreaSqm + program.areaContract!.basementAreaSqm *
      financial.assumptions.basementCostMultiplier) * financial.assumptions.constCostPerSqM / 10000;
    expect(Math.abs(contract.baseConstructionCostWon / 10000 - roundedBase)).toBeGreaterThan(1);

    const stressed = { ...financial, assumptions: { ...financial.assumptions,
      constCostPerSqM: financial.assumptions.constCostPerSqM * 1.1, basementCostMultiplier: 1.8 } };
    const base = (contract.constructionAreas.aboveGroundSqm + contract.constructionAreas.basementSqm * 1.8) *
      stressed.assumptions.constCostPerSqM / 10000;
    const result = calculateScenario({ parcel: f.parcel, scenario: stressed });
    expect(Math.abs(result.hardCost - (base + quantityAdjustmentForBase(contract, base)))).toBeLessThanOrEqual(0.500001);

    const legacy = structuredClone(financial);
    delete legacy.program.areaContract!.quantityCostAdjustment;
    expect(calculateScenario({ parcel: f.parcel, scenario: legacy }).hardCost).toBe(Math.round(roundedBase));
  });

  it.each(["kitchenCount", "bathroomCount"] as const)("rejects retained dwelling premiums overlapping %s replacements", itemId => {
    const f = fixture(itemId);
    f.area.dwellingCostAdjustment = {
      unitCount: f.financial.program.units.residential, baselineDwellingCount: 0,
      costPerAdditionalUnitWon: 10000, costManwon: f.financial.program.units.residential,
      evidenceStatus: "user-input",
    };
    expect(() => calculateScenario({ parcel: f.parcel, scenario: f.financial })).toThrow(/중복/);
  });

  it("keeps nonoverlapping dwelling premiums additive", () => {
    const f = fixture();
    const before = calculateScenario({ parcel: f.parcel, scenario: f.financial });
    f.area.dwellingCostAdjustment = {
      unitCount: f.financial.program.units.residential, baselineDwellingCount: 0,
      costPerAdditionalUnitWon: 10000, costManwon: f.financial.program.units.residential,
      evidenceStatus: "user-input",
    };
    const after = calculateScenario({ parcel: f.parcel, scenario: f.financial });
    expect(after.hardCost - before.hardCost).toBe(f.financial.program.units.residential);
  });
});

describe("Stage 2 quantity cost calculation binding", () => {
  it("stores the full plan basis and accepts a fresh matching calculation", () => {
    const f = fixture();
    expect(f.calculation.economicsPreview.quantityCostInputBasis).toBe(quantityCostPlanBasis(f.draft));
    expect(() => planningScenarioToBuildingProgram(f.scenario, f.calculation)).not.toThrow();
  });

  it("rejects a nonquantity calculation reused after a valid quantity plan is added", () => {
    const f = fixture();
    const old = calculatePlanningScenario({ ...f.scenario, quantityCost: undefined }, f.context);
    expect(old.economicsPreview.status).toBe("estimated");
    expect(() => planningScenarioToBuildingProgram(f.scenario, old)).toThrow(/입력 기준/);
  });

  it("rejects a quote rate changed after calculation even when scenario version is unchanged", () => {
    const f = fixture();
    f.pricedLine.unitRateWon! += 10000;
    expect(evaluateQuantityCost(f.scenario, f.inputs).status).toBe("ready");
    expect(() => planningScenarioToBuildingProgram(f.scenario, f.calculation)).toThrow(/입력 기준/);
  });

  it("rejects old amounts even if the stored basis is forged to match the changed quote", () => {
    const f = fixture();
    f.pricedLine.unitRateWon! += 10000;
    f.calculation.economicsPreview.quantityCostInputBasis = quantityCostPlanBasis(f.draft)!;
    expect(() => planningScenarioToBuildingProgram(f.scenario, f.calculation)).toThrow(/비용 스냅샷/);
  });

  it.each(["stale", "not-calculated"] as const)("rejects a %s preview despite a valid quantity plan", status => {
    const f = fixture();
    f.calculation.economicsPreview.status = status;
    expect(() => planningScenarioToBuildingProgram(f.scenario, f.calculation)).toThrow();
  });

  it("rejects missing basis and false ready status", () => {
    const f = fixture();
    delete f.calculation.economicsPreview.quantityCostInputBasis;
    expect(() => planningScenarioToBuildingProgram(f.scenario, f.calculation)).toThrow(/입력 기준/);
    f.calculation.economicsPreview.quantityCostInputBasis = quantityCostPlanBasis(f.draft)!;
    f.calculation.economicsPreview.quantityCostStatus = "missing";
    expect(() => planningScenarioToBuildingProgram(f.scenario, f.calculation)).toThrow(/입력 기준/);
  });

  it.each([
    "baseConstructionCostManwon", "materialAdjustmentCostManwon", "additionalDwellingCostManwon",
    "quantityCostAdjustmentManwon", "constructionCostManwon", "softCostManwon", "contingencyCostManwon",
    "interestEstimateManwon", "pfFeeManwon", "trustFeeManwon", "financingCostManwon",
    "acquisitionTaxManwon", "acquisitionOtherCostManwon", "tenantRelocationCostManwon",
    "totalCostManwon", "expectedRevenueManwon", "profitManwon",
  ] as const)("rejects forged %s instead of transferring a stale snapshot", field => {
    const f = fixture();
    f.calculation.economicsPreview[field] = (f.calculation.economicsPreview[field] ?? 0) + 1;
    expect(() => planningScenarioToBuildingProgram(f.scenario, f.calculation)).toThrow(/스냅샷/);
  });

  it.each(["material", "dwelling"] as const)("recomputes raw %s adjustments instead of trusting cached costs", kind => {
    const f = fixture();
    if (kind === "material") {
      f.scenario.materials = { primaryFacadeMaterial: "brick-veneer", secondaryFacadeMaterial: "unselected",
        primaryFacadeSharePct: 100, windowRatioPct: 20, facadeAreaOverrideSqm: 100,
        baselineFacadeUnitCostPerSqmWon: 10000, selectedFacadeUnitCostPerSqmWon: 20000 };
    } else {
      f.scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0 };
    }
    f.draft.sourceBasis = createQuantityCostDraft(f.scenario, f.inputs).sourceBasis;
    f.calculation.economicsPreview.quantityCostInputBasis = quantityCostPlanBasis(f.draft)!;
    expect(evaluateQuantityCost(f.scenario, f.inputs).status).toBe("ready");
    expect(() => planningScenarioToBuildingProgram(f.scenario, f.calculation)).toThrow(/비용 스냅샷/);
  });

  it("rejects changed cost inputs and unrelated calculation areas", () => {
    const f = fixture();
    const wrongInputs = structuredClone(f.calculation);
    wrongInputs.economicsPreview.costInputs!.softCostRatePct += 1;
    expect(() => planningScenarioToBuildingProgram(f.scenario, wrongInputs)).toThrow(/비용 스냅샷/);
    f.calculation.metrics.aboveGroundProgramAreaSqm += 1;
    expect(() => planningScenarioToBuildingProgram(f.scenario, f.calculation)).toThrow(/계산 면적/);
  });

  it("accepts correctly rounded cost components and acquisition totals", () => {
    const f = fixture();
    f.pricedLine.unitRateWon = 1_234_567.89;
    f.context.parcel.acquisitionCostManwon += 0.004;
    f.context.parcel.demolitionCostManwon += 0.004;
    f.context.assumptions.softCostRatePct = 5.6789;
    f.context.assumptions.contingencyRatePct = 3.1234;
    f.context.assumptions.financingCostRatePct = 4.7891;
    f.context.assumptions.pfUpfrontFeeRatePct = 1.2345;
    f.context.assumptions.trustFeeManwon = 123.456;
    f.context.assumptions.acquisitionTaxManwon = 98.765;
    const calculation = calculatePlanningScenario(f.scenario, f.context);
    expect(() => planningScenarioToBuildingProgram(f.scenario, calculation)).not.toThrow();
  });
});
