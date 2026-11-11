import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  appendAuditEvent,
  appendAuditEventInTransaction,
  readAuditLedger,
} from "@/lib/audit/audit-ledger";
import type { AccessPrincipal } from "@/lib/auth/roles";
import { getDb } from "@/lib/db";
import { projectWorkspaceVersions } from "@/lib/db/schema";
import {
  canonicalProjectWorkspaceJson,
  hashProjectWorkspacePayload,
  PROJECT_WORKSPACE_VERSION,
  validateProjectWorkspacePayload,
  type ProjectWorkspacePayload,
  type ProjectWorkspaceRecord,
} from "@/lib/workspace/project-workspace";

const WORKSPACE_AUDIT_ACTION = "project.workspace_saved";
const WORKSPACE_RESOURCE_TYPE = "project-workspace";

interface LocalWorkspaceRecord extends ProjectWorkspaceRecord {
  orgId: string;
  savedById: string;
}

export class ProjectWorkspaceConflictError extends Error {
  constructor(
    readonly currentRevision: number,
    readonly currentPayloadHash: string | null,
  ) {
    super("프로젝트 Workspace가 다른 사용자에 의해 먼저 저장됐습니다.");
    this.name = "ProjectWorkspaceConflictError";
  }
}

export class ProjectWorkspaceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectWorkspaceIntegrityError";
  }
}

function usesDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function workspaceRoot(): string {
  return path.resolve(
    process.cwd(),
    process.env.PROJECT_WORKSPACE_STORAGE_DIR?.trim() ||
      ".parcelgrid-data/project-workspaces",
  );
}

function workspaceDirectory(orgId: string, projectId: string): string {
  return path.join(workspaceRoot(), sha256(orgId), sha256(projectId));
}

function workspaceFilename(revision: number, payloadHash: string): string {
  return `${revision.toString().padStart(10, "0")}-${payloadHash}.json`;
}

const workspaceQueues = new Map<string, Promise<void>>();

async function withWorkspaceLock<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = workspaceQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  workspaceQueues.set(key, tail);
  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (workspaceQueues.get(key) === tail) workspaceQueues.delete(key);
  }
}

async function validateRecord(
  record: ProjectWorkspaceRecord,
  projectId: string,
): Promise<void> {
  if (
    record.version !== PROJECT_WORKSPACE_VERSION ||
    record.projectId !== projectId ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1 ||
    !/^[a-f0-9]{64}$/.test(record.payloadHash) ||
    !/^[a-f0-9]{64}$/.test(record.auditHash) ||
    Number.isNaN(Date.parse(record.savedAt))
  ) {
    throw new ProjectWorkspaceIntegrityError(
      "프로젝트 Workspace 버전 메타데이터가 올바르지 않습니다.",
    );
  }
  const validation = validateProjectWorkspacePayload(record.payload, projectId);
  if (!validation.valid || !validation.payload) {
    throw new ProjectWorkspaceIntegrityError(validation.errors.join(" "));
  }
  const actualHash = await hashProjectWorkspacePayload(validation.payload);
  if (actualHash !== record.payloadHash) {
    throw new ProjectWorkspaceIntegrityError(
      "프로젝트 Workspace 본문의 SHA-256이 저장값과 다릅니다.",
    );
  }
}

function auditPayloadMatches(
  payload: unknown,
  record: ProjectWorkspaceRecord,
): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  return (
    value.version === PROJECT_WORKSPACE_VERSION &&
    value.projectId === record.projectId &&
    value.revision === record.revision &&
    value.payloadHash === record.payloadHash
  );
}

function verifyAuditReferenceInEvents(
  events: Awaited<ReturnType<typeof readAuditLedger>>["events"],
  record: ProjectWorkspaceRecord,
): void {
  const event = events.find(
    (candidate) => candidate.entryHash === record.auditHash,
  );
  if (
    !event ||
    event.action !== WORKSPACE_AUDIT_ACTION ||
    event.resourceType !== WORKSPACE_RESOURCE_TYPE ||
    event.resourceId !== record.projectId ||
    !auditPayloadMatches(event.payload, record)
  ) {
    throw new ProjectWorkspaceIntegrityError(
      "프로젝트 Workspace와 연결된 감사 이벤트를 확인할 수 없습니다.",
    );
  }
}

