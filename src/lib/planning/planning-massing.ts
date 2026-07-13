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
  /** 법규 엔진이 해당 층에 허용한 최대 외곽선 면적. */
  envelopeAreaSqm: number;
  /** 프로그램 면적과 법규 외곽선 중 더 작은 3D 목표 면적. */
  targetAreaSqm: number;
  visualAreaSqm: number;
  areaDifferencePct: number;
  /** 프로그램 면적 또는 정돈된 평면 배치가 법규 외곽선에 수용되지 못한 면적. */
  capacityShortfallSqm: number;
  fitsEnvelope: boolean;
  /** 법규 외곽선을 기준으로 실제 적용된 선형 축척. */
  appliedScalePct: number;
  footprintScalePct: number;
  northSetbackM: number;
  requiredSetbackM: number;
  envelopeAvailable: boolean;
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

interface RegularizedFootprintResult {
  shape: LocalPlanPoint[];
  fitRatio: number;
}

const EPSILON = 1e-7;

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

  if (Math.abs(signedArea) < 1e-9) {
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
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    const intersects =
      currentPoint.z > point.z !== previousPoint.z > point.z &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.z - currentPoint.z)) /
          (previousPoint.z - currentPoint.z) +
          currentPoint.x;
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
      { x: point.x * 0.75 + next.x * 0.25, z: point.z * 0.75 + next.z * 0.25 },
      { x: (point.x + next.x) / 2, z: (point.z + next.z) / 2 },
      { x: point.x * 0.25 + next.x * 0.75, z: point.z * 0.25 + next.z * 0.75 }
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

function longestEdgeAngle(points: LocalPlanPoint[]): number {
  let longest = -1;
  let angle = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next.x - point.x;
    const dz = next.z - point.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared > longest) {
      longest = lengthSquared;
      angle = Math.atan2(dz, dx);
    }
  });
  return angle;
}

function orientedAspectRatio(
  points: LocalPlanPoint[],
  angle: number
): number {
  if (points.length < 3) return 1;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const projected = points.map((point) => ({
    u: point.x * cos + point.z * sin,
    v: -point.x * sin + point.z * cos,
  }));
  const width =
    Math.max(...projected.map((point) => point.u)) -
    Math.min(...projected.map((point) => point.u));
  const depth =
    Math.max(...projected.map((point) => point.v)) -
    Math.min(...projected.map((point) => point.v));
  if (width <= EPSILON || depth <= EPSILON) return 1;
  return clamp(width / depth, 0.35, 2.85);
}

function rectangleShape(
  center: LocalPlanPoint,
  areaSqm: number,
  aspectRatio: number,
  angle: number,
  scale = 1
): LocalPlanPoint[] {
  if (areaSqm <= 0 || scale <= 0) return [];
  const width = Math.sqrt(areaSqm * aspectRatio) * scale;
  const depth = (areaSqm / Math.max(width / scale, EPSILON)) * scale;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const localCorners = [
    { u: -halfWidth, v: -halfDepth },
    { u: halfWidth, v: -halfDepth },
    { u: halfWidth, v: halfDepth },
    { u: -halfWidth, v: halfDepth },
  ];
  return localCorners.map(({ u, v }) => ({
    x: center.x + u * cos - v * sin,
    z: center.z + u * sin + v * cos,
  }));
}

