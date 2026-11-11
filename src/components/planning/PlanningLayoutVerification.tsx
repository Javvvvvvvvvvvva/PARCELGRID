"use client";

import { useState } from "react";
import { Car, DoorOpen, RefreshCw, Trash2, BedDouble, Footprints, Calculator, ListChecks, Receipt } from "lucide-react";
import type { PlanningCalculationContext } from "@/lib/planning/scenario-calculator";
import { PlanningLayoutFinancePanel } from "./PlanningLayoutFinancePanel";
import { PlanningQuantityCostPanel } from "./PlanningQuantityCostPanel";
import { PlanningConstructionQuotePanel } from "./PlanningConstructionQuotePanel";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningParkingGeometrySnapshot } from "@/lib/planning/planning-parking-geometry";
import { parkingGeometryParts } from "@/lib/planning/parking-geometry-parts";
import type { FloorProgram, PlanningScenario } from "@/lib/planning/types";
import {
  assessInteriorLayout, DEFAULT_INTERIOR_SETTINGS, generateInteriorDraft, interiorDoorSegment,
  interiorSpacePolygon, reconnectInteriorDoors, type InteriorDraft, type InteriorSettings,
} from "@/lib/planning/interior-layout";
import { DEFAULT_VEHICLE_PROFILE, vehicleFootprint, type VehicleProfile } from "@/lib/planning/vehicle-circulation";
import type { PlanPoint } from "@/lib/planning/layout-geometry";
import { isPlanningGeometryLocked } from "@/lib/planning/geometry-source";
import { NumberField, PlanDrawing, coordinates } from "./layout-verification-ui";
import { DetailedRoomEditor } from "./PlanningRoomVerification";
import { EgressCorePanel } from "./PlanningEgressVerification";
import { PlanningInteriorAutomation } from "./PlanningInteriorAutomation";
import "./layout-verification.css";

