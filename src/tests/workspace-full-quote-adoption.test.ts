import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessPrincipal } from "@/lib/auth/roles";
import { readAuditLedger } from "@/lib/audit/audit-ledger";
import {
  createQuoteAdoptionReviewDraft,
  evaluateQuoteAdoptionReview,
} from "@/lib/planning/construction-quote-adoption-review";
import { applyFullQuoteAdoption } from "@/lib/planning/full-quote-adoption";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { validateFullQuoteAdoptionTransitions } from "@/lib/workspace/full-quote-adoption-transition";
import {
  canonicalProjectWorkspaceJson,
  type ProjectWorkspacePayload,
} from "@/lib/workspace/project-workspace";
import {
  ProjectWorkspaceConflictError,
  ProjectWorkspaceIntegrityError,
  readProjectWorkspace,
  saveProjectWorkspace,
} from "@/lib/workspace/project-workspace-storage";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const database = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
  calls: [] as string[],
  writes: [] as unknown[],
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    transaction: async (callback: (tx: unknown) => unknown) => {
      database.calls.push("transaction");
      const query = {
        from: () => query, where: () => query, orderBy: () => query,
        limit: async () => { database.calls.push("revision"); return database.current ? [database.current] : []; },
      };
      return callback({
        execute: async () => { database.calls.push("lock"); },
        select: () => query,
        insert: () => ({ values: async (value: unknown) => { database.calls.push("write"); database.writes.push(value); } }),
      });
    },
  }),
}));
vi.mock("@/lib/audit/audit-ledger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/audit/audit-ledger")>(),
  appendAuditEventInTransaction: async () => {
    database.calls.push("audit");
    return { occurredAt: new Date().toISOString(), entryHash: "a".repeat(64) };
  },
}));

const TODAY = "2026-11-11";
const BASE = constructionQuoteFixture();

function fixture(adoptedOn = TODAY) {
  const f = structuredClone(BASE);
  const payload = projectWorkspaceFixture(f.projectId);
  payload.projectData = f.data;
  const plan = f.scenario;
  plan.status = "draft";
  payload.planningScenarios = [plan];
  const parcel = payload.projectData.parcel;
  parcel.boundaryPolygons = [{ outer: structuredClone(parcel.boundary!), holes: [] }];
  const assumptions = planningEconomicsAssumptionsFromLegacy(f.data.scenarios[0]._raw.assumptions);
  const calculation = calculatePlanningScenario(plan, {
    parcel: {
      address: parcel.address, zoning: parcel.zoning, zoningStatus: "user-entered",
      sunlightRuleAsOf: f.data.meta.lastSyncedAt.slice(0, 10),
      lotAreaSqm: parcel.lotArea, boundary: parcel.boundary, boundaryPolygons: parcel.boundaryPolygons,
      roads: parcel.roads, setback: parcel.setback, maxFARPct: parcel.maxFAR, maxBCRPct: parcel.maxBCR,
      heightLimitM: parcel.heightLimit ?? 0, regulatoryConstraints: parcel.regulatoryConstraints,
      roofAllowanceM: 1.4, acquisitionCostManwon: parcel.acquiredPrice, demolitionCostManwon: parcel.demolitionCost ?? 0,
    },
    assumptions, calculatedAt: f.data.meta.lastSyncedAt,
  });
  const geometry = buildPlanningGeometry({
    projectId: f.projectId, scenario: plan, boundary: parcel.boundary, boundaryPolygons: parcel.boundaryPolygons,
    lotAreaSqm: parcel.lotArea, zoning: parcel.zoning, roads: parcel.roads, setback: parcel.setback,
    sunlight: calculation.sunlight, roofAllowanceM: calculation.metrics.roofAllowanceM,
  }).snapshot;
  f.quote.lines[0].allocations = f.quote.coverage.filter(scope => scope.lineIds.includes("package"))
    .map(scope => ({ scopeId: scope.id, amountWon: 100_000, source: `Synthetic allocation ${scope.id}` }));
  const review = createQuoteAdoptionReviewDraft(plan, f.inputs, geometry);
  review.checkedOn = adoptedOn;
  review.scopes.forEach(scope => { scope.confirmed = true; scope.source = "Synthetic declaration only, no official approval"; });
  Object.assign(plan, applyFullQuoteAdoption(plan, f.inputs, geometry, review, adoptedOn));
  return { payload, plan, geometry, inputs: f.inputs, review };
}

