"use client";

import { Trash2 } from "lucide-react";
import { dwellingSaleBreakdown } from "@/lib/planning/dwelling-pricing";
import type { PlanningDwellingProgram, PlanningScenario, PlanningScenarioCalculation } from "@/lib/planning/types";
import { num, won } from "@/lib/utils/format";
import { DwellingMarketEvidencePanel } from "./DwellingMarketEvidencePanel";

export function DwellingAssumptionsEditor({ scenario, calculation, onChange }: {
  scenario: PlanningScenario;
  calculation: PlanningScenarioCalculation;
  onChange: (dwellingProgram: PlanningDwellingProgram) => void;
}) {
  const profile = scenario.dwellingProgram;
  if (!profile) return null;
  const fallbackPrice = calculation.economicsPreview.residentialFallbackUnitPriceWon ?? calculation.revenueProjection.pricing.pools.residentialSale.unitPriceWon;
  const rows = dwellingSaleBreakdown(scenario, fallbackPrice);
  const groups = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const key = `${row.exclusiveSqm.toFixed(4)}:${row.unitPriceWon}:${row.source}`;
    const existing = groups.get(key);
    groups.set(key, existing ? { ...existing, unitCount: existing.unitCount + row.unitCount, saleAreaSqm: existing.saleAreaSqm + row.saleAreaSqm, revenueManwon: existing.revenueManwon + row.revenueManwon } : row);
  }
  return <section aria-label="세대 구성 비용과 단가" style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14, minWidth: 0, scrollMarginTop: 120 }}>
    <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>세대 구성 비용과 단가</h3>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
      <label style={label}>기본 공사비 포함 세대수<input aria-label="기본 공사비 포함 세대수" type="number" min={0} step={1} value={profile.baselineDwellingCount} style={input} onChange={(e) => {
        const value = e.target.valueAsNumber;
        if (Number.isInteger(value) && value >= 0) onChange({ ...profile, baselineDwellingCount: value, costEvidenceStatus: "user-input" });
      }} /></label>
      <label style={label}>초과 1세대 순증 비용 (만원)<input aria-label="초과 세대 비용 만원" type="number" min={0} step={100} value={profile.additionalDwellingCostWon / 10_000} style={input} onChange={(e) => {
        const value = e.target.valueAsNumber;
        if (Number.isFinite(value) && value >= 0) onChange({ ...profile, additionalDwellingCostWon: value * 10_000, costEvidenceStatus: "user-input" });
      }} /></label>
    </div>
    <label style={{ ...label, marginTop: 10 }}>증설 공사비 근거<input aria-label="증설 공사비 근거" style={input} value={profile.costSource ?? ""} onChange={(e) => onChange({ ...profile, costSource: e.target.value, costEvidenceStatus: "user-input" })} /></label>
    <p style={note}>추가 공사비 {won(calculation.economicsPreview.additionalDwellingCostManwon ?? 0)} · {profile.costEvidenceStatus === "assumed" ? "내부 가정" : "입력 근거 별도 검토"}. 기본 ㎡ 단가에 이미 포함된 주방·욕실·배관 공사비는 중복 제외가 필요합니다. 공용부와 세대 내부 배치는 미검증입니다.</p>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <strong style={{ fontSize: 12 }}>평형별 매각 단가</strong>
      {!profile.salePriceBands?.length ? <button type="button" onClick={() => onChange({ ...profile, salePriceBands: [
        { minExclusiveSqm: 0, maxExclusiveSqm: 30, unitPriceWon: Math.max(1, fallbackPrice), source: "사용자 가정 · 검토 전" },
        { minExclusiveSqm: 30, maxExclusiveSqm: 60, unitPriceWon: Math.max(1, fallbackPrice), source: "사용자 가정 · 검토 전" },
        { minExclusiveSqm: 60, maxExclusiveSqm: null, unitPriceWon: Math.max(1, fallbackPrice), source: "사용자 가정 · 검토 전" },
      ] })}>평형별 단가 설정</button> : <button type="button" title="평형별 단가 해제" aria-label="평형별 단가 해제" onClick={() => onChange({ ...profile, salePriceBands: undefined })}><Trash2 size={16} /></button>}
    </div>
    {profile.salePriceBands?.map((band, index) => <div key={`${band.minExclusiveSqm}-${band.maxExclusiveSqm}`} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 8, marginTop: 10 }}>
      <label style={label}>{band.maxExclusiveSqm != null && band.maxExclusiveSqm - band.minExclusiveSqm < 0.001
        ? `전용 ${num((band.minExclusiveSqm + band.maxExclusiveSqm) / 2, 2)}㎡ 한정${band.marketObservation ? " · 관측 채택" : " · 사용자 수정"}`
        : `${num(band.minExclusiveSqm, 2)}㎡ 이상 ${band.maxExclusiveSqm == null ? "" : `${num(band.maxExclusiveSqm, 2)}㎡ 미만`}`} (만원/㎡)<input type="number" min={0.0001} step="any" value={Number((band.unitPriceWon / 10_000).toFixed(4))} style={input} onChange={(e) => {
        const value = e.target.valueAsNumber;
        if (Number.isFinite(value) && value > 0) onChange({ ...profile, salePriceBands: profile.salePriceBands!.map((b, i) => i === index ? { ...b, unitPriceWon: value * 10_000, marketObservation: undefined, source: "사용자 수정 단가 · 관측 근거 별도 검토" } : b) });
      }} /></label>
      <label style={label}>단가 근거<input style={input} value={band.source} onChange={(e) => {
        if (e.target.value.trim()) onChange({ ...profile, salePriceBands: profile.salePriceBands!.map((b, i) => i === index ? { ...b, source: e.target.value, marketObservation: undefined } : b) });
      }} /></label>
      {band.marketObservation && <details style={{ ...note, gridColumn: "1 / -1", margin: 0 }}><summary>채택 당시 근거 · {band.marketObservation.asOf} · {band.marketObservation.comparables.length}건 / {band.marketObservation.addressCount}주소</summary>
        <div>{band.marketObservation.dongName} · {band.marketObservation.methodVersion} · 관측 채택 가정, 분양가 확정 아님</div>
        <div style={{ maxHeight: 180, overflow: "auto", overflowWrap: "anywhere" }}>{band.marketObservation.comparables.map(comp => <div key={comp.id}>{comp.address} · {comp.date} · 전용 {num(comp.lotArea, 2)}㎡ · {num(comp.priceWon / 10_000, 0)}만원 · {comp.floor}층 · 등기 {comp.registrationDate}</div>)}</div>
      </details>}
    </div>)}
    <div style={{ marginTop: 12, fontSize: 11, lineHeight: 1.7 }}>{[...groups.values()].map((row, index) => <div key={index} style={{ borderBottom: "1px solid var(--border)", padding: "6px 0", overflowWrap: "anywhere" }}>
      {num(row.exclusiveSqm, 2)}㎡ × {row.unitCount}세대 · {num(row.unitPriceWon / 10_000, 1)}만원/㎡ → {won(row.revenueManwon)}<br /><span style={{ color: "var(--fg-muted)" }}>{row.source}</span>
    </div>)}</div>
    <p style={note}>전용면적으로 평형을 구분하고 실제 매각 면적에 최종 단가를 적용합니다. 입력한 평형별 단가는 감정·실거래 검증 완료가 아닙니다. 근거 없는 소형 프리미엄은 자동 적용하지 않습니다.</p>
    <DwellingMarketEvidencePanel scenario={scenario} onChange={onChange} />
  </section>;
}

const label: React.CSSProperties = { display: "grid", gap: 5, fontSize: 11, minWidth: 0 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", minWidth: 0, height: 32, padding: "0 7px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--fg)", fontSize: 12 };
const note: React.CSSProperties = { fontSize: 10, color: "var(--warn-fg)", lineHeight: 1.65 };
