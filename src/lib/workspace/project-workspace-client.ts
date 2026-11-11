"use client";

import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { buildExpertTaxContractKey } from "@/lib/finance/after-tax-ledger";
import { buildRevenuePricingDraftKey } from "@/lib/finance/revenue-contract";
import { buildLeaseRollDraftKey } from "@/lib/finance/lease-roll-contract";
import {
  PROJECT_WORKSPACE_VERSION,
  type ProjectWorkspacePayload,
} from "@/lib/workspace/project-workspace";

export function captureProjectWorkspace(
  projectId: string,
): ProjectWorkspacePayload | null {
  const project = useProjectStore.getState();
  const review = useReviewStore.getState();
  if (project.data?.parcel.id !== projectId) return null;

  const planningScenarios = project.planningScenarios
    .filter(
      (scenario) => !scenario.projectId || scenario.projectId === projectId,
    )
    .map((scenario) => ({ ...scenario, projectId }));
  const scenarioIds = new Set([
    ...planningScenarios.map((scenario) => scenario.id),
    ...project.data.scenarios.map((scenario) => scenario.id),
  ]);
  const draftAssumptions = Object.fromEntries(
    Object.entries(project.draftAssumptions).filter(([scenarioId]) =>
      scenarioIds.has(scenarioId),
    ),
  );

  return {
    version: PROJECT_WORKSPACE_VERSION,
    projectId,
    projectData: project.data,
    envelopePlan: project.envelopePlan,
    planningScenarios,
    selectedScenarioId:
      project.selectedPlanningScenarioId &&
      scenarioIds.has(project.selectedPlanningScenarioId)
        ? project.selectedPlanningScenarioId
        : null,
    representativeScenarioId:
      project.representativePlanningScenarioId &&
      scenarioIds.has(project.representativePlanningScenarioId)
        ? project.representativePlanningScenarioId
        : null,
    representativeGeometry:
      project.representativeGeometrySnapshot?.projectId === projectId
        ? project.representativeGeometrySnapshot
        : null,
    representativeParcelBasisHash: project.representativeParcelBasisHash,
    pendingOverrides: project.pendingOverrides.filter((override) =>
      scenarioIds.has(override.scenarioId),
    ),
    draftAssumptions,
    draftAcquisitionPrice: project.draftAcquisitionPrices[projectId] ?? null,
    financialSources: project.financialSources[projectId] ?? {},
    revenuePricingDrafts: Object.values(project.revenuePricingDrafts).filter(
      (draft) => draft.projectId === projectId,
    ),
    leaseRollDrafts: Object.values(project.leaseRollDrafts).filter(
      (draft) => draft.projectId === projectId,
    ),
    expertTaxContracts: Object.values(project.expertTaxContracts).filter(
      (contract) => contract.projectId === projectId,
    ),
    stage3Snapshot: project.stage3FeasibilitySnapshots[projectId] ?? null,
    priceVerifications: review.priceVerifications[projectId] ?? {},
  };
}

export function applyProjectWorkspace(payload: ProjectWorkspacePayload): void {
  const projectId = payload.projectId;
  const project = useProjectStore.getState();
  const priorScenarioIds = new Set(
    project.planningScenarios
      .filter(
        (scenario) => !scenario.projectId || scenario.projectId === projectId,
      )
      .map((scenario) => scenario.id),
  );
  const nextScenarioIds = new Set(
    payload.planningScenarios.map((scenario) => scenario.id),
  );
  const replacedScenarioIds = new Set([...priorScenarioIds, ...nextScenarioIds]);
  const draftAssumptions = {
    ...Object.fromEntries(
      Object.entries(project.draftAssumptions).filter(
        ([scenarioId]) => !replacedScenarioIds.has(scenarioId),
      ),
    ),
    ...payload.draftAssumptions,
  };
  const draftAcquisitionPrices = { ...project.draftAcquisitionPrices };
  if (payload.draftAcquisitionPrice == null) {
    delete draftAcquisitionPrices[projectId];
  } else {
    draftAcquisitionPrices[projectId] = payload.draftAcquisitionPrice;
  }
  const expertTaxContracts = Object.fromEntries(
    Object.entries(project.expertTaxContracts).filter(
      ([, contract]) => contract.projectId !== projectId,
    ),
  );
  for (const contract of payload.expertTaxContracts) {
    const key = buildExpertTaxContractKey(
      contract.projectId,
      contract.scenarioId,
      contract.strategy,
    );
    expertTaxContracts[key] = contract;
  }
  const revenuePricingDrafts = Object.fromEntries(
    Object.entries(project.revenuePricingDrafts).filter(
      ([, draft]) => draft.projectId !== projectId,
    ),
  );
  for (const draft of payload.revenuePricingDrafts) {
    revenuePricingDrafts[
      buildRevenuePricingDraftKey(draft.projectId, draft.scenarioId)
    ] = draft;
  }
  const leaseRollDrafts = Object.fromEntries(
    Object.entries(project.leaseRollDrafts).filter(
      ([, draft]) => draft.projectId !== projectId,
    ),
  );
  for (const draft of payload.leaseRollDrafts ?? []) {
    leaseRollDrafts[
      buildLeaseRollDraftKey(draft.projectId, draft.scenarioId)
    ] = draft;
  }
  const stage3FeasibilitySnapshots = {
    ...project.stage3FeasibilitySnapshots,
  };
  if (payload.stage3Snapshot) {
    stage3FeasibilitySnapshots[projectId] = payload.stage3Snapshot;
  } else {
    delete stage3FeasibilitySnapshots[projectId];
  }

  useProjectStore.setState({
    data: payload.projectData,
    envelopePlan: payload.envelopePlan,
    planningScenarios: [
      ...project.planningScenarios.filter(
        (scenario) => scenario.projectId && scenario.projectId !== projectId,
      ),
      ...payload.planningScenarios,
    ],
    selectedPlanningScenarioId: payload.selectedScenarioId,
    representativePlanningScenarioId: payload.representativeScenarioId,
    representativeGeometrySnapshot: payload.representativeGeometry,
    representativeParcelBasisHash: payload.representativeParcelBasisHash,
    geometryValidationError: null,
    pendingOverrides: [
      ...project.pendingOverrides.filter(
        (override) => !replacedScenarioIds.has(override.scenarioId),
      ),
      ...payload.pendingOverrides,
    ],
    draftAssumptions,
    draftAcquisitionPrices,
    financialSources: {
      ...project.financialSources,
      [projectId]: payload.financialSources,
    },
    revenuePricingDrafts,
    leaseRollDrafts,
    expertTaxContracts,
    stage3FeasibilitySnapshots,
    activeScenarioId: null,
  });

  const review = useReviewStore.getState();
  useReviewStore.setState({
    priceVerifications: {
      ...review.priceVerifications,
      [projectId]: payload.priceVerifications,
    },
  });
}
