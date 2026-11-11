import type { AuditLedgerEvent } from "@/lib/audit/audit-ledger";
import {
  buildServerReviewSnapshotKey,
  canonicalReviewSnapshotJson,
  isServerReviewSnapshotKey,
  validateReviewSnapshotPayload,
  type ReviewSnapshotPayload,
} from "@/lib/handoff/review-snapshot";

export const SERVER_REVIEW_SNAPSHOT_VERSION =
  "server-review-snapshot-2026.1" as const;
export const REVIEW_SNAPSHOT_RESOURCE_TYPE =
  "project-review-snapshot" as const;
export const REVIEW_SNAPSHOT_SEALED_ACTION = "review.snapshot_sealed" as const;
export const MAX_REVIEW_SNAPSHOT_BYTES = 5_000_000;

export interface SealedReviewSnapshotPayload {
  version: typeof SERVER_REVIEW_SNAPSHOT_VERSION;
  snapshotKey: string;
  byteLength: number;
  snapshot: ReviewSnapshotPayload;
}

export type PreparedReviewSnapshot =
  | {
      valid: true;
      payload: SealedReviewSnapshotPayload;
    }
  | {
      valid: false;
      status: 413 | 422;
      errors: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function prepareReviewSnapshotSeal(
  value: unknown,
  projectId: string,
): Promise<PreparedReviewSnapshot> {
  // Bound work before running spatial validation on an untrusted request.
  if (new TextEncoder().encode(canonicalReviewSnapshotJson(value)).byteLength > MAX_REVIEW_SNAPSHOT_BYTES) {
    return { valid: false, status: 413, errors: ["검토 Snapshot 크기 제한을 초과했습니다."] };
  }
  const validation = validateReviewSnapshotPayload(value, projectId);
  if (!validation.valid || !validation.payload) {
    return { valid: false, status: 422, errors: validation.errors };
  }
  const byteLength = new TextEncoder().encode(
    canonicalReviewSnapshotJson(validation.payload),
  ).byteLength;
  if (byteLength > MAX_REVIEW_SNAPSHOT_BYTES) {
    return {
      valid: false,
      status: 413,
      errors: [
        `검토 Snapshot이 ${MAX_REVIEW_SNAPSHOT_BYTES.toLocaleString()}바이트 제한을 초과했습니다.`,
      ],
    };
  }
  const snapshotKey = await buildServerReviewSnapshotKey(validation.payload);
  return {
    valid: true,
    payload: {
      version: SERVER_REVIEW_SNAPSHOT_VERSION,
      snapshotKey,
      byteLength,
      snapshot: validation.payload,
    },
  };
}

export function isSealedReviewSnapshotPayload(
  value: unknown,
): value is SealedReviewSnapshotPayload {
  if (!isRecord(value)) return false;
  return (
    value.version === SERVER_REVIEW_SNAPSHOT_VERSION &&
    isServerReviewSnapshotKey(value.snapshotKey) &&
    Number.isSafeInteger(value.byteLength) &&
    Number(value.byteLength) > 0 &&
    isRecord(value.snapshot)
  );
}

export async function findVerifiedReviewSnapshotEvent(input: {
  events: AuditLedgerEvent[];
  projectId: string;
  snapshotKey: string;
}): Promise<AuditLedgerEvent | null> {
  if (!isServerReviewSnapshotKey(input.snapshotKey)) return null;
  const candidates = input.events.filter(
    (event) =>
      event.action === REVIEW_SNAPSHOT_SEALED_ACTION &&
      event.resourceType === REVIEW_SNAPSHOT_RESOURCE_TYPE &&
      event.resourceId === input.projectId &&
      isSealedReviewSnapshotPayload(event.payload) &&
      event.payload.snapshotKey === input.snapshotKey,
  );
  for (const event of candidates.reverse()) {
    const payload = event.payload as SealedReviewSnapshotPayload;
    const validation = validateReviewSnapshotPayload(
      payload.snapshot,
      input.projectId,
    );
    if (!validation.valid || !validation.payload) continue;
    const canonical = canonicalReviewSnapshotJson(validation.payload);
    const byteLength = new TextEncoder().encode(canonical).byteLength;
    if (byteLength !== payload.byteLength) continue;
    if ((await buildServerReviewSnapshotKey(validation.payload)) === input.snapshotKey) {
      return event;
    }
  }
  return null;
}

export function sealedReviewSnapshotMetadata(event: AuditLedgerEvent) {
  if (!isSealedReviewSnapshotPayload(event.payload)) {
    throw new Error("Sealed review snapshot event payload is invalid.");
  }
  const { snapshot, snapshotKey, byteLength } = event.payload;
  return {
    sealed: true as const,
    snapshotKey,
    byteLength,
    snapshotVersion: snapshot.version,
    projectId: snapshot.projectId,
    representativeScenarioId: snapshot.representativeScenarioId,
    representativeScenarioVersion: snapshot.representativeScenarioVersion,
    geometryHash: snapshot.geometryHash,
    calculationModelVersion: snapshot.data.meta.version,
    verificationVersion: snapshot.verification.version,
    verificationStatus: snapshot.verification.status,
    professionalCredentialStatus: "unverified" as const,
    sealedAt: event.occurredAt,
    sealedBy: event.actorName,
    auditHash: event.entryHash,
  };
}
