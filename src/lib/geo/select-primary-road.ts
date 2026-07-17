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
  score: number;
}

function pointToSegmentDistance(point: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-9) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq)
  );
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
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

/**
 * Select the road that most plausibly fronts the parcel.
 *
 * Distance remains the primary signal, but an adjacent road that runs parallel
 * to a meaningful parcel edge is preferred over a perpendicular or incidental
 * centerline. The returned boundary segment is used to highlight the frontage.
 */
export function selectPrimaryRoad(
  boundary: LocalPoint[],
  roads: LocalRoadLine[],
  maxDistanceM = 12
): PrimaryRoadSelection | null {
  if (boundary.length < 3 || roads.length === 0) return null;

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
        const usefulLength = Math.min(boundaryLength, roadLength, 20);
        const score = distanceM + (1 - alignment) * 5 - usefulLength * 0.04;

        if (!best || score < best.score) {
          best = {
            roadIndex,
            roadSegmentIndex,
            boundarySegmentIndex,
            distanceM,
            alignment,
            score,
          };
        }
      }
    }
  }

  return best;
}
