/**
 * 도로 접면 분석 — 부지 경계와 도로 중심선으로 전면/측면/후면을 식별.
 *
 * 도로 중심선은 법정 도로 경계나 폭을 확정하지 않는다. 이 모듈은 중심선의
 * 거리·평행성·대지 바깥 방향을 함께 확인해 접면 후보를 찾고, 코너 필지처럼
 * 둘 이상의 도로에 접하는 경우 모든 접도 변을 전면으로 보존한다.
 */

import { projectPolygon } from "./project-polygon";

export type EdgeRole = "전면" | "측면" | "후면";

export interface FrontageEdge {
  index: number;
  lengthM: number;
  /** 이 변에서 가장 가까운 관련 도로 중심선까지 거리 (m) */
  roadDistM: number;
  role: EdgeRole;
  /** 법적 최대 검토용 기본 이격거리 (m). 별도 설계 여유는 포함하지 않는다. */
  setbackM: number;
}

export interface FrontageInfo {
  edges: FrontageEdge[];
  /** 여러 접도 변 중 가장 가까운 대표 전면. 접면이 없으면 -1. */
  frontIndex: number;
  /** 단일 전면 사각형에서만 추정한다. 코너·비정형 필지는 -1. */
  rearIndex: number;
  /** 대표 전면과 가장 가까운 도로명 */
  roadName: string | null;
  /** 대표 전면에서 관련 도로 중심선까지 거리 (m) */
  frontDistM: number;
}

export interface BoundarySetbackSpec {
  road: number;
  side: number;
  rear: number;
}

/**
 * 법적 최대 매스의 검토 기본값.
 * 도로측은 확인된 건축선을 기준으로 추가 후퇴 0m, 인접대지측은 민법상
 * 경계 이격 참고값 0.5m를 적용한다. 관습·조례·별도 건축선 확인 전에는
 * 인허가 확정값이 아니며 UI와 보고서에서 검토값으로 표시해야 한다.
 */
export const LEGAL_MAX_BOUNDARY_SETBACK: BoundarySetbackSpec = {
  road: 0,
  side: 0.5,
  rear: 0.5,
};

/** 중심선 기반 접면 후보를 인정하는 최대 거리 (m). */
const FRONT_MAX_DIST = 12;
/** 대지 변과 도로 중심선이 30도 이내로 평행해야 한다. */
const FRONT_MIN_ALIGNMENT = Math.cos((30 * Math.PI) / 180);
/** 도로 중심선이 해당 변의 대지 바깥쪽에 있어야 한다. */
const FRONT_MIN_OUTWARD_DOT = 0.25;

interface RoadCandidate {
  dist: number;
  roadName: string | null;
  alignment: number;
  outwardDot: number;
}

function closestPointToSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): { point: [number, number]; distance: number } {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx +
              (point[1] - start[1]) * dy) /
              lengthSq,
          ),
        )
      : 0;
  const closest: [number, number] = [
    start[0] + t * dx,
    start[1] + t * dy,
  ];
  return {
    point: closest,
    distance: Math.hypot(
      point[0] - closest[0],
      point[1] - closest[1],
    ),
  };
}

function outwardNormal(
  start: [number, number],
  end: [number, number],
  center: [number, number],
): [number, number] {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  const midpoint: [number, number] = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
  ];
  if (
    (center[0] - midpoint[0]) * nx +
      (center[1] - midpoint[1]) * ny >
    0
  ) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

function roadCandidateForEdge(
  start: [number, number],
  end: [number, number],
  center: [number, number],
  roads: { name: string | null; points: [number, number][] }[],
  projectRoadPoint: (point: [number, number]) => [number, number],
): { nearest: RoadCandidate | null; frontage: RoadCandidate | null } {
  const midpoint: [number, number] = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
  ];
  const edgeDx = end[0] - start[0];
  const edgeDy = end[1] - start[1];
  const edgeLength = Math.hypot(edgeDx, edgeDy);
  if (edgeLength < 1e-9) return { nearest: null, frontage: null };

  const [outX, outY] = outwardNormal(start, end, center);
  let nearest: RoadCandidate | null = null;
  let frontage: RoadCandidate | null = null;

  for (const road of roads) {
    const points = road.points.map(projectRoadPoint);
    for (let index = 0; index < points.length - 1; index += 1) {
      const roadStart = points[index];
      const roadEnd = points[index + 1];
      const roadDx = roadEnd[0] - roadStart[0];
      const roadDy = roadEnd[1] - roadStart[1];
      const roadLength = Math.hypot(roadDx, roadDy);
      if (roadLength < 1e-9) continue;

      const closest = closestPointToSegment(
        midpoint,
        roadStart,
        roadEnd,
      );
      const alignment = Math.abs(
        (edgeDx * roadDx + edgeDy * roadDy) /
          (edgeLength * roadLength),
      );
      const outwardDot =
        closest.distance <= 1e-9
          ? 1
          : ((closest.point[0] - midpoint[0]) * outX +
              (closest.point[1] - midpoint[1]) * outY) /
            closest.distance;
      const candidate: RoadCandidate = {
        dist: closest.distance,
        roadName: road.name,
        alignment,
        outwardDot,
      };

      if (!nearest || candidate.dist < nearest.dist) nearest = candidate;
      if (
        candidate.dist <= FRONT_MAX_DIST &&
        candidate.alignment >= FRONT_MIN_ALIGNMENT &&
        candidate.outwardDot >= FRONT_MIN_OUTWARD_DOT &&
        (!frontage || candidate.dist < frontage.dist)
      ) {
        frontage = candidate;
      }
    }
  }

  return { nearest, frontage };
}

