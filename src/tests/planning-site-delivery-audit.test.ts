import { describe, expect, it } from "vitest";
import type { CadastralContextSnapshot } from "@/lib/geo/cadastral-context";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { ContextGeometrySnapshot } from "@/lib/planning/sketchup-export-package";
import {
  buildSiteDeliveryAudit,
  polygonsHaveAreaOverlap,
} from "@/lib/planning/site-delivery-audit";

const square = (minX: number, minZ: number, maxX: number, maxZ: number) => [
  { x: minX, z: minZ },
  { x: maxX, z: minZ },
  { x: maxX, z: maxZ },
  { x: minX, z: maxZ },
];

function planning(): PlanningGeometrySnapshot {
  const parcel = square(-10, -10, 10, 10);
  const floor = {
    id: "floor-1",
    label: "1층",
    level: 1,
    floorHeightM: 3.6,
    baseHeightM: 0,
    topHeightM: 3.6,
    programAreaSqm: 100,
    visualAreaSqm: 100,
    envelopeAreaSqm: 400,
    areaDifferenceSqm: 0,
    areaDifferencePct: 0,
    areaStatus: "pass" as const,
    footprintScalePct: 100,
    capacityShortfallSqm: 0,
    shape: square(-5, -5, 5, 5),
    dominantUse: "residential" as const,
    zones: [],
    residentialUnits: 1,
    commercialUnits: 0,
    fitsEnvelope: true,
    supportedByLowerFloor: true,
    supportOverlapRatio: 1,
    selfIntersects: false,
  };
  return {
    version: "planning-geometry-v1",
    projectId: "delivery-audit",
    scenarioId: "scenario-1",
    scenarioVersion: 1,
    scenarioName: "전달 점검",
    generatedAt: "2026-07-15T00:00:00.000Z",
    geometryHash: "PG-TEST0001",
    coordinateSystem: {
      unit: "meter",
      horizontalCrs: "LOCAL_ENU_FROM_WGS84",
      northAxis: "-Z",
      eastAxis: "+X",
      upAxis: "+Y",
      originLngLat: [127.025749, 37.650511],
    },
    parcel: {
      polygon: parcel,
      officialAreaSqm: 400,
      measuredAreaSqm: 400,
      areaDifferencePct: 0,
    },
    roads: [],
    building: {
      floors: [floor],
      aboveGroundFloors: [floor],
      basementFloors: [],
      totalHeightM: 3.6,
      basementDepthM: 0,
      totalProgramAreaSqm: 100,
      totalGeometryAreaSqm: 100,
      preliminaryFarAreaSqm: 100,
      preliminaryFarPct: 25,
      preliminaryBcrPct: 25,
    },
    validation: {
      status: "pass",
      representativeEligible: true,
      exportable: true,
      maxFloorAreaDifferencePct: 0,
      issues: [],
    },
    sourceNotes: [],
  };
}

function context(): ContextGeometrySnapshot {
  return {
    version: "context-geometry-v1",
    projectId: "delivery-audit",
    generatedAt: "2026-07-15T00:00:00.000Z",
    contextHash: "CTX-TEST0001",
    coordinateSystem: planning().coordinateSystem,
    radiusM: 35,
    buildings: [],
    summary: {
      totalBuildings: 0,
      verifiedHeightBuildings: 0,
      estimatedHeightBuildings: 0,
      defaultHeightBuildings: 0,
      excludedBuildings: 0,
    },
    validation: { status: "pass", usable: true, issues: [] },
    sourceNotes: [],
  };
}

function cadastral(roadPolygon: Array<{ x: number; z: number }>): CadastralContextSnapshot {
  return {
    version: "cadastral-context-v1",
    projectId: "delivery-audit",
    generatedAt: "2026-07-15T00:00:00.000Z",
    cadastralHash: "CAD-TEST0001",
    coordinateSystem: planning().coordinateSystem,
    targetParcel: { pnu: "target", polygon: square(-10, -10, 10, 10) },
    adjacentParcels: [],
    roadParcels: [
      {
        pnu: "UPIS-road",
        jibun: "소로3류",
        jimok: "도로",
        jimokCode: "UPIS-UQ151",
        officialAreaSqm: 120,
        measuredAreaSqm: 120,
        distanceM: 10,
        polygon: roadPolygon,
        source: "VWorld LP_PA_CBND_BUBUN",
      },
    ],
    frontages: [
      {
        roadParcelPnu: "UPIS-road",
        roadParcelJibun: "소로3류",
        targetEdgeIndex: 1,
        frontage: [
          { x: 10, z: -10 },
          { x: 10, z: 10 },
        ],
        frontageLengthM: 20,
        boundaryGapM: 0,
        alignmentPct: 100,
        widthSamples: [
          {
            positionRatio: 0.5,
            gapM: 0,
            widthM: 6,
            from: { x: 10, z: 0 },
            to: { x: 16, z: 0 },
          },
        ],
        widthMinM: 6,
        widthAvgM: 6,
        widthMaxM: 6,
        status: "verified-cadastral-width",
        source: "VWorld continuous cadastral road parcel",
      },
    ],
    summary: {
      adjacentParcelCount: 0,
      roadParcelCount: 1,
      verifiedWidthFrontageCount: 1,
      primaryWidthMinM: 6,
      primaryWidthAvgM: 6,
      primaryWidthMaxM: 6,
    },
    validation: { status: "pass", usable: true, issues: [] },
    sourceNotes: [],
  };
}

describe("site delivery audit", () => {
  it("does not treat a shared boundary as road encroachment", () => {
    expect(
      polygonsHaveAreaOverlap(square(-5, -5, 5, 5), square(5, -8, 11, 8))
    ).toBe(false);

    const audit = buildSiteDeliveryAudit({
      planning: planning(),
      context: context(),
      cadastral: cadastral(square(10, -10, 16, 10)),
    });
    expect(audit.roadOverlapFloorIds).toHaveLength(0);
    expect(audit.checks.find((check) => check.id === "road-overlap")?.status).toBe(
      "pass"
    );
    expect(audit.exportable).toBe(true);
  });

  it("flags an actual area overlap between above-ground mass and road polygon", () => {
    const audit = buildSiteDeliveryAudit({
      planning: planning(),
      context: context(),
      cadastral: cadastral(square(4, -10, 10, 10)),
    });
    expect(audit.roadOverlapFloorIds).toEqual(["floor-1"]);
    expect(audit.checks.find((check) => check.id === "road-overlap")?.status).toBe(
      "review"
    );
    expect(audit.exportable).toBe(true);
  });
});
