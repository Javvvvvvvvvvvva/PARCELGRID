import { z } from "zod";
import { buildConstructionScopeLedger, constructionQuoteSchema, quoteTotalsMatchWithinRoundoff, MAX_CONSTRUCTION_QUOTE_AMOUNT_WON } from "./construction-quote";
import { quoteAdoptionReviewSchema } from "./construction-quote-adoption-review";
import { quantityCostInputsSchema } from "./quantity-cost-contract";

export const FULL_QUOTE_COST_VERSION = "full-quote-cost-2026.1" as const;
export const fullQuoteCostContractSchema = z.object({
  version: z.literal(FULL_QUOTE_COST_VERSION),
  sourceKey: z.string().regex(/^PG-QUOTE-REVIEW-[a-f0-9]{64}$/),
  scenarioId: z.string().min(1).max(200), scenarioVersion: z.number().int().min(1),
  inputs: quantityCostInputsSchema, adoptedOn: z.iso.date(),
  totalWon: z.number().finite().positive().max(MAX_CONSTRUCTION_QUOTE_AMOUNT_WON),
  replacedConstructionCostWon: z.number().finite().min(0).max(MAX_CONSTRUCTION_QUOTE_AMOUNT_WON),
  quote: constructionQuoteSchema, review: quoteAdoptionReviewSchema,
}).strict();
export type FullQuoteCostContract = z.infer<typeof fullQuoteCostContractSchema>;

/** Deterministic historic contract validation; the live action separately checks today's validity. */
export function validateFullQuoteCostContract(raw: unknown): FullQuoteCostContract {
  const contract = fullQuoteCostContractSchema.parse(raw);
  const { quote, review, inputs, adoptedOn } = contract;
  const ledger = buildConstructionScopeLedger(quote);
  if (contract.sourceKey !== review.sourceKey || review.checkedOn !== adoptedOn ||
      review.scopes.some(scope => !scope.confirmed || !scope.source.trim()) ||
      !quote.reference.trim() || !quote.issuer.trim() || !quote.projectReference.trim() ||
      !quote.issuedOn || !quote.validUntil || !quote.reviewDate ||
      quote.issuedOn > adoptedOn || quote.validUntil < adoptedOn ||
      quote.reviewDate < quote.issuedOn || quote.reviewDate > quote.validUntil ||
      quote.vatBasis !== "included" || quote.baseVatBasis !== "included" ||
      inputs.constructionCostPerSqmWon !== quote.inputs.constructionCostPerSqmWon ||
      inputs.basementCostMultiplier !== quote.inputs.basementCostMultiplier ||
      ledger.status !== "reconciled" || ledger.totalAmountWon !== contract.totalWon ||
      !quoteTotalsMatchWithinRoundoff(quote.statedTotalWon, contract.totalWon)) {
    throw new Error("전체 견적 채택의 금액·포함 범위·유효일·원가 기준이 일치하지 않습니다.");
  }
  return contract;
}

/** Compare every validated field in schema order, independent of JSONB object key order. */
export function fullQuoteCostContractsMatch(current: unknown, saved: unknown): boolean {
  if (current === undefined && saved === undefined) return true;
  if (current === undefined || saved === undefined) return false;
  try {
    return JSON.stringify(validateFullQuoteCostContract(current)) === JSON.stringify(validateFullQuoteCostContract(saved));
  } catch { return false; }
}
