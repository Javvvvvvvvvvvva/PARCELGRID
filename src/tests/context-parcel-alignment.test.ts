import { afterEach, describe, expect, it, vi } from "vitest";
import { CADASTRAL_CONTEXT_VERSION, type CadastralContextSnapshot } from "@/lib/geo/cadastral-context";
import * as topology from "@/lib/geo/parcel-topology-geometry";
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
    version: CADASTRAL_CONTEXT_VERSION,
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
    roadClearances: [],
    summary: {
      adjacentParcelCount: 1,
      roadParcelCount: 0,
      verifiedWidthFrontageCount: 0,
      primaryWidthMinM: null,
      primaryWidthAvgM: null,
      primaryWidthMaxM: null,
      primaryPlannedWidthMinM: null,
      primaryPlannedWidthAvgM: null,
      primaryPlannedWidthMaxM: null,
      primaryMassRoadClearanceM: null,
      roadIntrusionCount: 0,
    },
    validation: { status: "pass", usable: true, issues: [] },
    sourceNotes: [],
  };
}

afterEach(() => vi.restoreAllMocks());

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

  it("stops during parcel validation and marks all buildings unavailable", () => {
    const buildings = context(square(2, -5, 8, 5));
    buildings.buildings.push({ ...buildings.buildings[0], id: "building-2" });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const validate = topology.validateLocalParcelTopology;
    const validation = vi.spyOn(topology, "validateLocalParcelTopology").mockImplementation((polygons, checkDeadline) => {
      expect(checkDeadline).toBeTypeOf("function");
      now = 2_000;
      return validate(polygons, checkDeadline);
    });
    const coverage = vi.spyOn(topology, "localParcelCoveredArea");

    const result = buildContextParcelAlignment({ context: buildings, cadastral: cadastral(square(0, -10, 10, 10)) });

    expect(validation).toHaveBeenCalledOnce();
    expect(coverage).not.toHaveBeenCalled();
    expect(result.buildings).toHaveLength(2);
    for (const building of result.buildings) expect(building).toMatchObject({
      status: "unavailable", coverageRatio: null, coveragePct: null, bestParcelPnu: null, bestParcelCoverageRatio: null,
    });
    expect(result.summary).toMatchObject({ unavailableBuildings: 2, alignedBuildings: 0, mismatchBuildings: 0, averageCoveragePct: null });
  });

  it("shares one budget across buildings, retaining only completed coverage", () => {
    const buildings = context(square(2, -5, 8, 5));
    buildings.buildings = [1, 2, 3].map(id => ({ ...structuredClone(buildings.buildings[0]), id: `building-${id}` }));
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const cover = topology.localParcelCoveredArea;
    const coverage = vi.spyOn(topology, "localParcelCoveredArea").mockImplementation((...args) => {
      const result = cover(...args);
      now = 1_500;
      return result;
    });
    const validate = topology.validateLocalParcelTopology;
    const validation = vi.spyOn(topology, "validateLocalParcelTopology").mockImplementation((polygons, checkDeadline) => {
      if (polygons === buildings.buildings[1].polygons) now = 2_000;
      return validate(polygons, checkDeadline);
    });

    const result = buildContextParcelAlignment({ context: buildings, cadastral: cadastral(square(0, -10, 10, 10)) });

    expect(result.buildings[0]).toMatchObject({ status: "aligned", coveragePct: 100 });
    for (const building of result.buildings.slice(1)) expect(building).toMatchObject({
      status: "unavailable", coverageRatio: null, coveragePct: null, bestParcelPnu: null, bestParcelCoverageRatio: null,
    });
    expect(result.summary).toMatchObject({ alignedBuildings: 1, unavailableBuildings: 2, mismatchBuildings: 0, averageCoveragePct: 100 });
    expect(coverage).toHaveBeenCalledOnce();
    expect(validation.mock.calls.some(([polygons]) => polygons === buildings.buildings[2].polygons)).toBe(false);
  });

  it.each(["localParcelCoveredArea", "localParcelIntersectionArea"] as const)("rejects late %s results before exposing partial coverage", operation => {
    const buildings = context(square(2, -5, 8, 5));
    buildings.buildings.push({ ...buildings.buildings[0], id: "building-2" });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const cover = topology.localParcelCoveredArea;
    const intersect = topology.localParcelIntersectionArea;
    const expire = (result: number) => {
      now = 2_000;
      return result;
    };
    const calculation = operation === "localParcelCoveredArea"
      ? vi.spyOn(topology, operation).mockImplementation((...args) => expire(cover(...args)))
      : vi.spyOn(topology, operation).mockImplementation((...args) => expire(intersect(...args)));

    const result = buildContextParcelAlignment({ context: buildings, cadastral: cadastral(square(0, -10, 10, 10)) });

    expect(calculation).toHaveBeenCalledOnce();
    expect(result.buildings.map(building => building.status)).toEqual(["unavailable", "unavailable"]);
    expect(result.buildings.every(building => building.coveragePct === null && building.bestParcelCoverageRatio === null)).toBe(true);
    expect(result.summary.averageCoveragePct).toBeNull();
  });

  it("continues after invalid building topology without treating it as timeout", () => {
    const buildings = context(square(2, -5, 8, 5));
    buildings.buildings = [{ ...buildings.buildings[0], id: "invalid", polygons: [] }, buildings.buildings[0]];

    const result = buildContextParcelAlignment({ context: buildings, cadastral: cadastral(square(0, -10, 10, 10)) });

    expect(result.buildings.map(building => building.status)).toEqual(["unavailable", "aligned"]);
    expect(result.summary).toMatchObject({ alignedBuildings: 1, unavailableBuildings: 1, averageCoveragePct: 100 });
  });
});
