import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import type { StoredParcel } from "@/lib/hooks/use-dynamic-project";
import { emptyWorkspace, invalidateWorkspaceResults, type WorkspaceDocument } from "./document";

export function captureWorkspace(projectId: string, intake: StoredParcel | null): WorkspaceDocument {
  const state = useProjectStore.getState(), review = useReviewStore.getState();
  const planningScenarios = state.planningScenarios.filter(s => s.projectId === projectId);
  const ids = new Set(planningScenarios.map(s => s.id));
  return { ...emptyWorkspace(projectId, intake), payload: {
    projectData: null, envelopePlan: state.envelopePlan, planningScenarios,
    selectedScenarioId: ids.has(state.selectedPlanningScenarioId ?? "") ? state.selectedPlanningScenarioId : null,
    representativeScenarioId: ids.has(state.representativePlanningScenarioId ?? "") ? state.representativePlanningScenarioId : null,
    representativeGeometry: state.representativeGeometrySnapshot?.projectId === projectId ? state.representativeGeometrySnapshot : null,
    draftAssumptions: Object.fromEntries(Object.entries(state.draftAssumptions).filter(([key]) => ids.has(key))),
    draftAcquisitionPrice: state.draftAcquisitionPrices[projectId] ?? null,
    financialSources: state.financialSources[projectId] ?? {}, stage3Snapshot: state.stage3FeasibilitySnapshots[projectId] ?? null,
    priceVerifications: review.priceVerifications[projectId] ?? {}, expertReviews: review.expertReviews[projectId] ?? {},
  } };
}

export function applyWorkspace(document: WorkspaceDocument, resetData = true) {
  const { projectId } = document;
  let p = document.payload;
  const representative = p.planningScenarios.find(s => s.id === p.representativeScenarioId);
  const geometry = p.representativeGeometry;
  if ((geometry && !p.representativeScenarioId) || (p.representativeScenarioId && (!representative || geometry?.projectId !== projectId || geometry.scenarioId !== representative.id || geometry.scenarioVersion !== representative.version))) {
    p = invalidateWorkspaceResults(document).payload;
  }
  if (p.stage3Snapshot && (p.stage3Snapshot.data?.meta?.intakeRevision !== document.intake?.intakeRevision ||
      p.stage3Snapshot.representativeScenarioId !== p.representativeScenarioId || !p.representativeGeometry ||
      p.stage3Snapshot.representativeScenarioVersion !== p.representativeGeometry.scenarioVersion ||
      p.stage3Snapshot.geometryHash !== p.representativeGeometry.geometryHash)) p = invalidateWorkspaceResults({ ...document, payload: p }).payload;
  useProjectStore.setState({ ...(resetData ? { data: null } : {}), envelopePlan: p.envelopePlan, planningScenarios: p.planningScenarios,
    selectedPlanningScenarioId: p.selectedScenarioId, representativePlanningScenarioId: p.representativeScenarioId,
    representativeGeometrySnapshot: p.representativeGeometry, geometryValidationError: null, activeScenarioId: null, pendingOverrides: [],
    draftAssumptions: p.draftAssumptions, draftAcquisitionPrices: p.draftAcquisitionPrice === null ? {} : { [projectId]: p.draftAcquisitionPrice },
    financialSources: { [projectId]: p.financialSources }, stage3FeasibilitySnapshots: p.stage3Snapshot ? { [projectId]: p.stage3Snapshot } : {},
  });
  useReviewStore.setState({ priceVerifications: { [projectId]: p.priceVerifications }, expertReviews: { [projectId]: p.expertReviews } });
}
