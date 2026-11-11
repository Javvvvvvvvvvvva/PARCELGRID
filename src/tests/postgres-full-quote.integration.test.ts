import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import Decimal from "decimal.js";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { AccessPrincipal } from "@/lib/auth/roles";
import { getDb, getPgClient } from "@/lib/db";
import { orgs, users, projectWorkspaceVersions, auditLog } from "@/lib/db/schema";
import { appendAuditEvent, readAuditLedger, verifyAuditLedger, type AuditLedgerEvent } from "@/lib/audit/audit-ledger";
import { buildReviewSnapshotPayload } from "@/lib/handoff/review-snapshot";
import {
  prepareReviewSnapshotSeal, findVerifiedReviewSnapshotEvent, sealedReviewSnapshotMetadata,
  REVIEW_SNAPSHOT_RESOURCE_TYPE, REVIEW_SNAPSHOT_SEALED_ACTION, type SealedReviewSnapshotPayload,
} from "@/lib/handoff/server-review-snapshot";
import { constructionQuoteBasis } from "@/lib/planning/construction-quote";
import { createQuoteAdoptionReviewDraft, quoteAdoptionBusinessDate } from "@/lib/planning/construction-quote-adoption-review";
import { applyFullQuoteAdoption, assessFullQuoteAdoption, removeFullQuoteAdoption } from "@/lib/planning/full-quote-adoption";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { createQuantityCostDraft, evaluateQuantityCost } from "@/lib/planning/quantity-cost";
import { buildRepresentativeParcelBasisHash } from "@/lib/planning/representative-basis";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy, type PlanningCalculationContext } from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { PROJECT_CALCULATION_VERSION } from "@/lib/services/compute-project";
import { recomputeFromPlanningScenarios } from "@/lib/services/recompute-from-planning-scenarios";
import {
  canonicalProjectWorkspaceJson, hashProjectWorkspacePayload,
  type ProjectWorkspacePayload, type ProjectWorkspaceRecord,
} from "@/lib/workspace/project-workspace";
import {
  readProjectWorkspace, saveProjectWorkspace, ProjectWorkspaceConflictError, ProjectWorkspaceIntegrityError,
} from "@/lib/workspace/project-workspace-storage";
import { constructionQuoteFixture } from "@/tests/helpers/construction-quote-fixture";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";

const describePostgres = process.env.PARCELGRID_RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;
const STATE_VERSION = "postgres-full-quote-v229-1";
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const digest = (value: unknown) => createHash("sha256").update(canonicalProjectWorkspaceJson(value)).digest("hex");
const jsonValue = <T,>(value: T): T => JSON.parse(canonicalProjectWorkspaceJson(value)) as T;
type Phase = "initial" | "restarted" | "restored";
type State = {
  version: typeof STATE_VERSION;
  databaseName: string;
  projectId: string;
  orgId: string;
  otherOrgId: string;
  adoptedOn: string;
  quotedTotalWon: number;
  baselineHardCost: number;
  quantityAdjustmentManwon: number;
  originalQuoteKeyOrder: string[];
  baseline: ProjectWorkspaceRecord;
  adopted: ProjectWorkspaceRecord;
  winner: ProjectWorkspaceRecord;
  removed: ProjectWorkspaceRecord;
  other: ProjectWorkspaceRecord;
  seals: AuditLedgerEvent[];
  primaryAudit: AuditLedgerEvent[];
  otherAudit: AuditLedgerEvent[];
  databaseRows: { workspaces: unknown; audit: unknown };
};

