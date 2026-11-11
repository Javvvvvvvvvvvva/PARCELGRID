import { describe, expect, it } from "vitest";
import {
  calculateScenarioWithCostSensitivity,
  CONSTRUCTION_COST_SENSITIVITY_VERSION,
  verifiedConstructionCostSensitivity,
  type ConstructionCostCase,
  type ConstructionCostSensitivity,
} from "@/lib/finance/construction-cost-sensitivity";
import { PROJECT_LEDGER_MODEL_VERSION } from "@/lib/finance/project-ledger";
import {
  calculateScenario,
  defaultAssumptions,
  defaultProgram,
  type CalcInput,
} from "@/lib/finance/scenario";
import type { AssumptionSet, ScenarioResult } from "@/lib/finance/types";
import { interiorProgramBasis } from "@/lib/planning/interior-layout";
import { createQuantityCostDraft, evaluateQuantityCost } from "@/lib/planning/quantity-cost";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { computeProject } from "@/lib/services/compute-project";
import { integratedVerificationFixture } from "../helpers/integrated-verification-fixture";

function fixture(overrides: Partial<AssumptionSet> = {}): CalcInput {
  return {
    parcel: {
      id: "cost-sensitivity-parcel",
      address: "Synthetic cost sensitivity parcel",
      addressRoad: "Synthetic frontage",
      lotArea: 300,
      zoning: "",
      zoneCode: "",
      maxFAR: 220,
      maxBCR: 60,
      heightLimit: 30,
      setback: { road: 0, side: 0, rear: 0 },
      landPrice: 2_000_000,
      estMarketPrice: 4_000_000,
      acquired: "2026-01-01",
      acquiredPrice: 50_000,
      demolitionCost: 2_000,
    },
    scenario: {
      id: "COST",
      name: "Cost sensitivity fixture",
      shortName: "Cost",
      program: { ...defaultProgram("multi-family", 150, 55), floorsBelow: 0 },
      assumptions: {
        ...defaultAssumptions(),
        salePricePerSqM: 12_000_000,
        interestRate: 9,
        pfUpfrontFeeRate: 2,
        trustFeeManwon: 1_500,
        designMonths: 4,
        constructionMonths: 12,
        saleOutMonths: 3,
        ...overrides,
      },
    },
  };
}

const SUMMARY_KEYS = [
  "hardCost", "softCost", "contingency", "interestCost", "pfFee", "trustFee",
  "financingCost", "totalCost", "totalRevenue", "profit", "irr", "irrStatus",
  "npv", "funding", "maxExposure", "totalMonths", "equityCashFlowsManwon",
  "profitUnroundedManwon", "npvUnroundedManwon", "irrUnroundedPct",
] as const satisfies readonly (keyof ScenarioResult)[];

function summary(result: ScenarioResult) {
  return Object.fromEntries(SUMMARY_KEYS.map(key => [key, result[key]]));
}

function calculated(costCase: ConstructionCostCase) {
  expect(costCase.status).toBe("calculated");
  if (costCase.status !== "calculated") throw new Error(costCase.reason);
  return costCase.result;
}

function independent(input: CalcInput, multiplier: number) {
  return calculateScenario({
    ...input,
    scenario: {
      ...input.scenario,
      assumptions: {
        ...input.scenario.assumptions,
        constCostPerSqM: input.scenario.assumptions.constCostPerSqM * multiplier,
      },
    },
  });
}

function expectIndependentCases(input: CalcInput, sensitivity: ConstructionCostSensitivity) {
  for (const [key, multiplier] of [["low", 0.85], ["base", 1], ["high", 1.2]] as const) {
    expect(sensitivity[key]).toEqual({
      multiplier,
      unitCostPerSqmWon: input.scenario.assumptions.constCostPerSqM * multiplier,
      status: "calculated",
      result: summary(independent(input, multiplier)),
    });
  }
}

function coreResult(result: ScenarioResult) {
  const core = { ...result };
  delete core.constructionCostSensitivity;
  delete core.profitAtLowCost;
  delete core.profitAtHighCost;
  delete core.constructionCostLow;
  delete core.constructionCostHigh;
  return core;
}

function freezeDeep(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  Object.values(value).forEach(freezeDeep);
  Object.freeze(value);
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)]));
}

