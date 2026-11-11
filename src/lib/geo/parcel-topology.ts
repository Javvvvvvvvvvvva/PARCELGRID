import type { LocalPlanPoint } from "@/lib/planning/planning-massing";

export interface ParcelPolygon<Point> {
  outer: Point[];
  holes: Point[][];
}

export type Wgs84ParcelPolygon = ParcelPolygon<[number, number]>;
export type LocalParcelPolygon = ParcelPolygon<LocalPlanPoint>;

export interface ParcelBoundaryInput {
  boundary?: [number, number][];
  boundaryPolygons?: Wgs84ParcelPolygon[];
}

function isWgs84Ring(value: unknown): value is [number, number][] {
  return Array.isArray(value) && value.length >= 3 && value.every(point =>
    Array.isArray(point) && point.length === 2 &&
    typeof point[0] === "number" && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
    typeof point[1] === "number" && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90);
}

/** Structural presence only; geometric validity and official approval are separate checks. */
export function parcelBoundaryPolygons(parcel: ParcelBoundaryInput): Wgs84ParcelPolygon[] {
  if (parcel.boundaryPolygons !== undefined) {
    const polygons = parcel.boundaryPolygons;
    return Array.isArray(polygons) && polygons.length > 0 && polygons.every(part =>
      part && isWgs84Ring(part.outer) && Array.isArray(part.holes) && part.holes.every(isWgs84Ring))
      ? polygons : [];
  }
  return isWgs84Ring(parcel.boundary) ? [{ outer: parcel.boundary, holes: [] }] : [];
}

export function hasParcelBoundary(parcel: ParcelBoundaryInput): boolean {
  return parcelBoundaryPolygons(parcel).length > 0;
}

// A supplied topology is authoritative. Empty/invalid topology must not fall back to an outer ring.
export function sourceParcelPolygons(parcel: { polygons?: Wgs84ParcelPolygon[]; boundary: [number, number][] }): Wgs84ParcelPolygon[] {
  return parcel.polygons === undefined ? [{ outer: parcel.boundary, holes: [] }] : Array.isArray(parcel.polygons) ? parcel.polygons : [];
}

export function localParcelPolygons(parcel: { polygons?: LocalParcelPolygon[]; polygon: LocalPlanPoint[] }): LocalParcelPolygon[] {
  return parcel.polygons === undefined ? [{ outer: parcel.polygon, holes: [] }] : Array.isArray(parcel.polygons) ? parcel.polygons : [];
}

export function parcelRings<Point>(polygons: ParcelPolygon<Point>[]): Point[][] {
  return polygons.flatMap(part => [part.outer, ...part.holes]);
}
