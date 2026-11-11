import type {
  FloorProgram,
  FloorUseType,
  PlanningPlacement,
} from "@/lib/planning/types";
import { difference, featureCollection, intersect, polygon, union } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { ringAreaSqm as polygonAreaSqm } from "@/lib/geo/planar-ring";
import {
  localParcelArea,
  localParcelFeature,
  localParcelIntersectionArea,
  openParcelRing,
  validateLocalParcelTopology,
} from "@/lib/geo/parcel-topology-geometry";

export { polygonAreaSqm };

export interface LocalPlanPoint {
  x: number;
  z: number;
}

export interface PlanningEnvelopeStep {
  level: number;
  shape: LocalPlanPoint[];
  /** Authoritative when supplied, including an empty or invalid topology. */
  polygons?: LocalParcelPolygon[];
  envelopeAreaSqm: number;
  requiredSetbackM: number;
  envelopeAvailable: boolean;
}

export interface PlanningMassZoneSummary {
  useType: FloorUseType;
  areaSqm: number;
  unitCount: number;
}

export interface PlanningFloorMass {
  id: string;
  level: number;
  label: string;
  baseHeightM: number;
  topHeightM: number;
  floorHeightM: number;
  shape: LocalPlanPoint[];
  programAreaSqm: number;
  envelopeAreaSqm: number;
  targetAreaSqm: number;
  visualAreaSqm: number;
  areaDifferencePct: number;
  capacityShortfallSqm: number;
  fitsEnvelope: boolean;
  appliedScalePct: number;
  footprintScalePct: number;
  northSetbackM: number;
  requiredSetbackM: number;
  envelopeAvailable: boolean;
  supportOverlapRatio: number;
  supportedByLowerFloor: boolean;
  residentialUnits: number;
  commercialUnits: number;
  dominantUse: FloorUseType | "mixed";
  zones: PlanningMassZoneSummary[];
  generationStatus?: "fitted" | "partial" | "no-candidate" | "empty-envelope" | "invalid-envelope" | "budget-exhausted";
  generationReason?: string;
}

export interface PlanningMassCapacitySummary {
  allFloorsFit: boolean;
  overCapacityFloorCount: number;
  totalShortfallSqm: number;
  maxShortfallSqm: number;
}

export interface PlanningMassModel {
  floors: PlanningFloorMass[];
  aboveGroundFloors: PlanningFloorMass[];
  basementFloors: PlanningFloorMass[];
  totalHeightM: number;
  basementDepthM: number;
  capacity: PlanningMassCapacitySummary;
}

interface FittedFootprint {
  shape: LocalPlanPoint[];
  fitRatio: number;
}

const EPSILON = 1e-7;
const FULL_SUPPORT_OVERLAP_RATIO = 1 - 1e-6;
const AREA_TOLERANCE_SQM = 1e-6;

/** One cooperative budget covers validation, every floor, fitting and support. */
export function createPlanningGeometryBudget(): () => void {
  const deadline = performance.now() + 2_000;
  let checks = 0;
  return () => {
    if (++checks > 20_000 || performance.now() >= deadline) {
      const error = new Error("Planning geometry exceeded its bounded computation budget.");
      error.name = "TimeoutError";
      throw error;
    }
  };
}

export function planningEnvelopePolygons(envelope: PlanningEnvelopeStep): LocalParcelPolygon[] {
  return envelope.polygons === undefined
    ? [{ outer: envelope.shape, holes: [] }]
    : Array.isArray(envelope.polygons) ? envelope.polygons : [];
}

function containsFootprint(
  shape: LocalPlanPoint[],
  polygons: LocalParcelPolygon[],
  checkBudget: () => void
): boolean {
  checkBudget();
  const area = polygonAreaSqm(shape);
  if (!Number.isFinite(area) || area <= EPSILON) return false;
  const overlap = localParcelIntersectionArea([{ outer: shape, holes: [] }], polygons);
  checkBudget();
  return Math.abs(area - overlap) <= AREA_TOLERANCE_SQM;
}

