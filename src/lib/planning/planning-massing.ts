import type {
  FloorProgram,
  FloorUseType,
  PlanningPlacement,
} from "@/lib/planning/types";

export interface LocalPlanPoint {
  x: number;
  z: number;
}

export interface PlanningEnvelopeStep {
  level: number;
  shape: LocalPlanPoint[];
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
const MIN_SUPPORT_OVERLAP_RATIO = 0.12;

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function polygonAreaSqm(points: LocalPlanPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.z - next.x * current.z;
  }
  return Math.abs(sum) / 2;
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

function polygonInsidePolygon(
  inner: LocalPlanPoint[],
  outer: LocalPlanPoint[]
): boolean {
  if (inner.length < 3 || outer.length < 3) return false;
  const samples: LocalPlanPoint[] = [...inner];
  inner.forEach((point, index) => {
    const next = inner[(index + 1) % inner.length];
    samples.push(
      { x: (point.x + next.x) / 2, z: (point.z + next.z) / 2 },
      {
        x: point.x * 0.75 + next.x * 0.25,
        z: point.z * 0.75 + next.z * 0.25,
      },
      {
        x: point.x * 0.25 + next.x * 0.75,
        z: point.z * 0.25 + next.z * 0.75,
      }
    );
  });
  return samples.every((point) => pointInPolygonInclusive(point, outer));
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
  desiredAreaSqm: number
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

  for (const anchor of candidateAnchors(envelope)) {
    const desiredShape = scaleShapeAround(envelope, anchor, desiredScale);
    if (polygonInsidePolygon(desiredShape, envelope)) {
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
      continue;
    }

    let low = 0;
    let high = desiredScale;
    for (let iteration = 0; iteration < 28; iteration += 1) {
      const middle = (low + high) / 2;
      const candidate = scaleShapeAround(envelope, anchor, middle);
      if (polygonInsidePolygon(candidate, envelope)) low = middle;
      else high = middle;
    }
    const candidate = scaleShapeAround(envelope, anchor, low);
    const candidateCenter = polygonCentroid(candidate);
    const distance = Math.hypot(
      candidateCenter.x - preferredCenter.x,
      candidateCenter.z - preferredCenter.z
    );
    if (
      low > bestScale + EPSILON ||
      (Math.abs(low - bestScale) <= EPSILON && distance < bestDistance)
    ) {
      bestShape = candidate;
      bestScale = low;
      bestDistance = distance;
    }
  }

  return {
    shape: bestShape,
    fitRatio: desiredScale > EPSILON ? bestScale / desiredScale : 0,
  };
}

function boundingOverlapRatio(
  upper: LocalPlanPoint[],
  lower: LocalPlanPoint[]
): number {
  if (upper.length < 3 || lower.length < 3) return 0;
  const a = polygonBounds(upper);
  const b = polygonBounds(lower);
  const overlapWidth = Math.max(
    0,
    Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
  );
  const overlapDepth = Math.max(
    0,
    Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
  );
  const overlapArea = overlapWidth * overlapDepth;
  const upperBoxArea = Math.max(
    EPSILON,
    (a.maxX - a.minX) * (a.maxZ - a.minZ)
  );
  const lowerBoxArea = Math.max(
    EPSILON,
    (b.maxX - b.minX) * (b.maxZ - b.minZ)
  );
  return clamp(overlapArea / Math.min(upperBoxArea, lowerBoxArea), 0, 1);
}

function alignFootprintToSupport(
  shape: LocalPlanPoint[],
  supportShape: LocalPlanPoint[] | undefined,
  legalEnvelope: LocalPlanPoint[]
): { shape: LocalPlanPoint[]; overlapRatio: number } {
  if (!supportShape || supportShape.length < 3 || shape.length < 3) {
    return { shape, overlapRatio: 1 };
  }

  const initialOverlap = boundingOverlapRatio(shape, supportShape);
  if (initialOverlap >= MIN_SUPPORT_OVERLAP_RATIO) {
    return { shape, overlapRatio: initialOverlap };
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
    if (!polygonInsidePolygon(candidate, legalEnvelope)) continue;
    const overlap = boundingOverlapRatio(candidate, supportShape);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestShape = candidate;
    }
    if (overlap >= MIN_SUPPORT_OVERLAP_RATIO) break;
  }

  return { shape: bestShape, overlapRatio: bestOverlap };
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
  supportShape?: LocalPlanPoint[]
): PlanningFloorMass {
  const programAreaSqm = floorProgramArea(floor);
  const measuredEnvelopeAreaSqm = polygonAreaSqm(envelope.shape);
  const envelopeAreaSqm =
    measuredEnvelopeAreaSqm > 0
      ? measuredEnvelopeAreaSqm
      : nonNegative(envelope.envelopeAreaSqm);
  const targetAreaSqm = Math.min(programAreaSqm, envelopeAreaSqm);
  const manualScale = clamp(floor.footprintScalePct / 100, 0.1, 1);
  const desiredVisualAreaSqm = targetAreaSqm * manualScale * manualScale;

  const fitted = fitScaledEnvelope(envelope.shape, desiredVisualAreaSqm);
  const initialShape = applyPlacementTransform(
    fitted.shape,
    floor.northSetbackM,
    placement,
    rotationPivot
  );
  const placedLegalEnvelope = applyPlacementTransform(
    envelope.shape,
    floor.northSetbackM,
    placement,
    rotationPivot
  );
  const supported = alignFootprintToSupport(
    initialShape,
    supportShape,
    placedLegalEnvelope
  );
  const shape = supported.shape;
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
  const insideLegalEnvelope = polygonInsidePolygon(shape, placedLegalEnvelope);
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
    envelopeAvailable: envelope.envelopeAvailable,
    supportOverlapRatio: supported.overlapRatio,
    supportedByLowerFloor:
      !supportShape || supported.overlapRatio >= MIN_SUPPORT_OVERLAP_RATIO,
    residentialUnits: countUnits(floor, ["residential"]),
    commercialUnits: countUnits(floor, ["retail", "office"]),
    dominantUse: dominantUse(floor),
    zones: floor.zones.map((zone) => ({
      useType: zone.useType,
      areaSqm: nonNegative(zone.areaSqm),
      unitCount: Math.max(0, Math.floor(zone.unitCount)),
    })),
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
  const rotationPivot = polygonCentroid(pivotEnvelope.shape);

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
        envelopeByLevel.get(floor.level) ?? fallbackEnvelope,
        placement,
        rotationPivot,
        base,
        currentHeightM,
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
        envelopeByLevel.get(floor.level) ?? fallbackEnvelope,
        placement,
        rotationPivot,
        base,
        top,
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
