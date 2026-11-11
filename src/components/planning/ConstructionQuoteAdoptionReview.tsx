"use client";

import { useState } from "react";
import { Check, ListChecks, Undo2 } from "lucide-react";
import { applyFullQuoteAdoption, assessFullQuoteAdoption, removeFullQuoteAdoption } from "@/lib/planning/full-quote-adoption";
import { calculatePlanningScenario, type PlanningCalculationContext } from "@/lib/planning/scenario-calculator";
import { quoteAdoptionBusinessDate } from "@/lib/planning/construction-quote-adoption-review";
import { createQuoteAdoptionReviewDraft, evaluateQuoteAdoptionReview, quoteAdoptionReviewKey,
  QUOTE_ADOPTION_SCOPE_LABELS, type QuoteAdoptionReview, type QuoteAdoptionReviewDraft } from "@/lib/planning/construction-quote-adoption-review";
import type { PlanningScenario } from "@/lib/planning/types";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { QuantityCostInputs } from "@/lib/planning/quantity-cost-contract";

type Props = { scenario: PlanningScenario; inputs: QuantityCostInputs; geometry?: PlanningGeometrySnapshot;
  readCurrent: () => PlanningScenario; context?: PlanningCalculationContext;
  readWritableCurrent?: () => PlanningScenario; onChange?: (patch: Partial<PlanningScenario>) => void };
const labels: Record<QuoteAdoptionReview["status"], string> = { ready: "반영 조건 입력 확인", missing: "반영 조건 미확정",
  stale: "기준 변경 · 재검토 필요", conflict: "입력 불일치" };
