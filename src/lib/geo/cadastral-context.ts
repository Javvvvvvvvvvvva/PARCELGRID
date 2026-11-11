import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import { planningRingToLocalMeters } from "@/lib/planning/planning-geometry";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import { localParcelPolygons, sourceParcelPolygons, parcelRings, type Wgs84ParcelPolygon, type LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelArea, localParcelContainsPoint, localParcelIntersectionArea, validateLocalParcelTopology } from "@/lib/geo/parcel-topology-geometry";
import { parcelProjectionOrigin, projectParcelPolygons } from "@/lib/geo/parcel-envelope";

export const CADASTRAL_CONTEXT_VERSION = "cadastral-context-v3" as const;
export const CADASTRAL_ROAD_CONTACT_TOLERANCE_M = 0.75;
export const CADASTRAL_ROAD_NEAR_TOLERANCE_M = 2;
/** 접도 경계는 도로 경계와 10도 이내로 평행해야 한다. */
export const CADASTRAL_ROAD_MIN_ALIGNMENT = Math.cos((10 * Math.PI) / 180);

export type RoadBoundarySource =
  | "continuous-cadastral"
  | "upis-planned-road";

export interface CadastralParcelFeature {
  pnu: string;
  jibun: string;
  jimok: string;
  jimokCode: string;
  lotAreaSqm: number;
  boundary: [number, number][];
  /** Authoritative topology; legacy boundary is populated only for a single ring. */
  polygons?: Wgs84ParcelPolygon[];
  distanceM: number;
  /** 생략된 과거·테스트 데이터는 연속지적도로 취급한다. */
  boundarySource?: RoadBoundarySource;
}

export interface LocalCadastralParcel {
  pnu: string;
  jibun: string;
  jimok: string;
  jimokCode: string;
  officialAreaSqm: number;
  measuredAreaSqm: number;
  distanceM: number;
  polygon: LocalPlanPoint[];
  /** All components and holes; legacy polygon is empty for complex topology. */
  polygons?: LocalParcelPolygon[];
  /** 하위 호환용 데이터셋 표기. 실제 경계 역할은 boundarySource가 기준이다. */
  source: "VWorld LP_PA_CBND_BUBUN";
  boundarySource?: RoadBoundarySource;
}

export interface CadastralRoadWidthSample {
  positionRatio: number;
  gapM: number;
  widthM: number;
  from: LocalPlanPoint;
  to: LocalPlanPoint;
}

export interface CadastralRoadFrontage {
  roadParcelPnu: string;
  roadParcelJibun: string;
  targetEdgeIndex: number;
  /** Zero-based snapshot identities; ring 0 is outer, rings 1+ are holes. */
  targetPolygonIndex?: number;
  targetRingIndex?: number;
  roadPolygonIndex?: number;
  roadRingIndex?: number;
  roadEdgeIndex?: number;
  frontage: [LocalPlanPoint, LocalPlanPoint];
  frontageLengthM: number;
  boundaryGapM: number;
  alignmentPct: number;
  widthSamples: CadastralRoadWidthSample[];
  widthMinM: number | null;
  widthAvgM: number | null;
  widthMaxM: number | null;
  /** UPIS 계획도로 폴리곤의 기하 단면폭. 현재·법정 도로폭으로 승격하지 않는다. */
  plannedWidthMinM: number | null;
  plannedWidthAvgM: number | null;
  plannedWidthMaxM: number | null;
  status:
    | "verified-cadastral-width"
    | "frontage-only"
    | "nearby-road-parcel"
    | "planned-road-reference";
  source:
    | "VWorld continuous cadastral road parcel"
    | "VWorld UPIS planned road boundary";
}

export interface RoadClearanceAssessment {
  roadParcelPnu: string;
  boundarySource: RoadBoundarySource;
  minimumClearanceM: number;
  intrusionAreaSqm: number;
  intrudes: boolean;
  floorLevel: number | null;
  buildingPoint: LocalPlanPoint | null;
  roadPoint: LocalPlanPoint | null;
  status: "pass" | "fail";
}

export interface CadastralContextIssue {
  code: string;
  severity: "review" | "fail";
  message: string;
  parcelPnu?: string;
}

