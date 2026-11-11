import { z } from "zod";
import Decimal from "decimal.js";

export const QUANTITY_COST_VERSION = "quantity-cost-2026.1" as const;
const itemIds = ["partitionLengthM", "interiorDoorCount", "entryDoorCount", "dryFloorAreaSqm", "wetFloorAreaSqm", "kitchenCount", "bathroomCount"] as const;
const money = z.number().finite().min(0).max(1e13);
export const quantityCostInputsSchema = z.object({
  constructionCostPerSqmWon: money,
  basementCostMultiplier: z.number().finite().min(1).max(10),
}).strict();
export const quantityCostLineSchema = z.object({
  id: z.enum(itemIds),
  treatment: z.enum(["unpriced", "included", "replace-allowance"]),
  unitRateWon: money.nullable(),
  includedAllowanceWon: money.nullable(),
  evidenceStatus: z.enum(["assumed", "user-input", "quoted"]),
  source: z.string().max(2000),
  allowanceSource: z.string().max(2000),
  scopeConfirmed: z.boolean(),
}).strict();
const uniqueLines = (lines: Array<{ id: string }>) => new Set(lines.map(l => l.id)).size === itemIds.length;
export const quantityCostPlanSchema = z.object({
  version: z.literal(QUANTITY_COST_VERSION),
  sourceBasis: z.string().min(1).max(2_000_000),
  inputs: quantityCostInputsSchema,
  lines: z.array(quantityCostLineSchema).length(itemIds.length).refine(uniqueLines),
}).strict();
export type QuantityCostPlan = z.infer<typeof quantityCostPlanSchema>;
export type QuantityCostInputs = z.infer<typeof quantityCostInputsSchema>;
export type QuantityCostLine = z.infer<typeof quantityCostLineSchema>;
export function quantityCostPlanBasis(raw: unknown): string | null {
  const parsed = quantityCostPlanSchema.safeParse(raw);
  return parsed.success ? JSON.stringify(parsed.data) : null;
}
export const quantityCostContractSchema = quantityCostPlanSchema.extend({
  constructionAreas: z.object({ aboveGroundSqm: z.number().finite().min(0).max(1e9), basementSqm: z.number().finite().min(0).max(1e9) }).strict(),
  baseConstructionCostWon: money,
  allowanceWon: money,
  replacementCostWon: money,
  adjustmentManwon: z.number().finite().min(-1e9).max(1e9),
  lines: z.array(quantityCostLineSchema.extend({ quantity: z.number().finite().min(0).max(1e7) }))
    .length(itemIds.length).refine(uniqueLines),
}).strict();
export type QuantityCostContract = z.infer<typeof quantityCostContractSchema>;

/** Quantities are conceptual, but the replacement arithmetic must be exact and auditable. */
export function quantityAdjustmentForBase(raw: QuantityCostContract, currentBaseHardCostManwon: number): number {
  const parsed = quantityCostContractSchema.safeParse(raw);
  if (!parsed.success || !Number.isFinite(currentBaseHardCostManwon) || currentBaseHardCostManwon < 0) {
    throw new Error("상세 수량 원가 계약의 형식·금액이 올바르지 않습니다.");
  }
  const c = parsed.data;
  let allowance = new Decimal(0), replacement = new Decimal(0);
  for (const line of c.lines) {
    if (!line.scopeConfirmed || !line.source.trim() || line.treatment === "unpriced") {
      throw new Error("상세 수량 원가의 포함 범위·근거가 미확정입니다.");
    }
    if (line.id.endsWith("Count") && !Number.isSafeInteger(line.quantity)) throw new Error("개수 수량은 정수여야 합니다.");
    if (line.treatment === "included") {
      if (line.unitRateWon !== null || line.includedAllowanceWon !== null) throw new Error("포함 공종에 교체 금액을 중복 저장할 수 없습니다.");
    } else {
      if (line.unitRateWon === null || line.includedAllowanceWon === null || !line.allowanceSource.trim()) {
        throw new Error("교체 공종의 단가·기존 포함액·차감 근거가 필요합니다.");
      }
      allowance = allowance.plus(line.includedAllowanceWon);
      replacement = replacement.plus(new Decimal(line.quantity).times(line.unitRateWon));
    }
  }
  const same = (a: Decimal, b: number) => a.minus(b).abs().lte(Math.max(0.00001, Math.abs(b) * Number.EPSILON * 4));
  const originalBase = new Decimal(c.constructionAreas.aboveGroundSqm).plus(new Decimal(c.constructionAreas.basementSqm)
    .times(c.inputs.basementCostMultiplier)).times(c.inputs.constructionCostPerSqmWon);
  if (!same(allowance, c.allowanceWon) || !same(replacement, c.replacementCostWon) ||
      !same(originalBase, c.baseConstructionCostWon) ||
      !same(replacement.minus(allowance).div(10000), c.adjustmentManwon) || allowance.gt(c.baseConstructionCostWon) ||
      (c.baseConstructionCostWon === 0 && c.lines.some(l => l.treatment === "replace-allowance"))) {
    throw new Error("상세 수량 원가 합계·차감액이 기본 공사비 계약과 일치하지 않습니다.");
  }
  // Cost sensitivity changes only the un-replaced share of the GFA allowance.
  const scaledAllowance = c.baseConstructionCostWon > 0
    ? allowance.times(currentBaseHardCostManwon).times(10000).div(c.baseConstructionCostWon) : new Decimal(0);
  return replacement.minus(scaledAllowance).div(10000).toNumber();
}
