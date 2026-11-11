import { molitEvidenceFixture } from "./helpers/molit-evidence-fixture";
import { describe, expect, it } from "vitest";
import {
  calculateScenario,
  defaultAssumptions,
} from "@/lib/finance/scenario";
import { calcProgramParking } from "@/lib/finance/parking";
import { buildFinancialReconciliationAudit } from "@/lib/finance/reconciliation-audit";
import { withScenarioRevenueUnitPrice } from "@/lib/finance/revenue-contract";
import type { AssumptionSet, Parcel } from "@/lib/finance/types";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";
import { recomputeFromPlanningScenarios } from "@/lib/services/recompute-from-planning-scenarios";

const parcel: Parcel = {
  id: "parcel-bridge",
  address: "서울 테스트구 테스트동 1-1",
  addressRoad: "테스트로 1",
  lotArea: 100,
  zoning: "제2종일반주거지역",
  zoneCode: "UB20",
  maxFAR: 200,
  maxBCR: 60,
  heightLimit: 18,
  setback: { road: 0, side: 0, rear: 0 },
  currentBuilding: null,
  landPrice: 5_000_000,
  estMarketPrice: 8_000_000,
  acquired: "2026-01-01",
  acquiredPrice: 80_000,
  demolitionCost: 2_000,
};

function mixedScenario() {
  const scenario = createBlankPlanningScenario({
    projectId: parcel.id,
    name: "층별 혼합 대표안",
  });
  scenario.status = "saved";
  scenario.primaryUse = "mixed";
  scenario.floorPrograms = [
    createFloorProgram(1, [
      createFloorZone("retail", 40, 1, "근린생활", "lease"),
      createFloorZone("common", 10, 0, "공용", "non-revenue"),
    ]),
    createFloorProgram(2, [
      createFloorZone("residential", 60, 2, "매각 주거", "sale"),
    ]),
    createFloorProgram(3, [
      createFloorZone("residential", 50, 1, "임대 주거", "lease"),
    ]),
    createFloorProgram(-1, [
      createFloorZone("parking", 70, 0, "지하주차", "non-revenue"),
    ]),
  ];
  scenario.parking = { strategy: "basement", providedCars: 3 };
  return scenario;
}

function calculate(
  scenario: ReturnType<typeof mixedScenario>,
  assumptionOverrides: Partial<AssumptionSet> = {},
) {
  return calculatePlanningScenario(scenario, {
    parcel: {
      address: parcel.address,
      parkingRuleAsOf: "2026-09-08",
      lotAreaSqm: parcel.lotArea,
      maxFARPct: parcel.maxFAR,
      maxBCRPct: parcel.maxBCR,
      heightLimitM: parcel.heightLimit,
      acquisitionCostManwon: parcel.acquiredPrice,
      demolitionCostManwon: parcel.demolitionCost ?? 0,
    },
    assumptions: planningEconomicsAssumptionsFromLegacy(
      { ...defaultAssumptions(), ...assumptionOverrides },
      "bridge-test"
    ),
    calculatedAt: "2026-07-15T00:00:00.000Z",
  });
}

