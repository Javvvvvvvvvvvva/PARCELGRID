import type { Parcel } from "@/lib/finance/types";
import { createRegulatoryReferenceSet } from "@/lib/regulatory/constraints";
import { computeProject } from "@/lib/services/compute-project";
import { generateScenariosForParcel } from "@/lib/services/generate-scenarios";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";

const DEMO_ORIGIN: [number, number] = [127.025749, 37.650511];
const DEMO_RETRIEVED_AT = "2026-10-17T00:00:00.000Z";
const SEOUL_CITY_PLANNING_ORDINANCE_URL =
  "https://law.go.kr/ordinInfoP.do?ordinId=2000719";

function localRingToLngLat(points: Array<[number, number]>): [number, number][] {
  const longitudeScale =
    111_000 * Math.cos((DEMO_ORIGIN[1] * Math.PI) / 180);
  return points.map(([x, z]) => [
    DEMO_ORIGIN[0] + x / longitudeScale,
    DEMO_ORIGIN[1] - z / 111_000,
  ]);
}

export const DEMO_PARCEL: Parcel = {
  id: DEMO_PROJECT_ID,
  address: "서울 도봉구 쌍문동 281-23",
  addressRoad: "",
  lat: DEMO_ORIGIN[1],
  lng: DEMO_ORIGIN[0],
  lotArea: 118.02,
  boundary: localRingToLngLat([
    [-5, 5.901],
    [5, 5.901],
    [5, -5.901],
    [-5, -5.901],
    [-5, 5.901],
  ]),
  roads: [
    {
      name: "노해로41길",
      points: localRingToLngLat([
        [7.5, 12],
        [7.5, -12],
      ]),
    },
  ],
  zoning: "제2종일반주거지역",
  zoneCode: "UB20",
  maxFAR: 200,
  maxBCR: 60,
  heightLimit: 0,
  regulatoryConstraints: createRegulatoryReferenceSet({
    farPct: 200,
    bcrPct: 60,
    heightM: null,
    retrievedAt: DEMO_RETRIEVED_AT,
    farReference: {
      sourceName: "서울특별시 도시계획 조례 제48조",
      sourceRef: SEOUL_CITY_PLANNING_ORDINANCE_URL,
      note: "제2종일반주거지역의 일반 용적률 기준입니다. 이 데모 필지의 용도지역·지구단위계획·중첩 규제 적용 여부는 원문 확인 전입니다.",
    },
    bcrReference: {
      sourceName: "서울특별시 도시계획 조례 제44조",
      sourceRef: SEOUL_CITY_PLANNING_ORDINANCE_URL,
      note: "제2종일반주거지역의 일반 건폐율 기준입니다. 이 데모 필지의 용도지역·지구단위계획·중첩 규제 적용 여부는 원문 확인 전입니다.",
    },
  }),
  overlays: [],
  setback: { road: 0, side: 0, rear: 0 },
  currentBuilding: null,
  landPrice: 5_000_000,
  estMarketPrice: 8_000_000,
  acquired: "2026-07-30",
  acquiredPrice: 80_000,
  demolitionCost: 0,
};

export function buildDemoProject() {
  return computeProject(DEMO_PARCEL, generateScenariosForParcel(DEMO_PARCEL), {
    calculateMaxAcquisition: true,
  });
}
