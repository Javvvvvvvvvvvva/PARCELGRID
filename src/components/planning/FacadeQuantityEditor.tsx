"use client";
import { useState } from "react";
import type { PlanningFacadeMaterial, PlanningFacadeRate, PlanningMaterialSelection, PlanningFacadeFaceSelection } from "@/lib/planning/types";
import { PLANNING_FACADE_LABELS, type PlanningMaterialCostAdjustment } from "@/lib/planning/materials";
import { FacadeCostSummary } from "./FacadeCostSummary";

const options = Object.entries(PLANNING_FACADE_LABELS) as [PlanningFacadeMaterial, string][];
const numeric = (text: string) => text.trim() === "" ? undefined : Math.max(0, Number(text));
export function FacadeQuantityEditor({ materials, cost, onChange }: {
  materials: PlanningMaterialSelection; cost: PlanningMaterialCostAdjustment;
  onChange: (materials: PlanningMaterialSelection) => void;
}) {
  const [selectedFloor, setSelectedFloor] = useState("");
  const floors = [...new Set(cost.quantities.faces.map(f => f.floorId))];
  const floorId = floors.includes(selectedFloor) ? selectedFloor : floors[0];
  const faces = cost.quantities.faces.filter(f => f.floorId === floorId);
  const [selectedFace, setSelectedFace] = useState("");
  const face = faces.find(f => f.id === selectedFace) ?? faces[0];
  const patchFace = (patch: Partial<PlanningFacadeFaceSelection>) => {
    if (face) onChange({ ...materials, faceAssignments: { ...materials.faceAssignments, [face.id]: { ...materials.faceAssignments?.[face.id], ...patch } } });
  };
  const patchRate = (material: PlanningFacadeMaterial, patch: Partial<PlanningFacadeRate>) => onChange({ ...materials, materialRates: { ...materials.materialRates, [material]: { ...materials.materialRates?.[material], ...patch } } });
  const points = faces.flatMap(f => [f.start, f.end]);
  const minX = Math.min(...points.map(p => p.x)), minZ = Math.min(...points.map(p => p.z));
  const width = Math.max(1, Math.max(...points.map(p => p.x)) - minX), depth = Math.max(1, Math.max(...points.map(p => p.z)) - minZ);
  return <div className="facade-editor" role="region" aria-label="면별 외장재 설정">
    <FacadeCostSummary cost={cost} />
    <details><summary>면별 재료·개구부·공유벽 설정</summary>
      {cost.quantities.staleAssignmentIds.length > 0 && <p role="alert">형상 변경으로 이전 면 설정 {cost.quantities.staleAssignmentIds.length}개를 적용할 수 없습니다.</p>}
      {Object.keys(materials.faceAssignments ?? {}).length > 0 && <button type="button" onClick={() => onChange({ ...materials, faceAssignments: {} })}>면별 설정 초기화</button>}
      {face ? <>
        <label>층 선택<select aria-label="층 선택" value={floorId} onChange={e => setSelectedFloor(e.target.value)}>{floors.map(id => <option value={id} key={id}>{cost.quantities.faces.find(f => f.floorId === id)!.label.split(" · ")[0]}</option>)}</select></label>
        <svg aria-label="외벽 위치 평면도" role="img" viewBox={`${minX - 2} ${minZ - 2} ${width + 4} ${depth + 4}`} style={{ width: "100%", height: 220, background: "var(--bg-sunken)" }}>
          {faces.map((f, i) => <g key={f.id} onClick={() => setSelectedFace(f.id)} style={{ cursor: "pointer" }}>
            <line x1={f.start.x} y1={f.start.z} x2={f.end.x} y2={f.end.z} stroke={f.id === face.id ? "#ea580c" : "#64748b"} strokeWidth={f.id === face.id ? 0.24 : 0.12} />
            <text x={(f.start.x + f.end.x) / 2} y={(f.start.z + f.end.z) / 2 - 0.3} fontSize={0.7} fill="currentColor">{i + 1}</text>
          </g>)}
        </svg>
        <label>외벽 선택<select aria-label="외벽 선택" value={face.id} onChange={e => setSelectedFace(e.target.value)}>{faces.map(f => <option key={f.id} value={f.id}>{f.label} · {f.lengthM.toFixed(2)}m × {f.heightM.toFixed(2)}m</option>)}</select></label>
        <div className="facade-fields">
          <label>면 재료<select aria-label="면 재료" value={materials.faceAssignments?.[face.id]?.material ?? "inherit"} onChange={e => patchFace({ material: e.target.value === "inherit" ? undefined : e.target.value as PlanningFacadeMaterial })}><option value="inherit">전체 재료 비율 따름</option>{options.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
          <label>벽 노출 조건<select aria-label="벽 노출 조건" value={materials.faceAssignments?.[face.id]?.exposure ?? "assumed"} onChange={e => patchFace({ exposure: e.target.value === "assumed" ? undefined : e.target.value as "exposed" | "shared" | "unknown" })}><option value="assumed">노출 가정 · 현장 확인 전</option><option value="exposed">노출벽 · 사용자 확인</option><option value="shared">공유벽 · 수량 제외</option><option value="unknown">미확인 · 수량 보류</option></select></label>
          <label>개구부 면적 (㎡)<input aria-label="개구부 면적 (㎡)" type="number" min={0} max={face.grossAreaSqm} step="0.01" value={materials.faceAssignments?.[face.id]?.openingAreaSqm ?? ""} placeholder={`빈칸: 창호비 ${materials.windowRatioPct}%`} onChange={e => patchFace({ openingAreaSqm: numeric(e.target.value) })} /></label>
        </div><p>개구부 직접 입력은 전체 창호비를 대체합니다. 선택 벽: 총 {face.grossAreaSqm.toFixed(2)}㎡ · 공제 후 {face.netAreaSqm.toFixed(2)}㎡. 평면도 위쪽은 북쪽입니다.</p>
      </> : <p>면별 지정에는 유효한 계획 형상이 필요합니다. 외벽 순면적을 직접 입력한 경우에는 전체 재료 비율을 사용합니다.</p>}
    </details>
    <label>단가 적용 방식<select aria-label="단가 적용 방식" value={materials.pricingMode ?? "assembly"} onChange={e => onChange({ ...materials, pricingMode: e.target.value as "assembly" | "by-material" })}><option value="assembly">전체 재료 조합 공통 단가 (기존 입력)</option><option value="by-material">재료별 단가</option></select></label>
    {materials.pricingMode === "by-material" && options.filter(([id]) => id !== "unselected").map(([id, label]) => {
      const rate = materials.materialRates?.[id] ?? {};
      const evidence = rate.evidence ?? { status: "unpriced" as const };
      return <details key={id}><summary>{label} 단가·견적 근거</summary><div className="facade-fields">
        <label>{label} 기준 단가 (원/㎡)<input aria-label={`${label} 기준 단가 (원/㎡)`} type="number" min={0} value={rate.baselineWonPerSqm ?? ""} onChange={e => patchRate(id, { baselineWonPerSqm: numeric(e.target.value) })} /></label>
        <label>{label} 선택 단가 (원/㎡)<input aria-label={`${label} 선택 단가 (원/㎡)`} type="number" min={0} value={rate.selectedWonPerSqm ?? ""} onChange={e => patchRate(id, { selectedWonPerSqm: numeric(e.target.value) })} /></label>
        <label>{label} 근거 상태<select aria-label={`${label} 근거 상태`} value={evidence.status} onChange={e => patchRate(id, { evidence: { ...evidence, status: e.target.value as typeof evidence.status } })}><option value="unpriced">단가 미확인</option><option value="user-input">사용자 입력</option><option value="source-backed">견적·자료 근거</option></select></label>
        <label>{label} 출처명<input aria-label={`${label} 출처명`} value={evidence.sourceName ?? ""} onChange={e => patchRate(id, { evidence: { ...evidence, sourceName: e.target.value } })} /></label>
        <label>{label} 기준일<input aria-label={`${label} 기준일`} type="date" value={evidence.observedAt ?? ""} onChange={e => patchRate(id, { evidence: { ...evidence, observedAt: e.target.value } })} /></label>
        <label>{label} 근거 URL<input aria-label={`${label} 근거 URL`} value={evidence.sourceUrl ?? ""} onChange={e => patchRate(id, { evidence: { ...evidence, sourceUrl: e.target.value } })} /></label>
        <label>{label} 포함·제외 범위<input aria-label={`${label} 포함·제외 범위`} value={evidence.note ?? ""} placeholder="예: 자재·시공 포함, 비계·부가세 별도" onChange={e => patchRate(id, { evidence: { ...evidence, note: e.target.value } })} /></label>
      </div></details>;
    })}
    <style jsx>{`.facade-editor { display: grid; gap: 12px; font-size: 12px; } summary { cursor: pointer; font-weight: 650; } .facade-fields { display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 10px; margin-top: 12px; } label { display: grid; gap: 5px; margin: 8px 0; } input,select,button { padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elev); color: var(--fg); max-width: 100%; min-width: 0; }`}</style>
  </div>;
}