async function verifyAuditReference(
  orgId: string,
  record: ProjectWorkspaceRecord,
): Promise<void> {
  const ledger = await readAuditLedger({ orgId });
  verifyAuditReferenceInEvents(ledger.events, record);
}

function publicLocalRecord(record: LocalWorkspaceRecord): ProjectWorkspaceRecord {
  const { orgId: _orgId, savedById: _savedById, ...publicRecord } = record;
  void _orgId;
  void _savedById;
  return publicRecord;
}

async function readLatestLocalRecord(
  directory: string,
): Promise<LocalWorkspaceRecord | null> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const latest = names
    .filter((name) => /^\d{10}-[a-f0-9]{64}\.json$/.test(name))
    .sort()
    .at(-1);
  if (!latest) return null;
  try {
    const record = JSON.parse(
      await readFile(path.join(directory, latest), "utf8"),
    ) as LocalWorkspaceRecord;
    const match = latest.match(/^(\d{10})-([a-f0-9]{64})\.json$/);
    if (
      !match ||
      record.revision !== Number(match[1]) ||
      record.payloadHash !== match[2]
    ) {
      throw new ProjectWorkspaceIntegrityError(
        "프로젝트 Workspace 파일명과 revision 메타데이터가 일치하지 않습니다.",
      );
    }
    return record;
  } catch (error) {
    if (error instanceof ProjectWorkspaceIntegrityError) throw error;
    throw new ProjectWorkspaceIntegrityError(
      "프로젝트 Workspace 버전 파일을 읽을 수 없습니다.",
    );
  }
}

async function readLocalWorkspace(
  orgId: string,
  projectId: string,
): Promise<ProjectWorkspaceRecord | null> {
  const directory = workspaceDirectory(orgId, projectId);
  const record = await readLatestLocalRecord(directory);
  if (!record) return null;
  if (
    record.orgId !== orgId ||
    typeof record.savedById !== "string" ||
    record.savedById.length === 0
  ) {
    throw new ProjectWorkspaceIntegrityError(
      "프로젝트 Workspace 조직 메타데이터가 일치하지 않습니다.",
    );
  }
  await validateRecord(record, projectId);
  await verifyAuditReference(orgId, record);
  return publicLocalRecord(record);
}

async function readDatabaseWorkspace(
  orgId: string,
  projectId: string,
): Promise<ProjectWorkspaceRecord | null> {
  const [row] = await getDb()
    .select()
    .from(projectWorkspaceVersions)
    .where(
      and(
        eq(projectWorkspaceVersions.orgId, orgId),
        eq(projectWorkspaceVersions.projectId, projectId),
      ),
    )
    .orderBy(desc(projectWorkspaceVersions.revision))
    .limit(1);
  if (!row) return null;
  const record: ProjectWorkspaceRecord = {
    version: row.schemaVersion as typeof PROJECT_WORKSPACE_VERSION,
    projectId: row.projectId,
    revision: row.revision,
    payloadHash: row.payloadHash,
    payload: row.payload as ProjectWorkspacePayload,
    savedAt: row.createdAt.toISOString(),
    savedBy: row.savedBy,
    auditHash: row.auditEntryHash,
    backend: "postgresql",
  };
  await validateRecord(record, projectId);
  await verifyAuditReference(orgId, record);
  return record;
}

export async function readProjectWorkspace(input: {
  orgId: string;
  projectId: string;
}): Promise<ProjectWorkspaceRecord | null> {
  return usesDatabase()
    ? readDatabaseWorkspace(input.orgId, input.projectId)
    : readLocalWorkspace(input.orgId, input.projectId);
}

