"use client";

import { clientSession, sessionDraftStorage } from "@/lib/auth/client-session";
import { validateProjectWorkspacePayload, type ProjectWorkspacePayload } from "./project-workspace";

export interface WorkspaceDraft {
  version: 1;
  draftId: string;
  baseRevision: number;
  payload: ProjectWorkspacePayload;
}

// Per-tab recovery prevents two editors from overwriting each other's drafts.
const memory = new Map<string, WorkspaceDraft>();
clientSession.subscribe(() => memory.clear());
const key = (projectId: string) => `parcelgrid:workspace-draft:${projectId}`;

export function readWorkspaceDraft(projectId: string): WorkspaceDraft | null {
  if (!clientSession.active) return null;
  const current = memory.get(projectId);
  if (current) return current;
  const raw = sessionDraftStorage.getItem(key(projectId));
  if (!raw) return null;
  let draft: WorkspaceDraft;
  try { draft = JSON.parse(raw) as WorkspaceDraft; }
  catch { throw new Error("로컬 복구 초안 JSON을 읽지 못했습니다. 원본 보존과 복구가 필요합니다."); }
  if (!draft || draft.version !== 1 || typeof draft.draftId !== "string" ||
      !Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 0 ||
      !validateProjectWorkspacePayload(draft.payload, projectId).valid) {
    throw new Error("로컬 복구 초안을 검증하지 못했습니다. 원본을 보존한 뒤 복구가 필요합니다.");
  }
  memory.set(projectId, draft);
  return draft;
}

export function writeWorkspaceDraft(payload: ProjectWorkspacePayload, baseRevision: number): WorkspaceDraft {
  clientSession.assertActive();
  const draft: WorkspaceDraft = { version: 1, draftId: crypto.randomUUID(), payload, baseRevision };
  memory.set(payload.projectId, draft);
  sessionDraftStorage.setItem(key(payload.projectId), JSON.stringify(draft));
  return draft;
}

export function clearWorkspaceDraft(projectId: string): void {
  memory.delete(projectId);
  sessionDraftStorage.removeItem(key(projectId));
}