/**
 * 부지 경계 + 도로 중심선들 → 전면/측면/후면 식별.
 *
 * 중심선은 접면 후보 식별용이며 도로 폭·건축선의 법적 확정 근거가 아니다.
 * 연속지적도 도로 필지와 UPIS 계획도로 침범 검사는 별도 컨텍스트 검증에서
 * 수행한다.
 */
export function analyzeFrontage(
  boundary: [number, number][],
  roads: { name: string | null; points: [number, number][] }[],
): FrontageInfo | null {
  if (!boundary || boundary.length < 3) return null;
  if (!roads || roads.length === 0) return null;

  const projected = projectPolygon(
    boundary.length >= 4 &&
      boundary[0][0] === boundary[boundary.length - 1][0] &&
      boundary[0][1] === boundary[boundary.length - 1][1]
      ? boundary
      : [...boundary, boundary[0]],
  );
  if (!projected) return null;

  const projectedOpen =
    projected.points.length > 1 &&
    projected.points[0][0] ===
      projected.points[projected.points.length - 1][0] &&
    projected.points[0][1] ===
      projected.points[projected.points.length - 1][1]
      ? projected.points.slice(0, -1)
      : projected.points;
  const edgeCount = projectedOpen.length;
  if (edgeCount < 3) return null;

  const center: [number, number] = [
    projectedOpen.reduce((sum, point) => sum + point[0], 0) /
      edgeCount,
    projectedOpen.reduce((sum, point) => sum + point[1], 0) /
      edgeCount,
  ];
  const lat0 = projected.center.lat;
  const lngScale = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const latScale = 110540;
  const projectRoadPoint = (
    point: [number, number],
  ): [number, number] => [
    (point[0] - projected.center.lng) * lngScale,
    (point[1] - projected.center.lat) * latScale,
  ];

  const relationships = projectedOpen.map((start, index) => {
    const end = projectedOpen[(index + 1) % edgeCount];
    return {
      index,
      lengthM: Math.hypot(
        end[0] - start[0],
        end[1] - start[1],
      ),
      ...roadCandidateForEdge(
        start,
        end,
        center,
        roads,
        projectRoadPoint,
      ),
    };
  });

  const frontRelationships = relationships.filter(
    (relationship) => relationship.frontage != null,
  );
  if (frontRelationships.length === 0) {
    const nearestDistance = relationships.reduce(
      (minimum, relationship) =>
        Math.min(
          minimum,
          relationship.nearest?.dist ?? Number.POSITIVE_INFINITY,
        ),
      Number.POSITIVE_INFINITY,
    );
    return {
      edges: relationships.map((relationship) => ({
        index: relationship.index,
        lengthM: relationship.lengthM,
        roadDistM:
          relationship.nearest?.dist ?? Number.POSITIVE_INFINITY,
        role: "측면" as const,
        setbackM: LEGAL_MAX_BOUNDARY_SETBACK.side,
      })),
      frontIndex: -1,
      rearIndex: -1,
      roadName: null,
      frontDistM: nearestDistance,
    };
  }

  const primary = frontRelationships.reduce((best, relationship) =>
    relationship.frontage!.dist < best.frontage!.dist
      ? relationship
      : best,
  );
  const frontIndices = new Set(
    frontRelationships.map((relationship) => relationship.index),
  );
  const rearIndex =
    frontIndices.size === 1 && edgeCount === 4
      ? (primary.index + 2) % 4
      : -1;

  const edges: FrontageEdge[] = relationships.map((relationship) => {
    const isFront = frontIndices.has(relationship.index);
    const isRear = relationship.index === rearIndex;
    const role: EdgeRole = isFront
      ? "전면"
      : isRear
        ? "후면"
        : "측면";
    return {
      index: relationship.index,
      lengthM: relationship.lengthM,
      roadDistM:
        relationship.frontage?.dist ??
        relationship.nearest?.dist ??
        Number.POSITIVE_INFINITY,
      role,
      setbackM:
        role === "전면"
          ? LEGAL_MAX_BOUNDARY_SETBACK.road
          : role === "후면"
            ? LEGAL_MAX_BOUNDARY_SETBACK.rear
            : LEGAL_MAX_BOUNDARY_SETBACK.side,
    };
  });

  return {
    edges,
    frontIndex: primary.index,
    rearIndex,
    roadName: primary.frontage!.roadName,
    frontDistM: primary.frontage!.dist,
  };
}

/**
 * frontage 결과 → 변별 이격 배열 (calcBuildableArea edgeSetbacksM용).
 * 도로측 중심선은 접면 후보일 뿐이며 실제 건축선은 지적·도시계획 원문을
 * 함께 확인해야 한다.
 */
export function edgeSetbacksFromFrontage(
  info: FrontageInfo | null,
  setback: BoundarySetbackSpec,
  minLegalM = 0.5,
): number[] | undefined {
  if (!info || info.edges.length === 0) return undefined;
  const arr: number[] = [];
  for (const edge of info.edges) {
    const value =
      edge.role === "전면"
        ? setback.road
        : edge.role === "후면"
          ? setback.rear
          : setback.side;
    arr[edge.index] = Math.max(
      edge.role === "전면" ? 0 : minLegalM,
      value,
    );
  }
  for (let index = 0; index < arr.length; index += 1) {
    if (arr[index] == null) arr[index] = minLegalM;
  }
  return arr;
}

/** 법적 최대 외곽선 전용. 사용자가 입력한 설계 여유거리와 분리한다. */
export function legalEdgeSetbacksFromFrontage(
  info: FrontageInfo | null,
): number[] | undefined {
  return edgeSetbacksFromFrontage(
    info,
    LEGAL_MAX_BOUNDARY_SETBACK,
  );
}
