import type { PlanningMaterialCostAdjustment } from "@/lib/planning/materials";
import { PLANNING_FACADE_LABELS } from "@/lib/planning/materials";

const n = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
export function FacadeCostSummary({ cost }: { cost?: PlanningMaterialCostAdjustment }) {
  if (!cost) return <p>외벽 수량·재료 계약 없음 · 계획안을 재계산하고 사업성을 다시 저장하세요.</p>;
  return <section aria-label="외벽 수량과 비용" style={{ fontSize: 12, lineHeight: 1.6 }}>
    <strong>{cost.areaNote}</strong>
    <p>외벽 총면적 {n(cost.quantities.grossFacadeAreaSqm)}㎡ − 개구부 {n(cost.quantities.openingAreaSqm)}㎡ = 순면적 {n(cost.facadeAreaSqm)}㎡</p>
    <p>수량 제외 {n(cost.quantities.excludedAreaSqm)}㎡ · 경계 미확정 {n(cost.quantities.unresolvedAreaSqm)}㎡ · 단가 미산정 {n(cost.unpricedAreaSqm)}㎡</p>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
      <caption style={{ textAlign: "left" }}>재료별 수량·증감 · {cost.pricingMode === "assembly" ? "전체 조합 공통 단가" : "재료별 단가"}</caption>
      <thead><tr>{["재료", "면적(㎡)", "기준(원/㎡)", "선택(원/㎡)", "증감(만원)", "출처·기준일·범위"].map(label => <th key={label} style={{ textAlign: "left", padding: 6 }}>{label}</th>)}</tr></thead>
      <tbody>{cost.rows.map(row => <tr key={row.material}>
        <td>{PLANNING_FACADE_LABELS[row.material]}</td><td>{n(row.areaSqm)}</td><td>{row.baselineWonPerSqm == null ? "미입력" : n(row.baselineWonPerSqm)}</td>
        <td>{row.selectedWonPerSqm == null ? "미입력" : n(row.selectedWonPerSqm)}</td><td>{row.adjustmentWon == null ? "미산정" : n(row.adjustmentWon / 10000)}</td>
        <td style={{ maxWidth: 250, overflowWrap: "anywhere" }}>{row.evidence.sourceName || "출처 미기재"} · {row.evidence.observedAt || "기준일 미기재"}<br />{row.evidence.note || "공종·포함/제외 범위 미기재"}{row.evidence.sourceUrl && <div>{row.evidence.sourceUrl}</div>}</td>
      </tr>)}</tbody>
    </table></div>
    <p><strong>공사비 반영 증감: {cost.hasPricedArea ? `${n(cost.adjustmentManwon)}만원${cost.priced ? "" : " (일부만 산정)"}` : "미산정"}</strong> · 기준 공사비에 포함된 외벽 비용의 차액만 반영</p>
    <details><summary>산출 범위와 검토 항목</summary><ul>{cost.quantities.notes.map(note => <li key={note}>{note}</li>)}</ul></details>
    <p style={{ fontSize: 10, overflowWrap: "anywhere", color: "var(--fg-muted)" }}>수량 {cost.quantities.version} / {cost.quantities.quantityKey} · 재료·단가 {cost.version} / {cost.costKey}<br />형상 {cost.quantities.geometryHash ?? "직접 입력 또는 구형 추정"}</p>
  </section>;
}
