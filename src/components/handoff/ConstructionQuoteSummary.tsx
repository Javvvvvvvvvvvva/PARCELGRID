import type { ReviewSnapshotPayload } from "@/lib/handoff/review-snapshot";
import { constructionQuoteSchema, QUOTE_SCOPE_LABELS } from "@/lib/planning/construction-quote";
import { ConstructionScopeLedgerSummary } from "./ConstructionScopeLedgerSummary";

const money = (value: number | null) => value === null ? "미입력" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
const quantity = (value: number | null) => value === null ? "미입력" : value.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
const vat = { unknown: "미확정", included: "포함", excluded: "별도", exempt: "면세 입력·적용 미검증" };
const coverage = { unknown: "미확정", included: "포함 입력", excluded: "제외·별도 원가 필요", "not-applicable": "해당 없음 입력·실제 적용 미검증" };
const units = { m: "m", m2: "㎡", m3: "㎥", count: "개", lot: "식" };

export function ConstructionQuoteSummary({ packet }: { packet: ReviewSnapshotPayload | null }) {
  const raw = packet?.planningScenario?.constructionQuote;
  if (raw === undefined) return null;
  const parsed = constructionQuoteSchema.safeParse(raw);
  if (!parsed.success) return <p role="alert">저장 견적의 입력 형식이 올바르지 않습니다. 견적 내역을 확인해야 합니다.</p>;
  const quote = parsed.data;
  const checked = packet?.verification.checks.find(check => check.id === "binding.construction-quote")?.status === "checked";
  return <section className="iv-quantity iv-quote" aria-label="저장 견적 대사 내역">
    <h3>저장 견적 대사 내역</h3>
    <p>{checked ? "입력 대사 확인" : "입력 대사 미완료"} · 사업비 미반영 · 원문 진위·전체 실측·전문가 승인 미확정</p>
    <p>문서: {quote.reference || "미입력"} · 발행자: {quote.issuer || "미입력"}<br />대상 주소·공사명: {quote.projectReference || "미입력"}</p>
    <p>발행일 {quote.issuedOn || "미확정"} · 유효기한 {quote.validUntil || "미확정"} · 검토 기준일 {quote.reviewDate || "미확정"}</p>
    <p className="iv-key" aria-label="견적 기준 원문 참조">견적 기준 원문 참조 (sourceBasis): {quote.sourceBasis}</p>
    <p>문서 합계 입력: {money(quote.statedTotalWon)} · 부가세 {vat[quote.vatBasis]} · 기본단가 부가세 {vat[quote.baseVatBasis]}</p>
    <div className="iv-quantity-table"><table aria-label="견적 행 원문 내역">
      <thead><tr><th>항목·수량</th><th>단가</th><th>견적 금액</th><th>원문·범위</th></tr></thead>
      <tbody>{quote.lines.map(line => <tr key={line.id}>
        <th>{line.description || "항목명 미입력"}<br />{line.pricing === "lump-sum" ? "일식 입력" : `${quantity(line.quantity)} ${units[line.unit]}`}</th>
        <td data-label="단가">{line.pricing === "lump-sum" ? "일식" : money(line.unitRateWon)}</td>
        <td data-label="견적 금액">{money(line.amountWon)}<br />부가세 {vat[line.vatBasis]}</td>
        <td data-label="원문·범위">{line.sourceLocator || "원문 참조 미입력"}<br />{line.quantityItemId ? QUOTE_SCOPE_LABELS[line.quantityItemId] : "모델 수량 미연결"}<br />{line.note}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="iv-quantity-table"><table aria-label="견적 공종 포함 범위">
      <thead><tr><th>공종</th><th>입력 상태·견적 행</th><th>원문 범위 근거</th></tr></thead>
      <tbody>{quote.coverage.map(scope => <tr key={scope.id}>
        <th>{QUOTE_SCOPE_LABELS[scope.id]}</th>
        <td data-label="입력 상태·견적 행">{coverage[scope.status]}<br />{scope.lineIds.map(id => quote.lines.find(line => line.id === id)?.description || id).join(" · ") || "행 미연결"}</td>
        <td data-label="원문 범위 근거">{scope.note || "미입력"}</td>
      </tr>)}</tbody>
    </table></div>
    <p>같은 패키지 행은 공종 수와 무관하게 한 번만 합산합니다. 포함·해당 없음은 입력자의 선언이며 실제 공종 누락·겹침, 현장 조건과 전체 물량은 별도 검토 대상입니다. 검토 기준일 이후의 유효성은 재확인이 필요합니다.</p>
    <ConstructionScopeLedgerSummary quote={quote} />
  </section>;
}
