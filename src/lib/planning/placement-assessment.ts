import type {
  LocalPlanPoint,
  PlanningEnvelopeStep,
  PlanningMassModel,
} from "@/lib/planning/planning-massing";
import {
  createPlanningGeometryBudget,
  planningEnvelopeContainsFootprint,
  planningEnvelopePolygons,
} from "@/lib/planning/planning-massing";
import { localParcelContainsPoint } from "@/lib/geo/parcel-topology-geometry";

const EPSILON = 1e-7;

export interface FloorPlacementAssessment {
  floorId: string;
  level: number;
  label: string;
  areaFits: boolean;
  placementFits: boolean;
  fits: boolean;
  outsidePointCount: number;
  capacityShortfallSqm: number;
}

export interface PlanningPlacementAssessment {
  allFloorsFit: boolean;
  areaOverCapacityFloorCount: number;
  outsideFloorCount: number;
  totalCapacityShortfallSqm: number;
  floors: FloorPlacementAssessment[];
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

/** 경계 위 점도 내부로 인정하는 ray-casting 판정. */
export function pointInPolygonInclusive(
  point: LocalPlanPoint,
  polygon: LocalPlanPoint[]
): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
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

function edgeSamples(
  start: LocalPlanPoint,
  end: LocalPlanPoint
): LocalPlanPoint[] {
  return [0.25, 0.5, 0.75].map((ratio) => ({
    x: start.x + (end.x - start.x) * ratio,
    z: start.z + (end.z - start.z) * ratio,
  }));
}

/** Samples are diagnostic only. Full planar clipping determines containment. */
export function polygonInsidePolygon(
  inner: LocalPlanPoint[],
  outer: LocalPlanPoint[]
): { fits: boolean; outsidePointCount: number } {
  return assessFootprint(inner, { level: 1, shape: outer, envelopeAreaSqm: 0, requiredSetbackM: 0, envelopeAvailable: true }, createPlanningGeometryBudget());
}

function assessFootprint(inner: LocalPlanPoint[], envelope: PlanningEnvelopeStep, checkBudget: () => void) {
  try {
    const fits = planningEnvelopeContainsFootprint(inner, envelope, checkBudget);
    const polygons = planningEnvelopePolygons(envelope);
    let outsidePointCount = 0;
    for (let index = 0; index < inner.length; index++) {
      checkBudget();
      const current = inner[index], next = inner[(index + 1) % inner.length];
      for (const point of [current, ...edgeSamples(current, next)]) {
        if (!localParcelContainsPoint(polygons, point)) outsidePointCount++;
      }
    }
    return { fits, outsidePointCount };
  } catch {
    return { fits: false, outsidePointCount: inner.length };
  }
}

export function assessPlanningPlacement(
  model: PlanningMassModel,
  envelopeSteps: PlanningEnvelopeStep[]
): PlanningPlacementAssessment {
  const checkBudget = createPlanningGeometryBudget();
  const envelopeByLevel = new Map(
    envelopeSteps.map((step) => [step.level, step])
  );

  const floors = model.floors.map((floor) => {
    const envelope = envelopeByLevel.get(floor.level);
    const placement = envelope
      ? assessFootprint(floor.shape, envelope, checkBudget)
      : { fits: false, outsidePointCount: floor.shape.length };
    const areaFits = Number.isFinite(floor.capacityShortfallSqm) && floor.capacityShortfallSqm <= 0.1;

    return {
      floorId: floor.id,
      level: floor.level,
      label: floor.label,
      areaFits,
      placementFits: placement.fits,
      fits: areaFits && placement.fits,
      outsidePointCount: placement.outsidePointCount,
      capacityShortfallSqm: floor.capacityShortfallSqm,
    };
  });

  return {
    allFloorsFit: floors.every((floor) => floor.fits),
    areaOverCapacityFloorCount: floors.filter((floor) => !floor.areaFits).length,
    outsideFloorCount: floors.filter((floor) => !floor.placementFits).length,
    totalCapacityShortfallSqm: floors.reduce(
      (sum, floor) => sum + floor.capacityShortfallSqm,
      0
    ),
    floors,
  };
}
