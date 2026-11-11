import { describe, expect, it } from "vitest";
import {
  applyRevenuePricingDraft,
  blendedRevenueUnitPrice,
  createRevenuePricingSnapshot,
  emptyRevenueAreaPools,
  REVENUE_PRICING_INPUT_VERSION,
  upgradeRevenuePricingSnapshot,
  validateRevenuePricingSnapshot,
  valueRevenueAreaPools,
  withScenarioRevenueUnitPrice,
} from "@/lib/finance/revenue-contract";
import { defaultAssumptions, defaultProgram } from "@/lib/finance/scenario";
import type {
  FinancialRevenuePricingSnapshot,
  Scenario,
} from "@/lib/finance/types";

const sixPoolAreas = {
  residentialSaleSqm: 10,
  retailSaleSqm: 20,
  officeSaleSqm: 30,
  residentialLeaseSqm: 40,
  retailLeaseSqm: 50,
  officeLeaseSqm: 60,
};

function sixPoolPricing() {
  return createRevenuePricingSnapshot({
    unitPricesWon: {
      residentialSale: 1_000_000,
      retailSale: 2_000_000,
      officeSale: 3_000_000,
      residentialLease: 10_000,
      retailLease: 20_000,
      officeLease: 30_000,
    },
    vacancyRatePct: 0,
    operatingExpenseRatePct: 0,
    capRatePct: 12,
    stabilizationFactorPct: 100,
  });
}

function pricingScenario(
  pricing: FinancialRevenuePricingSnapshot = sixPoolPricing(),
): Scenario {
  const assumptions = defaultAssumptions();
  assumptions.vacancyRate = 0;
  assumptions.operatingExpenseRate = 0;
  assumptions.capRate = 12;
  return {
    id: "six-pool-pricing",
    name: "여섯 수익 풀",
    shortName: "여섯 풀",
    program: {
      ...defaultProgram("mixed", 200, 60),
      areaContract: {
        schemaVersion: "stage2-finance-area-2026.1",
        source: "stage2-planning",
        sourceScenarioId: "six-pool-pricing",
        sourceScenarioVersion: 1,
        constructionAreaSqm: 250,
        aboveGroundAreaSqm: 250,
        basementAreaSqm: 0,
        farAreaSqm: 250,
        gradeFootprintAreaSqm: 100,
        parkingAreaSqm: 0,
        commonAreaSqm: 40,
        saleableAreaSqm: 60,
        rentableAreaSqm: 150,
        revenueAreas: sixPoolAreas,
        providedParkingSpaces: 0,
        requiredParkingSpaces: 0,
        materialAdjustmentCostManwon: 0,
      },
    },
    assumptions,
    revenuePricing: pricing,
  };
}

