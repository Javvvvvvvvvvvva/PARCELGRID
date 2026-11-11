import type { ReviewSnapshotPayload } from "@/lib/handoff/review-snapshot";
import { quantityCostContractSchema, quantityAdjustmentForBase } from "@/lib/planning/quantity-cost-contract";
import { QUANTITY_COST_SCOPE } from "@/lib/planning/quantity-cost";

const labels = { partitionLengthM: "내부 칸막이", interiorDoorCount: "실간 문", entryDoorCount: "세대 현관문",
  dryFloorAreaSqm: "건식 바닥", wetFloorAreaSqm: "욕실 바닥", kitchenCount: "주방 패키지", bathroomCount: "욕실 패키지" };
const evidence = { assumed: "가정", "user-input": "사용자 입력", quoted: "견적서 입력·진위 미검증" };
const n = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 3 });

export function QuantityCostSummary({ packet }: { packet: ReviewSnapshotPayload | null }) {
  const financial = packet?.data.scenarios.find(s => s.id === packet.representativeScenarioId)?._raw;
  const area = financial?.program.areaContract;
  if (!area?.quantityCostAdjustment) return null;
  const parsed = quantityCostContractSchema.safeParse(area.quantityCostAdjustment);
  if (!parsed.success || !financial) return <p role="alert">저장된 상세 수량 원가 계약의 형식이 올바르지 않습니다.</p>;
  const c = parsed.data;
  const matched = packet?.verification.checks.find(check => check.id === "binding.quantity-cost")?.status === "checked";
  let adjustment: number | null = null;
  try {
    const base = (c.constructionAreas.aboveGroundSqm + c.constructionAreas.basementSqm * Math.max(1, financial.assumptions.basementCostMultiplier ?? 1.25)) * financial.assumptions.constCostPerSqM / 10000;
    adjustment = quantityAdjustmentForBase(c, base);
  } catch { /* The integrated checklist exposes the invalid contract; no zero substitute. */ }
  return <section className="iv-quantity" aria-label="저장 수량·원가 내역">
    <h3>저장 수량·원가 내역</h3>
    <p>{matched ? "원시 평면·원가 계약 일치 · 예비 산출" : "원시 평면·원가 계약 재검토 필요"} · 독립 견적 검산 미완료</p>
    <div className="iv-quantity-table"><table><thead><tr><th>공종·수량</th><th>교체 단가</th><th>기존 포함액</th><th>출처·범위</th></tr></thead>
      <tbody>{c.lines.map(line => <tr key={line.id}>
        <th>{labels[line.id]}<br />{n(line.quantity)} {line.id.endsWith("Sqm") ? "㎡" : line.id.endsWith("Count") ? "개" : "m"}</th>
        <td data-label="교체 단가">{line.treatment === "included" ? "기본단가 포함" : line.unitRateWon === null ? "미확정" : `${n(line.unitRateWon)}원`}</td>
        <td data-label="기존 포함액">{line.treatment === "included" ? "별도 차감 없음" : line.includedAllowanceWon === null ? "미확정" : `${n(line.includedAllowanceWon)}원`}</td>
        <td data-label="출처·범위">{evidence[line.evidenceStatus]} · {line.source}<br />{line.allowanceSource && <>포함액 근거: {line.allowanceSource}<br /></>}{QUANTITY_COST_SCOPE[line.id]}</td>
      </tr>)}</tbody></table></div>
    <p>채택 기준 기본 공사비 {n(c.baseConstructionCostWon)}원 · 교체 견적 {n(c.replacementCostWon)}원 · 기존 포함액 {n(c.allowanceWon)}원</p>
    <p>현재 기본 공사비 기준 증감: {adjustment === null ? "미확정" : `${n(adjustment)}만원`}. 기본 단가 변동 시 교체 공종 포함 비율을 유지하고 나머지 기본 공종만 증감합니다.</p>
    <p>수량과 단가는 실측·확정 견적이 아닙니다. 구조·외벽·공용부·전체 설비·방재 공종은 별도 검토 대상입니다.</p>
  </section>;
}
