import { describe, expect, it } from "vitest";
import {
  assessPlanningPlacement,
  pointInPolygonInclusive,
  polygonInsidePolygon,
} from "@/lib/planning/placement-assessment";
import {
  buildPlanningMassModel,
  type PlanningEnvelopeStep,
} from "@/lib/planning/planning-massing";
import {
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

const envelopeShape = [
  { x: -5, z: -5 },
  { x: 5, z: -5 },
  { x: 5, z: 5 },
  { x: -5, z: 5 },
];

const envelopeSteps: PlanningEnvelopeStep[] = [
  {
    level: 1,
    shape: envelopeShape,
    envelopeAreaSqm: 100,
    requiredSetbackM: 0.5,
    envelopeAvailable: true,
  },
];

const basePlacement = {
  rotationDeg: 0,
  offsetXM: 0,
  offsetZM: 0,
  roadSetbackM: 0,
  northSetbackM: 0,
};

describe("Stage 2 placement assessment", () => {
  it("treats boundary points as inside", () => {
    expect(pointInPolygonInclusive({ x: 5, z: 0 }, envelopeShape)).toBe(true);
    expect(pointInPolygonInclusive({ x: 6, z: 0 }, envelopeShape)).toBe(false);
  });

  it("detects a translated footprint leaving the legal envelope", () => {
    const floor = createFloorProgram(1, [
      createFloorZone("residential", 16, 1),
    ]);
    const centered = buildPlanningMassModel(
      [floor],
      envelopeSteps,
      basePlacement
    );
    const moved = buildPlanningMassModel([floor], envelopeSteps, {
      ...basePlacement,
      offsetXM: 5,
    });

    expect(polygonInsidePolygon(centered.floors[0].shape, envelopeShape).fits).toBe(true);
    expect(polygonInsidePolygon(moved.floors[0].shape, envelopeShape).fits).toBe(false);
    expect(assessPlanningPlacement(moved, envelopeSteps).outsideFloorCount).toBe(1);
  });

  it("separates area capacity failure from placement failure", () => {
    const oversized = createFloorProgram(1, [
      createFloorZone("residential", 120, 2),
    ]);
    const model = buildPlanningMassModel(
      [oversized],
      envelopeSteps,
      basePlacement
    );
    const assessment = assessPlanningPlacement(model, envelopeSteps);

    expect(assessment.areaOverCapacityFloorCount).toBe(1);
    expect(assessment.outsideFloorCount).toBe(0);
    expect(assessment.allFloorsFit).toBe(false);
    expect(assessment.totalCapacityShortfallSqm).toBeCloseTo(20, 5);
  });
});
