import { convex, featureCollection, intersect, kinks, point, polygon } from "@turf/turf";
import type { MultiPolygon, Polygon } from "geojson";
import { polygonAreaSqm, type LocalPlanPoint } from "./planning-massing";

export type PlanPoint = LocalPlanPoint;
export const GEOMETRY_EPS = 1e-5;

export function rotatePlanPoint(p: PlanPoint, degrees: number): PlanPoint {
  const a = degrees * Math.PI / 180;
  return { x: p.x * Math.cos(a) - p.z * Math.sin(a), z: p.x * Math.sin(a) + p.z * Math.cos(a) };
}

export function planRectangle(center: PlanPoint, width: number, depth: number, degrees = 0): PlanPoint[] {
  return [
    { x: -width / 2, z: -depth / 2 }, { x: width / 2, z: -depth / 2 },
    { x: width / 2, z: depth / 2 }, { x: -width / 2, z: depth / 2 },
  ].map(p => {
    const r = rotatePlanPoint(p, degrees);
    return { x: center.x + r.x, z: center.z + r.z };
  });
}

function feature(points: PlanPoint[]) {
  const ring = points.map(p => [p.x, p.z]);
  if (ring.length && (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])) ring.push([...ring[0]]);
  return polygon([ring]);
}

export function validPlanPolygon(points: PlanPoint[]): boolean {
  try {
    return points.length >= 3 && points.length <= 500 &&
      points.every(p => Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= 1e6 && Math.abs(p.z) <= 1e6) &&
      polygonAreaSqm(points) > GEOMETRY_EPS && kinks(feature(points)).features.length === 0;
  } catch { return false; }
}

function metricArea(geometry: Polygon | MultiPolygon): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((sum, rings) => sum + rings.reduce((area, ring, i) =>
    area + (i === 0 ? 1 : -1) * polygonAreaSqm(ring.map(([x, z]) => ({ x, z }))), 0), 0);
}

function planBounds(points: PlanPoint[]) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Turf performs planar clipping; geographic Turf area/buffer must not be used on local metre coordinates. */
export function planIntersectionArea(a: PlanPoint[], b: PlanPoint[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  // Snap only clipping inputs below the screening tolerance. Near-coincident
  // projected/rotated edges otherwise destabilize the polygon sweep algorithm.
  const snap = (points: PlanPoint[]) => points.map(p => ({
    x: Math.round(p.x * 1e8) / 1e8, z: Math.round(p.z * 1e8) / 1e8,
  }));
  const first = snap(a), second = snap(b);
  const firstBounds = planBounds(first), secondBounds = planBounds(second);
  // Limit quadratic validity checks to small room/parking rings. Touching
  // bounds have zero area; complex, invalid or overlapping rings keep Turf.
  if (first.length <= 8 && second.length <= 8 &&
      (firstBounds.maxX <= secondBounds.minX || secondBounds.maxX <= firstBounds.minX ||
       firstBounds.maxZ <= secondBounds.minZ || secondBounds.maxZ <= firstBounds.minZ) &&
      validPlanPolygon(first) && validPlanPolygon(second)) return 0;
  const clipped = intersect(featureCollection([feature(first), feature(second)]));
  return clipped ? metricArea(clipped.geometry) : 0;
}

export function planContains(outer: PlanPoint[], inner: PlanPoint[]): boolean {
  const area = polygonAreaSqm(inner);
  return area > GEOMETRY_EPS && Math.abs(area - planIntersectionArea(outer, inner)) <= Math.max(GEOMETRY_EPS, area * 1e-7);
}

export function planHull(points: PlanPoint[]): PlanPoint[] {
  return convex(featureCollection(points.map(p => point([p.x, p.z]))))?.geometry.coordinates[0]
    .slice(0, -1).map(([x, z]) => ({ x, z })) ?? [];
}

export function sharedPlanEdge(a: PlanPoint[], b: PlanPoint[]): [PlanPoint, PlanPoint] | null {
  let best: [PlanPoint, PlanPoint] | null = null;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < GEOMETRY_EPS) continue;
    const ux = (q.x - p.x) / len, uz = (q.z - p.z) / len;
    for (let j = 0; j < b.length; j++) {
      const r = b[j], s = b[(j + 1) % b.length];
      if (Math.abs((r.x - p.x) * uz - (r.z - p.z) * ux) > GEOMETRY_EPS ||
          Math.abs((s.x - p.x) * uz - (s.z - p.z) * ux) > GEOMETRY_EPS) continue;
      const t1 = (r.x - p.x) * ux + (r.z - p.z) * uz;
      const t2 = (s.x - p.x) * ux + (s.z - p.z) * uz;
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(len, Math.max(t1, t2));
      if (hi - lo > GEOMETRY_EPS && (!best || hi - lo > Math.hypot(best[1].x - best[0].x, best[1].z - best[0].z))) {
        best = [{ x: p.x + ux * lo, z: p.z + uz * lo }, { x: p.x + ux * hi, z: p.z + uz * hi }];
      }
    }
  }
  return best;
}

export function openingOnEdge(edge: [PlanPoint, PlanPoint] | null, center: PlanPoint, widthM: number, marginM = 0): [PlanPoint, PlanPoint] | null {
  if (!edge || !Number.isFinite(widthM) || widthM <= 0) return null;
  const length = Math.hypot(edge[1].x - edge[0].x, edge[1].z - edge[0].z);
  if (length < GEOMETRY_EPS) return null;
  const ux = (edge[1].x - edge[0].x) / length, uz = (edge[1].z - edge[0].z) / length;
  const along = (center.x - edge[0].x) * ux + (center.z - edge[0].z) * uz;
  const across = Math.abs((center.x - edge[0].x) * uz - (center.z - edge[0].z) * ux);
  if (!Number.isFinite(along) || !Number.isFinite(across) || across > GEOMETRY_EPS ||
      along - widthM / 2 < marginM - GEOMETRY_EPS || along + widthM / 2 > length - marginM + GEOMETRY_EPS) return null;
  return [{ x: center.x - ux * widthM / 2, z: center.z - uz * widthM / 2 },
    { x: center.x + ux * widthM / 2, z: center.z + uz * widthM / 2 }];
}