/** Clipping, not edge samples, determines containment (including enclosed holes). */
export function planningEnvelopeContainsFootprint(
  shape: LocalPlanPoint[],
  envelope: PlanningEnvelopeStep,
  checkBudget = createPlanningGeometryBudget()
): boolean {
  try {
    const polygons = planningEnvelopePolygons(envelope);
    if (!envelope.envelopeAvailable || !validateLocalParcelTopology(polygons, checkBudget)
      || !validateLocalParcelTopology([{ outer: shape, holes: [] }], checkBudget)) return false;
    return containsFootprint(shape, polygons, checkBudget);
  } catch {
    return false;
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function polygonCentroid(points: LocalPlanPoint[]): LocalPlanPoint {
  if (points.length === 0) return { x: 0, z: 0 };
  const signedArea =
    points.reduce((sum, current, index) => {
      const next = points[(index + 1) % points.length];
      return sum + current.x * next.z - next.x * current.z;
    }, 0) / 2;

  if (Math.abs(signedArea) < EPSILON) {
    return points.reduce(
      (sum, point) => ({
        x: sum.x + point.x / points.length,
        z: sum.z + point.z / points.length,
      }),
      { x: 0, z: 0 }
    );
  }

  let x = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const factor = current.x * next.z - next.x * current.z;
    x += (current.x + next.x) * factor;
    z += (current.z + next.z) * factor;
  }
  const divisor = 6 * signedArea;
  return { x: x / divisor, z: z / divisor };
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
  if (lengthSquared <= EPSILON ** 2) return Math.hypot(point.x - start.x, point.z - start.z) <= EPSILON;
  return dot <= lengthSquared + EPSILON;
}

function pointInPolygonInclusive(
  point: LocalPlanPoint,
  polygon: LocalPlanPoint[]
): boolean {
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

function polygonBounds(points: LocalPlanPoint[]) {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minZ: Math.min(...points.map((point) => point.z)),
    maxZ: Math.max(...points.map((point) => point.z)),
  };
}

function translateShape(
  points: LocalPlanPoint[],
  dx: number,
  dz: number
): LocalPlanPoint[] {
  return points.map((point) => ({ x: point.x + dx, z: point.z + dz }));
}

function scaleShapeAround(
  points: LocalPlanPoint[],
  anchor: LocalPlanPoint,
  scale: number
): LocalPlanPoint[] {
  return points.map((point) => ({
    x: anchor.x + (point.x - anchor.x) * scale,
    z: anchor.z + (point.z - anchor.z) * scale,
  }));
}

function candidateAnchors(polygon: LocalPlanPoint[]): LocalPlanPoint[] {
  if (polygon.length < 3) return [];
  const bounds = polygonBounds(polygon);
  const average = polygon.reduce(
    (sum, point) => ({
      x: sum.x + point.x / polygon.length,
      z: sum.z + point.z / polygon.length,
    }),
    { x: 0, z: 0 }
  );
  const candidates: LocalPlanPoint[] = [
    polygonCentroid(polygon),
    average,
    {
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    },
    ...polygon,
    ...polygon.map((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return { x: (point.x + next.x) / 2, z: (point.z + next.z) / 2 };
    }),
  ];

  const divisions = 10;
  for (let xIndex = 0; xIndex <= divisions; xIndex += 1) {
    for (let zIndex = 0; zIndex <= divisions; zIndex += 1) {
      candidates.push({
        x:
          bounds.minX +
          ((bounds.maxX - bounds.minX) * xIndex) / divisions,
        z:
          bounds.minZ +
          ((bounds.maxZ - bounds.minZ) * zIndex) / divisions,
      });
    }
  }

  const seen = new Set<string>();
  return candidates.filter((point) => {
    const key = `${point.x.toFixed(5)}:${point.z.toFixed(5)}`;
    if (seen.has(key) || !pointInPolygonInclusive(point, polygon)) return false;
    seen.add(key);
    return true;
  });
}

function fitScaledEnvelope(
  envelope: LocalPlanPoint[],
  desiredAreaSqm: number,
  checkBudget: () => void
): FittedFootprint {
  const envelopeAreaSqm = polygonAreaSqm(envelope);
  if (envelope.length < 3 || envelopeAreaSqm <= 0 || desiredAreaSqm <= 0) {
    return { shape: [], fitRatio: 0 };
  }

  const desiredScale = clamp(
    Math.sqrt(Math.min(desiredAreaSqm, envelopeAreaSqm) / envelopeAreaSqm),
    0,
    1
  );
  const preferredCenter = polygonCentroid(envelope);
  let bestShape: LocalPlanPoint[] = [];
  let bestScale = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const anchor of candidateAnchors(envelope).slice(0, 160)) {
    checkBudget();
    const desiredShape = scaleShapeAround(envelope, anchor, desiredScale);
    if (containsFootprint(desiredShape, [{ outer: envelope, holes: [] }], checkBudget)) {
      const desiredCenter = polygonCentroid(desiredShape);
      const distance = Math.hypot(
        desiredCenter.x - preferredCenter.x,
        desiredCenter.z - preferredCenter.z
      );
      if (
        desiredScale > bestScale + EPSILON ||
        (Math.abs(desiredScale - bestScale) <= EPSILON &&
          distance < bestDistance)
      ) {
        bestShape = desiredShape;
        bestScale = desiredScale;
        bestDistance = distance;
      }
      if (distance < EPSILON) break;
      continue;
    }
  }

  return {
    shape: bestShape,
    fitRatio: desiredScale > EPSILON ? bestScale / desiredScale : 0,
  };
}

