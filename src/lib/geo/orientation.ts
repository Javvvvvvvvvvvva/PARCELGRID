/**
 * 대지 방위 분석 — 폴리곤 좌표로 정북 방향과 각 변의 방위를 계산.
 *
 * 건축사 설계 전 정보: 어느 변이 북측인가(일조 사선제한 적용 대상),
 * 각 변이 어느 방위를 향하는가. 추가 데이터 없이 좌표만으로 100% 계산.
 *
 * 정북 = 위도 증가 방향(+y). 일조권 정북 사선제한은 북측 인접대지
 * 경계선 기준이므로, 북측 변 식별이 핵심.
 */

import { projectPolygon } from "./project-polygon";

export type Direction = "북" | "북동" | "동" | "남동" | "남" | "남서" | "서" | "북서";

export interface EdgeInfo {
  /** 변 인덱스 (0부터) */
  index: number;
  /** 변 길이 (m) */
  lengthM: number;
  /** 바깥쪽이 향하는 방위각 (북=0, 동=90, 시계방향) */
  bearingDeg: number;
  /** 방위 이름 */
  direction: Direction;
  /** 북측 변 여부 (일조 사선제한 적용 대상) */
  isNorth: boolean;
}

export interface OrientationInfo {
  edges: EdgeInfo[];
  /** 가장 북쪽 변의 인덱스 */
  northEdgeIndex: number;
  /** 대지가 도로에 접한 것으로 추정되는 가장 긴 변 (참고용) */
  longestEdgeIndex: number;
}

const DIR_NAMES: Direction[] = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];

function bearing(dx: number, dy: number): number {
  // +y가 북. 방위각 = atan2(동, 북)
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function directionName(deg: number): Direction {
  return DIR_NAMES[Math.round(deg / 45) % 8];
}

/**
 * 폴리곤 경계 [lng,lat][] → 방위 분석.
 * @returns null이면 분석 불가 (좌표 부족)
 */
export function analyzeOrientation(
  boundary: [number, number][]
): OrientationInfo | null {
  if (!boundary || boundary.length < 4) return null;

  const projected = projectPolygon(boundary);
  if (!projected) return null;

  const pts = projected.points;
  const edges: EdgeInfo[] = [];
  let northEdgeIndex = 0;
  let maxNorthY = -Infinity;
  let longestEdgeIndex = 0;
  let maxLen = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const lengthM = Math.hypot(x2 - x1, y2 - y1);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    // 변의 바깥쪽 방위 = 대지중심(원점)에서 변 중점으로의 방향
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
