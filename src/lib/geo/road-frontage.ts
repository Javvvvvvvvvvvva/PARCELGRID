import { lineIntersect, lineString } from "@turf/turf";
import { parcelProjectionOrigin, projectParcelPolygons } from "./parcel-envelope";
import { localParcelContainsPoint, localParcelFeature, validateLocalParcelTopology } from "./parcel-topology-geometry";
import type { LocalParcelPolygon, Wgs84ParcelPolygon } from "./parcel-topology";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";

export type EdgeRole = "전면" | "측면" | "후면";
export interface FrontageEdge {
  index: number;
  lengthM: number;
  roadDistM: number;
  role: EdgeRole;
  setbackM: number;
}
export interface FrontageInfo {
  edges: FrontageEdge[];
  frontIndex: number;
  rearIndex: number;
  roadName: string | null;
  frontDistM: number;
}
export interface BoundarySetbackSpec { road: number; side: number; rear: number }

// Preliminary boundary assumptions only, not a verified building line or legal approval.
export const LEGAL_MAX_BOUNDARY_SETBACK: BoundarySetbackSpec = { road: 0, side: 0.5, rear: 0.5 };
export interface ParcelFrontageEdge extends FrontageEdge {
  polygonIndex: number;
  ringIndex: number;
  edgeIndex: number;
  edge: [LocalPlanPoint, LocalPlanPoint];
  roadName: string | null;
}
export interface ParcelFrontageInfo {
  origin: [number, number];
  edges: ParcelFrontageEdge[];
  frontages: ParcelFrontageEdge[];
  edgeSetbacksByPolygon: number[][][];
}
type Road = { name: string | null; points: [number, number][] };
type Segment = { name: string | null; start: LocalPlanPoint; end: LocalPlanPoint };

function closestPoint(point: LocalPlanPoint, a: LocalPlanPoint, b: LocalPlanPoint): LocalPlanPoint {
  const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq)) : 0;
  return { x: a.x + t * dx, z: a.z + t * dz };
}

/** Check every interval between boundary intersections, including very narrow intervening components. */
function unobstructedApproach(a: LocalPlanPoint, b: LocalPlanPoint, polygons: LocalParcelPolygon[]): boolean {
  const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-12) return false;
  const crossings = lineIntersect(lineString([[a.x, a.z], [b.x, b.z]]), localParcelFeature(polygons));
  const stops = [0, 1, ...crossings.features.map(({ geometry: { coordinates: p } }) =>
    Math.max(0, Math.min(1, ((p[0] - a.x) * dx + (p[1] - a.z) * dz) / lengthSq)))].sort((x, y) => x - y);
  for (let i = 1; i < stops.length; i++) {
    if (stops[i] - stops[i - 1] < 1e-9) continue;
    const t = (stops[i] + stops[i - 1]) / 2;
    if (localParcelContainsPoint(polygons, { x: a.x + dx * t, z: a.z + dz * t }, true)) return false;
  }
  return !localParcelContainsPoint(polygons, b, true);
}

