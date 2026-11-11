import { describe, expect, it } from "vitest";
import {
  applyPlanningScenarioCalculation,
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
  type PlanningCalculationContext,
} from "@/lib/planning/scenario-calculator";
import { defaultAssumptions } from "@/lib/finance/scenario";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";
import type { PlanningScenario } from "@/lib/planning/types";
import {
  createRegulatoryReferenceSet,
  replaceConstraintEvidence,
} from "@/lib/regulatory/constraints";

const referenceConstraints = createRegulatoryReferenceSet({
  farPct: 200,
  bcrPct: 60,
  retrievedAt: "2026-07-13T00:00:00.000Z",
  zoningSourceName: "VWorld 용도지역",
  zoningSourceRef: "test-zone-ref",
});
const verifiedConstraints = {
  ...referenceConstraints,
  far: replaceConstraintEvidence(referenceConstraints.far, {
    value: 200,
    status: "source-backed",
    sourceName: "테스트 조례",
    sourceRef: "제1조",
    asOf: "2026-07-13",
    checkedBy: "테스터",
    checkedRole: "건축사",
  }),
  bcr: replaceConstraintEvidence(referenceConstraints.bcr, {
    value: 60,
    status: "source-backed",
    sourceName: "테스트 조례",
    sourceRef: "제1조",
    asOf: "2026-07-13",
    checkedBy: "테스터",
    checkedRole: "건축사",
  }),
  height: replaceConstraintEvidence(referenceConstraints.height, {
    value: 15,
    status: "source-backed",
    sourceName: "테스트 높이 고시",
    sourceRef: "제2조",
    asOf: "2026-07-13",
    checkedBy: "테스터",
    checkedRole: "건축사",
  }),
};

const context: PlanningCalculationContext = {
  parcel: {
    address: "서울특별시 도봉구 쌍문동 281-23",
    parkingRuleAsOf: "2026-09-08",
    lotAreaSqm: 120,
    maxFARPct: 200,
    maxBCRPct: 60,
    heightLimitM: 15,
    regulatoryConstraints: verifiedConstraints,
    roofAllowanceM: 1.4,
    acquisitionCostManwon: 50_000,
    demolitionCostManwon: 1_000,
  },
  assumptions: {
    version: "test-v1",
    constructionCostPerSqmWon: 2_000_000,
    basementCostMultiplier: 1.25,
  softCostRatePct: 10,
  contingencyRatePct: 5,
  acquisitionTaxManwon: 0,
  acquisitionOtherCostManwon: 0,
  tenantRelocationCostManwon: 0,
  financingCostRatePct: 2,
  pfUpfrontFeeRatePct: 0,
  trustFeeManwon: 0,
  ltcTargetPct: 70,
    residentialSalePricePerSqmWon: 5_000_000,
    commercialSalePricePerSqmWon: 4_000_000,
    residentialRentPerSqmMonthWon: 25_000,
    retailRentPerSqmMonthWon: 50_000,
    officeRentPerSqmMonthWon: 40_000,
  vacancyRatePct: 5,
  operatingExpenseRatePct: 20,
  capRatePct: 5,
  },
  calculatedAt: "2026-07-13T00:00:00.000Z",
};

function mixedUseScenario(): PlanningScenario {
  const scenario = createBlankPlanningScenario({ name: "상가 + 다가구" });
  return {
    ...scenario,
    primaryUse: "mixed",
    parking: { strategy: "basement", providedCars: 1 },
    floorPrograms: [
      createFloorProgram(3, [{
        ...createFloorZone("residential", 50, 1),
        parkingExclusiveAreaSqm: 37.5,
        parkingExclusiveAreaStatus: "source-backed",
      }]),
      createFloorProgram(2, [{
        ...createFloorZone("residential", 60, 2),
        parkingExclusiveAreaSqm: 45,
        parkingExclusiveAreaStatus: "source-backed",
      }]),
      createFloorProgram(1, [
        createFloorZone("retail", 40, 1),
        createFloorZone("common", 10, 0),
        createFloorZone("parking", 20, 0),
      ]),
      createFloorProgram(-1, [createFloorZone("parking", 60, 0)], 3.3),
    ],
  };
}

