import jsts from "@turf/jsts";
import { booleanIntersects, difference, feature, featureCollection, polygon, union } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon, Geometry } from "geojson";
import type { LocalParcelPolygon, Wgs84ParcelPolygon } from "./parcel-topology";
import { localParcelArea, localParcelFeature, openParcelRing, validateLocalParcelTopology } from "./parcel-topology-geometry";

type Region = Feature<Polygon | MultiPolygon>;

export function parcelProjectionOrigin(polygons: Wgs84ParcelPolygon[]): [number, number] {
  if (!Array.isArray(polygons) || !polygons.length || polygons.length > 200) throw new Error("Missing parcel topology");
  let count = 0;
  for (const part of polygons) {
    if (!part || !Array.isArray(part.outer) || !Array.isArray(part.holes) || part.holes.length > 3333) throw new Error("Invalid parcel rings");
    for (const ring of [part.outer, ...part.holes]) {
      if (!Array.isArray(ring) || ring.length < 3 || (count += ring.length) > 10_000) throw new Error("Parcel coordinate limit exceeded");
    }
  }
  const points = polygons.flatMap(part => part.outer);
  if (!points.length) throw new Error("No parcel coordinates");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
      || Math.abs(point[0]) > 180 || Math.abs(point[1]) >= 89) throw new Error("Invalid parcel coordinates");
    minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

export function projectParcelPolygons(polygons: Wgs84ParcelPolygon[], origin: [number, number]): LocalParcelPolygon[] {
  const scale = 111_000 * Math.cos(origin[1] * Math.PI / 180);
  const ring = (values: [number, number][]) => openParcelRing(values.map(([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) >= 89) throw new Error("Invalid parcel coordinates");
    return { x: (lng - origin[0]) * scale, z: -(lat - origin[1]) * 111_000 };
  }));
  return polygons.map(part => ({ outer: ring(part.outer), holes: part.holes.map(ring) }));
}

export function unprojectParcelPolygons(polygons: LocalParcelPolygon[], origin: [number, number]): Wgs84ParcelPolygon[] {
  const scale = 111_000 * Math.cos(origin[1] * Math.PI / 180);
  const ring = (values: LocalParcelPolygon["outer"]): [number, number][] => values.map(({ x, z }) => [origin[0] + x / scale, origin[1] - z / 111_000]);
  return polygons.map(part => ({ outer: ring(part.outer), holes: part.holes.map(ring) }));
}

function fromGeometry(geometry: Geometry): LocalParcelPolygon[] {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") throw new Error("Unexpected envelope geometry");
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return parts.map(rings => {
    if (!rings.length || rings.some(ring => ring.length < 4)) throw new Error("Invalid calculated envelope rings");
    const ring = (points: number[][]) => openParcelRing(points.map(([x, z]) => ({ x, z })));
    return { outer: ring(rings[0]), holes: rings.slice(1).map(ring) };
  });
}

function buffered(geometry: Geometry, distance: number, check: () => void): Region | null {
  check();
  const reader = new jsts.GeoJSONReader(), writer = new jsts.GeoJSONWriter();
  const result = jsts.BufferOp.bufferOp(reader.read(geometry), distance, 16);
  check();
  if (result.isEmpty()) return null;
  const output = writer.write(result);
  if (output.type !== "Polygon" && output.type !== "MultiPolygon") throw new Error("Unexpected buffer geometry");
  return feature(output);
}

function subtract(subject: Region | null, cuts: Region[], check: () => void): Region | null {
  if (!subject || !cuts.length) return subject;
  check();
  const combined = cuts.length === 1 ? cuts[0] : union(featureCollection(cuts));
  check();
  const result = combined ? difference(featureCollection([subject, combined])) : subject;
  check();
  return result;
}

function signedRingArea(ring: LocalParcelPolygon["outer"]): number {
  return ring.reduce((sum, a, index) => { const b = ring[(index + 1) % ring.length]; return sum + a.x * b.z - b.x * a.z; }, 0) / 2;
}

export interface ParcelEnvelope {
  origin: [number, number];
  source: LocalParcelPolygon[];
  afterSide: LocalParcelPolygon[];
  northEdgeCount: number;
  atNorthSetback: (distance: number) => LocalParcelPolygon[];
}

