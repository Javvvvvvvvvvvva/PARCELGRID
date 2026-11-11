import { describe, expect, it } from "vitest";
import { buildPlanningParkingGeometry } from "@/lib/planning/planning-parking-geometry";
import { buildParkingSequenceRecommendation } from "@/lib/planning/parking-sequence-advisor";
import { planningGeometryInputBasis } from "@/lib/planning/planning-geometry";
import type { PlanningScenarioCalculation } from "@/lib/planning/types";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";

const fixture = integratedVerificationFixture();

function inputFor(requiredCars = 1) {
  const input = structuredClone(fixture);
  const scenario = input.planningScenario!;
  scenario.parking.strategy = "none";
  return {
    scenario, planning: input.geometry!, boundary: input.data.parcel.boundary, roads: input.data.parcel.roads,
    requiredCars,
  };
}

function evaluate(input: ReturnType<typeof inputFor>) {
  const before = structuredClone(input);
  const parking = buildPlanningParkingGeometry(input);
  const recommendation = buildParkingSequenceRecommendation({ ...input, geometry: input.planning,
    calculation: { parking: { requiredCars: input.requiredCars }, metrics: { residentialUnitCount: 2 } } as PlanningScenarioCalculation });
  expect(input).toEqual(before);
  expect(parking.circulation.approvalStatus).toBe("unverified");
  return { parking, recommendation };
}

function expectBlocked(input: ReturnType<typeof inputFor>) {
  const { parking, recommendation } = evaluate(input);
  expect(parking.validation.status).toBe("fail");
  expect(parking.validation.exportable).toBe(false);
  expect(parking.layout.capacityCars).toBe(0);
  expect(parking.layout.stalls).toEqual([]);
  expect(recommendation.kind).toBe("manual-review");
  expect(recommendation.actionable).toBe(false);
  expect(recommendation.currentLayout.capacityCars).toBe(0);
  expect(recommendation.surface.available).toBe(false);
  expect(recommendation.surface.layout?.capacityCars).toBe(0);
  expect(recommendation.piloti.available).toBe(false);
  expect(recommendation.piloti.layout).toBeNull();
  return parking;
}

describe("parking requires actual source-aligned ground geometry", () => {
  it("offers an alternative for an intact production-generated snapshot without adopting it", () => {
    const { recommendation } = evaluate(inputFor());
    expect(recommendation.actionable).toBe(true);
    expect(recommendation.kind).toBe("surface");
    expect(recommendation.surface.layout!.capacityCars).toBeGreaterThan(0);
  });

  it.each(["none", "surface", "piloti"] as const)("blocks missing ground for %s instead of computing vacant-land capacity", strategy => {
    const input = inputFor();
    input.scenario.parking.strategy = strategy;
    input.planning.building.aboveGroundFloors = [];
    expect(expectBlocked(input).frontage.sourceMatched).toBe(false);
  });

  it.each(["missing-list", "missing-canonical", "moved-copy", "outside", "empty", "nonfinite", "self-crossing",
    "area-mismatch", "wrong-id", "wrong-level", "duplicate", "missing-program", "invalid-program"])("rejects %s despite preserved hashes and pass flags", kind => {
    const input = inputFor();
    const ground = input.planning.building.floors[0];
    if (kind === "missing-list") Reflect.deleteProperty(input.planning.building, "aboveGroundFloors");
    if (kind === "missing-canonical") input.planning.building.floors = input.planning.building.floors.slice(1);
    if (kind === "moved-copy") input.planning.building.aboveGroundFloors[0] = {
      ...ground, shape: ground.shape.map(p => ({ ...p, x: p.x + 1 })),
    };
    if (kind === "outside") ground.shape.forEach(p => { p.x += 50; });
    if (kind === "empty") ground.shape = [];
    if (kind === "nonfinite") ground.shape[0].x = NaN;
    if (kind === "self-crossing") ground.shape = [{ x: -6, z: -6 }, { x: 6, z: 6 }, { x: 6, z: -6 }, { x: -6, z: 6 }];
    if (kind === "area-mismatch") ground.shape = ground.shape.map(p => ({ x: p.x * 0.5, z: p.z * 0.5 }));
    if (kind === "wrong-id") ground.id = "unrelated-floor";
    if (kind === "wrong-level") ground.level = 4;
    if (kind === "duplicate") input.planning.building.aboveGroundFloors.push(structuredClone(ground));
    if (kind === "missing-program") input.scenario.floorPrograms = input.scenario.floorPrograms.slice(1);
    if (kind === "invalid-program") input.scenario.floorPrograms[0].zones[0].areaSqm = NaN;
    input.planning.scenarioInputBasis = planningGeometryInputBasis(input.scenario);
    expect(input.planning.validation.representativeEligible).toBe(true);
    expect(expectBlocked(input).frontage.sourceMatched).toBe(false);
  });

  it.each([NaN, -1, Infinity, 1001])("does not generate alternatives for invalid requiredCars %s", requiredCars => {
    const input = inputFor(requiredCars);
    input.scenario.parking.strategy = "surface";
    const parking = expectBlocked(input);
    expect(parking.validation.issues.map(issue => issue.code)).toContain("parking-required-cars-invalid");
  });

  it("does not use zero demand to bypass missing ground", () => {
    const input = inputFor(0);
    input.planning.building.aboveGroundFloors = [];
    expectBlocked(input);
  });
});
