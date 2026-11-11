import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiCapability } from "@/lib/auth/request";
import { JSON_REQUEST_LIMITS, readJsonObject } from "@/lib/http/json-request";
import {
  appendAuditEvent,
  AuditLedgerConflictError,
  AuditLedgerIntegrityError,
  readAuditLedger,
} from "@/lib/audit/audit-ledger";
import {
  buildExpertReviewMapFromAuditEvents,
  prepareReviewTransition,
  reviewAction,
  validateDerivedReviewMap,
} from "@/lib/handoff/server-review-workflow";
import { isServerReviewSnapshotKey } from "@/lib/handoff/review-snapshot";
import { findVerifiedReviewSnapshotEvent, isSealedReviewSnapshotPayload } from "@/lib/handoff/server-review-snapshot";
import { verificationApprovalBlockers } from "@/lib/handoff/integrated-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

const requestSchema = z.object({
  discipline: z.enum([
    "architect",
    "developer",
    "finance-tax",
    "insurance-risk",
    "sales-marketing",
  ]),
  status: z.enum([
    "requested",
    "in-review",
    "approved",
    "changes-requested",
  ]),
  snapshotKey: z
    .string()
    .trim()
    .max(200)
    .refine(isServerReviewSnapshotKey, "서버에서 봉인된 SHA-256 Snapshot Key가 필요합니다."),
  reviewerRole: z
    .enum([
      "architect",
      "developer",
      "cost-manager",
      "project-manager",
      "finance-specialist",
      "accountant",
      "tax-advisor",
      "insurance-underwriter",
      "risk-engineer",
      "sales-marketing",
      "licensed-broker",
    ])
    .optional(),
  evidenceRef: z.string().max(2_000).optional(),
  notes: z.string().max(5_000).optional(),
  attestations: z
    .object({
      snapshotReviewed: z.boolean().optional(),
      evidenceReviewed: z.boolean().optional(),
      preliminaryLimitAcknowledged: z.boolean().optional(),
    })
    .optional(),
});

async function projectReviewLedger(orgId: string, projectId: string) {
  const ledger = await readAuditLedger({ orgId });
  const reviewEvents = ledger.events.filter(
    (event) =>
      event.resourceType === "project-review" && event.resourceId === projectId,
  );
  const reviews = buildExpertReviewMapFromAuditEvents(reviewEvents);
  return { ledger, reviews, reviewEvents };
}

function ledgerResponse(
  value: Awaited<ReturnType<typeof projectReviewLedger>>,
) {
  return {
    reviews: value.reviews,
    ledger: {
      backend: value.ledger.backend,
      integrity: value.ledger.integrity,
      reviewEventCount: value.reviewEvents.length,
    },
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(request, "project.read");
  if (!authorization.ok) return authorization.response;
  const { projectId } = await context.params;
  try {
    const value = await projectReviewLedger(
      authorization.principal.orgId,
      projectId,
    );
    if (!value.ledger.integrity.valid) {
      return NextResponse.json(
        {
          code: "AUDIT_INTEGRITY_FAILED",
          error: "감사 원장의 무결성을 확인하지 못했습니다.",
          details: value.ledger.integrity.errors,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(ledgerResponse(value), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message =
      error instanceof AuditLedgerIntegrityError
        ? error.message
        : "검토 감사 원장을 읽지 못했습니다.";
    return NextResponse.json(
      { code: "AUDIT_LEDGER_UNAVAILABLE", error: message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(request, "project.read");
  if (!authorization.ok) return authorization.response;
  const { projectId } = await context.params;
  const input = await readJsonObject(request, { maxBytes: JSON_REQUEST_LIMITS.reviewEvent });
  if (!input.ok) return input.response;
  const parsed = requestSchema.safeParse(input.value);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "INVALID_REVIEW_EVENT",
        error: "검토 이벤트 입력이 올바르지 않습니다.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  try {
    const before = await projectReviewLedger(
      authorization.principal.orgId,
      projectId,
    );
    if (!before.ledger.integrity.valid) {
      throw new AuditLedgerIntegrityError(
        before.ledger.integrity.errors.join(" "),
      );
    }
    const sealedSnapshot = await findVerifiedReviewSnapshotEvent({
      events: before.ledger.events,
      projectId,
      snapshotKey: parsed.data.snapshotKey,
    });
    if (!sealedSnapshot) {
      return NextResponse.json(
        {
          code: "UNSEALED_REVIEW_SNAPSHOT",
          error:
            "현재 조직의 감사 원장에 존재하는 검증된 Snapshot만 검토할 수 있습니다.",
        },
        { status: 422 },
      );
    }
    const transition = prepareReviewTransition({
      principal: authorization.principal,
      ...parsed.data,
      snapshotSealAuditHash: sealedSnapshot.entryHash,
      current: before.reviews[parsed.data.discipline],
    });
    if (!transition.valid) {
      return NextResponse.json(
        {
          code:
            transition.status === 403
              ? "REVIEW_ROLE_FORBIDDEN"
              : transition.status === 409
                ? "REVIEW_TRANSITION_CONFLICT"
                : "REVIEW_VALIDATION_FAILED",
          error: transition.errors.join(" "),
          details: transition.errors,
        },
        { status: transition.status },
      );
    }

    if (parsed.data.status === "approved") {
      if (!isSealedReviewSnapshotPayload(sealedSnapshot.payload)) {
        throw new AuditLedgerIntegrityError("검토 봉인 본문을 확인할 수 없습니다.");
      }
      const blockers = verificationApprovalBlockers(
        sealedSnapshot.payload.snapshot.verification,
        parsed.data.discipline,
      );
      if (blockers.length > 0) {
        return NextResponse.json({
          code: "REVIEW_INTEGRATED_VERIFICATION_BLOCKED",
          error: "해당 분야의 통합 검증 누락·충돌을 보완한 뒤 새 저장본으로 검토해야 합니다.",
          details: blockers.map((check) => `${check.label}: ${check.detail}`),
        }, { status: 422, headers: { "Cache-Control": "no-store" } });
      }
    }

    await appendAuditEvent({
      principal: authorization.principal,
      action: reviewAction(parsed.data.status),
      resourceType: "project-review",
      resourceId: projectId,
      payload: transition.payload,
      expectedPreviousHash: before.ledger.integrity.lastHash,
    });
    const after = await projectReviewLedger(
      authorization.principal.orgId,
      projectId,
    );
    const derivedErrors = validateDerivedReviewMap(after.reviews);
    if (!after.ledger.integrity.valid || derivedErrors.length > 0) {
      throw new AuditLedgerIntegrityError(
        [...after.ledger.integrity.errors, ...derivedErrors].join(" "),
      );
    }
    return NextResponse.json(ledgerResponse(after), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AuditLedgerConflictError) {
      return NextResponse.json(
        {
          code: "AUDIT_WRITE_CONFLICT",
          error: "다른 검토 이벤트가 먼저 기록됐습니다. 최신 상태를 다시 불러오세요.",
        },
        { status: 409 },
      );
    }
    const message =
      error instanceof AuditLedgerIntegrityError
        ? error.message
        : "검토 이벤트를 감사 원장에 기록하지 못했습니다.";
    console.error("review audit append failed", error);
    return NextResponse.json(
      { code: "AUDIT_WRITE_FAILED", error: message },
      { status: 503 },
    );
  }
}
