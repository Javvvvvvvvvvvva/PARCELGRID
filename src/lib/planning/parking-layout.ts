import {
  createPlanningGeometryBudget,
  polygonAreaSqm,
  polygonCentroid,
  type LocalPlanPoint,
} from "@/lib/planning/planning-massing";
import type {
  ParkingOrientation,
  ParkingStrategy,
  PlanningParking,
} from "@/lib/planning/types";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import {
  localParcelArea, localParcelCoveredArea, localParcelIntersectionArea, openParcelRing, validateLocalParcelTopology,
} from "@/lib/geo/parcel-topology-geometry";
import { GEOMETRY_EPS, planContains, planIntersectionArea, planRectangle } from "./layout-geometry";

const EPSILON = 1e-7;

export interface ParkingStallLayout {
  id: string;
  corners: LocalPlanPoint[];
  center: LocalPlanPoint;
  widthM: number;
  depthM: number;
  angleDeg: number;
  source: "surface" | "piloti";
  componentId?: string;
  polygonIndex?: number;
}

export interface ParkingFrontage {
  polygonIndex: number;
  ringIndex: number;
  edgeIndex: number;
  edge: [LocalPlanPoint, LocalPlanPoint];
}

export interface ParkingLayoutInput {
  strategy: ParkingStrategy;
  parcelShape?: LocalPlanPoint[];
  /** Authoritative when supplied, including empty or invalid topology. */
  parcelPolygons?: LocalParcelPolygon[];
  frontages?: ParkingFrontage[];
  buildingShape?: LocalPlanPoint[];
  pilotiShape?: LocalPlanPoint[];
  pilotiEnabled?: boolean;
  requiredCars: number;
  frontEdge?: [LocalPlanPoint, LocalPlanPoint] | null;
  parking: PlanningParking;
}

export interface ParkingLayoutResult {
  generationStatus: "complete" | "invalid-input" | "budget-exhausted";
  approvalStatus: "unverified";
  /** Singular geometry fields are populated only for one layout component. */
  components: ParkingComponentLayout[];
  supportedStrategy: boolean;
  source: "none" | "surface" | "piloti" | "mixed";
  requiredCars: number;
  capacityCars: number;
  shortfallCars: number;
  rawCandidateCars: number;
  usableAreaSqm: number;
  targetShape: LocalPlanPoint[];
  exclusionShape: LocalPlanPoint[];
  stalls: ParkingStallLayout[];
  aisleShape: LocalPlanPoint[];
  coreShape: LocalPlanPoint[];
  columns: LocalPlanPoint[];
  orientationDeg: number;
  accessMode: "none" | "internal-aisle" | "direct-frontage" | "mixed";
  targetDepthM: number;
  requiredDepthM: number;
  entryPath: LocalPlanPoint[];
  accessDistanceM: number;
  warnings: string[];
}

export interface ParkingComponentLayout extends Omit<ParkingLayoutResult, "components"> {
  id: string;
  polygonIndex: number;
  parcelPolygon: LocalParcelPolygon;
  frontage: ParkingFrontage | null;
  accessStatus: "candidate" | "missing" | "no-fit";
  entryPaths: Array<{ stallId?: string; points: LocalPlanPoint[] }>;
  obstacles: Array<{ id: string; shape: LocalPlanPoint[] }>;
}

interface LayoutContext {
  polygon: LocalParcelPolygon;
  checkBudget: () => void;
  strictAccess: boolean;
  additionalExclusions: LocalPlanPoint[][];
  entryPaths: Map<CandidateLayout, ParkingComponentLayout["entryPaths"]>;
  selectedEntryPaths: ParkingComponentLayout["entryPaths"];
  geometry: WeakMap<LocalPlanPoint[], PreparedShape>;
}

