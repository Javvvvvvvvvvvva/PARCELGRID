"use client";

import { useEffect, useRef, useState } from "react";
import { FileInput, Upload, X } from "lucide-react";
import { readConstructionQuoteFile } from "@/lib/planning/construction-quote-import";
import type { ConstructionQuote } from "@/lib/planning/construction-quote";

type Props = {
  contextKey: string | null; disabled: boolean; currentBasis: string | null;
  assertCurrent: () => void;
  onApply: (quote: ConstructionQuote) => void;
};
type Preview = { name: string; quote: ConstructionQuote; contextKey: string };

export function ConstructionQuoteImport({ contextKey, disabled, currentBasis, assertCurrent, onApply }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const current = useRef({ contextKey, disabled });
  current.current = { contextKey, disabled };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = !disabled && preview?.contextKey === contextKey ? preview : null;

  useEffect(() => {
    pending.current?.abort(); pending.current = null;
    setPreview(null); setBusy(false); setError("");
    return () => { pending.current?.abort(); pending.current = null; };
  }, [contextKey, disabled]);

  function cancel() {
    pending.current?.abort(); pending.current = null;
    setPreview(null); setBusy(false); setError("");
  }
  async function read(file?: File) {
    cancel();
    if (!file || disabled || !contextKey) return;
    const controller = new AbortController();
    pending.current = controller;
    const valid = () => !controller.signal.aborted && pending.current === controller &&
      !current.current.disabled && current.current.contextKey === contextKey;
    try {
      assertCurrent(); setBusy(true);
      const quote = await readConstructionQuoteFile(file, controller.signal);
      if (!valid()) return;
      assertCurrent();
      setPreview({ name: file.name, quote, contextKey });
    } catch (caught) {
      if (valid()) setError(caught instanceof Error ? caught.message : "견적 파일을 읽지 못했습니다.");
    } finally { if (valid()) { pending.current = null; setBusy(false); } }
  }
  function apply() {
    if (!visible || disabled || current.current.contextKey !== visible.contextKey) return;
    try {
      assertCurrent();
      if (!window.confirm("현재 미저장 견적 초안을 파일 내용으로 교체하시겠습니까? 저장 증빙·계획·사업비는 변경하지 않습니다. 다른 계획 기준의 파일은 별도 기준 갱신과 대사가 필요합니다.")) return;
      assertCurrent();
      if (current.current.disabled || current.current.contextKey !== visible.contextKey) return;
      onApply(visible.quote); cancel();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "견적 초안을 적용하지 못했습니다."); }
  }

  return <section className="lv-quote-section" aria-label="견적 파일 가져오기">
    <div className="lv-actions">
      <input ref={input} type="file" accept=".json,application/json" aria-label="견적 초안 JSON 파일" hidden disabled={disabled}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void read(file); }} />
      <button type="button" disabled={disabled} onClick={() => input.current?.click()}><Upload size={15} aria-hidden="true" />견적 JSON 가져오기</button>
      {(busy || visible) && <button type="button" title="견적 가져오기 취소" aria-label="견적 가져오기 취소" className="lv-quote-icon" onClick={cancel}>
        <X size={15} aria-hidden="true" /></button>}
      {busy && <span role="status">파일 확인 중</span>}
    </div>
    {error && <p role="alert">{error}</p>}
    {visible && <div aria-label="견적 가져오기 미리보기">
      <h4>{visible.name}</h4>
      <dl className="lv-quote-metrics">
        <div><dt>문서 참조</dt><dd>{visible.quote.reference || "미입력"}</dd></div>
        <div><dt>발행자</dt><dd>{visible.quote.issuer || "미입력"}</dd></div>
        <div><dt>대상 주소·공사명</dt><dd>{visible.quote.projectReference || "미입력"}</dd></div>
        <div><dt>내역</dt><dd>{visible.quote.lines.length}행 · {visible.quote.coverage.length}공종</dd></div>
        <div><dt>문서 기재 합계</dt><dd>{visible.quote.statedTotalWon === null ? "미입력" : `${visible.quote.statedTotalWon.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 원`}</dd></div>
        <div><dt>계획 기준</dt><dd>{visible.quote.sourceBasis === currentBasis ? "현재 기준 일치 · 대사 전" : "다른 계획 기준 · 재검토 필요"}</dd></div>
      </dl>
      <p className="lv-note">파일 입력 증빙 · 원문 진위·전문가 승인 미확정 · 재무 미반영</p>
      <button type="button" onClick={apply}><FileInput size={15} aria-hidden="true" />초안으로 가져오기</button>
    </div>}
  </section>;
}
