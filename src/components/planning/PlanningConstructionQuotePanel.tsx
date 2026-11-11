"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, ListChecks, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { clientSession } from "@/lib/auth/client-session";
import {
  assessConstructionQuote, constructionQuoteBasis, constructionQuoteSchema, createConstructionQuoteDraft,
  MAX_QUOTE_ALLOCATIONS, QUOTE_SCOPE_IDS, QUOTE_SCOPE_LABELS, saveConstructionQuote,
  type ConstructionQuote, type ConstructionQuoteAssessment, type ConstructionQuoteLine,
} from "@/lib/planning/construction-quote";
import { evaluateConstructionQuoteCostComparison } from "@/lib/planning/construction-quote-cost-comparison";
import { isPlanningGeometryLocked } from "@/lib/planning/geometry-source";
import { ConstructionQuoteImport } from "./ConstructionQuoteImport";
import { ConstructionQuoteCostComparison } from "./ConstructionQuoteCostComparison";
import { ConstructionQuoteAdoptionReview } from "./ConstructionQuoteAdoptionReview";
import { ConstructionScopeLedgerSummary } from "@/components/handoff/ConstructionScopeLedgerSummary";
import type { QuantityCostInputs } from "@/lib/planning/quantity-cost-contract";
import { QUANTITY_ITEM_IDS } from "@/lib/planning/quantity-takeoff";
import type { PlanningScenario } from "@/lib/planning/types";
import "./construction-quote.css";

type Props = {
  scenario: PlanningScenario; inputs: QuantityCostInputs; locked: boolean;
  geometry?: import("@/lib/planning/planning-geometry").PlanningGeometrySnapshot;
  getCurrentScenario: () => PlanningScenario | undefined;
  onChange: (patch: Partial<PlanningScenario>) => void;
};
type DraftState = { quote: ConstructionQuote | null; savedKey: string | null; baselineKey: string | null; error: string };
type NumericState = { raw: string; invalid: boolean };
type Review = { key: string; assessment: ConstructionQuoteAssessment;
  comparison: ReturnType<typeof evaluateConstructionQuoteCostComparison> };
type Scope = ConstructionQuote["coverage"][number];
type Allocation = NonNullable<ConstructionQuoteLine["allocations"]>[number];
const vatLabels: Record<ConstructionQuote["vatBasis"], string> = {
  unknown: "미확정", included: "포함", excluded: "별도", exempt: "면세",
};
const scopeLabels: Record<Scope["status"], string> = {
  unknown: "미확정", included: "포함", excluded: "제외", "not-applicable": "해당 없음",
};
const assessmentLabels: Record<ConstructionQuoteAssessment["status"], string> = {
  absent: "견적 증빙 없음", ready: "입력 대사 확인 · 전문 검토 미확정", missing: "입력 근거·범위 미확정",
  stale: "계획·단가 기준 변경 · 재검토 필요", conflict: "입력 불일치 · 확인 필요",
};
const units: Record<ConstructionQuoteLine["unit"], string> = { m: "m", m2: "㎡", m3: "㎥", count: "개", lot: "식" };
const formatNumber = (value: number | null, signed = false) => value === null || !Number.isFinite(value)
  ? "미확정" : `${signed && value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`;
const formatMoney = (value: number | null, signed = false) => value === null ? "미확정" : `${formatNumber(value, signed)} 원`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "견적 증빙을 처리하지 못했습니다.";
function serialized(value: unknown): string | null {
  try { return JSON.stringify(value ?? null); } catch { return null; }
}
function comparisonCostKey(scenario: Pick<PlanningScenario, "materials" | "dwellingProgram" | "quantityCost">): string | null {
  return serialized({ materials: scenario.materials, dwellingProgram: scenario.dwellingProgram, quantityCost: scenario.quantityCost });
}
function initialDraft(scenario: PlanningScenario, inputs: QuantityCostInputs): DraftState {
  const savedKey = serialized(scenario.constructionQuote);
  try {
    const quote = scenario.constructionQuote === undefined ? createConstructionQuoteDraft(scenario, inputs, "")
      : constructionQuoteSchema.parse(scenario.constructionQuote);
    return { quote, savedKey, baselineKey: serialized(quote), error: "" };
  } catch {
    return { quote: null, savedKey, baselineKey: null, error: "저장 증빙 또는 현재 계획의 입력 형식·한도를 확인해야 합니다." };
  }
}

function QuoteNumberField({ label, value, state, max = 1e13, onChange }: {
  label: string; value: number | null; state?: NumericState; max?: number;
  onChange: (value: number | null, state: NumericState) => void;
}) {
  const id = useId();
  return <label className="lv-field">{label}
    <input type="number" min={0} max={max} step="any" inputMode="decimal" aria-label={label}
      aria-invalid={state?.invalid || undefined} aria-describedby={state?.invalid ? id : undefined}
      value={state?.raw ?? value ?? ""} onChange={event => {
        const input = event.currentTarget;
        const invalid = input.validity.badInput || input.validity.rangeUnderflow || input.validity.rangeOverflow ||
          (input.value !== "" && !Number.isFinite(input.valueAsNumber));
        onChange(input.value === "" || !Number.isFinite(input.valueAsNumber) ? null : input.valueAsNumber,
          { raw: input.value, invalid });
      }} />
    {state?.invalid && <span id={id} className="lv-quote-error">0 이상 {formatNumber(max)} 이하의 숫자가 필요합니다.</span>}
  </label>;
}