function quantityFixture(fractionalLevel?: "above-ground" | "basement"): CalcInput {
  const original = integratedVerificationFixture();
  const planning = original.planningScenario!;
  const financial = original.data.scenarios[0]._raw;
  const assumptions = planningEconomicsAssumptionsFromLegacy(financial.assumptions, "cost-sensitivity-test");
  if (fractionalLevel) {
    const floor = fractionalLevel === "basement"
      ? structuredClone(planning.floorPrograms[0]) : planning.floorPrograms[0];
    if (fractionalLevel === "basement") {
      floor.id = "fractional-basement";
      floor.level = -1;
      floor.label = "B1";
      planning.floorPrograms.push(floor);
    }
    floor.zones.find(zone => zone.useType === "common")!.areaSqm += 0.0049;
    floor.interiorLayout!.programBasis = interiorProgramBasis(floor);
    assumptions.constructionCostPerSqmWon = 100_000_000;
  }
  const inputs = {
    constructionCostPerSqmWon: assumptions.constructionCostPerSqmWon,
    basementCostMultiplier: assumptions.basementCostMultiplier,
  };
  const draft = createQuantityCostDraft(planning, inputs);
  for (const line of draft.lines) {
    line.treatment = "included";
    line.source = "Synthetic baseline scope evidence";
    line.scopeConfirmed = true;
  }
  Object.assign(draft.lines.find(line => line.id === "entryDoorCount")!, {
    treatment: "replace-allowance",
    unitRateWon: 2_000_000,
    includedAllowanceWon: 1_500_000,
    allowanceSource: "Synthetic same-scope allowance",
    evidenceStatus: "quoted",
  });
  planning.quantityCost = draft;
  expect(evaluateQuantityCost(planning, inputs).status).toBe("ready");
  const calculation = calculatePlanningScenario(planning, {
    parcel: {
      address: original.data.parcel.address,
      lotAreaSqm: 900,
      maxFARPct: 200,
      maxBCRPct: 60,
      heightLimitM: 30,
      acquisitionCostManwon: 50_000,
      demolitionCostManwon: 1_000,
      parkingRuleAsOf: "2026-10-24",
    },
    assumptions,
    calculatedAt: "2026-10-26T00:00:00.000Z",
  });
  return {
    parcel: original.data.parcel,
    scenario: {
      ...financial,
      program: planningScenarioToBuildingProgram(planning, calculation),
      assumptions: { ...financial.assumptions, constCostPerSqM: inputs.constructionCostPerSqmWon },
    },
  };
}