function rectangle(minX: number, minZ: number, maxX: number, maxZ: number): LocalPlanPoint[] {
  return [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }];
}

function simpleClippedShapes(feature: Feature<Polygon | MultiPolygon> | null): LocalPlanPoint[][] {
  if (!feature) return [];
  const parts = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  // A floor cannot represent holes or multiple components. Never discard an interior ring.
  return parts.filter(rings => rings.length === 1).map(rings =>
    openParcelRing(rings[0].map(([x, z]) => ({ x, z }))))
    .filter(shape => polygonAreaSqm(shape) > EPSILON);
}

function fitContiguousShape(seed: LocalPlanPoint[], desiredAreaSqm: number, checkBudget: () => void): LocalPlanPoint[] {
  const seedArea = polygonAreaSqm(seed);
  if (seedArea <= desiredAreaSqm) return seed;
  const scaled = fitScaledEnvelope(seed, desiredAreaSqm, checkBudget);
  if (scaled.shape.length) return scaled.shape;

  // Half-plane cuts retain the original concavities. A cut that disconnects the
  // shape contributes each real component, never a stitched outer boundary.
  const bounds = polygonBounds(seed);
  const source = polygon([closeRing(seed)]);
  let best: LocalPlanPoint[] = [];
  let bestArea = 0;
  for (const axis of ["x", "z"] as const) for (const reversed of [false, true]) {
    let low = 0, high = 1;
    for (let iteration = 0; iteration < 36; iteration++) {
      checkBudget();
      const ratio = (low + high) / 2;
      const x = bounds.minX + (bounds.maxX - bounds.minX) * (reversed ? 1 - ratio : ratio);
      const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * (reversed ? 1 - ratio : ratio);
      const clip = axis === "x"
        ? rectangle(reversed ? x : bounds.minX, bounds.minZ, reversed ? bounds.maxX : x, bounds.maxZ)
        : rectangle(bounds.minX, reversed ? z : bounds.minZ, bounds.maxX, reversed ? bounds.maxZ : z);
      const pieces = simpleClippedShapes(intersect(featureCollection([source, polygon([closeRing(clip)])])));
      checkBudget();
      let largestArea = 0;
      for (const piece of pieces) {
        const area = polygonAreaSqm(piece);
        largestArea = Math.max(largestArea, area);
        if (area <= desiredAreaSqm && area > bestArea) { best = piece; bestArea = area; }
      }
      if (desiredAreaSqm - bestArea <= AREA_TOLERANCE_SQM) return best;
      if (largestArea < desiredAreaSqm) low = ratio; else high = ratio;
    }
  }
  return best;
}