interface PreparedShape {
  points: LocalPlanPoint[];
  edges: Array<{ start: LocalPlanPoint; dx: number; dz: number }>;
  winding: number;
  convex: boolean;
  area: number;
  snappedArea: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface ParkingConfig {
  orientation: ParkingOrientation;
  stallWidthM: number;
  stallDepthM: number;
  aisleWidthM: number;
  entryWidthM: number;
  coreAreaSqm: number;
  columnLossPct: number;
}

interface OrientedPoint {
  u: number;
  v: number;
}

interface CandidateLayout {
  stalls: ParkingStallLayout[];
  aisleShape: LocalPlanPoint[];
  rawCandidateCars: number;
  capacityCars: number;
  angleDeg: number;
  accessMode: "internal-aisle" | "direct-frontage";
  targetDepthM: number;
  requiredDepthM: number;
  entryPath: LocalPlanPoint[];
  accessDistanceM: number;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function configFromParking(parking: PlanningParking): ParkingConfig {
  return {
    orientation: parking.orientation ?? "auto",
    stallWidthM: finitePositive(parking.stallWidthM, 2.5),
    stallDepthM: finitePositive(parking.stallDepthM, 5),
    aisleWidthM: finitePositive(parking.aisleWidthM, 6),
    entryWidthM: finitePositive(parking.entryWidthM, 3),
    coreAreaSqm: Math.max(0, parking.coreAreaSqm ?? 10),
    columnLossPct: clamp(parking.columnLossPct ?? 8, 0, 45),
  };
}

function pointOnSegment(
  point: LocalPlanPoint,
  start: LocalPlanPoint,
  end: LocalPlanPoint
): boolean {
  const cross =
    (point.z - start.z) * (end.x - start.x) -
    (point.x - start.x) * (end.z - start.z);
  if (Math.abs(cross) > EPSILON) return false;
  const dot =
    (point.x - start.x) * (end.x - start.x) +
    (point.z - start.z) * (end.z - start.z);
  if (dot < -EPSILON) return false;
  const lengthSquared =
    (end.x - start.x) ** 2 + (end.z - start.z) ** 2;
  return dot <= lengthSquared + EPSILON;
}

function pointInPolygon(point: LocalPlanPoint, polygon: LocalPlanPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const current = polygon[index];
    const before = polygon[previous];
    if (pointOnSegment(point, before, current)) return true;
    const intersects =
      current.z > point.z !== before.z > point.z &&
      point.x <
        ((before.x - current.x) * (point.z - current.z)) /
          (before.z - current.z) +
          current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function preparedShape(shape: LocalPlanPoint[], context: LayoutContext): PreparedShape {
  const cached = context.geometry.get(shape);
  if (cached) return cached;
  // Use the same precision as Turf clipping. The cache lives for one calculation only.
  const points = openParcelRing(shape).map(p => ({ x: Math.round(p.x * 1e8) / 1e8, z: Math.round(p.z * 1e8) / 1e8 }));
  const edges = points.map((start, i) => ({ start, dx: points[(i + 1) % points.length].x - start.x,
    dz: points[(i + 1) % points.length].z - start.z }));
  let winding = 0;
  // Sources are validated first and generated rectangles are simple. Strict equal-sign turns prove convexity.
  // Collinear or numerically ambiguous turns fall back to Turf, including very shallow concavities.
  const convex = edges.length >= 3 && edges.every((edge, i) => {
    const next = edges[(i + 1) % edges.length], a = edge.dx * next.dz, b = edge.dz * next.dx;
    const turn = a - b, roundoff = 16 * Number.EPSILON * (Math.abs(a) + Math.abs(b));
    if (!Number.isFinite(turn) || Math.abs(turn) <= roundoff) return false;
    if (!winding) winding = Math.sign(turn);
    return Math.sign(turn) === winding;
  });
  const prepared = { points, edges, winding, convex, area: polygonAreaSqm(shape), snappedArea: polygonAreaSqm(points),
    minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z)) };
  context.geometry.set(shape, prepared);
  return prepared;
}

/** A convex polygon is the intersection of its inward half-planes, so vertices prove full containment. */
function convexContains(outer: PreparedShape, inner: PreparedShape): boolean {
  return outer.convex && inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
    inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ && inner.points.every(point => outer.edges.every(edge =>
      outer.winding * (edge.dx * (point.z - edge.start.z) - edge.dz * (point.x - edge.start.x)) >= 0));
}

function polygonInside(inner: LocalPlanPoint[], outer: LocalPlanPoint[], context: LayoutContext): boolean {
  context.checkBudget();
  const subject = preparedShape(inner, context), area = subject.area;
  const parcel = preparedShape(context.polygon.outer, context);
  const fastRegion = context.polygon.holes.length === 0 && Math.abs(area - subject.snappedArea) <= 1e-6 && convexContains(parcel, subject);
  const inRegion = area > GEOMETRY_EPS && (fastRegion || Math.abs(area -
    localParcelIntersectionArea([{ outer: inner, holes: [] }], [context.polygon])) <= 1e-6);
  const contained = inRegion && (outer === context.polygon.outer ||
    (Math.abs(area - subject.snappedArea) <= Math.max(GEOMETRY_EPS, area * 1e-7) && convexContains(preparedShape(outer, context), subject)) ||
    planContains(outer, inner)) && context.additionalExclusions.every(shape => !shapesOverlap(shape, inner, context));
  context.checkBudget();
  return contained;
}

/** Frontages may be subsegments, but must belong to the indexed outer edge. */
export function parkingFrontageMatchesPolygon(frontage: ParkingFrontage, polygons: LocalParcelPolygon[]): boolean {
  if (!frontage || !Number.isInteger(frontage.polygonIndex) || !Number.isInteger(frontage.edgeIndex) ||
      frontage.ringIndex !== 0 || !Array.isArray(frontage.edge) || frontage.edge.length !== 2 ||
      frontage.edge.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.z))) return false;
  const part = polygons[frontage.polygonIndex];
  if (!part) return false;
  const ring = openParcelRing(part.outer), index = frontage.edgeIndex;
  return index >= 0 && index < ring.length && Math.hypot(frontage.edge[1].x - frontage.edge[0].x,
    frontage.edge[1].z - frontage.edge[0].z) > EPSILON &&
    frontage.edge.every(p => pointOnSegment(p, ring[index], ring[(index + 1) % ring.length]));
}

function edgeInwardNormal(shape: LocalPlanPoint[], edge: [LocalPlanPoint, LocalPlanPoint]): LocalPlanPoint | null {
  const ring = openParcelRing(shape);
  const index = ring.findIndex((p, i) => edge.every(point => pointOnSegment(point, p, ring[(i + 1) % ring.length])));
  if (index < 0) return null;
  const origin = ring[0];
  const signedArea = ring.reduce((sum, p, i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + (p.x - origin.x) * (next.z - origin.z) - (next.x - origin.x) * (p.z - origin.z);
  }, 0);
  const dx = edge[1].x - edge[0].x, dz = edge[1].z - edge[0].z, length = Math.hypot(dx, dz);
  const a = ring[index], b = ring[(index + 1) % ring.length];
  const side = Math.sign(signedArea) * Math.sign(dx * (b.x - a.x) + dz * (b.z - a.z));
  return length > EPSILON && side ? { x: -dz / length * side, z: dx / length * side } : null;
}

/** Ring winding plus the actual edge order determines the interior, even for concave parcels. */
export function parkingFrontageInwardNormal(frontage: ParkingFrontage, polygons: LocalParcelPolygon[]): LocalPlanPoint | null {
  return parkingFrontageMatchesPolygon(frontage, polygons) ? edgeInwardNormal(polygons[frontage.polygonIndex].outer, frontage.edge) : null;
}

