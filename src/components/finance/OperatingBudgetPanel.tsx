"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileInput, ListChecks, Plus, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import { clientSession } from "@/lib/auth/client-session";
import { useProjectStore } from "@/lib/stores/project-store";
import { canonicalProjectWorkspaceJson } from "@/lib/workspace/project-workspace";
import { buildOperatingBudgetDraftKey, createOperatingBudgetDraft, operatingBudgetBasis, operatingBudgetDraftSchema,
  OPERATING_COST_CATEGORIES, resetOperatingBudgetCalendar, type OperatingBudgetDraft, type OperatingCostCategory } from "@/lib/finance/operating-budget-contract";
import { compareLeaseRollNoi, type LeaseRollNoiComparison } from "@/lib/finance/lease-roll-noi-comparison";
import { readOperatingBudgetFile } from "@/lib/finance/operating-budget-import";
import { clearOperatingBudgetEditorRecovery, readOperatingBudgetEditorRecovery, writeOperatingBudgetEditorRecovery } from "@/lib/finance/operating-budget-editor-recovery";
import type { LeaseRollDraft } from "@/lib/finance/lease-roll-contract";
import type { Scenario, ScenarioResult } from "@/lib/finance/types";

type Props = { projectId: string; scenario: Scenario; baseline: ScenarioResult["hold"]; leaseDraft: LeaseRollDraft | null };
const labels: Record<OperatingCostCategory, string> = { "property-tax": "재산 관련 운영세금", insurance: "보험료",
  "routine-maintenance": "일상 수선·유지비", management: "관리비", utilities: "공공요금", other: "기타 운영비" };
