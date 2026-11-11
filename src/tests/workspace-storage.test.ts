import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { WorkspaceDatabase, WorkspaceConflictError, HISTORY_LIMIT } from "@/lib/workspace/database";
import { documentFromRecord, emptyWorkspace, exportWorkspace, importWorkspace, validateWorkspaceDocument, type WorkspaceDocument } from "@/lib/workspace/document";
import { migrateLegacy, prepareLegacy } from "@/lib/workspace/legacy";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import type { StoredParcel } from "@/lib/hooks/use-dynamic-project";
import { interiorFixture } from "./helpers/interior-fixture";
import { applyInteriorToFloor, isInteriorFinanceCurrent } from "@/lib/planning/interior/finance";

const databases: Dexie[] = [];
function database(name = `workspace-test-${crypto.randomUUID()}`) { const db = new WorkspaceDatabase(name); databases.push(db); return db; }
afterEach(async () => { const names = new Set(databases.map(db => db.name)); databases.splice(0).forEach(db => db.close()); for (const name of names) await Dexie.delete(name); });

function fixture(projectId = "P-1"): WorkspaceDocument {
  const intake: StoredParcel = { id: projectId, address: "서울 도봉구 검증 부지", addressRoad: null, lat: 37.65, lng: 127.02, lawdCd: "11320", pnu: null, lotArea: 120,
    zoning: "제2종일반주거지역", zoneCode: "UQA122", maxFAR: 200, maxBCR: 60, heightLimit: 0, landPrice: 1000000, landPriceYear: "2026", acquired: "2026-10-08", acquiredPrice: null,
    intakeRevision: "original-intake", boundary: [[127.02, 37.65], [127.021, 37.65], [127.02, 37.651]] };
  const result = emptyWorkspace(projectId, intake), scenario = createBlankPlanningScenario({ projectId, name: "수정 전 계획" });
  result.payload.planningScenarios = [scenario]; result.payload.selectedScenarioId = scenario.id;
  return result;
}

