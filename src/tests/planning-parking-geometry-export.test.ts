import { describe, expect, it } from "vitest";
import { buildCadastralContext } from "@/lib/geo/cadastral-context";
import { buildPlanningCadDxf } from "@/lib/planning/planning-cad-export";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";
import { buildPlanningParkingGeometry } from "@/lib/planning/planning-parking-geometry";
import { buildSketchupDae } from "@/lib/planning/sketchup-dae-export";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

const ORIGIN: [number, number] = [127.025749, 37.650511];
const LOCAL_PARCEL = [
  { x: -10, z: 10 },
  { x: 10, z: 10 },
  { x: 10, z: -10 },
  { x: -10, z: -10 },
];

function toLngLat(points: Array<[number, number]>): [number, number][] {
  const lngScale = 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return points.map(([x, z]) => [
    ORIGIN[0] + x / lngScale,
    ORIGIN[1] - z / 111_000,
  ]);
}

const BOUNDARY = toLngLat([
  [-10, 10],
  [10, 10],
  [10, -10],
  [-10, -10],
  [-10, 10],
]);
const ROADS = [
  {
    name: "테스트로",
    points: toLngLat([
      [-20, 13],
      [20, 13],
    ]),
  },
];

function pilotiScenario() {
  const scenario = createBlankPlanningScenario({
    projectId: "parking-export-project",
    name: "주차 Export 계획안",
  });
  scenario.id = "parking-export-scenario";
  scenario.version = 4;
  scenario.floorPrograms = [
    createFloorProgram(1, [createFloorZone("piloti", 300, 0)]),
    createFloorProgram(2, [createFloorZone("residential", 100, 2)]),
  ];
  scenario.parking = {
    strategy: "piloti",
    providedCars: 0,
    orientation: "auto",
    stallWidthM: 2.5,
    stallDepthM: 5,
    aisleWidthM: 6,
    entryWidthM: 3,
    coreAreaSqm: 9,
    columnLossPct: 0,
  };
  return scenario;
}

function planningFor(scenario = pilotiScenario()) {
  return buildPlanningGeometry({
    projectId: "parking-export-project",
    scenario,
    boundary: BOUNDARY,
    lotAreaSqm: polygonAreaSqm(LOCAL_PARCEL),
    zoning: "제2종일반주거지역",
    roads: ROADS,
    setback: { road: 0, side: 0, rear: 0 },
    generatedAt: "2026-08-01T00:00:00.000Z",
  }).snapshot;
}

describe("shared parking geometry export", () => {
  it("uses one parking hash and the same stall/aisle geometry in 3D, DAE, and DXF", () => {
    const scenario = pilotiScenario();
    const planning = planningFor(scenario);
    const parking = buildPlanningParkingGeometry({
      scenario,
      planning,
      requiredCars: 2,
      boundary: BOUNDARY,
      roads: ROADS,
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
    const repeated = buildPlanningParkingGeometry({
      scenario,
      planning,
      requiredCars: 2,
      boundary: BOUNDARY,
      roads: ROADS,
      generatedAt: "2026-08-02T00:00:00.000Z",
    });

    expect(parking.validation.status).toBe("pass");
    expect(parking.layout.stalls.length).toBeGreaterThanOrEqual(2);
    expect(parking.layout.aisleShape).toHaveLength(4);
    expect(parking.parkingGeometryHash).toBe(repeated.parkingGeometryHash);
    expect(parking.layout.stalls).toEqual(repeated.layout.stalls);

    const basePackage = buildSketchupExportPackage({ planning, parking });
    const dae = buildSketchupDae(basePackage);
    expect(basePackage.parkingGeometryHash).toBe(
      parking.parkingGeometryHash
    );
    expect(
      basePackage.layers.find((layer) => layer.name === "PG_PARKING_STALLS")
        ?.objectCount
    ).toBe(parking.layout.stalls.length);
    expect(dae).toContain("PG_PARKING_STALLS-node");
    expect(dae).toContain("PG_PARKING_AISLE-node");
    expect(dae).toContain(
      `<parking_hash>${parking.parkingGeometryHash}</parking_hash>`
    );

    const cadastral = buildCadastralContext({
      planning,
      targetPnu: "parking-export-project",
      parcels: [],
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
    const cad = buildPlanningCadDxf({ basePackage, cadastral });
    expect(cad.dxfText).toContain("PG_PARKING_STALLS");
    expect(cad.dxfText).toContain("PG_PARKING_AISLE");
    expect(cad.dxfText).toContain("PG_PARKING_CORE");
    expect(cad.dxfText).toContain("PG_PARKING_COLUMNS_REFERENCE");
    expect(cad.entityCountByLayer.PG_PARKING_STALLS).toBe(
      parking.layout.stalls.length
    );
    expect(cad.entityCountByLayer.PG_PARKING_AISLE).toBe(1);
  });

  it("blocks design export when required parking has no actual layout", () => {
    const scenario = pilotiScenario();
    scenario.parking = { strategy: "none", providedCars: 0 };
    const planning = planningFor(scenario);
    const parking = buildPlanningParkingGeometry({
      scenario,
      planning,
      requiredCars: 2,
      boundary: BOUNDARY,
      roads: ROADS,
    });
    const basePackage = buildSketchupExportPackage({ planning, parking });

    expect(parking.validation.status).toBe("fail");
    expect(parking.validation.exportable).toBe(false);
    expect(basePackage.validation.exportable).toBe(false);
    expect(basePackage.validation.blockingReasons.join(" ")).toContain(
      "주차 계획"
    );
  });
});
