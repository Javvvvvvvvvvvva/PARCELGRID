import { describe, expect, it } from "vitest";
import {
  buildPlanningMassModel,
  polygonAreaSqm,
  polygonCentroid,
  transformPlanningFootprint,
  type PlanningEnvelopeStep,
} from "@/lib/planning/planning-massing";
import { polygonInsidePolygon } from "@/lib/planning/placement-assessment";
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
    const centerX =
      transformed.reduce((sum, point) => sum + point.x, 0) /
      transformed.length;
    const centerZ =
      transformed.reduce((sum, point) => sum + point.z, 0) /
      transformed.length;
    expect(centerX).toBeCloseTo(1, 5);
    expect(centerZ).toBeCloseTo(5, 5);
  });

  it("builds variable-height ground floors and basements", () => {
    const first = createFloorProgram(
      1,
      [
        createFloorZone("retail", 70, 1),
        createFloorZone("common", 10, 0),
      ],
      3.6
    );
    const second = createFloorProgram(
      2,
      [createFloorZone("residential", 60, 2)],
      3.0
    );
    second.footprintScalePct = 80;
    second.northSetbackM = 2;
    const basement = createFloorProgram(
      -1,
      [createFloorZone("parking", 80, 0)],
      3.3
    );

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
    expect(model.aboveGroundFloors[1].visualAreaSqm).toBeCloseTo(38.4, 4);
    expect(model.aboveGroundFloors[1].residentialUnits).toBe(2);
    expect(model.aboveGroundFloors[0].commercialUnits).toBe(1);
    expect(model.aboveGroundFloors[0].dominantUse).toBe("retail");
  });

  it("fits the 3D footprint to programmed area when the legal envelope is large enough", () => {
    const floor = createFloorProgram(
      1,
      [createFloorZone("residential", 50, 1)],
      3
    );
    floor.footprintScalePct = 100;

    const model = buildPlanningMassModel([floor], envelopeSteps, placement);
    const mass = model.aboveGroundFloors[0];

    expect(mass.programAreaSqm).toBe(50);
    expect(mass.envelopeAreaSqm).toBeCloseTo(100, 5);
    expect(mass.visualAreaSqm).toBeCloseTo(50, 4);
    expect(mass.areaDifferencePct).toBeCloseTo(0, 4);
    expect(mass.capacityShortfallSqm).toBeCloseTo(0, 4);
    expect(mass.fitsEnvelope).toBe(true);
    expect(model.capacity.allFloorsFit).toBe(true);
  });

  it("caps the 3D footprint and reports a legal-envelope capacity shortfall", () => {
    const floor = createFloorProgram(
      1,
      [createFloorZone("residential", 120, 2)],
      3
    );
    floor.footprintScalePct = 100;

    const model = buildPlanningMassModel([floor], envelopeSteps, placement);
    const mass = model.aboveGroundFloors[0];

    expect(mass.programAreaSqm).toBe(120);
    expect(mass.envelopeAreaSqm).toBeCloseTo(100, 5);
    expect(mass.visualAreaSqm).toBeCloseTo(100, 4);
    expect(mass.capacityShortfallSqm).toBeCloseTo(20, 4);
    expect(mass.fitsEnvelope).toBe(false);
    expect(model.capacity.overCapacityFloorCount).toBe(1);
    expect(model.capacity.totalShortfallSqm).toBeCloseTo(20, 4);
  });

  it("rotates staggered floor envelopes around one shared building pivot", () => {
    const first = createFloorProgram(
      1,
      [createFloorZone("retail", 100, 1)],
      3.6
    );
    const second = createFloorProgram(
      2,
      [createFloorZone("residential", 100, 2)],
      3
    );
    const shiftedUpperFloor = square.map((point) => ({
      x: point.x,
      z: point.z + 4,
    }));
    const steppedEnvelopes: PlanningEnvelopeStep[] = [
      {
        level: 1,
        shape: square,
        envelopeAreaSqm: 100,
        requiredSetbackM: 0,
        envelopeAvailable: true,
      },
      {
        level: 2,
        shape: shiftedUpperFloor,
        envelopeAreaSqm: 100,
        requiredSetbackM: 4,
        envelopeAvailable: true,
      },
    ];

    const model = buildPlanningMassModel(
      [first, second],
      steppedEnvelopes,
      {
        ...placement,
        rotationDeg: 90,
        offsetXM: 0,
        offsetZM: 0,
      }
    );
    const lowerCenter = polygonCentroid(model.aboveGroundFloors[0].shape);
    const upperCenter = polygonCentroid(model.aboveGroundFloors[1].shape);

    expect(upperCenter.x - lowerCenter.x).toBeCloseTo(-4, 4);
    expect(upperCenter.z - lowerCenter.z).toBeCloseTo(0, 4);
    expect(model.aboveGroundFloors[0].visualAreaSqm).toBeCloseTo(100, 4);
    expect(model.aboveGroundFloors[1].visualAreaSqm).toBeCloseTo(100, 4);
  });

  it("preserves a kinked legal-envelope shape instead of forcing a rectangle", () => {
    const lower = createFloorProgram(
      1,
      [createFloorZone("residential", 30, 1)],
      3
    );
    const upper = createFloorProgram(
      2,
      [createFloorZone("residential", 6, 1)],
      3
    );
    const kinkedUpper = [
      { x: -4, z: -2 },
      { x: 4, z: -2 },
      { x: 4, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 4 },
      { x: -4, z: 4 },
    ];
    const steps: PlanningEnvelopeStep[] = [
      {
        level: 1,
        shape: square,
        envelopeAreaSqm: 100,
        requiredSetbackM: 0,
        envelopeAvailable: true,
      },
      {
        level: 2,
        shape: kinkedUpper,
        envelopeAreaSqm: polygonAreaSqm(kinkedUpper),
        requiredSetbackM: 1.5,
        envelopeAvailable: true,
      },
    ];

    const model = buildPlanningMassModel(
      [lower, upper],
      steps,
      { ...placement, offsetXM: 0, offsetZM: 0 }
    );
    const upperMass = model.aboveGroundFloors[1];

    expect(upperMass.shape).toHaveLength(6);
    expect(upperMass.visualAreaSqm).toBeCloseTo(6, 3);
    expect(polygonInsidePolygon(upperMass.shape, kinkedUpper).fits).toBe(true);
    expect(upperMass.fitsEnvelope).toBe(true);
  });

  it("moves a small upper footprint toward the lower floor while staying in its legal envelope", () => {
    const lower = createFloorProgram(
      1,
      [createFloorZone("residential", 80, 1)],
      3
    );
    const upper = createFloorProgram(
      2,
      [createFloorZone("residential", 4, 1)],
      3
    );
    const shiftedUpperEnvelope = square.map((point) => ({
      x: point.x,
      z: point.z + 8,
    }));
    const steps: PlanningEnvelopeStep[] = [
      {
        level: 1,
        shape: square,
        envelopeAreaSqm: 100,
        requiredSetbackM: 0,
        envelopeAvailable: true,
      },
      {
        level: 2,
        shape: shiftedUpperEnvelope,
        envelopeAreaSqm: 100,
        requiredSetbackM: 4,
        envelopeAvailable: true,
      },
    ];

    const model = buildPlanningMassModel(
      [lower, upper],
      steps,
      { ...placement, offsetXM: 0, offsetZM: 0 }
    );
    const upperMass = model.aboveGroundFloors[1];

    expect(upperMass.shape).toHaveLength(4);
    expect(upperMass.visualAreaSqm).toBeCloseTo(4, 4);
    expect(upperMass.supportedByLowerFloor).toBe(true);
    expect(upperMass.supportOverlapRatio).toBeGreaterThanOrEqual(0.12);
    expect(
      polygonInsidePolygon(upperMass.shape, shiftedUpperEnvelope).fits
    ).toBe(true);
  });
});
