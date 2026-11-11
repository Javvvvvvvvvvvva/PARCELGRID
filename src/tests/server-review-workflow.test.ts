import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccessPrincipal } from "@/lib/auth/roles";
import { appendAuditEvent, readAuditLedger } from "@/lib/audit/audit-ledger";
import {
  buildExpertReviewMapFromAuditEvents,
  prepareReviewTransition,
  reviewAction,
} from "@/lib/handoff/server-review-workflow";
import { validateExpertReview } from "@/lib/handoff/review-workflow";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "project-review-test";
const SNAPSHOT_KEY = "PG-REVIEW-0123456789ABCDEF";

function principal(
  userId: string,
  role: AccessPrincipal["role"],
  reviewerRoles: AccessPrincipal["reviewerRoles"] = [],
): AccessPrincipal {
  return {
    userId,
    orgId: ORG_ID,
    email: `${userId.slice(0, 8)}@example.com`,
    name: userId.slice(0, 8),
    organization: "Example",
    role,
    reviewerRoles,
  };
}

describe("server-enforced expert review workflow", () => {
  const originalDirectory = process.env.AUDIT_LEDGER_STORAGE_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory = "";
  const requester = principal(
    "11111111-1111-4111-8111-111111111111",
    "analyst",
  );
  const architect = principal(
    "33333333-3333-4333-8333-333333333333",
    "reviewer",
    ["architect"],
  );
  const otherArchitect = principal(
    "44444444-4444-4444-8444-444444444444",
    "reviewer",
    ["architect"],
  );

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "parcelgrid-review-"));
    process.env.AUDIT_LEDGER_STORAGE_DIR = directory;
    delete process.env.DATABASE_URL;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    if (originalDirectory == null) delete process.env.AUDIT_LEDGER_STORAGE_DIR;
    else process.env.AUDIT_LEDGER_STORAGE_DIR = originalDirectory;
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  async function currentReviews() {
    const ledger = await readAuditLedger({
      orgId: ORG_ID,
      resourceType: "project-review",
      resourceId: PROJECT_ID,
    });
    return buildExpertReviewMapFromAuditEvents(ledger.events);
  }

  async function record(
    actor: AccessPrincipal,
    input: Omit<
      Parameters<typeof prepareReviewTransition>[0],
      "principal" | "current" | "snapshotSealAuditHash"
    >,
  ) {
    const reviews = await currentReviews();
    const transition = prepareReviewTransition({
      principal: actor,
      ...input,
      snapshotSealAuditHash: "a".repeat(64),
      current: reviews[input.discipline],
    });
    if (!transition.valid) return transition;
    await appendAuditEvent({
      principal: actor,
      action: reviewAction(input.status),
      resourceType: "project-review",
      resourceId: PROJECT_ID,
      payload: transition.payload,
    });
    return transition;
  }

  it("derives an approval only from requester and assigned expert events", async () => {
    await expect(
      record(requester, {
        discipline: "architect",
        status: "requested",
        snapshotKey: SNAPSHOT_KEY,
      }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      record(architect, {
        discipline: "architect",
        status: "in-review",
        snapshotKey: SNAPSHOT_KEY,
        reviewerRole: "architect",
      }),
    ).resolves.toMatchObject({ valid: true });

    const takeover = await record(otherArchitect, {
      discipline: "architect",
      status: "approved",
      snapshotKey: SNAPSHOT_KEY,
      reviewerRole: "architect",
      evidenceRef: "A-101 code review",
      notes: "예비 검토 범위에서 적합",
      attestations: {
        snapshotReviewed: true,
        evidenceReviewed: true,
        preliminaryLimitAcknowledged: true,
      },
    });
    expect(takeover).toMatchObject({ valid: false, status: 403 });

    await expect(
      record(architect, {
        discipline: "architect",
        status: "approved",
        snapshotKey: SNAPSHOT_KEY,
        reviewerRole: "architect",
        evidenceRef: "A-101 code review",
        notes: "예비 검토 범위에서 적합",
        attestations: {
          snapshotReviewed: true,
          evidenceReviewed: true,
          preliminaryLimitAcknowledged: true,
        },
      }),
    ).resolves.toMatchObject({ valid: true });

    const review = (await currentReviews()).architect!;
    expect(review.status).toBe("approved");
    expect(review.requestedBy).toBe(requester.name);
    expect(review.reviewer).toBe(architect.name);
    expect(review.history).toHaveLength(3);
    expect(review.history?.every((event) => event.ledgerHash)).toBe(true);
    expect(validateExpertReview(review, SNAPSHOT_KEY)).toMatchObject({
      valid: true,
      stale: false,
    });
  });

  it("blocks self-review and unrelated professional disciplines", async () => {
    const selfReviewer = principal(
      "55555555-5555-4555-8555-555555555555",
      "owner",
      ["architect"],
    );
    await record(selfReviewer, {
      discipline: "architect",
      status: "requested",
      snapshotKey: SNAPSHOT_KEY,
    });
    const selfStart = await record(selfReviewer, {
      discipline: "architect",
      status: "in-review",
      snapshotKey: SNAPSHOT_KEY,
      reviewerRole: "architect",
    });
    expect(selfStart).toMatchObject({ valid: false, status: 403 });

    const financeReviewer = principal(
      "66666666-6666-4666-8666-666666666666",
      "reviewer",
      ["finance-specialist"],
    );
    const wrongDiscipline = await record(financeReviewer, {
      discipline: "architect",
      status: "in-review",
      snapshotKey: SNAPSHOT_KEY,
      reviewerRole: "finance-specialist",
    });
    expect(wrongDiscipline).toMatchObject({ valid: false, status: 403 });
  });

  it("starts a new snapshot review while preserving an older in-progress history", async () => {
    await record(requester, { discipline: "architect", status: "requested", snapshotKey: SNAPSHOT_KEY });
    await record(architect, { discipline: "architect", status: "in-review", snapshotKey: SNAPSHOT_KEY });
    expect(await record(requester, { discipline: "architect", status: "requested", snapshotKey: SNAPSHOT_KEY }))
      .toMatchObject({ valid: false, status: 409 });
    const nextKey = "PG-REVIEW-NEW-VERSION";
    expect(await record(requester, { discipline: "architect", status: "requested", snapshotKey: nextKey }))
      .toMatchObject({ valid: true });
    const review = (await currentReviews()).architect!;
    expect(review.history).toHaveLength(3);
    expect(review.history?.[0].snapshotKey).toBe(SNAPSHOT_KEY);
    expect(validateExpertReview(review, nextKey).valid).toBe(true);
    expect(await record(architect, { discipline: "architect", status: "in-review", snapshotKey: SNAPSHOT_KEY }))
      .toMatchObject({ valid: false, status: 409 });
    expect(await record(otherArchitect, { discipline: "architect", status: "in-review", snapshotKey: nextKey }))
      .toMatchObject({ valid: true });
    expect(await record(requester, { discipline: "architect", status: "requested", snapshotKey: SNAPSHOT_KEY }))
      .toMatchObject({ valid: true });
    const reopened = (await currentReviews()).architect!;
    expect(reopened.history).toHaveLength(5);
    expect(validateExpertReview(reopened, SNAPSHOT_KEY).valid).toBe(true);
  });
});
