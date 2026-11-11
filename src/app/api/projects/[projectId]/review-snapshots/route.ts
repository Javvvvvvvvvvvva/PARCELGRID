import { NextRequest, NextResponse } from "next/server";
import {
  appendAuditEvent,
  AuditLedgerConflictError,
  AuditLedgerIntegrityError,
  readAuditLedger,
  type AuditLedgerReadResult,
} from "@/lib/audit/audit-ledger";
import { requireApiCapability } from "@/lib/auth/request";
import { readJsonObject } from "@/lib/http/json-request";
import { isServerReviewSnapshotKey } from "@/lib/handoff/review-snapshot";
import {
  findVerifiedReviewSnapshotEvent,
  MAX_REVIEW_SNAPSHOT_BYTES,
  prepareReviewSnapshotSeal,
  REVIEW_SNAPSHOT_RESOURCE_TYPE,
  REVIEW_SNAPSHOT_SEALED_ACTION,
  sealedReviewSnapshotMetadata,
} from "@/lib/handoff/server-review-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

function responseBody(
  event: NonNullable<
    Awaited<ReturnType<typeof findVerifiedReviewSnapshotEvent>>
  >,
  ledger: AuditLedgerReadResult,
) {
  return {
    ...sealedReviewSnapshotMetadata(event),
    ledger: {
      backend: ledger.backend,
      integrity: ledger.integrity,
    },
  };
}

async function ledgerFor(orgId: string) {
  return readAuditLedger({ orgId });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(request, "project.read");
  if (!authorization.ok) return authorization.response;
  const { projectId } = await context.params;
  const snapshotKey = request.nextUrl.searchParams.get("snapshotKey") ?? "";
  if (!isServerReviewSnapshotKey(snapshotKey)) {
    return NextResponse.json(
      {
        code: "INVALID_REVIEW_SNAPSHOT_KEY",
        error: "유효한 서버 검토 Snapshot Key가 필요합니다.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const ledger = await ledgerFor(authorization.principal.orgId);
    const event = await findVerifiedReviewSnapshotEvent({
      events: ledger.events,
      projectId,
      snapshotKey,
    });
    if (!event) {
      return NextResponse.json(
        {
          sealed: false,
          snapshotKey,
          code: "REVIEW_SNAPSHOT_NOT_FOUND",
          error: "이 조직에서 봉인된 검토 Snapshot을 찾을 수 없습니다.",
        },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(responseBody(event, ledger), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("review snapshot lookup failed", error);
    return NextResponse.json(
      {
        code: "REVIEW_SNAPSHOT_LOOKUP_FAILED",
        error:
          error instanceof AuditLedgerIntegrityError
            ? error.message
            : "검토 Snapshot 감사 원장을 읽지 못했습니다.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(request, "review.request");
  if (!authorization.ok) return authorization.response;
  const { projectId } = await context.params;
  const input = await readJsonObject(request, { maxBytes: MAX_REVIEW_SNAPSHOT_BYTES + 100_000,
    tooLargeCode: "REVIEW_SNAPSHOT_TOO_LARGE" });
  if (!input.ok) return input.response;
  const body = input.value;
  const prepared = await prepareReviewSnapshotSeal(body?.snapshot, projectId);
  if (!prepared.valid) {
    return NextResponse.json(
      {
        code:
          prepared.status === 413
            ? "REVIEW_SNAPSHOT_TOO_LARGE"
            : "INVALID_REVIEW_SNAPSHOT",
        error: prepared.errors.join(" "),
        details: prepared.errors,
      },
      { status: prepared.status },
    );
  }

  try {
    const before = await ledgerFor(authorization.principal.orgId);
    const existing = await findVerifiedReviewSnapshotEvent({
      events: before.events,
      projectId,
      snapshotKey: prepared.payload.snapshotKey,
    });
    if (existing) {
      return NextResponse.json(responseBody(existing, before), {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const event = await appendAuditEvent({
      principal: authorization.principal,
      action: REVIEW_SNAPSHOT_SEALED_ACTION,
      resourceType: REVIEW_SNAPSHOT_RESOURCE_TYPE,
      resourceId: projectId,
      payload: prepared.payload,
      expectedPreviousHash: before.integrity.lastHash,
    });
    const after: AuditLedgerReadResult = {
      backend: before.backend,
      events: [...before.events, event],
      integrity: {
        valid: true,
        eventCount: before.integrity.eventCount + 1,
        lastHash: event.entryHash,
        errors: [],
      },
    };
    return NextResponse.json(responseBody(event, after), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AuditLedgerConflictError) {
      try {
        const latest = await ledgerFor(authorization.principal.orgId);
        const existing = await findVerifiedReviewSnapshotEvent({
          events: latest.events,
          projectId,
          snapshotKey: prepared.payload.snapshotKey,
        });
        if (existing) {
          return NextResponse.json(responseBody(existing, latest), {
            status: 200,
            headers: { "Cache-Control": "private, no-store" },
          });
        }
      } catch (retryError) {
        console.error("review snapshot conflict reload failed", retryError);
      }
      return NextResponse.json(
        {
          code: "AUDIT_WRITE_CONFLICT",
          error: "다른 감사 이벤트가 먼저 기록됐습니다. 다시 봉인해 주세요.",
        },
        { status: 409 },
      );
    }
    console.error("review snapshot seal failed", error);
    return NextResponse.json(
      {
        code: "REVIEW_SNAPSHOT_SEAL_FAILED",
        error:
          error instanceof AuditLedgerIntegrityError
            ? error.message
            : "검토 Snapshot을 감사 원장에 봉인하지 못했습니다.",
      },
      { status: 503 },
    );
  }
}
