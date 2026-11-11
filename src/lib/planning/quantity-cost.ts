import Decimal from "decimal.js";
import type { PlanningScenario } from "./types";
import { takeoffPlanningQuantities, type QuantityTakeoff } from "./quantity-takeoff";
import { additionalDwellingCostManwon } from "./dwelling-program";
import { calculatePlanningMaterialAdjustment } from "./materials";
import { isPlanningGeometryLocked } from "./geometry-source";
import { assessInteriorLayout } from "./interior-layout";
import { planningGeometryInputBasis, type PlanningGeometrySnapshot } from "./planning-geometry";
import {
  QUANTITY_COST_VERSION, quantityCostPlanSchema, quantityCostInputsSchema, quantityAdjustmentForBase,
  type QuantityCostPlan, type QuantityCostContract, type QuantityCostInputs,
} from "./quantity-cost-contract";

export const QUANTITY_COST_SCOPE: Record<QuantityCostPlan["lines"][number]["id"], string> = {
  partitionLengthM: "세대 내부 공유 구획선 총길이. 개구부 미공제, 현 층고 기준, 문 세트·마감·외벽·공용부 제외",
  interiorDoorCount: "실간 문 세트. 벽체·현관문 제외",
  entryDoorCount: "세대 현관문 세트. 실간 문·공용 출구 제외",
  dryFloorAreaSqm: "욕실 외 상세 실 유효 바닥마감. 주방기구·설비 제외",
  wetFloorAreaSqm: "욕실 유효 바닥 방수·마감. 벽체·문·기구·연결설비 제외",
  kitchenCount: "주방기구·연결설비 패키지. 바닥·벽체·문 및 공용 배관 제외",
  bathroomCount: "욕실기구·연결설비 패키지. 바닥방수·마감·벽체·문 및 공용 배관 제외",
};
export interface QuantityCostAssessment {
  status: "absent" | "ready" | "missing" | "stale" | "conflict";
  adjustmentManwon: number | null;
  issues: string[];
  takeoff: QuantityTakeoff | null;
  contract: QuantityCostContract | null;
}

export function createQuantityCostDraft(scenario: PlanningScenario, inputs: QuantityCostInputs): QuantityCostPlan {
  const takeoff = takeoffPlanningQuantities(scenario);
  return { version: QUANTITY_COST_VERSION, sourceBasis: takeoff.basis, inputs: { ...inputs },
    lines: takeoff.items.map(item => ({ id: item.id, treatment: "unpriced", unitRateWon: null, includedAllowanceWon: null,
      evidenceStatus: "assumed", source: "", allowanceSource: "", scopeConfirmed: false })) };
}

