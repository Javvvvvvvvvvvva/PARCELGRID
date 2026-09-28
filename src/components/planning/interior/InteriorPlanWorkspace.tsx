"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { FloorProgram, PlanningScenario } from "@/lib/planning/types";
import type { PlanningGeometrySnapshot, PlanningGeometryFloor } from "@/lib/planning/planning-geometry";
import { INTERIOR_VERSION, SPACE_COLORS, SPACE_KINDS, SPACE_LABELS, interiorLayoutSchema, type InteriorLayout, type InteriorSpace, type InteriorGenerationResult } from "@/lib/planning/interior/types";
import { clearSpaceArea, connectAdjacentSpaces, connectSpaces, doorSegment, sharedEdge, spacePolygon, validateInteriorLayout } from "@/lib/planning/interior/geometry";
import { applyInteriorToFloor, isInteriorFinanceCurrent } from "@/lib/planning/interior/finance";
import { buildInteriorDxfPackage, downloadBytes } from "@/lib/planning/interior/export";
import { createPlanningWorker } from "@/lib/planning/interior/worker-client";
import "./interior.css";

const SpaceRelationshipGraph = dynamic(() => import("./SpaceRelationshipGraph"), { ssr: false });
const InteriorPreview3D = dynamic(() => import("./InteriorPreview3D"), { ssr: false });
type WorkerJob = ReturnType<typeof createPlanningWorker>;
const messageOf = (error: unknown) => error instanceof Error ? error.message : "작업을 완료하지 못했습니다.";

function NumberField({ label, value, onChange, min, max, step = 0.1, disabled = false }: {
  label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number; disabled?: boolean;
}) {
  return <label>{label}<input type="number" value={Number(value.toFixed(3))} min={min} max={max} step={step} disabled={disabled}
    onChange={e => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }} /></label>;
}

