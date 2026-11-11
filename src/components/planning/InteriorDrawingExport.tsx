"use client";

import { Download, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/lib/stores/project-store";
import { analysisReferenceInputKey, analysisReferenceIsCurrent } from "@/lib/planning/analysis-reference-contract";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import { clientSession } from "@/lib/auth/client-session";
import { runInteriorDrawingWorker } from "@/lib/planning/interior-drawing-worker";
import { findProjectPlanningScenario } from "@/lib/planning/project-scope";

export function InteriorDrawingExport({ projectId, scenarioId }: { projectId: string; scenarioId: string }) {
  const data = useProjectStore(state => state.data);
  const geometry = useProjectStore(state => state.representativeGeometrySnapshot);
  const scenario = useProjectStore(state => findProjectPlanningScenario(state.planningScenarios, scenarioId, projectId));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const current = Boolean(data?.parcel.id === projectId && scenario && geometry?.projectId === projectId &&
    geometry.scenarioId === scenarioId && (geometry.analysisReference !== undefined
      ? analysisReferenceIsCurrent(scenario, data?.parcel, geometry) : assessRepresentativeCheckReadiness(scenario.checks).ready));
  useEffect(() => {
    setBusy(false); setFeedback(null);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [projectId, scenarioId]);
  useEffect(() => clientSession.subscribe(() => {
    pending.current?.abort(); pending.current = null; setBusy(false); setFeedback(null);
  }), []);

  async function download() {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    let unsubscribe: (() => void) | undefined;
    setBusy(true); setFeedback(null);
    try {
      clientSession.assertActive();
      const state = useProjectStore.getState(), live = findProjectPlanningScenario(state.planningScenarios, scenarioId, projectId);
      if (!live || !state.data || !state.representativeGeometrySnapshot || state.data.parcel.id !== projectId ||
          state.selectedPlanningScenarioId !== scenarioId || state.representativePlanningScenarioId !== scenarioId) {
        throw new Error("내보내기 준비 중 선택한 계획이 변경됐습니다. 현재 기준안을 다시 확인하세요.");
      }
      const sourceData = state.data, sourceGeometry = state.representativeGeometrySnapshot;
      const unchanged = () => {
        const latest = useProjectStore.getState();
        return latest.data === sourceData && latest.representativeGeometrySnapshot === sourceGeometry &&
          findProjectPlanningScenario(latest.planningScenarios, scenarioId, projectId) === live &&
          latest.selectedPlanningScenarioId === scenarioId && latest.representativePlanningScenarioId === scenarioId;
      };
      unsubscribe = useProjectStore.subscribe(() => {
        if (!unchanged()) {
          controller.abort();
          if (pending.current === controller) {
            pending.current = null; setBusy(false);
            setFeedback({ error: true, text: "도면 생성 중 원본·선택이 변경되어 취소했습니다." });
          }
        }
      });
      const result = await runInteriorDrawingWorker({ projectId, representativeScenarioId: scenarioId, representativeScenarioVersion: live.version,
        data: sourceData, planningScenario: live, geometry: sourceGeometry,
        geometryHash: sourceGeometry.geometryHash }, controller.signal);
      if (controller.signal.aborted || pending.current !== controller) return;
      clientSession.assertActive();
      if (!unchanged() || result.inputKey !== analysisReferenceInputKey(live, sourceData.parcel, sourceGeometry)) {
        throw new Error("도면 원본이 변경되어 파일을 폐기했습니다. 현재 기준안을 다시 확인하세요.");
      }
      const bytes = result.zipBytes.buffer.slice(result.zipBytes.byteOffset, result.zipBytes.byteOffset + result.zipBytes.byteLength) as ArrayBuffer;
      const anchor = document.createElement("a");
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      anchor.href = url; anchor.download = result.filename;
      try { document.body.appendChild(anchor); anchor.click(); }
      finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setFeedback({ error: false, text: `예비 실내 검토 도면 · ${result.entityCount}개 객체 · 공식 경계·허가·전문가 승인 미확정` });
    } catch (error) {
      if (!controller.signal.aborted && pending.current === controller) setFeedback({ error: true, text: error instanceof Error ? error.message : "도면 패키지를 만들지 못했습니다." });
    } finally {
      unsubscribe?.();
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
    <button type="button" onClick={download} disabled={!current || busy}
      title={current ? "예비 실내 검토용 DXF·원본·수량 패키지" : "현재 계획을 검사하고 예비 분석 기준안 또는 대표안으로 선택해야 합니다"}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 10px", border: "1px solid var(--border)",
        background: "var(--bg-elev)", color: "var(--fg)", borderRadius: 6, fontSize: 12, maxWidth: "100%", opacity: current ? 1 : 0.5 }}>
      {busy ? <LoaderCircle size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
      {busy ? "도면 원본 검증 중" : "실내 검토 도면·수량 내려받기"}
    </button>
    {busy && <button type="button" title="도면 생성 취소" aria-label="도면 생성 취소" className="ui-btn" onClick={() => {
      pending.current?.abort(); pending.current = null; setBusy(false);
      setFeedback({ error: false, text: "도면 생성 취소 · 파일을 생성하지 않았습니다." });
    }}><X size={15} aria-hidden="true" /></button>}
    {feedback && <p role={feedback.error ? "alert" : "status"} style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.6,
      overflowWrap: "anywhere", color: feedback.error ? "var(--neg-fg)" : "var(--fg-muted)" }}>{feedback.text}</p>}
  </div>;
}
