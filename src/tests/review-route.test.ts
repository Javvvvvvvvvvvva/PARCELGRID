import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  GET as getReviews,
  POST as postReview,
} from "@/app/api/projects/[projectId]/reviews/route";
import {
  GET as getReviewSnapshot,
  POST as postReviewSnapshot,
} from "@/app/api/projects/[projectId]/review-snapshots/route";
import type { AccessPrincipal } from "@/lib/auth/roles";
import { createSiteAccessToken, siteAccessCookie } from "@/lib/site-access";
import {
  buildReviewSnapshotPayload,
  buildServerReviewSnapshotKey,
  type ReviewableStage3Snapshot,
} from "@/lib/handoff/review-snapshot";
import type { ProjectComputed } from "@/lib/services/compute-project";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";

const PROJECT_ID = "P-ROUTE-1";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function snapshotPayload() {
  const snapshot: ReviewableStage3Snapshot = {
    projectId: PROJECT_ID,
    representativeScenarioId: "S-ROUTE-1",
    representativeScenarioVersion: 1,
    geometryHash: "PG-GEOMETRY-ROUTE-1",
    savedAt: "2026-09-09T12:00:00.000Z",
    data: {
      parcel: { id: PROJECT_ID },
      scenarios: [{ id: "S-ROUTE-1" }],
      meta: {
        version: "finance-route-test-1",
        lastSyncedAt: "2026-09-09T12:00:00.000Z",
      },
    } as unknown as ProjectComputed,
  };
  return buildReviewSnapshotPayload({
    snapshot,
    financialSources: {},
    priceVerifications: {},
  });
}

function principal(
  id: string,
  role: AccessPrincipal["role"],
  reviewerRoles: AccessPrincipal["reviewerRoles"] = [],
): AccessPrincipal {
  return {
    userId: id,
    orgId: ORG_ID,
    email: `${id.slice(0, 8)}@example.com`,
    name: id.slice(0, 8),
    organization: "Example",
    role,
    reviewerRoles,
  };
}