function* holeFreeCandidates(part: LocalParcelPolygon, checkBudget: () => void): Generator<LocalPlanPoint[]> {
  if (!part.holes.length) { yield openParcelRing(part.outer); return; }
  const bounds = polygonBounds(part.outer);
  const source = localParcelFeature([part]);
  // Opening each courtyard to an exterior edge creates bounded C/U-shaped
  // candidates, not a claim of exhaustive architectural optimisation.
  for (const direction of ["north", "south", "east", "west"] as const) {
    checkBudget();
    const cuts = part.holes.map(hole => {
      const box = polygonBounds(hole);
      const x = (box.minX + box.maxX) / 2, z = (box.minZ + box.maxZ) / 2;
      const halfWidth = Math.min(0.125, (box.maxX - box.minX) / 4, (box.maxZ - box.minZ) / 4);
      const ring = direction === "north" ? rectangle(x - halfWidth, box.minZ, x + halfWidth, bounds.maxZ + 1)
        : direction === "south" ? rectangle(x - halfWidth, bounds.minZ - 1, x + halfWidth, box.maxZ)
        : direction === "east" ? rectangle(box.minX, z - halfWidth, bounds.maxX + 1, z + halfWidth)
        : rectangle(bounds.minX - 1, z - halfWidth, box.maxX, z + halfWidth);
      return polygon([closeRing(ring)]);
    });
    const cut = cuts.length === 1 ? cuts[0] : union(featureCollection(cuts));
    checkBudget();
    if (!cut) continue;
    const clipped = difference(featureCollection<Polygon | MultiPolygon>([source, cut]));
    checkBudget();
    yield* simpleClippedShapes(clipped).sort((a, b) => polygonAreaSqm(b) - polygonAreaSqm(a));
  }
}

function fitEnvelopeTopology(polygons: LocalParcelPolygon[], desiredAreaSqm: number, checkBudget: () => void): FittedFootprint {
  if (desiredAreaSqm <= EPSILON) return { shape: [], fitRatio: 0 };
  let best: LocalPlanPoint[] = [], bestArea = 0;
  const ranked = [...polygons].sort((a, b) => localParcelArea([b]) - localParcelArea([a]));
  for (const part of ranked) for (const seed of holeFreeCandidates(part, checkBudget)) {
    checkBudget();
    if (polygonAreaSqm(seed) <= bestArea) continue;
    const candidate = fitContiguousShape(seed, desiredAreaSqm, checkBudget);
    const area = polygonAreaSqm(candidate);
    if (area <= bestArea || !validateLocalParcelTopology([{ outer: candidate, holes: [] }], checkBudget)
      || !containsFootprint(candidate, polygons, checkBudget)) continue;
    best = candidate; bestArea = area;
    if (desiredAreaSqm - bestArea <= AREA_TOLERANCE_SQM) return { shape: best, fitRatio: Math.sqrt(bestArea / desiredAreaSqm) };
  }
  return { shape: best, fitRatio: Math.sqrt(bestArea / desiredAreaSqm) };
}

function closeRing(points: LocalPlanPoint[]): [number, number][] {
  const ring = points.map(
    (point) => [point.x, point.z] as [number, number]
  );
  if (ring.length > 0) ring.push([...ring[0]] as [number, number]);
  return ring;
}

function coordinateRingArea(ring: number[][]): number {
  if (ring.length < 4) return 0;
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(sum) / 2;
}

function coordinatePolygonArea(rings: number[][][]): number {
  if (rings.length === 0) return 0;
  return Math.max(
    0,
    coordinateRingArea(rings[0]) -
      rings.slice(1).reduce((sum, ring) => sum + coordinateRingArea(ring), 0)
  );
}

