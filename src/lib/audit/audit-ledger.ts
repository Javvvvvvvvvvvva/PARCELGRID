import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb, type DB } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import type { AccessPrincipal } from "@/lib/auth/roles";

export const AUDIT_LEDGER_VERSION = "audit-chain-2026.1" as const;
export const AUDIT_GENESIS_HASH = "0".repeat(64);

export interface AuditLedgerEvent {
  id: string;
  orgId: string;
  ordinal: number;
  actorId: string;
  actorName: string;
  actorOrganization: string;
  actorEmail: string;
  actorRole: AccessPrincipal["role"];
  action: string;
  resourceType: string;
  resourceId: string;
  payload: unknown;
  payloadHash: string;
  previousHash: string;
  entryHash: string;
  eventVersion: typeof AUDIT_LEDGER_VERSION;
  requestId: string;
  occurredAt: string;
}

export interface AuditLedgerReadResult {
  backend: "postgresql" | "local-append-only";
  events: AuditLedgerEvent[];
  integrity: {
    valid: boolean;
    eventCount: number;
    lastHash: string;
    errors: string[];
  };
}

export interface AppendAuditEventInput {
  principal: AccessPrincipal;
  action: string;
  resourceType: string;
  resourceId: string;
  payload?: unknown;
  requestId?: string;
  occurredAt?: string;
  expectedPreviousHash?: string;
}

export type AuditDatabaseTransaction = Parameters<
  Parameters<DB["transaction"]>[0]
>[0];

export class AuditLedgerConflictError extends Error {
  constructor() {
    super("감사 원장이 다른 요청으로 먼저 갱신됐습니다.");
    this.name = "AuditLedgerConflictError";
  }
}

export class AuditLedgerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditLedgerIntegrityError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedPayload(payload: unknown): unknown {
  return JSON.parse(canonicalJson(payload ?? null)) as unknown;
}

function eventHashInput(event: Omit<AuditLedgerEvent, "entryHash">) {
  return {
    eventVersion: event.eventVersion,
    id: event.id,
    orgId: event.orgId,
    ordinal: event.ordinal,
    actorId: event.actorId,
    actorName: event.actorName,
    actorOrganization: event.actorOrganization,
    actorEmail: event.actorEmail,
    actorRole: event.actorRole,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    payloadHash: event.payloadHash,
    previousHash: event.previousHash,
    requestId: event.requestId,
    occurredAt: event.occurredAt,
  };
}

function createAuditEvent(
  input: AppendAuditEventInput,
  ordinal: number,
  previousHash: string,
): AuditLedgerEvent {
  const payload = normalizedPayload(input.payload);
  const partial: Omit<AuditLedgerEvent, "entryHash"> = {
    id: randomUUID(),
    orgId: input.principal.orgId,
    ordinal,
    actorId: input.principal.userId,
    actorName: input.principal.name,
    actorOrganization: input.principal.organization,
    actorEmail: input.principal.email,
    actorRole: input.principal.role,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    payload,
    payloadHash: sha256(canonicalJson(payload)),
    previousHash,
    eventVersion: AUDIT_LEDGER_VERSION,
    requestId: input.requestId ?? randomUUID(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
  return {
    ...partial,
    entryHash: sha256(canonicalJson(eventHashInput(partial))),
  };
}

function isAuditEvent(value: unknown): value is AuditLedgerEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.orgId === "string" &&
    typeof event.ordinal === "number" &&
    Number.isSafeInteger(event.ordinal) &&
    event.ordinal > 0 &&
    typeof event.actorId === "string" &&
    typeof event.actorName === "string" &&
    typeof event.actorOrganization === "string" &&
    typeof event.actorEmail === "string" &&
    typeof event.actorRole === "string" &&
    typeof event.action === "string" &&
    typeof event.resourceType === "string" &&
    typeof event.resourceId === "string" &&
    typeof event.payloadHash === "string" &&
    /^[a-f0-9]{64}$/.test(event.payloadHash) &&
    typeof event.previousHash === "string" &&
    /^[a-f0-9]{64}$/.test(event.previousHash) &&
    typeof event.entryHash === "string" &&
    /^[a-f0-9]{64}$/.test(event.entryHash) &&
    event.eventVersion === AUDIT_LEDGER_VERSION &&
    typeof event.requestId === "string" &&
    typeof event.occurredAt === "string" &&
    !Number.isNaN(Date.parse(event.occurredAt))
  );
}

export function verifyAuditLedger(events: AuditLedgerEvent[]) {
  const errors: string[] = [];
  let previousHash = AUDIT_GENESIS_HASH;
  for (const [index, event] of events.entries()) {
    const expectedOrdinal = index + 1;
    if (event.ordinal !== expectedOrdinal) {
      errors.push(`감사 이벤트 순번 ${expectedOrdinal}이 누락되거나 중복됐습니다.`);
    }
    if (event.previousHash !== previousHash) {
      errors.push(`감사 이벤트 ${event.ordinal}의 이전 해시가 일치하지 않습니다.`);
    }
    const expectedPayloadHash = sha256(canonicalJson(event.payload));
    if (event.payloadHash !== expectedPayloadHash) {
      errors.push(`감사 이벤트 ${event.ordinal}의 payload가 변경됐습니다.`);
    }
    const expectedEntryHash = sha256(canonicalJson(eventHashInput(event)));
    if (event.entryHash !== expectedEntryHash) {
      errors.push(`감사 이벤트 ${event.ordinal}의 해시가 일치하지 않습니다.`);
    }
    previousHash = event.entryHash;
  }
  return {
    valid: errors.length === 0,
    eventCount: events.length,
    lastHash: events.at(-1)?.entryHash ?? AUDIT_GENESIS_HASH,
    errors,
  };
}

