import { describe, expect, it } from "vitest";
import {
  buildParkingAlternativePatch,
  buildParkingSequenceRecommendation,
} from "@/lib/planning/parking-sequence-advisor";
import { buildPlanningGeometry, type PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import type {
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

const geo = (x: number, z: number): [number, number] => [127 + x / (111000 * Math.cos(37 * Math.PI / 180)), 37 - z / 111000];
const boundary = [[-10, -8], [10, -8], [10, 8], [-10, 8]].map(([x, z]) => geo(x, z));
const roads = [
  {
    name: "테스트로",
    points: [
      geo(-20, 10),
      geo(20, 10),
    ] as [number, number][],
  },
];
function scenario(areaSqm = 100): PlanningScenario {
  const result = createBlankPlanningScenario({ projectId: "sequence-test", name: "주차 순서 테스트" });
  result.id = "sequence-plan";
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
          areaSqm,
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
          areaSqm,
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

function geometry(plan = scenario(), source = boundary): PlanningGeometrySnapshot {
  return buildPlanningGeometry({ projectId: "sequence-test", scenario: plan, boundary: source,
    roads, lotAreaSqm: 320, zoning: "일반상업지역" }).snapshot;
}

describe("planning parking sequence advisor", () => {
  it("preserves all accessible components and withholds alternatives when a secondary source changes", () => {
    const plan = scenario();
    const boundaryPolygons = [{ outer: boundary, holes: [] },
      { outer: boundary.map(([lng, lat]): [number, number] => [lng + 30 / (111000 * Math.cos(37 * Math.PI / 180)), lat]), holes: [] }];
    const fullRoads = [{ name: "두 조각 접근", points: [geo(-20, 10), geo(50, 10)] }];
    const snapshot = buildPlanningGeometry({ projectId: "sequence-test", scenario: plan, boundaryPolygons,
      roads: fullRoads, lotAreaSqm: 640, zoning: "일반상업지역" }).snapshot;
    const input = { scenario: plan, calculation: calculation(1), geometry: snapshot, boundaryPolygons, roads: fullRoads };
    const before = JSON.stringify(input);
    const result = buildParkingSequenceRecommendation(input);
    expect(result.surface.layout!.components).toHaveLength(2);
    expect(result.surface.layout!.components.every(component => component.frontage?.polygonIndex === component.polygonIndex)).toBe(true);
    expect(result.surface.layout!.capacityCars).toBeGreaterThan(0);
    expect(result.kind).toBe("surface");
    expect(JSON.stringify(input)).toBe(before);
    const changed = structuredClone(boundaryPolygons); changed[1].outer[0][0] += 0.00001;
    const stale = buildParkingSequenceRecommendation({ ...input, boundaryPolygons: changed });
    expect(stale.kind).toBe("manual-review");
    expect(stale.actionable).toBe(false);
    expect(stale.surface.layout!.capacityCars).toBe(0);
    expect(buildParkingSequenceRecommendation({ ...input, boundary, boundaryPolygons: [] }).surface.layout!.capacityCars).toBe(0);
  });

  it("does not apply a parking alternative to a stale plan or road snapshot", () => {
    const plan = scenario();
    const snapshot = geometry();
    plan.placement.offsetXM++;
    const stalePlan = buildParkingSequenceRecommendation({ scenario: plan, calculation: calculation(1), geometry: snapshot, boundary, roads });
    expect(stalePlan.kind).toBe("manual-review");
    const staleRoad = buildParkingSequenceRecommendation({ scenario: scenario(), calculation: calculation(1), geometry: snapshot, boundary,
      roads: [{ ...roads[0], name: "changed" }] });
    expect(staleRoad.actionable).toBe(false);
    expect(staleRoad.currentLayout.capacityCars).toBe(0);
  });

  it("recommends surface parking first when the actual layout meets demand", () => {
    const plan = scenario(64);
    const result = buildParkingSequenceRecommendation({
      scenario: plan,
      calculation: calculation(1),
      geometry: geometry(plan),
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
    const plan = scenario(280);
    const result = buildParkingSequenceRecommendation({
      scenario: plan,
      calculation: calculation(4),
      geometry: geometry(plan),
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
    const tinyBoundary = tinyShape.map(p => geo(p.x, p.z));
    const plan = scenario(4);
    const tinyGeometry = geometry(plan, tinyBoundary);
    const result = buildParkingSequenceRecommendation({
      scenario: plan,
      calculation: calculation(2),
      geometry: tinyGeometry,
      boundary: tinyBoundary,
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
      geometry: geometry(referenceScenario),
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