/**
 * Returns the portion of the upper-floor footprint that is physically above
 * the floor immediately below. This deliberately uses the real polygon
 * intersection, not axis-aligned bounding boxes.
 */
export function calculateSupportOverlapRatio(
  upper: LocalPlanPoint[],
  lower: LocalPlanPoint[],
  checkBudget = createPlanningGeometryBudget()
): number {
  if (upper.length < 3 || lower.length < 3) return 0;
  const upperArea = polygonAreaSqm(upper);
  if (upperArea <= EPSILON) return 0;

  try {
    if (!validateLocalParcelTopology([{ outer: upper, holes: [] }], checkBudget)
      || !validateLocalParcelTopology([{ outer: lower, holes: [] }], checkBudget)) return 0;
    checkBudget();
    const overlap = intersect(
      featureCollection([
        polygon([closeRing(upper)]),
        polygon([closeRing(lower)]),
      ])
    );
    checkBudget();
    if (!overlap) return 0;
    const overlapArea =
      overlap.geometry.type === "Polygon"
        ? coordinatePolygonArea(overlap.geometry.coordinates)
        : overlap.geometry.coordinates.reduce(
            (sum, rings) => sum + coordinatePolygonArea(rings),
            0
          );
    return clamp(overlapArea / upperArea, 0, 1);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw error;
    // Invalid or self-intersecting input must never be treated as supported.
    return 0;
  }
}

function alignFootprintToSupport(
  shape: LocalPlanPoint[],
  supportShape: LocalPlanPoint[] | undefined,
  legalEnvelope: LocalParcelPolygon[],
  checkBudget: () => void
): { shape: LocalPlanPoint[]; overlapRatio: number; fullySupported: boolean } {
  if (shape.length < 3 || !containsFootprint(shape, legalEnvelope, checkBudget)
    || (supportShape && supportShape.length < 3)) {
    return { shape, overlapRatio: 0, fullySupported: false };
  }
  if (!supportShape) {
    return { shape, overlapRatio: 1, fullySupported: true };
  }

  const initialOverlap = calculateSupportOverlapRatio(shape, supportShape, checkBudget);
  if (initialOverlap >= FULL_SUPPORT_OVERLAP_RATIO) {
    return { shape, overlapRatio: 1, fullySupported: true };
  }

  const shapeCenter = polygonCentroid(shape);
  const supportCenter = polygonCentroid(supportShape);
  const dx = supportCenter.x - shapeCenter.x;
  const dz = supportCenter.z - shapeCenter.z;
  let bestShape = shape;
  let bestOverlap = initialOverlap;

  for (let step = 1; step <= 80; step += 1) {
    const ratio = step / 80;
    const candidate = translateShape(shape, dx * ratio, dz * ratio);
    if (!containsFootprint(candidate, legalEnvelope, checkBudget)) continue;
    const overlap = calculateSupportOverlapRatio(candidate, supportShape, checkBudget);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestShape = candidate;
    }
    if (overlap >= FULL_SUPPORT_OVERLAP_RATIO) {
      return { shape: candidate, overlapRatio: 1, fullySupported: true };
    }
  }

  return {
    shape: bestShape,
    overlapRatio: bestOverlap,
    fullySupported: false,
  };
}

function applyPlacementTransform(
  points: LocalPlanPoint[],
  northSetbackM: number,
  placement: PlanningPlacement,
  rotationPivot: LocalPlanPoint
): LocalPlanPoint[] {
  const angle = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((point) => {
    const pivotX = point.x - rotationPivot.x;
    const pivotZ = point.z - rotationPivot.z;
    return {
      x:
        rotationPivot.x +
        pivotX * cos -
        pivotZ * sin +
        placement.offsetXM,
      z:
        rotationPivot.z +
        pivotX * sin +
        pivotZ * cos +
        placement.offsetZM +
        nonNegative(placement.northSetbackM) +
        nonNegative(northSetbackM),
    };
  });
}

