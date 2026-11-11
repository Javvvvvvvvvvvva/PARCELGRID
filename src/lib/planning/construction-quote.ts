import Decimal from "decimal.js";
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { QUANTITY_ITEM_IDS, takeoffPlanningQuantities, type QuantityTakeoff } from "./quantity-takeoff";
import { quantityCostInputsSchema, type QuantityCostInputs } from "./quantity-cost-contract";
import { isPlanningGeometryLocked } from "./geometry-source";
import type { PlanningScenario } from "./types";

export const CONSTRUCTION_QUOTE_VERSION = "construction-quote-2026.1" as const;
export const CONSTRUCTION_SCOPE_LEDGER_VERSION = "construction-scope-ledger-2026.1" as const;
export const MAX_QUOTE_ALLOCATIONS = 256;
export const QUOTE_SCOPE_IDS = ["groundworks", "structure", "envelope", "roof", "common", "mechanical", "electrical",
  "fire", "elevator", "siteworks", ...QUANTITY_ITEM_IDS] as const;
export const QUOTE_SCOPE_LABELS: Record<typeof QUOTE_SCOPE_IDS[number], string> = {
  groundworks: "가설·토공·기초", structure: "구조체", envelope: "외벽·창호", roof: "지붕·옥상 방수",
  common: "공용부·계단 마감", mechanical: "공용 기계·급배수·환기", electrical: "전기·통신", fire: "소방·방재",
  elevator: "승강기", siteworks: "외부·주차·조경", partitionLengthM: "세대 내부 칸막이", interiorDoorCount: "세대 내부 문",
  entryDoorCount: "세대 현관문", dryFloorAreaSqm: "세대 건식 바닥", wetFloorAreaSqm: "욕실 바닥 방수·마감",
  kitchenCount: "주방기구·연결설비", bathroomCount: "욕실기구·연결설비",
};
const money = z.number().finite().min(0).max(1e13);
const text = z.string().max(2000);
const id = z.string().trim().min(1).max(100);
const vat = z.enum(["unknown", "included", "excluded", "exempt"]);
const date = z.union([z.literal(""), z.iso.date()]);
const unique = (values: string[]) => new Set(values).size === values.length;
export const constructionQuoteLineSchema = z.object({
  id, description: z.string().max(300), sourceLocator: z.string().max(300),
  pricing: z.enum(["unit-price", "lump-sum"]), quantity: z.number().finite().min(0).max(1e9).nullable(),
  unit: z.enum(["m", "m2", "m3", "count", "lot"]), unitRateWon: money.nullable(), amountWon: money.nullable(),
  vatBasis: vat, quantityItemId: z.enum(QUANTITY_ITEM_IDS).nullable(), note: text,
  allocations: z.array(z.object({ scopeId: z.enum(QUOTE_SCOPE_IDS), amountWon: money.nullable(),
    source: z.string().max(300) }).strict()).max(QUOTE_SCOPE_IDS.length)
    .refine(values => unique(values.map(value => value.scopeId))).optional(),
}).strict();
export const constructionQuoteSchema = z.object({
  version: z.literal(CONSTRUCTION_QUOTE_VERSION), sourceBasis: z.string().min(1).max(200), inputs: quantityCostInputsSchema,
  reference: z.string().max(300), issuer: z.string().max(300), projectReference: z.string().max(300),
  issuedOn: date, validUntil: date, reviewDate: date, vatBasis: vat, baseVatBasis: vat, statedTotalWon: money.nullable(),
  lines: z.array(constructionQuoteLineSchema).max(256).refine(lines => unique(lines.map(line => line.id)))
    .refine(lines => lines.reduce((count, line) => count + (line.allocations?.length ?? 0), 0) <= MAX_QUOTE_ALLOCATIONS),
  coverage: z.array(z.object({ id: z.enum(QUOTE_SCOPE_IDS), status: z.enum(["unknown", "included", "excluded", "not-applicable"]),
    lineIds: z.array(id).max(256).refine(unique), note: text }).strict()).length(QUOTE_SCOPE_IDS.length)
    .refine(scopes => unique(scopes.map(scope => scope.id))),
}).strict();
export type ConstructionQuote = z.infer<typeof constructionQuoteSchema>;
export type ConstructionQuoteLine = ConstructionQuote["lines"][number];
export interface ConstructionScopeLedger {
  version: typeof CONSTRUCTION_SCOPE_LEDGER_VERSION;
  status: "reconciled" | "incomplete" | "conflict";
  financialApplied: false;
  approvalStatus: "unverified";
  knownAmountWon: number | null;
  allocatedAmountWon: number | null;
  unallocatedAmountWon: number | null;
  totalAmountWon: number | null;
  missingAmountLineIds: string[];
  unresolvedLineIds: string[];
  scopes: Array<{ id: typeof QUOTE_SCOPE_IDS[number]; label: string;
    status: "allocated" | "missing" | "excluded" | "not-applicable" | "conflict";
    amountWon: number | null; lineIds: string[] }>;
  issues: Array<{ code: string; status: "missing" | "fail"; detail: string; lineId?: string }>;
}

