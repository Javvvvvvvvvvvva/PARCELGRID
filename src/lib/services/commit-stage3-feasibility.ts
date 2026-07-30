import type { Parcel, Scenario } from "@/lib/finance/types";
import {
  computeProject,
  type ProjectComputed,
} from "@/lib/services/compute-project";

/**
 * Stage 3의 현재 토지값·금융 가정을 다시 계산해 Stage 5 보고서가 읽는
 * ProjectComputed 스냅샷으로 저장한다.
 *
 * 비교용 저장 계획안은 유지하되 대표안만 현재 편집값으로 교체한다.
 * 실거래·매각단가 근거는 재계산 과정에서 유실되지 않도록 보존한다.
 */
export function commitStage3FeasibilitySnapshot(
  previous: ProjectComputed,
  parcel: Parcel,
  activeScenario: Scenario
): ProjectComputed {
  let replaced = false;
  const scenarios = previous.scenarios.map((item) => {
    if (item.id !== activeScenario.id) return item._raw;
    replaced = true;
    return activeScenario;
  });
  if (!replaced) scenarios.unshift(activeScenario);

  const computed = computeProject(parcel, scenarios, {
    startDate: parcel.acquired,
    recommendedId: activeScenario.id,
    calculateMaxAcquisition: true,
  });

  return {
    ...computed,
    comps: previous.comps,
    saleEstimate: previous.saleEstimate,
    // Stage 2의 구형 권장/최대 비교는 현재 Stage 3 대표안과 기준이 다르다.
    scenarioComparison: undefined,
  };
}