// Refuse unsafe targets before opening either a database connection or the state file.
async function guardedTarget() {
  const target = new URL(process.env.DATABASE_URL ?? "");
  expect(["postgres:", "postgresql:"]).toContain(target.protocol);
  expect(target.hostname).toBe("127.0.0.1");
  expect(target.search).toBe("");
  expect(target.hash).toBe("");
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  expect(databaseName).toMatch(/^pg_native_[a-z0-9_]+$/);
  expect(process.env.PARCELGRID_POSTGRES_DISPOSABLE_DATABASE).toBe(databaseName);
  const phase = process.env.PARCELGRID_FULL_QUOTE_PHASE as Phase;
  expect(["initial", "restarted", "restored"]).toContain(phase);
  const statePath = process.env.PARCELGRID_FULL_QUOTE_STATE ?? "";
  const temporary = process.env.TMPDIR ?? "";
  expect(path.isAbsolute(statePath)).toBe(true);
  expect(path.isAbsolute(temporary)).toBe(true);
  const directory = await realpath(temporary);
  expect(await realpath(path.dirname(statePath))).toBe(directory);
  const ownerRoot = path.dirname(directory);
  expect(path.basename(ownerRoot)).toMatch(/^parcelgrid-pg-quote-regression-[A-Za-z0-9-]+$/);
  expect(path.dirname(ownerRoot)).toBe(await realpath("/tmp"));
  const uid = process.getuid!();
  for (const location of [directory, ownerRoot]) {
    const stat = await lstat(location);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.uid).toBe(uid);
    expect(stat.mode & 0o022).toBe(0);
  }
  expect((await lstat(ownerRoot)).mode & 0o077).toBe(0);
  if (phase === "initial") {
    await expect(lstat(statePath)).rejects.toMatchObject({ code: "ENOENT" });
  } else {
    const stat = await lstat(statePath);
    expect(stat.isFile()).toBe(true);
    expect(stat.uid).toBe(uid);
    expect(stat.mode & 0o077).toBe(0);
    expect(stat.size).toBeGreaterThan(0);
    expect(stat.size).toBeLessThan(MAX_STATE_BYTES);
  }
  return { databaseName, phase, statePath };
}

