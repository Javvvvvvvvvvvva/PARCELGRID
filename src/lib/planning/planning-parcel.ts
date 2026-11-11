import { localParcelPolygons, parcelBoundaryPolygons, type ParcelBoundaryInput, type LocalParcelPolygon, type Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { parcelProjectionOrigin, projectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { validateLocalParcelTopology } from "@/lib/geo/parcel-topology-geometry";

export interface PlanningParcelRegion {
  source: Wgs84ParcelPolygon[];
  polygons: LocalParcelPolygon[];
  origin: [number, number];
  available: boolean;
  simple: boolean;
}

export function planningRoadsMatchSnapshot(roads: Array<{ name: string | null; points: [number, number][] }>, snapshot: {
  roads: Array<{ name: string | null; points: LocalParcelPolygon["outer"] }>;
  coordinateSystem: { originLngLat: [number, number] };
}): boolean {
  try {
    const origin = snapshot.coordinateSystem.originLngLat;
    const scale = 111_000 * Math.cos(origin[1] * Math.PI / 180);
    return roads.length === snapshot.roads.length && roads.every((road, i) => {
      const stored = snapshot.roads[i];
      return road.name === stored.name && road.points.length === stored.points.length && road.points.every(([lng, lat], j) => {
        const point = stored.points[j];
        return Number.isFinite(point.x) && Number.isFinite(point.z) &&
          Math.hypot((lng - origin[0]) * scale - point.x, -(lat - origin[1]) * 111_000 - point.z) <= 1e-6;
      });
    });
  } catch { return false; }
}

export function planningParcelMatchesSnapshot(source: PlanningParcelRegion, snapshot: {
  parcel: { polygon: LocalParcelPolygon["outer"]; polygons?: LocalParcelPolygon[] };
  coordinateSystem: { originLngLat: [number, number] };
}): boolean {
  try {
    if (!source.available) return false;
    const projected = projectParcelPolygons(source.source, snapshot.coordinateSystem.originLngLat);
    const stored = localParcelPolygons(snapshot.parcel);
    const same = (a: LocalParcelPolygon["outer"], b: LocalParcelPolygon["outer"]) => a.length === b.length && a.every((p, i) =>
      Number.isFinite(b[i].x) && Number.isFinite(b[i].z) && Math.hypot(p.x - b[i].x, p.z - b[i].z) <= 1e-6);
    return projected.length === stored.length && projected.every((part, i) => same(part.outer, stored[i].outer)
      && part.holes.length === stored[i].holes.length && part.holes.every((ring, j) => same(ring, stored[i].holes[j])));
  } catch { return false; }
}

/** Preserve the existing single-ring placement origin; all complex rings share one origin. */
export function resolvePlanningParcel(input: ParcelBoundaryInput): PlanningParcelRegion {
  const unavailable: PlanningParcelRegion = { source: [], polygons: [], origin: [0, 0], available: false, simple: false };
  const deadline = performance.now() + 2000;
  const check = () => {
    if (performance.now() > deadline) { const error = new Error("Parcel validation deadline"); error.name = "TimeoutError"; throw error; }
  };
  try {
    const source = parcelBoundaryPolygons(input);
    const boundsOrigin = parcelProjectionOrigin(source);
    const simple = source.length === 1 && source[0].holes.length === 0;
    let origin = boundsOrigin;
    if (simple) {
      const ring = source[0].outer;
      const last = ring.at(-1)!;
      const points = ring[0][0] === last[0] && ring[0][1] === last[1] ? ring.slice(0, -1) : ring;
      origin = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
    }
    const polygons = projectParcelPolygons(source, origin);
    if (!validateLocalParcelTopology(polygons, check)) return unavailable;
    return { source, polygons, origin, available: true, simple };
  } catch { return unavailable; }
}