describe("construction cost sensitivity monthly calculations", () => {
  it("preserves every baseline result and leaves legacy range fields out of the core engine", () => {
    const input = fixture();
    const base = calculateScenario(input);
    const wrapped = calculateScenarioWithCostSensitivity(input);
    expect(coreResult(wrapped)).toEqual(base);
    for (const key of ["constructionCostSensitivity", "profitAtLowCost", "profitAtHighCost", "constructionCostLow", "constructionCostHigh"]) {
      expect(base).not.toHaveProperty(key);
    }
    expect(wrapped.constructionCostSensitivity).toMatchObject({
      modelVersion: CONSTRUCTION_COST_SENSITIVITY_VERSION,
      ledgerModelVersion: PROJECT_LEDGER_MODEL_VERSION,
      method: "base-unit-rate",
    });
    expectIndependentCases(input, wrapped.constructionCostSensitivity);
    expect(wrapped.profitAtLowCost).toBe(calculated(wrapped.constructionCostSensitivity.low).profit);
    expect(wrapped.profitAtHighCost).toBe(calculated(wrapped.constructionCostSensitivity.high).profit);
    expect(wrapped.constructionCostLow).toBe(calculated(wrapped.constructionCostSensitivity.low).hardCost);
    expect(wrapped.constructionCostHigh).toBe(calculated(wrapped.constructionCostSensitivity.high).hardCost);
  });

  it("changes interest and PF fees instead of using the former linear profit approximation", () => {
    const { constructionCostSensitivity: sensitivity } = calculateScenarioWithCostSensitivity(fixture());
    const base = sensitivity.base.result;
    const low = calculated(sensitivity.low);
    const high = calculated(sensitivity.high);
    const linearHighProfit = base.profit - (base.hardCost + base.softCost + base.contingency) * 0.2;
    expect(low.interestCost).toBeLessThan(base.interestCost);
    expect(high.interestCost).toBeGreaterThan(base.interestCost);
    expect(high.pfFee).toBeGreaterThan(base.pfFee);
    expect(high.trustFee).toBe(base.trustFee);
    expect(high.totalRevenue).toBe(base.totalRevenue);
    expect(high.profit).toBeLessThan(linearHighProfit - 1);
    expect(high.npv).not.toBe(base.npv);
    expect(high.irr).not.toBe(base.irr);
    expect(high.equityCashFlowsManwon).not.toEqual(base.equityCashFlowsManwon);
  });

  it("supports zero interest, fees and ancillary cost rates", () => {
    const input = fixture({ interestRate: 0, pfUpfrontFeeRate: 0, trustFeeManwon: 0, softCostRate: 0, contingencyRate: 0 });
    const sensitivity = calculateScenarioWithCostSensitivity(input).constructionCostSensitivity;
    expectIndependentCases(input, sensitivity);
    for (const key of ["low", "base", "high"] as const) {
      expect(calculated(sensitivity[key])).toMatchObject({
        interestCost: 0, pfFee: 0, trustFee: 0, financingCost: 0, softCost: 0, contingency: 0,
      });
    }
  });

  it("keeps a zero base unit rate at zero in both stress cases", () => {
    const input = fixture({ constCostPerSqM: 0 });
    const sensitivity = calculateScenarioWithCostSensitivity(input).constructionCostSensitivity;
    expectIndependentCases(input, sensitivity);
    expect(calculated(sensitivity.low)).toEqual(sensitivity.base.result);
    expect(calculated(sensitivity.high)).toEqual(sensitivity.base.result);
    expect(sensitivity.base.result.hardCost).toBe(0);
  });

  it("retains presale timing and a confirmed equity shortfall in every case", () => {
    const input = fixture({ salesPaceMonthlyPct: 5, equityCommitmentManwon: 1 });
    input.scenario.program.type = "officetel";
    const sensitivity = calculateScenarioWithCostSensitivity(input).constructionCostSensitivity;
    expectIndependentCases(input, sensitivity);
    for (const key of ["low", "base", "high"] as const) {
      const result = calculated(sensitivity[key]);
      expect(result.totalMonths).toBe(4 + 12 + 20);
      expect(result.equityCashFlowsManwon).toHaveLength(result.totalMonths + 1);
      expect(result.funding).toMatchObject({ status: "shortfall", equityCommitmentManwon: 1, firstShortfallMonth: 0 });
      expect(result.funding.shortfallManwon).toBeGreaterThan(0);
    }
    const bulk = structuredClone(input);
    bulk.scenario.program.type = "multi-family";
    expect(sensitivity.base.result.equityCashFlowsManwon).not.toEqual(calculateScenario(bulk).equityCashFlowsManwon);
  });

  it("recomputes a high-cost funding shortage even when the baseline is funded", () => {
    const input = fixture();
    const baseRequired = independent(input, 1).funding.requiredEquityManwon;
    const highRequired = independent(input, 1.2).funding.requiredEquityManwon;
    expect(highRequired).toBeGreaterThan(baseRequired + 1);
    input.scenario.assumptions.equityCommitmentManwon = Math.ceil((baseRequired + highRequired) / 2);
    const sensitivity = calculateScenarioWithCostSensitivity(input).constructionCostSensitivity;
    expectIndependentCases(input, sensitivity);
    expect(sensitivity.base.result.funding.status).toBe("funded");
    expect(calculated(sensitivity.low).funding.status).toBe("funded");
    const high = calculated(sensitivity.high);
    expect(high.funding.status).toBe("shortfall");
    expect(high.funding.shortfallManwon).toBeGreaterThan(0);
    expect(high.funding.firstShortfallMonth).toBeGreaterThan(0);
  });

  it("keeps a valid 1e9 baseline when only the high unit rate exceeds the input bound", () => {
    const input = fixture({ constCostPerSqM: 1_000_000_000 });
    const base = calculateScenario(input);
    const wrapped = calculateScenarioWithCostSensitivity(input);
    expect(coreResult(wrapped)).toEqual(base);
    expect(calculated(wrapped.constructionCostSensitivity.low)).toEqual(summary(independent(input, 0.85)));
    expect(() => independent(input, 1.2)).toThrow();
    expect(wrapped.constructionCostSensitivity.high).toEqual({
      multiplier: 1.2, unitCostPerSqmWon: 1_200_000_000, status: "unavailable", reason: expect.any(String),
    });
    expect(wrapped.profitAtHighCost).toBeUndefined();
    expect(wrapped.constructionCostHigh).toBeUndefined();
    expect(verifiedConstructionCostSensitivity(input, wrapped.constructionCostSensitivity)).toEqual(wrapped.constructionCostSensitivity);
  });

  it("preserves the baseline when a fixed material credit makes only low-cost hard cost negative", () => {
    const input = quantityFixture();
    const originalHardCost = calculateScenario(input).hardCost;
    input.scenario.program.areaContract!.materialAdjustmentCostManwon = -originalHardCost * 0.9;
    const base = calculateScenario(input);
    expect(base.hardCost).toBeGreaterThan(0);
    expect(() => independent(input, 0.85)).toThrow();
    const wrapped = calculateScenarioWithCostSensitivity(input);
    expect(coreResult(wrapped)).toEqual(base);
    expect(wrapped.constructionCostSensitivity.low).toEqual({
      multiplier: 0.85,
      unitCostPerSqmWon: input.scenario.assumptions.constCostPerSqM * 0.85,
      status: "unavailable", reason: expect.any(String),
    });
    expect(calculated(wrapped.constructionCostSensitivity.high)).toEqual(summary(independent(input, 1.2)));
    expect(wrapped.profitAtLowCost).toBeUndefined();
    expect(wrapped.constructionCostLow).toBeUndefined();
    expect(verifiedConstructionCostSensitivity(input, wrapped.constructionCostSensitivity)).toEqual(wrapped.constructionCostSensitivity);
  });
});