export function transformPlanningFootprint(
  points: LocalPlanPoint[],
  footprintScalePct: number,
  northSetbackM: number,
  placement: PlanningPlacement,
  targetAreaSqm?: number,
  rotationPivot?: LocalPlanPoint
): LocalPlanPoint[] {
  const floorCenter = polygonCentroid(points);
  const pivot = rotationPivot ?? floorCenter;
  const envelopeAreaSqm = polygonAreaSqm(points);
  const manualScale = clamp(footprintScalePct / 100, 0.1, 1);
  const areaFitScale =
    targetAreaSqm != null && targetAreaSqm > 0 && envelopeAreaSqm > 0
      ? Math.sqrt(
          Math.min(targetAreaSqm, envelopeAreaSqm) / envelopeAreaSqm
        )
      : 1;
  const scale = clamp(areaFitScale * manualScale, 0.01, 1);
  const scaled = scaleShapeAround(points, floorCenter, scale);
  return applyPlacementTransform(scaled, northSetbackM, placement, pivot);
}

function floorProgramArea(floor: FloorProgram): number {
  return floor.zones.reduce(
    (sum, zone) => sum + nonNegative(zone.areaSqm),
    0
  );
}

function countUnits(floor: FloorProgram, uses: FloorUseType[]): number {
  return floor.zones.reduce(
    (sum, zone) =>
      uses.includes(zone.useType)
        ? sum + Math.max(0, Math.floor(zone.unitCount))
        : sum,
    0
  );
}

function dominantUse(floor: FloorProgram): FloorUseType | "mixed" {
  const positive = floor.zones.filter((zone) => zone.areaSqm > 0);
  if (positive.length === 0) return "other";
  const byUse = new Map<FloorUseType, number>();
  positive.forEach((zone) =>
    byUse.set(zone.useType, (byUse.get(zone.useType) ?? 0) + zone.areaSqm)
  );
  const ranked = [...byUse.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[1][1] >= ranked[0][1] * 0.6) {
    return "mixed";
  }
  return ranked[0][0];
}

