"use client";

import { sessionFetch as fetch } from "@/lib/auth/client-session";
import { clientSession } from "@/lib/auth/client-session";
import { clearWorkspaceDraft, readWorkspaceDraft, writeWorkspaceDraft } from "@/lib/workspace/workspace-draft";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import {
  hashProjectWorkspacePayload,
  validateProjectWorkspaceRecord,
  type ProjectWorkspaceRecord,
} from "@/lib/workspace/project-workspace";
import { captureProjectWorkspace } from "@/lib/workspace/project-workspace-client";
import {
  principalHasCapability,
  useAccessSession,
} from "@/lib/hooks/use-access-session";

export type ProjectWorkspaceSyncStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "conflict"
  | "error"
  | "read-only";

const SAVE_DEBOUNCE_MS = 2_000;

async function saveWorkspace(
  projectId: string,
  baseRevision: number,
  payload: NonNullable<ReturnType<typeof captureProjectWorkspace>>,
  signal: AbortSignal,
): Promise<ProjectWorkspaceRecord | null> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision, payload }),
      signal,
    },
  );
  const result = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & {
        code?: string;
        error?: string;
        currentRevision?: number;
      })
    | null;
  if (response.status === 409) {
    const conflict = new Error(
      result?.error ?? "다른 사용자가 프로젝트를 먼저 저장했습니다.",
    );
    conflict.name = "ProjectWorkspaceConflict";
    throw conflict;
  }
  if (!response.ok) {
    throw new Error(result?.error ?? `프로젝트 자동 저장 실패 (${response.status})`);
  }
  const validation = validateProjectWorkspaceRecord(result, projectId);
  if (!validation.valid || !validation.record) {
    throw new Error(validation.errors.join(" "));
  }
  const actualHash = await hashProjectWorkspacePayload(
    validation.record.payload,
  );
  if (actualHash !== validation.record.payloadHash) {
    throw new Error("저장된 Workspace 응답의 SHA-256이 일치하지 않습니다.");
  }
  return validation.record;
}

export function useProjectWorkspaceSync(input: {
  projectId: string;
  initialRecord: ProjectWorkspaceRecord | null;
  enabled: boolean;
}) {
  const accessSession = useAccessSession();
  const canUpdate = principalHasCapability(
    accessSession.data,
    "project.update",
  );
  const [status, setStatus] = useState<ProjectWorkspaceSyncStatus>("idle");
  const [record, setRecord] = useState<ProjectWorkspaceRecord | null>(
    input.initialRecord,
  );
  const [error, setError] = useState<string | null>(null);
  const revisionRef = useRef(input.initialRecord?.revision ?? 0);
  const savedHashRef = useRef(input.initialRecord?.payloadHash ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const conflictRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const editRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    savingRef.current = false;
    pendingRef.current = false;
    const next = input.initialRecord;
    const draft = input.enabled ? readWorkspaceDraft(input.projectId) : null;
    revisionRef.current = draft?.baseRevision ?? next?.revision ?? 0;
    savedHashRef.current = next?.payloadHash ?? "";
    const conflict = Boolean(draft && draft.baseRevision !== (next?.revision ?? 0));
    conflictRef.current = conflict;
    setRecord(next);
    setError(conflict ? "복구한 로컬 초안의 기준 revision과 서버 최신본이 다릅니다. 로컬 사본을 보존하고 대사해 주세요." : null);
    setStatus(conflict ? "conflict" : canUpdate ? (draft ? "dirty" : next ? "saved" : "idle") : "read-only");
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      requestRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [canUpdate, input.enabled, input.initialRecord, input.projectId]);

  const runSave = useCallback(async () => {
    if (!mountedRef.current || !clientSession.active || !input.enabled || !canUpdate || conflictRef.current) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    const payload = captureProjectWorkspace(input.projectId);
    if (!payload) return;
    const generation = generationRef.current;
    const edit = editRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const isCurrent = () => mountedRef.current && clientSession.active &&
      generationRef.current === generation && !controller.signal.aborted;
    // Acquire before hashing; edits during WebCrypto must queue, not race a PUT.
    savingRef.current = true;
    pendingRef.current = false;
    if (mountedRef.current) {
      setStatus("saving");
      setError(null);
    }
    try {
      const currentHash = await hashProjectWorkspacePayload(payload);
      if (!isCurrent()) return;
      if (currentHash === savedHashRef.current) {
        if (edit === editRef.current) { clearWorkspaceDraft(input.projectId); setStatus("saved"); }
        else setStatus("dirty");
        return;
      }
      const next = await saveWorkspace(input.projectId, revisionRef.current, payload, controller.signal);
      if (!next || !isCurrent()) return;
      revisionRef.current = next.revision;
      savedHashRef.current = next.payloadHash;
      if (mountedRef.current) {
        setRecord(next);
        if (edit === editRef.current) {
          clearWorkspaceDraft(input.projectId);
          setStatus("saved");
        } else {
          const latest = captureProjectWorkspace(input.projectId);
          if (latest) writeWorkspaceDraft(latest, next.revision);
          setStatus("dirty");
        }
      }
    } catch (saveError) {
      if (!isCurrent()) return;
      const conflict =
        saveError instanceof Error &&
        saveError.name === "ProjectWorkspaceConflict";
      conflictRef.current = conflict;
      if (mountedRef.current) {
        setStatus(conflict ? "conflict" : "error");
        setError(
          saveError instanceof Error
            ? saveError.message
            : "프로젝트 자동 저장을 완료하지 못했습니다.",
        );
      }
    } finally {
      if (generationRef.current === generation) {
        savingRef.current = false;
        if (isCurrent() && pendingRef.current && !conflictRef.current) {
          pendingRef.current = false;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => { timerRef.current = null; void runSave(); }, 0);
        }
      }
    }
  }, [canUpdate, input.enabled, input.projectId]);

  const scheduleSave = useCallback(() => {
    if (!mountedRef.current || !clientSession.active || !input.enabled || !canUpdate) return;
    const payload = captureProjectWorkspace(input.projectId);
    if (!payload) return;
    editRef.current += 1;
    pendingRef.current = savingRef.current;
    let localCopyFailed = false;
    try {
      writeWorkspaceDraft(payload, revisionRef.current);
    } catch {
      localCopyFailed = true;
      setError("로컬 복구 사본 저장에 실패했습니다. 서버 저장을 확인하기 전 이 탭을 닫지 마세요.");
      setStatus("error");
    }
    if (conflictRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus((current) => localCopyFailed ? "error" : current === "saving" ? current : "dirty");
    const debounceMs = revisionRef.current === 0 ? 50 : SAVE_DEBOUNCE_MS;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSave();
    }, debounceMs);
  }, [canUpdate, input.enabled, input.projectId, runSave]);

  useEffect(() => {
    if (!input.enabled || !canUpdate) return;
    const unsubscribeProject = useProjectStore.subscribe(scheduleSave);
    const unsubscribeReview = useReviewStore.subscribe(scheduleSave);
    scheduleSave();
    return () => {
      unsubscribeProject();
      unsubscribeReview();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [canUpdate, input.enabled, scheduleSave]);

  const saveNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void runSave();
  }, [runSave]);

  const discardLocalDraft = useCallback(() => {
    conflictRef.current = true;
    generationRef.current += 1;
    requestRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
    clearWorkspaceDraft(input.projectId);
  }, [input.projectId]);

  useEffect(() => {
    if (!["dirty", "saving", "conflict", "error"].includes(status)) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [status]);

  return { status, record, error, saveNow, canUpdate, discardLocalDraft };
}
