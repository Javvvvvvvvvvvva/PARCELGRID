"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { applyLayoutFinance, buildLayoutFinancePreview, undoLayoutFinance } from "@/lib/planning/layout-finance";
import { layoutFinanceBinding, type LayoutFinanceOptions } from "@/lib/planning/layout-finance-state";
import type { PlanningCalculationContext } from "@/lib/planning/scenario-calculator";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningParkingGeometrySnapshot } from "@/lib/planning/planning-parking-geometry";
import type { PlanningScenario } from "@/lib/planning/types";

const number = (value: number, digits = 2) => value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const delta = (a: number, b: number) => (b > a ? "+" : "") + number(b - a);

export function PlanningLayoutFinancePanel({ scenario, geometry, parking, context, locked, getCurrentScenario, onChange }: {
  scenario: PlanningScenario; geometry: PlanningGeometrySnapshot | null; parking: PlanningParkingGeometrySnapshot | null;
  context: PlanningCalculationContext; locked: boolean; getCurrentScenario: () => PlanningScenario | undefined;
  onChange: (patch: Partial<PlanningScenario>) => void;
}) {
  const [basis, setBasis] = useState<LayoutFinanceOptions["areaBasis"]>("unit-clear");
  const [scope, setScope] = useState("all");
  const [confirmedKey, setConfirmedKey] = useState("");
  const [message, setMessage] = useState("");
  const floors = scenario.floorPrograms.filter(f => f.zones.some(z => z.useType === "residential"));
  const options = useMemo(() => ({ areaBasis: basis, floorIds: scenario.floorPrograms.filter(f =>
    f.zones.some(z => z.useType === "residential") && (scope === "all" || scope === f.id)).map(f => f.id) }), [scenario.floorPrograms, basis, scope]);
  const input = useMemo(() => ({ scenario, geometry, context, options }), [scenario, geometry, context, options]);
  const preview = useMemo(() => buildLayoutFinancePreview(input), [input]);
  useEffect(() => { setConfirmedKey(""); }, [preview.sourceKey]);
  const last = scenario.layoutFinanceHistory?.filter(h => !h.revertedAt).at(-1);
  const canUndo = !!last && last.resultKey === layoutFinanceBinding(scenario) && !locked;
  const before = preview.before, after = preview.after;
  const rows: Array<[string, number, number, string]> = before && after ? [
    ["매각 산정 면적", before.metrics.saleableAreaSqm, after.metrics.saleableAreaSqm, "㎡"],
    ["임대 산정 면적", before.metrics.rentableAreaSqm, after.metrics.rentableAreaSqm, "㎡"],
    ["필요 주차 (가정 입력)", before.parking.requiredCars, after.parking.requiredCars, "대"],
    ["제공 주차 (저장값)", before.parking.providedCars, after.parking.providedCars, "대"],
    ["주차 부족", before.parking.shortfallCars, after.parking.shortfallCars, "대"],
    ["공사비 (연면적 단가)", before.economicsPreview.constructionCostManwon, after.economicsPreview.constructionCostManwon, "만원"],
    ["총사업비", before.economicsPreview.totalCostManwon, after.economicsPreview.totalCostManwon, "만원"],
    ["예상 매출·임대가치", before.economicsPreview.expectedRevenueManwon, after.economicsPreview.expectedRevenueManwon, "만원"],
    ["예상 이익", before.economicsPreview.profitManwon, after.economicsPreview.profitManwon, "만원"],
    ["매출 대비 이익률", before.economicsPreview.profitMarginPct, after.economicsPreview.profitMarginPct, "%"],
    ["연간 순영업소득", before.economicsPreview.expectedAnnualNoiManwon, after.economicsPreview.expectedAnnualNoiManwon, "만원"],
  ] : [];
  return <div className="lv-finance">
    <div className="lv-tabs" role="group" aria-label="사업성 면적 기준">
      <button type="button" aria-pressed={basis === "unit-clear"} onClick={() => setBasis("unit-clear")}>세대 유효</button>
      <button type="button" aria-pressed={basis === "room-clear"} onClick={() => setBasis("room-clear")}>상세 실 합계</button>
    </div>
    <label className="lv-field">반영 대상 층<select aria-label="반영 대상 층" value={scope} onChange={e => setScope(e.target.value)}>
      <option value="all">전체 주거층</option>{floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
    </select></label>
    <p className="lv-status" data-state={preview.status === "blocked" ? "conflict" : "review"}>
      {preview.status === "blocked" ? "비교 보류 · 구획 확인 필요" : preview.changed ? "조건부 비교안 · 저장안 반영 전" : "현재 면적과 동일 · 변경 없음"}
    </p>
    {preview.issues.length > 0 && <ul className="lv-issues">{preview.issues.map((issue, i) => <li key={i} data-state="fail">{issue}</li>)}</ul>}
    {before && after && <>
      <div className="lv-table-wrap"><table aria-label="사업성 변경 전후"><thead><tr><th>항목</th><th>저장안</th><th>비교안</th><th>증감</th></tr></thead>
        <tbody>{rows.map(([label, a, b, unit]) => <tr key={label}><th>{label}</th>
          <td><span className="lv-amount">{number(a)}</span> <span className="lv-unit">{unit}</span></td>
          <td><span className="lv-amount">{number(b)}</span> <span className="lv-unit">{unit}</span></td>
          <td><span className="lv-amount">{delta(a, b)}</span> <span className="lv-unit">{unit === "%" ? "%p" : unit}</span></td></tr>)}</tbody>
      </table></div>
      <p className="lv-note">주차 산정: {after.parking.basis.join(" · ")}</p>
      <ul className="lv-issues">{after.parking.warnings.map((note, i) => <li key={i}>{note}</li>)}</ul>
      <p className="lv-note">차량 내부 간섭 없는 후보 {parking?.circulation ? parking.circulation.clearCandidateCount + "개" : "미확보"} · 공식 경계·도로·출입구·보행 동선·허가 미확정</p>
      <details><summary>세대·공용부 면적 내역</summary>
        <div className="lv-table-wrap"><table aria-label="세대 면적 변경"><thead><tr><th>세대</th><th>기존 수익면적</th><th>기존 주차 전용 입력</th><th>가정 유효</th></tr></thead>
          <tbody>{preview.rows.map(r => <tr key={r.unitId}><th>{r.floorLabel} {r.label}<br />{r.model === "sale" ? "매각" : r.model === "lease" ? "임대" : "비수익"}</th>
            <td>{number(r.beforeRevenueSqm)}㎡</td><td>{r.beforeExclusiveSqm == null ? "미입력" : number(r.beforeExclusiveSqm) + "㎡"}</td><td>{number(r.proposedSqm)}㎡</td></tr>)}</tbody>
        </table></div>
        <ul className="lv-issues">{preview.floors.map(f => <li key={f.id}>{f.label}: 총 {number(f.grossSqm)}㎡ 유지 · 공용·벽체 여유 {number(f.commonBeforeSqm)} → {number(f.commonAfterSqm)}㎡ · 도형 공용부 {number(f.geometricCommonSqm)}㎡</li>)}</ul>
      </details>
    </>}
    <ul className="lv-issues">{preview.notes.map(note => <li key={note}>{note}</li>)}</ul>
    <label className="lv-confirm"><input type="checkbox" aria-label="가정 면적 반영 확인" checked={confirmedKey === preview.sourceKey}
      disabled={locked || preview.status !== "ready" || !preview.changed}
      onChange={e => setConfirmedKey(e.target.checked ? preview.sourceKey : "")} />가정 면적·단가 변경 및 미확정 항목 확인</label>
    <div className="lv-actions">
      <button type="button" disabled={locked || preview.status !== "ready" || !preview.changed || confirmedKey !== preview.sourceKey} onClick={() => {
        const current = getCurrentScenario();
        if (!current) { setMessage("계획안이 삭제됐습니다."); return; }
        const applied = applyLayoutFinance({ ...input, scenario: current }, preview.sourceKey, new Date().toISOString());
        if (applied.patch) { onChange(applied.patch); setConfirmedKey(""); setMessage("가정 면적 반영 완료 · 사업성 재계산 · 공식 승인은 미확정"); }
        else setMessage(applied.error ?? "반영하지 못했습니다.");
      }}><Check size={15} />비교안 면적 반영</button>
      <button type="button" disabled={!canUndo} onClick={() => {
        const current = getCurrentScenario();
        if (!current) { setMessage("계획안이 삭제됐습니다."); return; }
        const reverted = undoLayoutFinance(current, new Date().toISOString());
        if (reverted.patch) { onChange(reverted.patch); setConfirmedKey(""); setMessage("직전 면적 반영을 복원했습니다."); }
        else setMessage(reverted.error ?? "복원하지 못했습니다.");
      }}><Undo2 size={15} />직전 반영 되돌리기</button>
    </div>
    {message && <p role="status">{message}</p>}
    {last && !canUndo && !locked && <p className="lv-note">반영 이후 평면·구역·주차가 변경되어 이전 면적 복원을 보류합니다.</p>}
    {!!scenario.layoutFinanceHistory?.length && <details><summary>면적 반영 이력 ({scenario.layoutFinanceHistory.length}/10)</summary>
      <ul className="lv-issues">{[...scenario.layoutFinanceHistory].reverse().map(h => <li key={h.id}>
        {new Date(h.appliedAt).toLocaleString("ko-KR")} · {h.options.areaBasis === "unit-clear" ? "세대 유효" : "상세 실 합계"} ·
        수익면적 {number(h.beforeRevenueAreaSqm)} → {number(h.afterRevenueAreaSqm)}㎡ ·
        {h.revertedAt ? "복원됨" : h === last ? "최근 반영" : "이전 반영"}
      </li>)}</ul>
    </details>}
  </div>;
}
