import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { constructionQuoteFixture } from "../helpers/construction-quote-fixture";
import { fullQuoteAdoptionFixture } from "../helpers/full-quote-adoption-fixture";
import { createQuoteAdoptionReviewDraft } from "@/lib/planning/construction-quote-adoption-review";
import { applyFullQuoteAdoption } from "@/lib/planning/full-quote-adoption";
import { calculateScenario, minimumConstructionCostRate, type CalcInput } from "@/lib/finance/scenario";
import { calculateScenarioWithCostSensitivity, verifiedConstructionCostSensitivity } from "@/lib/finance/construction-cost-sensitivity";
import { buildDealStressTest } from "@/lib/finance/deal-stress-test";
import { findDealRescuePaths, passesDealRescueTarget } from "@/lib/finance/deal-rescue";
import { buildFinancialReconciliationAudit } from "@/lib/finance/reconciliation-audit";
import { withScenarioRevenueUnitPrice } from "@/lib/finance/revenue-contract";
import { buildStage3Sensitivity, findStage3BreakEvenRevenuePrice } from "@/lib/stage3/feasibility-analysis";
import { computeProject } from "@/lib/services/compute-project";
import { createQuantityCostDraft, evaluateQuantityCost } from "@/lib/planning/quantity-cost";
import { calculatePlanningScenario } from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";

let template: CalcInput;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
  const f = fullQuoteAdoptionFixture();
  for (const line of f.quote.lines) {
    line.amountWon! *= 1_000;
    if (line.unitRateWon !== null) line.unitRateWon *= 1_000;
  }
  const allocations = f.quote.coverage.filter(scope => scope.lineIds.includes("package"))
    .map(scope => ({ scopeId: scope.id, amountWon: 100_000_000, source: `Synthetic allocation ${scope.id}` }));
  f.quote.lines[0].amountWon! += 1_234;
  allocations[0].amountWon += 1_234;
  f.quote.lines[0].allocations = allocations;
  f.quote.statedTotalWon = f.quote.lines.reduce((sum, line) => sum + line.amountWon!, 0);
  const draft = createQuoteAdoptionReviewDraft(f.scenario, f.inputs, f.geometry!);
  draft.checkedOn = "2026-11-11";
  draft.scopes.forEach(scope => { scope.confirmed = true; scope.source = "Synthetic contract p3; not real evidence"; });
  const adopted = { ...f.scenario, ...applyFullQuoteAdoption(f.scenario, f.inputs, f.geometry, draft, draft.checkedOn) };
  const calculation = calculatePlanningScenario(adopted, f.context);
  const scenario = structuredClone(f.data.scenarios[0]._raw);
  scenario.program = planningScenarioToBuildingProgram(adopted, calculation, { geometry: f.geometry });
  expect(scenario.program.areaContract!.fullQuoteCost).toBeDefined();
  expect(scenario.program.areaContract!.quantityCostAdjustment).toBeUndefined();
  template = { parcel: f.data.parcel, scenario: withScenarioRevenueUnitPrice(scenario, "sale", 12_000_000) };
});
afterAll(() => vi.useRealTimers());

function fixture(): CalcInput { return structuredClone(template); }
function quotedManwon(input: CalcInput): number {
  return input.scenario.program.areaContract!.fullQuoteCost!.totalWon / 10_000;
}
function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeDeep);
  Object.freeze(value);
}