/** Finite buffers and swept north-facing edges retain concavities, holes and disconnected regions. */
export function buildParcelEnvelope(input: {
  polygons: Wgs84ParcelPolygon[];
  sideSetbackM: number;
  edgeSetbacksByPolygon?: number[][][];
  check: () => void;
}): ParcelEnvelope {
  const { check } = input;
  check();
  if (!Array.isArray(input.polygons) || !input.polygons.length || input.polygons.length > 200) throw new Error("Missing parcel topology");
  const origin = parcelProjectionOrigin(input.polygons);
  // Clipping subjects and edge cuts must share the same precision grid.
  const snap = (ring: LocalParcelPolygon["outer"]) => ring.map(({ x, z }) => ({ x: Math.round(x * 1e8) / 1e8, z: Math.round(z * 1e8) / 1e8 }));
  const source = projectParcelPolygons(input.polygons, origin).map(part => ({ outer: snap(part.outer), holes: part.holes.map(snap) }));
  if (!validateLocalParcelTopology(source, check)) throw new Error("Invalid parcel topology");
  // Touching components need an explicit boundary-merging policy before edge setbacks can be assigned.
  for (let i = 0; i < source.length; i++) for (let j = i + 1; j < source.length; j++) {
    check();
    if (booleanIntersects(localParcelFeature([source[i]]), localParcelFeature([source[j]]))) throw new Error("Touching parcel components require review");
  }
  if (!Number.isFinite(input.sideSetbackM) || input.sideSetbackM < 0 || input.sideSetbackM > 1000) throw new Error("Invalid setback");
  if (input.edgeSetbacksByPolygon !== undefined && (!Array.isArray(input.edgeSetbacksByPolygon) || input.edgeSetbacksByPolygon.length !== source.length)) {
    throw new Error("Component setback identity mismatch");
  }
  const edges: Array<{ part: number; a: { x: number; z: number }; b: { x: number; z: number } }> = [];
  const side = source.map((part, partIndex) => {
    check();
    const region = localParcelFeature([part]);
    const rings = [part.outer, ...part.holes];
    const supplied = input.edgeSetbacksByPolygon?.[partIndex];
    if (input.edgeSetbacksByPolygon !== undefined && (!Array.isArray(supplied) || supplied.length !== rings.length
      || supplied.some((values, i) => !Array.isArray(values) || values.length !== rings[i].length
        || values.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000)))) {
      throw new Error("Edge setback identity mismatch");
    }
    const distances = rings.map((ring, ringIndex) => {
      const sign = Math.sign(signedRingArea(ring)) * (ringIndex === 0 ? 1 : -1);
      return ring.map((a, index) => {
      const b = ring[(index + 1) % ring.length];
      const northComponent = sign * (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z);
      if (northComponent > 0.001) edges.push({ part: partIndex, a, b });
      const distance = supplied ? supplied[ringIndex][index] : input.sideSetbackM;
      if (!Number.isFinite(distance) || distance < 0 || distance > 1000) throw new Error("Invalid edge setback");
      return distance;
      });
    });
    const flat = distances.flat();
    if (flat.every(value => value === flat[0])) return flat[0] > 0 ? buffered(region.geometry, -flat[0], check) : region;
    const cuts = rings.flatMap((ring, ringIndex) => ring.flatMap((a, index) => {
      const distance = distances[ringIndex][index];
      if (distance === 0) return [];
      const b = ring[(index + 1) % ring.length];
      const cut = buffered({ type: "LineString", coordinates: [[a.x, a.z], [b.x, b.z]] }, distance, check);
      return cut ? [cut] : [];
    }));
    return subtract(region, cuts, check);
  });
  const combine = (regions: Array<Region | null>): LocalParcelPolygon[] => {
    const valid = regions.filter((item): item is Region => item !== null);
    if (!valid.length) return [];
    check();
    const result = valid.length === 1 ? valid[0] : union(featureCollection(valid));
    check();
    const polygons = result ? fromGeometry(result.geometry) : [];
    if (polygons.length && !validateLocalParcelTopology(polygons, check)) throw new Error("Invalid calculated envelope");
    return polygons;
  };
  const afterSide = combine(side);
  return {
    origin, source, afterSide, northEdgeCount: edges.length,
    atNorthSetback(distance) {
      check();
      if (!Number.isFinite(distance) || distance < 0 || distance > 10_000) throw new Error("Invalid north setback");
      if (distance === 0) return afterSide;
      return combine(side.map((region, partIndex) => {
        const cuts = edges.filter(edge => edge.part === partIndex).map(({ a, b }) => polygon([[
          [a.x, a.z], [b.x, b.z], [b.x, b.z + distance], [a.x, a.z + distance], [a.x, a.z],
        ]]));
        return subtract(region, cuts, check);
      }));
    },
  };
}

export { localParcelArea };
