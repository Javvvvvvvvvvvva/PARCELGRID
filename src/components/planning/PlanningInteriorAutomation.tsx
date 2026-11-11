"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, WandSparkles, X } from "lucide-react";
import { clientSession } from "@/lib/auth/client-session";
import { useProjectStore } from "@/lib/stores/project-store";
import { interiorAutomationInputKey, type InteriorAutomationInput, type InteriorAutomationProgress, type InteriorAutomationResult } from "@/lib/planning/interior-automation";
import { runInteriorAutomationApplyWorker, runInteriorAutomationWorker } from "@/lib/planning/interior-automation-worker";
import { isPlanningGeometryLocked } from "@/lib/planning/geometry-source";
import type { PlanningScenario } from "@/lib/planning/types";
import { interiorDoorSegment } from "@/lib/planning/interior-layout";
import { pathDoorSegment, pathSpaceShape } from "@/lib/planning/interior-paths";
import { coordinates, PlanDrawing } from "./layout-verification-ui";

export function PlanningInteriorAutomation({ scenario, geometry, parking, onChange }: Omit<InteriorAutomationInput, "options"> & {
  onChange: (patch: Partial<PlanningScenario>) => void;
}) {
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [bedrooms, setBedrooms] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<InteriorAutomationProgress | null>(null);
  const [preview, setPreview] = useState<{ result: InteriorAutomationResult; liveKey: string } | null>(null);
  const [message, setMessage] = useState("");
  const [previewFloorId, setPreviewFloorId] = useState("");
  const pending = useRef<AbortController | null>(null);
  const input = useMemo(() => ({ scenario, geometry, parking, options: { replaceExisting, bedrooms } }), [scenario, geometry, parking, replaceExisting, bedrooms]);
  const key = useMemo(() => { try { return interiorAutomationInputKey(input); } catch { return null; } }, [input]);
  const locked = isPlanningGeometryLocked(scenario);
  const existing = scenario.floorPrograms.filter(floor => floor.interiorLayout).length;
  function liveKey() {
    clientSession.assertActive();
    const state = useProjectStore.getState(), live = state.planningScenarios.find(item => item.id === scenario.id);
    if (!state.data || state.data.parcel.id !== scenario.projectId || state.selectedPlanningScenarioId !== scenario.id || !live ||
        JSON.stringify(live) !== JSON.stringify(scenario)) throw new Error("선택한 계획이 변경됐습니다. 현재 입력으로 다시 생성하세요.");
    return JSON.stringify({ parcel: state.data.parcel, scenario: live, representative: state.representativePlanningScenarioId,
      representativeGeometry: state.representativeGeometrySnapshot });
  }
  useEffect(() => {
    pending.current?.abort(); pending.current = null;
    setPreview(null); setBusy(false); setProgress(null); setMessage("");
    return () => { pending.current?.abort(); pending.current = null; };
  }, [key]);
  useEffect(() => clientSession.subscribe(() => {
    pending.current?.abort(); pending.current = null; setBusy(false); setPreview(null); setProgress(null);
  }), []);

  async function generate() {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setPreview(null); setProgress(null); setMessage("");
    try {
      const captured = liveKey();
      const result = await runInteriorAutomationWorker(input, controller.signal, value => {
        if (!controller.signal.aborted && clientSession.active) setProgress(value);
      });
      if (controller.signal.aborted || pending.current !== controller) return;
      if (captured !== liveKey() || result.sourceKey !== key) throw new Error("계산 중 입력이 변경되어 후보를 폐기했습니다.");
      setPreview({ result, liveKey: captured });
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "구획 후보를 생성하지 못했습니다.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  const current = preview?.result.sourceKey === key ? preview : null;
  const previewFloor = current?.result.candidate?.layouts.find(item => item.floorId === previewFloorId) ??
    current?.result.candidate?.layouts.find(item => item.layout.spaces.some(space => space.kind === "unit")) ?? current?.result.candidate?.layouts[0];
  const previewMass = geometry?.building.floors.find(floor => floor.id === previewFloor?.floorId);
  return <div className="lv-automation" aria-label="전체 층 구획 자동화">
    <h4>전체 층 구획 후보</h4>
    <div className="lv-fields">
      <label className="lv-field">새 상세 실의 침실 수<select aria-label="새 상세 실의 침실 수" value={bedrooms} disabled={busy || locked}
        onChange={event => setBedrooms(Number(event.target.value))}>
        {[0, 1, 2, 3].map(value => <option key={value} value={value}>{value === 0 ? "거실·취침 통합" : `${value}개`}</option>)}
      </select></label>
      <label className="lv-confirm"><input type="checkbox" aria-label="기존 구획과 출구 교체" checked={replaceExisting} disabled={busy || locked}
        onChange={event => setReplaceExisting(event.target.checked)} />기존 구획 {existing}개 층·출구 교체</label>
    </div>
    <div className="lv-actions">
      <button type="button" disabled={busy || locked || !key || !geometry || !parking} onClick={generate}>
        {busy ? <LoaderCircle size={15} /> : <WandSparkles size={15} />}전체 층 후보 생성</button>
      {busy && <button type="button" title="일괄 구획 생성 취소" aria-label="일괄 구획 생성 취소" onClick={() => {
        pending.current?.abort(); pending.current = null; setBusy(false); setProgress(null); setMessage("생성 취소 · 기존 계획 유지");
      }}><X size={15} /></button>}
    </div>
    {busy && <p role="status">구획 계산 중{progress ? ` · 후보 ${progress.attempt}/6 · ${progress.floor + 1}/${progress.totalFloors}층` : ""}</p>}
    {current && <>
      <p className="lv-status" data-state={current.result.status === "ready" ? "review" : "conflict"}>
        {current.result.status === "ready" ? current.result.changed ? "전체 연결 후보 · 적용 전" : "현재 구획 예비 확인 · 변경 없음" :
          current.result.status === "incomplete" ? "계산 한도 · 검토 미완료" : "전체 연결 후보 미확보"}</p>
      <div className="lv-table-wrap"><table aria-label="전체 층 구획 후보 결과"><thead><tr><th>층</th><th>구획</th><th>상세 실 세대</th><th>기존 구획</th></tr></thead>
        <tbody>{current.result.rows.map(row => <tr key={row.floorId}><th>{row.label}</th>
          <td>{row.interior === "preliminary-fit" ? "예비 확인" : "검토 필요"}</td><td>{row.roomsReady}/{row.units}</td><td>{row.preserved ? "보존" : "생성"}</td></tr>)}</tbody></table></div>
      <p>출구 연결 {current.result.connectedFloors}/{scenario.floorPrograms.length}층 · 공식 경계·허가·전문가 승인 미확정</p>
      {previewFloor && previewMass && <>
        <label className="lv-field">후보 표시 층<select aria-label="후보 표시 층" value={previewFloor.floorId} onChange={event => setPreviewFloorId(event.target.value)}>
          {current.result.candidate?.layouts.map(item => <option key={item.floorId} value={item.floorId}>
            {scenario.floorPrograms.find(floor => floor.id === item.floorId)?.label}</option>)}
        </select></label>
        <PlanDrawing outline={previewMass.shape} label="전체 층 후보 평면 미리보기">
          {previewFloor.layout.spaces.map(space => <polygon key={space.id} points={coordinates(pathSpaceShape(space))}
            fill={space.kind === "core" ? "#f5d7cf" : space.kind === "corridor" ? "#e0e8f5" : "#e4eee9"} stroke="#64748b" strokeWidth={0.04} />)}
          {previewFloor.layout.roomLayouts?.flatMap(room => room.spaces.map(space => <g key={`${room.unitId}:${space.id}`}>
            <polygon points={coordinates(pathSpaceShape(space))} fill={space.kind === "bathroom" ? "#d5eaf3" : space.kind === "kitchen" ? "#f0e8c9" : "#e4eee9"}
              stroke="#64748b" strokeWidth={0.025} />
            <text x={space.center.x} y={space.center.z} textAnchor="middle" dominantBaseline="middle" fontSize={0.3} fill="#223a3a">{space.label}</text>
          </g>))}
          {previewFloor.layout.spaces.filter(space => space.kind !== "unit").map(space => <text key={space.id} x={space.center.x} y={space.center.z}
            textAnchor="middle" dominantBaseline="middle" fontSize={0.35} fill="#223a3a">{space.label}</text>)}
          {[...previewFloor.layout.doors.map(door => interiorDoorSegment(previewFloor.layout, door)),
            ...previewFloor.layout.roomLayouts?.flatMap(room => room.doors.map(door => pathDoorSegment(room.spaces, door, room.settings.wallThicknessM))) ?? []]
            .map((segment, index) => segment && <line key={index} x1={segment[0].x} y1={segment[0].z} x2={segment[1].x} y2={segment[1].z}
              stroke="#fff" strokeWidth={0.12} />)}
        </PlanDrawing>
      </>}
      {!!current.result.issues.length && <ul className="lv-issues">{current.result.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
      <button type="button" disabled={busy || locked || !current.result.changed || current.result.status !== "ready"} onClick={async () => {
        pending.current?.abort();
        const controller = new AbortController(); pending.current = controller; setBusy(true); setProgress(null); setMessage("");
        try {
          if (current.liveKey !== liveKey()) throw new Error("미리보기 이후 입력이 변경됐습니다. 다시 생성하세요.");
          const patch = await runInteriorAutomationApplyWorker(input, current.result, controller.signal);
          if (controller.signal.aborted || pending.current !== controller) return;
          if (current.liveKey !== liveKey()) throw new Error("후보 재검사 중 입력이 변경되어 적용하지 않았습니다.");
          clientSession.assertActive(); onChange(patch); setPreview(null); setMessage("구획 후보 적용 · 면적·수익·주차 공급 유지 · 공식 승인 미확정");
        } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "구획 후보를 적용하지 못했습니다."); }
        finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
      }}><Check size={15} />전체 층 후보 적용</button>
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