async function listLocalWorkspaces(
  orgId: string,
): Promise<ProjectWorkspaceRecord[]> {
  const organizationDirectory = path.join(workspaceRoot(), sha256(orgId));
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(organizationDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: ProjectWorkspaceRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const local = await readLatestLocalRecord(
      path.join(organizationDirectory, entry.name),
    );
    if (!local) continue;
    if (
      local.orgId !== orgId ||
      typeof local.savedById !== "string" ||
      !local.savedById ||
      sha256(local.projectId) !== entry.name
    ) {
      throw new ProjectWorkspaceIntegrityError(
        "프로젝트 Workspace 목록의 조직 또는 프로젝트 메타데이터가 일치하지 않습니다.",
      );
    }
    await validateRecord(local, local.projectId);
    records.push(publicLocalRecord(local));
  }
  const ledger = await readAuditLedger({ orgId });
  for (const record of records) {
    verifyAuditReferenceInEvents(ledger.events, record);
  }
  return records.sort((left, right) =>
    right.savedAt.localeCompare(left.savedAt),
  );
}

async function listDatabaseWorkspaces(
  orgId: string,
): Promise<ProjectWorkspaceRecord[]> {
  const rows = await getDb()
    .selectDistinctOn([projectWorkspaceVersions.projectId])
    .from(projectWorkspaceVersions)
    .where(eq(projectWorkspaceVersions.orgId, orgId))
    .orderBy(
      projectWorkspaceVersions.projectId,
      desc(projectWorkspaceVersions.revision),
    );
  const records: ProjectWorkspaceRecord[] = rows.map((row) => ({
    version: row.schemaVersion as typeof PROJECT_WORKSPACE_VERSION,
    projectId: row.projectId,
    revision: row.revision,
    payloadHash: row.payloadHash,
    payload: row.payload as ProjectWorkspacePayload,
    savedAt: row.createdAt.toISOString(),
    savedBy: row.savedBy,
    auditHash: row.auditEntryHash,
    backend: "postgresql",
  }));
  for (const record of records) {
    await validateRecord(record, record.projectId);
  }
  const ledger = await readAuditLedger({ orgId });
  for (const record of records) {
    verifyAuditReferenceInEvents(ledger.events, record);
  }
  return records.sort((left, right) =>
    right.savedAt.localeCompare(left.savedAt),
  );
}

export async function listProjectWorkspaces(input: {
  orgId: string;
}): Promise<ProjectWorkspaceRecord[]> {
  return usesDatabase()
    ? listDatabaseWorkspaces(input.orgId)
    : listLocalWorkspaces(input.orgId);
}

async function normalizedPayload(
  value: unknown,
  projectId: string,
): Promise<{ payload: ProjectWorkspacePayload; payloadHash: string }> {
  const validation = validateProjectWorkspacePayload(value, projectId);
  if (!validation.valid || !validation.payload) {
    throw new ProjectWorkspaceIntegrityError(validation.errors.join(" "));
  }
  const payload = JSON.parse(
    canonicalProjectWorkspaceJson(validation.payload),
  ) as ProjectWorkspacePayload;
  return { payload, payloadHash: await hashProjectWorkspacePayload(payload) };
}