function shapesOverlap(a: LocalPlanPoint[], b: LocalPlanPoint[], context: LayoutContext): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const first = preparedShape(a, context), second = preparedShape(b, context);
  if (first.maxX <= second.minX || second.maxX <= first.minX || first.maxZ <= second.minZ || second.maxZ <= first.minZ) return false;
  if ((second.snappedArea > 2 * EPSILON && convexContains(first, second)) ||
      (first.snappedArea > 2 * EPSILON && convexContains(second, first))) return true;
  return planIntersectionArea(a, b) > EPSILON;
}

function toOriented(point: LocalPlanPoint, angleDeg: number): OrientedPoint {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    u: point.x * cos + point.z * sin,
    v: -point.x * sin + point.z * cos,
  };
}

function fromOriented(point: OrientedPoint, angleDeg: number): LocalPlanPoint {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.u * cos - point.v * sin,
    z: point.u * sin + point.v * cos,
  };
}

function orientedBounds(shape: LocalPlanPoint[], angleDeg: number) {
  const points = shape.map((point) => toOriented(point, angleDeg));
  return {
    minU: Math.min(...points.map((point) => point.u)),
    maxU: Math.max(...points.map((point) => point.u)),
    minV: Math.min(...points.map((point) => point.v)),
    maxV: Math.max(...points.map((point) => point.v)),
  };
}

function rectangleInOrientedSpace(
  centerU: number,
  centerV: number,
  width: number,
  depth: number,
  angleDeg: number
): LocalPlanPoint[] {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return [
    { u: centerU - halfWidth, v: centerV - halfDepth },
    { u: centerU + halfWidth, v: centerV - halfDepth },
    { u: centerU + halfWidth, v: centerV + halfDepth },
    { u: centerU - halfWidth, v: centerV + halfDepth },
  ].map((point) => fromOriented(point, angleDeg));
}

function longestEdgeAngle(shape: LocalPlanPoint[]): number {
  let longest = -1;
  let angle = 0;
  shape.forEach((point, index) => {
    const next = shape[(index + 1) % shape.length];
    const dx = next.x - point.x;
    const dz = next.z - point.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared > longest) {
      longest = lengthSquared;
      angle = (Math.atan2(dz, dx) * 180) / Math.PI;
    }
  });
  return angle;
}

function edgeAngle(edge?: [LocalPlanPoint, LocalPlanPoint] | null): number | null {
  if (!edge) return null;
  return (
    (Math.atan2(edge[1].z - edge[0].z, edge[1].x - edge[0].x) * 180) /
    Math.PI
  );
}

function coreRectangle(
  targetShape: LocalPlanPoint[],
  angleDeg: number,
  coreAreaSqm: number
): LocalPlanPoint[] {
  if (coreAreaSqm <= 0 || targetShape.length < 3) return [];
  const bounds = orientedBounds(targetShape, angleDeg);
  const targetWidth = Math.max(1, bounds.maxU - bounds.minU);
  const targetDepth = Math.max(1, bounds.maxV - bounds.minV);
  const width = Math.min(targetWidth * 0.38, Math.max(2, Math.sqrt(coreAreaSqm * 1.35)));
  const depth = Math.min(targetDepth * 0.45, coreAreaSqm / Math.max(width, 0.1));
  return rectangleInOrientedSpace(
    bounds.maxU - width / 2 - 0.25,
    bounds.maxV - depth / 2 - 0.25,
    width,
    depth,
    angleDeg
  );
}

function generateColumns(
  targetShape: LocalPlanPoint[],
  coreShape: LocalPlanPoint[],
  angleDeg: number,
  context: LayoutContext,
  widthM: number
): LocalPlanPoint[] {
  if (targetShape.length < 3) return [];
  const bounds = orientedBounds(targetShape, angleDeg);
  const columns: LocalPlanPoint[] = [];
  for (let u = bounds.minU + 2.5; u < bounds.maxU; u += 5) {
    for (let v = bounds.minV + 2.5; v < bounds.maxV; v += 5) {
      context.checkBudget();
      const point = fromOriented({ u, v }, angleDeg);
      if (
        polygonInside(planRectangle(point, widthM, widthM), targetShape, context) &&
        (coreShape.length < 3 || !pointInPolygon(point, coreShape))
      ) {
        columns.push(point);
      }
    }
  }
  return columns;
}

function candidateAngles(
  targetShape: LocalPlanPoint[],
  orientation: ParkingOrientation,
  frontEdge?: [LocalPlanPoint, LocalPlanPoint] | null
): number[] {
  const front = edgeAngle(frontEdge);
  const base = front ?? longestEdgeAngle(targetShape);
  if (orientation === "parallel-front") return [base];
  if (orientation === "perpendicular-front") return [base + 90];
  return [base, base + 90];
}

