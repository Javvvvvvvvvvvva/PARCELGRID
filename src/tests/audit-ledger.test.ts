import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendAuditEvent,
  AuditLedgerIntegrityError,
  readAuditLedger,
  verifyAuditLedger,
} from "@/lib/audit/audit-ledger";
import type { AccessPrincipal } from "@/lib/auth/roles";

const actor: AccessPrincipal = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  email: "analyst@example.com",
  name: "Analyst",
  organization: "Example",
  role: "analyst",
  reviewerRoles: [],
};

describe("append-only audit ledger", () => {
  const originalDirectory = process.env.AUDIT_LEDGER_STORAGE_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "parcelgrid-audit-"));
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

  it("serializes concurrent events into one verifiable organization chain", async () => {
    await Promise.all([
      appendAuditEvent({
        principal: actor,
        action: "scenario.changed",
        resourceType: "scenario",
        resourceId: "S1",
        payload: { field: "interestRate", value: 5.2 },
      }),
      appendAuditEvent({
        principal: actor,
        action: "evidence.uploaded",
        resourceType: "project-evidence",
        resourceId: "P1",
        payload: { sha256: "abc" },
      }),
    ]);

    const ledger = await readAuditLedger({ orgId: actor.orgId });
    expect(ledger.backend).toBe("local-append-only");
    expect(ledger.events.map((event) => event.ordinal)).toEqual([1, 2]);
    expect(ledger.events[1].previousHash).toBe(ledger.events[0].entryHash);
    expect(verifyAuditLedger(ledger.events)).toMatchObject({
      valid: true,
      eventCount: 2,
    });
  });

  it("detects payload edits before serving or appending more events", async () => {
    await appendAuditEvent({
      principal: actor,
      action: "review.approved",
      resourceType: "project-review",
      resourceId: "P1",
      payload: { decision: "approved" },
    });
    const [fileName] = await readdir(directory);
    const pathname = path.join(directory, fileName);
    const event = JSON.parse((await readFile(pathname, "utf8")).trim()) as {
      payload: { decision: string };
    };
    event.payload.decision = "rejected";
    await writeFile(pathname, `${JSON.stringify(event)}\n`, "utf8");

    await expect(readAuditLedger({ orgId: actor.orgId })).rejects.toBeInstanceOf(
      AuditLedgerIntegrityError,
    );
    await expect(
      appendAuditEvent({
        principal: actor,
        action: "review.requested",
        resourceType: "project-review",
        resourceId: "P1",
      }),
    ).rejects.toBeInstanceOf(AuditLedgerIntegrityError);
  });
});
