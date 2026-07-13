import { describe, expect, it } from "vitest";
import {
  buildPlanningMassModel,
  polygonAreaSqm,
  transformPlanningFootprint,
  type PlanningEnvelopeStep,
} from "@/lib/planning/planning-massing";
import {
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

const square = [
  { x: -5, z: -5 },
  { x: 5, z: -5 },
  { x: 5, z: 5 },
  { x: -5, z: 5 },
];

const placement = {
  rotationDeg: 0,
  offsetXM: 1,
  offsetZM: 3,
  roadSetbackM: 0,
  northSetbackM: 0,
};

const envelopeSteps: PlanningEnvelopeStep[] = [1, 2, -1].map((level) => ({
  level,
  shape: square,
  envelopeAreaSqm: 100,
  requiredSetbackM: level === 2 ? 1.5 : 0.5,
  envelopeAvailable: true,
}));

describe("Stage 2 planning massing", () => {
  it("applies footprint scale, placement and north setback", () => {
    const transformed = transformPlanningFootprint(square, 80, 2, placement);

    expect(polygonAreaSqm(transformed)).toBeCloseTo(64, 5);
    const centerX = transformed.reduce((sum, point) => sum + point.x, 0) / transformed.length;
    const centerZ = transformed.reduce((sum, point) => sum + point.z, 0) / transformed.length;
    expect(centerX).toBeCloseTo(1, 5);
    expect(centerZ).toBeCloseTo(5, 5);
  });

  it("builds variable-height ground floors and basements", () => {
    const first = createFloorProgram(1, [
      createFloorZone("retail", 70, 1),
      createFloorZone("common", 10, 0),
    ], 3.6);
    const second = createFloorProgram(2, [
      createFloorZone("residential", 60, 2),
    ], 3.0);
    second.footprintScalePct = 80;
    second.northSetbackM = 2;
    const basement = createFloorProgram(-1, [
      createFloorZone("parking", 80, 0),
    ], 3.3);

    const model = buildPlanningMassModel(
      [first, second, basement],
      envelopeSteps,
      placement
    );

    expect(model.totalHeightM).toBeCloseTo(6.6, 5);
    expect(model.basementDepthM).toBeCloseTo(3.3, 5);
    expect(model.aboveGroundFloors[0].baseHeightM).toBe(0);
    expect(model.aboveGroundFloors[0].topHeightM).toBeCloseTo(3.6, 5);
    expect(model.aboveGroundFloors[1].baseHeightM).toBeCloseTo(3.6, 5);
    expect(model.aboveGroundFloors[1].topHeightM).toBeCloseTo(6.6, 5);
    expect(model.basementFloors[0].baseHeightM).toBeCloseTo(-3.3, 5);
    expect(model.basementFloors[0].topHeightM).toBe(0);
    expect(model.aboveGroundFloors[1].visualAreaSqm).toBeCloseTo(64, 5);
    expect(model.aboveGroundFloors[1].residentialUnits).toBe(2);
    expect(model.aboveGroundFloors[0].commercialUnits).toBe(1);
    expect(model.aboveGroundFloors[0].dominantUse).toBe("retail");
  });

  it("reports the difference between programmed and visual footprint areas", () => {
    const floor = createFloorProgram(1, [createFloorZone("residential", 50, 1)], 3);
    floor.footprintScalePct = 100;

    const model = buildPlanningMassModel([floor], envelopeSteps, placement);

    expect(model.aboveGroundFloors[0].programAreaSqm).toBe(50);
    expect(model.aboveGroundFloors[0].visualAreaSqm).toBeCloseTo(100, 5);
    expect(model.aboveGroundFloors[0].areaDifferencePct).toBeCloseTo(100, 5);
  });
});
