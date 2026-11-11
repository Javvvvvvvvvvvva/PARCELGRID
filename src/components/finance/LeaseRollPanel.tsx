"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileInput, ListChecks, Plus, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import { clientSession } from "@/lib/auth/client-session";
import { useProjectStore } from "@/lib/stores/project-store";
import { canonicalProjectWorkspaceJson } from "@/lib/workspace/project-workspace";
import { buildLeaseRollDraftKey, createLeaseRollDraft, createLeaseRollRow, leaseRollBasis, leaseRollDraftSchema,
  LEASE_USES, MAX_LEASE_ROWS, type LeaseRollDraft, type LeaseRollRow } from "@/lib/finance/lease-roll-contract";
import { compareLeaseRoll, type LeaseRollComparison } from "@/lib/finance/lease-roll-comparison";
import { readLeaseRollFile } from "@/lib/finance/lease-roll-import";
import { clearLeaseRollEditorRecovery, readLeaseRollEditorRecovery, writeLeaseRollEditorRecovery } from "@/lib/finance/lease-roll-editor-recovery";
import type { Scenario, ScenarioResult } from "@/lib/finance/types";

type Props = { projectId: string; scenario: Scenario; baseline: ScenarioResult["hold"] };
const useLabels = { residential: "주거", retail: "근린생활", office: "업무" };
const keyOf = (value: unknown) => canonicalProjectWorkspaceJson(value ?? null);
const money = (value: number | null) => value === null ? "비교 불가" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 원`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "임대차 초안을 처리하지 못했습니다.";

export function LeaseRollPanel(props: Props) {
  return <LeaseRollEditor key={`${props.projectId}:${props.scenario.id}`} {...props} />;
}

function LeaseRollEditor({ projectId, scenario, baseline }: Props) {
  const storeKey = buildLeaseRollDraftKey(projectId, scenario.id);
  const saved = useProjectStore(state => state.leaseRollDrafts[storeKey]);
  const [sessionKey] = useState(() => clientSession.context);
  const [ended, setEnded] = useState(false);
  const sessionValid = !ended && clientSession.active && sessionKey !== null && clientSession.context === sessionKey;
  const [recovery] = useState(() => readLeaseRollEditorRecovery(projectId, scenario.id));
  const initial = () => recovery?.draft ?? saved ?? createLeaseRollDraft(projectId, scenario);
  const [draft, setDraft] = useState<LeaseRollDraft | null>(() => sessionValid ? initial() : null);
  const [savedKey, setSavedKey] = useState(() => recovery?.savedKey ?? keyOf(saved));
  const [cleanKey, setCleanKey] = useState(() => recovery?.cleanKey ?? keyOf(draft));
  const [message, setMessage] = useState("");
  const [invalidNumbers, setInvalidNumbers] = useState<Record<string, boolean>>(() => recovery?.invalidNumbers ?? {});
  const [review, setReview] = useState<{ key: string; result: LeaseRollComparison } | null>(null);
  const [preview, setPreview] = useState<{ key: string; name: string; draft: LeaseRollDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentBasis = leaseRollBasis(projectId, scenario);
  const savedChanged = savedKey !== keyOf(saved);
  const numericError = Object.values(invalidNumbers).some(Boolean);
  const dirty = keyOf(draft) !== cleanKey || numericError;
  const contextKey = useMemo(() => keyOf({ projectId, scenario, baseline, saved, draft, invalidNumbers, sessionKey }),
    [projectId, scenario, baseline, saved, draft, invalidNumbers, sessionKey]);
  const live = useRef({ contextKey, sessionValid });
  live.current = { contextKey, sessionValid };
  const visibleReview = sessionValid && !savedChanged && !numericError && review?.key === contextKey ? review.result : null;
  const visiblePreview = sessionValid && !savedChanged && preview?.key === contextKey ? preview : null;
  const canWrite = clientSession.principal?.capabilities.includes("project.update") === true;
  const canAnalyze = clientSession.principal?.capabilities.includes("analysis.run") === true;
  const editable = sessionValid && !savedChanged && canWrite;

  useEffect(() => {
    const expire = () => {
      pending.current?.abort(); setEnded(true); setDraft(null); setReview(null); setPreview(null); setMessage(""); setBusy(false);
    };
    const unsubscribe = clientSession.subscribe(expire);
    if (!clientSession.active || clientSession.context !== sessionKey) expire();
    return unsubscribe;
  }, [sessionKey]);
  useEffect(() => {
    pending.current?.abort(); pending.current = null; setPreview(null); setBusy(false);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [contextKey, sessionValid]);
  useEffect(() => {
    if (!sessionValid || !clientSession.active) return;
    if (dirty && draft) writeLeaseRollEditorRecovery({ draft, savedKey, cleanKey, invalidNumbers });
    else clearLeaseRollEditorRecovery(projectId, scenario.id);
  }, [draft, dirty, savedKey, cleanKey, invalidNumbers, sessionValid, projectId, scenario.id]);
  useEffect(() => {
    if (!dirty || !sessionValid) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!clientSession.active || clientSession.context !== sessionKey) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, sessionValid, sessionKey]);

  function assertCurrent(matchSaved = true) {
    clientSession.assertActive();
    if (!live.current.sessionValid || clientSession.context !== sessionKey || live.current.contextKey !== contextKey) {
      throw new Error("계정 또는 분석 기준이 변경됐습니다. 최신 상태에서 다시 확인하세요.");
    }
    const current = useProjectStore.getState();
    const currentScenario = current.data?.scenarios.find(value => value.id === scenario.id)?._raw;
    if (current.data?.parcel.id !== projectId || !currentScenario || current.representativePlanningScenarioId !== scenario.id ||
      leaseRollBasis(projectId, currentScenario) !== currentBasis) {
      throw new Error("현재 프로젝트·계획안이 변경됐습니다.");
    }
    if (matchSaved && keyOf(current.leaseRollDrafts[storeKey]) !== savedKey) {
      throw new Error("저장본이 변경됐습니다. 최신 저장본을 불러온 뒤 다시 확인하세요.");
    }
  }
  function update(change: (value: LeaseRollDraft) => LeaseRollDraft) {
    try { assertCurrent(); if (!editable) throw new Error("임대차 초안을 변경할 권한이 없습니다."); if (draft) { setDraft(change(draft)); setMessage(""); } }
    catch (error) { setMessage(errorText(error)); }
  }
  function updateRow(id: string, patch: Partial<LeaseRollRow>) {
    update(value => ({ ...value, rows: value.rows.map(row => row.id === id ? { ...row, ...patch } : row) }));
  }
  function reload() {
    try {
      assertCurrent(false);
      if (dirty && !window.confirm("미저장 임대차 초안을 버리고 최신 저장본을 불러올까요?")) return;
      const value = useProjectStore.getState().leaseRollDrafts[storeKey];
      const next = value ?? createLeaseRollDraft(projectId, scenario);
      clearLeaseRollEditorRecovery(projectId, scenario.id);
      setDraft(next); setSavedKey(keyOf(value)); setCleanKey(keyOf(next)); setInvalidNumbers({}); setReview(null); setMessage("");
    } catch (error) { setMessage(errorText(error)); }
  }
  function save() {
    try {
      assertCurrent();
      if (!editable) throw new Error("임대차 초안을 저장할 권한이 없습니다.");
      if (!draft || numericError) throw new Error("입력 오류를 먼저 확인하세요.");
      const next = leaseRollDraftSchema.parse({ ...draft, revision: (saved?.revision ?? 0) + 1, updatedAt: new Date().toISOString() });
      useProjectStore.getState().saveLeaseRollDraft(next);
      clearLeaseRollEditorRecovery(projectId, scenario.id);
      setDraft(next); setSavedKey(keyOf(next)); setCleanKey(keyOf(next)); setReview(null);
      setMessage("임대차 초안 저장 요청 · 서버 저장 상태는 프로젝트 동기화 상태 기준 · 사업성 미반영");
    } catch (error) { setMessage(errorText(error)); }
  }
  function run() {
    try { assertCurrent(); if (!canAnalyze) throw new Error("분석 권한이 없습니다."); setReview({ key: contextKey, result: compareLeaseRoll({ draft, projectId, scenario, baseline }) }); setMessage(""); }
    catch (error) { setMessage(errorText(error)); }
  }
  function remove() {
    try {
      assertCurrent();
      if (!editable || !saved || !window.confirm("저장된 임대차 초안과 미저장 변경을 삭제할까요? 사업성 결과는 그대로 유지됩니다.")) return;
      assertCurrent();
      useProjectStore.getState().removeLeaseRollDraft(projectId, scenario.id);
      clearLeaseRollEditorRecovery(projectId, scenario.id);
      const next = createLeaseRollDraft(projectId, scenario);
      setDraft(next); setSavedKey(keyOf(null)); setCleanKey(keyOf(next)); setInvalidNumbers({}); setReview(null);
      setMessage("임대차 초안 삭제 요청 · 사업성 미변경");
    } catch (error) { setMessage(errorText(error)); }
  }
  function download() {
    try {
      assertCurrent(false);
      const parsed = leaseRollDraftSchema.parse(draft);
      if (numericError) throw new Error("잘못된 숫자가 있는 초안은 내보낼 수 없습니다.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(parsed, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "parcelgrid-lease-roll.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(errorText(error)); }
  }
  async function read(file?: File) {
    pending.current?.abort(); setPreview(null); setMessage("");
    if (!file || !editable) return;
    const controller = new AbortController(); pending.current = controller;
    try {
      assertCurrent(); setBusy(true);
      const value = await readLeaseRollFile(file, controller.signal);
      if (controller.signal.aborted || pending.current !== controller) return;
      assertCurrent();
      if (value.projectId !== projectId || value.scenarioId !== scenario.id) throw new Error("다른 프로젝트·계획안의 임대차 파일입니다.");
      setPreview({ key: contextKey, name: file.name, draft: value });
    } catch (error) { if (!controller.signal.aborted) setMessage(errorText(error)); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }
  function applyImport() {
    try {
      assertCurrent(); if (!editable || !visiblePreview) return;
      if (dirty && !window.confirm("미저장 임대차 초안을 가져온 파일로 교체할까요?")) return;
      assertCurrent(); setDraft(visiblePreview.draft); setInvalidNumbers({}); setPreview(null); setMessage("");
    } catch (error) { setMessage(errorText(error)); }
  }

  return <section className="lease-roll" aria-label="호실별 임대차 대사" data-lease-roll data-financial-applied="false">
    <header><div><h2>호실별 임대차</h2><p>초안 · 사업성 미반영 · 원문 진위·전문가 승인 미확정</p></div>
      <span>{saved ? `저장 리비전 ${saved.revision}` : "저장본 없음"}{dirty ? " · 미저장 변경" : ""}</span></header>
    {!sessionValid ? <p role="alert">로그인 세션이 만료됐습니다.</p> : <>
      {recovery && dirty && <p role="status">같은 탭의 미저장 임대차 초안 복구 · 서버 미반영</p>}
      {savedChanged && <p role="alert">다른 저장본이 도착했습니다. 미저장 초안은 다운로드할 수 있습니다.</p>}
      <div className="lease-actions">
        <button type="button" onClick={reload} title="최신 저장본 불러오기" aria-label="최신 임대차 저장본 불러오기"><RefreshCw size={16} /></button>
        <button type="button" disabled={!draft || numericError} onClick={download} title="초안 JSON 다운로드" aria-label="임대차 초안 JSON 다운로드"><Download size={16} /></button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="임대차 JSON 파일" disabled={!editable}
          onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void read(file); }} />
        <button type="button" disabled={!editable} onClick={() => fileInput.current?.click()}><Upload size={16} />JSON 가져오기</button>
        <button type="button" disabled={!editable || !draft || numericError} onClick={save}><Save size={16} />초안 저장</button>
        {saved && <button type="button" disabled={!editable} onClick={remove} title="저장된 임대차 초안 삭제" aria-label="저장된 임대차 초안 삭제"><Trash2 size={16} /></button>}
        <button type="button" disabled={!sessionValid || savedChanged || !canAnalyze || !draft || numericError} onClick={run}><ListChecks size={16} />24개월 대사</button>
        {busy && <span role="status">파일 확인 중</span>}
        {(busy || visiblePreview) && <button type="button" title="가져오기 취소" aria-label="임대차 가져오기 취소"
          onClick={() => { pending.current?.abort(); pending.current = null; setBusy(false); setPreview(null); }}><X size={16} /></button>}
      </div>
      {message && <p role="status" className="lease-message">{message}</p>}
      {visiblePreview && <div className="lease-preview">
        <strong>{visiblePreview.name}</strong><p>{visiblePreview.draft.rows.length}개 계약 · {visiblePreview.draft.calendarStart ?? "운영 시작월 미입력"} · {visiblePreview.draft.sourceBasis === currentBasis ? "현재 면적 기준 일치" : "다른 면적 기준 · 재검토 필요"}</p>
        <button type="button" onClick={applyImport}><FileInput size={16} />초안으로 가져오기</button>
      </div>}
      {draft && <>
        <div className="lease-settings">
          <label>운영 1개월차 달력 시작일<input aria-label="운영 1개월차 달력 시작일" type="date" min="1900-01-01" max="2198-01-01" value={draft.calendarStart ?? ""} disabled={!editable}
            onChange={event => update(value => ({ ...value, calendarStart: event.target.value || null }))} /></label>
          <span>24개월 · 달력 일수로 일할 계산 · 종료일 포함 · 종료 다음 날 보증금 반환</span>
        </div>
        {draft.sourceBasis !== currentBasis && <div className="lease-message" role="alert">면적 기준 변경 · 대사 보류
          <button type="button" disabled={!editable} onClick={() => update(value => ({ ...value, sourceBasis: currentBasis }))}><RefreshCw size={16} />현재 면적 기준으로 재연결</button>
        </div>}
        <div className="lease-contracts">
          {draft.rows.map((row, index) => <details key={row.id} open={draft.rows.length === 1} data-lease-row={row.id}>
            <summary>{row.unitLabel || `계약 ${index + 1}`} · {useLabels[row.use]} · {row.monthlyRentWon === null ? "월세 미입력" : money(row.monthlyRentWon)}</summary>
            <div className="lease-fields">
              <label>호실 ID<input aria-label={`호실 ID ${index + 1}`} value={row.unitId} maxLength={200} disabled={!editable} onChange={e => updateRow(row.id, { unitId: e.target.value })} /></label>
              <label>호실명<input aria-label={`호실명 ${index + 1}`} value={row.unitLabel} maxLength={200} disabled={!editable} onChange={e => updateRow(row.id, { unitLabel: e.target.value })} /></label>
              <label>용도<select aria-label={`임대 용도 ${index + 1}`} value={row.use} disabled={!editable} onChange={e => updateRow(row.id, { use: e.target.value as LeaseRollRow["use"] })}>
                {LEASE_USES.map(use => <option key={use} value={use}>{useLabels[use]}</option>)}
              </select></label>
              {([ ["areaSqm", "임대면적 (㎡)", 1e6], ["monthlyRentWon", "월 임대료 (부가세·관리비 제외 원)", 1e13], ["depositWon", "보증금 (원)", 1e13] ] as const).map(([field, label, max]) =>
                <label key={field}>{label}<input aria-label={`${label} ${index + 1}`} type="number" inputMode="decimal" min={field === "areaSqm" ? 0.000001 : 0} max={max} step="any" value={row[field] ?? ""} disabled={!editable}
                  aria-invalid={invalidNumbers[`${row.id}:${field}`] || undefined} onChange={event => {
                    const input = event.currentTarget;
                    const invalid = !input.validity.valid;
                    updateRow(row.id, { [field]: input.value === "" || !Number.isFinite(input.valueAsNumber) ? null : input.valueAsNumber });
                    setInvalidNumbers(prior => ({ ...prior, [`${row.id}:${field}`]: invalid }));
                  }} /></label>)}
              {([ ["startDate", "계약 시작일"], ["endDate", "계약 종료일 (포함)"], ["sourceAsOf", "자료 기준일"] ] as const).map(([field, label]) =>
                <label key={field}>{label}<input aria-label={`${label} ${index + 1}`} type="date" min="1900-01-01" max="2199-12-31" value={row[field] ?? ""} disabled={!editable}
                  onChange={e => updateRow(row.id, { [field]: e.target.value || null })} /></label>)}
              <label>자료명<input aria-label={`임대차 자료명 ${index + 1}`} maxLength={300} value={row.sourceName} disabled={!editable} onChange={e => updateRow(row.id, { sourceName: e.target.value })} /></label>
              <label>문서·쪽 참조<input aria-label={`임대차 문서 참조 ${index + 1}`} maxLength={1000} value={row.sourceRef} disabled={!editable} onChange={e => updateRow(row.id, { sourceRef: e.target.value })} /></label>
              <button type="button" disabled={!editable} title="계약 삭제" aria-label={`계약 ${index + 1} 삭제`} onClick={() => {
                update(value => ({ ...value, rows: value.rows.filter(item => item.id !== row.id) }));
                setInvalidNumbers(prior => Object.fromEntries(Object.entries(prior).filter(([key]) => !key.startsWith(`${row.id}:`))));
              }}><Trash2 size={16} /></button>
            </div>
          </details>)}
        </div>
        <button type="button" disabled={!editable || draft.rows.length >= MAX_LEASE_ROWS} onClick={() => update(value => ({ ...value, rows: [...value.rows, createLeaseRollRow(crypto.randomUUID())] }))}><Plus size={16} />계약 추가</button>
        {numericError && <p role="alert">금액·면적 입력의 허용 범위를 확인하세요. 빈 값은 미입력으로 유지됩니다.</p>}
      </>}
      {visibleReview && <div className="lease-results" data-lease-status={visibleReview.status}>
        <h3>{visibleReview.status === "ready" ? "입력 계약 대사 완료 · 승인 아님" : "대사 보류"}</h3>
        {visibleReview.issues.length > 0 && <ul>{visibleReview.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
        <dl>{visibleReview.areas.map(area => <div key={area.use}><dt>{useLabels[area.use]} 면적</dt><dd>{area.scheduledSqm.toLocaleString()} / {area.expectedSqm.toLocaleString()} ㎡ · 미배정 {area.unassignedSqm.toLocaleString()} ㎡</dd></div>)}</dl>
        {visibleReview.status === "ready" && <>
          <dl><div><dt>24개월 계약 임대료</dt><dd>{money(visibleReview.totalRentWon)}</dd></div><div><dt>기초 제한 보증금</dt><dd>{money(visibleReview.openingDepositWon)}</dd></div><div><dt>24개월 말 반환 의무</dt><dd>{money(visibleReview.closingDepositWon)}</dd></div></dl>
          <div className="lease-table" role="region" aria-label="월별 임대차 대사표" tabIndex={0}><table><caption>입력 계약 기준 · 금액 원 · 기존 보유안 운영 1개월차부터 비교</caption>
            <thead><tr><th>월</th><th>계약 임대료</th><th>기존안 임대수입</th><th>차이</th><th>보증금 수취</th><th>보증금 반환</th><th>제한 보증금 잔액</th></tr></thead>
            <tbody>{visibleReview.rows.map(row => <tr key={row.month}><th>{row.month}</th><td>{money(row.contractRentWon)}</td><td>{money(row.baselineRentWon)}</td><td>{money(row.rentDeltaWon)}</td><td>{money(row.depositInflowWon)}</td><td>{money(row.depositRefundWon)}</td><td>{money(row.closingDepositWon)}</td></tr>)}</tbody>
          </table></div>
        </>}
      </div>}
      <p className="lease-boundary">보증금은 수익이 아니며 계산상 사용이 제한된 부채. 만기 이후 자동 갱신·공실 충원·임대료 인상 없음. 연체·무상임대·운영비·세금·대출·매각·IRR은 이 대사에 미반영. 공식 경계·허가·전문가 승인은 미확정.</p>
    </>}
    <style jsx>{`
      .lease-roll{overflow-wrap:anywhere}
      .lease-roll{min-width:0;margin:18px 0;padding:16px 0;border-top:1px solid var(--border);font-size:12px;letter-spacing:0}.lease-roll header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.lease-roll h2{font-size:16px;margin:0}.lease-roll h3{font-size:14px;margin:14px 0 8px}.lease-roll p{line-height:1.6}.lease-roll header p,.lease-boundary{color:var(--fg-muted)}.lease-roll button{display:inline-flex;gap:6px;align-items:center;justify-content:center;min-height:34px;min-width:34px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elev);color:var(--fg);font:inherit;cursor:pointer}.lease-roll button:disabled{opacity:.5;cursor:default}.lease-roll button svg{flex-shrink:0}.lease-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:10px 0}.lease-roll label{display:grid;gap:5px;min-width:0}.lease-roll input,.lease-roll select{min-width:0;width:100%;box-sizing:border-box;min-height:36px;padding:6px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--fg);font:inherit}.lease-roll input[aria-invalid=true]{border-color:var(--neg-fg)}.lease-settings{display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin:12px 0}.lease-settings label{width:240px;max-width:100%}.lease-settings span{color:var(--fg-muted);line-height:1.6}.lease-contracts{margin:12px 0}.lease-contracts details{border-block-start:1px solid var(--border-faint);padding:10px 0}.lease-contracts summary{cursor:pointer;overflow-wrap:anywhere}.lease-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:12px;margin-top:12px}.lease-fields>button{align-self:end;justify-self:start}.lease-preview{padding:12px 0;border-block:1px solid var(--border)}.lease-message{color:var(--warn-fg);overflow-wrap:anywhere;line-height:1.6}.lease-message button{margin-left:8px}.lease-results{min-width:0;margin-top:14px}.lease-results ul{padding-left:20px;line-height:1.7}.lease-results dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px;margin:14px 0}.lease-results dl>div{min-width:0}.lease-results dt{color:var(--fg-muted)}.lease-results dd{margin:6px 0 0;overflow-wrap:anywhere}.lease-table{max-width:100%;overflow-x:auto;border-block:1px solid var(--border)}.lease-table table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;white-space:nowrap;font-size:11px}.lease-table caption{text-align:left;padding:10px 0;white-space:normal;line-height:1.6}.lease-table th,.lease-table td{padding:9px;text-align:right;border-bottom:1px solid var(--border-faint)}.lease-table th:first-child{text-align:left}.lease-boundary{margin:12px 0 0;padding-top:10px;border-top:1px solid var(--border-faint)}
    `}</style>
  </section>;
}
