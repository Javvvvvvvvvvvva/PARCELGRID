import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import {
  planningRingToLocalMeters,
  polygonSelfIntersects,
} from "@/lib/planning/planning-geometry";
import { polygonAreaSqm, type LocalPlanPoint } from "@/lib/planning/planning-massing";
import { featureCollection, intersect, polygon } from "@turf/turf";

export const CADASTRAL_CONTEXT_VERSION = "cadastral-context-v2" as const;
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

function polygonCentroid(points: LocalPlanPoint[]): LocalPlanPoint {
  const ring = openRing(points);
  if (ring.length === 0) return { x: 0, z: 0 };
  const sum = ring.reduce(
    (acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }),
    { x: 0, z: 0 }
  );
  return { x: sum.x / ring.length, z: sum.z / ring.length };
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
  secondPolygon: LocalPlanPoint[]
): { distanceM: number; first: LocalPlanPoint; second: LocalPlanPoint } | null {
  const first = openRing(firstPolygon);
  const second = openRing(secondPolygon);
  if (first.length < 3 || second.length < 3) return null;

  let best: { distanceM: number; first: LocalPlanPoint; second: LocalPlanPoint } | null =
    null;
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const a = first[firstIndex];
    const b = first[(firstIndex + 1) % first.length];
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const c = second[secondIndex];
      const d = second[(secondIndex + 1) % second.length];
      const candidate = closestSegmentPoints(a, b, c, d);
      if (!best || candidate.distanceM < best.distanceM) best = candidate;
      if (candidate.distanceM <= 1e-9) return candidate;
    }
  }

  if (pointInPolygon(first[0], second)) {
    return { distanceM: 0, first: first[0], second: first[0] };
  }
  if (pointInPolygon(second[0], first)) {
    return { distanceM: 0, first: second[0], second: second[0] };
  }
  return best;
}

function closedCoordinates(points: LocalPlanPoint[]): [number, number][] {
  const ring = openRing(points).map((point) => [point.x, point.z] as [number, number]);
  return ring.length > 0 ? [...ring, ring[0]] : [];
}

function coordinateRingArea(points: number[][]): number {
  if (points.length < 4) return 0;
  let area = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) / 2;
}

function polygonIntersectionAreaSqm(
  first: LocalPlanPoint[],
  second: LocalPlanPoint[]
): number {
  const firstRing = closedCoordinates(first);
  const secondRing = closedCoordinates(second);
  if (firstRing.length < 4 || secondRing.length < 4) return 0;
  try {
    const result = intersect(
      featureCollection([polygon([firstRing]), polygon([secondRing])])
    );
    if (!result) return 0;
    if (result.geometry.type === "Polygon") {
      return coordinateRingArea(result.geometry.coordinates[0]);
    }
    return result.geometry.coordinates.reduce(
      (sum, coordinates) => sum + coordinateRingArea(coordinates[0]),
      0
    );
  } catch {
    return 0;
  }
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
  polygon: LocalPlanPoint[]
): { gapM: number; widthM: number; from: LocalPlanPoint; to: LocalPlanPoint } | null {
  const hits = rayPolygonIntersections(origin, direction, polygon);
  if (hits.length === 0) return null;
  const bounds = [0, ...hits];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const start = bounds[index];
    const end = bounds[index + 1];
    if (end - start < 1e-5) continue;
    const midpoint = add(origin, multiply(direction, (start + end) / 2));
    if (!pointInPolygon(midpoint, polygon)) continue;
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
  targetStart: LocalPlanPoint;
  targetEnd: LocalPlanPoint;
  gapM: number;
  alignment: number;
  overlapM: number;
  score: number;
}

