import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDatabase } from "@/lib/workspace/database";
import { WorkspaceManager, useWorkspaceStatus } from "@/lib/workspace/manager";
import { useProjectStore } from "@/lib/stores/project-store";
import { emptyWorkspace, documentFromRecord, importWorkspace } from "@/lib/workspace/document";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
const holder = vi.hoisted(() => ({ database: null as WorkspaceDatabase | null }));
vi.mock("@/lib/workspace/database", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/workspace/database")>(), workspaceDatabase: () => holder.database! }));
let manager: WorkspaceManager, db: WorkspaceDatabase, planId: string;
beforeEach(async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  db = new WorkspaceDatabase(`manager-test-${crypto.randomUUID()}`); holder.database = db;
  const document = emptyWorkspace("P-1");
  const plan = createBlankPlanningScenario({ projectId: document.projectId, name: "첫 계획" }); planId = plan.id;
  document.payload.planningScenarios = [plan]; document.payload.selectedScenarioId = plan.id;
  await db.save(document, null); manager = new WorkspaceManager(); await manager.open(document.projectId);
});
afterEach(async () => { vi.restoreAllMocks(); await manager.retry(); await manager.open(null); await db.delete(); vi.unstubAllGlobals(); });
const rename = (name: string) => useProjectStore.getState().editPlanningScenarioDraft(planId, { name });
const nameInStore = () => useProjectStore.getState().planningScenarios[0].name;

describe("workspace editor coordination", () => {
  it("drains edits arriving during a commit and joins simultaneous flush callers", async () => {
    const save = db.save.bind(db); let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(db, "save").mockImplementationOnce(async (...args) => { started(); await gate; return save(...args); });
    rename("첫 저장"); const first = manager.flush(); await entered;
    expect(useWorkspaceStatus.getState().status).toBe("saving");
    rename("저장 도중 추가 편집"); const second = manager.flush(); release(); await Promise.all([first, second]);
    expect((await db.load("P-1"))?.payload.planningScenarios[0].name).toBe("저장 도중 추가 편집");
    expect(useWorkspaceStatus.getState().status).toBe("saved"); expect(manager.hasUnsavedChanges()).toBe(false);
  });

  it("keeps unsaved edits available for backup and retry after quota failure", async () => {
    const previous = await db.load("P-1");
    vi.spyOn(db, "save").mockRejectedValueOnce(new DOMException("Synthetic quota failure", "QuotaExceededError"));
    rename("잃어버리면 안 되는 편집"); await expect(manager.flush()).rejects.toThrow("quota");
    expect(useWorkspaceStatus.getState().status).toBe("error"); expect(await db.load("P-1")).toEqual(previous);
    expect((await importWorkspace(await manager.backup())).payload.planningScenarios[0].name).toBe("잃어버리면 안 되는 편집");
    await manager.retry(); expect(useWorkspaceStatus.getState().status).toBe("saved");
    expect((await db.load("P-1"))?.payload.planningScenarios[0].name).toBe(nameInStore());
  });

  it("preserves the local tab on conflict until the user explicitly opens the latest version", async () => {
    const previous = (await db.load("P-1"))!, elsewhere = documentFromRecord(structuredClone(previous));
    elsewhere.payload.planningScenarios[0].name = "다른 탭 저장"; await db.save(elsewhere, previous.revision);
    rename("내 탭 수정"); await expect(manager.flush()).rejects.toThrow("다른 탭");
    expect(nameInStore()).toBe("내 탭 수정"); expect(useWorkspaceStatus.getState().status).toBe("conflict");
    expect((await importWorkspace(await manager.backup())).payload.planningScenarios[0].name).toBe("내 탭 수정");
    await manager.reload(); expect(nameInStore()).toBe("다른 탭 저장"); expect(useWorkspaceStatus.getState().status).toBe("saved");
  });

  it("undoes and redoes only plan inputs while invalidating representative approvals", async () => {
    const originalVersion = useProjectStore.getState().planningScenarios[0].version;
    rename("계획 변경"); useProjectStore.getState().setDraftAcquisitionPrice("P-1", 12345);
    manager.editHistory("undo"); expect(nameInStore()).toBe("첫 계획"); expect(useProjectStore.getState().draftAcquisitionPrices["P-1"]).toBe(12345);
    expect(useProjectStore.getState().planningScenarios[0].version).toBeGreaterThan(originalVersion);
    expect(useProjectStore.getState().representativePlanningScenarioId).toBeNull();
    manager.editHistory("redo"); expect(nameInStore()).toBe("계획 변경"); await manager.flush();
    expect((await db.load("P-1"))?.payload.planningScenarios[0].name).toBe("계획 변경");
  });

  it("flushes the old project before changing projects and resets edit history", async () => {
    const other = emptyWorkspace("P-2"); other.payload.draftAcquisitionPrice = 6789; await db.save(other, null);
    rename("이동 직전 수정"); await manager.open("P-2");
    expect((await db.load("P-1"))?.payload.planningScenarios[0].name).toBe("이동 직전 수정");
    expect(useProjectStore.getState().planningScenarios).toEqual([]);
    expect(useProjectStore.getState().draftAcquisitionPrices).toEqual({ "P-2": 6789 });
    expect(useWorkspaceStatus.getState().canUndo).toBe(false);
  });
});
