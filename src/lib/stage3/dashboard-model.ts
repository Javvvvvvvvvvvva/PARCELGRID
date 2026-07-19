import type { ScenarioVM } from "@/lib/adapters/view-model";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningScenario } from "@/lib/planning/types";

export type Stage3BlockCode =
  | "missing-representative"
  | "missing-planning-scenario"
  | "project-mismatch"
  | "missing-geometry"
  | "stale-geometry"
  | "invalid-geometry"
  | "missing-finance-scenario";

export interface Stage3DashboardInput {
  projectId: string;
  representativeScenarioId: string | null;
  representativeGeometrySnapshot: PlanningGeometrySnapshot | null;
  planningScenarios: PlanningScenario[];
  financeScenarios: ScenarioVM[];
}

export type Stage3DashboardContext =
  | {
      ready: true;
      planningScenario: PlanningScenario;
      geometry: PlanningGeometrySnapshot;
      financeScenario: ScenarioVM;
    }
  | {
      ready: false;
      code: Stage3BlockCode;
      title: string;
      message: string;
    };

function blocked(
  code: Stage3BlockCode,
  title: string,
  message: string
): Stage3DashboardContext {
  return { ready: false, code, title, message };
}

/**
 * Stage 3 must consume the exact representative plan locked in Stage 2.
 * It never falls back to a legacy recommended scenario or an unrelated
 * financial scenario because that would mix geometry and money assumptions.
 */
export function resolveStage3DashboardContext(
  input: Stage3DashboardInput
): Stage3DashboardContext {
  const representativeId = input.representativeScenarioId;
  if (!representativeId) {
    return blocked(
      "missing-representative",
      "대표 계획안이 확정되지 않았습니다",
      "계획 스튜디오에서 기하 검증을 통과한 계획안을 대표안으로 확정해야 사업성 분석을 시작할 수 있습니다."
    );
  }

  const planningScenario = input.planningScenarios.find(
    (scenario) => scenario.id === representativeId
  );
  if (!planningScenario) {
    return blocked(
      "missing-planning-scenario",
      "대표 계획안을 찾을 수 없습니다",
      "저장된 대표 계획안과 프로젝트 상태가 일치하지 않습니다. 계획 스튜디오에서 대표안을 다시 확정하세요."
    );
  }

  if (
    planningScenario.projectId &&
    planningScenario.projectId !== input.projectId
  ) {
    return blocked(
      "project-mismatch",
      "다른 프로젝트의 계획안입니다",
      "대표 계획안의 프로젝트 ID가 현재 프로젝트와 다릅니다. 숫자를 표시하지 않고 분석을 차단했습니다."
    );
  }

  const geometry = input.representativeGeometrySnapshot;
  if (!geometry) {
    return blocked(
      "missing-geometry",
      "Geometry Snapshot이 없습니다",
      "대표 계획안의 실제 매스가 잠기지 않았습니다. 계획 스튜디오에서 Geometry Snapshot을 다시 생성하세요."
    );
  }

  if (
    geometry.projectId !== input.projectId ||
    geometry.scenarioId !== representativeId ||
    geometry.scenarioVersion !== planningScenario.version
  ) {
    return blocked(
      "stale-geometry",
      "대표안과 Geometry Snapshot이 일치하지 않습니다",
      "계획안 ID·버전·프로젝트 중 하나가 변경되었습니다. 최신 계획안으로 대표안을 다시 확정해야 합니다."
    );
  }

  if (
    geometry.validation.status === "fail" ||
    !geometry.validation.representativeEligible
  ) {
    return blocked(
      "invalid-geometry",
      "기하 검증을 통과하지 못했습니다",
      geometry.validation.issues.find((issue) => issue.severity === "fail")
        ?.message ??
        "대표안 확정 또는 내보내기를 막는 기하 검증 실패가 있습니다."
    );
  }

  const financeScenario = input.financeScenarios.find(
    (scenario) => scenario.id === representativeId
  );
  if (!financeScenario) {
    return blocked(
      "missing-finance-scenario",
      "사업성 계산이 아직 준비되지 않았습니다",
      "대표 계획안과 동일한 ID의 금융 시나리오가 없습니다. 프로젝트 재계산 후 다시 확인하세요."
    );
  }

  return {
    ready: true,
    planningScenario,
    geometry,
    financeScenario,
  };
}
