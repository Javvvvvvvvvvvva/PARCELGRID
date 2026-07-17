/**
 * 대지·도로·카메라 방위 분석.
 *
 * 지리 좌표 투영에서는 +Y가 북쪽이며, Three.js 현황 매스에서는
 * +X가 동쪽, -Z가 북쪽이다. 이 파일에서 두 좌표 표현을 같은
 * 방위각 체계(정북 0°, 동 90°, 시계방향)로 통일한다.
 */

import { projectPolygon } from "./project-polygon";
import type { LocalPoint } from "./select-primary-road";

export type Direction = "북" | "북동" | "동" | "남동" | "남" | "남서" | "서" | "북서";

export interface EdgeInfo {
  index: number;
  lengthM: number;
  bearingDeg: number;
  direction: Direction;
  isNorth: boolean;
}

export interface OrientationInfo {
  edges: EdgeInfo[];
  northEdgeIndex: number;
  longestEdgeIndex: number;
}

const DIR_NAMES: Direction[] = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const CARDINAL_16 = [
  "북",
  "북북동",
  "북동",
  "동북동",
  "동",
  "동남동",
  "남동",
  "남남동",
  "남",
  "남남서",
  "남서",
  "서남서",
  "서",
  "서북서",
  "북서",
  "북북서",
] as const;
const CARDINAL_8_SIDE = [
  "북측",
  "북동측",
  "동측",
  "남동측",
  "남측",
  "남서측",
  "서측",
  "북서측",
] as const;

export function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function bearing(dx: number, dy: number): number {
  return normalizeBearing((Math.atan2(dx, dy) * 180) / Math.PI);
}

function directionName(deg: number): Direction {
  return DIR_NAMES[Math.round(normalizeBearing(deg) / 45) % 8];
}

/**
 * 폴리곤 경계 [lng,lat][] → 방위 분석.
 */
export function analyzeOrientation(boundary: [number, number][]): OrientationInfo | null {
  if (!boundary || boundary.length < 4) return null;

  const projected = projectPolygon(boundary);
  if (!projected) return null;

  const pts = projected.points;
  const edges: EdgeInfo[] = [];
  let northEdgeIndex = 0;
  let maxNorthY = -Infinity;
  let longestEdgeIndex = 0;
  let maxLen = 0;

  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const lengthM = Math.hypot(x2 - x1, y2 - y1);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const bearingDeg = bearing(midX, midY);

    edges.push({
      index: i,
      lengthM,
      bearingDeg,
      direction: directionName(bearingDeg),
      isNorth: false,
    });

    if (midY > maxNorthY) {
      maxNorthY = midY;
      northEdgeIndex = i;
    }
    if (lengthM > maxLen) {
      maxLen = lengthM;
      longestEdgeIndex = i;
    }
  }

  if (edges[northEdgeIndex]) edges[northEdgeIndex].isNorth = true;
  return { edges, northEdgeIndex, longestEdgeIndex };
}

/**
 * Three.js 현황 매스 좌표계: +X=동, -Z=북.
 * 정북 기준 시계방향 방위각을 반환한다.
 */
export function bearingFromSceneVector(dx: number, dz: number): number {
  if (Math.hypot(dx, dz) <= 1e-9) return 0;
  return normalizeBearing((Math.atan2(dx, -dz) * 180) / Math.PI);
}

export function sceneSegmentBearing(a: LocalPoint, b: LocalPoint): number {
  return bearingFromSceneVector(b.x - a.x, b.z - a.z);
}

export function cardinal16Label(bearingDeg: number): string {
  const index = Math.round(normalizeBearing(bearingDeg) / 22.5) % 16;
  return CARDINAL_16[index];
}

/** 도로는 양방향 축이므로 두 반대 방위를 함께 표시한다. */
export function roadAxisLabel(a: LocalPoint, b: LocalPoint): string {
  const first = sceneSegmentBearing(a, b);
  const opposite = normalizeBearing(first + 180);
  return `${cardinal16Label(first)}–${cardinal16Label(opposite)}`;
}

/** 필지 중심이 로컬 원점이므로 접도 경계 중점으로 접도면을 판정한다. */
export function frontageSideLabel(a: LocalPoint, b: LocalPoint): string {
  const midpointX = (a.x + b.x) / 2;
  const midpointZ = (a.z + b.z) / 2;
  const bearingDeg = bearingFromSceneVector(midpointX, midpointZ);
  const index = Math.round(normalizeBearing(bearingDeg) / 45) % 8;
  return CARDINAL_8_SIDE[index];
}

export function angularDifference(a: number, b: number): number {
  const difference = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return Math.min(difference, 360 - difference);
}