function InteriorEditor({ floor, outline, locked, onChange }: {
  floor: FloorProgram; outline?: PlanPoint[]; locked: boolean; onChange: (draft: InteriorDraft | undefined) => void;
}) {
  const [settings, setSettings] = useState<InteriorSettings>(floor.interiorLayout?.settings ?? DEFAULT_INTERIOR_SETTINGS);
  const [message, setMessage] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const draft = floor.interiorLayout;
  const assessment = assessInteriorLayout(floor, outline);
  const selectedSpace = draft?.spaces.find(s => s.id === spaceId) ?? draft?.spaces[0];
  const fields: Array<[keyof InteriorSettings, string, number, number]> = [
    ["wallThicknessM", "가정 벽 두께 (m)", 0.05, 0.6], ["corridorWidthM", "복도 최소 유효폭 (m)", 0.8, 4],
    ["coreWidthM", "코어 폭 (m)", 2, 8], ["coreDepthM", "코어 깊이 (m)", 2, 8],
    ["doorWidthM", "출입문 유효폭 (m)", 0.6, 1.5], ["minimumUnitWidthM", "세대 최소 유효폭 (m)", 1.5, 8],
  ];
  return <>
    <div className="lv-fields">{fields.map(([key, label, min, max]) => <NumberField key={key} label={label} min={min} max={max}
      step={0.05} value={settings[key]} disabled={locked} onChange={n => setSettings(s => ({ ...s, [key]: n }))} />)}</div>
    <div className="lv-actions">
      <button type="button" disabled={locked || !outline} onClick={() => {
        if (!outline) return;
        const next = generateInteriorDraft(floor, outline, settings);
        setMessage(next.message);
        if (next.draft) onChange(next.draft);
      }}><RefreshCw size={15} />구획 후보 생성</button>
      <button type="button" disabled={locked || !draft} onClick={() => { if (draft) onChange(reconnectInteriorDoors(draft)); }}><DoorOpen size={15} />문 재연결</button>
      <button type="button" title="실내 구획 삭제" aria-label="실내 구획 삭제" disabled={locked || !draft} onClick={() => { onChange(undefined); setMessage(""); }}><Trash2 size={15} /></button>
    </div>
    {message && <p role="status">{message}</p>}
    <p className="lv-status" data-state={assessment.status}>{assessment.status === "preliminary-fit" ? "구획 예비 확인 · 상세 설계·승인 미확정" :
      assessment.status === "conflict" ? "저장 구획에 충돌 있음" : "실내 구획 미검증"}</p>
    {outline && <PlanDrawing outline={outline} label={`${floor.label} 실내 구획도`}>
      {draft?.spaces.map((space, i) => <g key={`${space.id}-${i}`}>
        <polygon points={coordinates(interiorSpacePolygon(space))} fill={space.kind === "unit" ? "#d9eee8" : space.kind === "core" ? "#f5d7cf" : "#e0e8f5"}
          stroke={space.id === selectedSpace?.id ? "#136c60" : "#64748b"} strokeWidth={space.id === selectedSpace?.id ? 0.1 : 0.04} />
        <text x={space.center.x} y={space.center.z} fontSize={0.45} textAnchor="middle" dominantBaseline="middle" fill="#223a3a">{space.kind === "unit" ? `세대 ${draft.spaces.filter(s => s.kind === "unit").indexOf(space) + 1}` : space.label}</text>
      </g>)}
      {draft?.doors.map((door, i) => {
        const segment = interiorDoorSegment(draft, door);
        return segment && <line key={i} x1={segment[0].x} y1={segment[0].z} x2={segment[1].x} y2={segment[1].z} stroke="#fff" strokeWidth={0.18} />;
      })}
    </PlanDrawing>}
    {!outline && <p>층 외곽 좌표가 없습니다. 임의의 경계를 생성하지 않습니다.</p>}
    {draft && selectedSpace && <div className="lv-space-editor">
      <label className="lv-field">편집 공간<select value={selectedSpace.id} onChange={e => setSpaceId(e.target.value)} aria-label="편집 공간">
        {draft.spaces.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <div className="lv-fields">{(["x", "z", "widthM", "depthM", "rotationDeg"] as const).map(key => <NumberField key={key}
        label={{ x: "중심 X (m)", z: "중심 Z (m)", widthM: "공간 폭 (m)", depthM: "공간 깊이 (m)", rotationDeg: "공간 회전 (°)" }[key]}
        min={key === "widthM" || key === "depthM" ? 0.1 : -360} max={360} disabled={locked}
        value={key === "x" || key === "z" ? Number(selectedSpace.center[key].toFixed(3)) : Number(selectedSpace[key].toFixed(3))}
        onChange={n => onChange({ ...draft, spaces: draft.spaces.map(s => s.id !== selectedSpace.id ? s :
          key === "x" || key === "z" ? { ...s, center: { ...s.center, [key]: n } } : { ...s, [key]: n }) })} />)}</div>
    </div>}
    {assessment.units.length > 0 && <div className="lv-table-wrap"><table><thead><tr><th>세대</th><th>계획 전용</th><th>가정 유효</th><th>공용부 연결</th></tr></thead>
      <tbody>{assessment.units.map(u => <tr key={u.id}><th>{u.label}</th><td>{u.targetAreaSqm.toFixed(2)}㎡</td><td>{u.clearAreaSqm.toFixed(2)}㎡</td><td>{u.connected ? "연결" : "미연결"}</td></tr>)}</tbody></table></div>}
    <ul className="lv-issues">{assessment.issues.map((issue, i) => <li key={`${issue.code}-${i}`} data-state={issue.status}>{issue.message}</li>)}</ul>
    <p className="lv-note">설정 치수는 설계 가정입니다. 구획 편집은 사업성·전용면적 입력을 자동 변경하지 않습니다.</p>
  </>;
}

function VehicleEditor({ scenario, geometry, parking, locked, onChange }: {
  scenario: PlanningScenario; geometry: PlanningGeometrySnapshot | null;
  parking: PlanningParkingGeometrySnapshot | null; locked: boolean; onChange: (patch: Partial<PlanningScenario>) => void;
}) {
  const [stallId, setStallId] = useState("");
  const profile = scenario.parking.vehicleProfile ?? DEFAULT_VEHICLE_PROFILE;
  const result = parking?.circulation;
  const parts = parking ? parkingGeometryParts(parking.layout) : [];
  const stallNumbers = new Map(parking?.layout.stalls.map((stall, index) => [stall.id, index + 1]));
  const route = result?.stalls.find(s => s.stallId === stallId) ?? result?.stalls[0];
  const fields: Array<[keyof VehicleProfile, string, number, number]> = [
    ["widthM", "차폭 (m)", 1.4, 2.6], ["lengthM", "차량 길이 (m)", 3, 7],
    ["wheelbaseM", "축간 거리 (m)", 1.8, 4.5], ["rearOverhangM", "후방 오버행 (m)", 0.3, 1.8],
    ["minRearAxleRadiusM", "후륜축 회전반경 (m)", 3, 12], ["clearanceM", "차체 여유폭 (m)", 0.05, 1],
    ["columnWidthM", "가정 기둥 폭 (m)", 0.2, 1.2],
  ];
  return <>
    <div className="lv-fields">{fields.map(([key, label, min, max]) => <NumberField key={key} label={label} value={profile[key]}
      min={min} max={max} step={0.05} disabled={locked} onChange={n => onChange({ parking: { ...scenario.parking, vehicleProfile: { ...profile, [key]: n } } })} />)}</div>
    {parts.some(part => part.accessMode === "internal-aisle") && <label className="lv-field">가정 진입 위치 ({Math.round((scenario.parking.entryOffsetRatio ?? 0.5) * 100)}%)
      <input type="range" aria-label="가정 진입 위치" min={0} max={1} step={0.05} disabled={locked} value={scenario.parking.entryOffsetRatio ?? 0.5}
        onChange={e => onChange({ parking: { ...scenario.parking, entryOffsetRatio: Number(e.target.value) } })} /></label>}
    <p className="lv-status">{result ? `내부 간섭 없는 후보 ${result.clearCandidateCount} / 검사 ${result.stalls.length}개 · 승인 미확정` : "경계·도로 접면 자료 부족 · 동선 미검증"}</p>
    {result && result.uncheckedStalls > 0 && <p>미검사 주차면 {result.uncheckedStalls}개</p>}
    {route && <label className="lv-field">검사 주차면<select aria-label="검사 주차면" value={route.stallId} onChange={e => setStallId(e.target.value)}>
      {result?.stalls.map((s, i) => <option key={s.stallId} value={s.stallId}>{i + 1}번 · {s.status === "clear-candidate" ? "내부 간섭 없음" : s.status === "conflict" ? "후보 간섭" : "후보 미확보"}</option>)}</select></label>}
    {geometry && <PlanDrawing outline={geometry.parcel.polygon} polygons={geometry.parcel.polygons} label="차량 후보 회전궤적">
      {parts.map(part => <g key={part.id}><polygon points={coordinates(part.exclusionShape)} fill="#ddd" />
        <polygon points={coordinates(part.coreShape)} fill="#edc6bc" />
        <polygon points={coordinates(part.aisleShape)} fill="#e3e9ee" />
        {part.stalls.map(stall => <g key={stall.id}><polygon points={coordinates(stall.corners)} fill="#e1eee9" stroke="#498878" strokeWidth={0.04} />
          <text x={stall.center.x} y={stall.center.z} fontSize={0.35} textAnchor="middle">{stallNumbers.get(stall.id)}</text></g>)}
        {part.columns.map((c, i) => <rect key={i} x={c.x - profile.columnWidthM / 2} y={c.z - profile.columnWidthM / 2} width={profile.columnWidthM} height={profile.columnWidthM} fill="#ad5e50" />)}</g>)}
      {route?.sweptAreas.map((area, i) => <polygon key={i} points={coordinates(area)} fill={route.status === "clear-candidate" ? "#2a9c8020" : "#d65e4e20"} />)}
      {route && <polyline points={coordinates(route.poses.map(p => p.rearAxle))} fill="none" stroke="#2154a0" strokeWidth={0.08} />}
      {route?.poses.length && result?.profile ? <polygon points={coordinates(vehicleFootprint(route.poses.at(-1)!, result.profile))} fill="none" stroke="#2154a0" strokeWidth={0.09} /> : null}
    </PlanDrawing>}
    {route && <p role="status">{route.reason}</p>}
    <ul className="lv-issues">{(result?.limitations ?? ["공식 경계·도로 유효폭·출입구·실측 기둥·보행 동선·허가·전문가 승인은 미확정입니다."]).map(note => <li key={note}>{note}</li>)}</ul>
  </>;
}

export function PlanningLayoutVerification({ scenario, geometry, parking, calculationContext, getCurrentScenario, onChange }: {
  scenario: PlanningScenario; geometry: PlanningGeometrySnapshot | null; parking: PlanningParkingGeometrySnapshot | null;
  calculationContext: PlanningCalculationContext | null; getCurrentScenario: () => PlanningScenario | undefined;
  onChange: (patch: Partial<PlanningScenario>) => void;
}) {
  const [tab, setTab] = useState<"interior" | "rooms" | "egress" | "vehicle" | "finance" | "quantity" | "quote">("interior");
  const [quoteOpened, setQuoteOpened] = useState(false);
  const [floorId, setFloorId] = useState("");
  const floors = scenario.floorPrograms.filter(f => f.zones.some(z => z.useType === "residential") ||
    (tab === "interior" && f.level === 1 && f.zones.some(z => z.useType === "common")));
  const floor = floors.find(f => f.id === floorId) ?? floors.find(f => f.zones.some(z => z.useType === "residential")) ?? floors[0];
  const outline = geometry?.building.floors.find(f => f.id === floor?.id)?.shape;
  const locked = isPlanningGeometryLocked(scenario);
  return <section className="layout-verification" aria-label="실내·차량 동선 예비 검증">
    <h3>실내·차량 동선 예비 검증</h3>
    <PlanningInteriorAutomation scenario={scenario} geometry={geometry} parking={parking} onChange={onChange} />
    <div className="lv-tabs" role="tablist" aria-label="검증 종류">
      <button role="tab" type="button" aria-selected={tab === "interior"} onClick={() => setTab("interior")}><DoorOpen size={16} />실내 구획</button>
      <button role="tab" type="button" aria-selected={tab === "rooms"} onClick={() => setTab("rooms")}><BedDouble size={16} />상세 실</button>
      <button role="tab" type="button" aria-selected={tab === "egress"} onClick={() => setTab("egress")}><Footprints size={16} />피난·코어</button>
      <button role="tab" type="button" aria-selected={tab === "vehicle"} onClick={() => setTab("vehicle")}><Car size={16} />차량 동선</button>
      <button role="tab" type="button" aria-selected={tab === "finance"} onClick={() => setTab("finance")}><Calculator size={16} />사업성 연결</button>
      <button role="tab" type="button" aria-label="수량·원가" aria-selected={tab === "quantity"} onClick={() => setTab("quantity")}><ListChecks size={16} aria-hidden="true" />수량·원가</button>
      <button role="tab" type="button" aria-label="견적 대사" aria-selected={tab === "quote"} onClick={() => { setQuoteOpened(true); setTab("quote"); }}><Receipt size={16} aria-hidden="true" />견적 대사</button>
    </div>
    {locked && <p>대표 형상 잠금 상태 · 편집 불가</p>}
    <div role="tabpanel" hidden={tab === "quote"} aria-label={{ interior: "실내 구획", rooms: "상세 실", egress: "피난·코어", vehicle: "차량 동선", finance: "사업성 연결", quantity: "수량·원가", quote: "견적 대사" }[tab]}>
      {tab === "interior" || tab === "rooms" ? <>
        {floor ? <><label className="lv-field">검증 층<select aria-label="검증 층" value={floor.id} onChange={e => setFloorId(e.target.value)}>
          {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
          {tab === "interior" ? <InteriorEditor key={`${scenario.id}:${floor.id}`} floor={floor} outline={outline} locked={locked}
            onChange={draft => onChange({ floorPrograms: scenario.floorPrograms.map(f => f.id === floor.id ? { ...f, interiorLayout: draft } : f) })} />
            : <DetailedRoomEditor key={`${scenario.id}:${floor.id}`} floor={floor} outline={outline} locked={locked}
              onChange={draft => onChange({ floorPrograms: scenario.floorPrograms.map(f => f.id === floor.id ? { ...f, interiorLayout: draft } : f) })} />}</> : <p>검증할 층이 없습니다.</p>}
      </> : tab === "finance" ? calculationContext ? <PlanningLayoutFinancePanel key={scenario.id} scenario={scenario} geometry={geometry}
        parking={parking} context={calculationContext} locked={locked} getCurrentScenario={getCurrentScenario} onChange={onChange} /> : <p>사업성 계산 가정이 없습니다.</p>
        : tab === "quantity" ? calculationContext ? <PlanningQuantityCostPanel key={`${scenario.projectId}:${scenario.id}`} scenario={scenario} geometry={geometry}
          context={calculationContext} locked={locked} getCurrentScenario={getCurrentScenario} onChange={onChange} /> : <p>수량 원가 계산 가정이 없습니다.</p>
        : tab === "quote" ? null : tab === "egress" ? <EgressCorePanel key={scenario.id} scenario={scenario} geometry={geometry} parking={parking} locked={locked} onChange={onChange} />
        : <VehicleEditor key={scenario.id} scenario={scenario} geometry={geometry} parking={parking} locked={locked} onChange={onChange} />}
    </div>
    {quoteOpened && <div role="tabpanel" aria-label="견적 대사" hidden={tab !== "quote"}>
      {calculationContext ? <PlanningConstructionQuotePanel scenario={scenario} geometry={geometry ?? undefined} context={calculationContext} inputs={{
        constructionCostPerSqmWon: calculationContext.assumptions.constructionCostPerSqmWon,
        basementCostMultiplier: calculationContext.assumptions.basementCostMultiplier,
      }} locked={locked} getCurrentScenario={getCurrentScenario} onChange={onChange} /> : <p>견적 대사에 필요한 기본 공사비 가정이 없습니다.</p>}
    </div>}
  </section>;
}