describe("PlanningScenario → finance bridge", () => {
  it("preserves failed transaction evidence across recalculation even with zero observations", () => {
    const scenario = mixedScenario();
    const previous = recomputeFromPlanningScenarios(parcel, [scenario], scenario.id, null, { calculateMaxAcquisition: false })!;
    previous.transactionEvidence = [molitEvidenceFixture({ status: "unavailable", completedMonths: [], failedMonths: [{ month: "202601", issue: "access-denied" }], transactionCount: 0 })];
    const result = recomputeFromPlanningScenarios(parcel, [scenario], scenario.id, previous, { calculateMaxAcquisition: false });
    expect(result?.transactionEvidence).toEqual(previous.transactionEvidence);
    expect(result?.saleEstimate).toBeUndefined();
  });
  it("uses realized floor-program FAR, BCR, floors, units and revenue mix", () => {
    const scenario = mixedScenario();
    const calculation = calculate(scenario);
    const program = planningScenarioToBuildingProgram(scenario, calculation);

    expect(calculation.metrics.preliminaryFarAreaSqm).toBe(160);
    expect(program.type).toBe("mixed");
    expect(program.far).toBe(160);
    expect(program.bcr).toBe(60);
    expect(program.floorsAbove).toBe(3);
    expect(program.floorsBelow).toBe(1);
    expect(program.areaContract).toMatchObject({
      constructionAreaSqm: 230,
      aboveGroundAreaSqm: 160,
      basementAreaSqm: 70,
      farAreaSqm: 160,
      parkingAreaSqm: 70,
      commonAreaSqm: 10,
      saleableAreaSqm: 60,
      rentableAreaSqm: 90,
      parkingRequirement: {
        rule: {
          id: "parking-kr-seoul-2026-07-13",
          status: "source-backed",
        },
        decisionGrade: false,
        estimated: true,
      },
    });
    expect(program.units).toEqual({ residential: 3, retail: 1 });
    expect(program.mix.residentialSale).toBeCloseTo(60 / 150, 8);
    expect(program.mix.residentialLease).toBeCloseTo(50 / 150, 8);
    expect(program.mix.retail).toBeCloseTo(40 / 150, 8);
    expect(
      program.mix.residentialSale +
        program.mix.residentialLease +
        program.mix.retail
    ).toBeCloseTo(1, 10);

    const parking = calcProgramParking(parcel, program);
    expect(parking.requiredCars).toBe(
      program.areaContract?.requiredParkingSpaces
    );
    expect(parking.rule.id).toBe("parking-kr-seoul-2026-07-13");
    expect(parking.estimated).toBe(true);
  });

  it("recomputes the dashboard with the representative plan as recommended", () => {
    const scenario = mixedScenario();
    const computed = recomputeFromPlanningScenarios(
      parcel,
      [scenario],
      scenario.id,
      null,
      {
        calculateMaxAcquisition: false,
        geometryHashes: { [scenario.id]: "PG-BRIDGE-GEOMETRY" },
      }
    );

    expect(computed).not.toBeNull();
    const representative = computed!.scenarios[0];
    expect(representative.id).toBe(scenario.id);
    expect(representative.recommended).toBe(true);
    expect(representative.type).toBe("mixed");
    expect(representative.gfa).toBeCloseTo(230, 6);
    expect(representative.far).toBeCloseTo(160, 6);
    expect(representative.bcr).toBeCloseTo(60, 6);
    expect(representative.floors).toEqual({ above: 3, below: 1 });
    expect(representative.units).toEqual({ residential: 3, retail: 1 });
    expect(
      representative._raw.program.areaContract?.geometrySource?.geometryHash
    ).toBe("PG-BRIDGE-GEOMETRY");
    expect(computed!.scenarioComparison).toBeUndefined();
  });

  it("preserves validated sale and rent source references in the locked pricing snapshot", () => {
    const scenario = mixedScenario();
    const sourceBase = {
      sourceKind: "official-api" as const,
      sourceName: "테스트 공식 데이터",
      documentRef: "https://example.test/source",
      asOf: "2026-09-01",
      verifiedBy: "테스트 확인자",
      recordedAt: "2026-09-02",
    };
    const computed = recomputeFromPlanningScenarios(
      parcel,
      [scenario],
      scenario.id,
      null,
      {
        calculateMaxAcquisition: false,
        financialSources: {
          salePricePerSqM: {
            ...sourceBase,
            field: "salePricePerSqM",
            value: 7_000_000,
          },
          rentPerSqMMonth: {
            ...sourceBase,
            field: "rentPerSqMMonth",
            value: 30_000,
          },
        },
      },
    );

    const pricing =
      computed!.scenarios[0]._raw.program.areaContract!.revenueProjection!
        .pricing;
    expect(pricing.pools.residentialSale).toMatchObject({
      unitPriceWon: 7_000_000,
      sourceStatus: "source-backed",
      sourceName: "테스트 공식 데이터",
      sourceRef: "https://example.test/source",
    });
    expect(pricing.pools.retailLease).toMatchObject({
      unitPriceWon: 36_000,
      adjustmentFactor: 1.2,
      sourceStatus: "source-backed",
    });
  });

  it("carries the sourced facade cost delta into Stage 3 hard cost", () => {
    const baseScenario = mixedScenario();
    const baseComputed = recomputeFromPlanningScenarios(
      parcel,
      [baseScenario],
      baseScenario.id,
      null,
      { calculateMaxAcquisition: false }
    );

    const materialScenario = mixedScenario();
    materialScenario.materials = {
      primaryFacadeMaterial: "brick-veneer",
      secondaryFacadeMaterial: "exposed-concrete",
      primaryFacadeSharePct: 80,
      windowRatioPct: 25,
      facadeAreaOverrideSqm: 100,
      baselineFacadeUnitCostPerSqmWon: 100_000,
      selectedFacadeUnitCostPerSqmWon: 200_000,
      rateEvidence: {
        status: "source-backed",
        sourceName: "테스트 견적서",
        observedAt: "2026-07-29",
      },
    };
    const materialComputed = recomputeFromPlanningScenarios(
      parcel,
      [materialScenario],
      materialScenario.id,
      null,
      { calculateMaxAcquisition: false }
    );

    expect(baseComputed).not.toBeNull();
    expect(materialComputed).not.toBeNull();
    expect(
      materialComputed!.scenarios[0].hardCost -
        baseComputed!.scenarios[0].hardCost
    ).toBeCloseTo(1_000, 6);
  });

  it("keeps residential, retail and office sale/lease pools distinct across stages", () => {
    const scenario = mixedScenario();
    scenario.floorPrograms = [
      createFloorProgram(1, [
        createFloorZone("residential", 10, 1, "주거 매각", "sale"),
        createFloorZone("retail", 20, 1, "상가 매각", "sale"),
        createFloorZone("office", 30, 1, "업무 매각", "sale"),
      ]),
      createFloorProgram(2, [
        createFloorZone("residential", 40, 1, "주거 임대", "lease"),
        createFloorZone("retail", 50, 1, "상가 임대", "lease"),
        createFloorZone("office", 60, 1, "업무 임대", "lease"),
      ]),
    ];
    scenario.parking = { strategy: "surface", providedCars: 4 };
    const calculation = calculate(scenario);
    const program = planningScenarioToBuildingProgram(scenario, calculation);

    expect(program.areaContract?.revenueAreas).toEqual({
      residentialSaleSqm: 10,
      retailSaleSqm: 20,
      officeSaleSqm: 30,
      residentialLeaseSqm: 40,
      retailLeaseSqm: 50,
      officeLeaseSqm: 60,
    });

    const assumptions = defaultAssumptions();
    const result = calculateScenario({
      parcel,
      scenario: {
        id: scenario.id,
        name: scenario.name,
        shortName: scenario.name,
        program,
        assumptions,
      },
    });
    const vacancyFactor = 1 - assumptions.vacancyRate / 100;
    const officeLeaseValueManwon =
      (60 *
        assumptions.rentPerSqMMonth *
        12 *
        vacancyFactor *
        (1 - assumptions.operatingExpenseRate / 100) *
        0.85) /
      (assumptions.capRate / 100) /
      10_000;

    expect(result.revenueByPool.officeLease).toBeCloseTo(
      officeLeaseValueManwon,
      0,
    );
    expect(calculation.economicsPreview.expectedRevenueManwon).toBeCloseTo(
      result.totalRevenue,
      0,
    );

    const financeScenario = {
      id: scenario.id,
      name: scenario.name,
      shortName: scenario.name,
      program,
      assumptions,
    };
    const audit = buildFinancialReconciliationAudit({
      result,
      scenario: financeScenario,
    });
    const revenueCheckIds = new Set([
      "stage2-residentialSale",
      "stage2-retailSale",
      "stage2-officeSale",
      "stage2-residentialLease",
      "stage2-retailLease",
      "stage2-officeLease",
    ]);
    expect(
      audit.checks
        .filter((check) => revenueCheckIds.has(check.id))
        .every((check) => check.status === "pass"),
    ).toBe(true);
    expect(
      audit.checks.find((check) => check.id === "stage2-hard-cost")?.status,
    ).toBe("pass");
    expect(
      audit.checks.find((check) => check.id === "stage2-financing")?.status,
    ).toBe("review");

    const aliasOnlyScenario = {
      ...financeScenario,
      assumptions: {
        ...assumptions,
        salePricePerSqM: assumptions.salePricePerSqM * 1.1,
      },
    };
    const aliasOnlyResult = calculateScenario({
      parcel,
      scenario: aliasOnlyScenario,
    });
    expect(aliasOnlyResult.revenueByPool.retailSale).toBeCloseTo(
      result.revenueByPool.retailSale,
      8,
    );

    const repricedScenario = withScenarioRevenueUnitPrice(
      financeScenario,
      "sale",
      assumptions.salePricePerSqM * 1.1,
    );
    const repricedResult = calculateScenario({
      parcel,
      scenario: repricedScenario,
    });
    const repricedAudit = buildFinancialReconciliationAudit({
      result: repricedResult,
      scenario: repricedScenario,
    });
    expect(
      repricedAudit.checks.find(
        (check) => check.id === "stage2-retailSale",
      )?.status,
    ).toBe("review");
  });

  it("does not turn unsupported common space into sale or lease revenue", () => {
    const scenario = mixedScenario();
    scenario.floorPrograms = [
      createFloorProgram(1, [
        createFloorZone("common", 40, 0, "공용 매각 입력", "sale"),
      ]),
    ];
    const calculation = calculate(scenario);
    const program = planningScenarioToBuildingProgram(scenario, calculation);

    expect(program.areaContract?.saleableAreaSqm).toBe(0);
    expect(program.areaContract?.rentableAreaSqm).toBe(0);
    expect(calculation.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported-revenue-use",
          status: "fail",
        }),
      ]),
    );
  });

  it("reconciles explicit acquisition, relocation, PF and trust costs across stages", () => {
    const scenario = mixedScenario();
    const overrides: Partial<AssumptionSet> = {
      acquisitionTaxManwon: 1_000,
      acquisitionOtherCostManwon: 500,
      tenantRelocationCostManwon: 750,
      pfUpfrontFeeRate: 2,
      trustFeeManwon: 400,
    };
    const assumptions = { ...defaultAssumptions(), ...overrides };
    const calculation = calculate(scenario, overrides);
    const program = planningScenarioToBuildingProgram(scenario, calculation);
    const financeScenario = {
      id: scenario.id,
      name: scenario.name,
      shortName: scenario.name,
      program,
      assumptions,
    };
    const result = calculateScenario({ parcel, scenario: financeScenario });
    const audit = buildFinancialReconciliationAudit({
      result,
      scenario: financeScenario,
    });

    expect(result).toMatchObject({
      acquisitionTax: 1_000,
      acquisitionOtherCost: 500,
      tenantRelocationCost: 750,
      trustFee: 400,
    });
    for (const id of [
      "stage2-acquisition-ancillary",
      "stage2-relocation",
      "stage2-pf-fee",
      "stage2-trust-fee",
    ]) {
      expect(audit.checks.find((check) => check.id === id)?.status).toBe(
        "pass",
      );
    }
    expect(
      audit.checks.find((check) => check.id === "stage2-financing")?.status,
    ).toBe("review");
  });

  it("rejects a calculation that belongs to another planning scenario", () => {
    const scenario = mixedScenario();
    const calculation = calculate(scenario);
    expect(() =>
      planningScenarioToBuildingProgram(
        { ...scenario, id: "different-plan" },
        calculation
      )
    ).toThrow(/ID가 일치하지 않습니다/);
  });
});
