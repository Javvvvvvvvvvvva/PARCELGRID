"use client";

import { useId, useMemo, useState } from "react";
import { planningRingCentroid, planningRingToLocalMeters } from "@/lib/planning/planning-geometry";
import type { ProjectOverviewModel } from "./useProjectOverview";

type Point = { x: number; z: number };
/** SVG camera projection only: consumes the stored polygons without changing
 * coordinates, calculating areas, inferring road widths or building new mass. */
export function ParcelDrawing({ model, onEvidence, compact = false }: {
  model: ProjectOverviewModel; onEvidence: () => void; compact?: boolean;
}) {
  const [view, setView] = useState<"plan" | "axon">("plan");
  const [zoom, setZoom] = useState(1);
  const [showBoundary, setShowBoundary] = useState(true);
  const [showRoads, setShowRoads] = useState(true);
  const titleId = useId();
  const parcel = model.data?.parcel;
  const shape = useMemo(() => {
    if (model.geometry) return { polygon: model.geometry.parcel.polygon, roads: model.geometry.roads };
    const boundary = parcel?.boundary;
    if (!boundary || boundary.length < 3 || boundary.some((p) => !p.every(Number.isFinite))) return null;
    const origin = planningRingCentroid(boundary);
    return {
      polygon: planningRingToLocalMeters(boundary, origin),
      roads: (parcel.roads ?? []).map((road) => ({ name: road.name, points: planningRingToLocalMeters(road.points, origin) })),
    };
  }, [model.geometry, parcel]);
  const floors = model.geometry?.building.aboveGroundFloors ?? [];
  const useAxon = view === "axon" && Boolean(model.geometry);
  const project = (p: Point, height = 0): [number, number] => useAxon
    ? [(p.x - p.z) * Math.sqrt(3) / 2, (p.x + p.z) / 2 - height] : [p.x, p.z];
  const points = (ring: Point[], height = 0) => ring.map((p) => project(p, height).join(",")).join(" ");
  const allPoints = [
    ...(shape?.polygon ?? []).map((p) => project(p)),
    ...(shape?.roads ?? []).flatMap((r) => r.points.map((p) => project(p))),
    ...floors.flatMap((floor) => floor.shape.map((p) => project(p, floor.topHeightM))),
  ];
  const finitePoints = allPoints.filter((p) => p.every(Number.isFinite));
  const xs = finitePoints.map((p) => p[0]); const ys = finitePoints.map((p) => p[1]);
  const minX = xs.length ? Math.min(...xs) : -10; const maxX = xs.length ? Math.max(...xs) : 10;
  const minY = ys.length ? Math.min(...ys) : -10; const maxY = ys.length ? Math.max(...ys) : 10;
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const width = size * 1.8 / zoom; const height = size * 1.2 / zoom;
  const centerX = (minX + maxX) / 2; const centerY = (minY + maxY) / 2;
  const viewBox = `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`;
  return <section className={`pg-drawing${compact ? " pg-drawing-compact" : ""}`} aria-label="저장 좌표 도면">
    <div className="pg-drawing-tools"><div role="group" aria-label="도면 보기">
      <button type="button" aria-pressed={!useAxon} onClick={() => setView("plan")}>평면도</button>
      <button type="button" aria-pressed={useAxon} disabled={!model.geometry} title={!model.geometry ? "검증된 대표 매스가 필요합니다" : undefined} onClick={() => setView("axon")}>대표안 입체도</button>
    </div><span>{model.geometry ? model.geometry.geometryHash : "부지 좌표"}</span></div>
    <div className="pg-canvas">
      {!shape ? <div className="pg-empty"><strong>필지 경계를 확인하세요</strong><p>저장된 경계가 없어 도면을 표시하지 않았습니다.</p></div> : <svg viewBox={viewBox} role="img" aria-labelledby={titleId}>
        <title id={titleId}>{parcel?.address} · {useAxon ? "검증된 대표 매스의 입체 투영도" : "저장된 경계와 도로 중심선의 평면도"}. 측량 도면이 아닙니다.</title>
        {showBoundary && <polygon points={points(shape.polygon)} fill="#e8dfd1" stroke="#a34727" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />}
        {showRoads && shape.roads.map((road, i) => <polyline key={`${road.name}-${i}`} points={points(road.points)} fill="none" stroke="#979b90" strokeWidth="1.1" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />)}
        {floors.map((floor, floorIndex) => <g key={floor.id}>
          <title>{floor.label}</title>
          {useAxon && floor.shape.map((p, index, ring) => {
            const next = ring[(index + 1) % ring.length];
            return <polygon key={index} points={[project(p, floor.baseHeightM), project(next, floor.baseHeightM), project(next, floor.topHeightM), project(p, floor.topHeightM)].map((v) => v.join(",")).join(" ")} fill={index % 2 ? "#d4d6ce" : "#e6e6df"} stroke="#898e80" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />;
          })}
          <polygon points={points(floor.shape, floor.topHeightM)} fill={useAxon ? "#fafaf5" : "none"} stroke={floorIndex === 0 ? "#555f4f" : "#858d7e"} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </g>)}
      </svg>}
      {!useAxon && <span className="pg-north" aria-label="도면 위쪽은 북쪽">↑ N</span>}
      <p className="pg-canvas-note">저장 좌표 도면 · 측량 경계 아님<br />점선: 도로 중심선 · 도로 폭을 뜻하지 않음</p>
      <div className="pg-zoom" role="group" aria-label="도면 확대"><button type="button" aria-label="확대" onClick={() => setZoom((v) => Math.min(v + 0.25, 2.5))}>+</button><button type="button" aria-label="축소" onClick={() => setZoom((v) => Math.max(v - 0.25, 0.5))}>−</button><button type="button" aria-label="기본 배율" onClick={() => setZoom(1)}>↺</button></div>
    </div>
    <div className="pg-drawing-foot"><div><label><input type="checkbox" checked={showBoundary} onChange={(e) => setShowBoundary(e.target.checked)} />필지</label><label><input type="checkbox" checked={showRoads} onChange={(e) => setShowRoads(e.target.checked)} />도로 중심선</label></div><button type="button" onClick={onEvidence}>좌표·검증 근거 ↗</button></div>
  </section>;
}