describe("durable project workspaces", () => {
  it("isolates projects and reopens committed inputs through a new connection", async () => {
    const db = database(), a = await db.save(fixture(), null), b = await db.save(fixture("P-2"), null);
    const reopened = database(db.name);
    const next = documentFromRecord(a); next.payload.planningScenarios[0].name = "P-1만 수정";
    await db.save(next, a.revision);
    expect((await reopened.load("P-1"))?.payload.planningScenarios[0].name).toBe("P-1만 수정");
    expect(await reopened.load("P-2")).toEqual(b);
  });

  it("rejects one of two simultaneous writes instead of silently overwriting", async () => {
    const first = database(), initial = await first.save(fixture(), null), second = database(first.name);
    const a = documentFromRecord(structuredClone(initial)), b = documentFromRecord(structuredClone(initial));
    a.payload.planningScenarios[0].name = "탭 A"; b.payload.planningScenarios[0].name = "탭 B";
    const results = await Promise.allSettled([first.save(a, initial.revision), second.save(b, initial.revision)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(WorkspaceConflictError);
    expect(await first.versions(initial.projectId)).toHaveLength(1);
  });

  it("rolls back both project and history when a write runs out of space", async () => {
    const db = database(), initial = await db.save(fixture(), null);
    const fail = () => { throw new DOMException("Synthetic disk full", "QuotaExceededError"); };
    db.projects.hook("updating", fail);
    await expect(db.save(fixture(), initial.revision)).rejects.toThrow("Synthetic disk full");
    expect(await db.load(initial.projectId)).toEqual(initial);
    expect(await db.versions(initial.projectId)).toHaveLength(0);
    db.projects.hook("updating").unsubscribe(fail);
    await expect(db.save(fixture(), initial.revision)).resolves.toMatchObject({ projectId: initial.projectId });
  });

  it("keeps the latest 20 predecessors and restores inputs with fresh approvals", async () => {
    const db = database(), original = fixture();
    original.payload.expertReviews.architect = { discipline: "architect", status: "approved", reviewer: "검토자", organization: "사무소", evidenceRef: "DOC", notes: "검토", reviewedAt: "2026-10-08", updatedAt: "2026-10-08", snapshotKey: "old-approval" };
    original.payload.priceVerifications.acquisition = { projectId: original.projectId, target: "acquisition", status: "verified", selectedComps: [], medianPricePerPyeongManwon: 100,
      adjustmentPct: 0, verifiedPricePerPyeongManwon: 100, verifiedTotalManwon: 1000, verifiedPricePerSqmWon: 300000, reviewer: "가격 검토자", organization: "사무소", rationale: "비교사례", verifiedAt: "2026-10-08", updatedAt: "2026-10-08" };
    let row = await db.save(original, null);
    for (let n = 1; n <= 24; n++) { const next = documentFromRecord(structuredClone(row)); next.payload.planningScenarios[0].name = `변경 ${n}`; row = await db.save(next, row.revision); }
    const history = await db.versions(row.projectId);
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0].payload.planningScenarios[0].name).toBe("변경 23");
    expect(history.at(-1)?.payload.planningScenarios[0].name).toBe("변경 4");
    const restored = await db.restore(documentFromRecord(history[0]), row.revision);
    expect(restored.intake?.boundary).toEqual(original.intake?.boundary);
    expect(restored.intake?.intakeRevision).not.toBe(original.intake?.intakeRevision);
    expect(restored.payload.expertReviews.architect).toMatchObject({ status: "requested", snapshotKey: undefined });
    expect(restored.payload.priceVerifications.acquisition).toMatchObject({ status: "review-requested", verifiedAt: "" });
    expect(restored.payload.representativeGeometry).toBeNull(); expect(restored.payload.stage3Snapshot).toBeNull();
    expect((await db.versions(row.projectId))[0].revision).toBe(row.revision);
  });

  it("migrates old project-scoped records once while preserving exact originals", async () => {
    const db = database(), a = fixture(), b = fixture("P-2");
    const values = { draft: JSON.stringify(a.intake), envelope: JSON.stringify({ version: 0, state: { planningScenarios: [...a.payload.planningScenarios, ...b.payload.planningScenarios], selectedPlanningScenarioId: b.payload.selectedScenarioId } }), review: null };
    expect(await migrateLegacy(db, values)).toEqual([]);
    expect((await db.load("P-1"))?.payload.planningScenarios).toHaveLength(1);
    expect((await db.load("P-2"))?.intake).toBeNull();
    const first = (await db.load("P-1"))!, next = documentFromRecord(structuredClone(first)); next.intake!.address = "더 최근 부지";
    const saved = await db.save(next, first.revision);
    await migrateLegacy(db, values);
    expect(await db.load("P-1")).toEqual(saved);
    const backups = await db.legacyBackups.toArray(); expect(backups).toHaveLength(2);
    expect(backups.find(v => v.id.startsWith("local-"))?.values.envelope).toBe(values.envelope);
    expect(backups.find(v => v.id.startsWith("session-"))?.values.draft).toBe(values.draft);
  });

  it("rolls back an interrupted migration and can retry without duplicate originals", async () => {
    const db = database(), project = fixture(), values = { envelope: JSON.stringify({ state: { planningScenarios: project.payload.planningScenarios }, version: 0 }), review: null, draft: JSON.stringify(project.intake) };
    const fail = () => { throw new Error("Interrupted migration"); }; db.projects.hook("creating", fail);
    await expect(migrateLegacy(db, values)).rejects.toThrow("Interrupted migration");
    expect(await db.legacyBackups.count()).toBe(0); expect(await db.projects.count()).toBe(0);
    db.projects.hook("creating").unsubscribe(fail); await migrateLegacy(db, values);
    expect(await db.projects.count()).toBe(1); expect(await db.legacyBackups.count()).toBe(2);
  });

  it("retains corrupt/future/unscoped legacy data without guessing its project", async () => {
    const db = database(), future = { envelope: '{"version":99,"state":{}}', review: "{broken", draft: null };
    expect(await migrateLegacy(db, future)).toHaveLength(2); expect(await db.projects.count()).toBe(0);
    expect((await db.legacyBackups.toArray())[0].values).toEqual({ envelope: future.envelope, review: future.review });
    const orphan = createBlankPlanningScenario({ name: "소속 부지 미상" });
    const prepared = prepareLegacy({ envelope: JSON.stringify({ version: 0, state: { planningScenarios: [orphan] } }), review: null, draft: null });
    expect(prepared.documents).toEqual([]); expect(prepared.issues[0]).toContain("부지 ID가 없는");
  });

  it("round-trips a checksum-bound backup and rejects changed, future, and mixed-project content", async () => {
    const original = fixture(), serialized = await exportWorkspace(original);
    expect(await importWorkspace(serialized)).toEqual(JSON.parse(JSON.stringify(original)));
    const damaged = JSON.parse(serialized); damaged.data = damaged.data.replace("수정 전 계획", "손상된 계획");
    await expect(importWorkspace(JSON.stringify(damaged))).rejects.toThrow("손상");
    expect(() => validateWorkspaceDocument({ ...original, schemaVersion: 2 })).toThrow("버전");
    const mixed = fixture(); mixed.payload.planningScenarios[0].projectId = "P-2";
    expect(() => validateWorkspaceDocument(mixed)).toThrow("다른 부지");
    const poison = JSON.parse(JSON.stringify(original)); poison.payload.draftAssumptions = JSON.parse('{"__proto__":{}}');
    expect(() => validateWorkspaceDocument(poison)).toThrow("저장 키");
    expect(() => validateWorkspaceDocument({ ...original, payload: { ...original.payload, expertReviews: { architect: { status: "approved" } } } })).toThrow("형식");
  });

  it("refuses a future document without changing the database", async () => {
    const db = database(), row = await db.save(fixture(), null);
    await db.projects.update(row.projectId, { schemaVersion: 2 as 1 });
    await expect(db.load(row.projectId)).rejects.toThrow("버전");
    expect((await db.projects.get(row.projectId))?.schemaVersion).toBe(2);
  });

  it("preserves geometry and interior-finance signatures across validation, persistence and backup", async () => {
    const db = database(), { scenario, layout, initial, build } = interiorFixture();
    scenario.floorPrograms[0] = applyInteriorToFloor(scenario.floorPrograms[0], layout, initial.building.floors[0].shape);
    expect(isInteriorFinanceCurrent(scenario.floorPrograms[0])).toBe(true);
    const document = emptyWorkspace(scenario.projectId!);
    document.payload.planningScenarios = [scenario]; document.payload.selectedScenarioId = scenario.id;
    document.payload.representativeScenarioId = scenario.id; document.payload.representativeGeometry = build();
    await db.save(document, null);
    const reopened = (await database(db.name).load(document.projectId))!;
    expect(JSON.stringify(reopened.payload.representativeGeometry)).toBe(JSON.stringify(document.payload.representativeGeometry));
    expect(isInteriorFinanceCurrent(reopened.payload.planningScenarios[0].floorPrograms[0])).toBe(true);
    const backup = await importWorkspace(await exportWorkspace(documentFromRecord(reopened)));
    expect(isInteriorFinanceCurrent(backup.payload.planningScenarios[0].floorPrograms[0])).toBe(true);
    expect(backup.payload.planningScenarios[0].floorPrograms[0].interior).toEqual(layout);
  });
});
