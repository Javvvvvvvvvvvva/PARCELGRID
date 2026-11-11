import { describe, expect, it } from "vitest";
import { precisionFixture } from "@/tests/helpers/finance-precision-fixture";
import { createLeaseRollDraft, leaseRollBasis } from "@/lib/finance/lease-roll-contract";

describe("lease-roll plan binding", () => {
  it("is stable through JSONB key reordering and never mutates the plan", () => {
    const { scenario } = precisionFixture();
    const before = structuredClone(scenario);
    const reverse = (value: unknown): unknown => Array.isArray(value) ? value.map(reverse)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value;
    expect(leaseRollBasis("P1", reverse(scenario) as typeof scenario)).toBe(leaseRollBasis("P1", scenario));
    expect(scenario).toEqual(before);
    expect(createLeaseRollDraft("P1", scenario, "2026-11-11T00:00:00.000Z")).toMatchObject({ revision: 0, rows: [], calendarStart: null });
  });
  it("binds project, source version, geometry hash and all revenue areas", () => {
    const { scenario } = precisionFixture();
    const original = leaseRollBasis("P1", scenario);
    expect(leaseRollBasis("P2", scenario)).not.toBe(original);
    for (const field of Object.keys(scenario.program.areaContract!.revenueAreas)) {
      const next = structuredClone(scenario);
      const pools = next.program.areaContract!.revenueAreas;
      const key = field as keyof typeof pools;
      pools[key]! += 1;
      expect(leaseRollBasis("P1", next)).not.toBe(original);
    }
    scenario.program.areaContract!.sourceScenarioVersion++;
    expect(leaseRollBasis("P1", scenario)).not.toBe(original);
    const versionBasis = leaseRollBasis("P1", scenario);
    scenario.program.areaContract!.geometrySource = { mode: "engine-generated", locked: true, exactGeometryAvailable: true, geometryHash: "changed" };
    expect(leaseRollBasis("P1", scenario)).not.toBe(versionBasis);
  });
  it("leaves the physical lease binding unchanged when only price or construction cost changes", () => {
    const { scenario } = precisionFixture(); const original = leaseRollBasis("P1", scenario);
    scenario.assumptions.rentPerSqMMonth *= 2;
    scenario.assumptions.constCostPerSqM *= 2;
    scenario.program.areaContract!.materialAdjustmentCostManwon = 100;
    expect(leaseRollBasis("P1", scenario)).toBe(original);
  });
  it.each([-1, .5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid source version %s", version => {
    const { scenario } = precisionFixture(); scenario.program.areaContract!.sourceScenarioVersion = version;
    expect(() => leaseRollBasis("P1", scenario)).toThrow();
  });
  it("rejects missing contracts and nonfinite/negative pool areas", () => {
    const { scenario } = precisionFixture();
    scenario.program.areaContract!.sourceScenarioId = "other-plan";
    expect(() => leaseRollBasis("P1", scenario)).toThrow();
    scenario.program.areaContract!.sourceScenarioId = scenario.id;
    scenario.program.areaContract!.revenueAreas.residentialLeaseSqm = -1;
    expect(() => leaseRollBasis("P1", scenario)).toThrow();
    scenario.program.areaContract!.revenueAreas.residentialLeaseSqm = Infinity;
    expect(() => leaseRollBasis("P1", scenario)).toThrow();
    delete scenario.program.areaContract;
    expect(() => leaseRollBasis("P1", scenario)).toThrow();
  });
});
