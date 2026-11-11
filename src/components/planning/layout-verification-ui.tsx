"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { PlanPoint } from "@/lib/planning/layout-geometry";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";

export function NumberField({ label, value, onChange, min, max, step = 0.1, disabled = false }: {
  label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number; disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const valid = text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max;
  return <label className="lv-field">{label}<input aria-label={label} type="number" value={text} min={min} max={max} step={step} disabled={disabled}
    aria-invalid={!valid} onBlur={() => { if (!valid) setText(String(value)); }}
    onChange={e => {
      setText(e.target.value);
      const n = e.target.valueAsNumber;
      if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
    }} /></label>;
}
export const coordinates = (shape: PlanPoint[]) => shape.map(p => p.x + "," + p.z).join(" ");
export function PlanDrawing({ outline, polygons, label, children }: { outline: PlanPoint[]; polygons?: LocalParcelPolygon[]; label: string; children: ReactNode }) {
  const regions = polygons === undefined ? [{ outer: outline, holes: [] }] : polygons;
  const points = regions.flatMap(part => part.outer);
  if (!points.length) return null;
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
  return <svg role="img" aria-label={label} className="lv-drawing"
    viewBox={[minX - 1, minZ - 1, Math.max(1, maxX - minX) + 2, Math.max(1, maxZ - minZ) + 2].join(" ")}>
    {regions.map((part, index) => <path key={index} d={[part.outer, ...part.holes].filter(ring => ring.length >= 3)
      .map(ring => `M ${ring.map(p => `${p.x},${p.z}`).join(" L ")} Z`).join(" ")}
      fillRule="evenodd" fill="#fafcfc" stroke="#475569" strokeWidth={0.09} />)}
    {children}
  </svg>;
}
