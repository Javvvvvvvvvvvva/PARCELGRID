import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  GET,
  PUT,
} from "@/app/api/projects/[projectId]/workspace/route";
import { GET as GET_INDEX } from "@/app/api/projects/route";
import type { AccessPrincipal } from "@/lib/auth/roles";
import { createSiteAccessToken, siteAccessCookie } from "@/lib/site-access";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";

const PROJECT_ID = "workspace-route-project";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function actor(
  userId: string,
  role: AccessPrincipal["role"],
  orgId = ORG_ID,
): AccessPrincipal {
  return {
    userId,
    orgId,
    email: `${userId.slice(0, 8)}@example.com`,
    name: userId.slice(0, 8),
    organization: "Example",
    role,
    reviewerRoles: [],
  };
}

function payload(modelVersion = "workspace-route-1") {
  return projectWorkspaceFixture(PROJECT_ID, modelVersion);
}

describe("project workspace API", () => {
  const originalPassword = process.env.SITE_ACCESS_PASSWORD;
  const originalSecret = process.env.SITE_ACCESS_SESSION_SECRET;
  const originalAccounts = process.env.SITE_ACCESS_ACCOUNTS_JSON;
  const originalWorkspaceDirectory = process.env.PROJECT_WORKSPACE_STORAGE_DIR;
  const originalAuditDirectory = process.env.AUDIT_LEDGER_STORAGE_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory = "";
  const context = { params: Promise.resolve({ projectId: PROJECT_ID }) };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "parcelgrid-workspace-route-"));
    process.env.PROJECT_WORKSPACE_STORAGE_DIR = path.join(directory, "workspaces");
    process.env.AUDIT_LEDGER_STORAGE_DIR = path.join(directory, "audit");
    process.env.SITE_ACCESS_PASSWORD = "workspace-route-password";
    process.env.SITE_ACCESS_SESSION_SECRET =
      "workspace-route-session-secret-at-least-32";
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
    restore("PROJECT_WORKSPACE_STORAGE_DIR", originalWorkspaceDirectory);
    restore("AUDIT_LEDGER_STORAGE_DIR", originalAuditDirectory);
    restore("DATABASE_URL", originalDatabaseUrl);
  });

  async function request(
    principal: AccessPrincipal,
    method: "GET" | "PUT",
    body?: unknown,
  ) {
    const token = await createSiteAccessToken(principal);
    return new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/workspace`,
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

  it("enforces roles, tenant scope and optimistic revisions", async () => {
    const analyst = actor(
      "11111111-1111-4111-8111-111111111111",
      "analyst",
    );
    const viewer = actor(
      "33333333-3333-4333-8333-333333333333",
      "viewer",
    );
    const otherOrgViewer = actor(
      "44444444-4444-4444-8444-444444444444",
      "viewer",
      "55555555-5555-4555-8555-555555555555",
    );

    const denied = await PUT(
      await request(viewer, "PUT", { baseRevision: 0, payload: payload() }),
      context,
    );
    expect(denied.status).toBe(403);

    const created = await PUT(
      await request(analyst, "PUT", { baseRevision: 0, payload: payload() }),
      context,
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody).toMatchObject({
      projectId: PROJECT_ID,
      revision: 1,
      backend: "local-versioned",
    });

    const fetched = await GET(await request(viewer, "GET"), context);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("x-workspace-revision")).toBe("1");
    expect((await fetched.json()).payloadHash).toBe(createdBody.payloadHash);

    const index = await GET_INDEX(await request(viewer, "GET"));
    expect(index.status).toBe(200);
    expect(await index.json()).toMatchObject({
      version: "project-workspace-index-2026.1",
      projects: [
        {
          projectId: PROJECT_ID,
          revision: 1,
          address: "서울특별시 도봉구 쌍문동 123-45",
          scenarioCount: 1,
        },
      ],
    });

    const conflict = await PUT(
      await request(analyst, "PUT", {
        baseRevision: 0,
        payload: payload("workspace-route-2"),
      }),
      context,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ currentRevision: 1 });

    const hidden = await GET(await request(otherOrgViewer, "GET"), context);
    expect(hidden.status).toBe(404);
    const hiddenIndex = await GET_INDEX(await request(otherOrgViewer, "GET"));
    expect((await hiddenIndex.json()).projects).toEqual([]);
  });
});