function generateCandidate(
  source: "surface" | "piloti",
  targetShape: LocalPlanPoint[],
  exclusionShape: LocalPlanPoint[],
  coreShape: LocalPlanPoint[],
  angleDeg: number,
  rows: 1 | 2,
  bandOffsetRatio: number,
  config: ParkingConfig,
  context: LayoutContext
): CandidateLayout | null {
  const bounds = orientedBounds(targetShape, angleDeg);
  const totalDepth =
    rows * config.stallDepthM + config.aisleWidthM;
  const availableDepth = bounds.maxV - bounds.minV;
  if (availableDepth + EPSILON < totalDepth) return null;
  const remaining = Math.max(0, availableDepth - totalDepth);
  const bandStart = bounds.minV + remaining * bandOffsetRatio;
  const rowCenters =
    rows === 1
      ? [bandStart + config.stallDepthM / 2]
      : [
          bandStart + config.stallDepthM / 2,
          bandStart +
            config.stallDepthM +
            config.aisleWidthM +
            config.stallDepthM / 2,
        ];
  const aisleCenterV =
    rows === 1
      ? bandStart + config.stallDepthM + config.aisleWidthM / 2
      : bandStart + config.stallDepthM + config.aisleWidthM / 2;
  const aisleShape = rectangleInOrientedSpace(
    (bounds.minU + bounds.maxU) / 2,
    aisleCenterV,
    Math.max(0.1, bounds.maxU - bounds.minU),
    config.aisleWidthM,
    angleDeg
  );
  if (!polygonInside(aisleShape, targetShape, context)) return null;
  if (exclusionShape.length >= 3 && shapesOverlap(aisleShape, exclusionShape, context)) {
    return null;
  }
  if (coreShape.length >= 3 && shapesOverlap(aisleShape, coreShape, context)) return null;

  const stalls: ParkingStallLayout[] = [];
  let index = 0;
  for (
    let centerU = bounds.minU + config.stallWidthM / 2;
    centerU <= bounds.maxU - config.stallWidthM / 2 + EPSILON;
    centerU += config.stallWidthM
  ) {
    context.checkBudget();
    rowCenters.forEach((centerV) => {
      const corners = rectangleInOrientedSpace(
        centerU,
        centerV,
        config.stallWidthM,
        config.stallDepthM,
        angleDeg
      );
      if (!polygonInside(corners, targetShape, context)) return;
      if (exclusionShape.length >= 3 && shapesOverlap(corners, exclusionShape, context)) {
        return;
      }
      if (coreShape.length >= 3 && shapesOverlap(corners, coreShape, context)) return;
      stalls.push({
        id: `${source}-${angleDeg.toFixed(1)}-${rows}-${index++}`,
        corners,
        center: polygonCentroid(corners),
        widthM: config.stallWidthM,
        depthM: config.stallDepthM,
        angleDeg,
        source,
      });
    });
  }

  const lossPct = source === "piloti" ? config.columnLossPct : 0;
  const capacityCars = Math.max(
    0,
    Math.round(stalls.length * (1 - lossPct / 100))
  );
  return {
    stalls: stalls.slice(0, capacityCars),
    aisleShape,
    rawCandidateCars: stalls.length,
    capacityCars,
    angleDeg,
    accessMode: "internal-aisle",
    targetDepthM: availableDepth,
    requiredDepthM: totalDepth,
    entryPath: [],
    accessDistanceM: 0,
  };
}

function closestParallelEdge(
  shape: LocalPlanPoint[],
  reference: [LocalPlanPoint, LocalPlanPoint],
  minimumLengthM: number
): [LocalPlanPoint, LocalPlanPoint] | null {
  const refDx = reference[1].x - reference[0].x;
  const refDz = reference[1].z - reference[0].z;
  const refLength = Math.hypot(refDx, refDz);
  if (shape.length < 2 || refLength < EPSILON) return null;
  const refMid = {
    x: (reference[0].x + reference[1].x) / 2,
    z: (reference[0].z + reference[1].z) / 2,
  };
  let best: {
    edge: [LocalPlanPoint, LocalPlanPoint];
    score: number;
  } | null = null;
  for (let index = 0; index < shape.length; index += 1) {
    const start = shape[index];
    const end = shape[(index + 1) % shape.length];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length + EPSILON < minimumLengthM) continue;
    const alignment = Math.abs((dx * refDx + dz * refDz) / (length * refLength));
    if (alignment < Math.cos((18 * Math.PI) / 180)) continue;
    const midpoint = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
    const distanceM = Math.hypot(midpoint.x - refMid.x, midpoint.z - refMid.z);
    const score = distanceM + (1 - alignment) * 20;
    if (!best || score < best.score) best = { edge: [start, end], score };
  }
  return best ? best.edge : null;
}

/**
 * 소형 필지의 전면 직접진입 주차.
 * 각 주차면이 전면도로에서 바로 진입하므로 별도 6m 내부 차로를 강제하지 않는다.
 * 보도·도로점용·교차로 이격은 후속 인허가 검토로 남긴다.
 */
