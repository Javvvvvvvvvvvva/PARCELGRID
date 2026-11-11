import { booleanPointInPolygon, featureCollection, intersect, multiPolygon, point, union } from "@turf/turf";
import type { MultiPolygon, Polygon } from "geojson";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import { ringAreaSqm as polygonAreaSqm, polygonSelfIntersects, segmentsIntersect } from "./planar-ring";
import { parcelRings, type LocalParcelPolygon } from "./parcel-topology";

export function openParcelRing(points: LocalPlanPoint[]): LocalPlanPoint[] {
  const first = points[0], last = points.at(-1);
  return first && last && first.x === last.x && first.z === last.z ? points.slice(0, -1) : points;
}

function coordinates(points: LocalPlanPoint[]): [number, number][] {
  const ring = openParcelRing(points).map(p => [Math.round(p.x * 1e8) / 1e8, Math.round(p.z * 1e8) / 1e8] as [number, number]);
  return ring.length ? [...ring, ring[0]] : [];
}

export function localParcelFeature(polygons: LocalParcelPolygon[]) {
  return multiPolygon(polygons.map(part => [coordinates(part.outer), ...part.holes.map(coordinates)]));
}

export function localParcelArea(polygons: LocalParcelPolygon[]): number {
  return polygons.reduce((sum, part) => sum + polygonAreaSqm(part.outer)
    - part.holes.reduce((holes, ring) => holes + polygonAreaSqm(ring), 0), 0);
}

function geometryArea(geometry: Polygon | MultiPolygon): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((sum, rings) => sum + rings.reduce((total, ring, index) =>
    total + (index ? -1 : 1) * polygonAreaSqm(ring.map(([x, z]) => ({ x, z }))), 0), 0);
}

/** Turf clipping is planar; geodesic area must not be applied to local metre coordinates. */
export function localParcelIntersectionArea(first: LocalParcelPolygon[], second: LocalParcelPolygon[]): number {
  const result = intersect(featureCollection([localParcelFeature(first), localParcelFeature(second)]));
  return result ? geometryArea(result.geometry) : 0;
}

export function localParcelCoveredArea(subject: LocalParcelPolygon[], candidates: LocalParcelPolygon[][]): number {
  if (!candidates.length) return 0;
  const coverage = candidates.length === 1 ? localParcelFeature(candidates[0]) : union(featureCollection(candidates.map(localParcelFeature)));
  if (!coverage) return 0;
  const result = intersect(featureCollection([localParcelFeature(subject), coverage]));
  return result ? geometryArea(result.geometry) : 0;
}

export function localParcelContainsPoint(polygons: LocalParcelPolygon[], value: LocalPlanPoint, ignoreBoundary = false): boolean {
  return booleanPointInPolygon(point([value.x, value.z]), localParcelFeature(polygons), { ignoreBoundary });
}

export function validateLocalParcelTopology(polygons: LocalParcelPolygon[], checkDeadline?: () => void): boolean {
  try {
    checkDeadline?.();
    if (!Array.isArray(polygons) || !polygons.length || polygons.length > 200) return false;
    if (polygons.some(part => !part || !Array.isArray(part.outer) || !Array.isArray(part.holes))) return false;
    const rings = parcelRings(polygons).map(openParcelRing);
    if (rings.reduce((sum, ring) => sum + ring.length, 0) > 10_000) return false;
    for (const ring of rings) {
      checkDeadline?.();
      if (ring.length < 3 || ring.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) return false;
      if (polygonAreaSqm(ring) <= 1e-8 || polygonSelfIntersects(ring, checkDeadline)) return false;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
        if (b.x === c.x && b.z === c.z) return false;
        const ab = { x: b.x - a.x, z: b.z - a.z }, bc = { x: c.x - b.x, z: c.z - b.z };
        if (Math.abs(ab.x * bc.z - ab.z * bc.x) <= 1e-8 && ab.x * bc.x + ab.z * bc.z < 0) return false;
      }
    }
    let comparisons = 0;
    const ringsTouch = (first: LocalPlanPoint[], second: LocalPlanPoint[]) => {
      const a = openParcelRing(first), b = openParcelRing(second);
      for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
        if (++comparisons % 1024 === 0) checkDeadline?.();
        if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
      }
      return false;
    };
    for (const part of polygons) {
      for (let i = 0; i < part.holes.length; i++) {
        const hole = part.holes[i];
        if (!localParcelContainsPoint([{ outer: part.outer, holes: [] }], hole[0], true) || ringsTouch(part.outer, hole)) return false;
        for (let j = i + 1; j < part.holes.length; j++) {
          const other = part.holes[j];
          if (ringsTouch(hole, other) || localParcelContainsPoint([{ outer: hole, holes: [] }], other[0])
            || localParcelContainsPoint([{ outer: other, holes: [] }], hole[0])) return false;
        }
      }
    }
    for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) {
      checkDeadline?.();
      if (localParcelIntersectionArea([polygons[i]], [polygons[j]]) > 1e-8) return false;
    }
    checkDeadline?.();
    return localParcelArea(polygons) > 1e-8;
  } catch (error) {
    // Caller cancellation/deadline must not become a supposedly invalid source geometry.
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw error;
    return false;
  }
}