export interface CadastralContextSnapshot {
  version: typeof CADASTRAL_CONTEXT_VERSION;
  projectId: string;
  generatedAt: string;
  cadastralHash: string;
  coordinateSystem: PlanningGeometrySnapshot["coordinateSystem"];
  targetParcel: {
    pnu: string;
    polygon: LocalPlanPoint[];
    /** Authoritative full region; polygon is empty for complex topology. */
    polygons?: LocalParcelPolygon[];
    measuredAreaSqm?: number;
  };
  adjacentParcels: LocalCadastralParcel[];
  roadParcels: LocalCadastralParcel[];
  frontages: CadastralRoadFrontage[];
  roadClearances: RoadClearanceAssessment[];
  summary: {
    adjacentParcelCount: number;
    roadParcelCount: number;
    verifiedWidthFrontageCount: number;
    primaryWidthMinM: number | null;
    primaryWidthAvgM: number | null;
    primaryWidthMaxM: number | null;
    primaryPlannedWidthMinM: number | null;
    primaryPlannedWidthAvgM: number | null;
    primaryPlannedWidthMaxM: number | null;
    primaryMassRoadClearanceM: number | null;
    roadIntrusionCount: number;
  };
  validation: {
    status: "pass" | "review" | "fail";
    usable: boolean;
    issues: CadastralContextIssue[];
  };
  sourceNotes: string[];
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `CAD-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function openRing(points: LocalPlanPoint[]): LocalPlanPoint[] {
  if (points.length <= 1) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.z === last.z ? points.slice(0, -1) : points;
}

export function cadastralTargetTopologyScope(target: CadastralContextSnapshot["targetParcel"]): "single-ring" | "all-components-and-holes" {
  const polygons = localParcelPolygons(target);
  return polygons.length === 1 && polygons[0].holes.length === 0 ? "single-ring" : "all-components-and-holes";
}

/** Complex target order binds component/ring/edge identities; legacy rings allow equivalent winding. */
export function cadastralTargetPolygonsMatch(
  first: LocalParcelPolygon[], second: LocalParcelPolygon[], checkDeadline: () => void,
): boolean {
  if (first.length !== second.length || first.length === 0) return false;
  const simple = first.length === 1 && first[0].holes.length === 0 && second[0].holes.length === 0;
  const pointMatches = (a: LocalPlanPoint, b: LocalPlanPoint) =>
    Math.abs(a.x - b.x) <= 1e-6 && Math.abs(a.z - b.z) <= 1e-6;
  const ringsMatch = (firstRing: LocalPlanPoint[], secondRing: LocalPlanPoint[]) => {
    checkDeadline();
    const a = openRing(firstRing), b = openRing(secondRing);
    if (a.length !== b.length || a.length < 3) return false;
    if (!simple) return a.every((point, index) => pointMatches(point, b[index]));
    return b.some((point, start) => pointMatches(a[0], point) && [1, -1].some(direction =>
      a.every((value, index) => pointMatches(value, b[(start + direction * index + b.length) % b.length]))));
  };
  return first.every((part, index) => ringsMatch(part.outer, second[index].outer)
    && part.holes.length === second[index].holes.length
    && part.holes.every((ring, ringIndex) => ringsMatch(ring, second[index].holes[ringIndex])));
}

export function validateCadastralTarget(
  target: { polygon: LocalPlanPoint[]; polygons?: LocalParcelPolygon[] }, checkDeadline: () => void,
): boolean {
  const polygons = localParcelPolygons(target);
  if (!validateLocalParcelTopology(polygons, checkDeadline)) return false;
  if (target.polygons === undefined) return true;
  if (polygons.length !== 1 || polygons[0].holes.length > 0) return target.polygon.length === 0;
  return cadastralTargetPolygonsMatch(polygons, [{ outer: target.polygon, holes: [] }], checkDeadline);
}

export function cadastralFrontageIdentity(frontage: CadastralRoadFrontage) {
  return {
    roadParcelPnu: frontage.roadParcelPnu,
    targetPolygonIndex: frontage.targetPolygonIndex,
    targetRingIndex: frontage.targetRingIndex,
    targetEdgeIndex: frontage.targetEdgeIndex,
    roadPolygonIndex: frontage.roadPolygonIndex,
    roadRingIndex: frontage.roadRingIndex,
    roadEdgeIndex: frontage.roadEdgeIndex,
  };
}

export function validateCadastralFrontageIdentities(snapshot: CadastralContextSnapshot, checkDeadline: () => void): boolean {
  const targets = localParcelPolygons(snapshot.targetParcel);
  return snapshot.frontages.every(frontage => {
    checkDeadline();
    const road = snapshot.roadParcels.find(parcel => parcel.pnu === frontage.roadParcelPnu);
    if (!road) return false;
    const roads = localParcelPolygons(road);
    const indexes = [frontage.targetPolygonIndex, frontage.targetRingIndex, frontage.roadPolygonIndex, frontage.roadRingIndex, frontage.roadEdgeIndex];
    // Old single-ring snapshots did not carry component identities.
    if (indexes.every(index => index === undefined)) return targets.length === 1 && targets[0].holes.length === 0;
    if (![...indexes, frontage.targetEdgeIndex].every(index => Number.isInteger(index) && index! >= 0)) return false;
    const target = targets[frontage.targetPolygonIndex!], roadPart = roads[frontage.roadPolygonIndex!];
    if (!target || !roadPart) return false;
    const targetRing = [target.outer, ...target.holes][frontage.targetRingIndex!];
    const roadRing = [roadPart.outer, ...roadPart.holes][frontage.roadRingIndex!];
    if (!targetRing || !roadRing) return false;
    const ring = openRing(targetRing);
    if (frontage.targetEdgeIndex >= ring.length || frontage.roadEdgeIndex! >= openRing(roadRing).length) return false;
    const candidate = findFrontageCandidate(targetRing, roadRing, checkDeadline);
    if (!candidate || candidate.targetEdgeIndex !== frontage.targetEdgeIndex || candidate.roadEdgeIndex !== frontage.roadEdgeIndex) return false;
    return frontage.frontage.length === 2 && frontage.frontage.every((point, index) => {
      const expected = ring[(frontage.targetEdgeIndex + index) % ring.length];
      return Math.abs(point.x - expected.x) <= 1e-6 && Math.abs(point.z - expected.z) <= 1e-6;
    });
  });
}

function canonicalPoint(point: LocalPlanPoint): [number, number] {
  return [round(point.x), round(point.z)];
}

function distance(a: LocalPlanPoint, b: LocalPlanPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function dot(a: LocalPlanPoint, b: LocalPlanPoint): number {
  return a.x * b.x + a.z * b.z;
}

function cross(a: LocalPlanPoint, b: LocalPlanPoint): number {
  return a.x * b.z - a.z * b.x;
}

function subtract(a: LocalPlanPoint, b: LocalPlanPoint): LocalPlanPoint {
  return { x: a.x - b.x, z: a.z - b.z };
}

function add(a: LocalPlanPoint, b: LocalPlanPoint): LocalPlanPoint {
  return { x: a.x + b.x, z: a.z + b.z };
}

function multiply(point: LocalPlanPoint, scalar: number): LocalPlanPoint {
  return { x: point.x * scalar, z: point.z * scalar };
}

function normalize(vector: LocalPlanPoint): LocalPlanPoint | null {
  const length = Math.hypot(vector.x, vector.z);
  if (length < 1e-9) return null;
  return { x: vector.x / length, z: vector.z / length };
}

function pointToSegmentDistance(
  point: LocalPlanPoint,
  start: LocalPlanPoint,
  end: LocalPlanPoint
): number {
  const segment = subtract(end, start);
  const lengthSq = dot(segment, segment);
  if (lengthSq < 1e-12) return distance(point, start);
  const t = Math.max(0, Math.min(1, dot(subtract(point, start), segment) / lengthSq));
  return distance(point, add(start, multiply(segment, t)));
}

function segmentDistance(
  a: LocalPlanPoint,
  b: LocalPlanPoint,
  c: LocalPlanPoint,
  d: LocalPlanPoint
): number {
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b)
  );
}

function closestPointOnSegment(
  point: LocalPlanPoint,
  start: LocalPlanPoint,
  end: LocalPlanPoint
): LocalPlanPoint {
  const segment = subtract(end, start);
  const lengthSq = dot(segment, segment);
  if (lengthSq < 1e-12) return start;
  const t = Math.max(0, Math.min(1, dot(subtract(point, start), segment) / lengthSq));
  return add(start, multiply(segment, t));
}

function segmentIntersectionPoint(
  a: LocalPlanPoint,
  b: LocalPlanPoint,
  c: LocalPlanPoint,
  d: LocalPlanPoint
): LocalPlanPoint | null {
  const ab = subtract(b, a);
  const cd = subtract(d, c);
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) < 1e-9) return null;
  const offset = subtract(c, a);
  const t = cross(offset, cd) / denominator;
  const u = cross(offset, ab) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return add(a, multiply(ab, Math.max(0, Math.min(1, t))));
}

function closestSegmentPoints(
  a: LocalPlanPoint,
  b: LocalPlanPoint,
  c: LocalPlanPoint,
  d: LocalPlanPoint
): { distanceM: number; first: LocalPlanPoint; second: LocalPlanPoint } {
  const intersectionPoint = segmentIntersectionPoint(a, b, c, d);
  if (intersectionPoint) {
    return { distanceM: 0, first: intersectionPoint, second: intersectionPoint };
  }
  const candidates = [
    { first: a, second: closestPointOnSegment(a, c, d) },
    { first: b, second: closestPointOnSegment(b, c, d) },
    { first: closestPointOnSegment(c, a, b), second: c },
    { first: closestPointOnSegment(d, a, b), second: d },
  ].map((candidate) => ({
    ...candidate,
    distanceM: distance(candidate.first, candidate.second),
  }));
  return candidates.reduce((best, candidate) =>
    candidate.distanceM < best.distanceM ? candidate : best
  );
}

function polygonClearance(
  firstPolygon: LocalPlanPoint[],
  secondPolygons: LocalParcelPolygon[],
  checkDeadline: () => void,
): { distanceM: number; first: LocalPlanPoint; second: LocalPlanPoint } | null {
  const first = openRing(firstPolygon);
  if (first.length < 3) return null;

  let best: { distanceM: number; first: LocalPlanPoint; second: LocalPlanPoint } | null =
    null;
  let comparisons = 0;
  for (const secondRing of parcelRings(secondPolygons)) {
    const second = openRing(secondRing);
    for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const a = first[firstIndex];
    const b = first[(firstIndex + 1) % first.length];
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      if (++comparisons % 1024 === 0) checkDeadline();
      const c = second[secondIndex];
      const d = second[(secondIndex + 1) % second.length];
      const candidate = closestSegmentPoints(a, b, c, d);
      if (!best || candidate.distanceM < best.distanceM) best = candidate;
      if (candidate.distanceM <= 1e-9) return candidate;
    }
    }
  }

  if (localParcelContainsPoint(secondPolygons, first[0])) {
    return { distanceM: 0, first: first[0], second: first[0] };
  }
  for (const part of secondPolygons) {
    if (pointInPolygon(part.outer[0], first)) return { distanceM: 0, first: part.outer[0], second: part.outer[0] };
  }
  return best;
}

function pointInPolygon(point: LocalPlanPoint, polygon: LocalPlanPoint[]): boolean {
  const ring = openRing(polygon);
  if (ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index];
    const before = ring[previous];
    const intersects =
      current.z > point.z !== before.z > point.z &&
      point.x <
        ((before.x - current.x) * (point.z - current.z)) /
          (before.z - current.z + Number.EPSILON) +
          current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function rayPolygonIntersections(
  origin: LocalPlanPoint,
  direction: LocalPlanPoint,
  polygon: LocalPlanPoint[]
): number[] {
  const ring = openRing(polygon);
  const hits: number[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const segment = subtract(b, a);
    const denominator = cross(direction, segment);
    if (Math.abs(denominator) < 1e-9) continue;
    const offset = subtract(a, origin);
    const t = cross(offset, segment) / denominator;
    const u = cross(offset, direction) / denominator;
    if (t >= -1e-7 && u >= -1e-7 && u <= 1 + 1e-7) {
      hits.push(Math.max(0, t));
    }
  }
  hits.sort((a, b) => a - b);
  return hits.filter((value, index) => index === 0 || Math.abs(value - hits[index - 1]) > 1e-5);
}

function roadIntervalAlongRay(
  origin: LocalPlanPoint,
  direction: LocalPlanPoint,
  polygons: LocalParcelPolygon[]
): { gapM: number; widthM: number; from: LocalPlanPoint; to: LocalPlanPoint } | null {
  const allHits = parcelRings(polygons).flatMap(ring => rayPolygonIntersections(origin, direction, ring)).sort((a, b) => a - b);
  const hits = allHits.filter((value, index) => index === 0 || Math.abs(value - allHits[index - 1]) > 1e-5);
  if (hits.length === 0) return null;
  const bounds = [0, ...hits];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const start = bounds[index];
    const end = bounds[index + 1];
    if (end - start < 1e-5) continue;
    const midpoint = add(origin, multiply(direction, (start + end) / 2));
    if (!localParcelContainsPoint(polygons, midpoint, true)) continue;
    const gapM = start;
    const widthM = end - start;
    return {
      gapM,
      widthM,
      from: add(origin, multiply(direction, start)),
      to: add(origin, multiply(direction, end)),
    };
  }
  return null;
}

interface FrontageCandidate {
  targetEdgeIndex: number;
  roadEdgeIndex: number;
  targetStart: LocalPlanPoint;
  targetEnd: LocalPlanPoint;
  gapM: number;
  alignment: number;
  overlapM: number;
  score: number;
}

function findFrontageCandidate(
  targetPolygon: LocalPlanPoint[],
  roadPolygon: LocalPlanPoint[],
  checkDeadline: () => void,
): FrontageCandidate | null {
  const target = openRing(targetPolygon);
  const road = openRing(roadPolygon);
  let best: FrontageCandidate | null = null;
  let comparisons = 0;

  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    const targetStart = target[targetIndex];
    const targetEnd = target[(targetIndex + 1) % target.length];
    const targetVector = subtract(targetEnd, targetStart);
    const targetUnit = normalize(targetVector);
    const targetLength = Math.hypot(targetVector.x, targetVector.z);
    if (!targetUnit || targetLength < 0.5) continue;

    for (let roadIndex = 0; roadIndex < road.length; roadIndex += 1) {
      if (++comparisons % 1024 === 0) checkDeadline();
      const roadStart = road[roadIndex];
      const roadEnd = road[(roadIndex + 1) % road.length];
      const roadVector = subtract(roadEnd, roadStart);
      const roadUnit = normalize(roadVector);
      if (!roadUnit) continue;
      const alignment = Math.abs(dot(targetUnit, roadUnit));
      if (alignment < CADASTRAL_ROAD_MIN_ALIGNMENT) continue;

      const projectionA = dot(subtract(roadStart, targetStart), targetUnit);
      const projectionB = dot(subtract(roadEnd, targetStart), targetUnit);
      const overlapM = Math.max(
        0,
        Math.min(targetLength, Math.max(projectionA, projectionB)) -
          Math.max(0, Math.min(projectionA, projectionB))
      );
      if (overlapM < 0.5) continue;

      const gapM = segmentDistance(targetStart, targetEnd, roadStart, roadEnd);
      if (gapM > CADASTRAL_ROAD_NEAR_TOLERANCE_M) continue;
      const score = gapM * 10 + (1 - alignment) * 8 - Math.min(overlapM, 20) * 0.08;
      if (!best || score < best.score) {
        best = {
          targetEdgeIndex: targetIndex,
          roadEdgeIndex: roadIndex,
          targetStart,
          targetEnd,
          gapM,
          alignment,
          overlapM,
          score,
        };
      }
    }
  }
  return best;
}

function buildRoadFrontage(
  targetPolygons: LocalParcelPolygon[],
  roadParcel: LocalCadastralParcel,
  checkDeadline: () => void,
): CadastralRoadFrontage | null {
  const polygons = localParcelPolygons(roadParcel);
  let candidate: (FrontageCandidate & {
    targetPolygonIndex: number; targetRingIndex: number; roadPolygonIndex: number; roadRingIndex: number;
  }) | null = null;
  for (const [targetPolygonIndex, target] of targetPolygons.entries()) {
    for (const [targetRingIndex, targetRing] of [target.outer, ...target.holes].entries()) {
      for (const [roadPolygonIndex, road] of polygons.entries()) {
        for (const [roadRingIndex, roadRing] of [road.outer, ...road.holes].entries()) {
          checkDeadline();
          const found = findFrontageCandidate(targetRing, roadRing, checkDeadline);
          if (found && (!candidate || found.score < candidate.score)) {
            candidate = { ...found, targetPolygonIndex, targetRingIndex, roadPolygonIndex, roadRingIndex };
          }
        }
      }
    }
  }
  if (!candidate) return null;

  const edgeVector = subtract(candidate.targetEnd, candidate.targetStart);
  const edgeUnit = normalize(edgeVector);
  if (!edgeUnit) return null;
  const edgeLength = Math.hypot(edgeVector.x, edgeVector.z);
  const midpoint = add(candidate.targetStart, multiply(edgeVector, 0.5));
  const leftNormal = { x: -edgeUnit.z, z: edgeUnit.x };
  const normal = localParcelContainsPoint(targetPolygons, add(midpoint, multiply(leftNormal, 0.001)))
    ? multiply(leftNormal, -1) : leftNormal;

  const ratios = [0.15, 0.3, 0.5, 0.7, 0.85];
  const widthSamples: CadastralRoadWidthSample[] = [];
  const mayVerifyWidth = roadParcel.boundarySource === "continuous-cadastral";
  const plannedGeometryWidths: number[] = [];
  for (const positionRatio of ratios) {
    checkDeadline();
    const sampleOrigin = add(candidate.targetStart, multiply(edgeVector, positionRatio));
    const interval = roadIntervalAlongRay(sampleOrigin, normal, polygons);
    if (!interval) continue;
    if (interval.gapM > CADASTRAL_ROAD_NEAR_TOLERANCE_M || interval.widthM < 0.5) continue;
    if (mayVerifyWidth) {
      widthSamples.push({
        positionRatio,
        gapM: round(interval.gapM, 3),
        widthM: round(interval.widthM, 3),
        from: interval.from,
        to: interval.to,
      });
    } else {
      // UPIS 폴리곤 단면은 계획폭 참고값으로만 보존한다. 검증 폭/폭 샘플에는 넣지 않는다.
      plannedGeometryWidths.push(round(interval.widthM, 3));
    }
  }

  const widths = widthSamples.map((sample) => sample.widthM);
  const widthMinM = widths.length > 0 ? Math.min(...widths) : null;
  const widthMaxM = widths.length > 0 ? Math.max(...widths) : null;
  const widthAvgM =
    widths.length > 0 ? widths.reduce((sum, value) => sum + value, 0) / widths.length : null;
  const plannedWidthMinM =
    plannedGeometryWidths.length > 0 ? Math.min(...plannedGeometryWidths) : null;
  const plannedWidthMaxM =
    plannedGeometryWidths.length > 0 ? Math.max(...plannedGeometryWidths) : null;
  const plannedWidthAvgM =
    plannedGeometryWidths.length > 0
      ? plannedGeometryWidths.reduce((sum, value) => sum + value, 0) /
        plannedGeometryWidths.length
      : null;
  const avgGap =
    widthSamples.length > 0
      ? widthSamples.reduce((sum, sample) => sum + sample.gapM, 0) / widthSamples.length
      : candidate.gapM;

  return {
    roadParcelPnu: roadParcel.pnu,
    roadParcelJibun: roadParcel.jibun,
    targetEdgeIndex: candidate.targetEdgeIndex,
    targetPolygonIndex: candidate.targetPolygonIndex,
    targetRingIndex: candidate.targetRingIndex,
    roadPolygonIndex: candidate.roadPolygonIndex,
    roadRingIndex: candidate.roadRingIndex,
    roadEdgeIndex: candidate.roadEdgeIndex,
    frontage: [candidate.targetStart, candidate.targetEnd],
    frontageLengthM: round(Math.min(edgeLength, candidate.overlapM), 3),
    boundaryGapM: round(avgGap, 3),
    alignmentPct: round(candidate.alignment * 100, 1),
    widthSamples,
    widthMinM: widthMinM == null ? null : round(widthMinM, 3),
    widthAvgM: widthAvgM == null ? null : round(widthAvgM, 3),
    widthMaxM: widthMaxM == null ? null : round(widthMaxM, 3),
    plannedWidthMinM:
      plannedWidthMinM == null ? null : round(plannedWidthMinM, 3),
    plannedWidthAvgM:
      plannedWidthAvgM == null ? null : round(plannedWidthAvgM, 3),
    plannedWidthMaxM:
      plannedWidthMaxM == null ? null : round(plannedWidthMaxM, 3),
    status:
      roadParcel.boundarySource === "upis-planned-road"
        ? "planned-road-reference"
        : widths.length >= 2 && avgGap <= CADASTRAL_ROAD_CONTACT_TOLERANCE_M
          ? "verified-cadastral-width"
          : avgGap <= CADASTRAL_ROAD_CONTACT_TOLERANCE_M
            ? "frontage-only"
            : "nearby-road-parcel",
    source:
      roadParcel.boundarySource === "upis-planned-road"
        ? "VWorld UPIS planned road boundary"
        : "VWorld continuous cadastral road parcel",
  };
}

function buildRoadClearance(
  planning: PlanningGeometrySnapshot,
  roadParcel: LocalCadastralParcel,
  checkDeadline: () => void,
): RoadClearanceAssessment {
  const polygons = localParcelPolygons(roadParcel);
  let minimumClearanceM = Number.POSITIVE_INFINITY;
  let intrusionAreaSqm = 0;
  let floorLevel: number | null = null;
  let buildingPoint: LocalPlanPoint | null = null;
  let roadPoint: LocalPlanPoint | null = null;

  for (const floor of planning.building.floors) {
    checkDeadline();
    if (floor.shape.length < 3) continue;
    const clearance = polygonClearance(floor.shape, polygons, checkDeadline);
    const floorIntrusionAreaSqm = localParcelIntersectionArea([{ outer: floor.shape, holes: [] }], polygons);
    if (floorIntrusionAreaSqm > intrusionAreaSqm) {
      intrusionAreaSqm = floorIntrusionAreaSqm;
      floorLevel = floor.level;
    }
    if (clearance && clearance.distanceM < minimumClearanceM) {
      minimumClearanceM = clearance.distanceM;
      buildingPoint = clearance.first;
      roadPoint = clearance.second;
      if (floorLevel == null) floorLevel = floor.level;
    }
  }

  const intrudes = intrusionAreaSqm > 0.01;
  return {
    roadParcelPnu: roadParcel.pnu,
    boundarySource: roadParcel.boundarySource ?? "continuous-cadastral",
    minimumClearanceM: Number.isFinite(minimumClearanceM)
      ? round(minimumClearanceM, 3)
      : 0,
    intrusionAreaSqm: round(intrusionAreaSqm, 2),
    intrudes,
    floorLevel,
    buildingPoint,
    roadPoint,
    status: intrudes ? "fail" : "pass",
  };
}

function toLocalParcel(
  feature: CadastralParcelFeature,
  origin: [number, number],
  checkDeadline: () => void,
): LocalCadastralParcel | null {
  const polygons = sourceParcelPolygons(feature).map(part => ({
    outer: openRing(planningRingToLocalMeters(part.outer, origin)),
    holes: part.holes.map(ring => openRing(planningRingToLocalMeters(ring, origin))),
  }));
  if (!validateLocalParcelTopology(polygons, checkDeadline)) return null;
  const measuredAreaSqm = localParcelArea(polygons);
  if (!Number.isFinite(measuredAreaSqm) || measuredAreaSqm <= 0) return null;
  return {
    pnu: feature.pnu,
    jibun: feature.jibun,
    jimok: feature.jimok,
    jimokCode: feature.jimokCode,
    officialAreaSqm: feature.lotAreaSqm,
    measuredAreaSqm,
    distanceM: feature.distanceM,
    polygon: polygons.length === 1 && polygons[0].holes.length === 0 ? polygons[0].outer : [],
    polygons,
    source: "VWorld LP_PA_CBND_BUBUN",
    boundarySource: feature.boundarySource ?? "continuous-cadastral",
  };
}

export function buildCadastralContext(input: {
  planning: PlanningGeometrySnapshot;
  targetPnu: string;
  targetBoundary?: [number, number][];
  targetBoundaryPolygons?: Wgs84ParcelPolygon[];
  parcels?: CadastralParcelFeature[] | null;
  generatedAt?: string;
}): CadastralContextSnapshot {
  const issues: CadastralContextIssue[] = [];
  const deadline = performance.now() + 2_000;
  const checkDeadline = () => {
    if (performance.now() >= deadline) throw new DOMException("Cadastral computation deadline exceeded", "TimeoutError");
  };
  const origin = input.planning.coordinateSystem.originLngLat;
  const sourceParcels = input.parcels ?? [];
  const localParcels: LocalCadastralParcel[] = [];
  let targetPolygons: LocalParcelPolygon[] = [];
  try {
    checkDeadline();
    if (input.targetBoundaryPolygons !== undefined || input.targetBoundary !== undefined) {
      const source = sourceParcelPolygons({ boundary: input.targetBoundary ?? [], polygons: input.targetBoundaryPolygons });
      parcelProjectionOrigin(source);
      targetPolygons = projectParcelPolygons(source, origin);
    } else {
      const inherited = localParcelPolygons(input.planning.parcel);
      if (!validateLocalParcelTopology(inherited, checkDeadline)) throw new Error("Invalid inherited target topology");
      targetPolygons = structuredClone(inherited);
    }
    if (!validateLocalParcelTopology(targetPolygons, checkDeadline)) throw new Error("Invalid target topology");
    checkDeadline();
  } catch {
    targetPolygons = [];
    issues.push({ code: "cadastral-invalid-target", severity: "fail", parcelPnu: input.targetPnu,
      message: "대상 필지의 전체 경계 검사를 완료하지 못했습니다. 단일 외곽선으로 대체하지 않습니다." });
  }
  if (targetPolygons.length && (input.targetBoundaryPolygons !== undefined || input.targetBoundary !== undefined)) {
    try {
      if (!validateCadastralTarget(input.planning.parcel, checkDeadline)
        || !cadastralTargetPolygonsMatch(targetPolygons, localParcelPolygons(input.planning.parcel), checkDeadline)) {
        throw new Error("Target source differs from planning");
      }
      checkDeadline();
    } catch {
      issues.push({ code: "cadastral-target-source-mismatch", severity: "fail", parcelPnu: input.targetPnu,
        message: "대상 필지 원본의 전체 경계 또는 식별 순서가 계획 snapshot과 일치하지 않습니다." });
    }
  }

  for (const feature of sourceParcels) {
    if (!feature.pnu || feature.pnu === input.targetPnu) continue;
    let parcel: LocalCadastralParcel | null = null;
    try { checkDeadline(); parcel = toLocalParcel(feature, origin, checkDeadline); }
    catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        issues.push({ code: "cadastral-time-limit", severity: "fail", message: "전체 지적 경계 검사 시간 한도를 초과했습니다. 미검사 필지를 통과로 처리하지 않습니다." });
        break;
      }
    }
    if (parcel) localParcels.push(parcel);
    else {
      issues.push({
        code: "cadastral-invalid-parcel",
        severity: "fail",
        parcelPnu: feature.pnu,
        message: `${feature.jibun || feature.pnu} 지적 폴리곤이 유효하지 않아 context에서 제외했습니다.`,
      });
    }
  }

  const roadParcels = localParcels.filter((parcel) => parcel.jimok.trim() === "도로");
  const adjacentParcels = localParcels.filter((parcel) => parcel.jimok.trim() !== "도로");
  const frontages: CadastralRoadFrontage[] = [];
  const roadClearances: RoadClearanceAssessment[] = [];
  for (const parcel of roadParcels) {
    try {
      checkDeadline();
      const frontage = targetPolygons.length ? buildRoadFrontage(targetPolygons, parcel, checkDeadline) : null;
      const clearance = buildRoadClearance(input.planning, parcel, checkDeadline);
      checkDeadline();
      if (frontage) frontages.push(frontage);
      roadClearances.push(clearance);
    } catch {
      issues.push({ code: "cadastral-topology-calculation-failed", severity: "fail", parcelPnu: parcel.pnu,
        message: `${parcel.jibun || parcel.pnu} 전체 경계의 폭·충돌 계산을 완료하지 못했습니다. 중첩 없음으로 판정하지 않습니다.` });
    }
  }
  frontages.sort((a, b) => {
      const aVerified = a.status === "verified-cadastral-width" ? 0 : 1;
      const bVerified = b.status === "verified-cadastral-width" ? 0 : 1;
      return aVerified - bVerified || a.boundaryGapM - b.boundaryGapM;
    });
  roadClearances.sort((a, b) => a.minimumClearanceM - b.minimumClearanceM);

  if (sourceParcels.length === 0) {
    issues.push({
      code: "cadastral-context-missing",
      severity: "review",
      message: "주변 연속지적도 데이터가 없어 인접 필지와 지적상 도로 폭을 export에 포함할 수 없습니다.",
    });
  } else if (roadParcels.length === 0) {
    issues.push({
      code: "cadastral-road-parcel-missing",
      severity: "review",
      message: "조회 범위에서 지목이 도로인 필지를 찾지 못했습니다. 도로 중심선만 참고 레이어로 사용합니다.",
    });
  } else if (
    roadParcels.every((parcel) => parcel.boundarySource === "upis-planned-road")
  ) {
    issues.push({
      code: "upis-planned-road-reference-only",
      severity: "review",
      message:
        "연속지적도에서 도로 필지를 찾지 못해 UPIS 도시계획 도로를 참고로 표시합니다. 현재 지적상 도로 폭으로 확정하지 않으며 폭 샘플을 생성하지 않습니다.",
    });
  } else if (!frontages.some((frontage) => frontage.status === "verified-cadastral-width")) {
    issues.push({
      code: "cadastral-road-width-review",
      severity: "review",
      message: "도로 필지는 조회됐지만 접도부 수직 폭 샘플을 충분히 검증하지 못했습니다. 지적도 원본 확인이 필요합니다.",
    });
  }

  for (const clearance of roadClearances.filter((candidate) => candidate.intrudes)) {
    const plannedRoad = clearance.boundarySource === "upis-planned-road";
    issues.push({
      code: plannedRoad
        ? "planned-road-mass-intrusion"
        : "cadastral-road-mass-intrusion",
      severity: "fail",
      parcelPnu: clearance.roadParcelPnu,
      message: `${plannedRoad ? "UPIS 계획도로 결정선" : "지적상 도로 필지"}과 계획 매스가 ${clearance.intrusionAreaSqm.toFixed(2)}㎡ 겹칩니다. 건축선과 실시계획을 확인하기 전에는 대표안으로 확정할 수 없습니다.`,
    });
  }

  const primary = frontages[0] ?? null;
  const primaryRoadClearance =
    (primary
      ? roadClearances.find(
          (clearance) => clearance.roadParcelPnu === primary.roadParcelPnu
        )
      : null) ?? roadClearances[0] ?? null;
  const canonical = {
    version: CADASTRAL_CONTEXT_VERSION,
    projectId: input.planning.projectId,
    targetPnu: input.targetPnu,
    targetPolygons: targetPolygons.map(part => ({ outer: part.outer.map(canonicalPoint), holes: part.holes.map(ring => ring.map(canonicalPoint)) })),
    origin: origin.map((value) => round(value, 8)),
    adjacentParcels: adjacentParcels.map((parcel) => ({
      pnu: parcel.pnu,
      jimok: parcel.jimok,
      boundarySource: parcel.boundarySource,
      polygons: localParcelPolygons(parcel).map(part => ({ outer: part.outer.map(canonicalPoint), holes: part.holes.map(ring => ring.map(canonicalPoint)) })),
    })),
    roadParcels: roadParcels.map((parcel) => ({
      pnu: parcel.pnu,
      boundarySource: parcel.boundarySource,
      polygons: localParcelPolygons(parcel).map(part => ({ outer: part.outer.map(canonicalPoint), holes: part.holes.map(ring => ring.map(canonicalPoint)) })),
    })),
    frontages: frontages.map((frontage) => ({
      ...cadastralFrontageIdentity(frontage),
      frontage: frontage.frontage.map(canonicalPoint),
      widthSamples: frontage.widthSamples.map((sample) => ({
        positionRatio: sample.positionRatio,
        gapM: sample.gapM,
        widthM: sample.widthM,
      })),
      plannedWidths: [
        frontage.plannedWidthMinM,
        frontage.plannedWidthAvgM,
        frontage.plannedWidthMaxM,
      ],
    })),
    roadClearances: roadClearances.map((clearance) => ({
      roadParcelPnu: clearance.roadParcelPnu,
      minimumClearanceM: clearance.minimumClearanceM,
      intrusionAreaSqm: clearance.intrusionAreaSqm,
    })),
    issues: issues.map(issue => ({ code: issue.code, severity: issue.severity, parcelPnu: issue.parcelPnu })),
  };

  return {
    version: CADASTRAL_CONTEXT_VERSION,
    projectId: input.planning.projectId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    cadastralHash: stableHash(canonical),
    coordinateSystem: input.planning.coordinateSystem,
    targetParcel: {
      pnu: input.targetPnu,
      polygon: targetPolygons.length === 1 && targetPolygons[0].holes.length === 0 ? targetPolygons[0].outer : [],
      polygons: targetPolygons,
      measuredAreaSqm: localParcelArea(targetPolygons),
    },
    adjacentParcels,
    roadParcels,
    frontages,
    roadClearances,
    summary: {
      adjacentParcelCount: adjacentParcels.length,
      roadParcelCount: roadParcels.length,
      verifiedWidthFrontageCount: frontages.filter(
        (frontage) => frontage.status === "verified-cadastral-width"
      ).length,
      primaryWidthMinM: primary?.widthMinM ?? null,
      primaryWidthAvgM: primary?.widthAvgM ?? null,
      primaryWidthMaxM: primary?.widthMaxM ?? null,
      primaryPlannedWidthMinM: primary?.plannedWidthMinM ?? null,
      primaryPlannedWidthAvgM: primary?.plannedWidthAvgM ?? null,
      primaryPlannedWidthMaxM: primary?.plannedWidthMaxM ?? null,
      primaryMassRoadClearanceM:
        primaryRoadClearance?.minimumClearanceM ?? null,
      roadIntrusionCount: roadClearances.filter((clearance) => clearance.intrudes)
        .length,
    },
    validation: {
      status: issues.some((issue) => issue.severity === "fail")
        ? "fail"
        : issues.length > 0
          ? "review"
          : "pass",
      usable: !issues.some((issue) => issue.severity === "fail"),
      issues,
    },
    sourceNotes: [
      "대상·인접 필지와 지적상 도로는 VWorld 연속지적도 LP_PA_CBND_BUBUN을 동일한 로컬 미터 좌표로 변환합니다.",
      "UPIS LT_C_UPISUQ151은 도시계획시설 도로 참고 경계로만 분리 표시하며 지적상 도로 폭 산정에는 사용하지 않습니다.",
      "지적상 도로 폭은 연속지적도 도로 필지와 대상 필지 접도 경계가 10도 이내로 평행할 때만 수직 샘플로 계산합니다.",
      "지적상 도로 폭은 현황 포장·차도·보도 폭과 다를 수 있으며 경계측량을 대체하지 않습니다.",
      "VWorld 도로 중심선은 도로명과 방향 확인용 참고 레이어이며 실제 도로 경계로 사용하지 않습니다.",
    ],
  };
}

export const buildCadastralContextSnapshot = buildCadastralContext;