/** Declared quote amounts only; shared rows require source-backed allocation, never equal splitting. */
export function buildConstructionScopeLedger(raw: unknown): ConstructionScopeLedger {
  const result: ConstructionScopeLedger = { version: CONSTRUCTION_SCOPE_LEDGER_VERSION, status: "incomplete",
    financialApplied: false, approvalStatus: "unverified", knownAmountWon: null, allocatedAmountWon: null,
    unallocatedAmountWon: null, totalAmountWon: null, missingAmountLineIds: [], unresolvedLineIds: [], scopes: [], issues: [] };
  const parsed = constructionQuoteSchema.safeParse(raw);
  if (!parsed.success) return { ...result, status: "conflict",
    issues: [{ code: "schema", status: "fail", detail: "공종 원가 입력 형식·개수·금액 한도가 올바르지 않습니다." }] };
  const q = parsed.data;
  const issue = (code: string, status: "missing" | "fail", detail: string, lineId?: string) => result.issues.push({ code, status, detail, lineId });
  const amounts = new Map<string, Decimal>();
  const unresolved = new Set<string>();
  const invalid = new Set<string>();
  const rows = new Map(q.lines.map(line => [line.id, line]));
  const locatorFor = (line: ConstructionQuoteLine) => line.sourceLocator.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const locatorCounts = new Map<string, number>();
  for (const line of q.lines) {
    const locator = locatorFor(line);
    if (locator) locatorCounts.set(locator, (locatorCounts.get(locator) ?? 0) + 1);
  }
  let known = new Decimal(0), allocated = new Decimal(0);
  const sameVat = q.vatBasis !== "unknown" && q.lines.every(line => line.vatBasis === q.vatBasis);
  if (!sameVat) issue("vat", "missing", "견적 행의 부가세 기준이 같지 않거나 미확정이므로 공종 금액을 합산하지 않습니다.");
  if (!q.lines.length) issue("lines", "missing", "공종 원가를 구성할 견적 행이 없습니다.");
  for (const line of q.lines) {
    const linked = q.coverage.filter(scope => scope.lineIds.includes(line.id));
    const start = result.issues.length;
    if (line.amountWon === null) {
      result.missingAmountLineIds.push(line.id);
      issue("amount", "missing", `${line.description || line.id}: 금액 미입력`, line.id);
    } else known = known.plus(line.amountWon);
    const locator = locatorFor(line);
    if (!locator || !line.description.trim()) issue("source", "missing", "견적 항목과 원문 행 참조가 필요합니다.", line.id);
    if (locator && locatorCounts.get(locator)! > 1) issue("duplicate-source", "fail", "동일한 원문 행이 중복 입력됐습니다.", line.id);
    if (line.amountWon === 0 && !line.note.trim()) issue("zero", "missing", "0원 금액의 근거가 필요합니다.", line.id);
    if (line.pricing === "unit-price") {
      if (line.quantity === null || line.unitRateWon === null) issue("unit-price", "missing", "수량과 단가가 미입력입니다.", line.id);
      else if (line.amountWon !== null && new Decimal(line.quantity).times(line.unitRateWon).minus(line.amountWon).abs().gt(1)) {
        issue("product", "fail", "수량 × 단가와 원문 금액이 일치하지 않습니다.", line.id);
      }
      if (line.unit === "count" && line.quantity !== null && !Number.isSafeInteger(line.quantity)) issue("count", "fail", "개수는 정수여야 합니다.", line.id);
    } else if (line.unit !== "lot" || line.quantity !== null || line.unitRateWon !== null || line.quantityItemId !== null) {
      issue("lump-sum", "fail", "일식 금액과 수량 단가가 혼합됐습니다.", line.id);
    }
    if (!linked.length) issue("unlinked", "missing", "어느 공종에도 연결되지 않은 견적 행입니다.", line.id);
    if (linked.some(scope => scope.status !== "included")) issue("scope-state", "fail", "포함 상태가 아닌 공종에 금액 행이 연결됐습니다.", line.id);
    const parts = line.allocations ?? [];
    if (parts.length) {
      if (parts.length !== linked.length || parts.some(part => !linked.some(scope => scope.id === part.scopeId))) {
        issue("allocation.scopes", "fail", "배분 공종과 연결된 공종이 일치하지 않습니다.", line.id);
      }
      if (parts.some(part => part.amountWon === null || !part.source.trim())) issue("allocation.missing", "missing", "공종별 배분 금액과 원문 근거가 필요합니다.", line.id);
      if (line.amountWon !== null && parts.every(part => part.amountWon !== null) &&
          !parts.reduce((sum, part) => sum.plus(part.amountWon!), new Decimal(0)).eq(line.amountWon)) {
        issue("allocation.total", "fail", "공종별 배분 합계가 원문 행 금액과 정확히 일치하지 않습니다.", line.id);
      }
    } else if (linked.length > 1) issue("allocation.missing", "missing", "여러 공종을 묶은 금액의 공종별 배분이 미확정입니다.", line.id);
    if (!sameVat || result.issues.length !== start) {
      unresolved.add(line.id);
      if (result.issues.slice(start).some(item => item.status === "fail")) invalid.add(line.id);
      continue;
    }
    const assignments = parts.length ? parts : [{ scopeId: linked[0].id, amountWon: line.amountWon! }];
    for (const part of assignments) amounts.set(part.scopeId, (amounts.get(part.scopeId) ?? new Decimal(0)).plus(part.amountWon!));
    allocated = allocated.plus(line.amountWon!);
  }
  for (const scope of q.coverage) {
    let status: ConstructionScopeLedger["scopes"][number]["status"] = "missing";
    if (scope.status === "not-applicable" && !scope.lineIds.length && scope.note.trim()) status = "not-applicable";
    else if (scope.status === "excluded" && !scope.lineIds.length) status = "excluded";
    else if (scope.lineIds.some(id => !rows.has(id) || invalid.has(id)) || (scope.status !== "included" && scope.lineIds.length)) status = "conflict";
    else if (scope.status === "included" && scope.note.trim() && scope.lineIds.length && scope.lineIds.every(id => !unresolved.has(id))) status = "allocated";
    if (status !== "allocated" && status !== "not-applicable") issue(`scope.${scope.id}`, status === "conflict" ? "fail" : "missing",
      `${QUOTE_SCOPE_LABELS[scope.id]}: ${status === "excluded" ? "별도 원가 근거 필요" : "공종 금액·포함 근거 미확정 또는 불일치"}`);
    result.scopes.push({ id: scope.id, label: QUOTE_SCOPE_LABELS[scope.id], status,
      amountWon: status === "allocated" ? (amounts.get(scope.id) ?? new Decimal(0)).toNumber() : null, lineIds: [...scope.lineIds] });
  }
  if (q.statedTotalWon === null) issue("document-total", "missing", "문서 합계가 미입력입니다.");
  else if (q.lines.length && !result.missingAmountLineIds.length && sameVat && known.minus(q.statedTotalWon).abs().gt(1)) issue("document-total", "fail", "문서 합계와 입력 행 합계가 다릅니다.");
  if (sameVat && q.lines.some(line => line.amountWon !== null)) {
    result.knownAmountWon = known.toNumber();
    result.allocatedAmountWon = allocated.toNumber();
    result.unallocatedAmountWon = known.minus(allocated).toNumber();
  }
  result.unresolvedLineIds = [...unresolved];
  result.status = result.issues.some(item => item.status === "fail") ? "conflict" : result.issues.length ? "incomplete" : "reconciled";
  if (result.status === "reconciled") result.totalAmountWon = known.toNumber();
  return result;
}
export interface ConstructionQuoteAssessment {
  version: typeof CONSTRUCTION_QUOTE_VERSION;
  status: "absent" | "ready" | "missing" | "stale" | "conflict";
  approvalStatus: "unverified";
  financialApplied: false;
  issues: Array<{ code: string; status: "missing" | "fail"; detail: string; lineId?: string }>;
  lineTotalWon: number | null;
  baseEstimateWon: number | null;
  differenceFromBaseWon: number | null;
  quantities: Array<{ id: typeof QUANTITY_ITEM_IDS[number]; label: string; model: number | null; quoted: number | null; status: "checked" | "missing" | "fail" }>;
}

