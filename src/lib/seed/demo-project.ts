import type { Parcel } from "@/lib/finance/types";
import { createRegulatoryReferenceSet } from "@/lib/regulatory/constraints";
import { computeProject } from "@/lib/services/compute-project";
import { generateScenariosForParcel } from "@/lib/services/generate-scenarios";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";

const DEMO_ORIGIN: [number, number] = [127.025749, 37.650511];
const DEMO_RETRIEVED_AT = "2026-08-26T00:00:00.000Z";

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
  maxFAR: 250,
  maxBCR: 60,
  heightLimit: 18,
  regulatoryConstraints: createRegulatoryReferenceSet({
    farPct: 250,
    bcrPct: 60,
    heightM: 18,
    retrievedAt: DEMO_RETRIEVED_AT,
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
