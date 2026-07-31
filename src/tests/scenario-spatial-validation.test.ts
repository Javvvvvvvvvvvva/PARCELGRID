import { describe, expect, it } from "vitest";
import {
  applySpatialValidationToCalculation,
  calculatePlanningSpatialValidation,
  mergePlanningChecks,
} from "@/lib/planning/scenario-spatial-validation";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";
import type {
  PlanningCheck,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

const boundary: [number, number][] = [
  [126.99994, 37.49995],
  [127.00006, 37.49995],
  [127.00006, 37.50005],
  [126.99994, 37.50005],
  [126.99994, 37.49995],
];

function scenarioWithArea(areaSqm: number) {
  const scenario = createBlankPlanningScenario({ name: "공간 판정안" });
  scenario.primaryUse = "retail";
  scenario.floorPrograms = [
    createFloorProgram(1, [createFloorZone("retail", areaSqm, 1)]),
  ];
  return scenario;
}

function baseCalculation(): PlanningScenarioCalculation {
  return {
    scenarioId: "scenario-1",
    metrics: {
      aboveGroundFloors: 1,
      undergroundFloors: 0,
      totalProgramAreaSqm: 20,
      gradeFootprintAreaSqm: 20,
      residentialAreaSqm: 0,
      commercialAreaSqm: 20,
      parkingAreaSqm: 0,
      commonAreaSqm: 0,
      saleableAreaSqm: 20,
      rentableAreaSqm: 0,
      residentialUnitCount: 0,
      commercialUnitCount: 1,
      totalUnitCount: 1,
      unitCount: 0,
      providedCars: 0,
      constructionAreaSqm: 20,
      aboveGroundProgramAreaSqm: 20,
      basementProgramAreaSqm: 0,
      preliminaryFarAreaSqm: 20,
      preliminaryBcrPct: 20,
      preliminaryFarPct: 20,
      totalHeightM: 3,
      requiredCars: 0,
      parkingShortfallCars: 0,
    },
    parking: {
      requiredCars: 0,
      providedCars: 0,
      shortfallCars: 0,
      estimatedCapacityFromProgram: null,
      estimated: false,
      exemptPossible: false,
      basis: [],
      reference: [],
    },
    checks: [
      {
        code: "far",
        label: "예비 용적률",
        status: "pass",
        message: "통과",
      },
    ],
    economicsPreview: {
      status: "estimated",
      acquisitionCostManwon: 0,
      demolitionCostManwon: 0,
      constructionCostManwon: 0,
      softCostManwon: 0,
      contingencyCostManwon: 0,
      financingCostManwon: 0,
      totalCostManwon: 0,
      saleRevenueManwon: 0,
      capitalizedLeaseValueManwon: 0,
      expectedRevenueManwon: 0,
      expectedAnnualNoiManwon: 0,
      profitManwon: 0,
      profitMarginPct: 0,
    },
  };
}

describe("Stage 2 unified spatial validation", () => {
  it("passes a program that fits the legal envelope and current placement", () => {
    const result = calculatePlanningSpatialValidation(
      boundary,
      "일반상업지역",
      scenarioWithArea(20)
    );

    expect(result).not.toBeNull();
    expect(
      result?.checks.find((check) => check.code === "spatial-area-capacity")
        ?.status
    ).toBe("pass");
    expect(
      result?.checks.find((check) => check.code === "spatial-placement")
        ?.status
    ).toBe("pass");
  });

  it("keeps legal placement geometry independent from user design margins", () => {
    const roads = [
      {
        name: "남측 테스트 도로",
        points: [
          [126.9998, 37.4999],
          [127.0002, 37.4999],
        ] as [number, number][],
      },
    ];
    const scenario = scenarioWithArea(20);
    const legalDefault = calculatePlanningSpatialValidation(
      boundary,
      "일반상업지역",
      scenario,
      roads,
      { road: 0, side: 0.5, rear: 0.5 }
    );
    const generousDesignMargin = calculatePlanningSpatialValidation(
      boundary,
      "일반상업지역",
      scenario,
      roads,
      { road: 3, side: 3, rear: 3 }
    );

    expect(generousDesignMargin?.envelopeSteps[0].shape).toEqual(
      legalDefault?.envelopeSteps[0].shape
    );
    expect(generousDesignMargin?.model.floors[0].shape).toEqual(
      legalDefault?.model.floors[0].shape
    );
    expect(generousDesignMargin?.assessment).toEqual(
      legalDefault?.assessment
    );
  });

  it("separates area-capacity failure from translated placement failure", () => {
    const oversized = calculatePlanningSpatialValidation(
      boundary,
      "일반상업지역",
      scenarioWithArea(300)
    );
    expect(
      oversized?.checks.find(
        (check) => check.code === "spatial-area-capacity"
      )?.status
    ).toBe("fail");

    const movedScenario = scenarioWithArea(20);
    movedScenario.placement.offsetXM = 50;
    const moved = calculatePlanningSpatialValidation(
      boundary,
      "일반상업지역",
      movedScenario
    );
    expect(
      moved?.checks.find((check) => check.code === "spatial-placement")
        ?.status
    ).toBe("fail");
  });

  it("merges spatial checks into the calculation used by cards and detail panels", () => {
    const spatialChecks: PlanningCheck[] = [
      {
        code: "spatial-area-capacity",
        label: "층별 법규 외곽선",
        status: "fail",
        message: "면적 초과",
      },
    ];
    const merged = mergePlanningChecks(baseCalculation().checks, spatialChecks);
    expect(merged.map((check) => check.code)).toEqual([
      "far",
      "spatial-area-capacity",
    ]);

    const applied = applySpatialValidationToCalculation(baseCalculation(), {
      model: {
        floors: [],
        aboveGroundFloors: [],
        basementFloors: [],
        totalHeightM: 0,
        basementDepthM: 0,
        capacity: {
          allFloorsFit: false,
          overCapacityFloorCount: 1,
          totalShortfallSqm: 10,
          maxShortfallSqm: 10,
        },
      },
      envelopeSteps: [],
      assessment: {
        allFloorsFit: false,
        areaOverCapacityFloorCount: 1,
        outsideFloorCount: 0,
        totalCapacityShortfallSqm: 10,
        floors: [],
      },
      checks: spatialChecks,
      warnings: [],
    });
    expect(
      applied.checks.find(
        (check) => check.code === "spatial-area-capacity"
      )?.status
    ).toBe("fail");
  });
});
