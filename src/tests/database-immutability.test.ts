import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("database audit immutability migration", () => {
  it("creates hash-chain indexes and blocks mutation of audit records", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "drizzle/0000_shiny_nebula.sql"),
      "utf8",
    );
    expect(migration).toContain('"audit_org_ordinal_idx"');
    expect(migration).toContain('"audit_entry_hash_idx"');
    expect(migration).toContain('"audit_log_reject_update_delete"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "audit_log"');
    expect(migration).toContain('"audit_log_reject_truncate"');
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON "assumption_overrides"',
    );
  });

  it("blocks mutation and truncation of versioned project workspaces", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "drizzle/0001_old_silver_fox.sql"),
      "utf8",
    );
    expect(migration).toContain(
      'CREATE TRIGGER "project_workspace_versions_reject_update_delete"',
    );
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON "project_workspace_versions"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "project_workspace_versions_reject_truncate"',
    );
  });
});
