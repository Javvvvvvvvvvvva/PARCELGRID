import { describe, expect, it } from "vitest";
import { defaultAssumptions } from "@/lib/finance/scenario";
import type { Parcel, Scenario } from "@/lib/finance/types";
import { computeProject } from "@/lib/services/compute-project";
import { commitStage3FeasibilitySnapshot } from "@/lib/services/commit-stage3-feasibility";

const parcel: Parcel = {
  id: "stage3-save",
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

function scenario(id = "representative"): Scenario {
  return {
    id,
    name: "2층 다가구 대표안",
    shortName: "대표안",
    program: {
      type: "multi-family",
      far: 48,
      bcr: 24,
      floorsAbove: 2,
      floorsBelow: 0,
      units: { residential: 1, retail: 0 },
      mix: { residentialSale: 1, residentialLease: 0, retail: 0 },
    },
    assumptions: defaultAssumptions(),
  };
}

describe("Stage 3 feasibility snapshot", () => {
  it("commits the edited representative scenario and acquisition price", () => {
    const baseScenario = scenario();
    const previous = computeProject(parcel, [baseScenario], {
      recommendedId: baseScenario.id,
      calculateMaxAcquisition: false,
    });
    const editedScenario: Scenario = {
      ...baseScenario,
      assumptions: {
        ...baseScenario.assumptions,
        constCostPerSqM: baseScenario.assumptions.constCostPerSqM * 1.2,
      },
    };
    const editedParcel = { ...parcel, acquiredPrice: 95_000 };

    const committed = commitStage3FeasibilitySnapshot(
      previous,
      editedParcel,
      editedScenario
    );
    const saved = committed.scenarios.find((item) => item.id === baseScenario.id);

    expect(committed.parcel.acquiredPrice).toBe(95_000);
    expect(saved?.recommended).toBe(true);
    expect(saved?._raw.assumptions.constCostPerSqM).toBe(
      editedScenario.assumptions.constCostPerSqM
    );
    expect(saved?.profit).not.toBe(previous.scenarios[0].profit);
    expect(saved?.profitAtLowCost).toBeTypeOf("number");
    expect(saved?.profitAtHighCost).toBeTypeOf("number");
  });

  it("preserves saved comparison plans while replacing the representative", () => {
    const representative = scenario();
    const comparison = scenario("comparison");
    const previous = computeProject(parcel, [representative, comparison], {
      recommendedId: representative.id,
      calculateMaxAcquisition: false,
    });

    const committed = commitStage3FeasibilitySnapshot(
      previous,
      parcel,
      {
        ...representative,
        assumptions: {
          ...representative.assumptions,
          interestRate: 9.5,
        },
      }
    );

    expect(committed.scenarios.map((item) => item.id)).toEqual([
      representative.id,
      comparison.id,
    ]);
    expect(committed.scenarios[0].recommended).toBe(true);
    expect(committed.scenarios[1]._raw).toEqual(comparison);
  });
});