function reordered<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reordered) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reordered(item)])) as T;
  }
  return value;
}

describe("workspace full quote adoption transitions", () => {
  afterEach(() => vi.useRealTimers());

  it("validates a current adoption with independently rebuilt planner geometry and preserves unverified approvals", () => {
    const { payload, plan, inputs, geometry, review } = fixture();
    const before = structuredClone(payload);
    expect(() => validateFullQuoteAdoptionTransitions(payload, undefined, TODAY)).not.toThrow();
    expect(payload).toEqual(before);
    expect(evaluateQuoteAdoptionReview(plan, inputs, geometry, review, TODAY))
      .toMatchObject({ status: "ready", approvalStatus: "unverified" });
    expect(() => validateFullQuoteAdoptionTransitions(reordered(payload), undefined, TODAY)).not.toThrow();
  });

  it("validates changed declarations rather than treating the same source key as unchanged", () => {
    const { payload, plan } = fixture();
    const previous = structuredClone(payload);
    plan.fullQuoteAdoption!.review.scopes[0].source += " revised";
    expect(() => validateFullQuoteAdoptionTransitions(payload, previous, TODAY)).not.toThrow();
    expect(() => validateFullQuoteAdoptionTransitions(payload, previous, "2026-11-12")).toThrow(/한국 기준 오늘/);
  });

  it.each(["totalWon", "replacedConstructionCostWon"] as const)("rejects a forged %s", field => {
    const { payload, plan } = fixture();
    plan.fullQuoteAdoption![field] += 100;
    plan.economicsPreview.constructionCostManwon = plan.fullQuoteAdoption!.totalWon / 10_000;
    expect(() => validateFullQuoteAdoptionTransitions(payload, undefined, TODAY)).toThrow();
  });

  it.each(["2026-11-10", "2026-11-12"])("rejects a new adoption dated %s", date => {
    expect(() => validateFullQuoteAdoptionTransitions(fixture(date).payload, undefined, TODAY)).toThrow(/한국 기준 오늘/);
  });

  it("reads a fresh Korea business date for each validation across midnight", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T14:59:59Z"));
    const { payload } = fixture("2026-11-10");
    expect(() => validateFullQuoteAdoptionTransitions(payload)).not.toThrow();
    vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
    expect(() => validateFullQuoteAdoptionTransitions(payload)).toThrow(/한국 기준 오늘/);
    expect(() => validateFullQuoteAdoptionTransitions(fixture().payload)).not.toThrow();
  });

  it("rejects expired adoption on promotion while accepting the identical historic contract", () => {
    const { payload, plan } = fixture();
    const previous = structuredClone(payload);
    payload.selectedScenarioId = plan.id;
    plan.name += " renamed";
    expect(() => validateFullQuoteAdoptionTransitions(reordered(payload), previous, "2026-12-01")).not.toThrow();
    plan.status = "saved";
    expect(() => validateFullQuoteAdoptionTransitions(payload, previous, "2026-12-01")).toThrow(/유효기간/);
  });

  it("rejects an expired quote with a forged current adoption date", () => {
    const { payload, plan } = fixture();
    plan.fullQuoteAdoption!.adoptedOn = "2026-12-01";
    plan.fullQuoteAdoption!.review.checkedOn = "2026-12-01";
    expect(() => validateFullQuoteAdoptionTransitions(payload, undefined, "2026-12-01")).toThrow();
  });

  it("allows historical adoption removal and removal of the whole plan", () => {
    const { payload, plan } = fixture();
    const previous = structuredClone(payload);
    delete plan.fullQuoteAdoption;
    expect(() => validateFullQuoteAdoptionTransitions(payload, previous, "2027-01-01")).not.toThrow();
    payload.planningScenarios = [];
    expect(() => validateFullQuoteAdoptionTransitions(payload, previous, "2027-01-01")).not.toThrow();
  });

  it.each(["floor", "placement", "version"])("rejects a new adoption after changing raw plan %s", field => {
    const { payload, plan, geometry } = fixture();
    payload.representativeGeometry = geometry;
    if (field === "floor") plan.floorPrograms[1].zones[0].areaSqm += 1;
    if (field === "placement") plan.placement.offsetXM += 0.1;
    if (field === "version") plan.version += 1;
    expect(() => validateFullQuoteAdoptionTransitions(payload, undefined, TODAY)).toThrow();
  });

  it.each(["boundary", "polygons", "roads", "zoning", "missing"])("rebuilds current parcel %s without trusting supplied geometry", field => {
    const { payload, geometry } = fixture();
    const parcel = payload.projectData.parcel;
    payload.representativeGeometry = geometry;
    if (field === "boundary") {
      delete parcel.boundaryPolygons;
      parcel.boundary!.forEach(point => { point[0] += 0.00001; });
    }
    if (field === "polygons") parcel.boundaryPolygons![0].outer.forEach(point => { point[0] += 0.00001; });
    if (field === "roads") parcel.roads![0].points[0][0] += 0.00001;
    if (field === "zoning") parcel.zoning = "제2종일반주거지역";
    if (field === "missing") parcel.boundaryPolygons = [];
    expect(() => validateFullQuoteAdoptionTransitions(payload, undefined, TODAY)).toThrow();
  });

  it("checks stored current assumptions and embedded quote evidence independently", () => {
    const { payload, plan } = fixture();
    payload.projectData.scenarios[0]._raw.assumptions.constCostPerSqM += 100;
    expect(() => validateFullQuoteAdoptionTransitions(payload, undefined, TODAY)).toThrow(/원가 입력/);
    payload.projectData.scenarios[0]._raw.assumptions.constCostPerSqM -= 100;
    plan.fullQuoteAdoption!.quote.reference += " different";
    expect(() => validateFullQuoteAdoptionTransitions(payload, undefined, TODAY)).toThrow(/현재 견적/);
  });

  it("uses recommended stored assumptions and falls back to defaults for a site-only scenario stub", () => {
    const { payload } = fixture();
    const decoy = structuredClone(payload.projectData.scenarios[0]);
    decoy.id = "OTHER";
    decoy.recommended = false;
    decoy._raw.assumptions.constCostPerSqM += 1_000;
    payload.projectData.scenarios.unshift(decoy);
    expect(() => validateFullQuoteAdoptionTransitions(payload, undefined, TODAY)).not.toThrow();
    payload.projectData.scenarios = [{ id: "STUB" }] as typeof payload.projectData.scenarios;
    expect(() => validateFullQuoteAdoptionTransitions(payload, undefined, TODAY)).not.toThrow();
  });

  it.each(["saved", "locked", "representative", "preview", "finance"])("keeps a changed plan as draft but blocks %s promotion or recomputation", action => {
    const { payload, plan, geometry } = fixture();
    const previous = structuredClone(payload);
    plan.floorPrograms[1].zones[0].areaSqm += 1;
    plan.economicsPreview.status = "stale";
    expect(() => validateFullQuoteAdoptionTransitions(payload, previous, TODAY)).not.toThrow();
    if (action === "saved") plan.status = "saved";
    if (action === "locked") plan.geometrySource = { mode: "engine-generated", exactGeometryAvailable: true, locked: true };
    if (action === "representative") {
      payload.representativeScenarioId = plan.id;
      payload.representativeGeometry = geometry;
    }
    if (action === "preview") plan.economicsPreview.status = "estimated";
    if (action === "finance") payload.projectData.scenarios[0].hardCost += 1;
    expect(() => validateFullQuoteAdoptionTransitions(payload, previous, TODAY)).toThrow();
  });
});

