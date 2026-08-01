import type {
  PlanningGeometrySource,
  PlanningGeometrySourceMode,
  PlanningScenario,
} from "./types";

export const DEFAULT_PLANNING_GEOMETRY_SOURCE: PlanningGeometrySource = {
  mode: "engine-generated",
  exactGeometryAvailable: true,
  locked: false,
};

export function createPlanningGeometrySource(
  mode: PlanningGeometrySourceMode
): PlanningGeometrySource {
  if (mode === "engine-generated") {
    return { ...DEFAULT_PLANNING_GEOMETRY_SOURCE };
  }
  return {
    mode,
    exactGeometryAvailable: false,
    locked: false,
  };
}

export function resolvePlanningGeometrySource(
  scenario: Pick<PlanningScenario, "geometrySource">
): PlanningGeometrySource {
  return scenario.geometrySource
    ? { ...scenario.geometrySource }
    : { ...DEFAULT_PLANNING_GEOMETRY_SOURCE };
}

export function isPlanningGeometryLocked(
  scenario: Pick<PlanningScenario, "geometrySource">
): boolean {
  return resolvePlanningGeometrySource(scenario).locked;
}

export function planningGeometrySourceLabel(
  mode: PlanningGeometrySourceMode
): string {
  if (mode === "external-model") return "외부 설계 모델";
  if (mode === "reference-image") return "기준 이미지";
  return "엔진 생성 매스";
}

/**
 * 잠긴 계획안의 형상을 바꾸는 필드를 데이터 계층에서도 차단한다.
 * 이름·설명·재료·잠금 해제 같은 비형상 편집은 계속 허용한다.
 */
export function protectLockedPlanningGeometryPatch<
  T extends Partial<PlanningScenario>,
>(scenario: PlanningScenario, patch: T): T {
  if (!isPlanningGeometryLocked(scenario)) return patch;

  const protectedPatch: Partial<PlanningScenario> = { ...patch };
  delete protectedPatch.primaryUse;
  delete protectedPatch.floorPrograms;
  delete protectedPatch.placement;
  delete protectedPatch.parking;
  return protectedPatch as T;
}
