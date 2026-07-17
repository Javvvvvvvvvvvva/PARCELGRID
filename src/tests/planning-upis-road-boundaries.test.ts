import { describe, expect, it } from "vitest";
import { buildCadastralContext } from "@/lib/geo/cadastral-context";
import { parseUpisRoadFeatures } from "@/lib/integrations/vworld-upis-roads";
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

const ORIGIN: [number, number] = [127.025749, 37.650511];

function localRingToLngLat(points: Array<[number, number]>): [number, number][] {
  const lngScale = 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return points.map(([x, z]) => [ORIGIN[0] + x / lngScale, ORIGIN[1] - z / 111_000]);
}

function planning() {
  const boundary = localRingToLngLat([
    [-10, 10],
    [10, 10],
    [10, -10],
    [-10, -10],
    [-10, 10],
  ]);
  const scenario = createBlankPlanningScenario({
    projectId: "upis-target",
    name: "UPIS 도로 경계 테스트",
  });
  scenario.id = "scenario-upis-road";
  scenario.version = 1;
  const floor = createFloorProgram(1, [createFloorZone("residential", 100, 1)]);
  floor.id = "floor-upis-road";
  scenario.floorPrograms = [floor];
  scenario.placement = {
    rotationDeg: 0,
    offsetXM: 0,
    offsetZM: 0,
    roadSetbackM: 0,
    northSetbackM: 0,
  };
  const origin = planningRingCentroid(boundary);
  const lotAreaSqm = polygonAreaSqm(planningRingToLocalMeters(boundary, origin));
  return buildPlanningGeometry({
    projectId: "upis-target",
    scenario,
    boundary,
    lotAreaSqm,
    zoning: "제2종일반주거지역",
    roads: [],
    setback: { road: 0, side: 0, rear: 0 },
  }).snapshot;
}

describe("VWorld UPIS road boundaries", () => {
  it("parses LT_C_UPISUQ151 polygons and measures their road width", () => {
    const roadRing = localRingToLngLat([
      [10, 15],
      [16, 15],
      [16, -15],
      [10, -15],
      [10, 15],
    ]);
    const parsed = parseUpisRoadFeatures({
      center: { lng: ORIGIN[0], lat: ORIGIN[1] },
      radiusM: 120,
      maxCount: 20,
      features: [
        {
          geometry: {
            type: "Polygon",
            coordinates: [roadRing],
          },
          properties: {
            present_sn: "41800UQ151PS201608040233",
            dgm_nm: "소로3류",
            dgm_ar: 180,
            dgm_lt: 30,
            grad_se: "소로",
            road_ty: "3",
            road_no: "53",
            road_role: "PMI0004",
            excut_se: "EMA0009",
          },
        },
      ],
    });

    expect(parsed.parcels).toHaveLength(1);
    expect(parsed.parcels[0].pnu).toContain("UPIS-41800UQ151PS201608040233");
    expect(parsed.parcels[0].jimok).toBe("도로");
    expect(parsed.parcels[0].jimokCode).toBe("UPIS-UQ151");
    expect(parsed.summaries[0]).toMatchObject({
      label: "소로3류",
      grade: "소로",
      roadType: "3",
      roadNo: "53",
      executionCode: "EMA0009",
    });

    const snapshot = buildCadastralContext({
      planning: planning(),
      targetPnu: "upis-target",
      parcels: parsed.parcels,
    });
    expect(snapshot.summary.roadParcelCount).toBe(1);
    expect(snapshot.summary.verifiedWidthFrontageCount).toBe(1);
    expect(snapshot.summary.primaryWidthMinM).toBeCloseTo(6, 1);
    expect(snapshot.summary.primaryWidthAvgM).toBeCloseTo(6, 1);
    expect(snapshot.summary.primaryWidthMaxM).toBeCloseTo(6, 1);
  });

  it("supports uppercase SHP-style property names and MultiPolygon parts", () => {
    const first = localRingToLngLat([
      [12, 8],
      [18, 8],
      [18, -8],
      [12, -8],
      [12, 8],
    ]);
    const second = localRingToLngLat([
      [-25, 6],
      [-20, 6],
      [-20, -6],
      [-25, -6],
      [-25, 6],
    ]);
    const parsed = parseUpisRoadFeatures({
      center: { lng: ORIGIN[0], lat: ORIGIN[1] },
      radiusM: 120,
      maxCount: 20,
      features: [
        {
          geometry: {
            type: "MultiPolygon",
            coordinates: [[first], [second]],
          },
          properties: {
            PRESENT_SN: "UPPERCASE-01",
            DGM_NM: "소로2류",
            DGM_AR: 168,
            DGM_LT: 28,
            GRAD_SE: "소로",
            ROAD_TY: "2",
            EXCUT_SE: "EMA0001",
          },
        },
      ],
    });

    expect(parsed.parcels).toHaveLength(2);
    expect(parsed.summaries[0].featurePartCount).toBe(2);
    expect(parsed.summaries[0].executionCode).toBe("EMA0001");
  });
});
