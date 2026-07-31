import { describe, expect, it } from "vitest";
import {
  buildFinancialReconciliationAudit,
  FINANCIAL_RECONCILIATION_TOLERANCE_MANWON,
} from "@/lib/finance/reconciliation-audit";
import {
  calculateScenario,
  defaultAssumptions,
  defaultProgram,
} from "@/lib/finance/scenario";
import type { BuildingProgram, Parcel, Scenario } from "@/lib/finance/types";

const parcel: Parcel = {
  id: "reconciliation-project",
  address: "서울 도봉구 테스트동 1-1",
  addressRoad: "서울 도봉구 테스트로 1",
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

function scenario(type: BuildingProgram["type"]): Scenario {
  return {
    id: `reconciliation-${type}`,
    name: `${type} 대사 테스트`,
    shortName: "대사",
    program: defaultProgram(type, parcel.maxFAR, parcel.maxBCR),
    assumptions: defaultAssumptions(),
  };
}

describe("Stage 3 financial reconciliation audit", () => {
  it("passes every accounting identity for a bulk-exit multi-family plan", () => {
    const inputScenario = scenario("multi-family");
    const result = calculateScenario({ parcel, scenario: inputScenario });
    const audit = buildFinancialReconciliationAudit({
      result,
      scenario: inputScenario,
    });

    expect(audit.status).toBe("pass");
    expect(audit.exact).toBe(true);
    expect(audit.checks.map((check) => [check.id, check.status])).toEqual([
      ["revenue-components", "pass"],
      ["cost-components", "pass"],
      ["profit-identity", "pass"],
      ["funding-sources", "pass"],
    ]);
    expect(
      Math.abs(audit.summary.fundingDifferenceManwon)
    ).toBeLessThanOrEqual(FINANCIAL_RECONCILIATION_TOLERANCE_MANWON);
  });

  it("explains why peak PF plus equity is not a total-cost identity with early presale receipts", () => {
    const inputScenario = scenario("officetel");
    const result = calculateScenario({ parcel, scenario: inputScenario });
    const audit = buildFinancialReconciliationAudit({
      result,
      scenario: inputScenario,
    });

    expect(audit.status).toBe("review");
    expect(audit.summary.usesEarlySaleReceipts).toBe(true);
    expect(
      audit.checks.find((check) => check.id === "funding-sources")
    ).toMatchObject({
      status: "review",
    });
    expect(
      audit.checks.find((check) => check.id === "funding-sources")?.message
    ).toContain("월별 통합 원장");
    expect(
      audit.checks
        .filter((check) => check.id !== "funding-sources")
        .every((check) => check.status === "pass")
    ).toBe(true);
  });

  it("fails instead of hiding a tampered revenue or profit total", () => {
    const inputScenario = scenario("multi-family");
    const result = calculateScenario({ parcel, scenario: inputScenario });
    const audit = buildFinancialReconciliationAudit({
      result: {
        ...result,
        totalRevenue: result.totalRevenue + 10,
      },
      scenario: inputScenario,
    });

    expect(audit.status).toBe("fail");
    expect(
      audit.checks.find((check) => check.id === "revenue-components")?.status
    ).toBe("fail");
    expect(
      audit.checks.find((check) => check.id === "profit-identity")?.status
    ).toBe("fail");
  });
});