function buildMass(
  floor: FloorProgram,
  envelope: PlanningEnvelopeStep,
  placement: PlanningPlacement,
  rotationPivot: LocalPlanPoint,
  baseHeightM: number,
  topHeightM: number,
  checkBudget: () => void,
  supportShape?: LocalPlanPoint[]
): PlanningFloorMass {
  const programAreaSqm = floorProgramArea(floor);
  let envelopeAreaSqm = 0;
  let shape: LocalPlanPoint[] = [];
  let insideLegalEnvelope = false;
  let supported = { overlapRatio: 0, fullySupported: false };
  let generationStatus: PlanningFloorMass["generationStatus"] = "invalid-envelope";
  let generationReason = "법규 영역이 없거나 유효하지 않아 평면을 생성하지 않았습니다.";
  const manualScale = clamp(floor.footprintScalePct / 100, 0.1, 1);
  try {
    checkBudget();
    const polygons = planningEnvelopePolygons(envelope);
    if (envelope.envelopeAvailable && Array.isArray(envelope.polygons) && envelope.polygons.length === 0) {
      generationStatus = "empty-envelope";
      generationReason = "해당 층의 이격 후 영역이 비어 있습니다. 다른 층이나 대지 전체로 대체하지 않습니다.";
    }
    if (envelope.envelopeAvailable && validateLocalParcelTopology(polygons, checkBudget)) {
      envelopeAreaSqm = localParcelArea(polygons);
      const desiredAreaSqm = Math.min(programAreaSqm, envelopeAreaSqm) * manualScale * manualScale;
      const fitted = fitEnvelopeTopology(polygons, desiredAreaSqm, checkBudget);
      generationStatus = fitted.shape.length ? (fitted.fitRatio >= 1 - EPSILON ? "fitted" : "partial") : "no-candidate";
      generationReason = generationStatus === "fitted"
        ? "유한 후보 탐색으로 연속 평면을 생성했습니다. 전역 최적해나 법정 적합 판정이 아닙니다."
        : "유한 후보 탐색에서 요청 면적의 연속 평면을 확보하지 못했습니다. 배치 대안 검토가 필요합니다.";
      const initialShape = applyPlacementTransform(fitted.shape, floor.northSetbackM, placement, rotationPivot);
      if (validateLocalParcelTopology([{ outer: initialShape, holes: [] }], checkBudget)) {
        const alignment = alignFootprintToSupport(initialShape, supportShape, polygons, checkBudget);
        supported = alignment;
        shape = alignment.shape;
        insideLegalEnvelope = containsFootprint(shape, polygons, checkBudget);
      } else if (fitted.shape.length) {
        generationStatus = "no-candidate";
        generationReason = "배치 변환 결과가 유효하지 않아 평면을 생성하지 않았습니다.";
      }
    }
  } catch (error) {
    shape = [];
    supported = { overlapRatio: 0, fullySupported: false };
    insideLegalEnvelope = false;
    generationStatus = error instanceof Error && error.name === "TimeoutError" ? "budget-exhausted" : "no-candidate";
    generationReason = generationStatus === "budget-exhausted"
      ? "공유 계산 예산을 초과하여 생성·검증을 중단했습니다. 해당 층은 통과로 판정하지 않습니다."
      : "기하 계산에 실패하여 해당 층의 평면을 생성하지 않았습니다.";
  }
  const targetAreaSqm = Math.min(programAreaSqm, envelopeAreaSqm);
  const desiredVisualAreaSqm = targetAreaSqm * manualScale * manualScale;
  const visualAreaSqm = polygonAreaSqm(shape);
  const areaDifferencePct =
    programAreaSqm > 0
      ? ((visualAreaSqm - programAreaSqm) / programAreaSqm) * 100
      : 0;
  const envelopeAreaShortfall = Math.max(
    0,
    programAreaSqm - envelopeAreaSqm
  );
  const fitShortfall = Math.max(0, desiredVisualAreaSqm - visualAreaSqm);
  const capacityShortfallSqm = envelopeAreaShortfall + fitShortfall;
  const appliedScalePct =
    envelopeAreaSqm > 0
      ? Math.sqrt(Math.max(0, visualAreaSqm) / envelopeAreaSqm) * 100
      : 0;

  return {
    id: floor.id,
    level: floor.level,
    label: floor.label,
    baseHeightM,
    topHeightM,
    floorHeightM: nonNegative(floor.floorHeightM),
    shape,
    programAreaSqm,
    envelopeAreaSqm,
    targetAreaSqm,
    visualAreaSqm,
    areaDifferencePct,
    capacityShortfallSqm,
    fitsEnvelope: capacityShortfallSqm <= 0.1 && insideLegalEnvelope,
    appliedScalePct,
    footprintScalePct: floor.footprintScalePct,
    northSetbackM: nonNegative(floor.northSetbackM),
    requiredSetbackM: nonNegative(envelope.requiredSetbackM),
    envelopeAvailable: envelope.envelopeAvailable && generationStatus !== "invalid-envelope" && generationStatus !== "budget-exhausted" && generationStatus !== "no-candidate",
    supportOverlapRatio: supported.overlapRatio,
    supportedByLowerFloor: supported.fullySupported,
    residentialUnits: countUnits(floor, ["residential"]),
    commercialUnits: countUnits(floor, ["retail", "office"]),
    dominantUse: dominantUse(floor),
    zones: floor.zones.map((zone) => ({
      useType: zone.useType,
      areaSqm: nonNegative(zone.areaSqm),
      unitCount: Math.max(0, Math.floor(zone.unitCount)),
    })),
    generationStatus,
    generationReason,
  };
}

export function summarizePlanningMassCapacity(
  floors: PlanningFloorMass[]
): PlanningMassCapacitySummary {
  const overCapacity = floors.filter((floor) => !floor.fitsEnvelope);
  const totalShortfallSqm = overCapacity.reduce(
    (sum, floor) => sum + floor.capacityShortfallSqm,
    0
  );
  const maxShortfallSqm = overCapacity.reduce(
    (max, floor) => Math.max(max, floor.capacityShortfallSqm),
    0
  );
  return {
    allFloorsFit: overCapacity.length === 0,
    overCapacityFloorCount: overCapacity.length,
    totalShortfallSqm,
    maxShortfallSqm,
  };
}