/** Centerlines identify access candidates, never legal road width, ownership, or permission. */
export function analyzeParcelFrontage(
  polygons: Wgs84ParcelPolygon[], roads: Road[], suppliedOrigin?: [number, number],
): ParcelFrontageInfo | null {
  const deadline = performance.now() + 2000;
  let comparisons = 0;
  const check = () => {
    if (++comparisons > 100_000 || performance.now() > deadline) {
      const error = new Error("Frontage analysis budget exhausted"); error.name = "TimeoutError"; throw error;
    }
  };
  try {
    const defaultOrigin = parcelProjectionOrigin(polygons);
    const origin = suppliedOrigin ?? defaultOrigin;
    if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(Number.isFinite)
      || Math.abs(origin[0]) > 180 || Math.abs(origin[1]) >= 89) return null;
    const snap = (ring: LocalPlanPoint[]) => ring.map(({ x, z }) => ({ x: Math.round(x * 1e8) / 1e8, z: Math.round(z * 1e8) / 1e8 }));
    const local = projectParcelPolygons(polygons, origin).map(part => ({ outer: snap(part.outer), holes: part.holes.map(snap) }));
    if (!validateLocalParcelTopology(local, check) || !Array.isArray(roads) || roads.length > 1000) return null;
    let roadPointCount = 0;
    const scale = 111_000 * Math.cos(origin[1] * Math.PI / 180);
    const segments: Segment[] = [];
    for (const road of roads) {
      check();
      if (!road || !Array.isArray(road.points) || (roadPointCount += road.points.length) > 10_000) return null;
      const points = road.points.map(p => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) >= 89) throw new Error("Invalid road coordinate");
        return { x: (p[0] - origin[0]) * scale, z: -(p[1] - origin[1]) * 111_000 };
      });
      for (let i = 1; i < points.length; i++) segments.push({ name: road.name, start: points[i - 1], end: points[i] });
    }
    const edges: ParcelFrontageEdge[] = [];
    local.forEach((part, polygonIndex) => {
      [part.outer, ...part.holes].forEach((ring, ringIndex) => {
        const sign = Math.sign(ring.reduce((sum, a, i) => {
          const b = ring[(i + 1) % ring.length]; return sum + a.x * b.z - b.x * a.z;
        }, 0));
        const ringEdges = ring.map((start, edgeIndex): ParcelFrontageEdge => {
          check();
          const end = ring[(edgeIndex + 1) % ring.length];
          const dx = end.x - start.x, dz = end.z - start.z, lengthM = Math.hypot(dx, dz);
          const middle = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
          // Winding, not a vertex centroid, determines the outside of a concave boundary.
          const normal = { x: sign * dz / lengthM, z: -sign * dx / lengthM };
          let nearest = Infinity, frontageDistance = Infinity, roadName: string | null = null;
          for (const segment of segments) {
            check();
            const rx = segment.end.x - segment.start.x, rz = segment.end.z - segment.start.z;
            const roadLength = Math.hypot(rx, rz);
            if (roadLength < 1e-9) continue;
            const closest = closestPoint(middle, segment.start, segment.end);
            const distance = Math.hypot(closest.x - middle.x, closest.z - middle.z);
            nearest = Math.min(nearest, distance);
            // A road inside a hole, or coincident with the boundary, is not an inferred entry.
            if (ringIndex !== 0 || distance <= 1e-6 || distance > 12 || distance >= frontageDistance) continue;
            const alignment = Math.abs((dx * rx + dz * rz) / (lengthM * roadLength));
            const outward = ((closest.x - middle.x) * normal.x + (closest.z - middle.z) * normal.z) / distance;
            if (alignment >= Math.cos(Math.PI / 6) && outward >= 0.25 && unobstructedApproach(middle, closest, local)) {
              check(); frontageDistance = distance; roadName = segment.name;
            }
          }
          const front = Number.isFinite(frontageDistance);
          return { index: edgeIndex, polygonIndex, ringIndex, edgeIndex, edge: [start, end], lengthM,
            roadDistM: front ? frontageDistance : nearest, role: front ? "전면" : "측면",
            setbackM: front ? LEGAL_MAX_BOUNDARY_SETBACK.road : LEGAL_MAX_BOUNDARY_SETBACK.side, roadName };
        });
        const front = ringEdges.filter(edge => edge.role === "전면");
        if (ringIndex === 0 && ring.length === 4 && front.length === 1) {
          const rear = ringEdges[(front[0].edgeIndex + 2) % 4];
          rear.role = "후면"; rear.setbackM = LEGAL_MAX_BOUNDARY_SETBACK.rear;
        }
        edges.push(...ringEdges);
      });
    });
    check();
    const edgeSetbacksByPolygon = local.map(part => [part.outer, ...part.holes].map(ring => ring.map(() => 0.5)));
    for (const edge of edges) edgeSetbacksByPolygon[edge.polygonIndex][edge.ringIndex][edge.edgeIndex] = edge.setbackM;
    return { origin, edges, frontages: edges.filter(edge => edge.role === "전면"), edgeSetbacksByPolygon };
  } catch { return null; }
}

/** Legacy single-ring adapter. Complex parcels must use the component-aware contract. */
export function analyzeFrontage(boundary: [number, number][], roads: Road[]): FrontageInfo | null {
  if (!roads?.length) return null;
  const result = analyzeParcelFrontage([{ outer: boundary, holes: [] }], roads);
  if (!result) return null;
  const primary = result.frontages.reduce<ParcelFrontageEdge | null>((best, edge) =>
    !best || edge.roadDistM < best.roadDistM ? edge : best, null);
  return {
    edges: result.edges.map(({ index, lengthM, roadDistM, role, setbackM }) => ({ index, lengthM, roadDistM, role, setbackM })),
    frontIndex: primary?.edgeIndex ?? -1,
    rearIndex: result.edges.find(edge => edge.role === "후면")?.edgeIndex ?? -1,
    roadName: primary?.roadName ?? null,
    frontDistM: primary?.roadDistM ?? Math.min(...result.edges.map(edge => edge.roadDistM)),
  };
}

export function edgeSetbacksFromFrontage(info: FrontageInfo | null, setback: BoundarySetbackSpec, minLegalM = 0.5): number[] | undefined {
  if (!info?.edges.length) return undefined;
  return info.edges.map(edge => Math.max(edge.role === "전면" ? 0 : minLegalM,
    edge.role === "전면" ? setback.road : edge.role === "후면" ? setback.rear : setback.side));
}

export function legalEdgeSetbacksFromFrontage(info: FrontageInfo | null): number[] | undefined {
  return edgeSetbacksFromFrontage(info, LEGAL_MAX_BOUNDARY_SETBACK);
}
