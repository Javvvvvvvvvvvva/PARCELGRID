import type {
  LocalPlanPoint,
  PlanningEnvelopeStep,
  PlanningMassModel,
} from "@/lib/planning/planning-massing";

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

/**
 * 계획 외곽선의 모든 꼭짓점과 변 내부 샘플이 법규 외곽선 안에 있는지 확인한다.
 * 회전·이동으로 오목한 법규 외곽선을 가로지르는 경우도 변 샘플로 감지한다.
 */
export function polygonInsidePolygon(
  inner: LocalPlanPoint[],
  outer: LocalPlanPoint[]
): { fits: boolean; outsidePointCount: number } {
  if (inner.length < 3 || outer.length < 3) {
    return { fits: false, outsidePointCount: inner.length };
  }

  const samples: LocalPlanPoint[] = [...inner];
  inner.forEach((point, index) => {
    const next = inner[(index + 1) % inner.length];
    samples.push(...edgeSamples(point, next));
  });

  const outsidePointCount = samples.reduce(
    (count, point) =>
      count + (pointInPolygonInclusive(point, outer) ? 0 : 1),
    0
  );

  return { fits: outsidePointCount === 0, outsidePointCount };
}

export function assessPlanningPlacement(
  model: PlanningMassModel,
  envelopeSteps: PlanningEnvelopeStep[]
): PlanningPlacementAssessment {
  const envelopeByLevel = new Map(
    envelopeSteps.map((step) => [step.level, step])
  );

  const floors = model.floors.map((floor) => {
    const envelope = envelopeByLevel.get(floor.level);
    const placement = envelope
      ? polygonInsidePolygon(floor.shape, envelope.shape)
      : { fits: false, outsidePointCount: floor.shape.length };
    const areaFits = floor.capacityShortfallSqm <= 0.1;

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
