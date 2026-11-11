"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { SolarAccessResult } from "@/lib/planning/solar-access";
import { createPlanningWorker } from "@/lib/planning/interior/worker-client";
import "./interior.css";

export default function PlanningSolarPanel({ planning }: { planning: PlanningGeometrySnapshot }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(`${new Date().getFullYear()}-12-21`);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(15);
  const [result, setResult] = useState<SolarAccessResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const job = useRef<ReturnType<typeof createPlanningWorker> | null>(null);
  const request = useRef(0);
  useEffect(() => {
    const token = request;
    token.current++; job.current?.terminate(); setBusy(false); setResult(null); setError("");
    return () => { token.current++; job.current?.terminate(); };
  }, [planning.geometryHash, date, startHour, endHour]);
  const run = async () => {
    const id = ++request.current;
    job.current?.terminate(); job.current = createPlanningWorker(); setBusy(true); setResult(null); setError("");
    try {
      const next = await job.current.run(api => api.calculateSolarAccess({ planning, date, startHour, endHour, stepMinutes: 30 }));
      if (id === request.current) setResult(next);
    } catch (failure) { if (id === request.current) setError(failure instanceof Error ? failure.message : "일영 계산을 완료하지 못했습니다."); }
    finally { if (id === request.current) { setBusy(false); job.current = null; } }
  };
  const ring = planning.parcel.polygon;
  const minX = Math.min(...ring.map(p => p.x)), minZ = Math.min(...ring.map(p => p.z));
  const width = Math.max(1, Math.max(...ring.map(p => p.x)) - minX), depth = Math.max(1, Math.max(...ring.map(p => p.z)) - minZ);
  const radius = Math.min(width, depth) / 32;
  const color = (minutes: number, total: number) => {
    const t = Math.min(1, Math.max(0, minutes / total));
    return `rgb(${Math.round(30 + t * 199)},${Math.round(64 + t * 125)},${Math.round(175 - t * 127)})`;
  };
  return <section className="pg-interior" aria-label="예비 일영 분석">
    <div className="pg-interior-heading"><div><h3>예비 일영 분석</h3><p>계획 건물의 그림자가 부지 지면에 미치는 영향</p></div><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "접기" : "일영 분석 열기"}</button></div>
    {open && <>
      <p className="pg-interior-note">현재 계획 매스만 분석합니다. 주변 건물·지형·창 위치·기상은 포함하지 않으며, 실내 채광이나 법정 일조 충족 판정에 사용할 수 없습니다. 한국 표준시, 30분 간격의 중간 시각에서 추정합니다.</p>
      <div className="pg-interior-fields"><label>분석 날짜<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label>시작 시각 (KST)<input type="number" min={0} max={23} value={startHour} onChange={e => setStartHour(Number(e.target.value))} /></label><label>종료 시각 (KST)<input type="number" min={1} max={24} value={endHour} onChange={e => setEndHour(Number(e.target.value))} /></label></div>
      <div className="pg-interior-toolbar"><button type="button" className="pg-interior-primary" disabled={busy || ring.length < 3 || startHour >= endHour || !date} onClick={run}>{busy ? "그림자 계산 중…" : "계획 매스 일영 계산"}</button>{busy && <button type="button" onClick={() => { request.current++; job.current?.terminate(); setBusy(false); setError("계산을 취소했습니다."); }}>취소</button>}</div>
      {error && <p role="status">{error}</p>}
      {result && <><svg className="pg-solar-map" aria-label="외부 지면의 추정 직사광 시간 분포" viewBox={`${minX - radius * 2} ${minZ - radius * 2} ${width + radius * 4} ${depth + radius * 4}`}>
        <polygon points={ring.map(p => `${p.x},${p.z}`).join(" ")} fill="#fff" stroke="#64748b" strokeWidth={radius / 5} />
        {result.points.map((p, i) => <circle key={i} cx={p.x} cy={p.z} r={radius} fill={color(p.sunnyMinutes, result.sampledMinutes)}><title>추정 직사광 {p.sunnyMinutes}분 / {result.sampledMinutes}분</title></circle>)}
        {planning.building.aboveGroundFloors.map(floor => <polygon key={floor.id} points={floor.shape.map(p => `${p.x},${p.z}`).join(" ")} fill="#cbd5e1" fillOpacity={0.6} stroke="#475569" strokeWidth={radius / 5} />)}
      </svg><p className="pg-solar-legend">직사광 0분 <i /> {result.sampledMinutes}분</p><p className="pg-interior-note" role="status">{result.date} · {startHour}–{endHour}시 KST · 외부 지면 {result.points.length}개 지점{result.points.length === 0 ? " — 건물 외부의 표본 지점을 찾지 못했습니다." : " · 회색 영역은 계획 건물입니다."}</p></>}
    </>}
  </section>;
}
