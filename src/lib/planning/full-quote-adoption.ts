import { evaluateQuoteAdoptionReview, quoteAdoptionBusinessDate, type QuoteAdoptionReviewDraft } from "./construction-quote-adoption-review";
import { FULL_QUOTE_COST_VERSION, validateFullQuoteCostContract, type FullQuoteCostContract } from "./full-quote-cost-contract";
import { isPlanningGeometryLocked } from "./geometry-source";
import type { PlanningGeometrySnapshot } from "./planning-geometry";
import type { QuantityCostInputs } from "./quantity-cost-contract";
import type { PlanningScenario } from "./types";
import { constructionQuoteSchema } from "./construction-quote";
import { z } from "zod";

export function assessFullQuoteAdoption(scenario: PlanningScenario, inputs: QuantityCostInputs,
  geometry?: PlanningGeometrySnapshot, asOf = quoteAdoptionBusinessDate()): FullQuoteCostContract | undefined {
  if (scenario.fullQuoteAdoption === undefined) return undefined;
  if (!z.iso.date().safeParse(asOf).success) throw new Error("전체 견적 채택 검증 기준일이 올바르지 않습니다.");
  const contract = validateFullQuoteCostContract(scenario.fullQuoteAdoption);
  if (contract.scenarioId !== scenario.id || contract.scenarioVersion !== scenario.version ||
      JSON.stringify(contract.quote) !== JSON.stringify(constructionQuoteSchema.parse(scenario.constructionQuote)) ||
      contract.inputs.constructionCostPerSqmWon !== inputs.constructionCostPerSqmWon ||
      contract.inputs.basementCostMultiplier !== inputs.basementCostMultiplier) {
    throw new Error("전체 견적 채택의 계획 버전이 바뀌었습니다. 재검토 또는 채택 해제가 필요합니다.");
  }
  const review = evaluateQuoteAdoptionReview(scenario, inputs, geometry, contract.review, contract.adoptedOn);
  if (review.status !== "ready" || review.proposedConstructionCostWon !== contract.totalWon ||
      review.replacedConstructionCostWon !== contract.replacedConstructionCostWon ||
      (asOf < contract.adoptedOn || asOf > contract.quote.validUntil)) {
    throw new Error(`전체 견적 채택 재검토 필요: ${review.issues.join(" · ") || "금액 또는 유효기간 불일치"}`);
  }
  return contract;
}

export function applyFullQuoteAdoption(scenario: PlanningScenario, inputs: QuantityCostInputs,
  geometry: PlanningGeometrySnapshot | undefined, draft: QuoteAdoptionReviewDraft,
  asOf = quoteAdoptionBusinessDate()): Partial<PlanningScenario> {
  if (isPlanningGeometryLocked(scenario)) throw new Error("잠긴 계획안의 견적 채택은 변경할 수 없습니다.");
  const review = evaluateQuoteAdoptionReview(scenario, inputs, geometry, draft, asOf);
  if (review.status !== "ready") throw new Error(review.issues.join(" · "));
  const fullQuoteAdoption = validateFullQuoteCostContract({
    version: FULL_QUOTE_COST_VERSION, sourceKey: review.sourceKey, scenarioId: scenario.id, scenarioVersion: scenario.version,
    inputs, adoptedOn: asOf, totalWon: review.proposedConstructionCostWon,
    replacedConstructionCostWon: review.replacedConstructionCostWon, quote: scenario.constructionQuote, review: draft,
  });
  return { fullQuoteAdoption, checks: [], economicsPreview: { ...scenario.economicsPreview, status: "stale" } };
}

export function removeFullQuoteAdoption(scenario: PlanningScenario): Partial<PlanningScenario> {
  if (isPlanningGeometryLocked(scenario)) throw new Error("잠긴 계획안의 견적 채택은 변경할 수 없습니다.");
  return { fullQuoteAdoption: undefined, checks: [], economicsPreview: { ...scenario.economicsPreview, status: "stale" } };
}
