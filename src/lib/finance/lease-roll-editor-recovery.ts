"use client";

import { clientSession } from "@/lib/auth/client-session";
import { buildLeaseRollDraftKey, type LeaseRollDraft } from "./lease-roll-contract";

export interface LeaseRollEditorRecovery {
  draft: LeaseRollDraft;
  savedKey: string;
  cleanKey: string;
  invalidNumbers: Record<string, boolean>;
}

// In-memory per-tab recovery only: invalid unfinished edits never enter a server contract.
const drafts = new Map<string, LeaseRollEditorRecovery>();
clientSession.subscribe(() => drafts.clear());

export function readLeaseRollEditorRecovery(projectId: string, scenarioId: string): LeaseRollEditorRecovery | null {
  if (!clientSession.active) return null;
  const draft = drafts.get(buildLeaseRollDraftKey(projectId, scenarioId));
  return draft ? structuredClone(draft) : null;
}

export function writeLeaseRollEditorRecovery(value: LeaseRollEditorRecovery): void {
  clientSession.assertActive();
  drafts.set(buildLeaseRollDraftKey(value.draft.projectId, value.draft.scenarioId), structuredClone(value));
}

export function clearLeaseRollEditorRecovery(projectId: string, scenarioId: string): void {
  drafts.delete(buildLeaseRollDraftKey(projectId, scenarioId));
}
