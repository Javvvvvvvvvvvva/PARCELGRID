import { describe, expect, it } from "vitest";
import type { CadastralContextSnapshot } from "@/lib/geo/cadastral-context";
import { buildContextParcelAlignment } from "@/lib/planning/context-parcel-alignment";
import type { ContextGeometrySnapshot } from "@/lib/planning/sketchup-export-package";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";

const square = (
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): LocalPlanPoint[] => [
  { x: minX, z: minZ },
  { x: maxX, z: minZ },
  { x: maxX, z: maxZ },
  { x: minX, z: maxZ },
];

const coordinateSystem = {
  unit: "meter" as const,
  horizontalCrs: "LOCAL_ENU_FROM_WGS84" as const,
  northAxis: "-Z" as const,
  eastAxis: "+X" as const,
  upAxis: "+Y" as const,
  originLngLat: [127.025749, 37.650511] as [number, number],
};

function context(shape: LocalPlanPoint[]): ContextGeometrySnapshot {
  return {
    version: "context-geometry-v1",
    projectId: "alignment-test",
    generatedAt: "2026-07-16T00:00:00.000Z",
    contextHash: "CTX-ALIGN",
    coordinateSystem,
    radiusM: 35,
    buildings: [
      {
        id: "building-1",
        name: "테스트 주변 건물",
        polygons: [{ outer: shape, holes: [] }],
        sourceFootprintAreaSqm: 100,
        measuredFootprintAreaSqm: 100,
        groundFloors: 2,
        heightM: 6,
        heightSource: "registered-height",
        accuracy: "verified",
        source: "vworld-dt_d010",
      },
    ],
    summary: {
      totalBuildings: 1,
      verifiedHeightBuildings: 1,
      estimatedHeightBuildings: 0,
      defaultHeightBuildings: 0,
      excludedBuildings: 0,
    },
    validation: { status: "pass", usable: true, issues: [] },
    sourceNotes: [],
  };
}

function cadastral(adjacent: LocalPlanPoint[]): CadastralContextSnapshot {
  return {
    version: "cadastral-context-v1",
    projectId: "alignment-test",
    generatedAt: "2026-07-16T00:00:00.000Z",
    cadastralHash: "CAD-ALIGN",
    coordinateSystem,
    targetParcel: {
      pnu: "target",
      polygon: square(-10, -10, 0, 10),
    },
    adjacentParcels: [
      {
        pnu: "adjacent",
        jibun: "인접필지",
        jimok: "대",
        jimokCode: "08",
        officialAreaSqm: 200,
        measuredAreaSqm: 200,
        distanceM: 5,
        polygon: adjacent,
        source: "VWorld LP_PA_CBND_BUBUN",
      },
    ],
    roadParcels: [],
    frontages: [],
    summary: {
      adjacentParcelCount: 1,
      roadParcelCount: 0,
      verifiedWidthFrontageCount: 0,
      primaryWidthMinM: null,
      primaryWidthAvgM: null,
      primaryWidthMaxM: null,
    },
    validation: { status: "pass", usable: true, issues: [] },
    sourceNotes: [],
  };
}

describe("context building parcel alignment", () => {
  it("marks a building fully contained by an adjacent parcel as aligned", () => {
    const result = buildContextParcelAlignment({
      context: context(square(2, -5, 8, 5)),
      cadastral: cadastral(square(0, -10, 10, 10)),
      generatedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(result.buildings[0].status).toBe("aligned");
    expect(result.buildings[0].coveragePct).toBeCloseTo(100, 1);
    expect(result.buildings[0].bestParcelPnu).toBe("adjacent");
  });

  it("keeps a building aligned when it spans two valid neighboring parcels", () => {
    const result = buildContextParcelAlignment({
      context: context(square(-2, -5, 2, 5)),
      cadastral: cadastral(square(0, -10, 10, 10)),
      generatedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(result.buildings[0].status).toBe("aligned");
    expect(result.buildings[0].coveragePct).toBeCloseTo(100, 1);
  });

  it("flags a building with less than sixty percent parcel coverage", () => {
    const result = buildContextParcelAlignment({
      context: context(square(7, -5, 17, 5)),
      cadastral: cadastral(square(0, -10, 10, 10)),
      generatedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(result.buildings[0].status).toBe("mismatch");
    expect(result.buildings[0].coveragePct).toBeLessThan(60);
    expect(result.summary.mismatchBuildings).toBe(1);
  });
});
