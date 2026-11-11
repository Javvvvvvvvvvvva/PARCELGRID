import Dexie, { type Table } from "dexie";
import { documentFromRecord, invalidateWorkspaceResults, validateWorkspaceDocument, type WorkspaceDocument, type WorkspaceRecord } from "./document";

export const WORKSPACE_DB_NAME = "parcelgrid-workspaces";
export const HISTORY_LIMIT = 20;
export class WorkspaceConflictError extends Error {
  constructor() { super("다른 탭에서 더 최근 작업을 저장했습니다. 현재 작업을 백업한 뒤 최신 저장본을 열어주세요."); this.name = "WorkspaceConflictError"; }
}
export interface LegacyBackup { id: string; savedAt: string; values: Record<string, string | null>; issues: string[] }
export class WorkspaceDatabase extends Dexie {
  projects!: Table<WorkspaceRecord, string>;
  history!: Table<WorkspaceRecord, [string, string]>;
  legacyBackups!: Table<LegacyBackup, string>;
  constructor(name = WORKSPACE_DB_NAME) {
    super(name);
    this.version(1).stores({ projects: "&projectId,savedAt", history: "[projectId+revision],projectId,savedAt", legacyBackups: "&id,savedAt" });
    // Close old connections so an upgraded client can open. Never delete a DB on open/upgrade failure.
    this.on("versionchange", () => this.close());
  }
  async load(projectId: string): Promise<WorkspaceRecord | undefined> {
    const row = await this.projects.get(projectId);
    if (row) validateWorkspaceDocument(documentFromRecord(row));
    return row;
  }
  async save(document: WorkspaceDocument, expectedRevision: string | null, reason = "자동 저장"): Promise<WorkspaceRecord> {
    const valid = validateWorkspaceDocument(document);
    return this.transaction("rw", this.projects, this.history, async () => {
      const previous = await this.projects.get(valid.projectId);
      if ((previous?.revision ?? null) !== expectedRevision) throw new WorkspaceConflictError();
      const savedTime = Math.max(Date.now(), previous ? Date.parse(previous.savedAt) + 1 : 0);
      const row: WorkspaceRecord = { ...valid, revision: crypto.randomUUID(), savedAt: new Date(savedTime).toISOString(), reason };
      if (previous) await this.history.put(previous);
      await this.projects.put(row);
      const old = await this.history.where("projectId").equals(row.projectId).sortBy("savedAt");
      if (old.length > HISTORY_LIMIT) await this.history.bulkDelete(old.slice(0, old.length - HISTORY_LIMIT).map(item => [item.projectId, item.revision]));
      return row;
    });
  }
  async versions(projectId: string): Promise<WorkspaceRecord[]> {
    return (await this.history.where("projectId").equals(projectId).sortBy("savedAt")).reverse();
  }
  async restore(document: WorkspaceDocument, expectedRevision: string | null): Promise<WorkspaceRecord> {
    const next = invalidateWorkspaceResults(validateWorkspaceDocument(document));
    if (next.intake) next.intake.intakeRevision = crypto.randomUUID();
    return this.save(next, expectedRevision, "저장본 복구 · 대표안 재확정 필요");
  }
}
let database: WorkspaceDatabase | undefined;
export function workspaceDatabase() { return database ??= new WorkspaceDatabase(); }
