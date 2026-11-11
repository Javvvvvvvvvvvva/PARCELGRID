import { describe, expect, it } from "vitest";
import type { ScenarioVM } from "@/lib/adapters/view-model";
import {
  FINANCIAL_GEOMETRY_CONTRACT_VERSION,
  STAGE2_ECONOMICS_CONTRACT_VERSION,
} from "@/lib/finance/types";
import {
  createRevenuePricingSnapshot,
  valueRevenueAreaPools,
} from "@/lib/finance/revenue-contract";
import { PLANNING_GEOMETRY_VERSION, type PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningScenario } from "@/lib/planning/types";
import { resolveStage3DashboardContext } from "@/lib/stage3/dashboard-model";

const planning = {
  id: "PLAN-1",
  projectId: "PROJECT-1",
  version: 3,
  name: "대표 계획안",
  checks: [
    { code: "bcr", label: "건폐율", status: "pass", message: "확인" },
    { code: "far", label: "용적률", status: "pass", message: "확인" },
    { code: "height", label: "높이", status: "pass", message: "확인" },
    { code: "parking", label: "주차", status: "pass", message: "확인" },
  ],
} as PlanningScenario;

const geometry = {
  version: PLANNING_GEOMETRY_VERSION,
  projectId: "PROJECT-1",
  scenarioId: "PLAN-1",
  scenarioVersion: 3,
  geometryHash: "PG-PLAN-1",
  building: {
    totalProgramAreaSqm: 120,
    aboveGroundFloors: [
      { programAreaSqm: 60 },
      { programAreaSqm: 60 },
    ],
    basementFloors: [],
  },
  validation: {
    status: "pass",
    representativeEligible: true,
    exportable: true,
    issues: [],
  },
} as unknown as PlanningGeometrySnapshot;

const revenueAreas = {
  residentialSaleSqm: 120,
  retailSaleSqm: 0,
  officeSaleSqm: 0,
  residentialLeaseSqm: 0,
  retailLeaseSqm: 0,
  officeLeaseSqm: 0,
};

const revenueProjection = valueRevenueAreaPools(
  revenueAreas,
  createRevenuePricingSnapshot({
    unitPricesWon: {
      residentialSale: 1,
      retailSale: 1,
      officeSale: 1,
      residentialLease: 1,
      retailLease: 1,
      officeLease: 1,
    },
    vacancyRatePct: 0,
    capRatePct: 5,
  }),
);

const finance = {
  id: "PLAN-1",
  recommended: false,
  _raw: {
    program: {
      areaContract: {
        schemaVersion: FINANCIAL_GEOMETRY_CONTRACT_VERSION,
        source: "stage2-planning",
        sourceScenarioId: "PLAN-1",
        sourceScenarioVersion: 3,
        constructionAreaSqm: 120,
        aboveGroundAreaSqm: 120,
        basementAreaSqm: 0,
        farAreaSqm: 120,
        gradeFootprintAreaSqm: 60,
        parkingAreaSqm: 0,
        commonAreaSqm: 0,
        saleableAreaSqm: 120,
        rentableAreaSqm: 0,
        revenueAreas,
        revenueProjection,
        stage2Economics: {
          modelVersion: STAGE2_ECONOMICS_CONTRACT_VERSION,
          inputs: {
            constructionCostPerSqmWon: 1,
            basementCostMultiplier: 1.25,
            softCostRatePct: 10,
            contingencyRatePct: 5,
            financingCostRatePct: 3,
            acquisitionTaxManwon: 0,
            acquisitionOtherCostManwon: 0,
            tenantRelocationCostManwon: 0,
            pfUpfrontFeeRatePct: 0,
            trustFeeManwon: 0,
            ltcTargetPct: 70,
          },
          acquisitionCostManwon: 0,
          acquisitionTaxManwon: 0,
          acquisitionOtherCostManwon: 0,
          demolitionCostManwon: 0,
          tenantRelocationCostManwon: 0,
          hardCostManwon: 0,
          softCostManwon: 0,
          contingencyCostManwon: 0,
          interestEstimateManwon: 0,
          pfFeeManwon: 0,
          trustFeeManwon: 0,
          financingCostManwon: 0,
          totalCostManwon: 0,
          totalRevenueManwon: revenueProjection.totalRevenueManwon,
          profitManwon: revenueProjection.totalRevenueManwon,
        },
        providedParkingSpaces: 1,
        requiredParkingSpaces: 1,
        materialAdjustmentCostManwon: 0,
        geometrySource: {
          mode: "engine-generated",
          exactGeometryAvailable: true,
          locked: true,
          geometryHash: "PG-PLAN-1",
        },
      },
    },
  },
} as ScenarioVM;