function candidateCenters(polygon: LocalPlanPoint[]): LocalPlanPoint[] {
  const bounds = polygonBounds(polygon);
  const centroid = polygonCentroid(polygon);
  const average = polygon.reduce(
    (sum, point) => ({
      x: sum.x + point.x / polygon.length,
      z: sum.z + point.z / polygon.length,
    }),
    { x: 0, z: 0 }
  );
  const candidates: LocalPlanPoint[] = [
    centroid,
    average,
    {
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    },
  ];

  const divisions = 6;
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
    const key = `${point.x.toFixed(4)}:${point.z.toFixed(4)}`;
    if (seen.has(key) || !pointInPolygonInclusive(point, polygon)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 법규 외곽선은 제한선으로만 사용하고 실제 계획 매스는 정돈된 직사각형으로 만든다.
 * 1층 기준 방향과 종횡비를 모든 지상층이 공유해 작은 상층부에서도 꺾인 외곽선이
 * 과장되거나 층마다 평면 방향이 달라 보이지 않도록 한다.
 */
function regularizeFootprint(
  envelopeShape: LocalPlanPoint[],
  referenceShape: LocalPlanPoint[],
  desiredAreaSqm: number
): RegularizedFootprintResult {
  if (
    envelopeShape.length < 3 ||
    referenceShape.length < 3 ||
    desiredAreaSqm <= 0
  ) {
    return { shape: [], fitRatio: 0 };
  }

  const angle = longestEdgeAngle(referenceShape);
  const aspectRatio = orientedAspectRatio(referenceShape, angle);
  const preferredCenter = polygonCentroid(envelopeShape);
  let bestShape: LocalPlanPoint[] = [];
  let bestScale = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const center of candidateCenters(envelopeShape)) {
    let low = 0;
    let high = 1;
    let candidate = rectangleShape(
      center,
      desiredAreaSqm,
      aspectRatio,
      angle,
      high
    );
    if (polygonInsidePolygon(candidate, envelopeShape)) {
      low = 1;
    } else {
      for (let iteration = 0; iteration < 26; iteration += 1) {
        const middle = (low + high) / 2;
        candidate = rectangleShape(
          center,
          desiredAreaSqm,
          aspectRatio,
          angle,
          middle
        );
        if (polygonInsidePolygon(candidate, envelopeShape)) {
          low = middle;
        } else {
          high = middle;
        }
      }
    }

    const distance = Math.hypot(
      center.x - preferredCenter.x,
      center.z - preferredCenter.z
    );
    if (
      low > bestScale + 1e-5 ||
      (Math.abs(low - bestScale) <= 1e-5 && distance < bestDistance)
    ) {
      bestScale = low;
      bestDistance = distance;
      bestShape = rectangleShape(
        center,
        desiredAreaSqm,
        aspectRatio,
        angle,
        low
      );
    }
    if (bestScale >= 0.99999 && bestDistance <= 0.01) break;
  }

  return { shape: bestShape, fitRatio: bestScale };
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

/**
 * 기존 공개 유틸리티. 임의 외곽선을 자체 중심으로 축척한 뒤 공통 회전축을 기준으로
 * 회전·이동한다. 개별 호출과 기존 테스트의 하위 호환을 유지한다.
 */
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
  const scaled = points.map((point) => ({
    x: floorCenter.x + (point.x - floorCenter.x) * scale,
    z: floorCenter.z + (point.z - floorCenter.z) * scale,
  }));
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
  referenceShape: LocalPlanPoint[],
  placement: PlanningPlacement,
  rotationPivot: LocalPlanPoint,
  baseHeightM: number,
  topHeightM: number
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
  const regularized = regularizeFootprint(
    envelope.shape,
    referenceShape,
    desiredVisualAreaSqm
  );
  const shape = applyPlacementTransform(
    regularized.shape,
    floor.northSetbackM,
    placement,
    rotationPivot
  );
  const visualAreaSqm = polygonAreaSqm(shape);
  const areaDifferencePct =
    programAreaSqm > 0
      ? ((visualAreaSqm - programAreaSqm) / programAreaSqm) * 100
      : 0;
  const envelopeAreaShortfall = Math.max(
    0,
    programAreaSqm - envelopeAreaSqm
  );
  const regularizedFitShortfall = Math.max(
    0,
    desiredVisualAreaSqm - visualAreaSqm
  );
  const capacityShortfallSqm =
    envelopeAreaShortfall + regularizedFitShortfall;
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
    fitsEnvelope: capacityShortfallSqm <= 0.1,
    appliedScalePct,
    footprintScalePct: floor.footprintScalePct,
    northSetbackM: nonNegative(floor.northSetbackM),
    requiredSetbackM: nonNegative(envelope.requiredSetbackM),
    envelopeAvailable: envelope.envelopeAvailable,
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
  const groundReferenceShape = pivotEnvelope.shape;
  const basementReferenceShape =
    (basementPrograms.length > 0
      ? envelopeByLevel.get(basementPrograms[0].level)?.shape
      : undefined) ?? groundReferenceShape;

  let currentHeightM = 0;
  const aboveGroundFloors = groundPrograms.map((floor) => {
    const height = nonNegative(floor.floorHeightM);
    const base = currentHeightM;
    currentHeightM += height;
    return buildMass(
      floor,
      envelopeByLevel.get(floor.level) ?? fallbackEnvelope,
      groundReferenceShape,
      placement,
      rotationPivot,
      base,
      currentHeightM
    );
  });

  let currentDepthM = 0;
  const basementFloors = basementPrograms.map((floor) => {
    const height = nonNegative(floor.floorHeightM);
    const top = currentDepthM === 0 ? 0 : -currentDepthM;
    currentDepthM += height;
    const base = -currentDepthM;
    return buildMass(
      floor,
      envelopeByLevel.get(floor.level) ?? fallbackEnvelope,
      basementReferenceShape,
      placement,
      rotationPivot,
      base,
      top
    );
  });

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
