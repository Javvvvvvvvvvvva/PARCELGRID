import type { ScenarioVM } from "@/lib/adapters/view-model";
import {
  FINANCIAL_GEOMETRY_CONTRACT_VERSION,
  STAGE2_ECONOMICS_CONTRACT_VERSION,
} from "@/lib/finance/types";
import {
  REVENUE_PRICING_MODEL_VERSION,
  REVENUE_VALUATION_MODEL_VERSION,
} from "@/lib/finance/revenue-contract";
import { PLANNING_GEOMETRY_VERSION, type PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import type { PlanningScenario } from "@/lib/planning/types";
import type { Parcel } from "@/lib/finance/types";
import { analysisReferenceIsCurrent } from "@/lib/planning/analysis-reference-contract";

export type Stage3BlockCode =
  | "missing-representative"
  | "missing-planning-scenario"
  | "project-mismatch"
  | "invalid-planning-checks"
  | "missing-geometry"
  | "stale-geometry"
  | "invalid-geometry"
  | "missing-finance-scenario"
  | "missing-finance-contract"
  | "stale-finance-contract";

export interface Stage3DashboardInput {
  parcel?: Parcel;
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

  const analysisGeometry = input.representativeGeometrySnapshot;
  const hasAnalysisReference = analysisGeometry?.analysisReference !== undefined;
  if (hasAnalysisReference && !analysisReferenceIsCurrent(planningScenario, input.parcel, analysisGeometry!)) {
    return blocked("stale-geometry", "예비 분석 기준안이 변경됐습니다", "대지·계획·구획·주차 입력을 다시 검사하고 예비 분석 기준안을 재선택해야 합니다.");
  }
  const checkReadiness = assessRepresentativeCheckReadiness(
    planningScenario.checks
  );
  if (!hasAnalysisReference && !checkReadiness.ready) {
    return blocked(
      "invalid-planning-checks",
      "법규·주차 검증이 완료되지 않았습니다",
      checkReadiness.blockers[0]?.message ??
        "건폐율·용적률·높이·주차 검증을 모두 통과해야 합니다."
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
    geometry.version !== PLANNING_GEOMETRY_VERSION ||
    geometry.projectId !== input.projectId ||
    geometry.scenarioId !== representativeId ||
    geometry.scenarioVersion !== planningScenario.version
  ) {
    return blocked(
      "stale-geometry",
      "대표안과 Geometry Snapshot이 일치하지 않습니다",
      "형상 계산 엔진·계획안 버전·프로젝트 중 하나가 변경되었습니다. 최신 기준으로 대표안을 다시 검증해야 합니다."
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

  const areaContract = financeScenario._raw?.program.areaContract;
  if (!areaContract) {
    return blocked(
      "missing-finance-contract",
      "Stage 2 면적 계약이 없습니다",
      "대표 계획안의 여섯 수익 풀과 실제 공사면적이 금융 시나리오에 전달되지 않았습니다. 계획 스튜디오에서 대표안을 다시 확정하세요."
    );
  }

  const geometryProgramArea = geometry.building?.totalProgramAreaSqm;
  const geometryHash = areaContract.geometrySource?.geometryHash;
  const staleContract =
    areaContract.schemaVersion !== FINANCIAL_GEOMETRY_CONTRACT_VERSION ||
    areaContract.revenueProjection == null ||
    areaContract.revenueProjection?.modelVersion !==
      REVENUE_VALUATION_MODEL_VERSION ||
    areaContract.revenueProjection?.pricing.modelVersion !==
      REVENUE_PRICING_MODEL_VERSION ||
    areaContract.stage2Economics == null ||
    areaContract.stage2Economics?.modelVersion !==
      STAGE2_ECONOMICS_CONTRACT_VERSION ||
    areaContract.sourceScenarioId !== planningScenario.id ||
    areaContract.sourceScenarioVersion !== planningScenario.version ||
    (!geometryHash || geometryHash !== geometry.geometryHash) ||
    (Number.isFinite(geometryProgramArea) &&
      Math.abs(
        areaContract.constructionAreaSqm - Number(geometryProgramArea)
      ) > 0.05);
  if (staleContract) {
    return blocked(
      "stale-finance-contract",
      "대표안과 금융 면적 계약이 일치하지 않습니다",
      "계획안 버전·Geometry Hash·공사면적·수익 풀 중 하나가 현재 대표안과 다릅니다. 숫자를 표시하지 않고 재확정을 요청합니다."
    );
  }

  return {
    ready: true,
    planningScenario,
    geometry,
    financeScenario,
  };
}
