import { describe, expect, it } from "vitest";
import {
  calculateScenario,
  defaultAssumptions,
} from "@/lib/finance/scenario";
import {
  FINANCIAL_GEOMETRY_CONTRACT_VERSION,
  type Parcel,
  type Scenario,
} from "@/lib/finance/types";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import type { PlanningScenario } from "@/lib/planning/types";

const parcel: Parcel = {
  id: "1132010500102810023",
  address: "서울 도봉구 쌍문동 281-23",
  addressRoad: "",
  lotArea: 118.02,
  zoning: "제2종일반주거지역",
  zoneCode: "UB20",
  maxFAR: 250,
  maxBCR: 60,
  heightLimit: 18,
  setback: { road: 0, side: 0, rear: 0 },
  currentBuilding: null,
  landPrice: 5_000_000,
  estMarketPrice: 8_000_000,
  acquired: "2026-07-30",
  acquiredPrice: 80_000,
  demolitionCost: 0,
};

const emptyEconomicsPreview: PlanningScenario["economicsPreview"] = {
  status: "not-calculated",
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
};

function ssangmunPlanningScenario(): PlanningScenario {
  return {
    id: "ssangmun-reference",
    projectId: parcel.id,
    name: "쌍문동 2층 기준안",
    description: "기준 이미지 형상을 보존한 2층 다가구 계획안",
    origin: "custom",
    status: "saved",
    version: 3,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    primaryUse: "multi-family",
    floorPrograms: [
      {
        id: "floor-1",
        level: 1,
        label: "1층",
        floorHeightM: 3,
        footprintScalePct: 100,
        northSetbackM: 0,
        zones: [
          {
            id: "floor-1-residential",
            useType: "residential",
            areaSqm: 28.3,
            saleableAreaSqm: 28.3,
            revenueModel: "sale",
            unitCount: 1,
          },
        ],
      },
      {
        id: "floor-2",
        level: 2,
        label: "2층",
        floorHeightM: 3,
        footprintScalePct: 100,
        northSetbackM: 0,
        zones: [
          {
            id: "floor-2-residential",
            useType: "residential",
            areaSqm: 28.3,
            saleableAreaSqm: 28.3,
            revenueModel: "sale",
            unitCount: 0,
          },
        ],
      },
    ],
    placement: {
      rotationDeg: 0,
      offsetXM: 0,
      offsetZM: 0,
      roadSetbackM: 0,
      northSetbackM: 0,
    },
    parking: {
      strategy: "none",
      providedCars: 0,
    },
    geometrySource: {
      mode: "reference-image",
      exactGeometryAvailable: false,
      sourceName: "PARCELGRID 3D 기준 이미지",
      locked: true,
      note: "정확한 좌표가 없어 기준 이미지 형상과 카메라 구도를 보존",
    },
    checks: [],
    economicsPreview: emptyEconomicsPreview,
  };
}

function financeScenario(): Scenario {
  const planningScenario = ssangmunPlanningScenario();
  const assumptions = defaultAssumptions();
  const calculation = calculatePlanningScenario(planningScenario, {
    parcel: {
      lotAreaSqm: parcel.lotArea,
      maxFARPct: parcel.maxFAR,
      maxBCRPct: parcel.maxBCR,
      heightLimitM: parcel.heightLimit,
      acquisitionCostManwon: parcel.acquiredPrice,
      demolitionCostManwon: parcel.demolitionCost ?? 0,
    },
    assumptions: planningEconomicsAssumptionsFromLegacy(
      assumptions,
      "ssangmun-contract-test"
    ),
    calculatedAt: "2026-08-03T00:00:00.000Z",
  });

  return {
    id: planningScenario.id,
    name: planningScenario.name,
    shortName: "쌍문동 기준안",
    program: planningScenarioToBuildingProgram(
      planningScenario,
      calculation
    ),
    assumptions,
  };
}

describe("Stage 2 → Stage 3 financial geometry contract", () => {
  it("carries the locked two-floor Ssangmun areas without rebuilding them from FAR", () => {
    const scenario = financeScenario();
    const contract = scenario.program.areaContract;

    expect(contract).toMatchObject({
      schemaVersion: FINANCIAL_GEOMETRY_CONTRACT_VERSION,
      source: "stage2-planning",
      sourceScenarioId: scenario.id,
      sourceScenarioVersion: 3,
      constructionAreaSqm: 56.6,
      aboveGroundAreaSqm: 56.6,
      basementAreaSqm: 0,
      farAreaSqm: 56.6,
      gradeFootprintAreaSqm: 28.3,
      saleableAreaSqm: 56.6,
      rentableAreaSqm: 0,
      revenueAreas: {
        residentialSaleSqm: 56.6,
        residentialLeaseSqm: 0,
        retailSqm: 0,
      },
      geometrySource: {
        mode: "reference-image",
        exactGeometryAvailable: false,
        locked: true,
      },
    });

    const result = calculateScenario({ parcel, scenario });

    expect(result.gfa).toBeCloseTo(56.6, 2);
    expect(result.buildingArea).toBeCloseTo(28.3, 2);
    expect(result.effectiveGFA).toBeCloseTo(56.6, 2);
    expect(result.hardCost).toBeCloseTo(
      (56.6 * scenario.assumptions.constCostPerSqM) / 10_000,
      1
    );
  });

  it("charges basement area separately with the explicit multiplier", () => {
    const baseScenario = financeScenario();
    const baseContract = baseScenario.program.areaContract!;
    const baseResult = calculateScenario({ parcel, scenario: baseScenario });
    const basementAreaSqm = 20;
    const basementScenario: Scenario = {
      ...baseScenario,
      program: {
        ...baseScenario.program,
        floorsBelow: 1,
        areaContract: {
          ...baseContract,
          constructionAreaSqm:
            baseContract.aboveGroundAreaSqm + basementAreaSqm,
          basementAreaSqm,
          parkingAreaSqm: basementAreaSqm,
        },
      },
    };

    const basementResult = calculateScenario({
      parcel,
      scenario: basementScenario,
    });
    const expectedIncrease =
      (basementAreaSqm *
        (baseScenario.assumptions.basementCostMultiplier ?? 1.25) *
        baseScenario.assumptions.constCostPerSqM) /
      10_000;

    expect(basementResult.hardCost).toBeCloseTo(
      baseResult.hardCost + expectedIncrease,
      1
    );
    expect(basementResult.hardCost).toBeGreaterThan(baseResult.hardCost);
  });

  it("blocks a stale area contract from a different planning scenario", () => {
    const scenario = financeScenario();
    const staleScenario: Scenario = {
      ...scenario,
      program: {
        ...scenario.program,
        areaContract: {
          ...scenario.program.areaContract!,
          sourceScenarioId: "another-planning-scenario",
        },
      },
    };

    expect(() => calculateScenario({ parcel, scenario: staleScenario })).toThrow(
      "Stage 2/3 계획안 ID가 일치하지 않습니다"
    );
  });
});
