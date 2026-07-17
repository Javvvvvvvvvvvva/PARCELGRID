import { describe, expect, it } from "vitest";
import { defaultAssumptions } from "@/lib/finance/scenario";
import type { Parcel } from "@/lib/finance/types";
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

function calculate(scenario: ReturnType<typeof mixedScenario>) {
  return calculatePlanningScenario(scenario, {
    parcel: {
      lotAreaSqm: parcel.lotArea,
      maxFARPct: parcel.maxFAR,
      maxBCRPct: parcel.maxBCR,
      heightLimitM: parcel.heightLimit,
      acquisitionCostManwon: parcel.acquiredPrice,
      demolitionCostManwon: parcel.demolitionCost ?? 0,
    },
    assumptions: planningEconomicsAssumptionsFromLegacy(
      defaultAssumptions(),
      "bridge-test"
    ),
    calculatedAt: "2026-07-15T00:00:00.000Z",
  });
}

describe("PlanningScenario → finance bridge", () => {
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
    expect(program.units).toEqual({ residential: 3, retail: 1 });
    expect(program.mix.residentialSale).toBeCloseTo(60 / 150, 8);
    expect(program.mix.residentialLease).toBeCloseTo(50 / 150, 8);
    expect(program.mix.retail).toBeCloseTo(40 / 150, 8);
    expect(
      program.mix.residentialSale +
        program.mix.residentialLease +
        program.mix.retail
    ).toBeCloseTo(1, 10);
  });

  it("recomputes the dashboard with the representative plan as recommended", () => {
    const scenario = mixedScenario();
    const computed = recomputeFromPlanningScenarios(
      parcel,
      [scenario],
      scenario.id,
      null,
      { calculateMaxAcquisition: false }
    );

    expect(computed).not.toBeNull();
    const representative = computed!.scenarios[0];
    expect(representative.id).toBe(scenario.id);
    expect(representative.recommended).toBe(true);
    expect(representative.type).toBe("mixed");
    expect(representative.gfa).toBeCloseTo(160, 6);
    expect(representative.far).toBeCloseTo(160, 6);
    expect(representative.bcr).toBeCloseTo(60, 6);
    expect(representative.floors).toEqual({ above: 3, below: 1 });
    expect(representative.units).toEqual({ residential: 3, retail: 1 });
    expect(computed!.scenarioComparison).toBeUndefined();
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
