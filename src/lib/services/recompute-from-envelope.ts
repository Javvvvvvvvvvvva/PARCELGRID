/**
 * envelope 계획 기반 시나리오 생성 + 재계산 (방법 B — envelope이 100% 진실).
 *
 * 핵심: 기존 generateScenarios(180%·3층 기본값)를 쓰지 않는다.
 *  - 메인 = 내 envelope 계획 그대로 (단독 2층 195% → 분석도 정확히 그대로).
 *  - 비교 = 다른 유형의 envelope 최대값 (calcScenarioScale 엔진).
 *  - 전부 envelope 로직에서 생성 → "내가 정한 게 그대로 나온다".
 *
 * 실거래(comps)는 기존 data에서 보존 (시나리오 무관).
 */

import type { Parcel, Scenario, BuildingProgram } from "@/lib/finance/types";
import type { EnvelopePlan } from "@/lib/stores/project-store";
import type { ProjectComputed, ComputeOptions } from "@/lib/services/compute-project";
import { computeProject } from "@/lib/services/compute-project";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { estimateSalePriceFromComps } from "@/lib/finance/sale-price-from-comps";
import { calcEnvelope } from "@/lib/finance/envelope";
import { calcScenarioScale, type ScenarioType } from "@/lib/finance/scenario-envelope";
import { planToProgram } from "@/lib/finance/plan-to-program";
import { buildScenarioComparison } from "@/lib/finance/scenario-verdict";
import { estimateFloorHeightM } from "@/lib/integrations/molit-building";

const LABELS: Record<ScenarioType, string> = {
  "single-house": "단독주택 신축매매",
  "multi-family": "다가구주택 신축매매",
  retail: "근린생활시설",
};

const ALL_TYPES: ScenarioType[] = ["single-house", "multi-family", "retail"];

/** 타입 + envelope 최대값 → BuildingProgram (비교 시나리오용) */
function programForMax(
  type: ScenarioType,
  parcel: Parcel,
  unitAreaSqm: number
): BuildingProgram {
  const env = calcEnvelope(parcel.lotArea, parcel.maxBCR, parcel.maxFAR);
  const scale = calcScenarioScale(type, env, "", unitAreaSqm);
  // 실제 사용 용적률 = 최대 연면적 / 대지 × 100
  const farUsed = Math.round((scale.maxGfaSqm / parcel.lotArea) * 100);
  const isRetail = type === "retail";
  return {
    type,
    far: farUsed,
    bcr: parcel.maxBCR,
    floorsAbove: scale.floors,
    floorsBelow: 0,
    units: {
      residential: isRetail ? 0 : scale.maxUnits,
      retail: isRetail ? 1 : 0,
    },
    mix: isRetail
      ? { residentialSale: 0, residentialLease: 0, retail: 1 }
      : { residentialSale: 1, residentialLease: 0, retail: 0 },
  };
}

/**
 * envelope 계획으로 시나리오 생성 + computeProject.
 * @param parcel 대지
 * @param plan envelope 확정 계획
 * @param prev 기존 ProjectComputed (comps 보존)
 * @param options computeProject 옵션
 */
export function recomputeFromEnvelope(
  parcel: Parcel,
  plan: EnvelopePlan,
  prev: ProjectComputed | null,
  options: ComputeOptions = {}
): ProjectComputed | null {
  if (!plan.scenarioType) return null;

  const mainProgram = planToProgram(plan, parcel);
  if (!mainProgram) return null;

  const assumptions = defaultAssumptions();

  // ─── 매각 단가 실거래 자동 보정 (Comparable Scoring — C 설계) ───
  // 같은동 +40 · 준공15년 +30 · 20년 +15 가중 → 상위 8건 중앙값.
  // 참고 사례 목록은 saleEst.cases (화면 표시용 — 알고리즘 분석 근거).
  const saleEst = estimateSalePriceFromComps(prev?.comps ?? []);
  if (saleEst) {
    assumptions.salePricePerSqM = saleEst.salePricePerSqM;
    console.log(
      `매각 단가 실거래 보정: ${saleEst.basis} 평당 ${saleEst.medianPPP.toLocaleString()}만 → ${saleEst.salePricePerSqM.toLocaleString()}원/㎡ (보수: 전체 ${saleEst.conservativeCount}건 평당 ${saleEst.conservativePPP.toLocaleString()}만)`
    );
  }

  // 메인 = 내 계획 그대로 (envelope 값)
  const main: Scenario = {
    id: "ENV-MAIN",
    name: `${LABELS[plan.scenarioType]} (내 계획)`,
    shortName: "내 계획",
    tag: "내 계획",
    program: mainProgram,
    assumptions,
  };

  // 비교 = 다른 유형 최대값 (envelope 엔진)
  const others = ALL_TYPES.filter((t) => t !== plan.scenarioType);
  const comparisons: Scenario[] = others.map((type, i) => ({
    id: `ENV-CMP${i + 1}`,
    name: LABELS[type],
    shortName: LABELS[type],
    tag: "비교",
    program: programForMax(type, parcel, plan.unitAreaSqm),
    assumptions,
  }));

  const scenarios = [main, ...comparisons];

  const computed = computeProject(parcel, scenarios, {
    calculateMaxAcquisition: true, // 대시보드 최대 인수가 패널 유지 (~100ms)
    ...options,
    recommendedId: main.id, // 내 계획을 메인으로 고정
  });

  // 권장+최대 시나리오 비교 (의사결정 도구)
  // 세대당 면적 = envelope에서 선택한 신축 상품 유형 표준값 (C 확정).
  // 기존(구)건물의 세대당 면적은 신축 설계와 무관하므로 기준으로 쓰지 않는다.
  // 층고 참고값만 기존 건물 실측(높이÷지상층수) 사용 (있을 때).
  const existingFloorHeight =
    parcel.currentBuilding != null
      ? estimateFloorHeightM(parcel.currentBuilding)
      : null;
  const scenarioComparison = buildScenarioComparison(
    plan.scenarioType,
    parcel,
    plan.floors,
    plan.units,
    plan.unitAreaSqm,
    existingFloorHeight ?? undefined
  );

  // 실거래 보존
  if (prev && prev.comps && prev.comps.length > 0) {
    return {
      ...computed,
      comps: prev.comps,
      scenarioComparison,
      saleEstimate: saleEst ?? undefined,
    };
  }
  return { ...computed, scenarioComparison };
}
