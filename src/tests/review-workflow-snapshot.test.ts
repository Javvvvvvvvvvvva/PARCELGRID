import { describe, expect, it } from "vitest";
import {
  buildExpertReviewSummary,
  validateExpertReviewTransition,
  validateExpertReview,
  type ExpertReviewMap,
  type ExpertReviewRecord,
} from "@/lib/handoff/review-workflow";
import type { HandoffDiscipline } from "@/lib/handoff/evidence-gate";

const DISCIPLINES: HandoffDiscipline[] = [
  "architect",
  "developer",
  "finance-tax",
  "insurance-risk",
  "sales-marketing",
];

const REVIEWER_ROLE = {
  architect: "architect",
  developer: "developer",
  "finance-tax": "tax-advisor",
  "insurance-risk": "insurance-underwriter",
  "sales-marketing": "sales-marketing",
} as const;

function review(
  discipline: HandoffDiscipline,
  snapshotKey = "PG-REVIEW-CURRENT"
): ExpertReviewRecord {
  return {
    discipline,
    status: "approved",
    reviewer: "검토자",
    organization: "검토기관",
    reviewerRole: REVIEWER_ROLE[discipline],
    requestedBy: "프로젝트 담당자",
    requestedAt: "2026-08-20",
    evidenceRef: `${discipline}-memo.pdf`,
    notes: "현재 저장본 기준 승인",
    reviewedAt: "2026-08-21",
    updatedAt: "2026-08-21T10:00:00.000Z",
    snapshotKey,
    attestations: {
      snapshotReviewed: true,
      evidenceReviewed: true,
      preliminaryLimitAcknowledged: true,
    },
    history: [
      {
        status: "requested",
        actor: "프로젝트 담당자",
        occurredAt: "2026-08-20T09:00:00.000Z",
        snapshotKey,
      },
      {
        status: "in-review",
        actor: "검토자",
        occurredAt: "2026-08-21T09:00:00.000Z",
        snapshotKey,
      },
      {
        status: "approved",
        actor: "검토자",
        occurredAt: "2026-08-21T10:00:00.000Z",
        snapshotKey,
      },
    ],
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
    expect(summary.approvedCount).toBe(5);
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

  it("rejects a reviewer role that cannot approve the discipline", () => {
    const validation = validateExpertReview({
      ...review("insurance-risk"),
      reviewerRole: "architect",
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("보험·리스크");
  });

  it("requires all approval attestations", () => {
    const validation = validateExpertReview({
      ...review("finance-tax"),
      attestations: {
        snapshotReviewed: true,
        evidenceReviewed: false,
        preliminaryLimitAcknowledged: true,
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("근거자료");
  });

  it("enforces request, review, then decision transitions", () => {
    expect(
      validateExpertReviewTransition("not-requested", "approved").valid
    ).toBe(false);
    expect(
      validateExpertReviewTransition("not-requested", "requested").valid
    ).toBe(true);
    expect(
      validateExpertReviewTransition("requested", "in-review").valid
    ).toBe(true);
    expect(
      validateExpertReviewTransition("in-review", "approved").valid
    ).toBe(true);
    expect(
      validateExpertReviewTransition("changes-requested", "approved").valid
    ).toBe(false);
    expect(
      validateExpertReviewTransition("changes-requested", "requested").valid
    ).toBe(true);
  });
});