const keyOf = (value: unknown) => canonicalProjectWorkspaceJson(value ?? null);
const money = (value: number | null) => value === null ? "비교 불가" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 원`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "운영비 초안을 처리하지 못했습니다.";

export function OperatingBudgetPanel(props: Props) {
  return <OperatingBudgetEditor key={buildOperatingBudgetDraftKey(props.projectId, props.scenario.id)} {...props} />;
}

function OperatingBudgetEditor({ projectId, scenario, baseline, leaseDraft }: Props) {
  const storeKey = buildOperatingBudgetDraftKey(projectId, scenario.id);
  const saved = useProjectStore(state => state.operatingBudgetDrafts[storeKey]);
  const [sessionKey] = useState(() => clientSession.context);
  const [ended, setEnded] = useState(false);
  const sessionValid = !ended && clientSession.active && sessionKey !== null && clientSession.context === sessionKey;
  const [recovery] = useState(() => readOperatingBudgetEditorRecovery(projectId, scenario.id));
  const [draft, setDraft] = useState<OperatingBudgetDraft | null>(() => sessionValid ? recovery?.draft ?? saved ?? createOperatingBudgetDraft(projectId, scenario) : null);
  const [savedKey, setSavedKey] = useState(() => recovery?.savedKey ?? keyOf(saved));
  const [cleanKey, setCleanKey] = useState(() => recovery?.cleanKey ?? keyOf(draft));
  const [invalidNumbers, setInvalidNumbers] = useState<Record<string, boolean>>(() => recovery?.invalidNumbers ?? {});
  const [repeatInputs, setRepeatInputs] = useState<Partial<Record<OperatingCostCategory, string>>>({});
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<{ key: string; result: LeaseRollNoiComparison } | null>(null);
  const [preview, setPreview] = useState<{ key: string; name: string; draft: OperatingBudgetDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentBasis = operatingBudgetBasis(projectId, scenario);
  const savedChanged = savedKey !== keyOf(saved);
  const numericError = Object.values(invalidNumbers).some(Boolean);
  const dirty = keyOf(draft) !== cleanKey || numericError;
  const contextKey = useMemo(() => keyOf({ projectId, scenario, baseline, leaseDraft, saved, draft, invalidNumbers, sessionKey }),
    [projectId, scenario, baseline, leaseDraft, saved, draft, invalidNumbers, sessionKey]);
  const live = useRef({ contextKey, sessionValid });
  live.current = { contextKey, sessionValid };
  const visibleReview = sessionValid && !savedChanged && !numericError && review?.key === contextKey ? review.result : null;
  const visiblePreview = sessionValid && !savedChanged && preview?.key === contextKey ? preview : null;
  const canWrite = clientSession.principal?.capabilities.includes("project.update") === true;
  const canAnalyze = clientSession.principal?.capabilities.includes("analysis.run") === true;
  const editable = sessionValid && !savedChanged && canWrite;
  const expectedMonths = useMemo(() => {
    if (!draft?.calendarStart) return [];
    try { return resetOperatingBudgetCalendar({ ...draft, categories: [] }, draft.calendarStart).categories[0].amounts.map(row => row.month); }
    catch { return []; }
  }, [draft]);
  const structureIncomplete = Boolean(draft && expectedMonths.length === 24 &&
    (draft.categories.length !== OPERATING_COST_CATEGORIES.length || draft.categories.some(category =>
      category.amounts.length !== 24 || category.amounts.some(row => !expectedMonths.includes(row.month)))));

  useEffect(() => {
    const expire = () => { pending.current?.abort(); setEnded(true); setDraft(null); setReview(null); setPreview(null); setMessage(""); setBusy(false); };
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
    if (dirty && draft) writeOperatingBudgetEditorRecovery({ draft, savedKey, cleanKey, invalidNumbers });
    else clearOperatingBudgetEditorRecovery(projectId, scenario.id);
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
    if (!live.current.sessionValid || clientSession.context !== sessionKey || live.current.contextKey !== contextKey) throw new Error("계정 또는 분석 기준이 변경됐습니다.");
    const current = useProjectStore.getState(), currentScenario = current.data?.scenarios.find(value => value.id === scenario.id)?._raw;
    if (current.data?.parcel.id !== projectId || !currentScenario || current.representativePlanningScenarioId !== scenario.id ||
      operatingBudgetBasis(projectId, currentScenario) !== currentBasis) throw new Error("현재 프로젝트·계획안이 변경됐습니다.");
    if (matchSaved && keyOf(current.operatingBudgetDrafts[storeKey]) !== savedKey) throw new Error("운영비 저장본이 변경됐습니다. 최신 저장본을 확인하세요.");
  }
  function update(change: (value: OperatingBudgetDraft) => OperatingBudgetDraft): boolean {
    try { assertCurrent(); if (!editable || !draft) throw new Error("운영비 초안을 변경할 권한이 없습니다."); setDraft(change(draft)); setMessage(""); return true; }
    catch (error) { setMessage(errorText(error)); return false; }
  }
  function updateCategory(category: OperatingCostCategory, change: (value: OperatingBudgetDraft["categories"][number]) => OperatingBudgetDraft["categories"][number]) {
    return update(value => ({ ...value, categories: value.categories.map(item => item.category === category ? change(item) : item) }));
  }
  function replaceLocal(next: OperatingBudgetDraft, newSaved: OperatingBudgetDraft | undefined) {
    clearOperatingBudgetEditorRecovery(projectId, scenario.id);
    setDraft(next); setSavedKey(keyOf(newSaved)); setCleanKey(keyOf(next)); setInvalidNumbers({}); setRepeatInputs({}); setReview(null); setMessage("");
  }
  function reload() {
    try { assertCurrent(false); if (dirty && !window.confirm("미저장 운영비 초안을 버리고 최신 저장본을 불러올까요?")) return;
      const value = useProjectStore.getState().operatingBudgetDrafts[storeKey]; replaceLocal(value ?? createOperatingBudgetDraft(projectId, scenario), value);
    } catch (error) { setMessage(errorText(error)); }
  }
  function save() {
    try { assertCurrent(); if (!editable || !draft || numericError) throw new Error("권한과 운영비 숫자 입력을 확인하세요.");
      const next = operatingBudgetDraftSchema.parse({ ...draft, revision: (saved?.revision ?? 0) + 1, updatedAt: new Date().toISOString() });
      useProjectStore.getState().saveOperatingBudgetDraft(next); replaceLocal(next, next);
      setMessage("운영비 초안 저장 요청 · 서버 저장 상태는 프로젝트 동기화 상태 기준 · 사업성 미반영");
    } catch (error) { setMessage(errorText(error)); }
  }
  function run() {
    try { assertCurrent(); if (!canAnalyze || numericError) throw new Error("분석 권한과 숫자 입력을 확인하세요.");
      setReview({ key: contextKey, result: compareLeaseRollNoi({ draft: leaseDraft, budget: draft, projectId, scenario, baseline }) }); setMessage("");
    } catch (error) { setMessage(errorText(error)); }
  }
  function remove() {
    try { assertCurrent(); if (!editable || !saved || !window.confirm("저장된 운영비 초안과 미저장 변경을 삭제할까요? 임대차와 사업성은 그대로 유지됩니다.")) return;
      assertCurrent(); useProjectStore.getState().removeOperatingBudgetDraft(projectId, scenario.id); replaceLocal(createOperatingBudgetDraft(projectId, scenario), undefined);
      setMessage("운영비 초안 삭제 요청 · 임대차·사업성 미변경");
    } catch (error) { setMessage(errorText(error)); }
  }
  function download() {
    try { assertCurrent(false); if (numericError) throw new Error("잘못된 숫자가 있는 운영비 초안은 내보낼 수 없습니다.");
      const parsed = operatingBudgetDraftSchema.parse(draft), url = URL.createObjectURL(new Blob([JSON.stringify(parsed, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "parcelgrid-operating-budget.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(errorText(error)); }
  }
  async function read(file?: File) {
    pending.current?.abort(); setPreview(null); setMessage("");
    if (!file || !editable) return;
    const controller = new AbortController(); pending.current = controller;
    try { assertCurrent(); setBusy(true); const value = await readOperatingBudgetFile(file, controller.signal);
      if (controller.signal.aborted || pending.current !== controller) return;
      assertCurrent(); if (value.projectId !== projectId || value.scenarioId !== scenario.id) throw new Error("다른 프로젝트·계획안의 운영비 파일입니다.");
      setPreview({ key: contextKey, name: file.name, draft: value });
    } catch (error) { if (!controller.signal.aborted) setMessage(errorText(error)); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }
  function applyImport() {
    try { assertCurrent(); if (!editable || !visiblePreview) return;
      if (dirty && !window.confirm("미저장 운영비 초안을 가져온 파일로 교체할까요?")) return;
      assertCurrent(); setDraft(visiblePreview.draft); setInvalidNumbers({}); setRepeatInputs({}); setPreview(null); setMessage("");
    } catch (error) { setMessage(errorText(error)); }
  }
  function changeCalendar(value: string) {
    if (!draft || (value || null) === draft.calendarStart) return;
    if ((numericError || draft.categories.some(category => category.amounts.some(amount => amount.amountWon !== null))) &&
      !window.confirm("운영비 기준월을 바꾸면 기존 월별 금액을 모두 미입력으로 되돌립니다. 계속할까요?")) return;
    if (update(previous => resetOperatingBudgetCalendar({ ...previous, categories: previous.categories.map(category => ({ ...category, amounts: [] })) }, value || null))) {
      setInvalidNumbers({}); setRepeatInputs({});
    }
  }
  function completeStructure() {
    if (draft?.categories.some(category => category.amounts.some(row => !expectedMonths.includes(row.month) && row.amountWon !== null)) &&
      !window.confirm("기준 기간 밖의 운영비 금액을 제거하고 누락 항목·월을 미입력으로 생성할까요?")) return;
    if (update(value => {
      const template = resetOperatingBudgetCalendar(createOperatingBudgetDraft(projectId, scenario), value.calendarStart);
      return { ...value, categories: template.categories.map(category => {
        const previous = value.categories.find(item => item.category === category.category);
        return previous ? { ...previous, amounts: category.amounts.map(amount => previous.amounts.find(item => item.month === amount.month) ?? amount) } : category;
      }), scopeConfirmed: false };
    })) setInvalidNumbers(value => Object.fromEntries(Object.entries(value).filter(([key]) => expectedMonths.includes(key.slice(key.indexOf(":") + 1)))));
  }

  return <section className="operating-budget" aria-label="월별 운영비와 NOI 대사" data-operating-budget data-financial-applied="false">
    <header><div><h2>월별 운영비·NOI</h2><p>소유자 부담 예산 · 사업성 미반영 · 원문 진위·전문가 승인 미확정</p></div>
      <span>{saved ? `저장 리비전 ${saved.revision}` : "저장본 없음"}{dirty ? " · 미저장 변경" : ""}</span></header>
    {!sessionValid ? <p role="alert">로그인 세션이 만료됐습니다.</p> : <>
      {recovery && dirty && <p role="status">같은 탭의 미저장 운영비 초안 복구 · 서버 미반영</p>}
      {savedChanged && <p role="alert">다른 운영비 저장본이 도착했습니다. 미저장 초안은 다운로드할 수 있습니다.</p>}
      <div className="budget-actions">
        <button type="button" onClick={reload} title="최신 운영비 저장본 불러오기" aria-label="최신 운영비 저장본 불러오기"><RefreshCw size={16} /></button>
        <button type="button" onClick={download} disabled={!draft || numericError} title="운영비 초안 JSON 다운로드" aria-label="운영비 초안 JSON 다운로드"><Download size={16} /></button>
        <input type="file" ref={fileInput} hidden accept=".json,application/json" aria-label="운영비 JSON 파일" disabled={!editable}
          onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void read(file); }} />
        <button type="button" disabled={!editable} onClick={() => fileInput.current?.click()}><Upload size={16} />운영비 JSON 가져오기</button>
        <button type="button" disabled={!editable || !draft || numericError} onClick={save}><Save size={16} />운영비 초안 저장</button>
        {saved && <button type="button" disabled={!editable} onClick={remove} title="저장된 운영비 초안 삭제" aria-label="저장된 운영비 초안 삭제"><Trash2 size={16} /></button>}
        <button type="button" disabled={!sessionValid || savedChanged || !canAnalyze || !draft || !leaseDraft || numericError} onClick={run}><ListChecks size={16} />24개월 NOI 대사</button>
        {busy && <span role="status">운영비 파일 확인 중</span>}
        {(busy || visiblePreview) && <button type="button" title="운영비 가져오기 취소" aria-label="운영비 가져오기 취소" onClick={() => {
          pending.current?.abort(); pending.current = null; setBusy(false); setPreview(null);
        }}><X size={16} /></button>}
      </div>
      {message && <p role="status" className="budget-message">{message}</p>}
      {visiblePreview && <div className="budget-preview"><strong>{visiblePreview.name}</strong>
        <p>{visiblePreview.draft.categories.length}개 비용 항목 · {visiblePreview.draft.calendarStart ?? "기준월 미입력"} · {visiblePreview.draft.sourceBasis === currentBasis ? "현재 면적 기준 일치" : "다른 면적 기준 · 재검토 필요"}</p>
        <button type="button" onClick={applyImport}><FileInput size={16} />운영비 초안으로 가져오기</button></div>}
      {draft && <>
        <div className="budget-settings">
          <label>운영비 기준 시작월<input aria-label="운영비 기준 시작월" type="month" min="1900-01" max="2198-01" value={draft.calendarStart?.slice(0, 7) ?? ""} disabled={!editable}
            onChange={event => changeCalendar(event.target.value ? `${event.target.value}-01` : "")} /></label>
          <label>기존 보유안 운영 1개월차 달력월<input aria-label="기존 보유안 운영 1개월차 달력월" type="month" min="1900-01" max="2199-12" value={draft.baselineCalendarStart?.slice(0, 7) ?? ""} disabled={!editable}
            onChange={event => update(value => ({ ...value, baselineCalendarStart: event.target.value ? `${event.target.value}-01` : null }))} /></label>
          <span>임대차 기준월: {leaseDraft?.calendarStart?.slice(0, 7) ?? "미확정"}</span>
        </div>
        {draft.sourceBasis !== currentBasis && <p className="budget-message" role="alert">면적 기준 변경 · 대사 보류 <button type="button" disabled={!editable}
          onClick={() => update(value => ({ ...value, sourceBasis: currentBasis, scopeConfirmed: false }))}><RefreshCw size={16} />운영비를 현재 면적 기준으로 재연결</button></p>}
        <label>소유자 부담·공용비 배분 근거<textarea aria-label="소유자 부담·공용비 배분 근거" maxLength={2000} rows={2} value={draft.allocationNote} disabled={!editable}
          onChange={event => update(value => ({ ...value, allocationNote: event.target.value }))} /></label>
        <label className="budget-check"><input type="checkbox" checked={draft.scopeConfirmed} disabled={!editable} onChange={event => update(value => ({ ...value, scopeConfirmed: event.target.checked }))} />
          공실·미배정 공간을 포함한 전체 보유 임대면적의 소유자 부담 운영비이며, 회수 가능한 비용·금융·소득세·대규모 자본지출은 제외했습니다.</label>
        <div className="budget-categories">{draft.categories.map(category => {
          const repeat = repeatInputs[category.category] ?? "", amount = Number(repeat);
          const validRepeat = repeat.trim() !== "" && Number.isFinite(amount) && amount >= 0 && amount <= 1e13;
          return <details key={category.category} data-budget-category={category.category}>
            <summary>{labels[category.category]} · {category.amounts.filter(row => row.amountWon !== null).length}/24개월 입력</summary>
            <div className="budget-fields">
              <label>자료명<input aria-label={`${labels[category.category]} 자료명`} maxLength={300} value={category.sourceName} disabled={!editable}
                onChange={event => updateCategory(category.category, value => ({ ...value, sourceName: event.target.value }))} /></label>
              <label>문서·쪽 참조<input aria-label={`${labels[category.category]} 문서 참조`} maxLength={1000} value={category.sourceRef} disabled={!editable}
                onChange={event => updateCategory(category.category, value => ({ ...value, sourceRef: event.target.value }))} /></label>
              <label>자료 기준일<input aria-label={`${labels[category.category]} 자료 기준일`} type="date" min="1900-01-01" max="2199-12-31" value={category.sourceAsOf ?? ""} disabled={!editable}
                onChange={event => updateCategory(category.category, value => ({ ...value, sourceAsOf: event.target.value || null }))} /></label>
            </div>
            <div className="budget-repeat"><label>반복 월액 (원)<input aria-label={`${labels[category.category]} 반복 월액`} type="number" inputMode="decimal" min={0} max={1e13} step="any" value={repeat} disabled={!editable}
              onChange={event => setRepeatInputs(value => ({ ...value, [category.category]: event.target.value }))} /></label>
              <button type="button" disabled={!editable || !validRepeat || category.amounts.length !== 24} onClick={() => {
                if (category.amounts.some(row => row.amountWon !== null) && !window.confirm(`${labels[category.category]}의 24개월 금액을 모두 ${money(amount)}으로 바꿀까요?`)) return;
                if (updateCategory(category.category, value => ({ ...value, amounts: value.amounts.map(row => ({ ...row, amountWon: amount })) }))) {
                  setInvalidNumbers(value => Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith(`${category.category}:`))));
                }
              }}><Plus size={16} />24개월에 적용</button>
            </div>
            <div className="budget-months">{category.amounts.map(row => <label key={row.month}>{row.month} (원)<input aria-label={`${labels[category.category]} ${row.month} 원`} type="number" inputMode="decimal" min={0} max={1e13} step="any"
              value={row.amountWon ?? ""} disabled={!editable} aria-invalid={invalidNumbers[`${category.category}:${row.month}`] || undefined} onChange={event => {
                const input = event.currentTarget, invalid = !input.validity.valid, value = input.value === "" || !Number.isFinite(input.valueAsNumber) ? null : input.valueAsNumber;
                if (updateCategory(category.category, previous => ({ ...previous, amounts: previous.amounts.map(item => item.month === row.month ? { ...item, amountWon: value } : item) }))) {
                  setInvalidNumbers(previous => ({ ...previous, [`${category.category}:${row.month}`]: invalid }));
                }
              }} /></label>)}</div>
          </details>;
        })}</div>
        {structureIncomplete && <button type="button" disabled={!editable} onClick={completeStructure}><Plus size={16} />기간·누락 항목 정리</button>}
        {numericError && <p role="alert">운영비 숫자의 허용 범위를 확인하세요. 빈 금액은 0원이 아닌 미입력입니다.</p>}
      </>}
      {!leaseDraft && <p role="status">현재 임대차 입력을 사용할 수 없어 NOI 대사를 보류합니다.</p>}
      {visibleReview && <div className="budget-results" data-budget-status={visibleReview.status}>
        <h3>{visibleReview.status === "ready" ? "예산 기준 NOI 대사 완료 · 승인 아님" : "NOI 대사 보류"}</h3>
        {visibleReview.issues.length > 0 && <ul>{visibleReview.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
        {visibleReview.status === "ready" && <>
          <dl><div><dt>24개월 계약 임대료</dt><dd>{money(visibleReview.totalRentWon)}</dd></div><div><dt>소유자 부담 운영비</dt><dd>{money(visibleReview.totalOperatingExpenseWon)}</dd></div><div><dt>예산 기준 NOI</dt><dd>{money(visibleReview.totalNoiWon)}</dd></div></dl>
          <div className="budget-table" role="region" aria-label="월별 NOI 대사표" tabIndex={0}><table><caption>입력 계약·운영비 예산 기준 · 금액 원 · 실수납·순이익 아님</caption>
            <thead><tr><th>월</th><th>계약 임대료</th><th>운영비</th><th>예산 NOI</th><th>기존안 NOI</th><th>차이</th></tr></thead>
            <tbody>{visibleReview.rows.map(row => <tr key={row.month}><th>{row.month}</th><td>{money(row.contractRentWon)}</td><td>{money(row.operatingExpenseWon)}</td><td>{money(row.noiWon)}</td><td>{money(row.baselineNoiWon)}</td><td>{money(row.noiDeltaWon)}</td></tr>)}</tbody>
          </table></div>
        </>}
      </div>}
      <p className="budget-boundary">NOI = 기재된 계약 임대료 − 소유자 부담 운영비. 회수 불가 세금은 운영비 입력에 포함. 보증금·대출·준비금·임차인 공사비·중개수수료·대규모 수선·매각·소득세·IRR 제외. 공실·계약 만료 뒤에도 입력 운영비는 유지. 법정 세액·실수납·전문가 승인 미확정.</p>
    </>}
    <style jsx>{`
      .operating-budget{min-width:0;margin:18px 0;padding:16px 0;border-top:1px solid var(--border);font-size:12px;letter-spacing:0;overflow-wrap:anywhere}.operating-budget header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.operating-budget h2{font-size:16px;margin:0}.operating-budget h3{font-size:14px;margin:14px 0 8px}.operating-budget p{line-height:1.6}.operating-budget header p,.budget-boundary{color:var(--fg-muted)}.operating-budget button{display:inline-flex;gap:6px;align-items:center;justify-content:center;min-height:34px;min-width:34px;max-width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elev);color:var(--fg);font:inherit;cursor:pointer}.operating-budget button:disabled{opacity:.5;cursor:default}.operating-budget button svg{flex-shrink:0}.budget-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:10px 0}.operating-budget label{display:grid;gap:5px;min-width:0}.operating-budget input,.operating-budget textarea{min-width:0;width:100%;box-sizing:border-box;min-height:36px;padding:6px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--fg);font:inherit}.operating-budget textarea{resize:vertical}.operating-budget input[aria-invalid=true]{border-color:var(--neg-fg)}.budget-settings,.budget-repeat{display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin:12px 0}.budget-settings label,.budget-repeat label{width:260px;max-width:100%}.budget-settings span{color:var(--fg-muted);line-height:1.6}.budget-check{display:flex!important;align-items:start;margin:14px 0;line-height:1.7}.budget-check input{width:18px;min-width:18px;height:18px;min-height:18px;margin:2px 4px 0 0}.budget-categories{margin:12px 0}.budget-categories details{border-top:1px solid var(--border-faint);padding:10px 0}.budget-categories summary{cursor:pointer;overflow-wrap:anywhere}.budget-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px;margin-top:12px}.budget-months{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr));gap:10px;margin:12px 0}.budget-preview{padding:12px 0;border-block:1px solid var(--border)}.budget-message{color:var(--warn-fg);overflow-wrap:anywhere;line-height:1.6}.budget-message button{margin:6px 0}.budget-results{min-width:0;margin-top:14px}.budget-results ul{padding-left:20px;line-height:1.7}.budget-results dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px;margin:14px 0}.budget-results dl>div{min-width:0}.budget-results dt{color:var(--fg-muted)}.budget-results dd{margin:6px 0 0;overflow-wrap:anywhere}.budget-table{max-width:100%;overflow-x:auto;border-block:1px solid var(--border)}.budget-table table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;white-space:nowrap;font-size:11px}.budget-table caption{text-align:left;padding:10px 0;white-space:normal;line-height:1.6}.budget-table th,.budget-table td{padding:9px;text-align:right;border-bottom:1px solid var(--border-faint)}.budget-table th:first-child{text-align:left}.budget-boundary{margin:12px 0 0;padding-top:10px;border-top:1px solid var(--border-faint)}
    `}</style>
  </section>;
}