function findFrontageCandidate(
  targetPolygon: LocalPlanPoint[],
  roadPolygon: LocalPlanPoint[]
): FrontageCandidate | null {
  const target = openRing(targetPolygon);
  const road = openRing(roadPolygon);
  let best: FrontageCandidate | null = null;

  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    const targetStart = target[targetIndex];
    const targetEnd = target[(targetIndex + 1) % target.length];
    const targetVector = subtract(targetEnd, targetStart);
    const targetUnit = normalize(targetVector);
    const targetLength = Math.hypot(targetVector.x, targetVector.z);
    if (!targetUnit || targetLength < 0.5) continue;

    for (let roadIndex = 0; roadIndex < road.length; roadIndex += 1) {
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
  targetPolygon: LocalPlanPoint[],
  roadParcel: LocalCadastralParcel
): CadastralRoadFrontage | null {
  const candidate = findFrontageCandidate(targetPolygon, roadParcel.polygon);
  if (!candidate) return null;

  const edgeVector = subtract(candidate.targetEnd, candidate.targetStart);
  const edgeUnit = normalize(edgeVector);
  if (!edgeUnit) return null;
  const edgeLength = Math.hypot(edgeVector.x, edgeVector.z);
  const midpoint = add(candidate.targetStart, multiply(edgeVector, 0.5));
  const roadCentroid = polygonCentroid(roadParcel.polygon);
  const leftNormal = { x: -edgeUnit.z, z: edgeUnit.x };
  const normal = dot(subtract(roadCentroid, midpoint), leftNormal) >= 0
    ? leftNormal
    : multiply(leftNormal, -1);

  const ratios = [0.15, 0.3, 0.5, 0.7, 0.85];
  const widthSamples: CadastralRoadWidthSample[] = [];
  const mayVerifyWidth = roadParcel.boundarySource === "continuous-cadastral";
  const plannedGeometryWidths: number[] = [];
  for (const positionRatio of ratios) {
    const sampleOrigin = add(candidate.targetStart, multiply(edgeVector, positionRatio));
    const interval = roadIntervalAlongRay(sampleOrigin, normal, roadParcel.polygon);
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
  roadParcel: LocalCadastralParcel
): RoadClearanceAssessment {
  let minimumClearanceM = Number.POSITIVE_INFINITY;
  let intrusionAreaSqm = 0;
  let floorLevel: number | null = null;
  let buildingPoint: LocalPlanPoint | null = null;
  let roadPoint: LocalPlanPoint | null = null;

  for (const floor of planning.building.floors) {
    if (floor.shape.length < 3) continue;
    const clearance = polygonClearance(floor.shape, roadParcel.polygon);
    const floorIntrusionAreaSqm = polygonIntersectionAreaSqm(
      floor.shape,
      roadParcel.polygon
    );
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
  origin: [number, number]
): LocalCadastralParcel | null {
  const polygon = openRing(planningRingToLocalMeters(feature.boundary, origin));
  if (polygon.length < 3 || polygonSelfIntersects(polygon)) return null;
  const measuredAreaSqm = polygonAreaSqm(polygon);
  if (!Number.isFinite(measuredAreaSqm) || measuredAreaSqm <= 0) return null;
  return {
    pnu: feature.pnu,
    jibun: feature.jibun,
    jimok: feature.jimok,
    jimokCode: feature.jimokCode,
    officialAreaSqm: feature.lotAreaSqm,
    measuredAreaSqm,
    distanceM: feature.distanceM,
    polygon,
    source: "VWorld LP_PA_CBND_BUBUN",
    boundarySource: feature.boundarySource ?? "continuous-cadastral",
  };
}

export function buildCadastralContext(input: {
  planning: PlanningGeometrySnapshot;
  targetPnu: string;
  parcels?: CadastralParcelFeature[] | null;
  generatedAt?: string;
}): CadastralContextSnapshot {
  const issues: CadastralContextIssue[] = [];
  const origin = input.planning.coordinateSystem.originLngLat;
  const sourceParcels = input.parcels ?? [];
  const localParcels: LocalCadastralParcel[] = [];

  for (const feature of sourceParcels) {
    if (!feature.pnu || feature.pnu === input.targetPnu) continue;
    const parcel = toLocalParcel(feature, origin);
    if (parcel) localParcels.push(parcel);
    else {
      issues.push({
        code: "cadastral-invalid-parcel",
        severity: "review",
        parcelPnu: feature.pnu,
        message: `${feature.jibun || feature.pnu} 지적 폴리곤이 유효하지 않아 context에서 제외했습니다.`,
      });
    }
  }

  const roadParcels = localParcels.filter((parcel) => parcel.jimok.trim() === "도로");
  const adjacentParcels = localParcels.filter((parcel) => parcel.jimok.trim() !== "도로");
  const frontages = roadParcels
    .map((parcel) => buildRoadFrontage(input.planning.parcel.polygon, parcel))
    .filter((frontage): frontage is CadastralRoadFrontage => frontage !== null)
    .sort((a, b) => {
      const aVerified = a.status === "verified-cadastral-width" ? 0 : 1;
      const bVerified = b.status === "verified-cadastral-width" ? 0 : 1;
      return aVerified - bVerified || a.boundaryGapM - b.boundaryGapM;
    });
  const roadClearances = roadParcels
    .map((parcel) => buildRoadClearance(input.planning, parcel))
    .sort((a, b) => a.minimumClearanceM - b.minimumClearanceM);

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
    origin: origin.map((value) => round(value, 8)),
    adjacentParcels: adjacentParcels.map((parcel) => ({
      pnu: parcel.pnu,
      jimok: parcel.jimok,
      polygon: parcel.polygon.map(canonicalPoint),
    })),
    roadParcels: roadParcels.map((parcel) => ({
      pnu: parcel.pnu,
      polygon: parcel.polygon.map(canonicalPoint),
    })),
    frontages: frontages.map((frontage) => ({
      roadParcelPnu: frontage.roadParcelPnu,
      targetEdgeIndex: frontage.targetEdgeIndex,
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
  };

  return {
    version: CADASTRAL_CONTEXT_VERSION,
    projectId: input.planning.projectId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    cadastralHash: stableHash(canonical),
    coordinateSystem: input.planning.coordinateSystem,
    targetParcel: {
      pnu: input.targetPnu,
      polygon: input.planning.parcel.polygon,
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
