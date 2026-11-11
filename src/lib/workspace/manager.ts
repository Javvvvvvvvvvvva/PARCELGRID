"use client";
import { create } from "zustand";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { setActiveStoredParcel, type StoredParcel } from "@/lib/hooks/use-dynamic-project";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import { detachTransferredSourceDocuments } from "@/lib/handoff/project-transfer";
import { captureWorkspace, applyWorkspace } from "./state";
import { readLegacyValues, migrateLegacy } from "./legacy";
import { documentFromRecord, emptyWorkspace, exportWorkspace, importWorkspace, invalidateWorkspaceResults, type WorkspaceDocument, type WorkspaceRecord } from "./document";
import type { WorkspaceDatabase } from "./database";

type SaveStatus = "idle" | "loading" | "saved" | "saving" | "error" | "conflict";
interface WorkspaceStatus { projectId: string | null; status: SaveStatus; message: string; savedAt: string; canUndo: boolean; canRedo: boolean; legacyIssues: string[] }
export const useWorkspaceStatus = create<WorkspaceStatus>(() => ({ projectId: null, status: "idle", message: "", savedAt: "", canUndo: false, canRedo: false, legacyIssues: [] }));
const persistedFields = ["envelopePlan", "planningScenarios", "selectedPlanningScenarioId", "representativePlanningScenarioId", "representativeGeometrySnapshot", "draftAssumptions", "draftAcquisitionPrices", "financialSources", "stage3FeasibilitySnapshots"] as const;
type PlanEdit = Pick<WorkspaceDocument["payload"], "planningScenarios" | "selectedScenarioId">;
const planInputs = (plans: WorkspaceDocument["payload"]["planningScenarios"]) => JSON.stringify(plans.map(plan => Object.fromEntries(Object.entries(plan).filter(([key]) => !["checks", "economicsPreview", "updatedAt", "status", "version"].includes(key)))));
const message = (error: unknown) => error instanceof Error ? error.message : "저장 공간과 브라우저 저장 권한을 확인해주세요.";

export class WorkspaceManager {
  private database?: WorkspaceDatabase;
  private initialization?: Promise<WorkspaceDatabase>;
  private row?: WorkspaceRecord;
  private intake: StoredParcel | null = null;
  private pending?: WorkspaceDocument;
  private flight?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribers: (() => void)[] = [];
  private paused = false;
  private suppress = false;
  private sequence = 0;
  private undoStack: PlanEdit[] = [];
  private redoStack: PlanEdit[] = [];
  private groupStarted = false;
  private channel?: BroadcastChannel;