const principal: AccessPrincipal = {
  userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222",
  email: "analyst@example.com", name: "Workspace Analyst", organization: "Example", role: "analyst", reviewerRoles: [],
};

describe("workspace adoption storage enforcement", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "parcelgrid-adoption-"));
    vi.stubEnv("PROJECT_WORKSPACE_STORAGE_DIR", path.join(directory, "workspaces"));
    vi.stubEnv("AUDIT_LEDGER_STORAGE_DIR", path.join(directory, "audit"));
    vi.stubEnv("DATABASE_URL", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
    database.current = undefined;
    database.calls = [];
    database.writes = [];
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  const save = (payload: ProjectWorkspacePayload, baseRevision = 0) => saveProjectWorkspace({
    principal, projectId: payload.projectId, payload, baseRevision,
  });

  it("rejects invalid local transitions before audit/write and retains immutable historical saves", async () => {
    const { payload, plan } = fixture();
    const forged = structuredClone(payload);
    forged.planningScenarios[0].fullQuoteAdoption!.replacedConstructionCostWon += 1;
    await expect(save(forged)).rejects.toBeInstanceOf(ProjectWorkspaceIntegrityError);
    expect((await readAuditLedger({ orgId: principal.orgId })).events).toHaveLength(0);
    const first = await save(payload);
    expect(first.revision).toBe(1);
    vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
    plan.name += " historical label";
    await expect(save(payload, 1)).resolves.toMatchObject({ revision: 2 });
    plan.status = "saved";
    await expect(save(payload, 2)).rejects.toBeInstanceOf(ProjectWorkspaceIntegrityError);
    expect((await readAuditLedger({ orgId: principal.orgId })).events).toHaveLength(2);
    await expect(readProjectWorkspace({ orgId: principal.orgId, projectId: payload.projectId })).resolves.toMatchObject({ revision: 2 });
  });

  it.each(["local", "database"])("checks %s revision before live adoption validation", async backend => {
    const { payload, plan } = fixture();
    if (backend === "database") vi.stubEnv("DATABASE_URL", "postgresql://mock");
    else await save(payload);
    if (backend === "database") database.current = { revision: 1, payload, payloadHash: "b".repeat(64) };
    plan.placement.offsetXM += 1;
    await expect(save(payload)).rejects.toBeInstanceOf(ProjectWorkspaceConflictError);
    expect(database.calls).not.toContain("audit");
    expect(database.writes).toHaveLength(0);
  });

  it("validates under the database transaction lock before audit and insertion", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://mock");
    const { payload, plan } = fixture();
    const previous = structuredClone(payload);
    delete previous.planningScenarios[0].fullQuoteAdoption;
    database.current = { revision: 4, payload: previous, payloadHash: "b".repeat(64) };
    plan.placement.offsetXM += 1;
    await expect(save(payload, 4)).rejects.toBeInstanceOf(ProjectWorkspaceIntegrityError);
    expect(database.calls).toEqual(["transaction", "lock", "revision"]);
    plan.placement.offsetXM -= 1;
    database.calls = [];
    await expect(save(payload, 4)).resolves.toMatchObject({ revision: 5, backend: "postgresql" });
    expect(database.calls).toEqual(["transaction", "lock", "revision", "audit", "write"]);
    expect(database.writes).toHaveLength(1);
    expect(canonicalProjectWorkspaceJson(payload)).toBe(canonicalProjectWorkspaceJson((database.writes[0] as { payload: unknown }).payload));
  });
});
