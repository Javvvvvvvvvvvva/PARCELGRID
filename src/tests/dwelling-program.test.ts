import { describe, expect, it } from "vitest";
import { buildDwellingProgram, DEFAULT_DWELLING_PROGRAM, dwellingProgramSummary, redistributeDwellingFloor } from "@/lib/planning/dwelling-program";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { calculateScenario, defaultAssumptions } from "@/lib/finance/scenario";
import type { Parcel, Scenario } from "@/lib/finance/types";
import { generatePlanningRecommendations } from "@/lib/planning/recommendation-engine";
import { generatePlanningRecommendationsV2 } from "@/lib/planning/recommendation-analysis";
import { applyDwellingSalePricing, dwellingSaleBreakdown, validateDwellingSaleBands } from "@/lib/planning/dwelling-pricing";
import { dwellingComparisonCandidates, dwellingSensitivity } from "@/lib/planning/dwelling-comparison";
import { clonePlanningScenario } from "@/lib/planning/scenario-utils";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";

const parcel: Parcel = {
  id: "dwelling-test", address: "서울특별시 도봉구 쌍문동 281-23", addressRoad: "",
  lotArea: 122, zoning: "제2종일반주거지역", zoneCode: "UB20", maxFAR: 250, maxBCR: 60,
  heightLimit: 18, setback: { road: 0, side: 0.5, rear: 0.5 }, currentBuilding: null,
  landPrice: 0, estMarketPrice: 0, acquired: "2026-10-19", acquiredPrice: 50000, demolitionCost: 1000,
};

function fixture(far: 200 | 250, mix: "uniform" | "compact-lower" = "uniform", target = 26, residentialFloors = 4) {
  const a = { ...DEFAULT_DWELLING_PROGRAM, minimumCommonAreaSqm: far === 200 ? 12 : 12.2 };
  const floors = buildDwellingProgram({ capacitiesSqm: far === 200 ? [61,58,58,58,58] : Array(residentialFloors + 1).fill(73.2),
    utilizationRatio: 1, maxFarAreaSqm: 122 * far / 100, targetExclusiveAreaSqm: target, mix, piloti: true, assumptions: a });
  expect(floors).not.toBeNull();
  const scenario = { ...createBlankPlanningScenario(), primaryUse: "multi-family" as const, floorPrograms: floors!, dwellingProgram: a };
  const assumptions = { ...defaultAssumptions(), constCostPerSqM: 3_000_000 };
  const calculation = calculatePlanningScenario(scenario, {
    parcel: { address: parcel.address, parkingRuleAsOf: "2026-10-19", zoning: parcel.zoning,
      lotAreaSqm: 122, maxFARPct: far, maxBCRPct: 60, heightLimitM: 18,
      acquisitionCostManwon: parcel.acquiredPrice, demolitionCostManwon: 1000 },
    assumptions: planningEconomicsAssumptionsFromLegacy(assumptions),
  });
  return { scenario, calculation, assumptions };
}

