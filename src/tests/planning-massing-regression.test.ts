import { describe, expect, it } from "vitest";
import {
  buildPlanningMassModel,
  polygonAreaSqm,
  type LocalPlanPoint,
  type PlanningEnvelopeStep,
} from "@/lib/planning/planning-massing";
import {
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

const placement = {
  rotationDeg: 0,
  offsetXM: 0,
  offsetZM: 0,
  roadSetbackM: 0,
  northSetbackM: 0,
};

function floor(level: number, areaSqm: number) {
  return createFloorProgram(
    level,
    [createFloorZone("residential", areaSqm, level === 3 ? 1 : 2)],
    3
  );
}

function step(level: number, shape: LocalPlanPoint[]): PlanningEnvelopeStep {
  return {
    level,
    shape,
    envelopeAreaSqm: polygonAreaSqm(shape),
    requiredSetbackM: 0,
    envelopeAvailable: true,
  };
}

function allFinite(shape: LocalPlanPoint[]) {
  return shape.every(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.z)
  );
}

describe("Stage 2 planning massing parcel regressions", () => {
  it("marks a detached upper legal envelope as unsupported instead of treating it as a valid stack", () => {
    const lowerShape = [
      { x: -5, z: -5 },
      { x: 5, z: -5 },
      { x: 5, z: 5 },
      { x: -5, z: 5 },
    ];
    const detachedUpper = lowerShape.map((point) => ({
      x: point.x,
      z: point.z + 20,
    }));

    const model = buildPlanningMassModel(
      [floor(1, 80), floor(2, 4)],
      [step(1, lowerShape), step(2, detachedUpper)],
      placement
    );

    const upper = model.aboveGroundFloors[1];
    expect(upper.shape.length).toBeGreaterThanOrEqual(3);
    expect(upper.fitsEnvelope).toBe(true);
    expect(upper.supportedByLowerFloor).toBe(false);
    expect(upper.supportOverlapRatio).toBeLessThan(0.12);
  });

  it("keeps three floors supported on a wide rectangular parcel", () => {
    const wideRectangle = [
      { x: -15, z: -10 },
      { x: 15, z: -10 },
      { x: 15, z: 10 },
      { x: -15, z: 10 },
    ];

    const model = buildPlanningMassModel(
      [floor(1, 220), floor(2, 180), floor(3, 140)],
      [
        step(1, wideRectangle),
        step(2, wideRectangle),
        step(3, wideRectangle),
      ],
      placement
    );

    expect(model.aboveGroundFloors).toHaveLength(3);
    expect(
      model.aboveGroundFloors.every(
        (mass) =>
          mass.fitsEnvelope &&
          mass.supportedByLowerFloor &&
          mass.shape.length === 4 &&
          allFinite(mass.shape)
      )
    ).toBe(true);
  });

  it("keeps stacked floors stable on a wide irregular parcel", () => {
    const irregularWide = [
      { x: -16, z: -8 },
      { x: 8, z: -11 },
      { x: 17, z: -3 },
      { x: 14, z: 10 },
      { x: -6, z: 12 },
      { x: -18, z: 3 },
    ];

    const model = buildPlanningMassModel(
      [floor(1, 190), floor(2, 145), floor(3, 95)],
      [
        step(1, irregularWide),
        step(2, irregularWide),
        step(3, irregularWide),
      ],
      placement
    );

    expect(model.aboveGroundFloors).toHaveLength(3);
    expect(
      model.aboveGroundFloors.every(
        (mass) =>
          mass.fitsEnvelope &&
          mass.supportedByLowerFloor &&
          mass.shape.length === irregularWide.length &&
          allFinite(mass.shape)
      )
    ).toBe(true);
  });
});
