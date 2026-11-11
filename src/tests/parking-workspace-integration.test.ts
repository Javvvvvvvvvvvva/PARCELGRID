import { describe, expect, it } from "vitest";
import { calculateParkingLayout } from "@/lib/planning/parking-layout";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";

const parcel = [
  { x: -6, z: -9 },
  { x: 6, z: -9 },
  { x: 6, z: 9 },
  { x: -6, z: 9 },
];

describe("Stage 2 parking workspace integration", () => {
  it("produces an actual capacity that can replace the manually stored parking count", () => {
    const scenario = createBlankPlanningScenario({ name: "필로티 주차안" });
    scenario.parking = {
      ...scenario.parking,
      strategy: "piloti",
      providedCars: 9,
      stallWidthM: 2.5,
      stallDepthM: 5,
      aisleWidthM: 6,
      coreAreaSqm: 0,
      columnLossPct: 0,
    };

    const result = calculateParkingLayout({
      strategy: scenario.parking.strategy,
      parcelShape: parcel,
      pilotiShape: parcel,
      pilotiEnabled: true,
      requiredCars: 2,
      frontEdge: [parcel[0], parcel[1]],
      parking: scenario.parking,
    });

    const updatedParking = {
      ...scenario.parking,
      providedCars: result.capacityCars,
    };

    expect(result.capacityCars).toBeGreaterThan(0);
    expect(updatedParking.providedCars).toBe(result.capacityCars);
    expect(updatedParking.providedCars).not.toBe(9);
  });

  it("does not replace stored supply with a capacity lacking a road entry", () => {
    const scenario = createBlankPlanningScenario({ name: "접면 미확인" });
    const parking = { ...scenario.parking, strategy: "piloti" as const, providedCars: 9 };
    const result = calculateParkingLayout({ strategy: "piloti", parcelShape: parcel, pilotiShape: parcel,
      pilotiEnabled: true, requiredCars: 2, parking });
    expect(result.capacityCars).toBe(0);
    expect(result.components[0].accessStatus).toBe("missing");
    expect(parking.providedCars).toBe(9);
  });
});
