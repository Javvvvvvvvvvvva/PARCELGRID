import { describe, expect, it } from "vitest";
import {
  buildParkingAlternativePatch,
  buildParkingSequenceRecommendation,
} from "@/lib/planning/parking-sequence-advisor";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import type {
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

const boundary: [number, number][] = [
  [127, 37],
  [127.00018, 37],
  [127.00018, 37.00014],
  [127, 37.00014],
  [127, 37],
];
const roads = [
  {
    name: "테스트로",
    points: [
      [126.9999, 36.99998],
      [127.00028, 36.99998],
    ] as [number, number][],
  },
];
const parcelShape = [
  { x: -10, z: -8 },
  { x: 10, z: -8 },
  { x: 10, z: 8 },
  { x: -10, z: 8 },
];

function scenario(): PlanningScenario {
  const result = createBlankPlanningScenario({ name: "주차 순서 테스트" });
  result.floorPrograms = [
    {
      id: "floor-1",
      level: 1,
      label: "1층",
      floorHeightM: 3,
      footprintScalePct: 100,
      northSetbackM: 0,
      zones: [
        {
          id: "zone-1",
          useType: "residential",
          areaSqm: 100,
          unitCount: 2,
          revenueModel: "sale",
        },
      ],
    },
    {
      id: "floor-2",
      level: 2,
      label: "2층",
      floorHeightM: 3,
      footprintScalePct: 100,
      northSetbackM: 0,
      zones: [
        {
          id: "zone-2",
          useType: "residential",
          areaSqm: 100,
          unitCount: 2,
          revenueModel: "sale",
        },
      ],
    },
  ];
  result.parking = {
    strategy: "none",
    providedCars: 0,
    orientation: "auto",
    stallWidthM: 2.5,
    stallDepthM: 5,
    aisleWidthM: 6,
    entryWidthM: 3,
    coreAreaSqm: 0,
    columnLossPct: 0,
  };
  return result;
}

function calculation(requiredCars: number): PlanningScenarioCalculation {
  return {
    parking: { requiredCars },
    metrics: { residentialUnitCount: 4 },
  } as unknown as PlanningScenarioCalculation;
}

function geometry(firstFloorShape = parcelShape): PlanningGeometrySnapshot {
  return {
    parcel: { polygon: parcelShape },
    building: {
      aboveGroundFloors: [{ level: 1, shape: firstFloorShape }],
    },
  } as unknown as PlanningGeometrySnapshot;
}

describe("planning parking sequence advisor", () => {
  it("recommends surface parking first when the actual layout meets demand", () => {
    const result = buildParkingSequenceRecommendation({
      scenario: scenario(),
      calculation: calculation(1),
      geometry: geometry([
        { x: -4, z: -2 },
        { x: 4, z: -2 },
        { x: 4, z: 6 },
        { x: -4, z: 6 },
      ]),
      boundary,
      roads,
    });

    expect(result.road.status).toBe("frontage-known");
    expect(result.road.verifiedWidthM).toBeNull();
    expect(result.surface.layout?.capacityCars).toBeGreaterThan(0);
    expect(result.kind).toBe("surface");
    expect(result.actionable).toBe(true);
  });

  it("falls back to piloti when the building consumes the surface parking area", () => {
    const result = buildParkingSequenceRecommendation({
      scenario: scenario(),
      calculation: calculation(4),
      geometry: geometry(parcelShape),
      boundary,
      roads,
    });

    expect(result.surface.layout?.shortfallCars).toBeGreaterThan(0);
    expect(result.piloti.layout?.shortfallCars).toBe(0);
    expect(result.kind).toBe("piloti");
  });

  it("routes to floor and unit editing when neither layout fits", () => {
    const tinyShape = [
      { x: -2, z: -2 },
      { x: 2, z: -2 },
      { x: 2, z: 2 },
      { x: -2, z: 2 },
    ];
    const tinyGeometry = {
      ...geometry(tinyShape),
      parcel: { ...geometry().parcel, polygon: tinyShape },
    } as PlanningGeometrySnapshot;
    const result = buildParkingSequenceRecommendation({
      scenario: scenario(),
      calculation: calculation(2),
      geometry: tinyGeometry,
      boundary,
      roads,
    });

    expect(result.surface.layout?.shortfallCars).toBeGreaterThan(0);
    expect(result.piloti.layout?.shortfallCars).toBeGreaterThan(0);
    expect(result.kind).toBe("reduce-program");
  });

  it("blocks automatic alternatives when road frontage is unknown", () => {
    const result = buildParkingSequenceRecommendation({
      scenario: scenario(),
      calculation: calculation(1),
      geometry: geometry(),
      boundary,
      roads: [],
    });

    expect(result.kind).toBe("manual-review");
    expect(result.actionable).toBe(false);
    expect(result.road.verifiedWidthM).toBeNull();
  });

  it("does not invent parking or piloti for a reference-image plan", () => {
    const referenceScenario = scenario();
    referenceScenario.geometrySource = {
      ...referenceScenario.geometrySource!,
      mode: "reference-image",
    };
    const result = buildParkingSequenceRecommendation({
      scenario: referenceScenario,
      calculation: calculation(4),
      geometry: geometry(parcelShape),
      boundary,
      roads,
    });

    expect(result.kind).toBe("preserve-reference");
    expect(result.actionable).toBe(false);
    expect(buildParkingAlternativePatch(referenceScenario, "piloti", 4)).toBeNull();
  });

  it("creates a copied-plan piloti patch without changing the upper floors", () => {
    const source = scenario();
    const upperFloor = source.floorPrograms[1];
    const alternative = buildParkingAlternativePatch(source, "piloti", 5);

    expect(alternative?.patch.parking?.providedCars).toBe(5);
    expect(alternative?.patch.parking?.strategy).toBe("piloti");
    expect(alternative?.removedGroundFloorUnits).toBe(2);
    expect(alternative?.patch.floorPrograms?.[0].zones).toEqual([
      expect.objectContaining({
        useType: "piloti",
        areaSqm: 100,
        unitCount: 0,
        revenueModel: "non-revenue",
      }),
    ]);
    expect(alternative?.patch.floorPrograms?.[1]).toBe(upperFloor);
    expect(source.floorPrograms[0].zones[0].useType).toBe("residential");
  });
});
