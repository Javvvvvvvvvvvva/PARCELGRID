import Decimal from "decimal.js";
import { z } from "zod";
import { assessConstructionQuote, buildConstructionScopeLedger, constructionQuoteSchema } from "./construction-quote";
import { DWELLING_PROGRAM_VERSION } from "./dwelling-program";
import { calculatePlanningMaterialAdjustment } from "./materials";
import { planningMaterialSelectionSchema as materialsSchema } from "./material-contract";
import { planningGeometryInputBasis, type PlanningGeometrySnapshot } from "./planning-geometry";
import { evaluateQuantityCost } from "./quantity-cost";
import { quantityCostInputsSchema, quantityCostPlanSchema, type QuantityCostInputs } from "./quantity-cost-contract";
import type { PlanningScenario } from "./types";

export const CONSTRUCTION_QUOTE_COST_COMPARISON_VERSION = "construction-quote-cost-comparison-2026.1" as const;

export interface ConstructionQuoteCostComparison {
  version: typeof CONSTRUCTION_QUOTE_COST_COMPARISON_VERSION;
  /** Ready means numeric input comparison, never suitability for adoption or approval. */
  status: "ready" | "absent" | "missing" | "stale" | "conflict";
  financialApplied: false;
  approvalStatus: "unverified";
  baseConstructionCostWon: number | null;
  materialAdjustmentWon: number | null;
  additionalDwellingCostWon: number | null;
  quantityAdjustmentWon: number | null;
  currentConstructionCostWon: number | null;
  quoteConstructionCostWon: number | null;
  differenceWon: number | null;
  issues: string[];
  scopeNotes: string[];
}

const area = z.number().finite().min(0).max(1e9);
const money = z.number().finite().min(0).max(1e13);
const useType = z.enum(["residential", "retail", "office", "parking", "piloti", "common", "mechanical", "storage", "other"]);
const zoneSchema = z.object({ areaSqm: area });
const floorSchema = z.object({
  level: z.number().int().min(-32).max(32).refine(value => value !== 0),
  zones: z.array(zoneSchema).min(1).max(32),
});
const baseFloorsSchema = z.array(floorSchema).min(1).max(32);
const materialFloorsSchema = z.array(floorSchema.extend({
  floorHeightM: z.number().finite().positive().max(12),
  zones: z.array(zoneSchema.extend({ useType })).min(1).max(32),
})).min(1).max(32);
const dwellingFloorsSchema = z.array(z.object({
  zones: z.array(z.object({ useType, unitCount: z.number().int().min(0).max(500) })).min(1).max(32),
})).min(1).max(32);
const dwellingSchema = z.object({
  modelVersion: z.literal(DWELLING_PROGRAM_VERSION),
  baseNetRatio: z.number().finite(),
  extraCommonAreaPerSplitSqm: z.number().finite(),
  minimumCommonAreaSqm: z.number().finite(),
  baselineDwellingCount: z.number().int().min(0),
  additionalDwellingCostWon: money,
  costEvidenceStatus: z.enum(["assumed", "user-input", "quoted"]),
  costSource: z.string().optional(),
  // Sale pricing and nested market evidence do not participate in construction cost.
  salePriceBands: z.array(z.unknown()).optional(),
}).strict();
const currentFields = ["baseConstructionCostWon", "materialAdjustmentWon", "additionalDwellingCostWon", "quantityAdjustmentWon"] as const;
type MoneyField = typeof currentFields[number] | "currentConstructionCostWon" | "quoteConstructionCostWon" | "differenceWon";
const statusPriority = { ready: 0, absent: 1, missing: 2, stale: 3, conflict: 4 } as const;
const moneyLabels: Record<MoneyField, string> = {
  baseConstructionCostWon: "기본 공사비", materialAdjustmentWon: "재료 증감액", additionalDwellingCostWon: "추가 세대 가산비",
  quantityAdjustmentWon: "수량 원가 조정액", currentConstructionCostWon: "현재 직접 공사비",
  quoteConstructionCostWon: "전체 견적 공사비", differenceWon: "교체 비교 차액",
};

