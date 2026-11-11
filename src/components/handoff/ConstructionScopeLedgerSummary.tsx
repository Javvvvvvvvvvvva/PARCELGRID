import {
  buildConstructionScopeLedger, QUOTE_SCOPE_LABELS,
  type ConstructionQuote, type ConstructionScopeLedger,
} from "@/lib/planning/construction-quote";
import "./construction-scope-ledger.css";

const money = (value: number | null) => value === null ? "미확정" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
const statuses: Record<ConstructionScopeLedger["status"], string> = {
  reconciled: "입력 배분 대사 확인", incomplete: "배분 미완료", conflict: "배분 불일치",
};
const scopeStatuses: Record<ConstructionScopeLedger["scopes"][number]["status"], string> = {
  allocated: "배분 확인", missing: "미확정", excluded: "제외·별도 원가 필요",
  "not-applicable": "해당 없음 입력", conflict: "불일치",
};

export function ConstructionScopeLedgerSummary({ quote }: { quote: ConstructionQuote }) {
  const ledger = buildConstructionScopeLedger(quote);
  const rows = new Map(quote.lines.map((line, index) => [line.id, { line, index }]));
  const lineLabel = (id: string) => {
    const row = rows.get(id);
    return row ? `${row.index + 1}행 · ${row.line.description || "항목명 미입력"}` : id;
  };
  const allocations = quote.lines.flatMap(line => (line.allocations ?? []).map(part => ({ line, part })));
  return <section className="cq-ledger" aria-label="공종 원가 배분 대사" data-status={ledger.status}>
    <h4>공종 원가 배분 대사</h4>
    <p className="cq-ledger-status">{statuses[ledger.status]} · 사업비 미반영 · 전문가 승인 미확정</p>
    <dl className="cq-ledger-metrics">
      <div><dt>입력된 행 부분합</dt><dd>{money(ledger.knownAmountWon)}</dd></div>
      <div><dt>배분 확인 금액</dt><dd>{money(ledger.allocatedAmountWon)}</dd></div>
      <div><dt>미배분 금액</dt><dd>{money(ledger.unallocatedAmountWon)}</dd></div>
      <div><dt>공종 대사 완료 합계</dt><dd>{money(ledger.status === "reconciled" ? ledger.totalAmountWon : null)}</dd></div>
    </dl>
    <p>금액 미입력 {ledger.missingAmountLineIds.length}행 · 배분 미확정·불일치 {ledger.unresolvedLineIds.length}행</p>
    <p className="cq-ledger-note">부분합·미배분 금액은 금액이 입력된 행에 한합니다. 미확정·해당 없음은 0원을 뜻하지 않습니다. 부가세 기준이 다르거나 미확정이면 합산하지 않습니다.</p>
    <div className="cq-ledger-table"><table aria-label="공종별 대사 금액">
      <thead><tr><th scope="col">공종</th><th scope="col">배분 상태</th><th scope="col">금액</th><th scope="col">연결 견적 행</th></tr></thead>
      <tbody>{ledger.scopes.map(scope => <tr key={scope.id} data-status={scope.status}>
        <th scope="row">{scope.label}</th>
        <td data-label="배분 상태">{scopeStatuses[scope.status]}</td>
        <td data-label="금액">{money(scope.amountWon)}</td>
        <td data-label="연결 견적 행">{scope.lineIds.map(lineLabel).join(" · ") || "행 미연결"}</td>
      </tr>)}</tbody>
    </table></div>
    {allocations.length > 0 && <div className="cq-ledger-table"><table aria-label="공종 배분 입력 근거">
      <thead><tr><th scope="col">견적 행·원문</th><th scope="col">배분 공종</th><th scope="col">입력 금액</th><th scope="col">배분 원문 근거</th></tr></thead>
      <tbody>{allocations.map(({ line, part }) => <tr key={`${line.id}:${part.scopeId}`}>
        <th scope="row">{lineLabel(line.id)}<br />{line.sourceLocator || "원문 참조 미입력"}</th>
        <td data-label="배분 공종">{QUOTE_SCOPE_LABELS[part.scopeId]}</td>
        <td data-label="입력 금액">{money(part.amountWon)}</td>
        <td data-label="배분 원문 근거">{part.source || "미입력"}</td>
      </tr>)}</tbody>
    </table></div>}
    <p>공종 대사 확인 사항 · {ledger.issues.length}건</p>
    {ledger.issues.length > 0 && <ul className="cq-ledger-issues">{ledger.issues.map((issue, index) =>
      <li key={`${issue.code}:${index}`} data-status={issue.status}>
        <strong>{issue.status === "fail" ? "불일치" : "미확정"}</strong> · {issue.lineId && `${lineLabel(issue.lineId)} · `}{issue.detail}
      </li>)}</ul>}
  </section>;
}