function generateDirectFrontageCandidate(
  source: "surface" | "piloti",
  targetShape: LocalPlanPoint[],
  exclusionShape: LocalPlanPoint[],
  coreShape: LocalPlanPoint[],
  parkingEdge: [LocalPlanPoint, LocalPlanPoint],
  roadFrontEdge: [LocalPlanPoint, LocalPlanPoint],
  config: ParkingConfig,
  context: LayoutContext
): CandidateLayout | null {
  const [start, end] = parkingEdge;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const frontageLength = Math.hypot(dx, dz);
  const edgeMarginM = 0.3;
  if (frontageLength + EPSILON < config.stallWidthM + edgeMarginM * 2) {
    return null;
  }

  const tangent = { x: dx / frontageLength, z: dz / frontageLength };
  const inward = edgeInwardNormal(targetShape, parkingEdge);
  if (!inward) return null;

  const maxSlots = Math.floor(
    (frontageLength - edgeMarginM * 2 + EPSILON) / config.stallWidthM
  );
  const stalls: ParkingStallLayout[] = [];
  for (let index = 0; index < maxSlots; index += 1) {
    context.checkBudget();
    const offset = edgeMarginM + index * config.stallWidthM;
    const a = {
      x: start.x + tangent.x * offset,
      z: start.z + tangent.z * offset,
    };
    const b = {
      x: a.x + tangent.x * config.stallWidthM,
      z: a.z + tangent.z * config.stallWidthM,
    };
    const corners = [
      a,
      b,
      {
        x: b.x + inward.x * config.stallDepthM,
        z: b.z + inward.z * config.stallDepthM,
      },
      {
        x: a.x + inward.x * config.stallDepthM,
        z: a.z + inward.z * config.stallDepthM,
      },
    ];
    if (!polygonInside(corners, targetShape, context)) continue;
    if (exclusionShape.length >= 3 && shapesOverlap(corners, exclusionShape, context)) continue;
    if (coreShape.length >= 3 && shapesOverlap(corners, coreShape, context)) continue;
    stalls.push({
      id: `${source}-direct-${index}`,
      corners,
      center: polygonCentroid(corners),
      widthM: config.stallWidthM,
      depthM: config.stallDepthM,
      angleDeg: edgeAngle(parkingEdge) ?? 0,
      source,
    });
  }
  if (stalls.length === 0) return null;

  const lossPct = source === "piloti" ? config.columnLossPct : 0;
  const capacityCars = Math.max(
    0,
    Math.round(stalls.length * (1 - lossPct / 100))
  );
  const parkingMid = {
    x: (parkingEdge[0].x + parkingEdge[1].x) / 2,
    z: (parkingEdge[0].z + parkingEdge[1].z) / 2,
  };
  const roadMid = {
    x: (roadFrontEdge[0].x + roadFrontEdge[1].x) / 2,
    z: (roadFrontEdge[0].z + roadFrontEdge[1].z) / 2,
  };
  const accessDistanceM = Math.hypot(
    parkingMid.x - roadMid.x,
    parkingMid.z - roadMid.z
  );
  const angle = edgeAngle(parkingEdge) ?? 0;
  const bounds = orientedBounds(targetShape, angle);

  return {
    stalls: stalls.slice(0, capacityCars),
    aisleShape: [],
    rawCandidateCars: stalls.length,
    capacityCars,
    angleDeg: angle,
    accessMode: "direct-frontage",
    targetDepthM: Math.max(0, bounds.maxV - bounds.minV),
    requiredDepthM: config.stallDepthM,
    entryPath: accessDistanceM > 0.05 ? [roadMid, parkingMid] : [],
    accessDistanceM,
  };
}

function candidateIsBetter(
  candidate: CandidateLayout,
  current: CandidateLayout | null
): boolean {
  if (!current) return true;
  if (candidate.capacityCars !== current.capacityCars) {
    return candidate.capacityCars > current.capacityCars;
  }
  if (candidate.rawCandidateCars !== current.rawCandidateCars) {
    return candidate.rawCandidateCars > current.rawCandidateCars;
  }
  // 같은 대수라면 개별 출입구가 반복되는 직접진입형보다 내부 차로형을 우선한다.
  return (
    candidate.accessMode === "internal-aisle" &&
    current.accessMode === "direct-frontage"
  );
}

function projectToFrontage(point: LocalPlanPoint, edge: [LocalPlanPoint, LocalPlanPoint]): LocalPlanPoint {
  const dx = edge[1].x - edge[0].x, dz = edge[1].z - edge[0].z;
  const ratio = clamp(((point.x - edge[0].x) * dx + (point.z - edge[0].z) * dz) / (dx * dx + dz * dz), 0, 1);
  return { x: edge[0].x + dx * ratio, z: edge[0].z + dz * ratio };
}

