import { describe, expect, it } from "vitest";
import { buildProjectLedger } from "@/lib/finance/project-ledger";
import { defaultAssumptions, defaultProgram } from "@/lib/finance/scenario";
import type { Parcel, Scenario } from "@/lib/finance/types";

const parcel: Parcel = {
  id: "ledger-test",
  address: "서울 테스트구 테스트동 1-1",
  addressRoad: "서울 테스트구 테스트로 1",
  lotArea: 300,
  zoning: "제2종일반주거지역",
  zoneCode: "UQA122",
  maxFAR: 220,
  maxBCR: 60,
  heightLimit: 30,
  setback: { road: 0, side: 0, rear: 0 },
  landPrice: 2_000_000,
  estMarketPrice: 4_000_000,
  acquired: "2026-01-01",
  acquiredPrice: 50_000,
  demolitionCost: 2_000,
};

function scenarioAtRate(interestRate: number): Scenario {
  const assumptions = defaultAssumptions();
  assumptions.designMonths = 4;
  assumptions.constructionMonths = 12;
  assumptions.saleOutMonths = 3;
  assumptions.interestRate = interestRate;
  assumptions.ltcTarget = 70;
  return {
    id: "LEDGER",
    name: "원장 테스트",
    shortName: "원장",
    program: defaultProgram("multi-family", parcel.maxFAR, parcel.maxBCR),
    assumptions,
  };
}

function build(interestRate = 6, scenario = scenarioAtRate(interestRate)) {
  return buildProjectLedger({
    parcel,
    scenario,
    revenueSale: 130_000,
    revenueExit: 0,
    hardCost: 40_000,
    softCost: 4_800,
    contingency: 2_240,
  });
}

describe("auditable project ledger", () => {
  it("allocates 100% of every project cost", () => {
    const ledger = build();
    const sum = (field: "hardCost" | "softCost" | "contingency") =>
      ledger.rows.reduce((total, row) => total + row[field], 0);

    expect(sum("hardCost")).toBeCloseTo(40_000, 8);
    expect(sum("softCost")).toBeCloseTo(4_800, 8);
    expect(sum("contingency")).toBeCloseTo(2_240, 8);
    expect(ledger.totalProjectOutflow).toBeCloseTo(
      50_000 + 2_000 + 40_000 + 4_800 + 2_240 + ledger.financingCost,
      8
    );
  });

  it("uses the configured timeline and allocates 100% of revenue", () => {
    const ledger = build();
    expect(ledger.rows).toHaveLength(4 + 12 + 3 + 1);
    expect(ledger.totalRevenue).toBeCloseTo(130_000, 8);
  });

  it("collects single-house and multi-family whole-asset sales at exit", () => {
    const ledger = build();
    expect(ledger.revenueCollectionPolicy).toBe("bulk-exit");
    expect(ledger.rows.slice(0, -1).every((row) => row.revenueInflow === 0)).toBe(true);
    expect(ledger.rows.at(-1)?.revenueInflow).toBeCloseTo(130_000, 8);
    expect(ledger.projectBreakEvenMonth).toBe(ledger.rows.at(-1)?.month);
  });

  it("keeps the explicit presale policy for non-bulk residential sales", () => {
    const base = scenarioAtRate(6);
    const presaleScenario: Scenario = {
      ...base,
      program: { ...base.program, type: "officetel" },
    };
    const ledger = build(6, presaleScenario);
    expect(ledger.revenueCollectionPolicy).toBe("presale-10-60-30");
    expect(
      ledger.rows.slice(0, -1).some((row) => row.revenueInflow > 0)
    ).toBe(true);
    expect(ledger.totalRevenue).toBeCloseTo(130_000, 8);
  });

  it("repays PF completely by the final month", () => {
    const ledger = build();
    expect(ledger.maxPfBalance).toBeGreaterThan(0);
    expect(ledger.rows.at(-1)?.pfBalance).toBeCloseTo(0, 8);
  });

  it("higher PF rate increases financing cost", () => {
    expect(build(9).financingCost).toBeGreaterThan(build(4).financingCost);
  });

  it("equity cash flows reconcile to project profit", () => {
    const ledger = build();
    const equityProfit = ledger.equityCashFlows.reduce(
      (sum, value) => sum + value,
      0
    );
    expect(equityProfit).toBeCloseTo(
      ledger.totalRevenue - ledger.totalProjectOutflow,
      8
    );
  });
});
