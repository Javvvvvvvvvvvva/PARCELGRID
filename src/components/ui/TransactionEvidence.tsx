import { MOLIT_ISSUE_LABELS, transactionEvidenceMessage, type MolitRangeEvidence } from "@/lib/integrations/molit-evidence";

export function TransactionEvidence({ evidence }: { evidence?: MolitRangeEvidence[] }) {
  return <aside aria-label="실거래 조회 근거" style={{ padding: "10px 14px", border: "1px solid var(--border)", fontSize: 11, lineHeight: 1.6 }}>
    <strong>{transactionEvidenceMessage(evidence)}</strong>
    {evidence?.map((item, index) => <div key={`${item.type}-${index}`}>
      {item.type} · {item.startYearMonth}~{item.endYearMonth} · 집계 시각 {item.retrievedAt}
      {Boolean(item.sourceRetrievals?.length) && <span> · 원문 수신 {item.sourceRetrievals!.map(source => source.oldestFetchedAt).sort()[0]}~{item.sourceRetrievals!.map(source => source.newestFetchedAt).sort().at(-1)} (캐시 포함)</span>}
      {item.failedMonths.length > 0 && <span> · 미확인: {item.failedMonths.map(failure => `${failure.month} ${MOLIT_ISSUE_LABELS[failure.issue]}`).join(", ")}</span>}
    </div>)}
  </aside>;
}
