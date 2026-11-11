"use client";

import { useState } from "react";
import { DoorOpen, Trash2 } from "lucide-react";
import type { PlanningScenario } from "@/lib/planning/types";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningParkingGeometrySnapshot } from "@/lib/planning/planning-parking-geometry";
import { parkingEgressObstacles } from "@/lib/planning/parking-egress-obstacles";
import { assessEgressCore, DEFAULT_EGRESS_SETTINGS, EGRESS_VERSION, groundExitBasis, groundExitCandidates, type EgressSettings } from "@/lib/planning/egress-core";
import { pathSpaceShape } from "@/lib/planning/interior-paths";
import { coordinates, NumberField, PlanDrawing } from "./layout-verification-ui";

export function EgressCorePanel({ scenario, geometry, parking, locked, onChange }: {
  scenario: PlanningScenario; geometry: PlanningGeometrySnapshot | null; parking: PlanningParkingGeometrySnapshot | null;
  locked: boolean; onChange: (patch: Partial<PlanningScenario>) => void;
}) {
  const plan = scenario.egressPlan ?? { version: EGRESS_VERSION, settings: DEFAULT_EGRESS_SETTINGS };
  const ground = scenario.floorPrograms.find(f => f.level === 1);
  const groundShape = geometry?.building.floors.find(f => f.id === ground?.id)?.shape;
  const candidates = ground && groundShape ? groundExitCandidates(ground, groundShape) : [];
  const savedKey = plan.exit ? plan.exit.spaceId + ":" + plan.exit.edgeIndex : "";
  const [exitKey, setExitKey] = useState(savedKey);
  const selectedExit = candidates.find(c => c.spaceId + ":" + c.edgeIndex === exitKey) ?? candidates[0];
  const [width, setWidth] = useState(plan.exit?.widthM ?? 0.9);
  const [offset, setOffset] = useState(plan.exit?.offsetRatio ?? 0.5);
  const [floorId, setFloorId] = useState("");
  const floor = scenario.floorPrograms.find(f => f.id === floorId) ?? scenario.floorPrograms.find(f => f.level > 1) ?? ground;
  const obstacles = parkingEgressObstacles(parking);
  const result = assessEgressCore({ scenario, floors: geometry?.building.floors, parcelShape: geometry?.parcel.polygon,
    parcelPolygons: geometry?.parcel.polygons, groundObstacles: obstacles });
  const fields: Array<[keyof EgressSettings, string, number, number]> = [
    ["flightWidthM", "계단 가정 유효폭 (m)", 0.8, 2.5], ["treadDepthM", "계단 가정 단너비 (m)", 0.2, 0.4],
    ["maxRiserM", "계단 가정 최대 단높이 (m)", 0.1, 0.25], ["landingDepthM", "계단참 가정 깊이 (m)", 0.8, 2.5],
    ["wellGapM", "두 계단 사이 간격 (m)", 0.1, 1], ["wallThicknessM", "계단실 가정 벽 두께 (m)", 0.1, 0.5],
    ["minimumDoorWidthM", "공용 경로 가정 문 유효폭 (m)", 0.6, 1.5],
  ];
  return <>
    <div className="lv-fields">{fields.map(([key, label, min, max]) => <NumberField key={key} label={label} value={plan.settings[key]}
      min={min} max={max} step={0.01} disabled={locked} onChange={n => onChange({ egressPlan: { ...plan, settings: { ...plan.settings, [key]: n } } })} />)}</div>
    <div className="lv-fields">
      <label className="lv-field">지상 출구 후보<select aria-label="지상 출구 후보" disabled={locked || !candidates.length}
        value={selectedExit ? selectedExit.spaceId + ":" + selectedExit.edgeIndex : ""} onChange={e => setExitKey(e.target.value)}>
        {!candidates.length && <option value="">지상 공용부 외벽 후보 없음</option>}
        {candidates.map(c => <option key={c.spaceId + c.edgeIndex} value={c.spaceId + ":" + c.edgeIndex}>{c.label}</option>)}</select></label>
      <NumberField label="지상 출구 유효폭 (m)" value={width} min={0.6} max={3} step={0.05} disabled={locked} onChange={setWidth} />
      <label className="lv-field">출구 벽면 위치 ({Math.round(offset * 100)}%)<input aria-label="출구 벽면 위치" type="range" min={0} max={1} step={0.01}
        disabled={locked} value={offset} onChange={e => setOffset(Number(e.target.value))} /></label>
    </div>
    <div className="lv-actions">
      <button type="button" disabled={locked || !selectedExit || !ground?.interiorLayout} onClick={() => {
        if (!selectedExit || !ground?.interiorLayout) return;
        onChange({ egressPlan: { ...plan, exit: { floorId: ground.id, spaceId: selectedExit.spaceId, edgeIndex: selectedExit.edgeIndex,
          offsetRatio: offset, widthM: width, layoutBasis: groundExitBasis(ground.interiorLayout) } } });
      }}><DoorOpen size={15} />지상 출구 연결</button>
      <button type="button" title="지상 출구 연결 삭제" aria-label="지상 출구 연결 삭제" disabled={locked || !plan.exit}
        onClick={() => onChange({ egressPlan: { ...plan, exit: undefined } })}><Trash2 size={15} /></button>
    </div>
    <p className="lv-status" data-state={result.status}>{result.status === "preliminary-chain" ? "실→지상 출구 개념 연결 · 법정 적합성·승인 미확정" :
      result.status === "conflict" ? "피난·코어 구획 충돌" : "피난·코어 연결 미검증"}</p>
    <p>출구 연결 후보 층 {result.connectedFloors.length} / {scenario.floorPrograms.length} · 실 연결 후보 {result.routes.length} / {result.checkedRooms}</p>
    {result.links.length > 0 && <div className="lv-table-wrap"><table><thead><tr><th>층간 연결</th><th>예약공간</th><th>단 수·단높이</th><th>후보</th></tr></thead>
      <tbody>{result.links.map((l, i) => <tr key={i}><th>{l.label}</th><td>{l.widthM.toFixed(2)} × {l.depthM.toFixed(2)} m</td>
        <td>{l.risers}단 · {(l.riserHeightM * 1000).toFixed(0)} mm</td><td>{l.status === "fit" ? "공간 수용" : l.status === "conflict" ? "수용 후보 없음" : "미검증"}</td></tr>)}</tbody></table></div>}
    {floor && geometry && <>
      <label className="lv-field">동선 표시 층<select aria-label="동선 표시 층" value={floor.id} onChange={e => setFloorId(e.target.value)}>
        {scenario.floorPrograms.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
      <PlanDrawing outline={geometry.parcel.polygon} polygons={geometry.parcel.polygons} label={floor.label + " 피난·코어 개념 연결도"}>
        <polygon points={coordinates(geometry.building.floors.find(f => f.id === floor.id)?.shape ?? [])} fill="#f2f5f5" stroke="#777" strokeWidth={0.04} />
        {floor.interiorLayout?.spaces.map(s => <polygon key={s.id} points={coordinates(pathSpaceShape(s))}
          fill={s.kind === "core" ? "#f5d7cf" : s.kind === "corridor" ? "#e0e8f5" : "#d9eee8"} stroke="#777" strokeWidth={0.03} />)}
        {floor.interiorLayout?.spaces.filter(s => s.kind !== "unit").map(s => <text key={s.id}
          x={s.center.x} y={s.center.z - 0.35} fontSize={0.5} textAnchor="middle" fill="#223a3a">{s.label}</text>)}
        {floor.level === 1 && obstacles?.map(o => <polygon key={o.id} points={coordinates(o.shape)} fill="#b6bac450" stroke="#858585" strokeWidth={0.03} />)}
        {result.links.filter(l => l.lowerFloorId === floor.id || l.upperFloorId === floor.id).map((l, i) =>
          <polygon key={i} points={coordinates(l.stairShape)} fill="#f1cb9150" stroke="#93641a" strokeWidth={0.08} strokeDasharray="0.18 0.08" />)}
        {result.routes.filter(r => r.floorId === floor.id).map(r => <polyline key={r.unitId + r.roomId} points={coordinates(r.points)}
          fill="none" stroke="#2154a0" strokeWidth={0.04} />)}
        {floor.level === 1 && <polygon points={coordinates(result.exitLanding)} fill="#8bc2ae" stroke="#136c60" strokeWidth={0.07} />}
        {floor.level === 1 && <polyline points={coordinates(result.groundRoute)} fill="none" stroke="#2154a0" strokeWidth={0.06} />}
      </PlanDrawing>
    </>}
    <ul className="lv-issues">{result.issues.map((i, n) => <li key={i.code + n} data-state={i.status}>{i.message}</li>)}</ul>
    <p className="lv-note">치수는 내부 설계 가정입니다. 2개 계단 구간·계단참의 예약공간 검사이며 실제 계단 설계가 아닙니다. 공식 경계·허가·전문가 승인은 미확정입니다.</p>
  </>;
}
