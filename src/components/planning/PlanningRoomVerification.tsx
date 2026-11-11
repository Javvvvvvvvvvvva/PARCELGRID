"use client";

import { useState } from "react";
import { DoorOpen, RefreshCw, Trash2 } from "lucide-react";
import type { FloorProgram } from "@/lib/planning/types";
import type { InteriorDraft } from "@/lib/planning/interior-layout";
import type { PlanPoint } from "@/lib/planning/layout-geometry";
import { assessRoomLayout, generateRoomLayout, reconnectRoomDoors, roomEnvelope } from "@/lib/planning/room-layout";
import { DEFAULT_ROOM_SETTINGS, type RoomDraft, type RoomSettings } from "@/lib/planning/room-layout-schema";
import { pathDoorSegment, pathSpaceShape } from "@/lib/planning/interior-paths";
import { coordinates, NumberField, PlanDrawing } from "./layout-verification-ui";

const colors = { bedroom: "#d7e8f4", living: "#d9eee8", kitchen: "#eee4b8", bathroom: "#d7e7e7", hall: "#e9e9e9" };

function UnitRoomEditor({ floor, unitId, outline, locked, onChange }: {
  floor: FloorProgram; unitId: string; outline?: PlanPoint[]; locked: boolean; onChange: (draft: InteriorDraft) => void;
}) {
  const parent = floor.interiorLayout!;
  const unit = parent.spaces.find(s => s.id === unitId)!;
  const draft = parent.roomLayouts?.find(d => d.unitId === unitId);
  const [settings, setSettings] = useState<RoomSettings>(draft?.settings ?? DEFAULT_ROOM_SETTINGS);
  const [roomId, setRoomId] = useState("");
  const [doorIndex, setDoorIndex] = useState(0);
  const [message, setMessage] = useState("");
  const result = assessRoomLayout(floor, unitId, outline);
  const selected = draft?.spaces.find(s => s.id === roomId) ?? draft?.spaces.find(s => s.kind !== "hall") ?? draft?.spaces[0];
  const route = result.rooms.find(r => r.id === selected?.id);
  const door = draft?.doors[doorIndex] ?? draft?.doors[0];
  const save = (next?: RoomDraft) => onChange({ ...parent, roomLayouts: [
    ...(parent.roomLayouts ?? []).filter(d => d.unitId !== unitId), ...(next ? [next] : []),
  ] });
  const fields: Array<[Exclude<keyof RoomSettings, "bedrooms">, string, number, number]> = [
    ["wallThicknessM", "실내 가정 벽 두께 (m)", 0.05, 0.4], ["hallWidthM", "내부 통로 가정 유효폭 (m)", 0.8, 2],
    ["doorWidthM", "실 출입문 가정 유효폭 (m)", 0.6, 1.2], ["serviceDepthM", "주방·욕실 구획 깊이 (m)", 1.4, 4],
    ["minimumBedroomAreaSqm", "침실 가정 최소면적 (㎡)", 4, 20], ["minimumLivingAreaSqm", "거실 가정 최소면적 (㎡)", 5, 30],
  ];
  return <>
    <div className="lv-fields">
      <label className="lv-field">침실 수<select aria-label="침실 수" value={settings.bedrooms} disabled={locked}
        onChange={e => setSettings(s => ({ ...s, bedrooms: Number(e.target.value) }))}>
        {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n === 0 ? "0 · 거실·취침 통합" : n + "개"}</option>)}</select></label>
      {fields.map(([key, label, min, max]) => <NumberField key={key} label={label} value={settings[key]} min={min} max={max} step={0.05}
        disabled={locked} onChange={n => setSettings(s => ({ ...s, [key]: n }))} />)}
    </div>
    <div className="lv-actions">
      <button type="button" disabled={locked || !outline} onClick={() => {
        if (!outline) return;
        const next = generateRoomLayout(floor, unitId, outline, settings);
        setMessage(next.message);
        if (next.draft) save(next.draft);
      }}><RefreshCw size={15} />상세 구획 생성</button>
      <button type="button" disabled={locked || !draft} onClick={() => { if (draft) save(reconnectRoomDoors(draft)); }}><DoorOpen size={15} />실 출입문 재연결</button>
      <button type="button" title="상세 구획 삭제" aria-label="상세 구획 삭제" disabled={locked || !draft} onClick={() => { save(); setMessage(""); }}><Trash2 size={15} /></button>
    </div>
    {message && <p role="status">{message}</p>}
    <p className="lv-status" data-state={result.status}>{result.status === "preliminary-fit" ? "상세 실·현관 예비 연결 · 승인 미확정" :
      result.status === "conflict" ? "상세 실 구획 충돌" : "상세 실 미검증"}</p>
    <PlanDrawing outline={roomEnvelope(parent, unit)} label={unit.label + " 상세 실 구획도"}>
      {draft?.spaces.map((space, i) => <g key={space.id + i}>
        <polygon points={coordinates(pathSpaceShape(space))} fill={colors[space.kind]} stroke={space.id === selected?.id ? "#136c60" : "#64748b"}
          strokeWidth={space.id === selected?.id ? 0.07 : 0.035} />
        <title>{(i + 1) + " · " + space.label}</title>
        <text x={space.center.x} y={space.center.z} fontSize={space.kind === "hall" ? 0.45 : Math.min(0.45, Math.min(space.widthM, space.depthM) / 3)}
          textAnchor="middle" dominantBaseline="middle" fill="#223a3a">{space.kind === "hall" ? i + 1 : space.label}</text>
      </g>)}
      {draft?.doors.map((d, i) => {
        const s = pathDoorSegment(draft.spaces, d, draft.settings.wallThicknessM);
        return s && <line key={i} x1={s[0].x} y1={s[0].z} x2={s[1].x} y2={s[1].z} stroke="#fff" strokeWidth={0.14} />;
      })}
      {route?.route && <polyline points={coordinates(route.route)} fill="none" stroke="#2154a0" strokeWidth={0.045} strokeDasharray="0.12 0.07" />}
      {result.entryPoint && <circle cx={result.entryPoint.x} cy={result.entryPoint.z} r={0.1} fill="#ad4b32" />}
    </PlanDrawing>
    {selected && draft && <div className="lv-space-editor">
      <label className="lv-field">편집 실<select aria-label="편집 실" value={selected.id} onChange={e => setRoomId(e.target.value)}>
        {draft.spaces.map((s, i) => <option key={s.id} value={s.id}>{i + 1} · {s.label}</option>)}</select></label>
      <div className="lv-fields">{(["x", "z", "widthM", "depthM", "rotationDeg"] as const).map(key => <NumberField key={key}
        label={{ x: "실 중심 X (m)", z: "실 중심 Z (m)", widthM: "실 폭 (m)", depthM: "실 깊이 (m)", rotationDeg: "실 회전 (°)" }[key]}
        value={Number((key === "x" || key === "z" ? selected.center[key] : selected[key]).toFixed(3))}
        min={key === "widthM" || key === "depthM" ? 0.1 : -360} max={key === "widthM" || key === "depthM" ? 100 : 360} disabled={locked}
        onChange={n => save({ ...draft, spaces: draft.spaces.map(s => s.id !== selected.id ? s : key === "x" || key === "z"
          ? { ...s, center: { ...s.center, [key]: n } } : { ...s, [key]: n }) })} />)}</div>
    </div>}
    {door && draft && <div className="lv-space-editor">
      <label className="lv-field">편집 실 출입문<select aria-label="편집 실 출입문" value={draft.doors.indexOf(door)} onChange={e => setDoorIndex(Number(e.target.value))}>
        {draft.doors.map((d, i) => <option key={i} value={i}>{draft.spaces.find(s => s.id === d.from)?.label} ↔ {draft.spaces.find(s => s.id === d.to)?.label}</option>)}</select></label>
      <div className="lv-fields">{(["x", "z", "widthM"] as const).map(key => <NumberField key={key}
        label={{ x: "실 문 중심 X (m)", z: "실 문 중심 Z (m)", widthM: "실 문 유효폭 (m)" }[key]}
        value={Number((key === "widthM" ? door.widthM : door.center[key]).toFixed(3))} min={key === "widthM" ? 0.5 : -360} max={key === "widthM" ? 3 : 360} disabled={locked}
        onChange={n => save({ ...draft, doors: draft.doors.map(d => d !== door ? d : key === "widthM" ? { ...d, widthM: n } : { ...d, center: { ...d.center, [key]: n } }) })} />)}</div>
    </div>}
    {result.rooms.length > 0 && <div className="lv-table-wrap"><table><thead><tr><th>실</th><th>가정 유효면적</th><th>현관 연결</th><th>중심선 후보 길이</th></tr></thead>
      <tbody>{result.rooms.map((r, i) => <tr key={r.id}><th>{i + 1} · {r.label}</th><td>{r.clearAreaSqm.toFixed(2)}㎡</td>
        <td>{r.route ? "연결 후보" : "미연결"}</td><td>{r.candidateDistanceM?.toFixed(2) ?? "—"} m</td></tr>)}</tbody></table></div>}
    <ul className="lv-issues">{result.issues.map((i, n) => <li key={i.code + n} data-state={i.status}>{i.message}</li>)}</ul>
    <p className="lv-note">법정 보행거리·최단경로가 아닙니다. 상세 실 면적은 계획 전용면적·매출에 자동 반영되지 않습니다. 공식 경계·허가·전문가 승인은 미확정입니다.</p>
  </>;
}

export function DetailedRoomEditor({ floor, outline, locked, onChange }: {
  floor: FloorProgram; outline?: PlanPoint[]; locked: boolean; onChange: (draft: InteriorDraft) => void;
}) {
  const [unitId, setUnitId] = useState("");
  const units = floor.interiorLayout?.spaces.filter(s => s.kind === "unit") ?? [];
  const unit = units.find(s => s.id === unitId) ?? units[0];
  if (!unit) return <p>검증할 세대 구획이 없습니다. 상세 실 미검증.</p>;
  return <>
    <label className="lv-field">검증 세대<select aria-label="검증 세대" value={unit.id} onChange={e => setUnitId(e.target.value)}>
      {units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
    <UnitRoomEditor key={unit.id} floor={floor} unitId={unit.id} outline={outline} locked={locked} onChange={onChange} />
  </>;
}