export function evaluateQuantityCost(scenario: PlanningScenario, inputs: QuantityCostInputs): QuantityCostAssessment {
  const result: QuantityCostAssessment = { status: "absent", adjustmentManwon: null, issues: [], takeoff: null, contract: null };
  if (!scenario.quantityCost) return result;
  const parsed = quantityCostPlanSchema.safeParse(scenario.quantityCost), parsedInputs = quantityCostInputsSchema.safeParse(inputs);
  if (!parsed.success || !parsedInputs.success) return { ...result, status: "conflict", issues: ["수량 원가 입력 형식·한도가 올바르지 않습니다."] };
  const plan = parsed.data, takeoff = takeoffPlanningQuantities(scenario);
  result.takeoff = takeoff;
  if (plan.sourceBasis !== takeoff.basis || plan.inputs.constructionCostPerSqmWon !== inputs.constructionCostPerSqmWon ||
      plan.inputs.basementCostMultiplier !== inputs.basementCostMultiplier) {
    return { ...result, status: "stale", issues: ["평면·층고·면적·기본 공사비 기준이 변경됐습니다. 상세 수량과 기존 포함액을 다시 검토해야 합니다."] };
  }
  if (takeoff.status !== "preliminary") return { ...result, status: takeoff.status, issues: takeoff.issues };
  const dwelling = scenario.dwellingProgram;
  if (dwelling !== undefined && (!dwelling || !Number.isInteger(dwelling.baselineDwellingCount) || dwelling.baselineDwellingCount < 0 ||
      !Number.isFinite(dwelling.additionalDwellingCostWon) || dwelling.additionalDwellingCostWon < 0)) {
    return { ...result, status: "conflict", issues: ["기존 세대 가산비의 기준 세대수·단가가 올바르지 않아 중복 비용을 대사할 수 없습니다."] };
  }
  const issues: string[] = [];
  const dwellingPremium = additionalDwellingCostManwon(scenario.floorPrograms, scenario.dwellingProgram);
  let allowance = new Decimal(0), replacement = new Decimal(0), above = new Decimal(0), basement = new Decimal(0);
  for (const floor of scenario.floorPrograms) for (const zone of floor.zones) {
    if (floor.level < 0) basement = basement.plus(zone.areaSqm);
    else above = above.plus(zone.areaSqm);
  }
  const base = above.plus(basement.times(inputs.basementCostMultiplier)).times(inputs.constructionCostPerSqmWon);
  const lines = plan.lines.map(line => {
    const item = takeoff.items.find(item => item.id === line.id)!;
    if (line.treatment === "unpriced") issues.push(`${item.label}: 기본단가 포함 여부 또는 교체 견적이 미확정입니다.`);
    if (!line.scopeConfirmed || !line.source.trim()) issues.push(`${item.label}: 공종 범위 확인과 단가·포함 근거가 필요합니다.`);
    if (line.treatment === "replace-allowance") {
      if (line.unitRateWon === null || line.includedAllowanceWon === null || !line.allowanceSource.trim()) {
        issues.push(`${item.label}: 단가와 기본 공사비의 동일 공종 포함액·출처를 입력해야 합니다.`);
      } else {
        allowance = allowance.plus(line.includedAllowanceWon);
        replacement = replacement.plus(new Decimal(item.quantity!).times(line.unitRateWon));
      }
      if (dwellingPremium > 0 && ["kitchenCount", "bathroomCount"].includes(line.id)) {
        issues.push(`${item.label}: 추가 세대 가산비에 주방·욕실·배관이 포함돼 중복 위험이 있습니다. 기존 세대 가산비를 먼저 대사해야 합니다.`);
      }
    }
    return { ...line, quantity: item.quantity! };
  });
  if (allowance.gt(base)) issues.push("교체 공종의 기존 포함액 합계가 기본 연면적 공사비보다 큽니다.");
  if (base.eq(0) && plan.lines.some(l => l.treatment === "replace-allowance")) issues.push("기본 공사비가 0이면 포함 범위 교체를 계산할 수 없습니다.");
  if (issues.length) return { ...result, status: "missing", issues };
  const contract: QuantityCostContract = { ...plan, lines, constructionAreas: { aboveGroundSqm: above.toNumber(), basementSqm: basement.toNumber() },
    baseConstructionCostWon: base.toNumber(), allowanceWon: allowance.toNumber(),
    replacementCostWon: replacement.toNumber(), adjustmentManwon: replacement.minus(allowance).div(10000).toNumber() };
  try {
    const adjustmentManwon = quantityAdjustmentForBase(contract, base.div(10000).toNumber());
    const hardCost = base.div(10000).toNumber() + adjustmentManwon + dwellingPremium + calculatePlanningMaterialAdjustment(scenario).adjustmentManwon;
    if (!Number.isFinite(hardCost) || hardCost < 0) throw new Error("기존 재료·세대 증감과 상세 원가를 합산한 공사비가 음수이거나 유효하지 않습니다.");
    return { ...result, status: "ready", adjustmentManwon, contract };
  } catch (error) {
    return { ...result, status: "conflict", issues: [error instanceof Error ? error.message : "수량 원가 검증 실패"] };
  }
}

/** Only the explicit adoption path changes economics; previewing/editing quantities does not. */
export function applyQuantityCost(scenario: PlanningScenario, draft: QuantityCostPlan, inputs: QuantityCostInputs,
  geometry: PlanningGeometrySnapshot | null): { patch?: Partial<PlanningScenario>; error?: string } {
  if (isPlanningGeometryLocked(scenario)) return { error: "잠긴 대표 계획안은 변경할 수 없습니다." };
  if (scenario.fullQuoteAdoption !== undefined) return { error: "전체 견적 채택을 먼저 해제해야 상세 수량 원가를 변경할 수 있습니다." };
  if (!geometry || geometry.projectId !== scenario.projectId || geometry.scenarioId !== scenario.id ||
      geometry.scenarioInputBasis !== planningGeometryInputBasis(scenario) ||
      scenario.floorPrograms.some(f => f.zones.some(z => z.useType === "residential") &&
        assessInteriorLayout(f, geometry.building.floors.find(g => g.id === f.id)?.shape).status !== "preliminary-fit")) {
    return { error: "현재 평면과 실제 층 형상의 연결을 먼저 확인해야 합니다." };
  }
  const result = evaluateQuantityCost({ ...scenario, quantityCost: draft }, inputs);
  if (result.status !== "ready") return { error: result.issues[0] ?? "수량 원가 검토가 미완료입니다." };
  return { patch: { quantityCost: structuredClone(draft), checks: [], economicsPreview: { ...scenario.economicsPreview, status: "stale" } } };
}