const money = (value: number | null) => value === null ? "미확정" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 원`;

export function ConstructionQuoteAdoptionReview({ scenario, inputs, geometry, readCurrent, context, readWritableCurrent, onChange }: Props) {
  const [draft, setDraft] = useState<QuoteAdoptionReviewDraft | null>(() => {
    try { return createQuoteAdoptionReviewDraft(scenario, inputs, geometry); } catch { return null; }
  });
  const [result, setResult] = useState<QuoteAdoptionReview | null>(null);
  const [error, setError] = useState("");
  function adopt() {
    if (!draft || result?.status !== "ready" || !context || !readWritableCurrent || !onChange) return;
    try {
      const current = readWritableCurrent();
      const patch = applyFullQuoteAdoption(current, inputs, geometry, draft);
      const after = calculatePlanningScenario({ ...current, ...patch }, context).economicsPreview;
      if (after.status !== "estimated" || after.fullQuoteCostStatus !== "ready") throw new Error(after.fullQuoteCostIssue || "견적 반영 계산 실패");
      if (!window.confirm(`전체 견적으로 직접 공사비를 교체할까요?\n공사비 ${money(after.constructionCostManwon * 10000)}\n예비 총사업비 ${money(after.totalCostManwon * 10000)}\n예비 손익 ${money(after.profitManwon * 10000)}\n기본·외장·세대·수량 비용은 중복 가산하지 않습니다. 전문가 승인은 미확정입니다.`)) return;
      const latest = readWritableCurrent();
      const fresh = applyFullQuoteAdoption(latest, inputs, geometry, draft);
      onChange({ ...fresh, economicsPreview: calculatePlanningScenario({ ...latest, ...fresh }, context).economicsPreview });
      setResult(null); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "전체 견적 채택 실패"); }
  }
  function edit(next: QuoteAdoptionReviewDraft) { setDraft(next); setResult(null); setError(""); }
  function check() {
    if (!draft) return;
    try {
      const current = readCurrent();
      if (quoteAdoptionReviewKey(current, inputs, geometry) !== draft.sourceKey) {
        throw new Error("검토 중 계획·견적·원가 기준이 바뀌었습니다. 대사를 다시 실행해야 합니다.");
      }
      setResult(evaluateQuoteAdoptionReview(current, inputs, geometry, draft)); setError("");
    } catch (cause) { setResult(null); setError(cause instanceof Error ? cause.message : "반영 조건을 확인하지 못했습니다."); }
  }
  return <section className="lv-quote-adoption" aria-label="전체 견적 반영 전 검토">
    <h4>전체 견적 반영 전 검토</h4>
    <p className="lv-note">검토 초안 · 사업비 미반영 · 공식 경계·허가·전문가 승인 미확정</p>
    {!draft ? <p role="alert">검토할 원본 입력이 유효하지 않습니다.</p> : <>
      <label className="lv-field">반영 검토일 · 한국 기준<input type="date" aria-label="반영 검토일" value={draft.checkedOn}
        onChange={event => edit({ ...draft, checkedOn: event.target.value })} /></label>
      <div className="lv-quote-adoption-scopes">{draft.scopes.map(scope => <div className="lv-quote-adoption-scope" key={scope.id}>
        <label><input type="checkbox" checked={scope.confirmed}
          onChange={event => edit({ ...draft, scopes: draft.scopes.map(item => item.id === scope.id
            ? { ...item, confirmed: event.target.checked } : item) })} />{QUOTE_ADOPTION_SCOPE_LABELS[scope.id]}</label>
        <label className="lv-field">원문 근거<input type="text" maxLength={2000} value={scope.source}
          aria-label={`${QUOTE_ADOPTION_SCOPE_LABELS[scope.id]} 원문 근거`}
          onChange={event => edit({ ...draft, scopes: draft.scopes.map(item => item.id === scope.id
            ? { ...item, source: event.target.value } : item) })} /></label>
      </div>)}</div>
      <button type="button" className="ui-btn" onClick={check}><ListChecks size={14} aria-hidden="true" />반영 조건 검토</button>
    </>}
    {error && <p role="alert">{error}</p>}
    {result && <div role="status" data-adoption-status={result.status}>
      <h4>{labels[result.status]}</h4>
      {result.issues.length > 0 && <ul>{result.issues.map(message => <li key={message}>{message}</li>)}</ul>}
      <dl className="lv-quote-metrics">
        <div><dt>교체 대상 현재 공사비</dt><dd>{money(result.replacedConstructionCostWon)}</dd></div>
        <div><dt>검토 후보 전체 견적</dt><dd>{money(result.proposedConstructionCostWon)}</dd></div>
        <div><dt>교체 차액</dt><dd>{money(result.differenceWon)}</dd></div>
      </dl>
      <p className="lv-note">직접 공사비 교체 후보이며 추가 가산액이 아닙니다. 부가세 환급·원문 진위·전문 검토는 미확정입니다.</p>
      {context && onChange && <button type="button" className="ui-btn" disabled={result.status !== "ready" || !readWritableCurrent}
        onClick={adopt}><Check size={14} aria-hidden="true" />전체 견적을 사업비로 채택</button>}
      {context && !readWritableCurrent && <p className="lv-note">현재 견적을 저장한 뒤 다시 대사해야 채택할 수 있습니다.</p>}
    </div>}
  </section>;
}

export function FullQuoteAdoptionStatus({ scenario, inputs, geometry, context, readWritableCurrent, onChange }: Omit<Props, "readCurrent">) {
  const [error, setError] = useState("");
  if (scenario.fullQuoteAdoption === undefined) return null;
  let problem = "";
  try { assessFullQuoteAdoption(scenario, inputs, geometry, quoteAdoptionBusinessDate()); }
  catch (cause) { problem = cause instanceof Error ? cause.message : "전체 견적 채택 재검토 필요"; }
  function remove() {
    if (!readWritableCurrent || !onChange) return;
    try {
      const current = readWritableCurrent();
      const key = JSON.stringify(current.fullQuoteAdoption);
      if (!window.confirm("전체 견적 채택을 해제하고 기존 연면적·외장·세대·수량 원가 산식으로 돌아갈까요? 견적 증빙은 보존됩니다.")) return;
      const latest = readWritableCurrent();
      if (JSON.stringify(latest.fullQuoteAdoption) !== key) throw new Error("채택 정보가 변경됐습니다. 최신 상태에서 다시 확인하세요.");
      const patch = removeFullQuoteAdoption(latest);
      onChange({ ...patch, ...(context ? { economicsPreview: calculatePlanningScenario({ ...latest, ...patch }, context).economicsPreview } : {}) });
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "채택 해제 실패"); }
  }
  return <section aria-label="전체 견적 채택 상태" className="lv-quote-adoption">
    <h4>{problem ? "전체 견적 재검토 필요 · 현재 사업성 미확정" : "전체 견적 채택 · 예비 사업비"}</h4>
    {problem ? <p role="alert">{problem} 이전 계산은 현재 유효한 견적을 뜻하지 않습니다.</p> :
      <p>직접 공사비 {money(scenario.fullQuoteAdoption.totalWon)} · 채택일 {scenario.fullQuoteAdoption.adoptedOn} · 유효기한 {scenario.fullQuoteAdoption.quote.validUntil}</p>}
    <p className="lv-note">기본·외장·세대·수량 원가는 비교 근거로만 보존됩니다. 철거·간접·예비·금융·취득 비용은 별도입니다. 공식 경계·허가·전문가 승인은 미확정입니다.</p>
    <button type="button" className="ui-btn" disabled={!readWritableCurrent} onClick={remove}><Undo2 size={14} aria-hidden="true" />전체 견적 채택 해제</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