describe("adopted full quote financial consumers", () => {
  it("replaces baseline, material and dwelling costs exactly once at a zero unit rate", () => {
    const input = fixture(), area = input.scenario.program.areaContract!;
    delete area.facadeCost;
    area.materialAdjustmentCostManwon = -1_000_000;
    area.dwellingCostAdjustment = {
      unitCount: input.scenario.program.units.residential, baselineDwellingCount: 0,
      costPerAdditionalUnitWon: 1_000_000,
      costManwon: input.scenario.program.units.residential * 100, evidenceStatus: "quoted",
    };
    input.scenario.assumptions.constCostPerSqM = 0;
    const before = structuredClone(input);
    freezeDeep(input);
    const result = calculateScenario(input);
    const hard = quotedManwon(input), soft = hard * input.scenario.assumptions.softCostRate / 100;
    expect(hard % 1).not.toBe(0);
    expect(result.hardCost).toBe(Math.round(hard));
    expect(result.softCost).toBe(Math.round(soft));
    expect(result.contingency).toBe(Math.round((hard + soft) * input.scenario.assumptions.contingencyRate / 100));
    expect(result.interestCost).toBeGreaterThan(0);
    expect(minimumConstructionCostRate(input)).toBe(0);
    expect(input).toEqual(before);
  });

  it("rejects simultaneous full-quote and legacy quantity contracts across financial consumers", () => {
    const input = fixture(), result = calculateScenario(input);
    const q = constructionQuoteFixture();
    const draft = createQuantityCostDraft(q.scenario, q.inputs);
    draft.lines.forEach(line => {
      line.treatment = "included"; line.source = "Synthetic baseline scope"; line.scopeConfirmed = true;
    });
    Object.assign(draft.lines.find(line => line.id === "entryDoorCount")!, {
      treatment: "replace-allowance", unitRateWon: 2_000_000, includedAllowanceWon: 1_500_000,
      allowanceSource: "Synthetic allowance", evidenceStatus: "quoted",
    });
    q.scenario.quantityCost = draft;
    const quantity = evaluateQuantityCost(q.scenario, q.inputs);
    expect(quantity.status).toBe("ready");
    input.scenario.program.areaContract!.quantityCostAdjustment = quantity.contract!;
    for (const evaluate of [
      () => calculateScenario(input),
      () => minimumConstructionCostRate(input),
      () => calculateScenarioWithCostSensitivity(input),
      () => buildDealStressTest(input.parcel, input.scenario),
      () => findDealRescuePaths(input.parcel, input.scenario),
      () => buildStage3Sensitivity(input.parcel, input.scenario),
      () => findStage3BreakEvenRevenuePrice(input.parcel, input.scenario),
      () => buildFinancialReconciliationAudit({ result, scenario: input.scenario }),
    ]) expect(evaluate).toThrow("중복");
  });

  it("keeps the entire ledger fixed under baseline unit-rate and basement multiplier variations", () => {
    const input = fixture(), base = calculateScenario(input);
    for (const rate of [0, input.scenario.assumptions.constCostPerSqM * 0.85, 1_000_000_000]) {
      const changed = structuredClone(input);
      changed.scenario.assumptions.constCostPerSqM = rate;
      changed.scenario.assumptions.basementCostMultiplier = 2;
      expect(calculateScenario(changed)).toEqual(base);
    }
  });

  it("recomputes indirect costs, contingency and monthly finance from the quote", () => {
    const input = fixture();
    input.scenario.assumptions.pfUpfrontFeeRate = 1;
    const base = calculateScenario(input);
    input.scenario.assumptions.softCostRate += 5;
    input.scenario.assumptions.contingencyRate += 3;
    input.scenario.assumptions.interestRate += 2;
    input.scenario.assumptions.constructionMonths += 3;
    const changed = calculateScenario(input);
    expect(changed.hardCost).toBe(base.hardCost);
    expect(changed.softCost).toBeGreaterThan(base.softCost);
    expect(changed.contingency).toBeGreaterThan(base.contingency);
    expect(changed.pfFee).toBeGreaterThan(base.pfFee);
    expect(changed.interestCost).toBeGreaterThan(base.interestCost);
    expect(changed.totalMonths).toBe(base.totalMonths + 3);
    expect(changed.equityCashFlowsManwon).not.toEqual(base.equityCashFlowsManwon);
  });

  it.each(["scenario", "version", "rate", "basement", "snapshot"])("rejects stale locked %s binding", field => {
    const input = fixture(), area = input.scenario.program.areaContract!;
    if (field === "scenario") area.fullQuoteCost!.scenarioId += "-stale";
    if (field === "version") area.fullQuoteCost!.scenarioVersion += 1;
    if (field === "rate") area.stage2Economics!.inputs.constructionCostPerSqmWon += 1;
    if (field === "basement") area.stage2Economics!.inputs.basementCostMultiplier += 0.1;
    if (field === "snapshot") delete area.stage2Economics;
    expect(() => calculateScenario(input)).toThrow();
    expect(() => minimumConstructionCostRate(input)).toThrow();
  });

  it.each([null, {}, { totalWon: 0 }])("rejects malformed quotes without a legacy or zero fallback %#", raw => {
    const input = fixture();
    Object.assign(input.scenario.program.areaContract!, { fullQuoteCost: raw });
    expect(() => calculateScenarioWithCostSensitivity(input)).toThrow();
    expect(() => findStage3BreakEvenRevenuePrice(input.parcel, input.scenario)).toThrow();
  });

  it("preserves the baseline while excluding unsupported cost sensitivity and downside profit", () => {
    const input = fixture(), base = calculateScenario(input);
    const result = calculateScenarioWithCostSensitivity(input);
    expect(result.hardCost).toBe(base.hardCost);
    expect(result.constructionCostSensitivity.base.result.profit).toBe(base.profit);
    expect(result.constructionCostSensitivity.low).toMatchObject({ status: "unavailable", reason: expect.any(String) });
    expect(result.constructionCostSensitivity.high).toMatchObject({ status: "unavailable", reason: expect.any(String) });
    expect(result.profitAtLowCost).toBeUndefined();
    expect(result.profitAtHighCost).toBeUndefined();
    expect(result.constructionCostLow).toBeUndefined();
    expect(result.constructionCostHigh).toBeUndefined();
    expect(verifiedConstructionCostSensitivity(input, result.constructionCostSensitivity)).toEqual(result.constructionCostSensitivity);
    const project = computeProject(input.parcel, [input.scenario], { startDate: "2026-11-01", calculateMaxAcquisition: false });
    expect(project.decisionSupport.objectiveLeaders.find(row => row.objective === "downside-profit")?.scenarioIds ?? []).toEqual([]);
    const quote = input.scenario.program.areaContract!.fullQuoteCost!;
    quote.quote.lines[0].amountWon! += 10_000;
    const allocation = quote.quote.lines[0].allocations![0];
    if (allocation.amountWon === null) throw new Error("Synthetic allocation must be priced");
    allocation.amountWon += 10_000;
    quote.quote.statedTotalWon! += 10_000;
    quote.totalWon += 10_000;
    expect(verifiedConstructionCostSensitivity(input, result.constructionCostSensitivity)).toBeNull();
  });

  it("keeps revenue-only sensitivity and excludes fictitious cost rows", () => {
    const input = fixture(), before = structuredClone(input);
    const grid = buildStage3Sensitivity(input.parcel, input.scenario);
    expect(grid.costSteps).toEqual([0]);
    expect(grid.costStressUnavailableReason).toBeTruthy();
    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0][2].profitUnroundedManwon).toBe(calculateScenario(input).profitUnroundedManwon);
    expect(grid.rows[0][0].profit).toBeLessThan(grid.rows[0][2].profit);
    expect(grid.rows[0][4].profit).toBeGreaterThan(grid.rows[0][2].profit);
    expect(input).toEqual(before);
  });

  it("keeps revenue, finance and delay stress operational with no quote cost threshold", () => {
    const input = fixture(), before = structuredClone(input);
    input.scenario.assumptions.constCostPerSqM = 1_000_000_000;
    const stress = buildDealStressTest(input.parcel, input.scenario);
    expect(stress.thresholds.map(row => row.id)).toEqual(["land-price", "revenue-price", "pf-rate"]);
    expect(stress.stressCases.map(row => row.id)).toEqual(["revenue-down-10", "rate-up-1_5", "delay-3", "combined-downside"]);
    expect(stress.costStressUnavailableReason).toBeTruthy();
    for (const row of stress.stressCases) expect(row.result.hardCost).toBe(stress.baseline.hardCost);
    expect(stress.stressCases[0].result.totalRevenue).toBeCloseTo(stress.baseline.totalRevenue * 0.9, 0);
    expect(stress.stressCases[1].result.interestCost).toBeGreaterThan(stress.baseline.interestCost);
    expect(stress.stressCases[2].result.totalMonths).toBe(stress.baseline.totalMonths + 3);
    expect(stress.stressCases[3].changes.join(" ")).not.toContain("+10%");
    expect(input.scenario.program).toEqual(before.scenario.program);
  });

  it("removes quote VE from balanced rescue changes and burden scoring", () => {
    const input = fixture();
    input.parcel.acquiredPrice = calculateScenario(input).totalRevenue;
    input.scenario.assumptions.equityIRR = 0;
    const before = structuredClone(input);
    const rescue = findDealRescuePaths(input.parcel, input.scenario);
    expect(rescue.status).toBe("rescue-found");
    expect(rescue.bounds.constructionCostReductionPct).toBe(0);
    expect(rescue.bounds.balanced.constructionCostReductionPct).toBe(0);
    expect(rescue.paths.find(path => path.id === "construction-cost")).toMatchObject({ status: "not-applicable", changes: [] });
    const balanced = rescue.paths.find(path => path.id === "balanced")!;
    expect(balanced.status).toBe("reachable");
    expect(balanced.changes.some(change => change.field === "constCostPerSqM")).toBe(false);
    const replay = structuredClone(input);
    for (const change of balanced.changes) {
      if (change.field === "acquiredPrice") replay.parcel.acquiredPrice = change.to;
      else if (change.field === "salePricePerSqM") replay.scenario = withScenarioRevenueUnitPrice(replay.scenario, "sale", change.to);
      else replay.scenario.assumptions[change.field] = change.to;
    }
    const result = calculateScenario(replay);
    expect(passesDealRescueTarget(result, rescue.target.irr)).toBe(true);
    expect(result).toEqual(balanced.result);
    const score = balanced.changes.reduce((sum, change) => sum + (change.field === "acquiredPrice"
      ? -change.pctChange! / 40 : change.field === "salePricePerSqM" ? change.pctChange! / 50 : (change.from - change.to) / 2), 0);
    expect(balanced.burdenScore).toBeCloseTo(score, 3);
    expect(input).toEqual(before);
  });

  it("finds a positive quoted-cost break-even despite zero baseline rate and acquisition", () => {
    const input = fixture();
    input.parcel.acquiredPrice = 0;
    input.scenario.assumptions.constCostPerSqM = 0;
    const price = findStage3BreakEvenRevenuePrice(input.parcel, input.scenario);
    expect(price.value).toBeGreaterThan(0);
    const atPrice = (value: number) => calculateScenario({ ...input,
      scenario: withScenarioRevenueUnitPrice(input.scenario, "sale", value) });
    expect(atPrice(price.value!).hardCost).toBe(Math.round(quotedManwon(input)));
    expect(atPrice(price.value!).profitUnroundedManwon).toBeGreaterThanOrEqual(0);
    expect(atPrice(price.value!).profitUnroundedManwon).toBeLessThan(0.001);
    expect(atPrice(price.value! - 1).profitUnroundedManwon).toBeLessThan(0);
  });

  it("fails quote mismatches even when totals balance and the baseline rate changed", () => {
    const input = fixture(), area = input.scenario.program.areaContract!;
    const result = calculateScenario(input);
    area.stage2Economics!.hardCostManwon = result.hardCost;
    input.scenario.assumptions.constCostPerSqM *= 1.2;
    const audit = buildFinancialReconciliationAudit({ result, scenario: input.scenario });
    expect(audit.checks.find(check => check.id === "full-quote-hard-cost")?.status).toBe("pass");
    expect(audit.checks.find(check => check.id === "stage2-hard-cost")?.status).toBe("pass");
    const tampered = { ...result, hardCost: result.hardCost + 10, totalCost: result.totalCost + 10, profit: result.profit - 10 };
    const failed = buildFinancialReconciliationAudit({ result: tampered, scenario: input.scenario });
    expect(failed.checks.find(check => check.id === "cost-components")?.status).toBe("pass");
    expect(failed.checks.find(check => check.id === "profit-identity")?.status).toBe("pass");
    expect(failed.checks.find(check => check.id === "full-quote-hard-cost")?.status).toBe("fail");
    expect(failed.checks.find(check => check.id === "stage2-hard-cost")?.status).toBe("fail");
  });
});