function FloorInteriorEditor({ floor, geometry, planning, disabled, onChange }: {
  floor: FloorProgram; geometry: PlanningGeometryFloor; planning: PlanningGeometrySnapshot;
  disabled: boolean; onChange: (floor: FloorProgram) => void;
}) {
  const outline = geometry.shape;
  const layout = floor.interior;
  const [count, setCount] = useState(2);
  const [circulation, setCirculation] = useState(1.8);
  const [coreDepth, setCoreDepth] = useState(3.5);
  const [minWidth, setMinWidth] = useState(2);
  const [minArea, setMinArea] = useState(12);
  const [wall, setWall] = useState(0.15);
  const [candidates, setCandidates] = useState<InteriorGenerationResult["candidates"]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<"plan" | "graph" | "3d">("plan");
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<InteriorLayout | null>(null);
  const [history, setHistory] = useState<InteriorLayout[]>([]);
  const [future, setFuture] = useState<InteriorLayout[]>([]);
  const job = useRef<WorkerJob | null>(null);
  const request = useRef(0);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; start: { x: number; z: number }; center: { x: number; z: number }; base: InteriorLayout } | null>(null);
  const shown = preview ?? layout;
  const assessment = useMemo(() => shown ? validateInteriorLayout(shown, outline) : null, [shown, outline]);
  const selected = shown?.spaces.find(s => s.id === selectedId);
  const financeCurrent = isInteriorFinanceCurrent(floor);
  const minX = Math.min(...outline.map(p => p.x)), minZ = Math.min(...outline.map(p => p.z));
  const width = Math.max(1, Math.max(...outline.map(p => p.x)) - minX);
  const depth = Math.max(1, Math.max(...outline.map(p => p.z)) - minZ);
  const padding = Math.max(width, depth) * 0.07;

  useEffect(() => {
    const token = request;
    token.current++; job.current?.terminate(); job.current = null;
    setBusy(false); setCandidates([]); setPreview(null); drag.current = null;
    return () => { token.current++; job.current?.terminate(); job.current = null; };
  }, [planning.geometryHash]);

  const commit = (next: InteriorLayout) => {
    if (disabled) return;
    if (layout) setHistory(h => [...h.slice(-19), structuredClone(layout)]);
    setFuture([]); setPreview(null); onChange({ ...floor, interior: next });
  };
  const generate = async () => {
    const id = ++request.current;
    job.current?.terminate(); job.current = createPlanningWorker();
    setBusy(true); setNotice(""); setCandidates([]);
    try {
      const result = await job.current.run(api => api.generateInteriorCandidates({ outline, count, circulationWidthM: circulation, coreDepthM: coreDepth, minRoomWidthM: minWidth, minRoomAreaSqm: minArea, wallThicknessM: wall }));
      if (id === request.current) { setCandidates(result.candidates); setNotice(result.message); }
    } catch (error) { if (id === request.current) setNotice(messageOf(error)); }
    finally { if (id === request.current) { setBusy(false); job.current = null; } }
  };
  const addSpace = () => {
    const base: InteriorLayout = layout ?? { version: INTERIOR_VERSION, stage: "concept", sourceOutline: structuredClone(outline), wallThicknessM: wall, spaces: [], doors: [], relations: [], generator: "manual" };
    if (base.spaces.length >= 64) return;
    const space: InteriorSpace = { id: `space-${crypto.randomUUID()}`, label: `공간 ${base.spaces.length + 1}`, kind: "unit", center: { x: minX + width / 2, z: minZ + depth / 2 }, widthM: Math.min(4, width), depthM: Math.min(4, depth), rotationDeg: 0, locked: false, minWidthM: minWidth, minAreaSqm: minArea, unitCount: 1, revenueModel: "sale" };
    commit({ ...base, generator: "manual", spaces: [...base.spaces, space] }); setSelectedId(space.id);
  };
  const updateSpace = (patch: Partial<InteriorSpace>) => {
    if (!layout || !selected) return;
    commit({ ...layout, generator: "manual", spaces: layout.spaces.map(s => s.id === selected.id ? { ...s, ...patch } : s) });
  };
  const pointAt = (e: PointerEvent<SVGSVGElement | SVGGElement>) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, z: p.y };
  };
  const startDrag = (e: PointerEvent<SVGGElement>, space: InteriorSpace) => {
    setSelectedId(space.id);
    const p = pointAt(e);
    if (disabled || space.locked || !layout || !p) return;
    e.preventDefault(); svg.current?.setPointerCapture(e.pointerId);
    drag.current = { id: space.id, start: p, center: space.center, base: layout };
  };
  const movedLayout = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current, p = pointAt(e);
    if (!d || !p) return null;
    const center = { x: Math.round((d.center.x + p.x - d.start.x) * 20) / 20, z: Math.round((d.center.z + p.z - d.start.z) * 20) / 20 };
    return { ...d.base, generator: "manual" as const, spaces: d.base.spaces.map(s => s.id === d.id ? { ...s, center } : s) };
  };
  const exportFile = async (format: "dxf" | "3dm") => {
    if (!layout) return;
    setExporting(true); setNotice("");
    try {
      const input = { planning, floorId: floor.id, layout };
      const file = format === "dxf" ? buildInteriorDxfPackage(input) : await (await import("@/lib/planning/interior/rhino-export")).buildInterior3dm(input);
      downloadBytes(file.bytes, file.filename); setNotice("현재 층의 검토용 구획 파일을 저장했습니다.");
    } catch (error) { setNotice(messageOf(error)); }
    finally { setExporting(false); }
  };
  return <div>
    <p className="pg-interior-note">층 외곽 안에 코어·복도·세대를 배치하는 개념 계획입니다. 아래 치수는 사용자 가정이며 법정 최소값이 아닙니다. 계단 상세·창호·피난·구조·설비는 설계 검토가 필요합니다.</p>
    {disabled && <p className="pg-interior-warning">확정 형상이 잠겨 있습니다. 편집하려면 형상 출처 패널에서 잠금을 해제하세요.</p>}
    <fieldset disabled={disabled || busy} className="pg-interior-controls"><legend>자동 후보 생성 조건</legend>
      <div className="pg-interior-fields">
        <NumberField label="세대 수" value={count} onChange={n => setCount(Math.round(n))} min={1} max={12} step={1} />
        <NumberField label="복도·코어 폭 (m)" value={circulation} onChange={setCirculation} min={0.5} max={10} />
        <NumberField label="코어 깊이 (m)" value={coreDepth} onChange={setCoreDepth} min={1} max={15} />
        <NumberField label="공간 최소 유효 폭 (m)" value={minWidth} onChange={setMinWidth} min={0.5} max={30} />
        <NumberField label="공간 최소 내부 면적 (㎡)" value={minArea} onChange={setMinArea} min={1} max={1000} step={1} />
        <NumberField label="가정 벽 두께 (m)" value={wall} onChange={setWall} min={0} max={0.6} step={0.01} />
      </div>
      <button type="button" className="pg-interior-primary" onClick={generate}>조건에 맞는 후보 생성</button>
    </fieldset>
    {busy && <div role="status">후보를 계산하고 있습니다… <button type="button" onClick={() => { request.current++; job.current?.terminate(); job.current = null; setBusy(false); setNotice("계산을 취소했습니다."); }}>취소</button></div>}
    {notice && <p role="status" className="pg-interior-note">{notice}</p>}
    {candidates.length > 0 && <div className="pg-interior-candidates">{candidates.map((candidate, i) => <button type="button" key={i} disabled={disabled} onClick={() => { commit(candidate.layout); setSelectedId(candidate.layout.spaces.find(s => s.kind === "unit")?.id ?? ""); setNotice("후보를 적용했습니다. 구획을 확인한 뒤 사업성 면적에 반영하세요."); }}>
      <strong>{candidate.label}</strong><span>내부 분양 가정 면적 / 층 면적 {(candidate.score * 100).toFixed(1)}%</span><span>이 후보로 구획 전체 교체</span>
    </button>)}</div>}
    <div className="pg-interior-toolbar">
      <button type="button" disabled={disabled || (layout?.spaces.length ?? 0) >= 64} onClick={addSpace}>공간 추가</button>
      <button type="button" disabled={disabled || !layout || history.length === 0} onClick={() => { if (!layout) return; const previous = history.at(-1)!; setHistory(history.slice(0, -1)); setFuture([...future, layout]); onChange({ ...floor, interior: previous }); }}>되돌리기</button>
      <button type="button" disabled={disabled || !layout || future.length === 0} onClick={() => { if (!layout) return; const next = future.at(-1)!; setFuture(future.slice(0, -1)); setHistory([...history, layout]); onChange({ ...floor, interior: next }); }}>다시 실행</button>
      {layout && <button type="button" disabled={disabled} onClick={() => commit(connectAdjacentSpaces(layout))}>맞닿은 공용 공간에 문 연결</button>}
    </div>
    {layout && shown && <>
      <div className="pg-interior-tabs" role="tablist" aria-label="내부 구획 보기">{([['plan', '2D 편집'], ['graph', '공간 관계'], ['3d', '3D 구획']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
      {tab === "graph" && <SpaceRelationshipGraph layout={layout} disabled={disabled} onChange={commit} />}
      {tab === "3d" && <><p className="pg-interior-note">구획·개구 위치를 확인하는 입체 미리보기입니다. 벽체 상세 모델은 포함하지 않습니다.</p><InteriorPreview3D outline={outline} layout={shown} /></>}
      {tab === "plan" && <div className="pg-interior-editor">
        <div><svg ref={svg} className="pg-interior-canvas" aria-label={`${floor.label} 내부 구획 편집`} viewBox={`${minX - padding} ${minZ - padding} ${width + padding * 2} ${depth + padding * 2}`}
          onPointerMove={e => { const next = movedLayout(e); if (next) setPreview(next); }}
          onPointerUp={e => { const next = movedLayout(e); drag.current = null; if (next) commit(next); if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId); }}
          onPointerCancel={() => { drag.current = null; setPreview(null); }}>
          <polygon points={outline.map(p => `${p.x},${p.z}`).join(" ")} fill="#fff" stroke="#334155" strokeWidth={0.08} />
          {shown.spaces.map(space => <g key={space.id} data-space-id={space.id} onPointerDown={e => startDrag(e, space)} style={{ cursor: disabled || space.locked ? "pointer" : "move" }}>
            <polygon points={spacePolygon(space).map(p => `${p.x},${p.z}`).join(" ")} fill={SPACE_COLORS[space.kind]} fillOpacity={0.45} stroke={space.id === selectedId ? "#1d4ed8" : "#64748b"} strokeWidth={space.id === selectedId ? 0.09 : 0.035} />
            <polygon points={spacePolygon(space, shown.wallThicknessM / 2).map(p => `${p.x},${p.z}`).join(" ")} fill={SPACE_COLORS[space.kind]} fillOpacity={0.65} />
            <text x={space.center.x} y={space.center.z} fontSize={Math.max(width, depth) * 0.024} textAnchor="middle" fill="#172033" pointerEvents="none">{space.label}{space.locked ? " 🔒" : ""}</text>
            <text x={space.center.x} y={space.center.z + Math.max(width, depth) * 0.03} fontSize={Math.max(width, depth) * 0.02} textAnchor="middle" fill="#334155" pointerEvents="none">{clearSpaceArea(space, shown.wallThicknessM).toFixed(1)}㎡</text>
          </g>)}
          {shown.doors.map(door => { const segment = doorSegment(shown, door); return segment ? <line key={door.id} x1={segment[0].x} y1={segment[0].z} x2={segment[1].x} y2={segment[1].z} stroke="#047857" strokeWidth={0.15} pointerEvents="none" /> : null; })}
          <text x={minX} y={minZ - padding * 0.3} fontSize={padding * 0.4} fill="#475569">↑ 북 · 단위 m</text>
        </svg><p className="pg-interior-note">공간을 끌어 5cm 단위로 이동하거나 오른쪽에서 치수를 입력하세요. 녹색 선은 문 개구입니다. 이동 후 기존 문이 맞지 않으면 다시 연결해야 합니다.</p></div>
        <div className="pg-interior-inspector">
          <label>편집할 공간<select value={selected?.id ?? ""} onChange={e => setSelectedId(e.target.value)}><option value="">공간 선택</option>{layout.spaces.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          {selected && <fieldset disabled={disabled}>
            <label>이름<input value={selected.label} maxLength={100} onChange={e => updateSpace({ label: e.target.value || "공간" })} /></label>
            <label>공간 용도<select value={selected.kind} onChange={e => { const kind = e.target.value as InteriorSpace["kind"]; updateSpace({ kind, unitCount: kind === "unit" || kind === "retail" ? 1 : 0, ...(kind === "core" || kind === "corridor" ? { revenueModel: "non-revenue" } : {}) }); }}>{SPACE_KINDS.map(kind => <option key={kind} value={kind}>{SPACE_LABELS[kind]}</option>)}</select></label>
            <label className="pg-interior-check"><input type="checkbox" checked={selected.locked} onChange={e => updateSpace({ locked: e.target.checked })} />위치·크기 잠금</label>
            <div className="pg-interior-fields pg-interior-two">
              <NumberField label="동서 X (m)" value={selected.center.x} onChange={x => updateSpace({ center: { ...selected.center, x } })} min={-1e5} max={1e5} disabled={selected.locked} />
              <NumberField label="남북 Z (m)" value={selected.center.z} onChange={z => updateSpace({ center: { ...selected.center, z } })} min={-1e5} max={1e5} disabled={selected.locked} />
              <NumberField label="폭 (m)" value={selected.widthM} onChange={widthM => updateSpace({ widthM })} min={0.2} max={200} disabled={selected.locked} />
              <NumberField label="깊이 (m)" value={selected.depthM} onChange={depthM => updateSpace({ depthM })} min={0.2} max={200} disabled={selected.locked} />
              <NumberField label="회전 (°)" value={selected.rotationDeg} onChange={rotationDeg => updateSpace({ rotationDeg })} min={-180} max={180} step={1} disabled={selected.locked} />
              <NumberField label="세대·실 수" value={selected.unitCount} onChange={n => updateSpace({ unitCount: Math.round(n) })} min={0} max={100} step={1} disabled={selected.kind === "core" || selected.kind === "corridor"} />
              <NumberField label="최소 유효 폭 (m)" value={selected.minWidthM} onChange={minWidthM => updateSpace({ minWidthM })} min={0} max={50} />
              <NumberField label="최소 내부 면적 (㎡)" value={selected.minAreaSqm} onChange={minAreaSqm => updateSpace({ minAreaSqm })} min={0} max={10000} />
            </div>
            <label>수익 방식<select value={selected.revenueModel} disabled={selected.kind === "core" || selected.kind === "corridor"} onChange={e => updateSpace({ revenueModel: e.target.value as InteriorSpace["revenueModel"] })}><option value="sale">분양</option><option value="lease">임대</option><option value="non-revenue">비수익</option></select></label>
            <p className="pg-interior-note">세대 내부를 방별로 나눌 때 세대·실 수는 한 곳에만 입력하세요. 현재 구획은 세대별 방 묶음을 자동 집계하지 않습니다.</p>
            <div className="pg-interior-toolbar">{layout.spaces.filter(s => s.id !== selected.id && sharedEdge(spacePolygon(selected), spacePolygon(s))).map(s => <button type="button" key={s.id} onClick={() => { try { commit(connectSpaces(layout, selected.id, s.id)); } catch (error) { setNotice(messageOf(error)); } }}>{s.label}에 0.9m 문 연결</button>)}</div>
            {layout.doors.filter(d => d.from === selected.id || d.to === selected.id).map(door => <div key={door.id}>
              <NumberField label={`문 폭 (m) · ${layout.spaces.find(s => s.id === (door.from === selected.id ? door.to : door.from))?.label ?? "연결 누락"}`} value={door.widthM} min={0.1} max={5} onChange={widthM => commit({ ...layout, doors: layout.doors.map(d => d.id === door.id ? { ...d, widthM } : d) })} />
              <button type="button" onClick={() => commit({ ...layout, doors: layout.doors.filter(d => d.id !== door.id) })}>이 문 삭제</button>
            </div>)}
            <button type="button" disabled={selected.locked} onClick={() => { commit({ ...layout, spaces: layout.spaces.filter(s => s.id !== selected.id), doors: layout.doors.filter(d => d.from !== selected.id && d.to !== selected.id), relations: layout.relations.filter(r => r.from !== selected.id && r.to !== selected.id) }); setSelectedId(""); }}>선택 공간 삭제</button>
          </fieldset>}
          <fieldset disabled={disabled}><NumberField label="현재 구획 벽 두께 (m)" value={layout.wallThicknessM} onChange={wallThicknessM => commit({ ...layout, wallThicknessM })} min={0} max={0.6} step={0.01} /></fieldset>
          {assessment?.issues.some(i => i.code === "stale-outline") && <button type="button" disabled={disabled} onClick={() => commit({ ...layout, sourceOutline: structuredClone(outline) })}>현재 층 외곽으로 다시 검증</button>}
        </div>
      </div>}
      {assessment && <div className="pg-interior-assessment" aria-live="polite">
        <strong>{assessment.valid ? "구획 기하 검사 통과" : "구획 수정 필요"}</strong>
        <div className="pg-interior-metrics"><span>층 면적 <b>{assessment.floorAreaSqm.toFixed(1)}㎡</b></span><span>배치 구획 <b>{assessment.assignedAreaSqm.toFixed(1)}㎡</b></span><span>추정 내부 합계 <b>{assessment.clearAreaSqm.toFixed(1)}㎡</b></span><span>미배치 <b>{assessment.remainingAreaSqm.toFixed(1)}㎡</b></span></div>
        {assessment.issues.length > 0 && <ul>{assessment.issues.slice(0, 12).map((issue, i) => <li key={i}>{issue.severity === "fail" ? "수정" : "검토"} · {issue.message}</li>)}{assessment.issues.length > 12 && <li>외 {assessment.issues.length - 12}개 항목</li>}</ul>}
        <p className="pg-interior-note">벽 중심선 구획에서 가정 벽 두께의 절반을 안쪽으로 뺀 면적입니다. 법정 전용·분양 면적으로 확정된 값이 아닙니다. 총 층 면적을 유지하고 잔여 면적은 비수익 공용 면적으로 처리합니다.</p>
        <div className="pg-interior-toolbar"><button type="button" className="pg-interior-primary" disabled={disabled || !assessment.valid || financeCurrent} onClick={() => { try { onChange(applyInteriorToFloor(floor, layout, outline)); setNotice("층 총면적을 유지하며 내부 구획의 추정 수익 면적·세대 수를 사업성에 반영했습니다."); } catch (error) { setNotice(messageOf(error)); } }}>{financeCurrent ? "사업성 면적 반영됨" : "사업성 면적에 반영"}</button>
          <button type="button" disabled={!assessment.valid || exporting} onClick={() => exportFile("dxf")}>내부 DXF 패키지</button>
          <button type="button" disabled={!assessment.valid || exporting} onClick={() => exportFile("3dm")}>{exporting ? "파일 준비 중…" : "Rhino 3DM 구획"}</button></div>
        {!financeCurrent && <p className="pg-interior-note">이 구획은 아직 사업성 면적과 일치하지 않습니다. 대표안 확정 전에 면적 반영이 필요합니다. 내부 도면은 검토용으로 먼저 내보낼 수 있습니다.</p>}
      </div>}
    </>}
  </div>;
}

export default function InteriorPlanWorkspace({ scenario, planning, disabled, onChange }: {
  scenario: PlanningScenario; planning: PlanningGeometrySnapshot; disabled: boolean; onChange: (floors: FloorProgram[]) => void;
}) {
  const [floorId, setFloorId] = useState("");
  const [open, setOpen] = useState(false);
  const floor = scenario.floorPrograms.find(f => f.id === floorId) ?? scenario.floorPrograms.find(f => f.level > 0) ?? scenario.floorPrograms[0];
  const geometry = planning.building.floors.find(f => f.id === floor?.id);
  const invalidLayout = !!floor?.interior && !interiorLayoutSchema.safeParse(floor.interior).success;
  return <section className="pg-interior" aria-label="내부 구획 스튜디오">
    <div className="pg-interior-heading"><div><h3>내부 구획 스튜디오</h3><p>공간 관계 · 평면 편집 · 면적 연결 · 설계 인계</p></div><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "접기" : "내부 구획 열기"}</button></div>
    {open && <><label>편집 층<select value={floor?.id ?? ""} onChange={e => setFloorId(e.target.value)}>{scenario.floorPrograms.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
      {invalidLayout ? <p role="alert">저장된 내부 구획 형식을 읽지 못했습니다. 원본 인계 파일을 보관한 뒤 구획을 다시 작성하세요. <button type="button" disabled={disabled} onClick={() => onChange(scenario.floorPrograms.map(f => f.id === floor.id ? { ...f, interior: undefined, interiorFinanceSignature: undefined } : f))}>잘못된 구획 초기화</button></p> : floor && geometry && geometry.shape.length >= 3 ? <FloorInteriorEditor key={`${scenario.id}:${floor.id}`} floor={floor} geometry={geometry} planning={planning} disabled={disabled} onChange={next => onChange(scenario.floorPrograms.map(f => f.id === next.id ? next : f))} /> : <p>먼저 유효한 층 외곽을 구성하세요.</p>}
    </>}
  </section>;
}
