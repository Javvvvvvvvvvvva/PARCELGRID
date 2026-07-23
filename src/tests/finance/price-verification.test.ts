import { describe, expect, it } from "vitest";
import {
  buildFinancialSourceFromPriceVerification,
  calculatePriceVerification,
  median,
  validatePriceVerification,
  type PriceComparableSnapshot,
  type PriceVerificationRecord,
} from "@/lib/finance/price-verification";
import {
  buildExpertReviewSummary,
  validateExpertReview,
  type ExpertReviewMap,
  type ExpertReviewRecord,
} from "@/lib/handoff/review-workflow";

const comps: PriceComparableSnapshot[] = [
  { id: "a", address: "A", date: "2026-01-01", type: "단독", lotAreaSqm: 100, pricePerPyeongManwon: 1_000 },
  { id: "b", address: "B", date: "2026-02-01", type: "단독", lotAreaSqm: 110, pricePerPyeongManwon: 1_200 },
  { id: "c", address: "C", date: "2026-03-01", type: "단독", lotAreaSqm: 120, pricePerPyeongManwon: 1_400 },
];

function priceRecord(): PriceVerificationRecord {
  return {
    projectId: "P1",
    target: "acquisition",
    status: "verified",
    selectedComps: comps,
    ...calculatePriceVerification(330.5785, comps, 10),
    adjustmentPct: 10,
    reviewer: "홍길동",
    organization: "검토자",
    rationale: "같은 동·유사 면적 사례를 채택하고 도로 조건을 보정",
    sourceModelVersion: "test",
    verifiedAt: "2026-07-22",
    updatedAt: "2026-07-22T12:00:00.000Z",
  };
}

function expertRecord(
  discipline: ExpertReviewRecord["discipline"]
): ExpertReviewRecord {
  return {
    discipline,
    status: "approved",
    reviewer: "검토자",
    organization: "전문가",
    evidenceRef: `${discipline}-memo.pdf`,
    notes: "검토 범위 내 승인",
    reviewedAt: "2026-07-22",
    updatedAt: "2026-07-22T12:00:00.000Z",
  };
}

describe("price verification", () => {
  it("uses the statistical median and applies a bounded adjustment", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    const result = calculatePriceVerification(330.5785, comps, 10);
    expect(result.medianPricePerPyeongManwon).toBe(1_200);
    expect(result.verifiedPricePerPyeongManwon).toBe(1_320);
    expect(result.verifiedTotalManwon).toBeCloseTo(132_000, 0);
  });

  it("requires at least three cases and a named reviewer", () => {
    const record = { ...priceRecord(), selectedComps: comps.slice(0, 2), reviewer: "" };
    const validation = validatePriceVerification(record);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("turns a verified acquisition review into a Stage 3 source record", () => {
    const source = buildFinancialSourceFromPriceVerification(priceRecord());
    expect(source?.field).toBe("acquisitionPrice");
    expect(source?.sourceKind).toBe("official-api");
    expect(source?.value).toBeGreaterThan(0);
  });
});

describe("expert review workflow", () => {
  it("requires evidence for an approval", () => {
    const validation = validateExpertReview({
      ...expertRecord("architect"),
      evidenceRef: "",
    });
    expect(validation.valid).toBe(false);
  });

  it("opens final reporting only after all four disciplines approve", () => {
    const partial: ExpertReviewMap = {
      architect: expertRecord("architect"),
      developer: expertRecord("developer"),
      "finance-tax": expertRecord("finance-tax"),
    };
    expect(buildExpertReviewSummary(partial).ready).toBe(false);
    const complete: ExpertReviewMap = {
      ...partial,
      "sales-marketing": expertRecord("sales-marketing"),
    };
    const summary = buildExpertReviewSummary(complete);
    expect(summary.ready).toBe(true);
    expect(summary.approvedCount).toBe(4);
  });
});
