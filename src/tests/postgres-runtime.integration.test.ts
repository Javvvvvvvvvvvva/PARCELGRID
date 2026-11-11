import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { resolveActiveDatabasePrincipal } from "@/lib/auth/database-membership";
import type { AccessPrincipal } from "@/lib/auth/roles";
import { getDb, getPgClient } from "@/lib/db";
import {
  assumptionOverrides,
  auditLog,
  comps,
  orgs,
  projects,
  projectWorkspaceVersions,
  reports,
  riskFindings,
  scenarios,
  users,
} from "@/lib/db/schema";
import { readAuditLedger, verifyAuditLedger } from "@/lib/audit/audit-ledger";
import {
  ProjectWorkspaceConflictError,
  readProjectWorkspace,
  saveProjectWorkspace,
} from "@/lib/workspace/project-workspace-storage";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";

const RUN_INTEGRATION =
  process.env.PARCELGRID_RUN_POSTGRES_INTEGRATION === "1" &&
  Boolean(process.env.DATABASE_URL?.trim());

const describePostgres = RUN_INTEGRATION ? describe : describe.skip;

describePostgres("PostgreSQL runtime release gate", () => {
  afterAll(async () => {
    await getPgClient().end({ timeout: 5 });
  });

  it("enforces membership, tenant isolation, optimistic concurrency, and immutable evidence", async () => {
    const target = new URL(process.env.DATABASE_URL!);
    const databaseName = decodeURIComponent(target.pathname.slice(1));
    expect(target.hostname).toBe("127.0.0.1");
    expect(databaseName).toMatch(/^pg_native_[a-z0-9_]+$/);
    expect(process.env.PARCELGRID_POSTGRES_DISPOSABLE_DATABASE).toBe(databaseName);

    const db = getDb();
    const runId = randomUUID();
    const orgId = randomUUID();
    const otherOrgId = randomUUID();
    const userId = randomUUID();
    const disabledUserId = randomUUID();
    const projectId = `postgres-gate-${runId}`;
    const projectRowId = randomUUID();
    const scenarioId = randomUUID();
    const reportId = randomUUID();

    await db.insert(orgs).values([
      { id: orgId, name: `Runtime Gate ${runId}` },
      { id: otherOrgId, name: `Other Tenant ${runId}` },
    ]);
    await db.insert(users).values([
      {
        id: userId,
        orgId,
        email: `${runId}@parcelgrid.test`,
        name: "PostgreSQL Gate Analyst",
        role: "analyst",
        reviewerRolesJson: [],
      },
      {
        id: disabledUserId,
        orgId,
        email: `disabled-${runId}@parcelgrid.test`,
        name: "Disabled Member",
        role: "viewer",
        reviewerRolesJson: [],
        disabledAt: new Date(),
      },
    ]);

    const signedPrincipal: AccessPrincipal = {
      userId,
      orgId,
      email: "forged@example.test",
      name: "Forged Name",
      organization: "Forged Organization",
      role: "admin",
      reviewerRoles: ["architect"],
    };
    await expect(resolveActiveDatabasePrincipal(signedPrincipal)).resolves.toMatchObject({
      userId,
      orgId,
      role: "analyst",
      reviewerRoles: [],
      organization: `Runtime Gate ${runId}`,
    });
    await expect(resolveActiveDatabasePrincipal({
      ...signedPrincipal,
      userId: disabledUserId,
      role: "viewer",
      reviewerRoles: [],
    })).resolves.toBeNull();

    await db.insert(projects).values({
      id: projectRowId,
      orgId,
      name: `Runtime parcel ${runId}`,
      parcelId: `PNU-${runId}`,
      address: "서울 도봉구 쌍문동 281-23",
      addressRoad: "서울 도봉구 노해로41길",
      lat: "37.6505110",
      lng: "127.0257490",
      lotAreaSqm: "118.02",
      zoning: "제2종일반주거지역",
      zoneCode: "UQA122",
      maxFar: "200.00",
      maxBcr: "60.00",
      heightLimitM: "0.00",
      setbackJson: { road: null, side: null, rear: null },
      acquiredPriceManwon: "80000",
      status: "feasibility",
      createdBy: userId,
    });
    await db.insert(scenarios).values({
      id: scenarioId,
      projectId: projectRowId,
      code: "S1",
      name: "PostgreSQL restore gate",
      buildingType: "urban-housing",
      far: "40.00",
      bcr: "40.00",
      floorsAbove: 1,
      floorsBelow: 0,
      programJson: { units: 1, parkingCars: 0 },
      assumptionsJson: { constructionCostPerSqm: 2_300_000 },
      resultJson: { preliminary: true, decisionGrade: false },
      profitManwon: "-76368",
      profitMarginPct: "-457.10",
      complianceScore: 4,
    });
    await db.insert(riskFindings).values({
      scenarioId,
      code: "PARKING-VERIFY",
      label: "주차 배치 확인",
      level: "high",
      finding: "실제 주차 동선과 도로 경계를 확인해야 합니다.",
      reference: "서울특별시 주차장 설치 및 관리 조례",
      headroomJson: { requiredCars: 1, plannedCars: 0 },
    });
    await db.insert(assumptionOverrides).values({
      scenarioId,
      field: "constructionCostPerSqm",
      baseValue: "2200000.0000",
      overrideValue: "2300000.0000",
      reason: "Synthetic runtime restore gate",
      changedBy: userId,
    });
    await db.insert(comps).values({
      orgId,
      externalId: `runtime-comp-${runId}`,
      txnDate: new Date("2026-09-01T00:00:00.000Z"),
      address: "서울 도봉구 쌍문동",
      type: "land",
      areaSqm: "118.02",
      priceManwon: "80000",
      source: "synthetic-postgres-gate",
    });
    await db.insert(reports).values({
      id: reportId,
      projectId: projectRowId,
      version: "runtime-gate-v1",
      title: "PostgreSQL restore gate report",
      status: "draft",
      snapshotJson: {
        projectId,
        scenarioId,
        dataClassification: "synthetic",
      },
      pdfUrl: `objects/${orgId}/${projectId}/report.pdf`,
      createdBy: userId,
    });

    await expect(
      db.select({
        parcelId: projects.parcelId,
        lotAreaSqm: projects.lotAreaSqm,
        status: projects.status,
      })
        .from(projects)
        .where(sql`${projects.id} = ${projectRowId}`),
    ).resolves.toEqual([{
      parcelId: `PNU-${runId}`,
      lotAreaSqm: "118.02",
      status: "feasibility",
    }]);
    await expect(
      db.select({ version: reports.version, pdfUrl: reports.pdfUrl })
        .from(reports)
        .where(sql`${reports.id} = ${reportId}`),
    ).resolves.toEqual([{
      version: "runtime-gate-v1",
      pdfUrl: `objects/${orgId}/${projectId}/report.pdf`,
    }]);

    const principal: AccessPrincipal = {
      userId,
      orgId,
      email: `${runId}@parcelgrid.test`,
      name: "PostgreSQL Gate Analyst",
      organization: `Runtime Gate ${runId}`,
      role: "analyst",
      reviewerRoles: [],
    };
    const initial = await saveProjectWorkspace({
      principal,
      projectId,
      baseRevision: 0,
      payload: projectWorkspaceFixture(projectId, "postgres-gate-1"),
    });
    expect(initial).toMatchObject({ revision: 1, backend: "postgresql" });

    const attempts = await Promise.allSettled([
      saveProjectWorkspace({
        principal,
        projectId,
        baseRevision: 1,
        payload: projectWorkspaceFixture(projectId, "postgres-gate-2a"),
      }),
      saveProjectWorkspace({
        principal,
        projectId,
        baseRevision: 1,
        payload: projectWorkspaceFixture(projectId, "postgres-gate-2b"),
      }),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(ProjectWorkspaceConflictError),
    });

    await expect(readProjectWorkspace({ orgId, projectId })).resolves.toMatchObject({
      revision: 2,
      backend: "postgresql",
    });
    await expect(readProjectWorkspace({ orgId: otherOrgId, projectId })).resolves.toBeNull();

    const ledger = await readAuditLedger({ orgId });
    expect(ledger.backend).toBe("postgresql");
    expect(verifyAuditLedger(ledger.events)).toMatchObject({ valid: true, eventCount: 2 });

    const [workspace] = await db
      .select({ id: projectWorkspaceVersions.id })
      .from(projectWorkspaceVersions)
      .where(sql`${projectWorkspaceVersions.projectId} = ${projectId}`)
      .limit(1);
    const [audit] = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(sql`${auditLog.orgId} = ${orgId}`)
      .limit(1);

    const triggers = await db.execute<{ tgname: string }>(sql`
      select tgname
      from pg_trigger
      where not tgisinternal
        and tgname in (
          'assumption_overrides_reject_update_delete',
          'assumption_overrides_reject_truncate',
          'audit_log_reject_update_delete',
          'audit_log_reject_truncate',
          'project_workspace_versions_reject_update_delete',
          'project_workspace_versions_reject_truncate'
        )
    `);
    expect(new Set(triggers.map((row) => row.tgname))).toEqual(new Set([
      "assumption_overrides_reject_update_delete",
      "assumption_overrides_reject_truncate",
      "audit_log_reject_update_delete",
      "audit_log_reject_truncate",
      "project_workspace_versions_reject_update_delete",
      "project_workspace_versions_reject_truncate",
    ]));

    for (const { table, name, field, predicate } of [
      {
        table: projectWorkspaceVersions,
        name: "project_workspace_versions",
        field: "saved_by",
        predicate: sql`${projectWorkspaceVersions.id} = ${workspace.id}`,
      },
      {
        table: auditLog,
        name: "audit_log",
        field: "actor_name",
        predicate: sql`${auditLog.id} = ${audit.id}`,
      },
      {
        table: assumptionOverrides,
        name: "assumption_overrides",
        field: "reason",
        predicate: sql`${assumptionOverrides.scenarioId} = ${scenarioId}`,
      },
    ]) {
      const readEvidence = async () => {
        const [row] = await db.execute<{ content: string }>(sql`
          select coalesce(jsonb_agg(to_jsonb(evidence) order by evidence.id), '[]'::jsonb)::text as content
          from ${table} as evidence
        `);
        return row.content;
      };
      const before = await readEvidence();
      expect(JSON.parse(before).length, `${name} must contain evidence`).toBeGreaterThan(0);

      for (const { operation, statement } of [
        {
          operation: "UPDATE",
          statement: sql`update ${table} set ${sql.identifier(field)} = 'tampered' where ${predicate}`,
        },
        { operation: "DELETE", statement: sql`delete from ${table} where ${predicate}` },
        { operation: "TRUNCATE", statement: sql`truncate table ${table}` },
      ]) {
        await expect(db.transaction(async (tx) => {
          await tx.execute(statement);
          // Roll back even if a missing or broken trigger lets the mutation succeed.
          throw new Error(`${name} ${operation} unexpectedly succeeded; rolled back`);
        }), `${name} ${operation} must reach the immutable trigger`).rejects.toMatchObject({
          cause: {
            code: "55000",
            message: `PGRD_IMMUTABLE_LEDGER: ${name} is append-only`,
          },
        });
        expect(await readEvidence(), `${name} after ${operation}`).toBe(before);
      }
    }

    await expect(
      db.select({ savedBy: projectWorkspaceVersions.savedBy })
        .from(projectWorkspaceVersions)
        .where(sql`${projectWorkspaceVersions.id} = ${workspace.id}`),
    ).resolves.toEqual([{ savedBy: "PostgreSQL Gate Analyst" }]);
    await expect(
      db.select({ id: auditLog.id })
        .from(auditLog)
        .where(sql`${auditLog.id} = ${audit.id}`),
    ).resolves.toEqual([{ id: audit.id }]);
    await expect(
      db.select({ reason: assumptionOverrides.reason })
        .from(assumptionOverrides)
        .where(sql`${assumptionOverrides.scenarioId} = ${scenarioId}`),
    ).resolves.toEqual([{ reason: "Synthetic runtime restore gate" }]);
  }, 30_000);
});