export function constructionQuoteBasis(scenario: PlanningScenario, inputs: QuantityCostInputs, takeoff?: QuantityTakeoff): string {
  const source = JSON.stringify({ quantity: (takeoff ?? takeoffPlanningQuantities(scenario)).basis, inputs,
    primaryUse: scenario.primaryUse, parking: scenario.parking, egressPlan: scenario.egressPlan }, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  if (source.length > 2_000_000) throw new Error("견적 검토 기준 입력량을 초과했습니다.");
  return `${CONSTRUCTION_QUOTE_VERSION}:${bytesToHex(sha256(new TextEncoder().encode(source)))}`;
}

export function createConstructionQuoteDraft(scenario: PlanningScenario, inputs: QuantityCostInputs, reviewDate: string): ConstructionQuote {
  return { version: CONSTRUCTION_QUOTE_VERSION, sourceBasis: constructionQuoteBasis(scenario, inputs), inputs: { ...inputs },
    reference: "", issuer: "", projectReference: "", issuedOn: "", validUntil: "", reviewDate,
    vatBasis: "unknown", baseVatBasis: "unknown", statedTotalWon: null, lines: [],
    coverage: QUOTE_SCOPE_IDS.map(id => ({ id, status: "unknown", lineIds: [], note: "" })) };
}

/** Reconcile declared evidence only. Source authenticity, full BOQ and legal approval remain external. */
export function assessConstructionQuote(scenario: PlanningScenario, inputs: QuantityCostInputs): ConstructionQuoteAssessment {
  const result: ConstructionQuoteAssessment = { version: CONSTRUCTION_QUOTE_VERSION, status: "absent", approvalStatus: "unverified",
    financialApplied: false, issues: [], lineTotalWon: null, baseEstimateWon: null, differenceFromBaseWon: null, quantities: [] };
  if (scenario.constructionQuote === undefined) return result;
  const issue = (code: string, status: "missing" | "fail", detail: string, lineId?: string) => result.issues.push({ code, status, detail, lineId });
  const parsed = constructionQuoteSchema.safeParse(scenario.constructionQuote);
  if (!parsed.success || !quantityCostInputsSchema.safeParse(inputs).success) {
    return { ...result, status: "conflict", issues: [{ code: "schema", status: "fail", detail: "견적 입력 형식·수치·개수 한도가 올바르지 않습니다." }] };
  }
  const q = parsed.data, takeoff = takeoffPlanningQuantities(scenario);
  if (q.sourceBasis !== constructionQuoteBasis(scenario, inputs, takeoff) ||
      q.inputs.constructionCostPerSqmWon !== inputs.constructionCostPerSqmWon || q.inputs.basementCostMultiplier !== inputs.basementCostMultiplier) {
    return { ...result, status: "stale", issues: [{ code: "basis", status: "fail", detail: "계획·주차·코어·기본 단가가 변경됐습니다. 견적의 적용 범위를 다시 확인해야 합니다." }] };
  }
  for (const [field, label] of [["reference", "견적 문서 참조"], ["issuer", "견적 발행자"], ["projectReference", "견적 대상 주소·공사명"],
    ["issuedOn", "발행일"], ["validUntil", "유효기한"], ["reviewDate", "검토 기준일"]] as const) {
    if (!q[field].trim()) issue(`header.${field}`, "missing", `${label}이 미확정입니다.`);
  }
  if (q.issuedOn && q.reviewDate && q.issuedOn > q.reviewDate) issue("date.future", "fail", "검토 기준일 이후에 발행된 견적입니다.");
  if (q.validUntil && ((q.reviewDate && q.validUntil < q.reviewDate) || (q.issuedOn && q.validUntil < q.issuedOn))) {
    issue("date.expired", "fail", "견적 유효기한이 발행일 또는 검토 기준일보다 앞섭니다.");
  }
  if (q.vatBasis === "unknown" || q.baseVatBasis === "unknown") issue("vat.unknown", "missing", "견적과 기본 공사비의 부가세 기준이 미확정입니다.");
  else if (q.vatBasis !== q.baseVatBasis) issue("vat.mismatch", "fail", "견적과 기본 공사비의 부가세 기준이 다릅니다. 자동 환산하지 않습니다.");
  const rows = new Map(q.lines.map(line => [line.id, line])), used = new Set<string>(), locators = new Set<string>();
  let total = new Decimal(0), allPriced = q.lines.length > 0;
  if (!q.lines.length) issue("lines.empty", "missing", "견적 내역이 없습니다.");
  for (const scope of q.coverage) {
    const label = QUOTE_SCOPE_LABELS[scope.id];
    if (scope.status === "unknown") issue(`coverage.${scope.id}`, "missing", `${label}: 포함 범위가 미확정입니다.`);
    if (scope.status === "excluded") issue(`coverage.${scope.id}`, "missing", `${label}: 견적 제외 공종입니다. 별도 원가 근거가 필요합니다.`);
    if (scope.status !== "unknown" && !scope.note.trim()) issue(`scope-note.${scope.id}`, "missing", `${label}: 포함·제외 범위의 원문 근거가 필요합니다.`);
    if (scope.status === "included" && !scope.lineIds.length) issue(`scope-lines.${scope.id}`, "missing", `${label}: 연결된 견적 행이 없습니다.`);
    if (scope.status !== "included" && scope.lineIds.length) issue(`scope-conflict.${scope.id}`, "fail", `${label}: 미포함 공종에 금액 행이 연결됐습니다.`);
    for (const rowId of scope.lineIds) {
      if (!rows.has(rowId)) issue(`scope-orphan.${scope.id}`, "fail", `${label}: 존재하지 않는 견적 행입니다.`);
      else used.add(rowId);
    }
  }
  for (const line of q.lines) {
    const name = line.description.trim() || line.id;
    if (!line.description.trim() || !line.sourceLocator.trim()) issue("line.source", "missing", `${name}: 항목명과 원문 페이지·행 참조가 필요합니다.`, line.id);
    const locator = line.sourceLocator.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    if (locator && locators.has(locator)) issue("line.duplicate", "fail", `${name}: 같은 원문 행이 중복 입력됐습니다.`, line.id);
    locators.add(locator);
    if (!used.has(line.id)) issue("line.unallocated", "missing", `${name}: 공종 포함 범위에 연결되지 않았습니다.`, line.id);
    if (line.vatBasis === "unknown") issue("line.vat-missing", "missing", `${name}: 부가세 기준이 미확정입니다.`, line.id);
    else if (line.vatBasis !== q.vatBasis) issue("line.vat-mismatch", "fail", `${name}: 문서 합계와 부가세 기준이 다릅니다.`, line.id);
    if (line.amountWon === null) { allPriced = false; issue("line.amount", "missing", `${name}: 금액이 미입력입니다.`, line.id); }
    else {
      total = total.plus(line.amountWon);
      if (line.amountWon === 0 && !line.note.trim()) issue("line.zero", "missing", `${name}: 0원 근거가 필요합니다.`, line.id);
    }
    if (line.pricing === "unit-price") {
      if (line.quantity === null || line.unitRateWon === null) issue("line.unit-price", "missing", `${name}: 수량·단가가 미입력입니다.`, line.id);
      else {
        if (line.unit === "count" && !Number.isSafeInteger(line.quantity)) issue("line.count", "fail", `${name}: 개수 수량은 정수여야 합니다.`, line.id);
        if (line.amountWon !== null && new Decimal(line.quantity).times(line.unitRateWon).minus(line.amountWon).abs().gt(1)) {
          issue("line.product", "fail", `${name}: 수량 × 단가와 견적 금액이 1원 초과 차이 납니다.`, line.id);
        }
      }
    } else if (line.quantity !== null || line.unitRateWon !== null || line.unit !== "lot" || line.quantityItemId !== null) {
      issue("line.lump-sum", "fail", `${name}: 일식 금액과 수량 단가가 혼합됐습니다.`, line.id);
    }
    if (line.quantityItemId && !q.coverage.find(scope => scope.id === line.quantityItemId)?.lineIds.includes(line.id)) {
      issue("line.quantity-scope", "fail", `${name}: 모델 수량과 다른 공종에 연결됐습니다.`, line.id);
    }
  }
  const sameVat = q.vatBasis !== "unknown" && q.lines.every(line => line.vatBasis === q.vatBasis);
  if (allPriced && sameVat) result.lineTotalWon = total.toNumber();
  if (q.statedTotalWon === null) issue("total.missing", "missing", "문서에 기재된 전체 견적 합계가 미입력입니다.");
  else if (allPriced && sameVat && total.minus(q.statedTotalWon).abs().gt(1)) issue("total.mismatch", "fail", "입력 내역 합계와 문서 합계가 일치하지 않습니다. 패키지 행은 공종 수와 무관하게 한 번만 합산합니다.");
  for (const item of takeoff.items) {
    const scope = q.coverage.find(scope => scope.id === item.id)!;
    // Coverage is the authoritative row set. An untagged extra priced row must
    // not disappear merely because another row carries the model quantity tag.
    const matches = scope.lineIds.map(id => rows.get(id));
    const valid = matches.length > 0 && matches.every(line => line && line.quantityItemId === item.id &&
      line.pricing === "unit-price" && line.quantity !== null && line.unit === item.unit);
    const declaredZero = takeoff.status === "preliminary" && item.quantity === 0 && scope.status === "not-applicable" && !matches.length;
    const quantity = declaredZero ? 0 : valid ? matches.reduce((sum, line) => sum.plus(line!.quantity!), new Decimal(0)).toNumber() : null;
    const supported = takeoff.status === "preliminary" && item.quantity !== null;
    const match = supported && quantity !== null && Math.abs(quantity - item.quantity!) <= (item.unit === "count" ? 0 : .01);
    const status = !supported || quantity === null ? "missing" : match ? "checked" : "fail";
    result.quantities.push({ id: item.id, label: item.label, model: supported ? item.quantity : null, quoted: quantity, status });
    if (status !== "checked") issue(`quantity.${item.id}`, status, `${item.label}: ${status === "fail" ? "모델과 견적 수량이 다릅니다." : "동일 단위의 모델·견적 수량 대사가 미완료입니다."}`);
    if (supported && item.quantity! > 0 && scope.status === "not-applicable") issue(`quantity.excluded.${item.id}`, "fail", `${item.label}: 모델에 존재하지만 해당 없음으로 입력됐습니다.`);
  }
  let base = new Decimal(0), validBase = true;
  for (const floor of scenario.floorPrograms) for (const zone of floor.zones) {
    if (!Number.isFinite(zone.areaSqm) || zone.areaSqm < 0) { validBase = false; issue("base.area", "fail", "기본 공사면적이 유효하지 않습니다."); continue; }
    base = base.plus(new Decimal(zone.areaSqm).times(floor.level < 0 ? inputs.basementCostMultiplier : 1).times(inputs.constructionCostPerSqmWon));
  }
  result.baseEstimateWon = validBase && Number.isFinite(base.toNumber()) ? base.toNumber() : null;
  for (const item of buildConstructionScopeLedger(q).issues.filter(item => item.code.startsWith("allocation.") && item.status === "fail")) {
    issue(item.code, item.status, item.detail, item.lineId);
  }
  result.status = result.issues.some(issue => issue.status === "fail") ? "conflict" : result.issues.length ? "missing" : "ready";
  // A partial or inconsistent quote is not a comparable whole-construction price.
  if (result.status === "ready" && result.baseEstimateWon !== null && result.lineTotalWon !== null) {
    result.differenceFromBaseWon = total.minus(base).toNumber();
  }
  return result;
}

/** Saving evidence never adopts quote totals as project economics. */
export function saveConstructionQuote(scenario: PlanningScenario, draft: unknown, inputs: QuantityCostInputs): Partial<PlanningScenario> {
  if (isPlanningGeometryLocked(scenario)) throw new Error("잠긴 계획안의 견적을 변경할 수 없습니다.");
  const parsed = constructionQuoteSchema.safeParse(draft);
  if (!parsed.success) throw new Error("견적 입력 형식·수치·한도를 확인해야 합니다.");
  if (parsed.data.sourceBasis !== constructionQuoteBasis(scenario, inputs) ||
      JSON.stringify(parsed.data.inputs) !== JSON.stringify(quantityCostInputsSchema.parse(inputs))) throw new Error("견적 기준이 변경됐습니다. 현재 계획과 견적을 다시 대조해야 합니다.");
  return { constructionQuote: structuredClone(parsed.data), checks: [] };
}