/** Recompute raw current costs and compare a reconciled quote without changing either input. */
export function evaluateConstructionQuoteCostComparison(
  scenario: PlanningScenario,
  inputs: QuantityCostInputs,
  geometry?: PlanningGeometrySnapshot,
): ConstructionQuoteCostComparison {
  const result: ConstructionQuoteCostComparison = {
    version: CONSTRUCTION_QUOTE_COST_COMPARISON_VERSION, status: "ready", financialApplied: false, approvalStatus: "unverified",
    baseConstructionCostWon: null, materialAdjustmentWon: null, additionalDwellingCostWon: null, quantityAdjustmentWon: null,
    currentConstructionCostWon: null, quoteConstructionCostWon: null, differenceWon: null, issues: [],
    scopeNotes: [
      "차액은 견적과 현재 직접 공사비의 차이이며, 추가 가산액이나 확정 절감액이 아닙니다.",
      "철거비·설계 및 간접비·예비비·금융비는 별도입니다. 견적 포함 범위와 재료·세대·수량 비용의 중복 여부는 미확정입니다.",
      "부가세 기준은 입력자의 선언입니다. 공종별 과세·면세·환급 적용은 미확정입니다.",
      "전체 공종 물량·견적 원문 진위·전문가 검토·공식 승인은 미확정입니다.",
      "해당 없음은 공종 범위 선언이며, 0원 견적을 뜻하지 않습니다.",
    ],
  };
  const block = (status: ConstructionQuoteCostComparison["status"], issue: string) => {
    if (statusPriority[status] > statusPriority[result.status]) result.status = status;
    if (!result.issues.includes(issue)) result.issues.push(issue);
  };
  const amounts: Partial<Record<MoneyField, Decimal>> = {};
  const setMoney = (field: MoneyField, value: Decimal, signed = false) => {
    const numeric = value.toNumber();
    if (!value.isFinite() || !Number.isFinite(numeric) || (!signed && value.isNegative())) {
      block("conflict", `${moneyLabels[field]}: ${signed ? "유한한 금액이어야 합니다." : "유한한 0 이상의 금액이어야 합니다."}`);
      return;
    }
    amounts[field] = value;
    result[field] = numeric;
  };
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
    block("conflict", "현재 계획안의 입력 형식이 올바르지 않습니다.");
    return result;
  }

  const parsedInputs = quantityCostInputsSchema.safeParse(inputs);
  const baseFloors = baseFloorsSchema.safeParse(scenario.floorPrograms);
  if (!parsedInputs.success) block("conflict", "기본 공사비 단가 또는 지하층 배율이 올바르지 않습니다.");
  if (!baseFloors.success) block("conflict", "공사 층·층수 또는 구역 면적이 누락됐거나 올바르지 않습니다.");
  if (parsedInputs.success && baseFloors.success) {
    const weightedArea = baseFloors.data.reduce((sum, floor) => sum.plus(
      floor.zones.reduce((subtotal, zone) => subtotal.plus(zone.areaSqm), new Decimal(0))
        .times(floor.level < 0 ? parsedInputs.data.basementCostMultiplier : 1),
    ), new Decimal(0));
    setMoney("baseConstructionCostWon", weightedArea.times(parsedInputs.data.constructionCostPerSqmWon));
  }

  // Validate before calling helpers that otherwise default, floor or clamp invalid values.
  const materials = scenario.materials === undefined ? undefined : materialsSchema.safeParse(scenario.materials);
  if (materials && !materials.success) {
    block("conflict", "재료 선택·수량·단가가 올바르지 않습니다. 기본값이나 0원으로 대체하지 않습니다.");
  } else if (!materials || (materials.data.primaryFacadeMaterial === "unselected" &&
      (materials.data.primaryFacadeSharePct === undefined || materials.data.primaryFacadeSharePct === 100) &&
      Object.keys(materials.data.faceAssignments ?? {}).length === 0)) {
    setMoney("materialAdjustmentWon", new Decimal(0), true);
    result.scopeNotes.push("재료 미선택은 적용된 재료 증감액이 0원이라는 뜻입니다. 외벽 공사가 무료라는 뜻이 아니며 기본 공사비의 포함액은 유지됩니다.");
  } else if (!materialFloorsSchema.safeParse(scenario.floorPrograms).success) {
    block("conflict", "재료 수량에 필요한 층고·용도·면적이 누락됐거나 올바르지 않습니다.");
  } else if (materials.data.pricingMode !== "by-material" &&
      (!(materials.data.baselineFacadeUnitCostPerSqmWon! > 0) || !(materials.data.selectedFacadeUnitCostPerSqmWon! > 0))) {
    block("missing", "선택한 재료의 기준 단가 또는 선택 단가가 미확정입니다. 증감액은 0원이 아닌 미산정입니다.");
  } else {
    try {
      const needsGeometry = Object.keys(materials.data.faceAssignments ?? {}).length > 0 ||
        scenario.economicsPreview?.facadeCost?.areaBasis === "geometry-derived";
      if ((needsGeometry && !geometry) || (geometry && (geometry.projectId !== scenario.projectId ||
          geometry.scenarioId !== scenario.id || geometry.scenarioVersion !== scenario.version ||
          geometry.scenarioInputBasis !== planningGeometryInputBasis(scenario)))) {
        block("stale", "현재 외벽 수량과 일치하는 형상 원본이 필요합니다. 면적 추정값으로 대체하지 않습니다.");
      } else {
      const material = calculatePlanningMaterialAdjustment(scenario, geometry);
      if (!material.priced || !Number.isFinite(material.facadeAreaSqm) || material.facadeAreaSqm < 0 ||
          !Number.isFinite(material.adjustmentWon)) {
        block("conflict", "재료 수량 또는 증감액을 유효한 금액으로 계산하지 못했습니다.");
      } else {
        setMoney("materialAdjustmentWon", new Decimal(material.adjustmentWon), true);
        if (material.areaBasis === "area-based-estimate") result.scopeNotes.push("재료 면적에는 기존 층 면적 기반의 개략 외벽 추정값을 사용하며 실제 공종 물량을 실측한 값이 아닙니다.");
      }
      }
    } catch {
      block("conflict", "재료 원가 입력을 검증하지 못했습니다.");
    }
  }

  if (scenario.dwellingProgram === undefined) {
    setMoney("additionalDwellingCostWon", new Decimal(0));
  } else {
    const dwelling = dwellingSchema.safeParse(scenario.dwellingProgram);
    const floors = dwellingFloorsSchema.safeParse(scenario.floorPrograms);
    if (!dwelling.success || !floors.success) {
      block("conflict", "세대 구성 가정·세대수·기준 세대수 또는 추가 세대 단가가 올바르지 않습니다.");
    } else {
      const units = floors.data.reduce((sum, floor) => floor.zones.reduce((subtotal, zone) =>
        zone.useType === "residential" ? subtotal.plus(zone.unitCount) : subtotal, sum), new Decimal(0));
      setMoney("additionalDwellingCostWon", Decimal.max(0, units.minus(dwelling.data.baselineDwellingCount))
        .times(dwelling.data.additionalDwellingCostWon));
    }
  }

  if (scenario.quantityCost === undefined) {
    setMoney("quantityAdjustmentWon", new Decimal(0), true);
  } else if (!quantityCostPlanSchema.safeParse(scenario.quantityCost).success) {
    block("conflict", "저장된 수량 원가의 형식 또는 버전이 올바르지 않습니다. 조정액은 0원이 아닌 미산정입니다.");
  } else if (!parsedInputs.success || currentFields.slice(0, 3).some(field => result[field] === null)) {
    block("missing", "현재 기본 공사비·재료 증감액·추가 세대 가산비가 확인돼야 수량 원가를 검증할 수 있습니다.");
  } else {
    try {
      const quantity = evaluateQuantityCost(scenario, parsedInputs.data);
      if (quantity.status !== "ready" || !quantity.contract || quantity.adjustmentManwon === null ||
          !Number.isFinite(quantity.adjustmentManwon)) {
        const status = quantity.status === "ready" || quantity.status === "absent" ? "conflict" : quantity.status;
        for (const issue of quantity.issues.length ? quantity.issues : ["현재 수량 원가 조정액이 미확정입니다."]) block(status, issue);
      } else {
        setMoney("quantityAdjustmentWon", new Decimal(quantity.adjustmentManwon).times(10_000), true);
      }
    } catch {
      block("conflict", "현재 수량 원가 입력을 검증하지 못했습니다.");
    }
  }
  if (currentFields.every(field => amounts[field] !== undefined)) {
    setMoney("currentConstructionCostWon", currentFields.reduce((sum, field) => sum.plus(amounts[field]!), new Decimal(0)));
  }

  if (scenario.constructionQuote === undefined) {
    block("absent", "비교할 저장 견적이 없습니다.");
  } else if (!constructionQuoteSchema.safeParse(scenario.constructionQuote).success) {
    block("conflict", "저장 견적의 형식 또는 버전이 올바르지 않습니다.");
  } else if (parsedInputs.success) {
    try {
      const quote = assessConstructionQuote(scenario, parsedInputs.data);
      const ledger = buildConstructionScopeLedger(scenario.constructionQuote);
      if (quote.status !== "ready") {
        for (const issue of quote.issues.length ? quote.issues.map(item => item.detail) : ["견적 대사가 미완료입니다."]) block(quote.status, issue);
      }
      if (ledger.status !== "reconciled") {
        for (const issue of ledger.issues.length ? ledger.issues.map(item => item.detail) : ["견적 공종별 금액 배분이 미완료입니다."]) {
          block(ledger.status === "conflict" ? "conflict" : "missing", issue);
        }
      }
      if (quote.status === "ready" && ledger.status === "reconciled") {
        if (ledger.totalAmountWon === null || quote.lineTotalWon === null ||
            !Number.isFinite(ledger.totalAmountWon) || !Number.isFinite(quote.lineTotalWon) ||
            ledger.totalAmountWon !== quote.lineTotalWon) {
          block("conflict", "대사한 견적과 공종 원장의 합계가 일치하지 않습니다.");
        } else setMoney("quoteConstructionCostWon", new Decimal(ledger.totalAmountWon));
      }
    } catch {
      block("conflict", "견적과 현재 계획 입력을 유효한 기준으로 대사하지 못했습니다.");
    }
  }
  if (result.status === "ready" && amounts.currentConstructionCostWon && amounts.quoteConstructionCostWon) {
    setMoney("differenceWon", amounts.quoteConstructionCostWon.minus(amounts.currentConstructionCostWon), true);
  }
  return result;
}