function VatField({ label, value, onChange }: {
  label: string; value: ConstructionQuote["vatBasis"]; onChange: (value: ConstructionQuote["vatBasis"]) => void;
}) {
  return <label className="lv-field">{label}<select aria-label={label} value={value}
    onChange={event => onChange(event.target.value as ConstructionQuote["vatBasis"])}>
    {Object.entries(vatLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
  </select></label>;
}

export function PlanningConstructionQuotePanel(props: Props) {
  return <ConstructionQuoteEditor key={`${props.scenario.projectId}:${props.scenario.id}`} {...props} />;
}

function ConstructionQuoteEditor({ scenario, inputs, geometry, locked: lockedProp, getCurrentScenario, onChange }: Props) {
  const [sessionAtMount] = useState(() => ({ key: clientSession.context, active: clientSession.active, generation: 0 }));
  const sessionGeneration = useRef(sessionAtMount.generation);
  const [sessionEnded, setSessionEnded] = useState(false);
  const sessionValid = !sessionEnded && sessionAtMount.active && clientSession.active && clientSession.context === sessionAtMount.key;
  const costInputs = useMemo<QuantityCostInputs>(() => ({
    constructionCostPerSqmWon: inputs.constructionCostPerSqmWon, basementCostMultiplier: inputs.basementCostMultiplier,
  }), [inputs.constructionCostPerSqmWon, inputs.basementCostMultiplier]);
  const [draft, setDraft] = useState<DraftState>(() => sessionValid ? initialDraft(scenario, costInputs)
    : { quote: null, savedKey: null, baselineKey: null, error: "" });
  const [numbers, setNumbers] = useState<Record<string, NumericState>>({});
  const [dateErrors, setDateErrors] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState("");
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [expandedScope, setExpandedScope] = useState<Scope["id"] | null>(null);
  // This may traverse a large model. Draft edits must not invalidate this memo.
  const basis = useMemo(() => {
    if (!sessionValid) return { value: null, error: "" };
    try { return { value: constructionQuoteBasis(scenario, costInputs), error: "" }; }
    catch (error) { return { value: null, error: errorText(error) }; }
  }, [scenario, costInputs, sessionValid]);
  const quote = draft.quote;
  const allocationCount = quote?.lines.reduce((count, line) => count + (line.allocations?.length ?? 0), 0) ?? 0;
  const parsed = useMemo(() => constructionQuoteSchema.safeParse(quote), [quote]);
  const savedKey = serialized(scenario.constructionQuote);
  const savedChanged = savedKey === null || draft.savedKey === null || savedKey !== draft.savedKey;
  const locked = lockedProp || isPlanningGeometryLocked(scenario);
  const stale = !!quote && (!basis.value || quote.sourceBasis !== basis.value ||
    quote.inputs.constructionCostPerSqmWon !== costInputs.constructionCostPerSqmWon ||
    quote.inputs.basementCostMultiplier !== costInputs.basementCostMultiplier);
  const invalidNumbers = Object.values(numbers).some(value => value.invalid);
  const invalidDates = Object.values(dateErrors).some(Boolean);
  const modified = !!quote && (serialized(quote) !== draft.baselineKey || invalidNumbers || invalidDates);
  const dirty = !!quote && (draft.savedKey === serialized(undefined) || modified);
  const editable = sessionValid && !locked && !savedChanged && !stale && !!basis.value;
  const validDraft = !!quote && parsed.success && !invalidNumbers && !invalidDates;
  const comparisonKey = useMemo(() => comparisonCostKey({ materials: scenario.materials,
    dwellingProgram: scenario.dwellingProgram, quantityCost: scenario.quantityCost }),
  [scenario.materials, scenario.dwellingProgram, scenario.quantityCost]);
  const inputKey = useMemo(() => comparisonKey === null ? null : serialized({ scenarioId: scenario.id, projectId: scenario.projectId,
    basis: basis.value, geometry, inputs: costInputs, comparisonKey, savedKey, quote, numbers, dateErrors, locked, session: sessionAtMount.key }),
  [scenario.id, scenario.projectId, basis.value, geometry, costInputs, comparisonKey, savedKey, quote, numbers, dateErrors, locked, sessionAtMount.key]);
  const currentQuoteReview = sessionValid && inputKey !== null && review?.key === inputKey && validDraft && !stale && !savedChanged ? review : null;
  const currentReview = currentQuoteReview?.assessment;

  useEffect(() => {
    // ClientSession cannot reactivate after invalidation; also bind this editor to its own generation.
    const expire = () => {
      sessionGeneration.current += 1;
      setSessionEnded(true);
      setDraft({ quote: null, savedKey: null, baselineKey: null, error: "" });
      setNumbers({}); setDateErrors({}); setReview(null); setMessage("");
      setExpandedLine(null); setExpandedScope(null);
    };
    const unsubscribe = clientSession.subscribe(expire);
    if (!clientSession.active || clientSession.context !== sessionAtMount.key) expire();
    return unsubscribe;
  }, [sessionAtMount.key]);

  useEffect(() => {
    if (!modified || !sessionValid) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!clientSession.active || clientSession.context !== sessionAtMount.key || sessionGeneration.current !== sessionAtMount.generation) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [modified, sessionValid, sessionAtMount]);

  function assertSession() {
    clientSession.assertActive();
    if (!sessionAtMount.active || sessionEnded || clientSession.context !== sessionAtMount.key || sessionGeneration.current !== sessionAtMount.generation) {
      throw new Error("사용자 세션이 변경됐습니다. 현재 견적 초안은 사용할 수 없습니다.");
    }
  }
  function readCurrent(writable: boolean, matchSaved = true) {
    assertSession();
    const current = getCurrentScenario();
    assertSession();
    if (!current || current.id !== scenario.id || current.projectId !== scenario.projectId) {
      throw new Error("현재 계획안이 없거나 다른 계획안으로 변경됐습니다.");
    }
    if (writable && (locked || isPlanningGeometryLocked(current))) throw new Error("잠긴 계획안의 견적은 변경할 수 없습니다.");
    if (matchSaved && (draft.savedKey === null || serialized(current.constructionQuote) !== draft.savedKey)) {
      throw new Error("저장 증빙이 변경됐습니다. 현재 초안을 다운로드하거나 최신 저장본을 불러온 뒤 다시 확인해 주세요.");
    }
    return current;
  }
  function editQuote(update: (value: ConstructionQuote) => ConstructionQuote) {
    if (!editable) return false;
    try { readCurrent(true); } catch (error) { setMessage(errorText(error)); return false; }
    setDraft(previous => previous.quote ? { ...previous, quote: update(previous.quote) } : previous);
    setMessage("");
    return true;
  }
  function editLine(id: string, patch: Partial<ConstructionQuoteLine>) {
    return editQuote(value => ({ ...value, lines: value.lines.map(line => line.id === id ? { ...line, ...patch } : line) }));
  }
  function editScope(id: Scope["id"], patch: Partial<Scope>) {
    editQuote(value => ({ ...value, coverage: value.coverage.map(scope => scope.id === id ? { ...scope, ...patch } : scope) }));
  }
  function clearLineNumbers(id: string, fields: string[]) {
    setNumbers(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !fields.some(field => key === `${id}:${field}`))));
  }
  function editAllocation(lineId: string, scopeId: Scope["id"], patch: Partial<Pick<Allocation, "amountWon" | "source">>) {
    return editQuote(value => ({ ...value, lines: value.lines.map(line => line.id === lineId
      ? { ...line, allocations: line.allocations?.map(part => part.scopeId === scopeId ? { ...part, ...patch } : part) } : line) }));
  }
  function refreshAllocations(line: ConstructionQuoteLine) {
    if (!editable || !quote) return;
    try { readCurrent(true); } catch (error) { setMessage(errorText(error)); return; }
    const linked = quote.coverage.filter(scope => scope.lineIds.includes(line.id));
    const previous = line.allocations ?? [];
    if (allocationCount - previous.length + linked.length > MAX_QUOTE_ALLOCATIONS) {
      setMessage(`공종 배분은 견적 전체에서 ${MAX_QUOTE_ALLOCATIONS}개까지 입력할 수 있습니다.`);
      return;
    }
    const removed = previous.filter(part => !linked.some(scope => scope.id === part.scopeId));
    const entered = removed.some(part => part.amountWon !== null || part.source !== "" ||
      numbers[`${line.id}:allocation:${part.scopeId}`]?.raw || numbers[`${line.id}:allocation:${part.scopeId}`]?.invalid);
    if (entered && !window.confirm(`연결이 해제된 공종 배분 ${removed.length}개와 입력한 금액·원문 근거를 삭제하고 갱신하시겠습니까?`)) return;
    const allocations = linked.map(scope => previous.find(part => part.scopeId === scope.id)
      ?? { scopeId: scope.id, amountWon: null, source: "" });
    if (!editLine(line.id, { allocations })) return;
    const retained = new Set(previous.filter(part => linked.some(scope => scope.id === part.scopeId)).map(part => part.scopeId));
    clearLineNumbers(line.id, QUOTE_SCOPE_IDS.filter(id => !retained.has(id)).map(id => `allocation:${id}`));
  }
  function deleteAllocations(line: ConstructionQuoteLine, scopeId?: Scope["id"]) {
    if (!editable || !line.allocations?.length) return;
    try { readCurrent(true); } catch (error) { setMessage(errorText(error)); return; }
    if (!window.confirm(`${scopeId ? QUOTE_SCOPE_LABELS[scopeId] : "이 행의 모든 공종"} 배분 금액·원문 근거를 삭제하시겠습니까? 공종 연결은 유지됩니다.`)) return;
    if (editLine(line.id, { allocations: scopeId ? line.allocations.filter(part => part.scopeId !== scopeId) : [] })) {
      clearLineNumbers(line.id, (scopeId ? [scopeId] : QUOTE_SCOPE_IDS).map(id => `allocation:${id}`));
    }
  }
  function addLine() {
    if (!editable || !quote || quote.lines.length >= 256) return;
    const id = crypto.randomUUID();
    if (editQuote(value => ({ ...value, lines: [...value.lines, { id, description: "", sourceLocator: "", pricing: "unit-price",
      quantity: null, unit: "m2", unitRateWon: null, amountWon: null, vatBasis: "unknown", quantityItemId: null, note: "" }] }))) setExpandedLine(id);
  }
  function deleteLine(line: ConstructionQuoteLine, index: number) {
    try { readCurrent(true); } catch (error) { setMessage(errorText(error)); return; }
    if (!editable || !window.confirm(`${index + 1}행과 해당 행의 공종 연결을 초안에서 삭제하시겠습니까?`)) return;
    if (!editQuote(value => ({ ...value, lines: value.lines.filter(item => item.id !== line.id),
      coverage: value.coverage.map(scope => ({ ...scope, lineIds: scope.lineIds.filter(id => id !== line.id) })) }))) return;
    clearLineNumbers(line.id, ["quantity", "unitRateWon", "amountWon", ...QUOTE_SCOPE_IDS.map(id => `allocation:${id}`)]);
    if (expandedLine === line.id) setExpandedLine(null);
  }
  function changePricing(line: ConstructionQuoteLine, pricing: ConstructionQuoteLine["pricing"]) {
    try { readCurrent(true); } catch (error) { setMessage(errorText(error)); return; }
    if (!editable || pricing === line.pricing) return;
    if (pricing === "lump-sum") {
      if ((line.quantity !== null || line.unitRateWon !== null || line.quantityItemId !== null ||
        numbers[`${line.id}:quantity`]?.invalid || numbers[`${line.id}:unitRateWon`]?.invalid) &&
        !window.confirm("일식으로 변경하면 이 행의 수량·단가·모델 수량 연결을 비웁니다. 견적 금액과 원문 근거는 유지합니다. 변경하시겠습니까?")) return;
      if (editLine(line.id, { pricing, quantity: null, unitRateWon: null, quantityItemId: null, unit: "lot" })) clearLineNumbers(line.id, ["quantity", "unitRateWon"]);
    } else editLine(line.id, { pricing, unit: "m2" });
  }
  function runReview() {
    if (!validDraft || !quote || stale || savedChanged || !inputKey) return;
    try {
      const current = readCurrent(false);
      if (constructionQuoteBasis(current, costInputs) !== basis.value || comparisonCostKey(current) !== comparisonKey ||
          (lockedProp || isPlanningGeometryLocked(current)) !== locked) {
        throw new Error("현재 계획·공사비 기준이 변경됐습니다. 최신 기준을 확인한 뒤 대사를 실행해 주세요.");
      }
      const reviewScenario = { ...current, constructionQuote: quote };
      const assessment = assessConstructionQuote(reviewScenario, costInputs);
      const comparison = evaluateConstructionQuoteCostComparison(reviewScenario, costInputs, geometry);
      assertSession();
      setReview({ key: inputKey, assessment, comparison });
      setMessage("입력한 검토 기준일에 대한 대사를 실행했습니다. 증빙 저장 및 재무 반영과는 별개입니다.");
    } catch (error) { setReview(null); setMessage(errorText(error)); }
  }
  function saveDraft() {
    if (!editable || !validDraft || !dirty) return;
    try {
      const current = readCurrent(true);
      const patch = saveConstructionQuote(current, quote, costInputs);
      if (!patch.constructionQuote) throw new Error("저장할 견적 증빙이 없습니다.");
      onChange(patch);
      const key = serialized(patch.constructionQuote);
      setDraft({ quote: patch.constructionQuote, savedKey: key, baselineKey: key, error: "" });
      setReview(null);
      setMessage("견적 증빙을 저장하고 기존 검증 결과를 초기화했습니다. 공사비·사업성에는 반영하지 않았습니다.");
    } catch (error) { setMessage(errorText(error)); }
  }
  function rebaseDraft() {
    if (!quote || locked || savedChanged || !stale || !basis.value) return;
    try {
      const current = readCurrent(true);
      const key = serialized(current);
      if (!key || !window.confirm("견적 수량·단가·금액·공종 근거와 검토 기준일은 유지하고, 초안의 계획·기본 단가 기준만 현재 값으로 갱신하시겠습니까? 기존 초안 대사 결과는 무효화되며, 갱신한 초안은 별도로 저장해야 합니다.")) return;
      const latest = readCurrent(true);
      if (serialized(latest) !== key) throw new Error("확인 중 계획안이 변경되어 기준을 갱신하지 않았습니다.");
      const fresh = createConstructionQuoteDraft(latest, costInputs, quote.reviewDate);
      setDraft(previous => previous.quote ? { ...previous, quote: { ...previous.quote, sourceBasis: fresh.sourceBasis, inputs: fresh.inputs } } : previous);
      setReview(null);
      setMessage("초안의 계획·단가 기준을 갱신했습니다. 기존 초안 대사 결과는 무효이며 견적 입력값은 유지됩니다. 저장된 계획과 증빙은 변경하지 않았습니다.");
    } catch (error) { setMessage(errorText(error)); }
  }
  function reloadDraft(startNew = false) {
    try {
      const current = readCurrent(startNew, false);
      const key = serialized(current);
      if (!key) throw new Error("현재 계획안을 확인하지 못했습니다.");
      if ((dirty || savedChanged || startNew) && !window.confirm(startNew
        ? "현재 계획 기준으로 빈 초안을 시작하시겠습니까? 기존 저장 증빙은 새 초안을 저장하기 전까지 유지됩니다."
        : "현재 초안을 버리고 최신 저장 증빙을 불러오시겠습니까? 저장 증빙이 없으면 빈 초안으로 시작합니다.")) return;
      const latest = readCurrent(startNew, false);
      if (serialized(latest) !== key) throw new Error("확인 중 계획안이 변경되어 초안을 바꾸지 않았습니다.");
      const next = startNew ? initialDraft({ ...latest, constructionQuote: undefined }, costInputs) : initialDraft(latest, costInputs);
      setDraft(startNew ? { ...next, savedKey: serialized(latest.constructionQuote), baselineKey: null } : next);
      setNumbers({}); setDateErrors({}); setReview(null); setExpandedLine(null); setExpandedScope(null);
      setMessage(next.error || (startNew ? "현재 계획 기준의 새 초안입니다. 증빙은 아직 저장되지 않았습니다." : "최신 저장 상태를 불러왔습니다."));
    } catch (error) { setMessage(errorText(error)); }
  }
  function deleteSaved() {
    if (locked || savedChanged || scenario.constructionQuote === undefined) return;
    try {
      const current = readCurrent(true);
      const key = serialized(current);
      if (!key || !window.confirm("저장된 견적 증빙과 기존 검증 결과를 삭제하시겠습니까? 공사비·사업성은 변경하지 않으며, 현재 초안은 미저장 상태로 유지합니다.")) return;
      const latest = readCurrent(true);
      if (serialized(latest) !== key) throw new Error("확인 중 계획안이 변경되어 증빙을 삭제하지 않았습니다.");
      onChange({ constructionQuote: undefined, checks: [] });
      setDraft(previous => ({ ...previous, savedKey: serialized(undefined), baselineKey: null }));
      setReview(null);
      setMessage("저장 증빙을 삭제했습니다. 현재 초안은 미저장 상태이며 공사비·사업성은 변경하지 않았습니다.");
    } catch (error) { setMessage(errorText(error)); }
  }
  function downloadDraft() {
    if (!parsed.success || invalidNumbers || invalidDates) return;
    try {
      readCurrent(false, false);
      const url = URL.createObjectURL(new Blob([JSON.stringify(parsed.data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `construction-quote-${scenario.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-draft.json`;
      document.body.appendChild(link);
      try { assertSession(); link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
      setMessage("현재 초안의 JSON을 다운로드했습니다. 증빙 저장 상태는 변경하지 않았습니다.");
    } catch (error) { setMessage(errorText(error)); }
  }
  function assertImportCurrent() {
    const current = readCurrent(true);
    if (constructionQuoteBasis(current, costInputs) !== basis.value) throw new Error("파일 확인 중 계획 기준이 변경됐습니다. 다시 불러와 주세요.");
  }
  function importDraft(next: ConstructionQuote) {
    assertImportCurrent();
    setDraft(previous => ({ ...previous, quote: structuredClone(next), error: "" }));
    setNumbers({}); setDateErrors({}); setReview(null); setExpandedLine(null); setExpandedScope(null);
    setMessage("파일을 미저장 초안으로 가져왔습니다. 저장 증빙·계획·사업비는 변경하지 않았습니다.");
  }

  if (!sessionValid) return <div className="lv-quote"><p role="alert">사용자 세션이 종료되거나 변경됐습니다. 견적 초안을 닫았습니다.</p></div>;

  return <div className="lv-quote">
    <div className="lv-quote-heading"><h4>신축 공사 견적 대사</h4>
      <span className="lv-note">공식 승인 미확정 · 재무 미반영</span></div>
    <p className="lv-status">저장 증빙: {scenario.constructionQuote === undefined ? "없음" : "있음 · 입력 증빙"}</p>
    {quote && <p className="lv-status" data-state={stale || savedChanged ? "conflict" : "review"}>
      초안: {savedChanged ? "외부 저장본 변경 · 현재 초안 보존 중" : dirty ? "저장되지 않은 변경 있음" : "저장본과 동일"}
    </p>}
    {locked && <p className="lv-quote-warning">잠긴 계획안 · 견적 편집·저장·삭제 불가</p>}
    {stale && <p role="alert">초안의 계획·주차·코어 또는 기본 단가 기준이 현재 계획과 다릅니다. 기준 갱신 전에는 편집·저장할 수 없습니다.</p>}
    {savedChanged && <p role="alert">저장 증빙이 외부에서 변경됐습니다. 현재 초안은 자동으로 덮어쓰지 않았으며 저장이 차단됩니다.</p>}
    {(draft.error || basis.error) && <p role="alert">{draft.error || basis.error}</p>}
    <div className="lv-actions">
      <button type="button" onClick={() => reloadDraft()}><RefreshCw size={15} aria-hidden="true" />최신 저장본 불러오기</button>
      {quote ? <button type="button" disabled={locked || savedChanged || !stale || !basis.value} onClick={rebaseDraft}>
        <RefreshCw size={15} aria-hidden="true" />현재 기준으로 갱신</button>
        : <button type="button" disabled={locked || !basis.value} onClick={() => reloadDraft(true)}>
          <Plus size={15} aria-hidden="true" />새 초안 시작</button>}
      <button type="button" disabled={!validDraft} onClick={downloadDraft}><Download size={15} aria-hidden="true" />초안 JSON 다운로드</button>
      <button type="button" className="lv-quote-icon" title="저장 견적 증빙 삭제" aria-label="저장 견적 증빙 삭제"
        disabled={locked || savedChanged || scenario.constructionQuote === undefined} onClick={deleteSaved}><Trash2 size={15} aria-hidden="true" /></button>
    </div>
    <p role="status" className="lv-quote-message">{message}</p>
    <ConstructionQuoteImport contextKey={inputKey} disabled={locked || savedChanged || !basis.value}
      currentBasis={basis.value} assertCurrent={assertImportCurrent} onApply={importDraft} />
    {quote && <>
      <section className="lv-quote-section" aria-label="견적 문서 정보"><h4>문서 정보</h4>
        <dl className="lv-quote-metrics">
          <div><dt>현재 BASE 연면적 단가</dt><dd>{formatMoney(costInputs.constructionCostPerSqmWon)} / ㎡</dd></div>
          <div><dt>현재 지하층 배율</dt><dd>{formatNumber(costInputs.basementCostMultiplier)} 배</dd></div>
          {stale && <><div><dt>초안 기준 연면적 단가</dt><dd>{formatMoney(quote.inputs.constructionCostPerSqmWon)} / ㎡</dd></div>
            <div><dt>초안 기준 지하층 배율</dt><dd>{formatNumber(quote.inputs.basementCostMultiplier)} 배</dd></div></>}
        </dl>
        <fieldset disabled={!editable}>
          <legend className="lv-quote-sr-only">견적 문서 정보 편집</legend>
          <div className="lv-fields">{([
            ["reference", "견적 문서 참조"], ["issuer", "발행자"], ["projectReference", "대상 주소·공사명"],
          ] as const).map(([field, label]) => <label key={field} className="lv-field">{label}
            <input type="text" maxLength={300} aria-label={label} value={quote[field]}
              onChange={event => editQuote(value => ({ ...value, [field]: event.target.value }))} /></label>)}</div>
          <div className="lv-fields">{([
            ["issuedOn", "발행일"], ["validUntil", "견적 유효기한"], ["reviewDate", "검토 기준일 (입력 기준)"],
          ] as const).map(([field, label]) => <label key={field} className="lv-field">{label}
            <input type="date" max="9999-12-31" aria-label={label} aria-invalid={dateErrors[field] || undefined} value={quote[field]}
              onChange={event => {
                const value = event.currentTarget.value;
                const invalid = !event.currentTarget.validity.valid;
                if (editQuote(previous => ({ ...previous, [field]: value }))) setDateErrors(previous => ({ ...previous, [field]: invalid }));
              }} />{dateErrors[field] && <span className="lv-quote-error">유효한 연·월·일이 필요합니다.</span>}</label>)}</div>
          <div className="lv-fields">
            <VatField label="BASE 부가세 기준" value={quote.baseVatBasis} onChange={baseVatBasis => editQuote(value => ({ ...value, baseVatBasis }))} />
            <VatField label="견적 부가세 기준" value={quote.vatBasis} onChange={vatBasis => editQuote(value => ({ ...value, vatBasis }))} />
            <QuoteNumberField label="문서 기재 합계 (원)" value={quote.statedTotalWon} state={numbers.statedTotalWon}
              onChange={(statedTotalWon, state) => { if (editQuote(value => ({ ...value, statedTotalWon }))) setNumbers(previous => ({ ...previous, statedTotalWon: state })); }} />
          </div>
        </fieldset>
      </section>
      <section className="lv-quote-section" aria-label="견적 내역">
        <div className="lv-quote-heading"><h4>견적 내역 <span className="lv-note">{quote.lines.length} / 256행</span></h4>
          <button type="button" className="lv-quote-icon" title="견적 행 추가" aria-label="견적 행 추가"
            disabled={!editable || quote.lines.length >= 256} onClick={addLine}><Plus size={16} aria-hidden="true" /></button></div>
        {quote.lines.length === 0 && <p className="lv-note">입력된 견적 행이 없습니다.</p>}
        {quote.lines.map((line, index) => <details className="lv-quote-line" key={line.id} open={expandedLine === line.id}>
          <summary onClick={event => { event.preventDefault(); setExpandedLine(expandedLine === line.id ? null : line.id); }}>
            <span>{index + 1}행 · {line.description || "항목 미입력"}</span>
            <span>{line.pricing === "lump-sum" ? "일식" : "수량 × 단가"} · {formatMoney(line.amountWon)}</span>
          </summary>
          {expandedLine === line.id && <fieldset disabled={!editable}>
            <legend className="lv-quote-sr-only">{index + 1}행 편집</legend>
            <div className="lv-fields">
              <label className="lv-field">항목명<input aria-label={`${index + 1}행 항목명`} maxLength={300} value={line.description}
                onChange={event => editLine(line.id, { description: event.target.value })} /></label>
              <label className="lv-field">원문 페이지·행<input aria-label={`${index + 1}행 원문 페이지·행`} maxLength={300} value={line.sourceLocator}
                onChange={event => editLine(line.id, { sourceLocator: event.target.value })} /></label>
              <label className="lv-field">금액 방식<select aria-label={`${index + 1}행 금액 방식`} value={line.pricing}
                onChange={event => changePricing(line, event.target.value as ConstructionQuoteLine["pricing"])}>
                <option value="unit-price">수량 × 단가</option><option value="lump-sum">일식 금액</option></select></label>
            </div>
            {line.pricing === "unit-price" && <div className="lv-fields">
              <label className="lv-field">모델 수량 항목<select aria-label={`${index + 1}행 모델 수량 항목`} value={line.quantityItemId ?? ""}
                onChange={event => editLine(line.id, { quantityItemId: event.target.value as ConstructionQuoteLine["quantityItemId"] || null })}>
                <option value="">연결 없음</option>{QUANTITY_ITEM_IDS.map(id => <option key={id} value={id}>{QUOTE_SCOPE_LABELS[id]}</option>)}</select></label>
              <label className="lv-field">견적 단위<select aria-label={`${index + 1}행 견적 단위`} value={line.unit}
                onChange={event => editLine(line.id, { unit: event.target.value as ConstructionQuoteLine["unit"] })}>
                {Object.entries(units).map(([unit, label]) => <option key={unit} value={unit}>{label}</option>)}</select></label>
              {(["quantity", "unitRateWon"] as const).map(field => <QuoteNumberField key={field}
                label={`${index + 1}행 ${field === "quantity" ? "견적 수량" : "견적 단가 (원)"}`} max={field === "quantity" ? 1e9 : 1e13}
                value={line[field]} state={numbers[`${line.id}:${field}`]} onChange={(value, state) => {
                  if (editLine(line.id, { [field]: value })) setNumbers(previous => ({ ...previous, [`${line.id}:${field}`]: state }));
                }} />)}
            </div>}
            <div className="lv-fields">
              <QuoteNumberField label={`${index + 1}행 견적 금액 (원)`} value={line.amountWon} state={numbers[`${line.id}:amountWon`]}
                onChange={(amountWon, state) => { if (editLine(line.id, { amountWon })) setNumbers(previous => ({ ...previous, [`${line.id}:amountWon`]: state })); }} />
              <VatField label={`${index + 1}행 부가세 기준`} value={line.vatBasis} onChange={vatBasis => editLine(line.id, { vatBasis })} />
            </div>
            <label className="lv-field">행 비고·0원 근거<textarea rows={2} maxLength={2000} aria-label={`${index + 1}행 비고·0원 근거`} value={line.note}
              onChange={event => editLine(line.id, { note: event.target.value })} /></label>
            <section className="lv-quote-allocations" aria-label={`${index + 1}행 공종별 금액 배분`}>
              <div className="lv-quote-heading"><h5>공종별 금액 배분</h5>
                <span className="lv-note">전체 배분 {allocationCount} / {MAX_QUOTE_ALLOCATIONS}개</span></div>
              <p className="lv-note">연결 공종: {quote.coverage.filter(scope => scope.lineIds.includes(line.id))
                .map(scope => QUOTE_SCOPE_LABELS[scope.id]).join(" · ") || "없음"}</p>
              <div className="lv-actions">
                <button type="button" aria-label={`${index + 1}행 연결 공종으로 배분 갱신`}
                  disabled={!line.allocations?.length && !quote.coverage.some(scope => scope.lineIds.includes(line.id))}
                  onClick={() => refreshAllocations(line)}><RefreshCw size={15} aria-hidden="true" />연결 공종으로 배분 갱신</button>
                <button type="button" className="lv-quote-icon" title={`${index + 1}행 공종 배분 전체 삭제`}
                  aria-label={`${index + 1}행 공종 배분 전체 삭제`} disabled={!line.allocations?.length}
                  onClick={() => deleteAllocations(line)}><Trash2 size={15} aria-hidden="true" /></button>
              </div>
              {!line.allocations?.length && <p className="lv-note">입력된 공종별 배분 없음</p>}
              {line.allocations?.map(part => <div className="lv-quote-allocation" key={part.scopeId}>
                <div className="lv-quote-heading"><strong>{QUOTE_SCOPE_LABELS[part.scopeId]}</strong>
                  <button type="button" className="lv-quote-icon" title={`${index + 1}행 ${QUOTE_SCOPE_LABELS[part.scopeId]} 배분 삭제`}
                    aria-label={`${index + 1}행 ${QUOTE_SCOPE_LABELS[part.scopeId]} 배분 삭제`}
                    onClick={() => deleteAllocations(line, part.scopeId)}><Trash2 size={15} aria-hidden="true" /></button></div>
                {!quote.coverage.some(scope => scope.id === part.scopeId && scope.lineIds.includes(line.id)) &&
                  <p className="lv-quote-warning">공종 연결 해제 · 배분 근거 보존 중</p>}
                <div className="lv-quote-allocation-fields">
                  <QuoteNumberField label={`${index + 1}행 ${QUOTE_SCOPE_LABELS[part.scopeId]} 배분 금액 (원)`}
                    value={part.amountWon} state={numbers[`${line.id}:allocation:${part.scopeId}`]}
                    onChange={(amountWon, state) => {
                      if (editAllocation(line.id, part.scopeId, { amountWon })) {
                        setNumbers(previous => ({ ...previous, [`${line.id}:allocation:${part.scopeId}`]: state }));
                      }
                    }} />
                  <label className="lv-field">배분 원문 근거<textarea rows={2} maxLength={300}
                    aria-label={`${index + 1}행 ${QUOTE_SCOPE_LABELS[part.scopeId]} 배분 원문 근거`} value={part.source}
                    onChange={event => editAllocation(line.id, part.scopeId, { source: event.target.value })} /></label>
                </div>
              </div>)}
            </section>
            <div className="lv-actions"><button type="button" className="lv-quote-icon" title={`${index + 1}행 삭제`} aria-label={`${index + 1}행 삭제`}
              onClick={() => deleteLine(line, index)}><Trash2 size={15} aria-hidden="true" /></button></div>
          </fieldset>}
        </details>)}
      </section>
      <section className="lv-quote-section" aria-label="공종 포함 범위"><h4>공종 포함 범위 · {quote.coverage.length}개</h4>
        {quote.coverage.map(scope => <details className="lv-quote-scope" key={scope.id} open={expandedScope === scope.id}>
          <summary onClick={event => { event.preventDefault(); setExpandedScope(expandedScope === scope.id ? null : scope.id); }}>
            <span>{QUOTE_SCOPE_LABELS[scope.id]}</span><span>{scopeLabels[scope.status]} · 연결 {scope.lineIds.length}행</span>
          </summary>
          {expandedScope === scope.id && <fieldset disabled={!editable}>
            <legend className="lv-quote-sr-only">{QUOTE_SCOPE_LABELS[scope.id]} 범위 편집</legend>
            <div className="lv-fields"><label className="lv-field">포함 상태<select aria-label={`${QUOTE_SCOPE_LABELS[scope.id]} 포함 상태`} value={scope.status}
              onChange={event => editScope(scope.id, { status: event.target.value as Scope["status"] })}>
              {Object.entries(scopeLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label></div>
            <fieldset className="lv-quote-bindings"><legend>연결 견적 행</legend>
              {quote.lines.length === 0 && <p className="lv-note">연결할 견적 행이 없습니다.</p>}
              {quote.lines.map((line, index) => <label key={line.id}><input type="checkbox"
                aria-label={`${QUOTE_SCOPE_LABELS[scope.id]} ${index + 1}행 연결`} checked={scope.lineIds.includes(line.id)}
                disabled={!scope.lineIds.includes(line.id) && scope.lineIds.length >= 256}
                onChange={event => editScope(scope.id, { lineIds: event.target.checked ? [...scope.lineIds, line.id] : scope.lineIds.filter(id => id !== line.id) })} />
                <span>{index + 1}행 · {line.description || "항목 미입력"}{line.sourceLocator ? ` · ${line.sourceLocator}` : ""}</span></label>)}
              {scope.lineIds.filter(id => !quote.lines.some(line => line.id === id)).map(id => <label key={id} className="lv-quote-error">
                <input type="checkbox" checked aria-label={`${QUOTE_SCOPE_LABELS[scope.id]} 없는 행 ${id} 연결 해제`}
                  onChange={() => editScope(scope.id, { lineIds: scope.lineIds.filter(value => value !== id) })} />
                <span>존재하지 않는 행 · {id}</span></label>)}
            </fieldset>
            <label className="lv-field">포함·제외 범위의 원문 근거<textarea rows={2} maxLength={2000}
              aria-label={`${QUOTE_SCOPE_LABELS[scope.id]} 범위 근거`} value={scope.note}
              onChange={event => editScope(scope.id, { note: event.target.value })} /></label>
          </fieldset>}
        </details>)}
      </section>
      <section className="lv-quote-section" aria-label="견적 대사 결과">
        <div className="lv-quote-heading"><h4>입력 대사</h4><button type="button" disabled={!validDraft || stale || savedChanged || !inputKey} onClick={runReview}>
          <ListChecks size={15} aria-hidden="true" />대사 실행</button></div>
        <p className="lv-status" data-state={currentReview?.status === "conflict" || stale || !validDraft ? "conflict" : "review"}>
          {stale ? assessmentLabels.stale : !validDraft ? "입력 형식 오류 · 대사·저장 보류" : currentReview
            ? assessmentLabels[currentReview.status] : review ? "입력 변경 · 기존 대사 결과 무효" : "대사 미실행"}
        </p>
        {!parsed.success && <p role="alert">날짜·수치·문자 수 또는 행·공종 입력 형식이 올바르지 않습니다.</p>}
        {invalidNumbers && <p role="alert">허용 범위를 벗어나거나 완성되지 않은 숫자가 있습니다.</p>}
        {invalidDates && <p role="alert">완성되지 않았거나 유효하지 않은 날짜가 있습니다.</p>}
        {currentReview && <>
          <p className="lv-note">검토 기준일: {quote.reviewDate || "미입력"} · 입력된 날짜 기준</p>
          <dl className="lv-quote-metrics">
            <div><dt>문서 기재 합계</dt><dd>{formatMoney(quote.statedTotalWon)}</dd></div>
            <div><dt>입력 행 합계</dt><dd>{formatMoney(currentReview.lineTotalWon)}</dd></div>
            <div><dt>BASE 기본 공사비</dt><dd>{formatMoney(currentReview.baseEstimateWon)}</dd></div>
            <div><dt>기본단가만 비교한 차액</dt><dd>{formatMoney(currentReview.differenceFromBaseWon, true)}</dd></div>
          </dl>
          <p className="lv-note">BASE는 현재 연면적·기본 단가·지하층 배율의 산술값입니다. 기본단가만 비교한 차액은 재료비·추가 세대·상세 수량 원가 증감을 제외한 참고값이며 절감액·사업비 반영액을 뜻하지 않습니다. 미확정·불일치가 있는 견적의 차액은 미산정입니다.</p>
          {currentQuoteReview && <ConstructionQuoteCostComparison comparison={currentQuoteReview.comparison} />}
          {currentQuoteReview && <ConstructionQuoteAdoptionReview key={currentQuoteReview.key}
            scenario={{ ...scenario, constructionQuote: quote! }} inputs={costInputs} geometry={geometry}
            readCurrent={() => {
              const current = readCurrent(false);
              if (constructionQuoteBasis(current, costInputs) !== basis.value || comparisonCostKey(current) !== comparisonKey) {
                throw new Error("계획·원가 기준이 바뀌었습니다. 대사를 다시 실행해야 합니다.");
              }
              return { ...current, constructionQuote: quote! };
            }} />}
          <div className="lv-table-wrap"><table><caption>모델 예비 수량과 견적 수량 대사</caption>
            <thead><tr><th scope="col">수량 항목</th><th scope="col">단위</th><th scope="col">모델 예비 수량</th><th scope="col">견적 수량</th><th scope="col">입력 대사</th></tr></thead>
            <tbody>{currentReview.quantities.map(item => <tr key={item.id}>
              <th scope="row">{item.label}</th><td>{item.id === "partitionLengthM" ? "m" : item.id === "dryFloorAreaSqm" || item.id === "wetFloorAreaSqm" ? "㎡" : "개"}</td>
              <td>{formatNumber(item.model)}</td><td>{formatNumber(item.quoted)}</td>
              <td className={item.status === "fail" ? "lv-quote-error" : undefined}>{item.status === "checked" ? "입력 수량 일치" : item.status === "fail" ? "불일치" : "미확정"}</td>
            </tr>)}</tbody></table></div>
          {(["fail", "missing"] as const).map(status => {
            const issues = currentReview.issues.filter(issue => issue.status === status);
            return <details className="lv-quote-issues" key={status}><summary>{status === "fail" ? "불일치" : "미확정"} · {issues.length}건</summary>
              {issues.length > 0 ? <ul className="lv-issues">{issues.map((issue, index) => <li key={`${issue.code}:${index}`} data-state={issue.status}>{issue.detail}</li>)}</ul>
                : <p className="lv-note">해당 항목 없음</p>}</details>;
          })}
          <ConstructionScopeLedgerSummary quote={quote} />
        </>}
        <p className="lv-note">문서 진위·실제 전체 공사비의 완결성·공식 승인·전문 검토는 미확정입니다. 견적 증빙은 공사비·사업성에 자동 반영되지 않습니다.</p>
        <div className="lv-actions"><button type="button" disabled={!editable || !validDraft || !dirty} onClick={saveDraft}>
          <Save size={15} aria-hidden="true" />견적 증빙 저장</button>
          <span className="lv-note">미확정·불일치가 있는 유효 초안도 저장 가능 · 재무 미반영</span></div>
      </section>
    </>}
  </div>;
}