describe("saved construction cost sensitivity verification", () => {
  const rawMutations: Array<[string, (input: CalcInput) => void]> = [
    ["land price", input => { input.parcel.acquiredPrice += 1_000; }],
    ["demolition cost", input => { input.parcel.demolitionCost! += 1_000; }],
    ["lot area", input => { input.parcel.lotArea += 20; }],
    ["floor area ratio", input => { input.scenario.program.far += 10; }],
    ["construction rate", input => { input.scenario.assumptions.constCostPerSqM += 100_000; }],
    ["sale price", input => { input.scenario.assumptions.salePricePerSqM += 100_000; }],
    ["interest rate", input => { input.scenario.assumptions.interestRate += 1; }],
    ["construction duration", input => { input.scenario.assumptions.constructionMonths += 1; }],
    ["equity commitment", input => { input.scenario.assumptions.equityCommitmentManwon = 1; }],
  ];
  it.each(rawMutations)("rejects a stored calculation after raw %s changes", (_, mutate) => {
    const input = fixture();
    const stored = calculateScenarioWithCostSensitivity(input).constructionCostSensitivity;
    mutate(input);
    expect(verifiedConstructionCostSensitivity(input, stored)).toBeNull();
  });

  it.each([undefined, null, {}, { profitAtLowCost: 100, profitAtHighCost: 50 }])("rejects missing or legacy-only stored data: %j", stored => {
    expect(verifiedConstructionCostSensitivity(fixture(), stored)).toBeNull();
  });

  const storedMutations: Array<[string, (stored: ConstructionCostSensitivity) => void]> = [
    ["legacy model version", stored => { Object.assign(stored, { modelVersion: "construction-cost-2025.1" }); }],
    ["legacy ledger version", stored => { Object.assign(stored, { ledgerModelVersion: "project-ledger-2025.1" }); }],
    ["method", stored => { Object.assign(stored, { method: "linear" }); }],
    ["missing high row", stored => { Reflect.deleteProperty(stored, "high"); }],
    ["extra summary field", stored => { Object.assign(calculated(stored.high), { forged: 1 }); }],
    ["case multiplier", stored => { stored.low.multiplier = 0.8; }],
    ["case unit rate", stored => { stored.high.unitCostPerSqmWon += 1; }],
    ["case status", stored => { Object.assign(stored.high, { status: "unavailable" }); }],
    ["baseline profit", stored => { stored.base.result.profit += 1; }],
    ["high profit", stored => { calculated(stored.high).profit += 1; }],
    ["low interest", stored => { calculated(stored.low).interestCost += 1; }],
    ["funding requirement", stored => { calculated(stored.high).funding.requiredEquityManwon += 1; }],
    ["monthly cash flow", stored => { calculated(stored.high).equityCashFlowsManwon[1] += 1; }],
    ["missing cash flow month", stored => { calculated(stored.low).equityCashFlowsManwon.pop(); }],
    ["extra cash flow month", stored => { calculated(stored.high).equityCashFlowsManwon.push(0); }],
    ["reordered cash flow months", stored => { calculated(stored.high).equityCashFlowsManwon.reverse(); }],
  ];
  it.each(storedMutations)("rejects edited %s", (_, mutate) => {
    const input = fixture();
    const stored = structuredClone(calculateScenarioWithCostSensitivity(input).constructionCostSensitivity);
    mutate(stored);
    expect(verifiedConstructionCostSensitivity(input, stored)).toBeNull();
  });

  it("accepts a JSON round trip with recursively reordered object keys", () => {
    const input = fixture();
    const expected = calculateScenarioWithCostSensitivity(input).constructionCostSensitivity;
    const stored: unknown = JSON.parse(JSON.stringify(reverseObjectKeys(expected)));
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(expected));
    expect(verifiedConstructionCostSensitivity(input, stored)).toEqual(expected);
  });

  it("returns null when current raw inputs no longer produce a valid baseline", () => {
    const input = fixture();
    const stored = calculateScenarioWithCostSensitivity(input).constructionCostSensitivity;
    input.scenario.assumptions.constCostPerSqM = -1;
    expect(verifiedConstructionCostSensitivity(input, stored)).toBeNull();
  });

  it("does not mutate frozen raw inputs or saved calculation data", () => {
    const input = fixture();
    const before = structuredClone(input);
    freezeDeep(input);
    const wrapped = calculateScenarioWithCostSensitivity(input);
    const stored = wrapped.constructionCostSensitivity;
    const storedBefore = structuredClone(stored);
    freezeDeep(stored);
    expect(verifiedConstructionCostSensitivity(input, stored)).toEqual(storedBefore);
    expect(input).toEqual(before);
    expect(stored).toEqual(storedBefore);
  });
});

