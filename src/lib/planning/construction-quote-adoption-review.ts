import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { validateJsonStructure } from "@/lib/http/bounded-json";
import { constructionQuoteSchema, quoteTotalsMatchWithinRoundoff, MAX_CONSTRUCTION_QUOTE_AMOUNT_WON } from "./construction-quote";
import { evaluateConstructionQuoteCostComparison } from "./construction-quote-cost-comparison";
import { PLANNING_GEOMETRY_VERSION, planningGeometryInputBasis, type PlanningGeometrySnapshot } from "./planning-geometry";
import { quantityCostInputsSchema, type QuantityCostInputs } from "./quantity-cost-contract";
import type { PlanningScenario } from "./types";

export const QUOTE_ADOPTION_REVIEW_VERSION = "quote-adoption-review-2026.1" as const;
export const QUOTE_ADOPTION_SCOPE_IDS = ["replacement", "demolition", "soft", "contingency", "finance", "acquisition"] as const;
export const QUOTE_ADOPTION_SCOPE_LABELS: Record<typeof QUOTE_ADOPTION_SCOPE_IDS[number], string> = {
  replacement: "기본·외장·추가 세대·상세 수량 비용을 모두 포함한 직접 공사비",
  demolition: "철거비 제외",
  soft: "설계·감리·간접비 제외",
  contingency: "별도 예비비 제외",
  finance: "금융·신탁 비용 제외",
  acquisition: "취득대금·취득세·기타 취득비·명도비 제외",
};
export const quoteAdoptionReviewSchema = z.object({
  version: z.literal(QUOTE_ADOPTION_REVIEW_VERSION),
  sourceKey: z.string().regex(/^PG-QUOTE-REVIEW-[a-f0-9]{64}$/),
  checkedOn: z.union([z.literal(""), z.iso.date()]),
  scopes: z.array(z.object({ id: z.enum(QUOTE_ADOPTION_SCOPE_IDS), confirmed: z.boolean(),
    source: z.string().max(2000) }).strict()).length(QUOTE_ADOPTION_SCOPE_IDS.length)
    .refine(scopes => new Set(scopes.map(scope => scope.id)).size === QUOTE_ADOPTION_SCOPE_IDS.length),
}).strict();
export type QuoteAdoptionReviewDraft = z.infer<typeof quoteAdoptionReviewSchema>;
export function quoteAdoptionBusinessDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export interface QuoteAdoptionReview {
  version: typeof QUOTE_ADOPTION_REVIEW_VERSION;
  status: "ready" | "missing" | "stale" | "conflict";
  financialApplied: false;
  approvalStatus: "unverified";
  sourceKey: string | null;
  proposedConstructionCostWon: number | null;
  replacedConstructionCostWon: number | null;
  differenceWon: number | null;
  issues: string[];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Bind declarations to raw evidence, not just the quote's plan-basis string or a displayed total. */
export function quoteAdoptionReviewKey(scenario: PlanningScenario, inputs: QuantityCostInputs,
  geometry?: PlanningGeometrySnapshot): string {
  const raw = { version: QUOTE_ADOPTION_REVIEW_VERSION, projectId: scenario.projectId, scenarioId: scenario.id,
    scenarioVersion: scenario.version, primaryUse: scenario.primaryUse, planBasis: planningGeometryInputBasis(scenario),
    quote: constructionQuoteSchema.parse(scenario.constructionQuote), inputs: quantityCostInputsSchema.parse(inputs),
    materials: scenario.materials, dwellingProgram: scenario.dwellingProgram, quantityCost: scenario.quantityCost,
    egress: scenario.egressPlan, floors: scenario.floorPrograms, parking: scenario.parking,
    geometrySource: scenario.geometrySource ? { ...scenario.geometrySource, locked: undefined,
      lockedAt: undefined, lockedGeometryHash: undefined } : undefined,
    // Selection, display names and lifecycle validation are not physical quote scope.
    geometry: geometry ? { version: geometry.version, projectId: geometry.projectId, scenarioId: geometry.scenarioId,
      scenarioVersion: geometry.scenarioVersion, scenarioInputBasis: geometry.scenarioInputBasis,
      geometryHash: geometry.geometryHash, coordinateSystem: geometry.coordinateSystem, parcel: geometry.parcel,
      roads: geometry.roads, building: geometry.building } : null };
  if (!validateJsonStructure(raw, { maxDepth: 32, maxNodes: 100000 }).ok) throw new Error("견적 반영 검토 입력 한도를 초과했습니다.");
  const json = JSON.stringify(canonical(raw));
  if (json.length > 2_000_000) throw new Error("견적 반영 검토 입력 한도를 초과했습니다.");
  return `PG-QUOTE-REVIEW-${bytesToHex(sha256(new TextEncoder().encode(json)))}`;
}

export function createQuoteAdoptionReviewDraft(scenario: PlanningScenario, inputs: QuantityCostInputs,
  geometry?: PlanningGeometrySnapshot): QuoteAdoptionReviewDraft {
  return { version: QUOTE_ADOPTION_REVIEW_VERSION, sourceKey: quoteAdoptionReviewKey(scenario, inputs, geometry),
    checkedOn: "", scopes: QUOTE_ADOPTION_SCOPE_IDS.map(id => ({ id, confirmed: false, source: "" })) };
}

/** Preflight only. No PlanningScenario patch or finance contract is produced. */
export function evaluateQuoteAdoptionReview(scenario: PlanningScenario, inputs: QuantityCostInputs,
  geometry: PlanningGeometrySnapshot | undefined, raw: unknown, asOf = quoteAdoptionBusinessDate()): QuoteAdoptionReview {
  const result: QuoteAdoptionReview = { version: QUOTE_ADOPTION_REVIEW_VERSION, status: "ready",
    financialApplied: false, approvalStatus: "unverified", sourceKey: null,
    proposedConstructionCostWon: null, replacedConstructionCostWon: null, differenceWon: null, issues: [] };
  const priority = { ready: 0, missing: 1, stale: 2, conflict: 3 };
  const issue = (status: QuoteAdoptionReview["status"], message: string) => {
    if (priority[status] > priority[result.status]) result.status = status;
    if (!result.issues.includes(message)) result.issues.push(message);
  };
  try {
    result.sourceKey = quoteAdoptionReviewKey(scenario, inputs, geometry);
    const parsed = quoteAdoptionReviewSchema.safeParse(raw);
    if (!parsed.success) { issue("conflict", "견적 반영 범위·날짜·기준 키의 형식이 올바르지 않습니다."); return result; }
    const draft = parsed.data, quote = constructionQuoteSchema.parse(scenario.constructionQuote);
    if (draft.sourceKey !== result.sourceKey) issue("stale", "견적·계획·형상·원가 기준이 바뀌었습니다. 포함 범위를 다시 확인해야 합니다.");
    if (!z.iso.date().safeParse(asOf).success) issue("conflict", "현재 검토일이 올바르지 않습니다.");
    else if (!draft.checkedOn) issue("missing", "반영 검토일을 입력하세요.");
    else if (draft.checkedOn !== asOf) issue("stale", "반영 검토일이 한국 기준 오늘과 다릅니다. 현재 날짜로 다시 확인해야 합니다.");
    if (!quote.validUntil) issue("missing", "견적의 유효기한이 필요합니다.");
    else if (quote.validUntil < asOf || quote.issuedOn > asOf) issue("stale", "오늘 기준으로 유효한 견적이 아닙니다. 과거 대사 결과로 반영할 수 없습니다.");
    if (quote.vatBasis !== "included" || quote.baseVatBasis !== "included") {
      issue("missing", "부가세 포함 현금 지출 견적이 필요합니다. 별도·면세 견적의 세금·환급액을 자동 추정하지 않습니다.");
    }
    for (const scope of draft.scopes) if (!scope.confirmed || !scope.source.trim()) {
      issue("missing", `${QUOTE_ADOPTION_SCOPE_LABELS[scope.id]}: 원문 근거와 범위 확인이 필요합니다.`);
    }
    if (!geometry) issue("missing", "현재 계획의 형상 원본이 필요합니다.");
    else if (geometry.version !== PLANNING_GEOMETRY_VERSION || geometry.projectId !== scenario.projectId ||
        geometry.scenarioId !== scenario.id || geometry.scenarioVersion !== scenario.version ||
        geometry.scenarioInputBasis !== planningGeometryInputBasis(scenario)) issue("stale", "현재 계획과 형상 기준이 다릅니다.");
    else if (geometry.validation.status === "fail") issue("conflict", "형상 검증 실패를 먼저 해결해야 합니다.");
    const comparison = evaluateConstructionQuoteCostComparison(scenario, inputs, geometry);
    if (comparison.status !== "ready") {
      for (const message of comparison.issues) issue(comparison.status === "absent" ? "missing" : comparison.status, message);
      if (!comparison.issues.length) issue("missing", "전체 견적과 현재 원가의 대사가 필요합니다.");
    }
    if (comparison.status === "ready" && !quoteTotalsMatchWithinRoundoff(quote.statedTotalWon, comparison.quoteConstructionCostWon)) {
      issue("conflict", "사업비 채택에는 문서 합계와 공종 원장의 정확한 합계가 필요합니다. 반올림·조정 금액은 원문에서 확인해야 합니다.");
    }
    if ((comparison.quoteConstructionCostWon ?? 0) > MAX_CONSTRUCTION_QUOTE_AMOUNT_WON ||
        (comparison.currentConstructionCostWon ?? 0) > MAX_CONSTRUCTION_QUOTE_AMOUNT_WON) {
      issue("conflict", "견적 또는 교체 대상 공사비가 사업비 채택 금액 한도를 초과했습니다.");
    }
    if (result.status === "ready") {
      if (comparison.quoteConstructionCostWon === null || comparison.quoteConstructionCostWon <= 0 ||
          comparison.currentConstructionCostWon === null || comparison.differenceWon === null) {
        issue("conflict", "반영 후보 전체 견적은 양수여야 하며 현재 공사비와 대사가 필요합니다.");
      } else {
        result.proposedConstructionCostWon = comparison.quoteConstructionCostWon;
        result.replacedConstructionCostWon = comparison.currentConstructionCostWon;
        result.differenceWon = comparison.differenceWon;
      }
    }
  } catch {
    issue("conflict", "견적 반영 검토의 원본 입력을 검증하지 못했습니다.");
  }
  return result;
}
