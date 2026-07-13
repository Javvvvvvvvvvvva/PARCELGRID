import { describe, expect, it } from "vitest";
import {
  buildPlanningMassModel,
  polygonAreaSqm,
  polygonCentroid,
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
    // 60㎡ 프로그램을 먼저 맞춘 뒤 80% 선형 축척을 적용하므로 60 × 0.8² = 38.4㎡.
    expect(model.aboveGroundFloors[1].visualAreaSqm).toBeCloseTo(38.4, 5);
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
    expect(mass.visualAreaSqm).toBeCloseTo(50, 5);
    expect(mass.areaDifferencePct).toBeCloseTo(0, 5);
    expect(mass.capacityShortfallSqm).toBe(0);
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
    expect(mass.visualAreaSqm).toBeCloseTo(100, 5);
    expect(mass.capacityShortfallSqm).toBeCloseTo(20, 5);
    expect(mass.fitsEnvelope).toBe(false);
    expect(model.capacity.overCapacityFloorCount).toBe(1);
    expect(model.capacity.totalShortfallSqm).toBeCloseTo(20, 5);
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

    // 회전 전 상층 중심은 1층 중심보다 남쪽(+z) 4m에 있다.
    // 건물 전체를 90도 회전하면 이 상대 오프셋도 함께 회전해 서쪽(-x) 4m가 되어야 한다.
    expect(upperCenter.x - lowerCenter.x).toBeCloseTo(-4, 5);
    expect(upperCenter.z - lowerCenter.z).toBeCloseTo(0, 5);
    expect(model.aboveGroundFloors[0].visualAreaSqm).toBeCloseTo(100, 5);
    expect(model.aboveGroundFloors[1].visualAreaSqm).toBeCloseTo(100, 5);
  });
});
