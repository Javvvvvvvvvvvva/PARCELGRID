import type { AuditLedgerEvent } from "@/lib/audit/audit-ledger";
import {
  can,
  canReviewDiscipline,
  reviewerRolesForPrincipalDiscipline,
  type AccessPrincipal,
} from "@/lib/auth/roles";
import type { HandoffDiscipline } from "@/lib/handoff/evidence-gate";
import {
  REQUIRED_HANDOFF_DISCIPLINES,
  validateExpertReview,
  validateExpertReviewTransition,
  type ExpertReviewAttestations,
  type ExpertReviewMap,
  type ExpertReviewRecord,
  type ExpertReviewerRole,
  type ExpertReviewStatus,
} from "@/lib/handoff/review-workflow";

export const SERVER_REVIEW_WORKFLOW_VERSION =
  "server-review-workflow-2026.2" as const;

export interface ReviewWorkflowEventPayload {
  version: typeof SERVER_REVIEW_WORKFLOW_VERSION;
  discipline: HandoffDiscipline;
  status: Exclude<ExpertReviewStatus, "not-requested">;
  snapshotKey: string;
  snapshotSealAuditHash: string;
  reviewerRole?: ExpertReviewerRole;
  evidenceRef: string;
  notes: string;
  attestations: ExpertReviewAttestations;
}

export interface ReviewTransitionInput {
  principal: AccessPrincipal;
  discipline: HandoffDiscipline;
  status: Exclude<ExpertReviewStatus, "not-requested">;
  snapshotKey: string;
  snapshotSealAuditHash: string;
  reviewerRole?: ExpertReviewerRole;
  evidenceRef?: string;
  notes?: string;
  attestations?: Partial<ExpertReviewAttestations>;
  current?: ExpertReviewRecord;
}

export type ReviewTransitionResult =
  | { valid: true; payload: ReviewWorkflowEventPayload }
  | { valid: false; status: 403 | 409 | 422; errors: string[] };

function emptyAttestations(): ExpertReviewAttestations {
  return {
    snapshotReviewed: false,
    evidenceReviewed: false,
    preliminaryLimitAcknowledged: false,
  };
}

function isReviewPayload(value: unknown): value is ReviewWorkflowEventPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === SERVER_REVIEW_WORKFLOW_VERSION &&
    REQUIRED_HANDOFF_DISCIPLINES.includes(
      payload.discipline as HandoffDiscipline,
    ) &&
    ["requested", "in-review", "approved", "changes-requested"].includes(
      String(payload.status),
    ) &&
    typeof payload.snapshotKey === "string" &&
    typeof payload.snapshotSealAuditHash === "string" &&
    /^[a-f0-9]{64}$/.test(payload.snapshotSealAuditHash) &&
    typeof payload.evidenceRef === "string" &&
    typeof payload.notes === "string" &&
    Boolean(payload.attestations) &&
    typeof payload.attestations === "object"
  );
}

export function reviewAction(
  status: Exclude<ExpertReviewStatus, "not-requested">,
): string {
  if (status === "requested") return "review.requested";
  if (status === "in-review") return "review.started";
  if (status === "approved") return "review.approved";
  return "review.changes_requested";
}

