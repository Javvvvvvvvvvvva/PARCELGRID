export interface LocalPoint {
  x: number;
  z: number;
}

export interface LocalRoadLine {
  name: string | null;
  points: LocalPoint[];
}

export interface PrimaryRoadSelection {
  roadIndex: number;
  roadSegmentIndex: number;
  boundarySegmentIndex: number;
  distanceM: number;
  alignment: number;
  /** 1에 가까울수록 도로가 해당 필지 변의 바깥쪽에 있음. */
  outwardDot: number;
  score: number;
}

const FRONT_MIN_ALIGNMENT = Math.cos((30 * Math.PI) / 180);
const FRONT_MIN_OUTWARD_DOT = 0.25;

function closestPointToSegment(
  point: LocalPoint,
  a: LocalPoint,
  b: LocalPoint
): { point: LocalPoint; distance: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq <= 1e-9
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq
          )
        );
  const closest = { x: a.x + t * dx, z: a.z + t * dz };
  return {
    point: closest,
    distance: Math.hypot(point.x - closest.x, point.z - closest.z),
  };
}

function pointToSegmentDistance(point: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  return closestPointToSegment(point, a, b).distance;
}

function cross(a: LocalPoint, b: LocalPoint, c: LocalPoint): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function segmentsIntersect(a: LocalPoint, b: LocalPoint, c: LocalPoint, d: LocalPoint): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD <= 0 && cdA * cdB <= 0;
}

function segmentDistance(a: LocalPoint, b: LocalPoint, c: LocalPoint, d: LocalPoint): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b)
  );
}

function segmentLength(a: LocalPoint, b: LocalPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function parallelAlignment(a: LocalPoint, b: LocalPoint, c: LocalPoint, d: LocalPoint): number {
  const abLength = segmentLength(a, b);
  const cdLength = segmentLength(c, d);
  if (abLength <= 1e-9 || cdLength <= 1e-9) return 0;
  const dot =
    ((b.x - a.x) * (d.x - c.x) + (b.z - a.z) * (d.z - c.z)) /
    (abLength * cdLength);
  return Math.min(1, Math.abs(dot));
}

function polygonCenter(boundary: LocalPoint[]): LocalPoint {
  return {
    x: boundary.reduce((sum, point) => sum + point.x, 0) / boundary.length,
    z: boundary.reduce((sum, point) => sum + point.z, 0) / boundary.length,
  };
}

function outwardNormal(
  a: LocalPoint,
  b: LocalPoint,
  center: LocalPoint
): LocalPoint {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  let x = -dz / length;
  let z = dx / length;
  const midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  if (
    (center.x - midpoint.x) * x +
      (center.z - midpoint.z) * z >
    0
  ) {
    x = -x;
    z = -z;
  }
  return { x, z };
}

function outwardRelationship(
  boundaryA: LocalPoint,
  boundaryB: LocalPoint,
  center: LocalPoint,
  roadA: LocalPoint,
  roadB: LocalPoint
): number {
  const midpoint = {
    x: (boundaryA.x + boundaryB.x) / 2,
    z: (boundaryA.z + boundaryB.z) / 2,
  };
  const closest = closestPointToSegment(midpoint, roadA, roadB);
  if (closest.distance <= 1e-9) return 1;
  const outward = outwardNormal(boundaryA, boundaryB, center);
  return (
    ((closest.point.x - midpoint.x) * outward.x +
      (closest.point.z - midpoint.z) * outward.z) /
    closest.distance
  );
}

/**
 * Select the road that most plausibly fronts the parcel for Stage 1 display.
 *
 * A candidate must be close, approximately parallel to a parcel edge, and lie
 * on that edge's outward side. This prevents an internal/crossing centerline
 * from being shown as the frontage simply because its raw distance is small.
 * The road centerline remains a direction/reference signal only; legal road
 * boundary and width are verified separately from cadastral/UPIS geometry.
 */
export function selectPrimaryRoad(
  boundary: LocalPoint[],
  roads: LocalRoadLine[],
  maxDistanceM = 12
): PrimaryRoadSelection | null {
  if (boundary.length < 3 || roads.length === 0) return null;

  const center = polygonCenter(boundary);
  let best: PrimaryRoadSelection | null = null;

  for (let roadIndex = 0; roadIndex < roads.length; roadIndex += 1) {
    const road = roads[roadIndex];
    for (let roadSegmentIndex = 0; roadSegmentIndex < road.points.length - 1; roadSegmentIndex += 1) {
      const roadA = road.points[roadSegmentIndex];
      const roadB = road.points[roadSegmentIndex + 1];
      const roadLength = segmentLength(roadA, roadB);
      if (roadLength < 0.2) continue;

      for (
        let boundarySegmentIndex = 0;
        boundarySegmentIndex < boundary.length;
        boundarySegmentIndex += 1
      ) {
        const boundaryA = boundary[boundarySegmentIndex];
        const boundaryB = boundary[(boundarySegmentIndex + 1) % boundary.length];
        const boundaryLength = segmentLength(boundaryA, boundaryB);
        if (boundaryLength < 0.2) continue;

        const distanceM = segmentDistance(boundaryA, boundaryB, roadA, roadB);
        if (distanceM > maxDistanceM) continue;

        const alignment = parallelAlignment(boundaryA, boundaryB, roadA, roadB);
        if (alignment < FRONT_MIN_ALIGNMENT) continue;

        const outwardDot = outwardRelationship(
          boundaryA,
          boundaryB,
          center,
          roadA,
          roadB
        );
        if (outwardDot < FRONT_MIN_OUTWARD_DOT) continue;

        const usefulLength = Math.min(boundaryLength, roadLength, 20);
        const score =
          distanceM +
          (1 - alignment) * 5 +
          (1 - outwardDot) * 2 -
          usefulLength * 0.04;

        if (!best || score < best.score) {
          best = {
            roadIndex,
            roadSegmentIndex,
            boundarySegmentIndex,
            distanceM,
            alignment,
            outwardDot,
            score,
          };
        }
      }
    }
  }

  return best;
}
