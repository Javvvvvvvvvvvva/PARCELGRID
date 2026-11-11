import type { evaluateConstructionQuoteCostComparison } from "@/lib/planning/construction-quote-cost-comparison";

type Comparison = ReturnType<typeof evaluateConstructionQuoteCostComparison>;

const statusLabels: Record<Comparison["status"], string> = {
  ready: "공사비 비교 입력 확인",
  absent: "견적 증빙 없음",
  missing: "비교 근거·범위 미확정",
  stale: "공사비 기준 변경 · 재검토 필요",
  conflict: "공사비 입력 불일치 · 확인 필요",
};

function money(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "미확정";
  return `${signed && value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 원`;
}

export function ConstructionQuoteCostComparison({ comparison }: { comparison: Comparison }) {
  return <section className="lv-quote-cost-comparison" aria-label="전체 공사비 비교" data-status={comparison.status}>
    <div className="lv-quote-heading"><h5>전체 공사비 비교</h5>
      <span className="lv-note">사업비 미반영 · 전문가 승인 미확정</span></div>
    <p className={comparison.status === "conflict" ? "lv-quote-error" : "lv-note"}>{statusLabels[comparison.status]}</p>
    <dl className="lv-quote-metrics">
      <div><dt>기본 공사비 (BASE)</dt><dd>{money(comparison.baseConstructionCostWon)}</dd></div>
      <div><dt>재료비 증감</dt><dd>{money(comparison.materialAdjustmentWon, true)}</dd></div>
      <div><dt>추가 세대 가산비</dt><dd>{money(comparison.additionalDwellingCostWon)}</dd></div>
      <div><dt>상세 수량 원가 증감</dt><dd>{money(comparison.quantityAdjustmentWon, true)}</dd></div>
    </dl>
    <dl className="lv-quote-metrics lv-quote-cost-totals">
      <div><dt>현재 공사비 합계</dt><dd>{money(comparison.currentConstructionCostWon)}</dd></div>
      <div><dt>견적 공사비 합계</dt><dd>{money(comparison.quoteConstructionCostWon)}</dd></div>
      <div><dt>차액 (견적 − 현재)</dt><dd>{money(comparison.differenceWon, true)}</dd></div>
    </dl>
    {comparison.issues.length > 0 && <ul className="lv-issues" aria-label="공사비 비교 확인 사항">
      {comparison.issues.map((issue, index) => <li key={index}>{issue}</li>)}
    </ul>}
    {comparison.scopeNotes.length > 0 && <ul className="lv-note lv-quote-cost-notes" aria-label="공사비 비교 범위">
      {comparison.scopeNotes.map((note, index) => <li key={index}>{note}</li>)}
    </ul>}
  </section>;
}