export function prepareReviewTransition(
  input: ReviewTransitionInput,
): ReviewTransitionResult {
  const errors: string[] = [];
  const replacementRequest = input.status === "requested" && input.current?.snapshotKey !== input.snapshotKey;
  const currentStatus = replacementRequest ? "not-requested" : input.current?.status ?? "not-requested";
  const transition = validateExpertReviewTransition(currentStatus, input.status);
  if (!transition.valid) {
    return {
      valid: false,
      status: 409,
      errors: [transition.error ?? "검토 상태를 변경할 수 없습니다."],
    };
  }
  if (!input.snapshotKey.trim()) {
    errors.push("검토 대상 Snapshot Key가 필요합니다.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.snapshotSealAuditHash)) {
    errors.push("검토 Snapshot 봉인 이벤트의 감사 해시가 필요합니다.");
  }

  let reviewerRole: ExpertReviewerRole | undefined;
  if (input.status === "requested") {
    if (!can(input.principal, "review.request")) {
      return {
        valid: false,
        status: 403,
        errors: ["현재 조직 역할은 전문가 검토를 요청할 수 없습니다."],
      };
    }
  } else {
    if (!canReviewDiscipline(input.principal, input.discipline)) {
      return {
        valid: false,
        status: 403,
        errors: ["로그인 계정에 이 분야의 전문 검토 역할이 없습니다."],
      };
    }
    const allowedRoles = reviewerRolesForPrincipalDiscipline(
      input.principal,
      input.discipline,
    );
    reviewerRole = input.reviewerRole ?? allowedRoles[0];
    if (!reviewerRole || !allowedRoles.includes(reviewerRole)) {
      return {
        valid: false,
        status: 403,
        errors: ["선택한 전문가 역할이 로그인 계정에 부여되지 않았습니다."],
      };
    }
    const requestActorId = input.current?.history
      ?.filter(
        (event) =>
          event.snapshotKey === input.snapshotKey && event.status === "requested",
      )
      .at(-1)?.actorId;
    if (requestActorId && requestActorId === input.principal.userId) {
      return {
        valid: false,
        status: 403,
        errors: ["검토 요청자는 같은 Snapshot을 직접 검토하거나 승인할 수 없습니다."],
      };
    }
    if (input.current?.snapshotKey !== input.snapshotKey) {
      return {
        valid: false,
        status: 409,
        errors: ["요청된 Snapshot과 현재 검토 Snapshot이 다릅니다."],
      };
    }
    if (
      (input.status === "approved" || input.status === "changes-requested") &&
      input.current?.status === "in-review"
    ) {
      const assignedReviewer = input.current.history
        ?.filter(
          (event) =>
            event.snapshotKey === input.snapshotKey &&
            event.status === "in-review",
        )
        .at(-1)?.actorId;
      if (assignedReviewer && assignedReviewer !== input.principal.userId) {
        return {
          valid: false,
          status: 403,
          errors: ["검토를 시작한 담당자만 이 검토를 결정할 수 있습니다."],
        };
      }
    }
  }

  const evidenceRef = input.evidenceRef?.trim() ?? "";
  const notes = input.notes?.trim() ?? "";
  const attestations: ExpertReviewAttestations = {
    snapshotReviewed: Boolean(input.attestations?.snapshotReviewed),
    evidenceReviewed: Boolean(input.attestations?.evidenceReviewed),
    preliminaryLimitAcknowledged: Boolean(
      input.attestations?.preliminaryLimitAcknowledged,
    ),
  };
  if (input.status === "approved" || input.status === "changes-requested") {
    if (!evidenceRef) errors.push("결정에는 근거 문서 참조가 필요합니다.");
    if (!notes) errors.push("결정 범위 또는 수정 요청 내용을 기록해야 합니다.");
  }
  if (
    input.status === "approved" &&
    (!attestations.snapshotReviewed ||
      !attestations.evidenceReviewed ||
      !attestations.preliminaryLimitAcknowledged)
  ) {
    errors.push("승인 전 계산·근거·예비 타당성 한계를 모두 확인해야 합니다.");
  }
  if (errors.length > 0) return { valid: false, status: 422, errors };

  return {
    valid: true,
    payload: {
      version: SERVER_REVIEW_WORKFLOW_VERSION,
      discipline: input.discipline,
      status: input.status,
      snapshotKey: input.snapshotKey.trim(),
      snapshotSealAuditHash: input.snapshotSealAuditHash,
      reviewerRole,
      evidenceRef: input.status === "requested" ? "" : evidenceRef,
      notes: input.status === "requested" ? "" : notes,
      attestations:
        input.status === "requested" ? emptyAttestations() : attestations,
    },
  };
}

export function buildExpertReviewMapFromAuditEvents(
  events: AuditLedgerEvent[],
): ExpertReviewMap {
  const result: ExpertReviewMap = {};
  for (const event of events) {
    if (event.resourceType !== "project-review" || !isReviewPayload(event.payload)) {
      continue;
    }
    const payload = event.payload;
    const current = result[payload.discipline];
    const history = [
      ...(current?.history ?? []),
      {
        status: payload.status,
        actor: event.actorName,
        actorId: event.actorId,
        actorEmail: event.actorEmail,
        actorRole: event.actorRole,
        reviewerRole: payload.reviewerRole,
        occurredAt: event.occurredAt,
        snapshotKey: payload.snapshotKey,
        eventId: event.id,
        ledgerHash: event.entryHash,
      },
    ];
    const requested = payload.status === "requested";
    result[payload.discipline] = {
      discipline: payload.discipline,
      status: payload.status,
      reviewer: requested ? "" : event.actorName,
      organization: requested ? "" : event.actorOrganization,
      reviewerRole: requested ? undefined : payload.reviewerRole,
      requestedBy: requested ? event.actorName : current?.requestedBy,
      requestedAt: requested
        ? event.occurredAt.slice(0, 10)
        : current?.requestedAt,
      evidenceRef: payload.evidenceRef,
      notes: payload.notes,
      reviewedAt: requested ? "" : event.occurredAt.slice(0, 10),
      updatedAt: event.occurredAt,
      snapshotKey: payload.snapshotKey,
      attestations: payload.attestations,
      history,
    };
  }
  return result;
}

export function validateDerivedReviewMap(
  records: ExpertReviewMap,
): string[] {
  return Object.values(records).flatMap((record) =>
    record ? validateExpertReview(record, record.snapshotKey).errors : [],
  );
}
