"use client";

import { clientSession } from "@/lib/auth/client-session";
import { buildRevenuePricingDraftKey } from "@/lib/finance/revenue-contract";
import { buildExpertTaxContractKey } from "@/lib/finance/after-tax-ledger";
import { clearLeaseRollEditorRecovery } from "@/lib/finance/lease-roll-editor-recovery";
import { clearOperatingBudgetEditorRecovery } from "@/lib/finance/operating-budget-editor-recovery";
import { matchesProjectIntake } from "@/lib/services/project-intake";
import { useProjectStore } from "@/lib/stores/project-store";
import { captureProjectWorkspace, applyProjectWorkspace } from "@/lib/workspace/project-workspace-client";
import { canonicalProjectWorkspaceJson, validateProjectWorkspacePayload, type ProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { createProjectTransferBundle, prepareProjectTransferWorkspace, validateProjectTransferBundle, type ProjectTransferBundle } from "./project-transfer";

export function projectTransferWorkspaceKey(projectId: string): string | null {
  const workspace = captureProjectWorkspace(projectId);
  return workspace ? canonicalProjectWorkspaceJson(workspace) : null;
}

function assertTransferAccess(projectId: string, sessionContext: string | null, write: boolean) {
  clientSession.assertActive();
  if (!sessionContext || clientSession.context !== sessionContext ||
      useProjectStore.getState().data?.parcel.id !== projectId) {
    throw new Error("계정 또는 현재 프로젝트가 변경됐습니다.");
  }
  if (!clientSession.principal?.capabilities.includes(write ? "project.update" : "project.read")) {
    throw new Error("프로젝트 인계 권한이 없습니다.");
  }
}

export function captureProjectTransferBundle(projectId: string, sessionContext: string | null): ProjectTransferBundle {
  assertTransferAccess(projectId, sessionContext, false);
  const workspace = captureProjectWorkspace(projectId)!;
  const validation = validateProjectWorkspacePayload(workspace, projectId);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const bundle = createProjectTransferBundle({ projectId, payload: {
    projectData: workspace.projectData,
    envelopePlan: workspace.envelopePlan,
    planningScenarios: workspace.planningScenarios,
    selectedScenarioId: workspace.selectedScenarioId,
    representativeScenarioId: workspace.representativeScenarioId,
    representativeGeometry: workspace.representativeGeometry,
    draftAssumptions: workspace.draftAssumptions,
    draftAcquisitionPrice: workspace.draftAcquisitionPrice,
    financialSources: workspace.financialSources,
    revenuePricingDrafts: workspace.revenuePricingDrafts,
    leaseRollDrafts: workspace.leaseRollDrafts ?? [],
    operatingBudgetDrafts: workspace.operatingBudgetDrafts ?? [],
    pendingOverrides: workspace.pendingOverrides,
    expertTaxContracts: workspace.expertTaxContracts,
    stage3Snapshot: matchesProjectIntake(workspace.stage3Snapshot?.data, workspace.projectData) ? workspace.stage3Snapshot : null,
    priceVerifications: workspace.priceVerifications,
    expertReviews: {},
  } });
  const transferValidation = validateProjectTransferBundle(bundle, projectId);
  if (!transferValidation.valid) throw new Error(transferValidation.errors.join(" "));
  return bundle;
}

function assertUnambiguousReplacement(payload: ProjectWorkspacePayload): void {
  const current = useProjectStore.getState();
  const foreignIds = new Set(current.planningScenarios
    .filter(scenario => scenario.projectId && scenario.projectId !== payload.projectId).map(scenario => scenario.id));
  for (const collection of [current.leaseRollDrafts, current.operatingBudgetDrafts, current.revenuePricingDrafts, current.expertTaxContracts]) {
    for (const value of Object.values(collection)) if (value.projectId !== payload.projectId) foreignIds.add(value.scenarioId);
  }
  for (const snapshot of Object.values(current.stage3FeasibilitySnapshots)) if (snapshot.projectId !== payload.projectId) {
    foreignIds.add(snapshot.representativeScenarioId);
    for (const scenario of snapshot.data.scenarios) foreignIds.add(scenario.id);
  }
  if (current.representativeGeometrySnapshot && current.representativeGeometrySnapshot.projectId !== payload.projectId) {
    foreignIds.add(current.representativeGeometrySnapshot.scenarioId);
  }
  const replacedIds = new Set([
    ...current.planningScenarios.filter(scenario => !scenario.projectId || scenario.projectId === payload.projectId).map(scenario => scenario.id),
    ...(current.data?.parcel.id === payload.projectId ? current.data.scenarios.map(scenario => scenario.id) : []),
    ...payload.planningScenarios.map(scenario => scenario.id),
    ...payload.projectData.scenarios.map(scenario => scenario.id),
  ]);
  // These two legacy collections have no project owner; never guess through a collision.
  for (const id of replacedIds) if (foreignIds.has(id) && (
    Object.hasOwn(current.draftAssumptions, id) || Object.hasOwn(payload.draftAssumptions, id) ||
    current.pendingOverrides.some(value => value.scenarioId === id) || payload.pendingOverrides.some(value => value.scenarioId === id)
  )) throw new Error("다른 프로젝트와 같은 계획 ID의 미반영 가정이 있습니다. 프로젝트별 자료를 분리한 뒤 인계하세요.");
  for (const draft of payload.revenuePricingDrafts) {
    const existing = current.revenuePricingDrafts[buildRevenuePricingDraftKey(draft.projectId, draft.scenarioId)];
    if (existing && existing.projectId !== payload.projectId) {
      throw new Error("다른 프로젝트의 단가 초안 저장 키와 충돌합니다. 프로젝트 ID를 확인하세요.");
    }
  }
  for (const contract of payload.expertTaxContracts) {
    const existing = current.expertTaxContracts[buildExpertTaxContractKey(contract.projectId, contract.scenarioId, contract.strategy)];
    if (existing && existing.projectId !== payload.projectId) {
      throw new Error("다른 프로젝트의 세무 초안 저장 키와 충돌합니다. 프로젝트 ID를 확인하세요.");
    }
  }
}

export function prepareCurrentProjectTransfer(input: {
  bundle: ProjectTransferBundle; projectId: string; sessionContext: string | null; expectedWorkspaceKey: string;
}): ProjectWorkspacePayload {
  assertTransferAccess(input.projectId, input.sessionContext, true);
  if (input.bundle.projectId !== input.projectId || projectTransferWorkspaceKey(input.projectId) !== input.expectedWorkspaceKey) {
    throw new Error("미리보기 이후 프로젝트 내용이 변경됐습니다. 파일을 다시 확인하세요.");
  }
  const prepared = prepareProjectTransferWorkspace(input.bundle, useProjectStore.getState().data);
  if (!prepared.valid || !prepared.payload) throw new Error(prepared.errors.join(" "));
  assertUnambiguousReplacement(prepared.payload);
  return prepared.payload;
}

export function applyCurrentProjectTransfer(input: Parameters<typeof prepareCurrentProjectTransfer>[0]): ProjectWorkspacePayload {
  const payload = prepareCurrentProjectTransfer(input);
  const current = useProjectStore.getState();
  const ids = new Set([
    ...current.planningScenarios.filter(scenario => !scenario.projectId || scenario.projectId === input.projectId).map(scenario => scenario.id),
    ...(current.data?.scenarios.map(scenario => scenario.id) ?? []),
    ...payload.planningScenarios.map(scenario => scenario.id),
    ...payload.projectData.scenarios.map(scenario => scenario.id),
  ]);
  // Explicit whole-project replacement also discards this project's per-tab editor drafts.
  for (const id of ids) {
    clearLeaseRollEditorRecovery(input.projectId, id);
    clearOperatingBudgetEditorRecovery(input.projectId, id);
  }
  applyProjectWorkspace(payload);
  return payload;
}