async function saveLocalWorkspace(input: {
  principal: AccessPrincipal;
  projectId: string;
  baseRevision: number;
  payload: ProjectWorkspacePayload;
  payloadHash: string;
}): Promise<ProjectWorkspaceRecord> {
  const directory = workspaceDirectory(input.principal.orgId, input.projectId);
  return withWorkspaceLock(directory, async () => {
    const current = await readLocalWorkspace(
      input.principal.orgId,
      input.projectId,
    );
    if (current?.payloadHash === input.payloadHash) return current;
    const currentRevision = current?.revision ?? 0;
    if (input.baseRevision !== currentRevision) {
      throw new ProjectWorkspaceConflictError(
        currentRevision,
        current?.payloadHash ?? null,
      );
    }
    const revision = currentRevision + 1;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const pending = path.join(directory, `.pending-${randomUUID()}.json`);
    await writeFile(pending, canonicalProjectWorkspaceJson(input.payload), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      const event = await appendAuditEvent({
        principal: input.principal,
        action: WORKSPACE_AUDIT_ACTION,
        resourceType: WORKSPACE_RESOURCE_TYPE,
        resourceId: input.projectId,
        payload: {
          version: PROJECT_WORKSPACE_VERSION,
          projectId: input.projectId,
          revision,
          payloadHash: input.payloadHash,
        },
      });
      const record: LocalWorkspaceRecord = {
        version: PROJECT_WORKSPACE_VERSION,
        projectId: input.projectId,
        revision,
        payloadHash: input.payloadHash,
        payload: input.payload,
        savedAt: event.occurredAt,
        savedBy: input.principal.name,
        auditHash: event.entryHash,
        backend: "local-versioned",
        orgId: input.principal.orgId,
        savedById: input.principal.userId,
      };
      await writeFile(pending, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(
        pending,
        path.join(directory, workspaceFilename(revision, input.payloadHash)),
      );
      return record;
    } catch (error) {
      await unlink(pending).catch(() => undefined);
      throw error;
    }
  });
}

async function saveDatabaseWorkspace(input: {
  principal: AccessPrincipal;
  projectId: string;
  baseRevision: number;
  payload: ProjectWorkspacePayload;
  payloadHash: string;
}): Promise<ProjectWorkspaceRecord> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${input.principal.orgId}:${input.projectId}`}))`,
    );
    const [current] = await tx
      .select()
      .from(projectWorkspaceVersions)
      .where(
        and(
          eq(projectWorkspaceVersions.orgId, input.principal.orgId),
          eq(projectWorkspaceVersions.projectId, input.projectId),
        ),
      )
      .orderBy(desc(projectWorkspaceVersions.revision))
      .limit(1);
    if (current?.payloadHash === input.payloadHash) {
      return {
        version: current.schemaVersion as typeof PROJECT_WORKSPACE_VERSION,
        projectId: current.projectId,
        revision: current.revision,
        payloadHash: current.payloadHash,
        payload: current.payload as ProjectWorkspacePayload,
        savedAt: current.createdAt.toISOString(),
        savedBy: current.savedBy,
        auditHash: current.auditEntryHash,
        backend: "postgresql" as const,
      };
    }
    const currentRevision = current?.revision ?? 0;
    if (input.baseRevision !== currentRevision) {
      throw new ProjectWorkspaceConflictError(
        currentRevision,
        current?.payloadHash ?? null,
      );
    }
    const revision = currentRevision + 1;
    const event = await appendAuditEventInTransaction(tx, {
      principal: input.principal,
      action: WORKSPACE_AUDIT_ACTION,
      resourceType: WORKSPACE_RESOURCE_TYPE,
      resourceId: input.projectId,
      payload: {
        version: PROJECT_WORKSPACE_VERSION,
        projectId: input.projectId,
        revision,
        payloadHash: input.payloadHash,
      },
    });
    await tx.insert(projectWorkspaceVersions).values({
      orgId: input.principal.orgId,
      projectId: input.projectId,
      revision,
      schemaVersion: PROJECT_WORKSPACE_VERSION,
      payload: input.payload,
      payloadHash: input.payloadHash,
      auditEntryHash: event.entryHash,
      savedBy: input.principal.name,
      createdBy: input.principal.userId,
      createdAt: new Date(event.occurredAt),
    });
    return {
      version: PROJECT_WORKSPACE_VERSION,
      projectId: input.projectId,
      revision,
      payloadHash: input.payloadHash,
      payload: input.payload,
      savedAt: event.occurredAt,
      savedBy: input.principal.name,
      auditHash: event.entryHash,
      backend: "postgresql" as const,
    };
  });
}

export async function saveProjectWorkspace(input: {
  principal: AccessPrincipal;
  projectId: string;
  baseRevision: number;
  payload: unknown;
}): Promise<ProjectWorkspaceRecord> {
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new ProjectWorkspaceConflictError(0, null);
  }
  const prepared = await normalizedPayload(input.payload, input.projectId);
  return usesDatabase()
    ? saveDatabaseWorkspace({ ...input, ...prepared })
    : saveLocalWorkspace({ ...input, ...prepared });
}
