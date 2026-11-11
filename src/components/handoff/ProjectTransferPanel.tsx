"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileInput, Upload, X } from "lucide-react";
import { clientSession } from "@/lib/auth/client-session";
import { serializeProjectTransferBundle, type ProjectTransferBundle } from "@/lib/handoff/project-transfer";
import { readProjectTransferFile } from "@/lib/handoff/project-transfer-import";
import { applyCurrentProjectTransfer, captureProjectTransferBundle, prepareCurrentProjectTransfer, projectTransferWorkspaceKey } from "@/lib/handoff/project-transfer-client";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import type { DynamicProjectLoadResult } from "@/lib/hooks/use-dynamic-project";

type Preview = { name: string; bundle: ProjectTransferBundle; key: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : "인계 패키지를 처리하지 못했습니다.";

export function ProjectTransferPanel({ projectId }: { projectId: string }) {
  return <ProjectTransferEditor key={projectId} projectId={projectId} />;
}

function ProjectTransferEditor({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [sessionContext] = useState(() => clientSession.context);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<{ error: boolean; message: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const sessionValid = !ended && clientSession.active && sessionContext !== null && clientSession.context === sessionContext;
  const canRead = sessionValid && clientSession.principal?.capabilities.includes("project.read") === true;
  const canWrite = sessionValid && clientSession.principal?.capabilities.includes("project.update") === true;

  function cancel() {
    generation.current += 1;
    request.current?.abort(); request.current = null;
    setBusy(false); setPreview(null);
  }

  useEffect(() => {
    mounted.current = true;
    let key = projectTransferWorkspaceKey(projectId);
    const changed = () => {
      const next = projectTransferWorkspaceKey(projectId);
      if (next === key) return;
      key = next; generation.current += 1; request.current?.abort(); request.current = null;
      setBusy(false); setPreview(null); setStatus(null);
    };
    const expire = () => {
      generation.current += 1; request.current?.abort(); request.current = null;
      setBusy(false); setPreview(null); setStatus(null); setEnded(true);
    };
    const unsubscribeProject = useProjectStore.subscribe(changed);
    const unsubscribeReview = useReviewStore.subscribe(changed);
    const unsubscribeSession = clientSession.subscribe(expire);
    if (!clientSession.active || clientSession.context !== sessionContext) expire();
    return () => {
      mounted.current = false; generation.current += 1; request.current?.abort(); request.current = null;
      unsubscribeProject(); unsubscribeReview(); unsubscribeSession();
    };
  }, [projectId, sessionContext]);

  const stillHere = () => mounted.current && clientSession.active && clientSession.context === sessionContext;
  const report = (error: unknown) => { if (stillHere()) setStatus({ error: true, message: errorText(error) }); };

  function exportBundle() {
    if (!stillHere()) return;
    try {
      const bundle = captureProjectTransferBundle(projectId, sessionContext);
      const blob = new Blob([serializeProjectTransferBundle(bundle)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `parcelgrid-${projectId}-handoff.json`; anchor.click();
      } finally { URL.revokeObjectURL(url); }
      setStatus({ error: false, message: "인계 패키지를 내려받았습니다. 원문 첨부와 서버 승인 기록은 제외됩니다." });
    } catch (error) { report(error); }
  }

  async function importBundle(file: File) {
    if (!stillHere()) return;
    cancel(); setStatus(null);
    const token = generation.current;
    const controller = new AbortController(); request.current = controller;
    try {
      clientSession.assertActive();
      if (!canWrite || clientSession.context !== sessionContext) throw new Error("프로젝트 인계 권한이 없습니다.");
      const key = projectTransferWorkspaceKey(projectId);
      if (!key) throw new Error("현재 프로젝트를 먼저 불러와야 합니다.");
      setBusy(true);
      const bundle = await readProjectTransferFile(file, controller.signal, projectId);
      if (!stillHere() || generation.current !== token || controller.signal.aborted) return;
      prepareCurrentProjectTransfer({ bundle, projectId, sessionContext, expectedWorkspaceKey: key });
      if (generation.current !== token || controller.signal.aborted) return;
      setPreview({ name: file.name, bundle, key });
    } catch (error) {
      if (generation.current === token && !controller.signal.aborted) report(error);
    } finally {
      if (mounted.current && generation.current === token) { request.current = null; setBusy(false); }
    }
  }

  function applyPreview() {
    if (!preview || !stillHere()) return;
    const token = generation.current;
    const args = { bundle: preview.bundle, projectId, sessionContext, expectedWorkspaceKey: preview.key };
    try {
      prepareCurrentProjectTransfer(args);
      if (!window.confirm("현재 프로젝트의 계획·사업성·저장 초안과 미저장 편집을 이 패키지로 교체할까요? 패키지에 없는 초안은 삭제됩니다. 서버 전문가 승인 이력은 변경하지 않습니다.")) return;
      if (!stillHere() || generation.current !== token) throw new Error("계정 또는 프로젝트 내용이 변경됐습니다. 파일을 다시 확인하세요.");
      const applied = applyCurrentProjectTransfer(args);
      // Keep the server revision baseline while the shell recomputes from the imported parcel.
      queryClient.setQueriesData<DynamicProjectLoadResult>({ queryKey: ["dynamic-project", projectId] }, current =>
        current?.data.parcel.id === projectId ? { ...current, data: applied.projectData } : current);
      setPreview(null);
      setStatus({ error: false, message: "로컬 프로젝트에 적용했습니다. 서버 저장 상태를 확인하세요. 원문 파일은 다시 업로드해야 하며 공식 경계·허가·전문가 승인은 확정되지 않습니다." });
    } catch (error) { report(error); }
  }

  const payload = preview?.bundle.payload;
  const omitted = payload && [
    payload.leaseRollDrafts === undefined ? "임대차" : null,
    payload.operatingBudgetDrafts === undefined ? "운영비" : null,
    payload.revenuePricingDrafts === undefined ? "단가" : null,
    payload.pendingOverrides === undefined ? "미반영 가정" : null,
  ].filter(Boolean);

  return <section className="project-transfer" data-project-transfer>
    <header><h2>프로젝트 인계</h2><span>저장된 초안 기준 · 원문 첨부·서버 승인 제외</span></header>
    {!sessionValid ? <p role="alert">로그인 세션이 만료됐습니다.</p> : <>
      <div className="transfer-actions">
        <button type="button" disabled={!canRead || busy} onClick={exportBundle}><Download size={16} />인계 패키지 저장</button>
        <button type="button" disabled={!canWrite || busy} onClick={() => input.current?.click()}><Upload size={16} />패키지 가져오기</button>
        {(busy || preview) && <button type="button" onClick={() => { cancel(); setStatus(null); }}><X size={16} />가져오기 취소</button>}
        <input ref={input} aria-label="프로젝트 인계 JSON 파일" type="file" accept=".json,application/json" hidden disabled={!canWrite || busy}
          onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void importBundle(file); }} />
      </div>
      {busy && <p role="status">인계 패키지 확인 중</p>}
      {preview && payload && <div data-transfer-preview className="transfer-preview">
        <h3>{preview.name}</h3>
        <dl>
          <div><dt>프로젝트</dt><dd>{preview.bundle.projectId}</dd></div>
          <div><dt>내보낸 시각</dt><dd>{preview.bundle.exportedAt}</dd></div>
          <div><dt>계획안</dt><dd>{payload.planningScenarios.length}개</dd></div>
          <div><dt>임대차 초안</dt><dd>{payload.leaseRollDrafts?.length ?? 0}개</dd></div>
          <div><dt>운영비 초안</dt><dd>{payload.operatingBudgetDrafts?.length ?? 0}개</dd></div>
          <div><dt>단가 초안</dt><dd>{payload.revenuePricingDrafts?.length ?? 0}개</dd></div>
          <div><dt>미반영 가정</dt><dd>{payload.pendingOverrides?.length ?? 0}개</dd></div>
        </dl>
        {omitted && omitted.length > 0 && <p role="note">구형 패키지의 누락 항목: {omitted.join(", ")}. 적용하면 현재 프로젝트의 해당 항목은 비워집니다.</p>}
        <p>아직 적용되지 않았습니다. 체크섬은 파일 손상 검사이며 출처 진위나 전문가 승인이 아닙니다.</p>
        <button type="button" disabled={!canWrite || busy} onClick={applyPreview}><FileInput size={16} />패키지 적용</button>
      </div>}
      {status && <p role={status.error ? "alert" : "status"}>{status.message}</p>}
    </>}
    <style jsx>{`
      .project-transfer{min-width:0;margin:18px 0;padding:16px 0;border-block:1px solid var(--border);font-size:12px;letter-spacing:0;overflow-wrap:anywhere}
      .project-transfer header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}.project-transfer h2{margin:0;font-size:16px}.project-transfer h3{font-size:14px;margin:0}
      .project-transfer header span,.project-transfer dt{color:var(--fg-muted)}.project-transfer p{line-height:1.6}.transfer-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
      .project-transfer button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;min-width:36px;max-width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elev);color:var(--fg);font:inherit;cursor:pointer}.project-transfer button svg{flex-shrink:0}.project-transfer button:disabled{opacity:.5;cursor:default}
      .transfer-preview{border-top:1px solid var(--border-faint);padding-top:12px}.project-transfer dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:12px}.project-transfer dl>div{min-width:0}.project-transfer dd{margin:4px 0 0}.project-transfer [role=alert]{color:var(--neg-fg)}
    `}</style>
  </section>;
}