export function buildPlanningMassModel(
  floorPrograms: FloorProgram[],
  envelopeSteps: PlanningEnvelopeStep[],
  placement: PlanningPlacement
): PlanningMassModel {
  const checkBudget = createPlanningGeometryBudget();
  const unavailableEnvelope = (level: number): PlanningEnvelopeStep => ({ level, shape: [], polygons: [], envelopeAreaSqm: 0, requiredSetbackM: 0, envelopeAvailable: false });
  const envelopeByLevel = new Map(
    envelopeSteps.map((step) => [step.level, step])
  );
  const fallbackEnvelope =
    envelopeSteps.find((step) => step.level === 1) ??
    envelopeSteps[0] ?? {
      level: 1,
      shape: [],
      envelopeAreaSqm: 0,
      requiredSetbackM: 0,
      envelopeAvailable: false,
    };

  const groundPrograms = floorPrograms
    .filter((floor) => floor.level > 0)
    .sort((a, b) => a.level - b.level);
  const basementPrograms = floorPrograms
    .filter((floor) => floor.level < 0)
    .sort((a, b) => b.level - a.level);

  const pivotEnvelope =
    (groundPrograms.length > 0
      ? envelopeByLevel.get(groundPrograms[0].level)
      : undefined) ?? fallbackEnvelope;
  let rotationPivot = { x: 0, z: 0 };
  try {
    const polygons = planningEnvelopePolygons(pivotEnvelope);
    if (validateLocalParcelTopology(polygons, checkBudget)) {
      const totalArea = localParcelArea(polygons);
      rotationPivot = polygons.reduce((sum, part) => {
        for (const [index, ring] of [part.outer, ...part.holes].entries()) {
          const area = polygonAreaSqm(ring) * (index ? -1 : 1);
          const center = polygonCentroid(ring);
          sum.x += center.x * area / totalArea;
          sum.z += center.z * area / totalArea;
        }
        return sum;
      }, { x: 0, z: 0 });
    }
  } catch {
    // The same exhausted budget is checked by each floor, which then fails closed.
  }

  let currentHeightM = 0;
  const aboveGroundFloors: PlanningFloorMass[] = [];
  for (const floor of groundPrograms) {
    const height = nonNegative(floor.floorHeightM);
    const base = currentHeightM;
    currentHeightM += height;
    const supportShape =
      aboveGroundFloors.length > 0
        ? aboveGroundFloors[aboveGroundFloors.length - 1].shape
        : undefined;
    aboveGroundFloors.push(
      buildMass(
        floor,
        envelopeByLevel.get(floor.level) ?? unavailableEnvelope(floor.level),
        placement,
        rotationPivot,
        base,
        currentHeightM,
        checkBudget,
        supportShape
      )
    );
  }

  let currentDepthM = 0;
  const basementFloors: PlanningFloorMass[] = [];
  for (const floor of basementPrograms) {
    const height = nonNegative(floor.floorHeightM);
    const top = currentDepthM === 0 ? 0 : -currentDepthM;
    currentDepthM += height;
    const base = -currentDepthM;
    const supportShape =
      basementFloors.length > 0
        ? basementFloors[basementFloors.length - 1].shape
        : undefined;
    basementFloors.push(
      buildMass(
        floor,
        envelopeByLevel.get(floor.level) ?? unavailableEnvelope(floor.level),
        placement,
        rotationPivot,
        base,
        top,
        checkBudget,
        supportShape
      )
    );
  }

  const floors = [...aboveGroundFloors, ...basementFloors];
  return {
    floors,
    aboveGroundFloors,
    basementFloors,
    totalHeightM: currentHeightM,
    basementDepthM: currentDepthM,
    capacity: summarizePlanningMassCapacity(floors),
  };
}
