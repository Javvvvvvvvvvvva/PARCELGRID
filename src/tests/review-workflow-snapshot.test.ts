import { describe, expect, it } from "vitest";
import {
  buildExpertReviewSummary,
  validateExpertReview,
  type ExpertReviewMap,
  type ExpertReviewRecord,
} from "@/lib/handoff/review-workflow";
import type { HandoffDiscipline } from "@/lib/handoff/evidence-gate";

const DISCIPLINES: HandoffDiscipline[] = [
  "architect",
  "developer",
  "finance-tax",
  "sales-marketing",
];

function review(
  discipline: HandoffDiscipline,
  snapshotKey = "PG-REVIEW-CURRENT"
): ExpertReviewRecord {
  return {
    discipline,
    status: "approved",
    reviewer: "검토자",
    organization: "검토기관",
    evidenceRef: `${discipline}-memo.pdf`,
    notes: "현재 저장본 기준 승인",
    reviewedAt: "2026-08-21",
    updatedAt: "2026-08-21T10:00:00.000Z",
    snapshotKey,
  };
}

function approvedMap(snapshotKey = "PG-REVIEW-CURRENT"): ExpertReviewMap {
  return Object.fromEntries(
    DISCIPLINES.map((discipline) => [
      discipline,
      review(discipline, snapshotKey),
    ])
  ) as ExpertReviewMap;
}

describe("expert review snapshot binding", () => {
  it("accepts all approvals only for the exact reviewed snapshot", () => {
    const summary = buildExpertReviewSummary(
      approvedMap(),
      "PG-REVIEW-CURRENT"
    );

    expect(summary.ready).toBe(true);
    expect(summary.approvedCount).toBe(4);
    expect(summary.staleDisciplines).toEqual([]);
  });

  it("invalidates every prior approval after the evidence snapshot changes", () => {
    const summary = buildExpertReviewSummary(
      approvedMap(),
      "PG-REVIEW-CHANGED"
    );

    expect(summary.ready).toBe(false);
    expect(summary.approvedCount).toBe(0);
    expect(summary.staleDisciplines).toEqual(DISCIPLINES);
    expect(summary.invalidDisciplines[0]?.errors.join(" ")).toContain(
      "다시 검토"
    );
  });

  it("treats legacy approvals without a snapshot key as stale", () => {
    const legacy = review("architect");
    delete legacy.snapshotKey;

    const validation = validateExpertReview(
      legacy,
      "PG-REVIEW-CURRENT"
    );

    expect(validation.valid).toBe(false);
    expect(validation.stale).toBe(true);
  });
});