describe("revenue valuation contract", () => {
  it("separates potential rent, vacancy, operating expense and NOI", () => {
    const areas = {
      ...emptyRevenueAreaPools(),
      residentialLeaseSqm: 100,
    };
    const pricing = createRevenuePricingSnapshot({
      unitPricesWon: {
        residentialSale: 0,
        retailSale: 0,
        officeSale: 0,
        residentialLease: 10_000,
        retailLease: 0,
        officeLease: 0,
      },
      vacancyRatePct: 10,
      operatingExpenseRatePct: 20,
      capRatePct: 5,
      stabilizationFactorPct: 85,
    });
    const projection = valueRevenueAreaPools(areas, pricing);

    expect(
      projection.annualPotentialRentByPoolManwon.residentialLease,
    ).toBeCloseTo(1_200, 8);
    expect(
      projection.annualEffectiveGrossIncomeByPoolManwon.residentialLease,
    ).toBeCloseTo(1_080, 8);
    expect(
      projection.annualOperatingExpenseByPoolManwon.residentialLease,
    ).toBeCloseTo(216, 8);
    expect(projection.annualNoiByPoolManwon.residentialLease).toBeCloseTo(
      864,
      8,
    );
    expect(projection.valueByPoolManwon.residentialLease).toBeCloseTo(
      (864 / 0.05) * 0.85,
      8,
    );
  });

  it("does not apply operating expenses to sale pools", () => {
    const areas = {
      ...emptyRevenueAreaPools(),
      officeSaleSqm: 100,
    };
    const pricing = createRevenuePricingSnapshot({
      unitPricesWon: {
        residentialSale: 0,
        retailSale: 0,
        officeSale: 5_000_000,
        residentialLease: 0,
        retailLease: 0,
        officeLease: 0,
      },
      vacancyRatePct: 10,
      operatingExpenseRatePct: 20,
      capRatePct: 5,
    });
    const projection = valueRevenueAreaPools(areas, pricing);

    expect(projection.valueByPoolManwon.officeSale).toBe(50_000);
    expect(projection.annualOperatingExpenseByPoolManwon.officeSale).toBe(0);
  });

  it("values all six use and disposition pools at independent prices", () => {
    const projection = valueRevenueAreaPools(sixPoolAreas, sixPoolPricing());

    expect(projection.valueByPoolManwon).toEqual({
      residentialSale: 1_000,
      retailSale: 4_000,
      officeSale: 9_000,
      residentialLease: 4_000,
      retailLease: 10_000,
      officeLease: 18_000,
    });
    expect(projection.totalRevenueManwon).toBe(46_000);
  });

  it("multiplies and audits each named adjustment dimension", () => {
    const pricing = createRevenuePricingSnapshot({
      unitPricesWon: {
        residentialSale: 1_000_000,
        retailSale: 0,
        officeSale: 0,
        residentialLease: 0,
        retailLease: 0,
        officeLease: 0,
      },
      vacancyRatePct: 0,
      capRatePct: 5,
      adjustments: {
        residentialSale: {
          use: { factor: 1.1 },
          location: { factor: 0.9 },
          floor: { factor: 1.05 },
          area: { factor: 0.95 },
          newBuild: { factor: 1.08 },
        },
      },
    });
    const pool = pricing.pools.residentialSale;
    const expectedFactor = 1.1 * 0.9 * 1.05 * 0.95 * 1.08;

    expect(pool.adjustmentFactor).toBeCloseTo(expectedFactor, 10);
    expect(pool.unitPriceWon).toBeCloseTo(1_000_000 * expectedFactor, 6);
    expect(validateRevenuePricingSnapshot(pricing)).toEqual([]);

    const tampered = {
      ...pricing,
      pools: {
        ...pricing.pools,
        residentialSale: { ...pool, unitPriceWon: pool.unitPriceWon + 1 },
      },
    };
    expect(validateRevenuePricingSnapshot(tampered)).toContain(
      "residentialSale 기준단가와 보정 후 단가가 일치하지 않습니다.",
    );
    expect(() => valueRevenueAreaPools(sixPoolAreas, tampered)).toThrow(
      "수익 단가 입력을 확인하세요",
    );

    const factorTampered = {
      ...pricing,
      pools: {
        ...pricing.pools,
        residentialSale: { ...pool, adjustmentFactor: 1 },
      },
    };
    expect(validateRevenuePricingSnapshot(factorTampered)).toContain(
      "residentialSale 보정축 곱과 통합 보정값이 일치하지 않습니다.",
    );
  });

  it("upgrades a 2026.2 aggregate adjustment without changing final value", () => {
    const current = createRevenuePricingSnapshot({
      unitPricesWon: {
        residentialSale: 1_000_000,
        retailSale: 0,
        officeSale: 0,
        residentialLease: 0,
        retailLease: 0,
        officeLease: 0,
      },
      vacancyRatePct: 0,
      capRatePct: 5,
      adjustmentFactors: { residentialSale: 1.2 },
    });
    const legacy = {
      ...current,
      modelVersion: "revenue-pricing-2026.2" as const,
      pools: Object.fromEntries(
        Object.entries(current.pools).map(([key, value]) => {
          const { baseUnitPriceWon, adjustments, ...oldValue } = value;
          void baseUnitPriceWon;
          void adjustments;
          return [key, oldValue];
        }),
      ) as FinancialRevenuePricingSnapshot["pools"],
    };
    const upgraded = upgradeRevenuePricingSnapshot(legacy);

    expect(upgraded.pools.residentialSale.baseUnitPriceWon).toBe(1_000_000);
    expect(upgraded.pools.residentialSale.unitPriceWon).toBe(1_200_000);
    expect(upgraded.pools.residentialSale.adjustments?.use.factor).toBe(1.2);
    expect(validateRevenuePricingSnapshot(upgraded)).toEqual([]);
  });

  it("applies a draft to one pool without collapsing the other prices", () => {
    const base = sixPoolPricing();
    const updated = applyRevenuePricingDraft(base, {
      version: REVENUE_PRICING_INPUT_VERSION,
      projectId: "project-1",
      scenarioId: "scenario-1",
      pools: {
        retailSale: {
          baseUnitPriceWon: 2_500_000,
          adjustments: { location: 1.1 },
        },
      },
      updatedAt: "2026-09-09T00:00:00.000Z",
    });

    expect(updated.pools.retailSale.unitPriceWon).toBeCloseTo(2_750_000, 8);
    expect(updated.pools.residentialSale).toEqual(base.pools.residentialSale);
    expect(updated.pools.officeSale).toEqual(base.pools.officeSale);
  });

  it("scales active sale pools proportionally for sensitivity and reverse solve", () => {
    const scenario = pricingScenario();
    const current = blendedRevenueUnitPrice(scenario, "sale");
    const adjusted = withScenarioRevenueUnitPrice(
      scenario,
      "sale",
      current * 1.1,
    );

    expect(current).toBeCloseTo(2_333_333.333333, 3);
    expect(adjusted.revenuePricing?.pools.residentialSale.unitPriceWon).toBeCloseTo(
      1_100_000,
      8,
    );
    expect(adjusted.revenuePricing?.pools.retailSale.unitPriceWon).toBeCloseTo(
      2_200_000,
      8,
    );
    expect(adjusted.revenuePricing?.pools.officeSale.unitPriceWon).toBeCloseTo(
      3_300_000,
      8,
    );
    expect(adjusted.revenuePricing?.pools.residentialLease.unitPriceWon).toBe(
      10_000,
    );
    expect(blendedRevenueUnitPrice(adjusted, "sale")).toBeCloseTo(
      current * 1.1,
      6,
    );
  });
});
