/**
 * Envelope 계획 적용 — 사용자가 명시적으로 선택할 때만 store·분석에 반영.
 * (권장안이 Envelope를 자동으로 바꾸지 않음 — "권장안 적용" 버튼 전용)
 */

import type { Parcel } from "@/lib/finance/types";
import type { ScenarioComparison, ScenarioOption } from "@/lib/finance/scenario-verdict";
import type { EnvelopePlan } from "@/lib/stores/project-store";
import type { ProjectComputed } from "@/lib/services/compute-project";
import { recomputeFromEnvelope } from "@/lib/services/recompute-from-envelope";

/** 권장안 → EnvelopePlan (기존 시나리오 유형·상품 기준면적 유지) */
export function envelopePlanFromRecommended(
  current: EnvelopePlan,
  recommended: ScenarioOption,
  unitAreaSqm: number
): EnvelopePlan {
  return {
    ...current,
    farPct: recommended.farUsedPct,
    floors: recommended.floors,
    units: recommended.units,
    unitAreaSqm,
    avgUnitAreaSqm:
      recommended.units > 0 ? recommended.gfaSqm / recommended.units : 0,
    requiredCars: recommended.parking.requiredCars,
  };
}

/** 내 계획과 권장안이 동일한지 (적용 버튼 숨김/비활성) */
export function recommendedMatchesInput(
  input: ScenarioOption | undefined,
  recommended: ScenarioOption
): boolean {
  if (!input) return false;
  return input.floors === recommended.floors && input.units === recommended.units;
}

/** EnvelopePlan 저장 + 분석 재계산 */
export function applyEnvelopePlan(
  parcel: Parcel,
  plan: EnvelopePlan,
  prev: ProjectComputed | null,
  setEnvelopePlan: (plan: EnvelopePlan) => void,
  setData: (data: ProjectComputed) => void
): boolean {
  setEnvelopePlan(plan);
  const recomputed = recomputeFromEnvelope(parcel, plan, prev);
  if (!recomputed) return false;
  setData(recomputed);
  return true;
}

/** 권장안을 Envelope·분석에 반영 (비교 화면 "권장안 적용") */
export function applyRecommendedPlan(
  parcel: Parcel,
  comparison: ScenarioComparison,
  currentPlan: EnvelopePlan | null,
  prev: ProjectComputed | null,
  setEnvelopePlan: (plan: EnvelopePlan) => void,
  setData: (data: ProjectComputed) => void
): boolean {
  if (!currentPlan?.scenarioType) return false;
  const plan = envelopePlanFromRecommended(
    currentPlan,
    comparison.recommended,
    comparison.unitAreaSqm
  );
  return applyEnvelopePlan(parcel, plan, prev, setEnvelopePlan, setData);
}