function addDays(day: string, count: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function calculationContext(payload: ProjectWorkspacePayload): PlanningCalculationContext {
  const { parcel, scenarios, meta } = payload.projectData;
  return {
    parcel: {
      address: parcel.address, zoning: parcel.zoning, zoningStatus: "user-entered",
      sunlightRuleAsOf: meta.lastSyncedAt.slice(0, 10),
      lotAreaSqm: parcel.lotArea, boundary: parcel.boundary, boundaryPolygons: parcel.boundaryPolygons,
      roads: parcel.roads, setback: parcel.setback, maxFARPct: parcel.maxFAR, maxBCRPct: parcel.maxBCR,
      heightLimitM: parcel.heightLimit ?? 0, regulatoryConstraints: parcel.regulatoryConstraints,
      roofAllowanceM: 1.4, acquisitionCostManwon: parcel.acquiredPrice, demolitionCostManwon: parcel.demolitionCost ?? 0,
    },
    assumptions: planningEconomicsAssumptionsFromLegacy(scenarios[0]._raw.assumptions),
    calculatedAt: meta.lastSyncedAt,
  };
}

function recompute(payload: ProjectWorkspacePayload) {
  const plan = payload.planningScenarios[0];
  const geometry = payload.representativeGeometry!;
  const result = calculatePlanningScenario(plan, calculationContext(payload));
  expect(result.economicsPreview.status).toBe("estimated");
  // Match the service bridge: proxy facade calculations must not receive a different geometry basis.
  const program = planningScenarioToBuildingProgram(plan, result, {
    geometryHash: geometry.geometryHash,
    geometry: plan.fullQuoteAdoption || result.economicsPreview.facadeCost?.areaBasis === "geometry-derived"
      ? geometry : undefined,
  });
  plan.economicsPreview = result.economicsPreview;
  const data = recomputeFromPlanningScenarios(payload.projectData.parcel, [plan], plan.id, payload.projectData, {
    calculateMaxAcquisition: false,
    geometryHashes: { [plan.id]: geometry.geometryHash },
    startDate: payload.projectData.meta.calculationStartDate,
  });
  expect(data).not.toBeNull();
  payload.projectData = data!;
  payload.stage3Snapshot = {
    projectId: payload.projectId, representativeScenarioId: plan.id, representativeScenarioVersion: plan.version,
    geometryHash: geometry.geometryHash, savedAt: new Date().toISOString(), data: data!,
  };
  return program;
}

function fixture(projectId: string, today: string) {
  const f = constructionQuoteFixture();
  const payload = projectWorkspaceFixture(projectId);
  payload.projectData = f.data;
  payload.projectData.parcel.id = projectId;
  payload.projectData.meta.lastSyncedAt = new Date().toISOString();
  payload.projectData.meta.calculationStartDate = `${today.slice(0, 7)}-01`;
  const plan = f.scenario;
  plan.projectId = projectId;
  plan.status = "draft";
  plan.quantityCost = createQuantityCostDraft(plan, f.inputs);
  plan.quantityCost.lines.forEach(line => {
    line.treatment = "included";
    line.scopeConfirmed = true;
    line.source = "Synthetic scope only; not professional evidence";
  });
  Object.assign(plan.quantityCost.lines.find(line => line.id === "entryDoorCount")!, {
    treatment: "replace-allowance", unitRateWon: 2_000_000, includedAllowanceWon: 1_500_000,
    allowanceSource: "Synthetic allowance", evidenceStatus: "quoted",
  });
  const quantity = evaluateQuantityCost(plan, f.inputs);
  expect(quantity.status, quantity.issues.join("; ")).toBe("ready");
  expect(quantity.adjustmentManwon).toBeGreaterThan(0);
  Object.assign(f.quote, {
    issuedOn: addDays(today, -1), reviewDate: today, validUntil: addDays(today, 30),
    sourceBasis: constructionQuoteBasis(plan, f.inputs),
  });
  f.quote.lines.forEach(line => {
    line.amountWon! *= 1_000;
    if (line.unitRateWon !== null) line.unitRateWon *= 1_000;
  });
  const scopes = f.quote.coverage.filter(scope => scope.lineIds.includes("package"));
  f.quote.lines[0].allocations = scopes.map((scope, index) => ({
    scopeId: scope.id, amountWon: 100_000_000 + (index === 0 ? 1_234 : 0), source: `Synthetic allocation ${scope.id}`,
  }));
  f.quote.lines[0].amountWon = scopes.length * 100_000_000 + 1_234;
  f.quote.statedTotalWon = f.quote.lines.reduce((sum, line) => sum + line.amountWon!, 0);
  payload.planningScenarios = [plan];
  payload.selectedScenarioId = plan.id;
  const context = calculationContext(payload);
  const calculation = calculatePlanningScenario(plan, context);
  plan.economicsPreview = calculation.economicsPreview;
  const parcel = payload.projectData.parcel;
  const geometry = buildPlanningGeometry({
    projectId, scenario: plan, boundary: parcel.boundary, boundaryPolygons: parcel.boundaryPolygons,
    lotAreaSqm: parcel.lotArea, zoning: parcel.zoning, roads: parcel.roads, setback: parcel.setback,
    sunlight: calculation.sunlight, roofAllowanceM: calculation.metrics.roofAllowanceM,
    generatedAt: context.calculatedAt,
  }).snapshot;
  payload.representativeScenarioId = plan.id;
  payload.representativeGeometry = geometry;
  payload.representativeParcelBasisHash = buildRepresentativeParcelBasisHash(parcel);
  recompute(payload);
  return { payload, inputs: f.inputs, quantityAdjustmentManwon: quantity.adjustmentManwon! };
}

function adopt(payload: ProjectWorkspacePayload, asOf: string) {
  const plan = payload.planningScenarios[0];
  const { constructionCostPerSqmWon, basementCostMultiplier } = calculationContext(payload).assumptions;
  const inputs = { constructionCostPerSqmWon, basementCostMultiplier };
  const review = createQuoteAdoptionReviewDraft(plan, inputs, payload.representativeGeometry!);
  review.checkedOn = asOf;
  review.scopes.forEach(scope => {
    scope.confirmed = true;
    scope.source = "Synthetic declaration only; boundaries, permits and professional approval are unconfirmed";
  });
  Object.assign(plan, applyFullQuoteAdoption(plan, inputs, payload.representativeGeometry!, review, asOf));
}

async function seal(record: ProjectWorkspaceRecord, principal: AccessPrincipal) {
  const payload = record.payload;
  const prepared = await prepareReviewSnapshotSeal(buildReviewSnapshotPayload({
    snapshot: payload.stage3Snapshot!, planningScenario: payload.planningScenarios[0], geometry: payload.representativeGeometry,
    financialSources: payload.financialSources, priceVerifications: payload.priceVerifications, expertTaxContracts: payload.expertTaxContracts,
  }), record.projectId);
  if (!prepared.valid) throw new Error(prepared.errors.join("; "));
  expect(prepared.payload.snapshot.verification.approvalStatus).toBe("unverified");
  const ledger = await readAuditLedger({ orgId: principal.orgId });
  return appendAuditEvent({
    principal, action: REVIEW_SNAPSHOT_SEALED_ACTION, resourceType: REVIEW_SNAPSHOT_RESOURCE_TYPE,
    resourceId: record.projectId, payload: prepared.payload, expectedPreviousHash: ledger.integrity.lastHash,
  });
}

async function databaseRows(projectId: string, orgId: string, otherOrgId: string) {
  const db = getDb();
  const [workspaces] = await db.execute<{ rows: unknown }>(sql`
    select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) as rows
    from ${projectWorkspaceVersions} t where project_id=${projectId} and org_id in (${orgId}, ${otherOrgId})
  `);
  const [audit] = await db.execute<{ rows: unknown }>(sql`
    select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) as rows
    from ${auditLog} t where org_id in (${orgId}, ${otherOrgId})
  `);
  return { workspaces: workspaces.rows, audit: audit.rows };
}

describePostgres("durable PostgreSQL full-quote adoption v229", () => {
  let connected = false;
  afterAll(async () => {
    if (connected) await getPgClient().end({ timeout: 5 });
  });

  it("persists exact adopted costs, rejects invalid transitions, and replays immutable tenant-isolated history after restart and restore", async () => {
    const target = await guardedTarget();
    expect(PROJECT_CALCULATION_VERSION).toBe("v229");
    const db = getDb();
    connected = true;
    const [backend] = await db.execute<{ database: string; version: string; address: string }>(sql`
      select current_database() as database, version(), host(inet_server_addr()) as address
    `);
    expect(backend.database).toBe(target.databaseName);
    expect(backend.version).toMatch(/^PostgreSQL /);
    expect(backend.address).toBe("127.0.0.1");
    let state: State;
    if (target.phase === "initial") {
      const today = quoteAdoptionBusinessDate();
      const projectId = `full-quote-${randomUUID()}`;
      const orgId = randomUUID(), otherOrgId = randomUUID();
      const userId = randomUUID(), otherUserId = randomUUID();
      await db.insert(orgs).values([
        { id: orgId, name: "Synthetic full-quote tenant" },
        { id: otherOrgId, name: "Other synthetic full-quote tenant" },
      ]);
      await db.insert(users).values([
        { id: userId, orgId, email: `${userId}@parcelgrid.test`, name: "Synthetic analyst", role: "analyst", reviewerRolesJson: [] },
        { id: otherUserId, orgId: otherOrgId, email: `${otherUserId}@parcelgrid.test`, name: "Other analyst", role: "analyst", reviewerRolesJson: [] },
      ]);
      const principal: AccessPrincipal = {
        userId, orgId, email: `${userId}@parcelgrid.test`, name: "Synthetic analyst",
        organization: "Synthetic full-quote tenant", role: "analyst", reviewerRoles: [],
      };
      const f = fixture(projectId, today);
      const baseline = await saveProjectWorkspace({ principal, projectId, baseRevision: 0, payload: f.payload });
      expect(baseline).toMatchObject({ revision: 1, backend: "postgresql" });
      expect(await readProjectWorkspace({ orgId, projectId })).toEqual(baseline);
      expect(await readProjectWorkspace({ orgId: otherOrgId, projectId })).toBeNull();
      const adoptedPayload = structuredClone((await readProjectWorkspace({ orgId, projectId }))!.payload);
      adopt(adoptedPayload, today);
      const program = recompute(adoptedPayload);
      const quote = adoptedPayload.planningScenarios[0].constructionQuote!;
      const quotedTotalWon = quote.lines.reduce((sum, line) => sum.plus(line.amountWon!), new Decimal(0)).toNumber();
      expect(Math.abs(quote.statedTotalWon! - quotedTotalWon)).toBeLessThanOrEqual(quotedTotalWon * Number.EPSILON * 4);
      expect(program.areaContract?.fullQuoteCost?.totalWon).toBe(quotedTotalWon);
      expect(program.areaContract?.quantityCostAdjustment).toBeUndefined();
      expect(adoptedPayload.projectData.scenarios[0].hardCost).toBe(Math.round(quotedTotalWon / 10_000));
      expect(adoptedPayload.projectData.scenarios[0].hardCost).not.toBe(baseline.payload.projectData.scenarios[0].hardCost);
      const adopted = await saveProjectWorkspace({ principal, projectId, baseRevision: 1, payload: adoptedPayload });
      const adoptedReload = (await readProjectWorkspace({ orgId, projectId }))!;
      expect(adoptedReload).toEqual(adopted);
      const reloadedProgram = recompute(structuredClone(adoptedReload.payload));
      expect(reloadedProgram.areaContract?.fullQuoteCost?.totalWon).toBe(quotedTotalWon);
      expect(reloadedProgram.areaContract?.quantityCostAdjustment).toBeUndefined();
      const adoptedSeal = await seal(adoptedReload, principal);
      const beforeRace = await readAuditLedger({ orgId });
      const variants = ["A", "B"].map(suffix => {
        const payload = structuredClone(adoptedReload.payload);
        payload.planningScenarios[0].name = `Concurrent display edit ${suffix}`;
        return payload;
      });
      const attempts = await Promise.allSettled(variants.map(payload =>
        saveProjectWorkspace({ principal, projectId, baseRevision: 2, payload })));
      expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter(attempt => attempt.status === "rejected")).toHaveLength(1);
      expect(attempts.find(attempt => attempt.status === "rejected")).toMatchObject({
        status: "rejected", reason: expect.any(ProjectWorkspaceConflictError),
      });
      const winner = (await readProjectWorkspace({ orgId, projectId }))!;
      expect(winner.revision).toBe(3);
      expect(variants).toContainEqual(winner.payload);
      const afterRace = await readAuditLedger({ orgId });
      expect(afterRace.events.slice(0, beforeRace.events.length)).toEqual(beforeRace.events);
      expect(afterRace.events).toHaveLength(beforeRace.events.length + 1);

      const removedPayload = structuredClone(winner.payload);
      Object.assign(removedPayload.planningScenarios[0], removeFullQuoteAdoption(removedPayload.planningScenarios[0]));
      const removedProgram = recompute(removedPayload);
      expect(removedProgram.areaContract?.fullQuoteCost).toBeUndefined();
      expect(removedProgram.areaContract?.quantityCostAdjustment?.adjustmentManwon).toBe(f.quantityAdjustmentManwon);
      expect(removedPayload.projectData.scenarios[0].hardCost).toBe(baseline.payload.projectData.scenarios[0].hardCost);
      expect(removedPayload.planningScenarios[0].constructionQuote).toEqual(quote);
      const removed = await saveProjectWorkspace({ principal, projectId, baseRevision: 3, payload: removedPayload });
      const removedSeal = await seal((await readProjectWorkspace({ orgId, projectId }))!, principal);

      const beforeInvalid = await databaseRows(projectId, orgId, otherOrgId);
      for (const kind of ["amount", "quote", "embedded-quote", "inputs", "plan", "expired-new", "expired-forged-today"] as const) {
        const invalid = structuredClone(adopted.payload);
        const plan = invalid.planningScenarios[0];
        if (kind === "amount") plan.fullQuoteAdoption!.totalWon += 100;
        if (kind === "quote") plan.constructionQuote!.reference += " mismatched";
        if (kind === "embedded-quote") plan.fullQuoteAdoption!.quote.reference += " tampered";
        if (kind === "inputs") invalid.projectData.scenarios[0]._raw.assumptions.constCostPerSqM += 100;
        if (kind === "plan") plan.floorPrograms[1].zones[0].areaSqm += 1;
        if (kind.startsWith("expired")) {
          Object.assign(plan, removeFullQuoteAdoption(plan));
          plan.constructionQuote!.issuedOn = addDays(today, -2);
          plan.constructionQuote!.reviewDate = addDays(today, -1);
          plan.constructionQuote!.validUntil = addDays(today, -1);
          adopt(invalid, addDays(today, -1));
          if (kind === "expired-forged-today") {
            plan.fullQuoteAdoption!.adoptedOn = today;
            plan.fullQuoteAdoption!.review.checkedOn = today;
          }
        }
        await expect(saveProjectWorkspace({ principal, projectId, baseRevision: 4, payload: invalid }), kind)
          .rejects.toBeInstanceOf(ProjectWorkspaceIntegrityError);
        expect(await databaseRows(projectId, orgId, otherOrgId), kind).toEqual(beforeInvalid);
        expect(await readProjectWorkspace({ orgId, projectId }), kind).toEqual(removed);
      }
      const otherPayload = structuredClone(baseline.payload);
      otherPayload.planningScenarios[0].name = "Independent other-tenant plan";
      const other = await saveProjectWorkspace({
        principal: { ...principal, orgId: otherOrgId, userId: otherUserId, email: `${otherUserId}@parcelgrid.test`, organization: "Other tenant" },
        projectId, baseRevision: 0, payload: otherPayload,
      });
      expect(other.revision).toBe(1);
      expect(await readProjectWorkspace({ orgId, projectId })).toEqual(removed);
      state = jsonValue({
        version: STATE_VERSION, databaseName: target.databaseName, projectId, orgId, otherOrgId, adoptedOn: today,
        quotedTotalWon, baselineHardCost: baseline.payload.projectData.scenarios[0].hardCost,
        quantityAdjustmentManwon: f.quantityAdjustmentManwon, originalQuoteKeyOrder: Object.keys(f.payload.planningScenarios[0].constructionQuote!),
        baseline, adopted, winner, removed, other, seals: [adoptedSeal, removedSeal],
        primaryAudit: (await readAuditLedger({ orgId })).events, otherAudit: (await readAuditLedger({ orgId: otherOrgId })).events,
        databaseRows: await databaseRows(projectId, orgId, otherOrgId),
      });
    } else {
      const file = await open(target.statePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const persisted = JSON.parse(await file.readFile("utf8")) as { state: State; sha256: string };
        expect(persisted.sha256).toBe(digest(persisted.state));
        state = persisted.state;
      } finally { await file.close(); }
      expect(state.version).toBe(STATE_VERSION);
      expect(target.databaseName).toBe(target.phase === "restored" ? `${state.databaseName}_restore` : state.databaseName);
    }

    // Replay only reads stored records. It never renews expired quotes, seeds, or recalculates live adoption.
    expect(await readProjectWorkspace({ orgId: state.orgId, projectId: state.projectId })).toEqual(state.removed);
    expect(await readProjectWorkspace({ orgId: state.otherOrgId, projectId: state.projectId })).toEqual(state.other);
    expect(await readProjectWorkspace({ orgId: randomUUID(), projectId: state.projectId })).toBeNull();
    expect(await databaseRows(state.projectId, state.orgId, state.otherOrgId)).toEqual(state.databaseRows);
    const records = [
      [state.orgId, state.baseline], [state.orgId, state.adopted], [state.orgId, state.winner],
      [state.orgId, state.removed], [state.otherOrgId, state.other],
    ] as const;
    for (const [orgId, expected] of records) {
      const rows = await db.select().from(projectWorkspaceVersions).where(and(
        eq(projectWorkspaceVersions.orgId, orgId), eq(projectWorkspaceVersions.projectId, state.projectId),
        eq(projectWorkspaceVersions.revision, expected.revision),
      ));
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.payload).toEqual(expected.payload);
      expect(row.payloadHash).toBe(await hashProjectWorkspacePayload(expected.payload));
      expect(row.auditEntryHash).toBe(expected.auditHash);
      const [stored] = await db.execute<{ kind: string; quote: object }>(sql`
        select pg_typeof(payload)::text as kind, payload #> '{planningScenarios,0,constructionQuote}' as quote
        from ${projectWorkspaceVersions} where id=${row.id}
      `);
      expect(stored.kind).toBe("jsonb");
      expect(Object.keys(stored.quote)).not.toEqual(state.originalQuoteKeyOrder);
      const payload = row.payload as ProjectWorkspacePayload;
      const plan = payload.planningScenarios[0];
      expect(plan.constructionQuote).toEqual(state.baseline.payload.planningScenarios[0].constructionQuote);
      expect(plan.quantityCost).toEqual(state.baseline.payload.planningScenarios[0].quantityCost);
      const finance = payload.projectData.scenarios[0];
      expect(payload.projectData.meta.version).toBe("v229");
      if (plan.fullQuoteAdoption) {
        const contract = assessFullQuoteAdoption(plan, plan.fullQuoteAdoption.inputs, payload.representativeGeometry!, state.adoptedOn)!;
        expect(contract.totalWon).toBe(state.quotedTotalWon);
        expect(finance._raw.program.areaContract?.fullQuoteCost).toEqual(contract);
        expect(finance._raw.program.areaContract?.quantityCostAdjustment).toBeUndefined();
        expect(finance.hardCost).toBe(Math.round(state.quotedTotalWon / 10_000));
        expect(plan.economicsPreview.constructionCostManwon).toBeCloseTo(state.quotedTotalWon / 10_000, 2);
        expect(finance.constructionCostSensitivity?.low.status).toBe("unavailable");
        expect(finance.constructionCostSensitivity?.high.status).toBe("unavailable");
      } else {
        expect(finance._raw.program.areaContract?.fullQuoteCost).toBeUndefined();
        expect(finance._raw.program.areaContract?.quantityCostAdjustment?.adjustmentManwon).toBe(state.quantityAdjustmentManwon);
        expect(finance.hardCost).toBe(state.baselineHardCost);
      }
    }
    const primary = await readAuditLedger({ orgId: state.orgId });
    const other = await readAuditLedger({ orgId: state.otherOrgId });
    for (const [ledger, events, count] of [[primary, state.primaryAudit, 6], [other, state.otherAudit, 1]] as const) {
      expect(ledger.backend).toBe("postgresql");
      expect(ledger.events).toEqual(events);
      expect(verifyAuditLedger(ledger.events)).toMatchObject({ valid: true, eventCount: count });
      expect(ledger.events.every(event => ["project.workspace_saved", REVIEW_SNAPSHOT_SEALED_ACTION].includes(event.action))).toBe(true);
    }
    expect(state.seals).toHaveLength(2);
    expect((state.seals[0].payload as SealedReviewSnapshotPayload).snapshotKey)
      .not.toBe((state.seals[1].payload as SealedReviewSnapshotPayload).snapshotKey);
    for (const [index, expected] of state.seals.entries()) {
      const sealed = expected.payload as SealedReviewSnapshotPayload;
      const event = await findVerifiedReviewSnapshotEvent({ events: primary.events, projectId: state.projectId, snapshotKey: sealed.snapshotKey });
      expect(event).toEqual(expected);
      expect(sealedReviewSnapshotMetadata(event!)).toMatchObject({
        sealed: true, calculationModelVersion: "v229", professionalCredentialStatus: "unverified",
      });
      const verification = sealed.snapshot.verification;
      expect(verification.approvalStatus).toBe("unverified");
      expect(verification.limitations).toEqual(expect.arrayContaining([
        expect.stringMatching(/공식 경계.*미확인/), expect.stringMatching(/인허가.*미확인/), expect.stringMatching(/전문가 승인.*미확인/),
      ]));
      const expectedRecord = index === 0 ? state.adopted : state.removed;
      expect(sealed.snapshot.planningScenario).toEqual(expectedRecord.payload.planningScenarios[0]);
      expect(sealed.snapshot.data.scenarios).toEqual(expectedRecord.payload.projectData.scenarios);
      if (index === 0) {
        expect(verification.checks.find(check => check.id === "binding.full-quote-cost")?.status).toBe("checked");
        expect(sealed.snapshot.data.scenarios[0].hardCost).toBe(Math.round(state.quotedTotalWon / 10_000));
      }
      expect(await findVerifiedReviewSnapshotEvent({ events: other.events, projectId: state.projectId, snapshotKey: sealed.snapshotKey })).toBeNull();
      const tampered = structuredClone(event!);
      (tampered.payload as SealedReviewSnapshotPayload).snapshot.planningScenario!.constructionQuote!.reference += " tampered";
      expect(await findVerifiedReviewSnapshotEvent({ events: [tampered], projectId: state.projectId, snapshotKey: sealed.snapshotKey })).toBeNull();
    }
    expect(await databaseRows(state.projectId, state.orgId, state.otherOrgId)).toEqual(state.databaseRows);
    if (target.phase === "initial") {
      const encoded = JSON.stringify({ state, sha256: digest(state) });
      expect(Buffer.byteLength(encoded)).toBeLessThan(MAX_STATE_BYTES);
      const file = await open(target.statePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(encoded + "\n"); await file.sync(); } finally { await file.close(); }
    }
  }, 120_000);
});
