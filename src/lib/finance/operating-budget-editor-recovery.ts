"use client";

import { clientSession } from "@/lib/auth/client-session";
import { buildOperatingBudgetDraftKey, type OperatingBudgetDraft } from "./operating-budget-contract";

export interface OperatingBudgetEditorRecovery {
  draft: OperatingBudgetDraft;
  savedKey: string;
  cleanKey: string;
  invalidNumbers: Record<string, boolean>;
}

// Invalid unfinished edits stay in this tab, outside the validated server contract.
const drafts = new Map<string, OperatingBudgetEditorRecovery>();
clientSession.subscribe(() => drafts.clear());

export function readOperatingBudgetEditorRecovery(projectId: string, scenarioId: string): OperatingBudgetEditorRecovery | null {
  if (!clientSession.active) return null;
  const value = drafts.get(buildOperatingBudgetDraftKey(projectId, scenarioId));
  return value ? structuredClone(value) : null;
}

export function writeOperatingBudgetEditorRecovery(value: OperatingBudgetEditorRecovery): void {
  clientSession.assertActive();
  drafts.set(buildOperatingBudgetDraftKey(value.draft.projectId, value.draft.scenarioId), structuredClone(value));
}

export function clearOperatingBudgetEditorRecovery(projectId: string, scenarioId: string): void {
  drafts.delete(buildOperatingBudgetDraftKey(projectId, scenarioId));
}
