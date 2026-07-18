/**
 * 도로 접면 분석 — 부지 경계와 도로 중심선으로 전면/측면/후면을 식별.
 *
 * 건축사 설계 전 정보: 어느 변이 도로에 접하는가(전면).
 * 전면이 정해지면 마주보는 변=후면, 나머지=측면 → 변별 이격거리 적용.
 *
 * V월드 LT_L_SPRD(새주소도로) 중심선 기준. 도로 폭은 이 레이어에 없어
 * 별도 보강 필요하나, 전면 식별만으로 변별 이격거리 정확화 가능.
 */

import { projectPolygon } from "./project-polygon";

export type EdgeRole = "전면" | "측면" | "후면";

export interface FrontageEdge {
  index: number;
  lengthM: number;
  /** 이 변에서 가장 가까운 도로 중심선까지 거리 (m) */
  roadDistM: number;
  role: EdgeRole;
  /** 법적 최대 검토용 기본 이격거리 (m). 별도 설계 여유는 포함하지 않는다. */
  setbackM: number;
}

export interface FrontageInfo {
  edges: FrontageEdge[];
  frontIndex: number;
  rearIndex: number;
  /** 접한 도로명 (가장 가까운 도로) */
  roadName: string | null;
  /** 전면 변에서 도로까지 거리 (m) */
  frontDistM: number;
}

export interface BoundarySetbackSpec {
  road: number;
  side: number;
  rear: number;
}

/**
 * 법적 최대 매스의 검토 기본값.
 * 도로측은 확인된 건축선을 기준으로 추가 후퇴 0m, 인접대지측은 민법상 0.5m를
 * 보수적으로 적용한다. 용도·조례·별도 건축선은 검증 전 상태로 UI에 표시한다.
 */
export const LEGAL_MAX_BOUNDARY_SETBACK: BoundarySetbackSpec = {
  road: 0,
  side: 0.5,
  rear: 0.5,
};
/** 전면으로 인정하는 최대 도로 거리 (m) — 이보다 멀면 맹지 가능성 */
const FRONT_MAX_DIST = 12;

function distPointToSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 부지 경계 + 도로 중심선들 → 전면/측면/후면 식별.
 * @param boundary 부지 경계 [lng,lat][]
 * @param roads 도로 중심선들 (각 도로는 [lng,lat][] 점열), roadName 동반
 * @returns null이면 분석 불가
 */
export function analyzeFrontage(
  boundary: [number, number][],
  roads: { name: string | null; points: [number, number][] }[]
): FrontageInfo | null {
  if (!boundary || boundary.length < 4) return null;
  if (!roads || roads.length === 0) return null;

  const projected = projectPolygon(boundary);
  if (!projected) return null;
  const B = projected.points;

  // 도로 점들도 같은 투영으로 (projectPolygon의 중심 기준)
  const { center } = projected;
  const lat0 = center.lat;
  const LNG = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const LAT = 110540;
  const pj = (p: [number, number]): [number, number] => [
    (p[0] - center.lng) * LNG,
    (p[1] - center.lat) * LAT,
  ];

  // 각 변 중점 → 모든 도로 최소거리 + 어느 도로인지
  const edgeCount = B.length - 1;
  let frontIndex = 0;
  let minDist = Infinity;
  let frontRoadName: string | null = null;

  const edgeDists: { dist: number; roadName: string | null; lengthM: number }[] = [];

  for (let i = 0; i < edgeCount; i++) {
    const a = B[i];
    const b = B[i + 1];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const lengthM = Math.hypot(b[0] - a[0], b[1] - a[1]);

    let best = Infinity;
    let bestRoad: string | null = null;
    for (const road of roads) {
      const R = road.points.map(pj);
      for (let j = 0; j < R.length - 1; j++) {
        const d = distPointToSegment(mid, R[j], R[j + 1]);
        if (d < best) {
          best = d;
          bestRoad = road.name;
        }
      }
    }
    edgeDists.push({ dist: best, roadName: bestRoad, lengthM });
    if (best < minDist) {
      minDist = best;
      frontIndex = i;
      frontRoadName = bestRoad;
    }
  }

  // 전면이 너무 멀면 맹지 — 전면 없음 처리
  if (minDist > FRONT_MAX_DIST) {
    return {
      edges: edgeDists.map((e, i) => ({
        index: i,
        lengthM: e.lengthM,
        roadDistM: e.dist,
        role: "측면" as EdgeRole,
        setbackM: LEGAL_MAX_BOUNDARY_SETBACK.side,
      })),
      frontIndex: -1,
      rearIndex: -1,
      roadName: null,
      frontDistM: minDist,
    };
  }

  // 후면 = 전면과 마주보는 변 (사각형 가정: +2)
  const rearIndex = edgeCount === 4 ? (frontIndex + 2) % 4 : -1;

  const edges: FrontageEdge[] = edgeDists.map((e, i) => {
    let role: EdgeRole;
    let setbackM: number;
    if (i === frontIndex) {
      role = "전면";
      setbackM = LEGAL_MAX_BOUNDARY_SETBACK.road;
    } else if (i === rearIndex) {
      role = "후면";
      setbackM = LEGAL_MAX_BOUNDARY_SETBACK.rear;
    } else {
      role = "측면";
      setbackM = LEGAL_MAX_BOUNDARY_SETBACK.side;
    }
    return { index: i, lengthM: e.lengthM, roadDistM: e.dist, role, setbackM };
  });

  return {
    edges,
    frontIndex,
    rearIndex,
    roadName: frontRoadName,
    frontDistM: minDist,
  };
}


/**
 * frontage 결과 → 변별 이격 배열 (calcBuildableArea edgeSetbacksM용).
 * 전면/측면/후면 값은 실무 기본값(가정) — 민법 0.5m 하한은 법정으로 항상 보장.
 * C 원칙: 법정값처럼 조용히 쓰지 않음 — 화면에 "가정값(수정 가능)" 표시 필수.
 */
export function edgeSetbacksFromFrontage(
  info: FrontageInfo | null,
  setback: BoundarySetbackSpec,
  minLegalM = 0.5
): number[] | undefined {
  if (!info || info.edges.length === 0) return undefined;
  const arr: number[] = [];
  for (const e of info.edges) {
    const v =
      e.role === "전면" ? setback.road : e.role === "후면" ? setback.rear : setback.side;
    // 확인된 도로측 건축선에는 전국 공통 추가 0.5m를 강제하지 않는다.
    arr[e.index] = Math.max(e.role === "전면" ? 0 : minLegalM, v);
  }
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) arr[i] = minLegalM;
  }
  return arr;
}

/** 법적 최대 외곽선 전용. 사용자가 입력한 설계 여유거리와 분리한다. */
export function legalEdgeSetbacksFromFrontage(
  info: FrontageInfo | null
): number[] | undefined {
  return edgeSetbacksFromFrontage(info, LEGAL_MAX_BOUNDARY_SETBACK);
}