describe("Stage 3 dashboard source contract", () => {
  it("blocks a stale geometry engine even if identifiers and previous pass flags match", () => {
    const stale = { ...geometry, version: "planning-geometry-v3" } as unknown as PlanningGeometrySnapshot;
    expect(resolveStage3DashboardContext({ projectId: "PROJECT-1", representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: stale, planningScenarios: [planning], financeScenarios: [finance] })).toMatchObject({ ready: false, code: "stale-geometry" });
  });
  it("requires an explicit finance geometry hash", () => {
    const stale = structuredClone(finance);
    delete stale._raw.program.areaContract!.geometrySource!.geometryHash;
    expect(resolveStage3DashboardContext({ projectId: "PROJECT-1", representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: geometry, planningScenarios: [planning], financeScenarios: [stale] })).toMatchObject({ ready: false, code: "stale-finance-contract" });
  });
  it("blocks legacy dashboard fallback when no representative is confirmed", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: null,
      representativeGeometrySnapshot: null,
      planningScenarios: [planning],
      financeScenarios: [{ id: "LEGACY", recommended: true } as ScenarioVM],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("missing-representative");
  });

  it("uses the exact representative ID instead of the finance recommended flag", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: geometry,
      planningScenarios: [planning],
      financeScenarios: [
        { id: "LEGACY", recommended: true } as ScenarioVM,
        finance,
      ],
    });

    expect(result.ready).toBe(true);
    if (result.ready) expect(result.financeScenario.id).toBe("PLAN-1");
  });

  it("blocks a representative whose core legal source is still review-only", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: geometry,
      planningScenarios: [
        {
          ...planning,
          checks: planning.checks.map((check) =>
            check.code === "height"
              ? { ...check, status: "review" as const }
              : check
          ),
        },
      ],
      financeScenarios: [finance],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("invalid-planning-checks");
  });

  it("blocks a stale geometry snapshot after the plan version changes", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: {
        ...geometry,
        scenarioVersion: 2,
      },
      planningScenarios: [planning],
      financeScenarios: [finance],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("stale-geometry");
  });

  it("blocks a stale Stage 2 financial contract after the plan version changes", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: geometry,
      planningScenarios: [planning],
      financeScenarios: [
        {
          ...finance,
          _raw: {
            ...finance._raw,
            program: {
              ...finance._raw.program,
              areaContract: {
                ...finance._raw.program.areaContract!,
                sourceScenarioVersion: 2,
              },
            },
          },
        },
      ],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("stale-finance-contract");
  });

  it("blocks a financial contract tied to a different geometry hash", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: geometry,
      planningScenarios: [planning],
      financeScenarios: [
        {
          ...finance,
          _raw: {
            ...finance._raw,
            program: {
              ...finance._raw.program,
              areaContract: {
                ...finance._raw.program.areaContract!,
                geometrySource: {
                  ...finance._raw.program.areaContract!.geometrySource!,
                  geometryHash: "PG-OTHER",
                },
              },
            },
          },
        },
      ],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("stale-finance-contract");
  });

  it("blocks a geometry failure even when financial data exists", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: {
        ...geometry,
        validation: {
          ...geometry.validation,
          status: "fail",
          representativeEligible: false,
        },
      },
      planningScenarios: [planning],
      financeScenarios: [finance],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("invalid-geometry");
  });

  it("blocks mismatched financial results instead of showing another plan", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: geometry,
      planningScenarios: [planning],
      financeScenarios: [{ id: "OTHER" } as ScenarioVM],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("missing-finance-scenario");
  });
});