function localLedgerRoot(): string {
  const configured = process.env.AUDIT_LEDGER_STORAGE_DIR?.trim();
  return path.resolve(process.cwd(), configured || ".parcelgrid-data/audit-ledger");
}

function localLedgerPath(orgId: string): string {
  return path.join(localLedgerRoot(), `${sha256(orgId)}.jsonl`);
}

async function readLocalEvents(orgId: string): Promise<AuditLedgerEvent[]> {
  const pathname = localLedgerPath(orgId);
  let text: string;
  try {
    text = await readFile(pathname, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: AuditLedgerEvent[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new AuditLedgerIntegrityError(
        `로컬 감사 원장의 ${index + 1}번째 줄을 읽을 수 없습니다.`,
      );
    }
    if (!isAuditEvent(parsed) || parsed.orgId !== orgId) {
      throw new AuditLedgerIntegrityError(
        `로컬 감사 원장의 ${index + 1}번째 이벤트 형식이 올바르지 않습니다.`,
      );
    }
    events.push(parsed);
  }
  return events.sort((left, right) => left.ordinal - right.ordinal);
}

const ledgerQueues = new Map<string, Promise<void>>();

async function withLocalLedgerLock<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = ledgerQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  ledgerQueues.set(key, tail);
  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (ledgerQueues.get(key) === tail) ledgerQueues.delete(key);
  }
}

async function appendLocalAuditEvent(
  input: AppendAuditEventInput,
): Promise<AuditLedgerEvent> {
  const pathname = localLedgerPath(input.principal.orgId);
  return withLocalLedgerLock(pathname, async () => {
    const events = await readLocalEvents(input.principal.orgId);
    const integrity = verifyAuditLedger(events);
    if (!integrity.valid) {
      throw new AuditLedgerIntegrityError(integrity.errors.join(" "));
    }
    if (
      input.expectedPreviousHash &&
      input.expectedPreviousHash !== integrity.lastHash
    ) {
      throw new AuditLedgerConflictError();
    }
    const event = createAuditEvent(
      input,
      events.length + 1,
      integrity.lastHash,
    );
    await mkdir(path.dirname(pathname), { recursive: true, mode: 0o700 });
    await appendFile(pathname, `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "a",
    });
    return event;
  });
}

function databaseEvent(row: typeof auditLog.$inferSelect): AuditLedgerEvent {
  return {
    id: row.id,
    orgId: row.orgId,
    ordinal: row.ordinal,
    actorId: row.actorId ?? "00000000-0000-0000-0000-000000000000",
    actorName: row.actorName,
    actorOrganization: row.actorOrganization,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole as AccessPrincipal["role"],
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    payload: row.payload,
    payloadHash: row.payloadHash,
    previousHash: row.previousHash,
    entryHash: row.entryHash,
    eventVersion: AUDIT_LEDGER_VERSION,
    requestId: row.requestId,
    occurredAt: row.createdAt.toISOString(),
  };
}

export async function appendAuditEventInTransaction(
  tx: AuditDatabaseTransaction,
  input: AppendAuditEventInput,
): Promise<AuditLedgerEvent> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${input.principal.orgId}))`,
  );
  const [latest] = await tx
    .select()
    .from(auditLog)
    .where(eq(auditLog.orgId, input.principal.orgId))
    .orderBy(desc(auditLog.ordinal))
    .limit(1);
  const previousHash = latest?.entryHash ?? AUDIT_GENESIS_HASH;
  if (
    input.expectedPreviousHash &&
    input.expectedPreviousHash !== previousHash
  ) {
    throw new AuditLedgerConflictError();
  }
  const event = createAuditEvent(input, (latest?.ordinal ?? 0) + 1, previousHash);
  await tx.insert(auditLog).values({
    id: event.id,
    orgId: event.orgId,
    ordinal: event.ordinal,
    actorId: event.actorId,
    actorName: event.actorName,
    actorOrganization: event.actorOrganization,
    actorEmail: event.actorEmail,
    actorRole: event.actorRole,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    payload: event.payload,
    payloadHash: event.payloadHash,
    previousHash: event.previousHash,
    entryHash: event.entryHash,
    eventVersion: event.eventVersion,
    requestId: event.requestId,
    createdAt: new Date(event.occurredAt),
  });
  return event;
}

async function appendDatabaseAuditEvent(
  input: AppendAuditEventInput,
): Promise<AuditLedgerEvent> {
  const db = getDb();
  return db.transaction((tx) => appendAuditEventInTransaction(tx, input));
}

async function readDatabaseEvents(orgId: string): Promise<AuditLedgerEvent[]> {
  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.orgId, orgId))
    .orderBy(asc(auditLog.ordinal));
  return rows.map(databaseEvent);
}

function usesDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function appendAuditEvent(
  input: AppendAuditEventInput,
): Promise<AuditLedgerEvent> {
  return usesDatabase()
    ? appendDatabaseAuditEvent(input)
    : appendLocalAuditEvent(input);
}

export async function readAuditLedger(input: {
  orgId: string;
  resourceType?: string;
  resourceId?: string;
}): Promise<AuditLedgerReadResult> {
  const database = usesDatabase();
  const allEvents = database
    ? await readDatabaseEvents(input.orgId)
    : await readLocalEvents(input.orgId);
  const integrity = verifyAuditLedger(allEvents);
  if (!integrity.valid) {
    throw new AuditLedgerIntegrityError(integrity.errors.join(" "));
  }
  const events = allEvents.filter(
    (event) =>
      (!input.resourceType || event.resourceType === input.resourceType) &&
      (!input.resourceId || event.resourceId === input.resourceId),
  );
  return {
    backend: database ? "postgresql" : "local-append-only",
    events,
    integrity,
  };
}
