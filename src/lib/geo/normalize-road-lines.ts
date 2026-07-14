export interface RoadPolyline {
  name: string | null;
  points: [number, number][];
}

const MIN_DISCONTINUITY_M = 20;
const TYPICAL_SEGMENT_MULTIPLIER = 4;
const COORD_EPSILON = 1e-10;

function samePoint(a: [number, number], b: [number, number]): boolean {
  return (
    Math.abs(a[0] - b[0]) <= COORD_EPSILON &&
    Math.abs(a[1] - b[1]) <= COORD_EPSILON
  );
}

function dedupeConsecutive(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const point of points) {
    if (out.length === 0 || !samePoint(out[out.length - 1], point)) {
      out.push(point);
    }
  }
  return out;
}

function distanceM(a: [number, number], b: [number, number]): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(meanLat);
  const dy = (b[1] - a[1]) * 110_540;
  return Math.hypot(dx, dy);
}

/**
 * VWorld LT_L_SPRD can return MultiLineString geometry. Legacy lookup data
 * may flatten every part into one point array, producing a fake diagonal
 * between disconnected road sections. This normalizer splits only large
 * outlier jumps relative to the road's usual vertex spacing.
 */
export function normalizeRoadLines(roads: RoadPolyline[]): RoadPolyline[] {
  const normalized: RoadPolyline[] = [];

  for (const road of roads) {
    const points = dedupeConsecutive(road.points ?? []);
    if (points.length < 2) continue;

    const distances = points
      .slice(1)
      .map((point, index) => distanceM(points[index], point))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (distances.length === 0) continue;

    const sorted = [...distances].sort((a, b) => a - b);
    const lowerMedian = sorted[Math.floor((sorted.length - 1) / 2)];
    const discontinuityM = Math.max(
      MIN_DISCONTINUITY_M,
      lowerMedian * TYPICAL_SEGMENT_MULTIPLIER
    );

    let current: [number, number][] = [points[0]];

    for (let index = 1; index < points.length; index += 1) {
      const jumpM = distanceM(points[index - 1], points[index]);
      if (jumpM >= discontinuityM && current.length >= 2) {
        normalized.push({ name: road.name, points: current });
        current = [points[index]];
      } else {
        current.push(points[index]);
      }
    }

    if (current.length >= 2) {
      normalized.push({ name: road.name, points: current });
    }
  }

  return normalized;
}