describe("Stage 2 planning calculation engine", () => {
  it("carries the edited basement multiplier into the Stage 2 cost assumptions", () => {
    const legacy = defaultAssumptions();
    legacy.basementCostMultiplier = 1.6;

    expect(
      planningEconomicsAssumptionsFromLegacy(legacy)
        .basementCostMultiplier,
    ).toBe(1.6);
  });

  it("separates construction, FAR, revenue and parking areas for a mixed-use plan", () => {
    const result = calculatePlanningScenario(mixedUseScenario(), context);

    expect(result.metrics.aboveGroundFloors).toBe(3);
    expect(result.metrics.undergroundFloors).toBe(1);
    expect(result.metrics.constructionAreaSqm).toBe(240);
    expect(result.metrics.aboveGroundProgramAreaSqm).toBe(180);
    expect(result.metrics.basementProgramAreaSqm).toBe(60);
    expect(result.metrics.preliminaryFarAreaSqm).toBe(160);
    expect(result.metrics.preliminaryBcrPct).toBe(58.3);
    expect(result.metrics.preliminaryFarPct).toBe(133.3);
    expect(result.metrics.residentialAreaSqm).toBe(110);
    expect(result.metrics.commercialAreaSqm).toBe(40);
    expect(result.metrics.saleableAreaSqm).toBe(110);
    expect(result.metrics.rentableAreaSqm).toBe(40);
    expect(result.metrics.residentialUnitCount).toBe(3);
    expect(result.metrics.commercialUnitCount).toBe(1);
    expect(result.metrics.occupiedFloorHeightM).toBe(9.6);
    expect(result.metrics.roofAllowanceM).toBe(1.4);
    expect(result.metrics.totalHeightM).toBe(11);
    expect(result.metrics.totalUnitCount).toBe(4);
    expect(result.metrics.unitCount).toBe(3);
  });

  it("calculates component parking and reports a shortfall", () => {
    const result = calculatePlanningScenario(mixedUseScenario(), context);

    expect(result.parking.requiredCars).toBe(2);
    expect(result.parking.providedCars).toBe(1);
    expect(result.parking.shortfallCars).toBe(1);
    expect(result.parking.estimatedCapacityFromProgram).toBe(3);
    expect(result.parking.rule.id).toBe("parking-kr-seoul-2026-07-13");
    expect(result.parking.decisionGrade).toBe(false);
    expect(result.parking.estimated).toBe(true);
    expect(result.checks.find((check) => check.code === "parking")?.status).toBe("review");
    expect(result.checks.find((check) => check.code === "parking")?.source).toContain(
      "서울특별시조례 제10142호"
    );
  });

  it("produces a transparent Stage 2 economics preview", () => {
    const result = calculatePlanningScenario(mixedUseScenario(), context);
    const economics = result.economicsPreview;

    expect(economics.constructionCostManwon).toBe(51_000);
    expect(economics.softCostManwon).toBe(5_100);
    expect(economics.contingencyCostManwon).toBe(2_805);
    expect(economics.financingCostManwon).toBe(1_178.1);
    expect(economics.saleRevenueManwon).toBe(55_000);
    expect(economics.expectedAnnualNoiManwon).toBe(1_824);
    expect(economics.capitalizedLeaseValueManwon).toBe(31_008);
    expect(economics.expectedRevenueManwon).toBe(86_008);
    expect(economics.totalCostManwon).toBe(111_083.1);
    expect(economics.profitManwon).toBe(-25_075.1);
    expect(economics.profitMarginPct).toBe(-29.2);
    expect(result.revenueProjection.pricing.stabilizationFactorPct).toBe(85);
    expect(economics.assumptionsVersion).toBe("test-v1");
  });

  it("flags preliminary BCR and FAR limit violations", () => {
    const scenario = createBlankPlanningScenario({ name: "과밀안" });
    scenario.primaryUse = "multi-family";
    scenario.floorPrograms = [
      createFloorProgram(1, [createFloorZone("residential", 80, 2)]),
      createFloorProgram(2, [createFloorZone("residential", 80, 2)]),
    ];

    const result = calculatePlanningScenario(scenario, {
      ...context,
      parcel: {
        ...context.parcel,
        lotAreaSqm: 100,
        maxBCRPct: 50,
        maxFARPct: 100,
        regulatoryConstraints: {
          ...verifiedConstraints,
          bcr: replaceConstraintEvidence(verifiedConstraints.bcr, {
            value: 50,
            status: "source-backed",
            sourceName: "테스트 조례",
            sourceRef: "제1조",
            asOf: "2026-07-13",
            checkedBy: "테스터",
            checkedRole: "건축사",
          }),
          far: replaceConstraintEvidence(verifiedConstraints.far, {
            value: 100,
            status: "source-backed",
            sourceName: "테스트 조례",
            sourceRef: "제1조",
            asOf: "2026-07-13",
            checkedBy: "테스터",
            checkedRole: "건축사",
          }),
        },
      },
    });

    expect(result.metrics.preliminaryBcrPct).toBe(80);
    expect(result.metrics.preliminaryFarPct).toBe(160);
    expect(result.checks.find((check) => check.code === "bcr")?.status).toBe("fail");
    expect(result.checks.find((check) => check.code === "far")?.status).toBe("fail");
  });

  it("does not turn national reference ceilings into parcel-specific approval", () => {
    const result = calculatePlanningScenario(mixedUseScenario(), {
      ...context,
      parcel: {
        ...context.parcel,
        regulatoryConstraints: referenceConstraints,
      },
    });

    expect(result.checks.find((check) => check.code === "bcr")?.status).toBe("review");
    expect(result.checks.find((check) => check.code === "far")?.status).toBe("review");
    expect(result.checks.find((check) => check.code === "height")?.status).toBe("unknown");
  });

  it("does not auto-exempt a 2-floor 7.9m Seoul plan from north sunlight", () => {
    const scenario = createBlankPlanningScenario({ name: "서울 저층안" });
    scenario.primaryUse = "single-house";
    scenario.floorPrograms = [
      createFloorProgram(1, [createFloorZone("residential", 40, 1)], 3.25),
      createFloorProgram(2, [createFloorZone("residential", 40, 1)], 3.25),
    ];
    const result = calculatePlanningScenario(scenario, {
      ...context,
      parcel: {
        ...context.parcel,
        zoning: "제2종일반주거지역",
        zoningStatus: "source-backed",
        sunlightRuleAsOf: "2026-09-08",
        sunlightNorthBoundary: {
          adjacentZoning: "제2종일반주거지역",
          adjacentZoningStatus: "source-backed",
          separatorType: "none",
          separatorStatus: "source-backed",
        },
      },
    });

    expect(result.metrics.totalHeightM).toBe(7.9);
    expect(result.sunlight.north.exception).toBe("none");
    expect(result.sunlight.north.effectiveDistanceM).toBe(1.5);
    expect(
      result.checks.find((check) => check.code === "sunlight-north")?.message
    ).toContain("1.5m 필요");
  });

  it("keeps the ambiguous multi-family planning label under daylight review", () => {
    const result = calculatePlanningScenario(mixedUseScenario(), {
      ...context,
      parcel: {
        ...context.parcel,
        zoning: "제2종일반주거지역",
        zoningStatus: "source-backed",
        sunlightRuleAsOf: "2026-09-08",
      },
    });

    expect(result.sunlight.daylight.applicability).toBe("review");
    expect(
      result.checks.find((check) => check.code === "sunlight-daylight")?.status
    ).toBe("review");
  });

  it("applies derived checks and economics without replacing the plan definition", () => {
    const scenario = mixedUseScenario();
    const result = calculatePlanningScenario(scenario, context);
    const applied = applyPlanningScenarioCalculation(scenario, result);

    expect(applied.id).toBe(scenario.id);
    expect(applied.floorPrograms).toEqual(scenario.floorPrograms);
    expect(applied.version).toBe(scenario.version);
    expect(applied.checks).toEqual(result.checks);
    expect(applied.economicsPreview).toEqual(result.economicsPreview);
  });
});
