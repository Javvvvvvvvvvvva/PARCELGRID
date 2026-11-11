"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";
import { createQuoteAdoptionReviewDraft, evaluateQuoteAdoptionReview, quoteAdoptionReviewKey,
  QUOTE_ADOPTION_SCOPE_LABELS, type QuoteAdoptionReview, type QuoteAdoptionReviewDraft } from "@/lib/planning/construction-quote-adoption-review";
import type { PlanningScenario } from "@/lib/planning/types";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { QuantityCostInputs } from "@/lib/planning/quantity-cost-contract";

type Props = { scenario: PlanningScenario; inputs: QuantityCostInputs; geometry?: PlanningGeometrySnapshot;
  readCurrent: () => PlanningScenario };
const labels: Record<QuoteAdoptionReview["status"], string> = { ready: "반영 조건 입력 확인", missing: "반영 조건 미확정",
  stale: "기준 변경 · 재검토 필요", conflict: "입력 불일치" };
const money = (value: number | null) => value === null ? "미확정" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 원`;

export function ConstructionQuoteAdoptionReview({ scenario, inputs, geometry, readCurrent }: Props) {
  const [draft, setDraft] = useState<QuoteAdoptionReviewDraft | null>(() => {
    try { return createQuoteAdoptionReviewDraft(scenario, inputs, geometry); } catch { return null; }
  });
  const [result, setResult] = useState<QuoteAdoptionReview | null>(null);
  const [error, setError] = useState("");
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
      <p className="lv-note">직접 공사비 교체 후보이며 추가 가산액이 아닙니다. 별도 비용 재계산·재무 채택은 미실행입니다. 부가세 환급·원문 진위·전문 검토는 미확정입니다.</p>
    </div>}
  </section>;
}