describe("project review API", () => {
  const originalPassword = process.env.SITE_ACCESS_PASSWORD;
  const originalSecret = process.env.SITE_ACCESS_SESSION_SECRET;
  const originalAccounts = process.env.SITE_ACCESS_ACCOUNTS_JSON;
  const originalAuditStorage = process.env.AUDIT_LEDGER_STORAGE_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "parcelgrid-review-route-"));
    process.env.AUDIT_LEDGER_STORAGE_DIR = directory;
    process.env.SITE_ACCESS_PASSWORD = "route-password-0000";
    process.env.SITE_ACCESS_SESSION_SECRET = "route-session-secret-with-32-characters";
    delete process.env.SITE_ACCESS_ACCOUNTS_JSON;
    delete process.env.DATABASE_URL;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    const restore = (key: string, value: string | undefined) => {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    };
    restore("SITE_ACCESS_PASSWORD", originalPassword);
    restore("SITE_ACCESS_SESSION_SECRET", originalSecret);
    restore("SITE_ACCESS_ACCOUNTS_JSON", originalAccounts);
    restore("AUDIT_LEDGER_STORAGE_DIR", originalAuditStorage);
    restore("DATABASE_URL", originalDatabaseUrl);
  });

  const context = { params: Promise.resolve({ projectId: PROJECT_ID }) };

  async function request(
    actor: AccessPrincipal,
    method: "GET" | "POST",
    body?: unknown,
    resource = "reviews",
    search = "",
  ) {
    const token = await createSiteAccessToken(actor);
    return new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/${resource}${search}`,
      {
      method,
      headers: {
        cookie: `${siteAccessCookie.name}=${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      },
    );
  }

  it("allows incomplete packets to be reviewed, blocks approval, and records requested changes", async () => {
    const analyst = principal(
      "11111111-1111-4111-8111-111111111111",
      "analyst",
    );
    const architect = principal(
      "33333333-3333-4333-8333-333333333333",
      "reviewer",
      ["architect"],
    );
    const snapshot = snapshotPayload();
    const snapshotKey = await buildServerReviewSnapshotKey(snapshot);

    const unsealed = await postReview(
      await request(analyst, "POST", {
        discipline: "architect",
        status: "requested",
        snapshotKey,
      }),
      context,
    );
    expect(unsealed.status).toBe(422);

    const sealed = await postReviewSnapshot(
      await request(
        analyst,
        "POST",
        { snapshot },
        "review-snapshots",
      ),
      context,
    );
    expect(sealed.status).toBe(201);
    expect((await sealed.json()).snapshotKey).toBe(snapshotKey);

    const duplicate = await postReviewSnapshot(
      await request(
        analyst,
        "POST",
        { snapshot },
        "review-snapshots",
      ),
      context,
    );
    expect(duplicate.status).toBe(200);

    const fetchedSnapshot = await getReviewSnapshot(
      await request(
        analyst,
        "GET",
        undefined,
        "review-snapshots",
        `?snapshotKey=${snapshotKey}`,
      ),
      context,
    );
    expect(fetchedSnapshot.status).toBe(200);
    expect(await fetchedSnapshot.json()).toMatchObject({
      sealed: true,
      snapshotKey,
      representativeScenarioId: "S-ROUTE-1",
    });

    const requested = await postReview(
      await request(analyst, "POST", {
        discipline: "architect",
        status: "requested",
        snapshotKey,
      }),
      context,
    );
    expect(requested.status).toBe(201);

    const started = await postReview(
      await request(architect, "POST", {
        discipline: "architect",
        status: "in-review",
        snapshotKey,
        reviewerRole: "architect",
      }),
      context,
    );
    expect(started.status).toBe(201);

    const approved = await postReview(
      await request(architect, "POST", {
        discipline: "architect",
        status: "approved",
        snapshotKey,
        reviewerRole: "architect",
        evidenceRef: "architect-review-A101",
        notes: "예비 검토 범위에서 승인",
        attestations: {
          snapshotReviewed: true,
          evidenceReviewed: true,
          preliminaryLimitAcknowledged: true,
        },
      }),
      context,
    );
    expect(approved.status).toBe(422);
    expect((await approved.json()).code).toBe("REVIEW_INTEGRATED_VERIFICATION_BLOCKED");
    const changed = await postReview(
      await request(architect, "POST", {
        discipline: "architect", status: "changes-requested", snapshotKey,
        reviewerRole: "architect", evidenceRef: "review-missing-plan",
        notes: "원본 계획과 형상을 보완해야 합니다.",
      }), context,
    );
    expect(changed.status).toBe(201);
    const changedBody = await changed.json();
    expect(changedBody.reviews.architect.status).toBe("changes-requested");
    expect(changedBody.ledger).toMatchObject({
      backend: "local-append-only",
      reviewEventCount: 3,
      integrity: { valid: true, eventCount: 4 },
    });

    const fetched = await getReviews(await request(analyst, "GET"), context);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).reviews.architect.history).toHaveLength(3);
  });

  it("rejects a client-edited verification report before adding any seal", async () => {
    const analyst = principal("11111111-1111-4111-8111-111111111111", "analyst");
    const snapshot = snapshotPayload();
    snapshot.verification.checks = [];
    snapshot.verification.status = "preliminary";
    const response = await postReviewSnapshot(
      await request(analyst, "POST", { snapshot }, "review-snapshots"), context,
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("재계산");
    const ledger = await getReviews(await request(analyst, "GET"), context);
    expect((await ledger.json()).ledger.integrity.eventCount).toBe(0);
  });

  it("records a scoped two-person model review, while raw room changes need a new review", async () => {
    const analyst = principal("11111111-1111-4111-8111-111111111111", "analyst");
    const architect = principal("33333333-3333-4333-8333-333333333333", "reviewer", ["architect"]);
    const input = integratedVerificationFixture(PROJECT_ID);
    const build = () => buildReviewSnapshotPayload({
      snapshot: { ...input, savedAt: "2026-10-26T00:00:00.000Z" },
      planningScenario: input.planningScenario, geometry: input.geometry, financialSources: {}, priceVerifications: {},
    });
    const packet = build();
    const key = await buildServerReviewSnapshotKey(packet);
    const seal = await postReviewSnapshot(await request(analyst, "POST", { snapshot: packet }, "review-snapshots"), context);
    expect(seal.status).toBe(201);
    expect((await seal.json()).professionalCredentialStatus).toBe("unverified");
    for (const [actor, status] of [[analyst, "requested"], [architect, "in-review"], [architect, "approved"]] as const) {
      const response = await postReview(await request(actor, "POST", {
        discipline: "architect", status, snapshotKey: key, evidenceRef: "SYNTHETIC-MODEL-ONLY", notes: "합성 모델 연결 검사에 한정. 공식 경계·법정 적합·자격 검증 아님.",
        attestations: { snapshotReviewed: true, evidenceReviewed: true, preliminaryLimitAcknowledged: true },
      }), context);
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    }
    input.planningScenario!.floorPrograms[1].interiorLayout!.roomLayouts![0].doors = [];
    const changed = build(), changedKey = await buildServerReviewSnapshotKey(changed);
    expect(changedKey).not.toBe(key);
    expect((await postReviewSnapshot(await request(analyst, "POST", { snapshot: changed }, "review-snapshots"), context)).status).toBe(201);
    const bypass = await postReview(await request(architect, "POST", { discipline: "architect", status: "approved", snapshotKey: changedKey }), context);
    expect(bypass.status).toBe(409);
    for (const [actor, status] of [[analyst, "requested"], [architect, "in-review"]] as const) {
      expect((await postReview(await request(actor, "POST", { discipline: "architect", status, snapshotKey: changedKey }), context)).status).toBe(201);
    }
    const conflict = await postReview(await request(architect, "POST", {
      discipline: "architect", status: "approved", snapshotKey: changedKey, evidenceRef: "SYNTHETIC", notes: "유효한 역할이라도 충돌 승인을 우회할 수 없음",
      attestations: { snapshotReviewed: true, evidenceReviewed: true, preliminaryLimitAcknowledged: true },
    }), context);
    expect(conflict.status).toBe(422);
    expect((await conflict.json()).code).toBe("REVIEW_INTEGRATED_VERIFICATION_BLOCKED");
    const result = await getReviews(await request(analyst, "GET"), context);
    expect((await result.json()).reviews.architect.history).toHaveLength(5);
  });
});