describe("quantity replacement cost sensitivity", () => {
  it.each([undefined, "above-ground", "basement"] as const)("stresses only residual allowances and preserves fixed quotes with %s fractional areas", fractionalLevel => {
    const input = quantityFixture(fractionalLevel);
    const before = structuredClone(input);
    const area = input.scenario.program.areaContract!;
    const contract = area.quantityCostAdjustment!;
    const replacement = contract.replacementCostWon / 10_000;
    const residual = (contract.baseConstructionCostWon - contract.allowanceWon) / 10_000;
    expect(replacement).toBeGreaterThan(0);
    freezeDeep(input);
    const sensitivity = calculateScenarioWithCostSensitivity(input).constructionCostSensitivity;
    expectIndependentCases(input, sensitivity);
    for (const [key, multiplier] of [["low", 0.85], ["base", 1], ["high", 1.2]] as const) {
      expect(Math.abs(calculated(sensitivity[key]).hardCost - (residual * multiplier + replacement))).toBeLessThanOrEqual(0.500001);
    }
    expect(Math.abs(calculated(sensitivity.high).hardCost - sensitivity.base.result.hardCost * 1.2)).toBeGreaterThan(1);
    if (fractionalLevel) {
      const roundedBase = (area.aboveGroundAreaSqm + area.basementAreaSqm * input.scenario.assumptions.basementCostMultiplier)
        * input.scenario.assumptions.constCostPerSqM / 10_000;
      expect(Math.abs(contract.baseConstructionCostWon / 10_000 - roundedBase)).toBeGreaterThan(1);
    }
    expect(verifiedConstructionCostSensitivity(input, sensitivity)).toEqual(sensitivity);
    expect(input).toEqual(before);
  });
});

describe("project downside comparison", () => {
  it("uses the independently calculated high-cost profit for the downstream leader", () => {
    const input = fixture();
    const cheaper = structuredClone(input.scenario);
    cheaper.id = "CHEAPER";
    cheaper.assumptions.constCostPerSqM = 2_000_000;
    const scenarios = [input.scenario, cheaper];
    const project = computeProject(input.parcel, scenarios, { startDate: "2026-01-01", calculateMaxAcquisition: false });
    const expected = scenarios.map(scenario => {
      const result = independent({ parcel: input.parcel, scenario }, 1.2);
      return { id: scenario.id, profit: result.profit, rawProfit: result.profitUnroundedManwon! };
    });
    const best = expected.reduce((a, b) => a.rawProfit > b.rawProfit ? a : b);
    expect(project.decisionSupport.objectiveLeaders.find(leader => leader.objective === "downside-profit")).toMatchObject({
      scenarioIds: [best.id], bestValue: best.rawProfit,
    });
    expect(project.decisionSupport.paretoScenarioIds).toContain(best.id);
    for (const row of project.scenarios) {
      expect(row.profitAtHighCost).toBe(expected.find(value => value.id === row.id)!.profit);
      expect(row.profitAtHighCost).toBe(calculated(row.constructionCostSensitivity!.high).profit);
    }
  });
});
