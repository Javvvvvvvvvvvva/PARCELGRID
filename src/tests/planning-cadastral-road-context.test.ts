import { describe, expect, it } from "vitest";
import {
  buildCadastralContext,
  type CadastralParcelFeature,
} from "@/lib/geo/cadastral-context";
import {
  buildCadastralDxf,
  buildCadastralGeoJson,
  buildCadastralLineworkPackage,
} from "@/lib/planning/cadastral-linework-export";
import {
  buildPlanningGeometry,
  planningRingCentroid,
  planningRingToLocalMeters,
} from "@/lib/planning/planning-geometry";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

const ORIGIN: [number, number] = [127.034, 37.65];

function localRingToLngLat(points: Array<[number, number]>): [number, number][] {
  const lngScale = 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return points.map(([x, z]) => [ORIGIN[0] + x / lngScale, ORIGIN[1] - z / 111_000]);
}

function targetBoundary(): [number, number][] {
  return localRingToLngLat([
    [-10, 10],
    [10, 10],
    [10, -10],
    [-10, -10],
    [-10, 10],
  ]);
}

function parcelFeature(input: {
  pnu: string;
  jibun: string;
  jimok: string;
  points: Array<[number, number]>;
}): CadastralParcelFeature {
  return {
    pnu: input.pnu,
    jibun: input.jibun,
    jimok: input.jimok,
    jimokCode: input.jimok === "도로" ? "14" : "08",
    lotAreaSqm: 100,
    boundary: localRingToLngLat([...input.points, input.points[0]]),
    distanceM: 12,
  };
}

function planning() {
  const boundary = targetBoundary();
  const scenario = createBlankPlanningScenario({
    projectId: "target-pnu",
    name: "지적도 테스트 계획안",
  });
  scenario.id = "scenario-cadastral";
  scenario.version = 2;
  const floor = createFloorProgram(1, [
    createFloorZone("residential", 100, 1),
  ]);
  floor.id = "floor-cadastral";
  scenario.floorPrograms = [floor];
  scenario.placement = {
    rotationDeg: 0,
    offsetXM: 0,
    offsetZM: 0,
    roadSetbackM: 0,
    northSetbackM: 0,
  };
  const origin = planningRingCentroid(boundary);
  const lotAreaSqm = polygonAreaSqm(
    planningRingToLocalMeters(boundary, origin)
  );
  return buildPlanningGeometry({
    projectId: "target-pnu",
    scenario,
    boundary,
    lotAreaSqm,
    zoning: "일반상업지역",
    roads: [],
    setback: { road: 0, side: 0, rear: 0 },
    generatedAt: "2026-07-15T00:00:00.000Z",
  }).snapshot;
}

function sourceParcels(): CadastralParcelFeature[] {
  return [
    parcelFeature({
      pnu: "road-pnu",
      jibun: "도로 1",
      jimok: "도로",
      points: [
        [10, 15],
        [16, 15],
        [16, -15],
        [10, -15],
      ],
    }),
    parcelFeature({
      pnu: "adjacent-pnu",
      jibun: "인접 2",
      jimok: "대",
      points: [
        [-20, 10],
        [-10, 10],
        [-10, -10],
        [-20, -10],
      ],
    }),
  ];
}

describe("Cadastral road context", () => {
  it("separates road parcels and measures cadastral road width", () => {
    const snapshot = buildCadastralContext({
      planning: planning(),
      targetPnu: "target-pnu",
      parcels: sourceParcels(),
      generatedAt: "2026-07-15T00:00:00.000Z",
    });

    expect(snapshot.summary.roadParcelCount).toBe(1);
    expect(snapshot.summary.adjacentParcelCount).toBe(1);
    expect(snapshot.summary.verifiedWidthFrontageCount).toBe(1);
    expect(snapshot.summary.primaryWidthMinM).toBeCloseTo(6, 2);
    expect(snapshot.summary.primaryWidthAvgM).toBeCloseTo(6, 2);
    expect(snapshot.summary.primaryWidthMaxM).toBeCloseTo(6, 2);
    expect(snapshot.frontages[0].boundaryGapM).toBeCloseTo(0, 2);
    expect(snapshot.frontages[0].widthSamples.length).toBe(5);
    expect(snapshot.validation.status).toBe("pass");
  });

  it("keeps a stable hash and changes it when road width changes", () => {
    const first = buildCadastralContext({
      planning: planning(),
      targetPnu: "target-pnu",
      parcels: sourceParcels(),
      generatedAt: "2026-07-15T00:00:00.000Z",
    });
    const same = buildCadastralContext({
      planning: planning(),
      targetPnu: "target-pnu",
      parcels: sourceParcels(),
      generatedAt: "2026-07-16T00:00:00.000Z",
    });
    const changedParcels = sourceParcels();
    changedParcels[0] = parcelFeature({
      pnu: "road-pnu",
      jibun: "도로 1",
      jimok: "도로",
      points: [
        [10, 15],
        [18, 15],
        [18, -15],
        [10, -15],
      ],
    });
    const changed = buildCadastralContext({
      planning: planning(),
      targetPnu: "target-pnu",
      parcels: changedParcels,
    });

    expect(first.cadastralHash).toBe(same.cadastralHash);
    expect(changed.cadastralHash).not.toBe(first.cadastralHash);
    expect(changed.summary.primaryWidthAvgM).toBeCloseTo(8, 2);
  });

  it("exports meter DXF, WGS84 GeoJSON, metadata, and README in a ZIP", () => {
    const snapshot = buildCadastralContext({
      planning: planning(),
      targetPnu: "target-pnu",
      parcels: sourceParcels(),
    });
    const dxf = buildCadastralDxf(snapshot);
    const geojson = buildCadastralGeoJson({
      snapshot,
      targetBoundary: targetBoundary(),
      sourceParcels: sourceParcels(),
    });
    const bundle = buildCadastralLineworkPackage({
      snapshot,
      targetBoundary: targetBoundary(),
      sourceParcels: sourceParcels(),
    });

    expect(dxf).toContain("$INSUNITS");
    expect(dxf).toContain("PG_SITE_BOUNDARY");
    expect(dxf).toContain("PG_ROAD_PARCELS");
    expect(dxf).toContain("PG_ROAD_WIDTH_SAMPLES");
    expect(geojson).toContain('"FeatureCollection"');
    expect(geojson).toContain('"PG_ROAD_PARCELS"');
    expect(bundle.metadataText).toContain(snapshot.cadastralHash);
    expect(bundle.readmeText).toContain("지적상 도로 폭");
    expect(bundle.zipBytes[0]).toBe(0x50);
    expect(bundle.zipBytes[1]).toBe(0x4b);
  });

  it("returns a review warning when no road parcel is available", () => {
    const snapshot = buildCadastralContext({
      planning: planning(),
      targetPnu: "target-pnu",
      parcels: sourceParcels().filter((parcel) => parcel.jimok !== "도로"),
    });
    expect(snapshot.summary.roadParcelCount).toBe(0);
    expect(snapshot.validation.status).toBe("review");
    expect(
      snapshot.validation.issues.some(
        (issue) => issue.code === "cadastral-road-parcel-missing"
      )
    ).toBe(true);
  });
});