  async initialize(): Promise<WorkspaceDatabase> {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      const { workspaceDatabase } = await import("./database");
      const db = workspaceDatabase(); this.database = db;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([db.open(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("저장소 연결이 지연됩니다. 이 사이트의 다른 탭을 닫고 다시 시도하세요.")), 8000); })]);
      } catch (error) { db.close(); throw error; } finally { clearTimeout(timeout); }
      let values;
      try { values = readLegacyValues(); } catch { useWorkspaceStatus.setState({ legacyIssues: ["기존 브라우저 자료에 접근하지 못했습니다. 원래 저장소는 변경하지 않았습니다."] }); }
      if (values) useWorkspaceStatus.setState({ legacyIssues: await migrateLegacy(db, values) });
      if (!this.channel && typeof BroadcastChannel !== "undefined") {
        this.channel = new BroadcastChannel("parcelgrid-workspace-updates");
        this.channel.onmessage = event => { if (event.data?.projectId === this.row?.projectId && event.data.revision !== this.row?.revision) void this.checkForUpdates(); };
      }
      return db;
    })().catch(error => { this.initialization = undefined; throw error; });
    return this.initialization;
  }
  private publish(row: WorkspaceRecord) { this.channel?.postMessage({ projectId: row.projectId, revision: row.revision }); }
  private report(error: unknown) {
    this.paused = true;
    useWorkspaceStatus.setState({ status: error instanceof Error && error.name === "WorkspaceConflictError" ? "conflict" : "error", message: message(error) });
  }
  private listen() {
    this.unsubscribers = [useProjectStore.subscribe((state, previous) => {
      if (this.suppress || !this.row || !persistedFields.some(key => state[key] !== previous[key])) return;
      if (state.planningScenarios !== previous.planningScenarios && planInputs(state.planningScenarios) !== planInputs(previous.planningScenarios)) {
        if (!this.groupStarted) {
          this.undoStack.push(structuredClone({ planningScenarios: previous.planningScenarios.filter(s => s.projectId === this.row!.projectId), selectedScenarioId: previous.selectedPlanningScenarioId }));
          this.undoStack = this.undoStack.slice(-30); this.groupStarted = true;
        }
        this.redoStack = [];
      }
      this.changed();
    }), useReviewStore.subscribe(() => { if (!this.suppress && this.row) this.changed(); })];
  }
  private changed() {
    if (!this.row) return;
    this.pending = captureWorkspace(this.row.projectId, this.intake);
    clearTimeout(this.timer);
    useWorkspaceStatus.setState({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0,
      ...(!this.paused ? { status: "saving", message: "" } : {}) });
    if (!this.paused) this.timer = setTimeout(() => { this.groupStarted = false; void this.flush().catch(() => undefined); }, 400);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    // All callers join one drain. Its loop reads the latest queued edit after each commit.
    if (this.flight) return this.flight;
    if (!this.pending) return;
    if (this.paused) throw new Error(useWorkspaceStatus.getState().message || "저장을 완료한 뒤 이동해주세요.");
    this.flight = (async () => {
      while (this.pending && this.row && this.database) {
        if (this.paused) throw new Error(useWorkspaceStatus.getState().message);
        const pending = this.pending, revision = this.row.revision;
        this.pending = undefined;
        try {
          const saved = await this.database.save(pending, revision);
          this.row = saved; this.publish(saved);
          useWorkspaceStatus.setState({ status: this.pending ? "saving" : "saved", savedAt: saved.savedAt, message: "" });
        } catch (error) { this.pending ??= pending; this.report(error); throw error; }
      }
    })();
    try { await this.flight; } finally { this.flight = undefined; }
  }
  async open(projectId: string | null): Promise<void> {
    const sequence = ++this.sequence;
    try {
      await this.flush();
      if (sequence !== this.sequence) return;
      this.unsubscribers.splice(0).forEach(fn => fn()); this.row = undefined;
      this.pending = undefined; this.paused = false; this.undoStack = []; this.redoStack = []; this.groupStarted = false;
      useWorkspaceStatus.setState({ projectId: null, status: "loading", message: "", canUndo: false, canRedo: false });
      const db = await this.initialize();
      if (sequence !== this.sequence) return;
      if (!projectId) { setActiveStoredParcel(null); useWorkspaceStatus.setState({ status: "idle" }); return; }
      let row = await db.load(projectId);
      if (!row && projectId === DEMO_PROJECT_ID) row = await db.save(emptyWorkspace(projectId), null, "예시 부지 시작");
      if (!row) throw new Error("이 브라우저에 저장된 부지가 없습니다. 저장한 프로젝트를 열거나 부지를 다시 선택하세요.");
      if (sequence !== this.sequence) return;
      this.row = row; this.intake = row.intake;
      applyWorkspace(row); setActiveStoredParcel(row.intake); this.listen();
      useWorkspaceStatus.setState({ projectId, status: "saved", savedAt: row.savedAt, message: "" });
    } catch (error) { if (sequence === this.sequence) this.report(error); }
  }
  async saveIntake(intake: StoredParcel): Promise<void> {
    await this.flush();
    if (this.paused) throw new Error(useWorkspaceStatus.getState().message);
    const db = await this.initialize();
    const previous = this.row?.projectId === intake.id ? this.row : await db.load(intake.id);
    let next = previous ? documentFromRecord(previous) : emptyWorkspace(intake.id);
    next = invalidateWorkspaceResults({ ...next, intake });
    next.payload.draftAcquisitionPrice = null; next.payload.financialSources = {}; next.payload.priceVerifications = {};
    const saved = await db.save(next, previous?.revision ?? null, "부지·취득대금 입력");
    if (this.row?.projectId === intake.id) {
      this.suppress = true;
      try { this.row = saved; this.intake = intake; applyWorkspace(saved); } finally { this.suppress = false; }
      useWorkspaceStatus.setState({ status: "saved", savedAt: saved.savedAt });
    }
    this.publish(saved); setActiveStoredParcel(intake);
  }
  async checkForUpdates() {
    if (!this.row || this.flight || !this.database) return;
    try {
      const latest = await this.database.projects.get(this.row.projectId);
      if (latest?.revision !== this.row.revision) {
        this.paused = true; clearTimeout(this.timer);
        useWorkspaceStatus.setState({ status: "conflict", message: "다른 탭의 저장본이 바뀌었습니다. 현재 탭을 백업하거나 최신 저장본을 열어주세요." });
      }
    } catch (error) { this.report(error); }
  }
  async retry() { this.paused = false; if (this.pending) await this.flush(); else await this.open(useWorkspaceStatus.getState().projectId); }
  async reload() {
    const id = this.row?.projectId;
    if (!id) return;
    // Called only by the explicit latest-version action, after the UI offers a backup.
    this.pending = undefined; this.paused = false; await this.open(id);
  }
  hasUnsavedChanges() { return Boolean(this.pending || this.flight); }
  async backup(projectId?: string) {
    let document: WorkspaceDocument | undefined;
    if (this.row && (!projectId || this.row.projectId === projectId)) document = captureWorkspace(this.row.projectId, this.intake);
    else { const row = await (await this.initialize()).load(projectId!); if (row) document = documentFromRecord(row); }
    if (!document) throw new Error("백업할 프로젝트가 없습니다.");
    return exportWorkspace(document);
  }
  async restore(serialized: string) {
    await this.flush();
    const incoming = await importWorkspace(serialized), db = await this.initialize();
    const current = this.row?.projectId === incoming.projectId ? this.row : await db.load(incoming.projectId);
    incoming.payload.financialSources = detachTransferredSourceDocuments(incoming.payload.financialSources);
    const saved = await db.restore(incoming, current?.revision ?? null);
    this.publish(saved);
    if (this.row?.projectId === saved.projectId) await this.open(saved.projectId);
    return saved.projectId;
  }
  async restoreVersion(revision: string) {
    if (!this.row) return;
    await this.flush();
    const previous = await this.database!.history.get([this.row.projectId, revision]);
    if (!previous) throw new Error("이 저장본은 더 이상 남아 있지 않습니다.");
    const saved = await this.database!.restore(documentFromRecord(previous), this.row.revision);
    this.publish(saved); await this.open(saved.projectId);
  }
  async history() { return this.row ? (await this.initialize()).versions(this.row.projectId) : []; }
  editHistory(direction: "undo" | "redo") {
    if (!this.row || this.paused) return;
    const from = direction === "undo" ? this.undoStack : this.redoStack, to = direction === "undo" ? this.redoStack : this.undoStack;
    const target = from.pop(); if (!target) return;
    const current = captureWorkspace(this.row.projectId, this.intake);
    to.push(structuredClone({ planningScenarios: current.payload.planningScenarios, selectedScenarioId: current.payload.selectedScenarioId }));
    const next = invalidateWorkspaceResults(current);
    next.payload.planningScenarios = target.planningScenarios.map(s => ({ ...s, version: Math.max(s.version, current.payload.planningScenarios.find(p => p.id === s.id)?.version ?? 0) + 1, updatedAt: new Date().toISOString(), status: "draft", economicsPreview: { ...s.economicsPreview, status: "stale" } }));
    next.payload.selectedScenarioId = target.selectedScenarioId;
    this.suppress = true; try { applyWorkspace(next, false); } finally { this.suppress = false; }
    this.groupStarted = false; this.changed();
  }
}
export const workspaceManager = new WorkspaceManager();