describe("individual dwelling area programs", () => {
  it("redistributes guided unit edits without changing gross area or selling added common space", () => {
    const { scenario } = fixture(250, "uniform", 45);
    const floor = scenario.floorPrograms[1];
    const next = redistributeDwellingFloor(floor, 2, scenario.dwellingProgram)!;
    expect(next).not.toBeNull();
    expect(dwellingProgramSummary([next]).unitCount).toBe(2);
    expect(dwellingProgramSummary([next]).netAreaSqm).toBeCloseTo(dwellingProgramSummary([floor]).netAreaSqm - 2, 5);
    expect(next.zones.reduce((sum, zone) => sum + zone.areaSqm, 0)).toBeCloseTo(floor.zones.reduce((sum, zone) => sum + zone.areaSqm, 0), 5);
    expect(next.zones.filter((z) => z.useType === "residential").every((z) => z.unitCount === 1 && z.parkingExclusiveAreaStatus === "user-entered")).toBe(true);
    expect(redistributeDwellingFloor(floor, 4, scenario.dwellingProgram)).toBeNull();
    expect(redistributeDwellingFloor(floor, 0, scenario.dwellingProgram)).toBeNull();
  });
  it.each([
    [200, "uniform", 45, 4, 174, 4],
    [200, "compact-lower", 20, 6, 170, 4],
    [200, "uniform", 20, 8, 166, 4],
    [250, "uniform", 45, 4, 219.6, 4],
    [250, "compact-lower", 26, 6, 215.6, 4],
    [250, "uniform", 26, 8, 211.6, 4],
  ] as const)("reconciles the %i%% %s/%i area program", (far, mix, target, count, net, cars) => {
    const { scenario, calculation } = fixture(far, mix, target);
    expect(calculation.metrics.residentialUnitCount).toBe(count);
    expect(calculation.metrics.saleableAreaSqm).toBeCloseTo(net, 5);
    expect(calculation.metrics.preliminaryFarPct).toBeCloseTo(far, 5);
    expect(calculation.parking.requiredCars).toBe(cars);
    expect(calculation.parking.decisionGrade).toBe(false);
    expect(calculation.parking.components[0].distributionStatus).toBe("per-dwelling");
    expect(scenario.floorPrograms.flatMap((f) => f.zones).filter((z) => z.useType === "residential").every((z) => z.unitCount === 1)).toBe(true);
    expect(calculation.checks.find((c) => c.code === "dwelling-program-assumptions")?.status).toBe("review");
    expect(assessRepresentativeCheckReadiness(calculation.checks).blockers.some((b) => b.code === "dwelling-layout-verification")).toBe(true);
  });

  it("finds the190% six-unit alternative without consuming a250% allowance", () => {
    const { scenario, calculation } = fixture(250, "uniform", 26, 3);
    expect(dwellingProgramSummary(scenario.floorPrograms).unitCount).toBe(6);
    expect(calculation.metrics.preliminaryFarPct).toBe(190);
    expect(calculation.metrics.constructionAreaSqm).toBeCloseTo(292.8);
    expect(calculation.metrics.saleableAreaSqm).toBeCloseTo(158.7);
    expect(calculation.parking.requiredCars).toBe(3);
  });

  it("carries the per-dwelling construction increment into Stage3 exactly once", () => {
    const { scenario, calculation, assumptions } = fixture(250);
    expect(calculation.economicsPreview.additionalDwellingCostManwon).toBe(8000);
    expect(calculation.economicsPreview.constructionCostManwon).toBe(117800);
    const program = planningScenarioToBuildingProgram(scenario, calculation);
    const financial = { id: scenario.id, name: "test", program, assumptions } as Scenario;
    const result = calculateScenario({ parcel, scenario: financial });
    expect(result.hardCost).toBe(calculation.economicsPreview.constructionCostManwon);
    expect(program.areaContract?.dwellingCostAdjustment?.evidenceStatus).toBe("assumed");
    program.areaContract!.dwellingCostAdjustment!.costManwon = 0;
    expect(() => calculateScenario({ parcel, scenario: financial })).toThrow("세대 증설 비용");
  });

  it("rejects invalid program inputs and over4 residential floors", () => {
    const base = { capacitiesSqm: [73.2,73.2,73.2], utilizationRatio: 1, maxFarAreaSqm: 244,
      targetExclusiveAreaSqm: 26, mix: "uniform" as const, piloti: true };
    expect(buildDwellingProgram({ ...base, capacitiesSqm: [NaN,73.2] })).toBeNull();
    expect(buildDwellingProgram({ ...base, capacitiesSqm: Array(6).fill(73.2) })).toBeNull();
    expect(buildDwellingProgram({ ...base, targetExclusiveAreaSqm: 0 })).toBeNull();
    expect(buildDwellingProgram({ ...base, maxFarAreaSqm: 5 })).toBeNull();
  });

  it("uses size-band final prices on net sale area and carries the weighted price to Stage3", () => {
    const { scenario, assumptions } = fixture(250, "compact-lower", 26);
    const bands = [
      { minExclusiveSqm: 0, maxExclusiveSqm: 30, unitPriceWon: 8_800_000, source: "small-unit test assumption" },
      { minExclusiveSqm: 30, maxExclusiveSqm: null, unitPriceWon: 7_000_000, source: "large-unit test assumption" },
    ];
    const priced = { ...scenario, dwellingProgram: { ...scenario.dwellingProgram, salePriceBands: bands } };
    const calculation = calculatePlanningScenario(priced, {
      parcel: { address: parcel.address, parkingRuleAsOf: "2026-10-19", zoning: parcel.zoning, lotAreaSqm: 122,
        maxFARPct: 250, maxBCRPct: 60, heightLimitM: 18, acquisitionCostManwon: 50000, demolitionCostManwon: 1000 },
      assumptions: planningEconomicsAssumptionsFromLegacy(assumptions),
    });
    expect(calculation.revenueProjection.saleRevenueManwon).toBeCloseTo(169964, 4);
    const financial = { id: scenario.id, name: "bands", program: planningScenarioToBuildingProgram(priced, calculation), assumptions } as Scenario;
    expect(calculateScenario({ parcel, scenario: financial }).revenueSale).toBeCloseTo(169964, 2);
    expect(calculation.revenueProjection.pricing.pools.residentialSale.sourceStatus).toBe("user-input");
    const rows = dwellingSaleBreakdown(priced, 6_000_000);
    expect(rows.filter((row) => row.exclusiveSqm < 30).length).toBe(4);
    const copy = clonePlanningScenario(priced);
    copy.dwellingProgram!.salePriceBands![0].unitPriceWon = 1;
    expect(priced.dwellingProgram.salePriceBands[0].unitPriceWon).toBe(8_800_000);
  });

  it("rejects overlapping, untraceable and non-finite price bands", () => {
    const band = { minExclusiveSqm: 0, maxExclusiveSqm: 30, unitPriceWon: 8_000_000, source: "test" };
    expect(validateDwellingSaleBands([band, { ...band, minExclusiveSqm: 29, maxExclusiveSqm: null }])).not.toBeNull();
    expect(validateDwellingSaleBands([{ ...band, unitPriceWon: NaN }])).not.toBeNull();
    expect(validateDwellingSaleBands([{ ...band, source: " " }])).not.toBeNull();
    expect(validateDwellingSaleBands([band, { ...band, minExclusiveSqm: 30, maxExclusiveSqm: null }])).toBeNull();
    const { scenario, calculation } = fixture(250);
    expect(applyDwellingSalePricing(scenario, calculation.revenueProjection.pricing)).toBe(calculation.revenueProjection.pricing);
  });

  it("recalculates price and construction stress without mutating the plan or inputs", () => {
    const { scenario, assumptions } = fixture(250);
    const input = { projectId: "stress", parcel: { address: parcel.address, lotAreaSqm: 122, maxFARPct: 250, maxBCRPct: 60,
      heightLimitM: 18, acquisitionCostManwon: 50000, demolitionCostManwon: 1000, zoning: parcel.zoning },
      assumptions: planningEconomicsAssumptionsFromLegacy(assumptions) };
    const before = JSON.stringify({ scenario, input });
    const base = dwellingSensitivity(scenario, input, 0, 0);
    const stress = dwellingSensitivity(scenario, input, -10, 15);
    expect(stress.constructionCostManwon).toBeCloseTo(base.constructionCostManwon * 1.15, 1);
    expect(stress.expectedRevenueManwon).toBeCloseTo(base.expectedRevenueManwon * 0.9, 1);
    expect(stress.profitManwon).toBeLessThan(base.profitManwon);
    expect(JSON.stringify({ scenario, input })).toBe(before);
  });

  it("generates mixed/small candidates for Seoul without fabricating a boundary", () => {
    const result = generatePlanningRecommendationsV2({ projectId: parcel.id, generatedAt: "2026-10-19T00:00:00Z",
      assumptions: planningEconomicsAssumptionsFromLegacy(defaultAssumptions()),
      parcel: { address: parcel.address, lotAreaSqm: 122, maxFARPct: 250, maxBCRPct: 60,
        heightLimitM: 18, acquisitionCostManwon: 50000, demolitionCostManwon: 1000, zoning: parcel.zoning },
    });
    expect(result.evaluations.some((c) => c.calculation.metrics.residentialUnitCount === 6)).toBe(true);
    expect(result.evaluations.some((c) => c.calculation.metrics.residentialUnitCount === 8)).toBe(true);
    expect(result.evaluations.some((c) => {
      const s = dwellingProgramSummary(c.scenario.floorPrograms);
      return s.unitCount === 6 && s.maxExclusiveSqm - s.minExclusiveSqm > 10;
    })).toBe(true);
    expect(result.evaluations.every((c) => c.scenario.floorPrograms.filter((f) => f.zones.some((z) => z.useType === "residential")).length <= 4)).toBe(true);
    expect(result.eligibleCandidates).toBe(0);
    expect(result.profitOptimal).toBeNull();
    expect(result.legalCeilingReference).toBeNull();
    expect(result.legalGeometryCandidateCount).toBe(0);
    expect(dwellingComparisonCandidates(result.evaluations).some((c) => c.calculation.metrics.residentialUnitCount === 8)).toBe(true);
  });

  it.each([
    [[0,0],[10,0],[10,12.2],[0,12.2],[0,0]],
    [[0,0],[6.1,0],[6.1,20],[0,20],[0,0]],
    [[0,0],[12,0],[12,5],[7,5],[7,13.86],[0,13.86],[0,0]],
  ])("does not promote incompatible or unsupported shapes to verified parking", (...ring) => {
    const boundary = ring.map(([x, z]) => [127 + x / (111000 * Math.cos(37.65 * Math.PI / 180)), 37.65 + z / 111000] as [number, number]);
    const result = generatePlanningRecommendations({ projectId: "shape", generatedAt: "2026-10-19T00:00:00Z",
      assumptions: planningEconomicsAssumptionsFromLegacy(defaultAssumptions()),
      parcel: { address: parcel.address, lotAreaSqm: 122, maxFARPct: 250, maxBCRPct: 60, heightLimitM: 18,
        acquisitionCostManwon: 50000, demolitionCostManwon: 1000, zoning: parcel.zoning, boundary },
    });
    expect(result.evaluations.length).toBeGreaterThan(0);
    for (const candidate of result.evaluations) {
      expect(candidate.calculation.parking.decisionGrade).toBe(false);
      if (candidate.eligible) {
        expect(candidate.parkingLayout.supportedStrategy).toBe(true);
        expect(candidate.parkingLayout.shortfallCars).toBe(0);
        expect(candidate.geometryFailCount).toBe(0);
      }
    }
  });
});