function connectCandidate(
  candidate: CandidateLayout, input: ParkingLayoutInput, core: LocalPlanPoint[], exclusion: LocalPlanPoint[],
  config: ParkingConfig, context: LayoutContext
): boolean {
  const edge = input.frontEdge;
  if (!edge) return false;
  const obstacles = [core, exclusion].filter(shape => shape.length >= 3);
  const clear = (shape: LocalPlanPoint[]) => polygonInside(shape, context.polygon.outer, context) &&
    obstacles.every(obstacle => !shapesOverlap(shape, obstacle, context));
  const entries: ParkingComponentLayout["entryPaths"] = [];
  if (candidate.accessMode === "direct-frontage") {
    candidate.stalls = candidate.stalls.filter(stall => {
      context.checkBudget();
      const [a, b] = stall.corners, roadA = projectToFrontage(a, edge), roadB = projectToFrontage(b, edge);
      if (Math.hypot(roadB.x - roadA.x, roadB.z - roadA.z) < config.stallWidthM * Math.cos(18 * Math.PI / 180) - 1e-6) return false;
      const corridor = [roadA, roadB, b, a];
      if (polygonAreaSqm(corridor) > EPSILON && (!clear(corridor) || candidate.stalls.some(other =>
        other !== stall && shapesOverlap(corridor, other.corners, context)))) return false;
      entries.push({ stallId: stall.id, points: [
        { x: (roadA.x + roadB.x) / 2, z: (roadA.z + roadB.z) / 2 },
        { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
      ] });
      return true;
    });
    if (context.strictAccess) {
      // Several direct entries have no common path; retain their actual per-stall approaches instead.
      candidate.entryPath = entries.length === 1 ? entries[0].points : [];
      candidate.accessDistanceM = Math.max(0, ...entries.map(entry => Math.hypot(
        entry.points[1].x - entry.points[0].x, entry.points[1].z - entry.points[0].z)));
    }
  } else {
    const length = Math.hypot(edge[1].x - edge[0].x, edge[1].z - edge[0].z);
    const ratios = input.parking.entryOffsetRatio === undefined ? [0.5, 0.15, 0.85] : [input.parking.entryOffsetRatio];
    let best: { stalls: ParkingStallLayout[]; points: LocalPlanPoint[]; distance: number } | null = null;
    for (const ratio of ratios) {
      context.checkBudget();
      if (length * Math.min(ratio, 1 - ratio) < config.entryWidthM / 2 - EPSILON) continue;
      const gate = { x: edge[0].x + (edge[1].x - edge[0].x) * ratio, z: edge[0].z + (edge[1].z - edge[0].z) * ratio };
      const bounds = orientedBounds(candidate.aisleShape, candidate.angleDeg), start = toOriented(gate, candidate.angleDeg);
      const aisleV = (bounds.minV + bounds.maxV) / 2;
      const end = fromOriented({ u: clamp(start.u, bounds.minU + config.entryWidthM / 2, bounds.maxU - config.entryWidthM / 2), v: aisleV }, candidate.angleDeg);
      const side = fromOriented({ u: start.u, v: aisleV }, candidate.angleDeg);
      const points = Math.hypot(side.x - end.x, side.z - end.z) > EPSILON ? [gate, side, end] : [gate, end];
      let distance = 0;
      const corridors = points.slice(1).flatMap((b, i) => {
        const a = points[i], segmentLength = Math.hypot(b.x - a.x, b.z - a.z);
        distance += segmentLength;
        return segmentLength > EPSILON ? [planRectangle({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, segmentLength,
          config.entryWidthM, Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI)] : [];
      });
      if (points.length === 3) corridors.push(planRectangle(side, config.entryWidthM, config.entryWidthM, candidate.angleDeg));
      if (!corridors.every(clear)) continue;
      // Legacy single-ring counts remain heuristic; explicit topology reserves the full approach width.
      const stalls = context.strictAccess ? candidate.stalls.filter(stall => corridors.every(corridor => !shapesOverlap(stall.corners, corridor, context))) : candidate.stalls;
      if (!best || stalls.length > best.stalls.length) best = { stalls, points, distance };
    }
    if (!best) return false;
    candidate.stalls = best.stalls;
    candidate.entryPath = best.points;
    candidate.accessDistanceM = best.distance;
    entries.push({ points: candidate.entryPath });
  }
  candidate.capacityCars = candidate.stalls.length;
  context.entryPaths.set(candidate, entries);
  return candidate.capacityCars > 0;
}

function emptyResult(
  input: ParkingLayoutInput,
  source: ParkingLayoutResult["source"],
  warnings: string[]
): ParkingLayoutResult {
  const requiredCars = Number.isFinite(input.requiredCars) ? Math.max(0, Math.ceil(input.requiredCars)) : 0;
  return {
    generationStatus: "complete",
    approvalStatus: "unverified",
    components: [],
    supportedStrategy: false,
    source,
    requiredCars,
    capacityCars: 0,
    shortfallCars: requiredCars,
    rawCandidateCars: 0,
    usableAreaSqm: 0,
    targetShape: [],
    exclusionShape: [],
    stalls: [],
    aisleShape: [],
    coreShape: [],
    columns: [],
    orientationDeg: 0,
    accessMode: "none",
    targetDepthM: 0,
    requiredDepthM: 0,
    entryPath: [],
    accessDistanceM: 0,
    warnings,
  };
}

function calculateSingleLayout(
  input: ParkingLayoutInput,
  source: "surface" | "piloti",
  context: LayoutContext
): ParkingLayoutResult {
  const config = configFromParking(input.parking);
  const targetShape =
    source === "piloti" ? input.pilotiShape ?? [] : context.polygon.outer;
  const exclusionShape =
    source === "surface" ? input.buildingShape ?? [] : [];
  const warnings: string[] = [];
  const usableArea = (core: LocalPlanPoint[] = []) => {
    context.checkBudget();
    const exclusions = [exclusionShape, ...context.additionalExclusions, core].filter(shape => shape.length >= 3);
    return Math.max(0, localParcelIntersectionArea([{ outer: targetShape, holes: [] }], [context.polygon]) -
      localParcelCoveredArea([context.polygon], exclusions.map(outer => [{ outer, holes: [] }])));
  };

  if (source === "piloti" && !input.pilotiEnabled) {
    return emptyResult(input, source, [
      "1층 프로그램에 필로티 또는 주차 구역이 없어 필로티 주차를 배치할 수 없습니다.",
    ]);
  }
  if (targetShape.length < 3 || polygonAreaSqm(targetShape) <= 0) {
    return emptyResult(input, source, [
      source === "piloti"
        ? "필로티 외곽선이 없어 주차면을 배치할 수 없습니다."
        : "대지 경계가 없어 지상 주차면을 배치할 수 없습니다.",
    ]);
  }

  const angles = candidateAngles(
    targetShape,
    config.orientation,
    input.frontEdge
  );
  let best: CandidateLayout | null = null;
  let bestCore: LocalPlanPoint[] = [];

  for (const angle of angles) {
    context.checkBudget();
    const coreShape =
      source === "piloti"
        ? coreRectangle(targetShape, angle, config.coreAreaSqm)
        : [];
    if (coreShape.length && !polygonInside(coreShape, targetShape, context)) continue;
    for (const rows of [1, 2] as const) {
      for (let offsetIndex = 0; offsetIndex <= 6; offsetIndex += 1) {
        const candidate = generateCandidate(
          source,
          targetShape,
          exclusionShape,
          coreShape,
          angle,
          rows,
          offsetIndex / 6,
          config,
          context
        );
        if (candidate && connectCandidate(candidate, input, coreShape, exclusionShape, config, context) && candidateIsBetter(candidate, best)) {
          best = candidate;
          bestCore = coreShape;
        }
      }
    }
  }

  if (
    input.frontEdge &&
    (config.orientation === "auto" || config.orientation === "parallel-front")
  ) {
    const parkingEdge =
      source === "surface"
        ? input.frontEdge
        : closestParallelEdge(
            targetShape,
            input.frontEdge,
            config.stallWidthM + 0.6
          );
    const directAngle = parkingEdge ? edgeAngle(parkingEdge) ?? 0 : 0;
    const directCore =
      source === "piloti" && parkingEdge
        ? coreRectangle(targetShape, directAngle, config.coreAreaSqm)
        : [];
    const direct = directCore.length && !polygonInside(directCore, targetShape, context) ? null : generateDirectFrontageCandidate(
      source,
      targetShape,
      exclusionShape,
      directCore,
      parkingEdge ?? input.frontEdge,
      input.frontEdge,
      config,
      context
    );
    if (direct && connectCandidate(direct, input, directCore, exclusionShape, config, context) && candidateIsBetter(direct, best)) {
      best = direct;
      bestCore = directCore;
    }
  }

  if (!best) {
    const angle = angles[0] ?? longestEdgeAngle(targetShape);
    const bounds = orientedBounds(targetShape, angle);
    const targetDepthM = Math.max(0, bounds.maxV - bounds.minV);
    const usableAreaSqm = usableArea();
    return {
      ...emptyResult(input, source, [
        source === "surface"
          ? `전면 직접진입에 필요한 깊이 ${config.stallDepthM.toFixed(1)}m 또는 내부 차로형 모듈 ${(config.stallDepthM + config.aisleWidthM).toFixed(1)}m를 건물 제외 영역에 확보하지 못했습니다.`
          : `필로티 전면 단열 주차에 필요한 깊이 ${config.stallDepthM.toFixed(1)}m 또는 내부 차로형 모듈 ${(config.stallDepthM + config.aisleWidthM).toFixed(1)}m를 확보하지 못했습니다.`,
      ]),
      supportedStrategy: true,
      targetShape,
      exclusionShape,
      usableAreaSqm,
      targetDepthM,
      requiredDepthM:
        source === "surface"
          ? config.stallDepthM
          : input.frontEdge
            ? config.stallDepthM
            : config.stallDepthM + config.aisleWidthM,
    };
  }

  const frontLength = input.frontEdge
    ? Math.hypot(
        input.frontEdge[1].x - input.frontEdge[0].x,
        input.frontEdge[1].z - input.frontEdge[0].z
      )
    : null;
  if (frontLength != null && frontLength < config.entryWidthM) {
    warnings.push(
      `전면 경계 길이 ${frontLength.toFixed(1)}m가 입력한 진입 폭 ${config.entryWidthM.toFixed(1)}m보다 짧습니다.`
    );
  }
  if (source === "surface" && exclusionShape.length >= 3) {
    warnings.push("지상 주차는 건물 외곽선을 제외한 개략 배치이며 조경·보행로·소방 동선을 추가 확인해야 합니다.");
  }
  if (best.accessMode === "direct-frontage") {
    warnings.push(
      source === "piloti"
        ? "필로티 전면 단열 주차입니다. 전면 마당을 진입·조향 공간으로 사용하므로 보도 횡단·출입구 허가·기둥 간섭을 확인해야 합니다."
        : "소형 필지 전면 직접진입형입니다. 별도 내부 차로는 제외했으며 보도 횡단·출입구 허가·교차로 이격을 확인해야 합니다."
    );
  }
  if (source === "piloti") {
    warnings.push("필로티 기둥은 개략 그리드이며 실제 구조 스팬·코어·보행 동선에 따라 재배치해야 합니다.");
  }

  const columns =
    source === "piloti"
      ? generateColumns(targetShape, bestCore, best.angleDeg, context, finitePositive(input.parking.vehicleProfile?.columnWidthM, 0.4))
      : [];
  context.selectedEntryPaths = context.entryPaths.get(best) ?? [];
  const requiredCars = Math.max(0, Math.ceil(input.requiredCars));
  const usableAreaSqm = usableArea(bestCore);

  return {
    generationStatus: "complete",
    approvalStatus: "unverified",
    components: [],
    supportedStrategy: true,
    source,
    requiredCars,
    capacityCars: best.capacityCars,
    shortfallCars: Math.max(0, requiredCars - best.capacityCars),
    rawCandidateCars: best.rawCandidateCars,
    usableAreaSqm,
    targetShape,
    exclusionShape,
    stalls: best.stalls,
    aisleShape: best.aisleShape,
    coreShape: bestCore,
    columns,
    orientationDeg: best.angleDeg,
    accessMode: best.accessMode,
    targetDepthM: best.targetDepthM,
    requiredDepthM: best.requiredDepthM,
    entryPath: best.entryPath,
    accessDistanceM: best.accessDistanceM,
    warnings,
  };
}

export function calculateParkingLayout(
  input: ParkingLayoutInput
): ParkingLayoutResult {
  if (input.strategy === "none") {
    return emptyResult(input, "none", ["주차 계획 없음이 선택되어 있습니다."]);
  }
  if (!["surface", "piloti", "mixed"].includes(input.strategy)) return emptyResult(input, "none", [
    input.strategy === "basement" ? "지하주차 램프와 회차 배치는 후속 고급 검토 대상입니다." : "기계식 주차 제원과 장비 형식은 후속 고급 검토 대상입니다.",
  ]);
  const source = input.strategy as "surface" | "piloti" | "mixed";
  const checkBudget = createPlanningGeometryBudget();
  const invalid = (message: string) => ({ ...emptyResult(input, source, [message]), generationStatus: "invalid-input" as const });
  try {
    const polygons = input.parcelPolygons === undefined ? [{ outer: input.parcelShape ?? [], holes: [] }] : input.parcelPolygons;
    if (!validateLocalParcelTopology(polygons, checkBudget)) return invalid("대지 전체 경계·구멍 자료가 비어 있거나 올바르지 않습니다.");
    for (const shape of [input.buildingShape, input.pilotiShape]) {
      if (shape !== undefined && shape.length && !validateLocalParcelTopology([{ outer: shape, holes: [] }], checkBudget)) {
        return invalid("건물 또는 필로티 경계 자료가 올바르지 않습니다.");
      }
    }
    if (!Number.isFinite(input.requiredCars) || [input.parking.coreAreaSqm, input.parking.columnLossPct,
      input.parking.stallWidthM, input.parking.stallDepthM, input.parking.aisleWidthM, input.parking.entryWidthM,
      input.parking.entryOffsetRatio].some(value => value !== undefined && !Number.isFinite(value)) ||
      (input.parking.entryOffsetRatio !== undefined && (input.parking.entryOffsetRatio < 0 || input.parking.entryOffsetRatio > 1))) {
      return invalid("주차 치수·진입 위치 입력을 확인해야 합니다.");
    }
    let frontages = input.frontages;
    if (frontages === undefined) {
      frontages = [];
      // A legacy edge can identify a single target, never an arbitrary first component.
      if (polygons.length === 1 && input.frontEdge) {
        const ring = openParcelRing(polygons[0].outer);
        const edgeIndex = ring.findIndex((_, index) => parkingFrontageMatchesPolygon({
          polygonIndex: 0, ringIndex: 0, edgeIndex: index, edge: input.frontEdge!,
        }, polygons));
        if (edgeIndex >= 0) frontages.push({ polygonIndex: 0, ringIndex: 0, edgeIndex, edge: input.frontEdge });
      }
    }
    if (!Array.isArray(frontages) || frontages.length > 200 || frontages.some(frontage => {
      checkBudget();
      return !parkingFrontageMatchesPolygon(frontage, polygons);
    })) return invalid("도로 접면의 구성요소·외곽 링·변 참조가 현재 대지와 일치하지 않습니다.");

    const components: ParkingComponentLayout[] = [];
    const geometry = new WeakMap<LocalPlanPoint[], PreparedShape>();
    const sources = source === "mixed" ? ["piloti", "surface"] as const : [source];
    for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
      for (const componentSource of sources) {
        checkBudget();
        const polygon = polygons[polygonIndex], id = `parcel-${polygonIndex}-${componentSource}`;
        const ownedFrontages = frontages.filter(frontage => frontage.polygonIndex === polygonIndex);
        const additionalExclusions = componentSource === "surface" && source === "mixed" && input.pilotiShape?.length
          ? [input.pilotiShape] : [];
        let chosen: ParkingLayoutResult | null = null;
        let chosenFrontage: ParkingFrontage | null = null;
        let entryPaths: ParkingComponentLayout["entryPaths"] = [];
        for (const frontage of ownedFrontages) {
          const context: LayoutContext = { polygon, checkBudget, strictAccess: input.parcelPolygons !== undefined || input.frontages !== undefined,
            additionalExclusions, entryPaths: new Map(), selectedEntryPaths: [], geometry };
          const candidate = calculateSingleLayout({ ...input, frontEdge: frontage.edge }, componentSource, context);
          if (!chosen || candidate.capacityCars > chosen.capacityCars) {
            chosen = candidate; chosenFrontage = frontage; entryPaths = context.selectedEntryPaths;
          }
        }
        const layout = chosen ?? {
          ...emptyResult(input, componentSource, [componentSource === "piloti" && !input.pilotiEnabled
            ? "1층 프로그램에 필로티 또는 주차 구역이 없어 필로티 주차를 배치할 수 없습니다."
            : "이 대지 구성요소의 확인된 도로 접면이 없어 주차 대수를 산입하지 않습니다."]),
          supportedStrategy: componentSource === "surface" || Boolean(input.pilotiEnabled),
          targetShape: componentSource === "surface" ? polygon.outer : input.pilotiShape ?? [],
          exclusionShape: componentSource === "surface" ? input.buildingShape ?? [] : [],
          usableAreaSqm: componentSource === "surface" ? localParcelArea([polygon]) : 0,
        };
        const columnWidthM = finitePositive(input.parking.vehicleProfile?.columnWidthM, 0.4);
        const obstacles = [
          ...[layout.exclusionShape, ...additionalExclusions].filter(shape => shape.length >= 3).map((shape, i) => ({ id: `${id}-building-${i}`, shape })),
          ...(layout.coreShape.length ? [{ id: `${id}-core`, shape: layout.coreShape }] : []),
          ...layout.columns.map((center, i) => ({ id: `${id}-column-${i}`, shape: planRectangle(center, columnWidthM, columnWidthM) })),
        ];
        const { components: unusedComponents, ...layoutGeometry } = layout;
        void unusedComponents;
        components.push({ ...layoutGeometry, id, polygonIndex, parcelPolygon: polygon, frontage: chosenFrontage,
          accessStatus: layout.capacityCars > 0 ? "candidate" : ownedFrontages.length ? "no-fit" : "missing",
          stalls: layout.stalls.map(stall => ({ ...stall, id: `${id}-${stall.id}`, componentId: id, polygonIndex })),
          entryPaths: entryPaths.map(entry => ({ ...entry, stallId: entry.stallId ? `${id}-${entry.stallId}` : undefined })), obstacles });
      }
    }
    checkBudget();
    const capacityCars = components.reduce((sum, part) => sum + part.capacityCars, 0);
    const result = { ...emptyResult(input, source, components.flatMap(part => part.warnings)),
      supportedStrategy: components.some(part => part.supportedStrategy), components, capacityCars,
      shortfallCars: Math.max(0, Math.ceil(input.requiredCars) - capacityCars),
      rawCandidateCars: components.reduce((sum, part) => sum + part.rawCandidateCars, 0),
      usableAreaSqm: components.reduce((sum, part) => sum + part.usableAreaSqm, 0),
      stalls: components.flatMap(part => part.stalls),
    };
    // No singular aisle, path, core or orientation can represent several independent layouts.
    return components.length === 1 ? { ...components[0], components } : { ...result, accessMode: "mixed" };
  } catch (error) {
    return { ...emptyResult(input, source, ["대지 전체 주차 배치 검사를 완료하지 못했습니다. 검토 가능한 대수는 미확정입니다."]),
      generationStatus: error instanceof Error && error.name === "TimeoutError" ? "budget-exhausted" : "invalid-input" };
  }
}
