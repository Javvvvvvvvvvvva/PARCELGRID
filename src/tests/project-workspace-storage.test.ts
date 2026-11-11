import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccessPrincipal } from "@/lib/auth/roles";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";
import {
  listProjectWorkspaces,
  ProjectWorkspaceConflictError,
  ProjectWorkspaceIntegrityError,
  readProjectWorkspace,
  saveProjectWorkspace,
} from "@/lib/workspace/project-workspace-storage";

const PROJECT_ID = "workspace-project-1";
const principal: AccessPrincipal = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  email: "analyst@example.com",
  name: "Workspace Analyst",
  organization: "Example",
  role: "analyst",
  reviewerRoles: [],
};
const BASE_PAYLOAD = projectWorkspaceFixture(
  PROJECT_ID,
  "finance-workspace-1",
);

function payload(modelVersion = "finance-workspace-1") {
  const next = structuredClone(BASE_PAYLOAD);
  next.projectData.meta.version = modelVersion;
  return next;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("versioned project workspace storage", () => {
  const originalWorkspaceDirectory = process.env.PROJECT_WORKSPACE_STORAGE_DIR;
  const originalAuditDirectory = process.env.AUDIT_LEDGER_STORAGE_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory = "";
  let workspaceDirectory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "parcelgrid-workspace-"));
    workspaceDirectory = path.join(directory, "workspaces");
    process.env.PROJECT_WORKSPACE_STORAGE_DIR = workspaceDirectory;
    process.env.AUDIT_LEDGER_STORAGE_DIR = path.join(directory, "audit");
    delete process.env.DATABASE_URL;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    const restore = (key: string, value: string | undefined) => {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    };
    restore("PROJECT_WORKSPACE_STORAGE_DIR", originalWorkspaceDirectory);
    restore("AUDIT_LEDGER_STORAGE_DIR", originalAuditDirectory);
    restore("DATABASE_URL", originalDatabaseUrl);
  });

  it("appends immutable revisions, deduplicates content and detects conflicts", async () => {
    const first = await saveProjectWorkspace({
      principal,
      projectId: PROJECT_ID,
      baseRevision: 0,
      payload: payload(),
    });
    expect(first).toMatchObject({ revision: 1, backend: "local-versioned" });
    expect(first.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.auditHash).toMatch(/^[a-f0-9]{64}$/);

    const duplicate = await saveProjectWorkspace({
      principal,
      projectId: PROJECT_ID,
      baseRevision: 0,
      payload: payload(),
    });
    expect(duplicate.revision).toBe(1);

    await expect(
      saveProjectWorkspace({
        principal,
        projectId: PROJECT_ID,
        baseRevision: 0,
        payload: payload("finance-workspace-conflict"),
      }),
    ).rejects.toBeInstanceOf(ProjectWorkspaceConflictError);

    const second = await saveProjectWorkspace({
      principal,
      projectId: PROJECT_ID,
      baseRevision: 1,
      payload: payload("finance-workspace-2"),
    });
    expect(second.revision).toBe(2);
    await expect(
      readProjectWorkspace({ orgId: principal.orgId, projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ revision: 2, payloadHash: second.payloadHash });
    await expect(
      readProjectWorkspace({
        orgId: "33333333-3333-4333-8333-333333333333",
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeNull();

    await expect(
      listProjectWorkspaces({ orgId: principal.orgId }),
    ).resolves.toMatchObject([
      { projectId: PROJECT_ID, revision: 2, payloadHash: second.payloadHash },
    ]);
    await expect(
      listProjectWorkspaces({
        orgId: "33333333-3333-4333-8333-333333333333",
      }),
    ).resolves.toEqual([]);
  });

  it("rejects a workspace file whose payload changed after saving", async () => {
    const saved = await saveProjectWorkspace({
      principal,
      projectId: PROJECT_ID,
      baseRevision: 0,
      payload: payload(),
    });
    const filename = `${saved.revision.toString().padStart(10, "0")}-${saved.payloadHash}.json`;
    const pathname = path.join(
      workspaceDirectory,
      digest(principal.orgId),
      digest(PROJECT_ID),
      filename,
    );
    const record = JSON.parse(await readFile(pathname, "utf8"));
    record.payload.projectData.meta.version = "tampered";
    await writeFile(pathname, JSON.stringify(record));

    await expect(
      readProjectWorkspace({ orgId: principal.orgId, projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(ProjectWorkspaceIntegrityError);
  });

  it("rejects a version file renamed to claim a different revision", async () => {
    const saved = await saveProjectWorkspace({
      principal,
      projectId: PROJECT_ID,
      baseRevision: 0,
      payload: payload(),
    });
    const directoryName = path.join(
      workspaceDirectory,
      digest(principal.orgId),
      digest(PROJECT_ID),
    );
    const filename = `${saved.revision.toString().padStart(10, "0")}-${saved.payloadHash}.json`;
    await rename(
      path.join(directoryName, filename),
      path.join(directoryName, `0000000009-${saved.payloadHash}.json`),
    );

    await expect(
      readProjectWorkspace({ orgId: principal.orgId, projectId: PROJECT_ID }),
    ).rejects.toThrow("파일명과 revision");
  });
});
