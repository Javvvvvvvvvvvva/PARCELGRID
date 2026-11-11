import type { ProjectComputed } from "@/lib/services/compute-project";
import {
  PROJECT_WORKSPACE_VERSION,
  type ProjectWorkspacePayload,
} from "@/lib/workspace/project-workspace";

export function projectWorkspaceFixture(
  projectId: string,
  modelVersion = "workspace-fixture-1",
): ProjectWorkspacePayload {
  return {
    version: PROJECT_WORKSPACE_VERSION,
    projectId,
    projectData: {
      parcel: {
        id: projectId,
        address: "서울특별시 도봉구 쌍문동 123-45",
        zoning: "제2종일반주거지역",
        lotArea: 320,
      },
      scenarios: [{ id: "FINANCE-S1" }],
      decisionSupport: {},
      pfSchedule: [],
      parcelRisks: [],
      comps: [],
      maxAcquisition: [],
      meta: {
        version: modelVersion,
        lastSyncedAt: "2026-09-09T12:00:00.000Z",
      },
    } as unknown as ProjectComputed,
    envelopePlan: null,
    planningScenarios: [],
    selectedScenarioId: null,
    representativeScenarioId: null,
    representativeGeometry: null,
    representativeParcelBasisHash: null,
    pendingOverrides: [],
    draftAssumptions: {},
    draftAcquisitionPrice: null,
    financialSources: {},
    revenuePricingDrafts: [],
    expertTaxContracts: [],
    stage3Snapshot: null,
    priceVerifications: {},
  };
}
