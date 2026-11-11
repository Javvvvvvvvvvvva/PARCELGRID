/**
 * Hooks for the dynamic project flow (본인 부지로 분석).
 *
 * Separate from `useProject(id)` which targets the seed/DB-backed projects.
 * This one restores the authenticated Workspace or session-scoped intake
 * and calls /api/projects/dynamic only after an acquisition price is entered.
 */

"use client";

import { sessionFetch as fetch } from "@/lib/auth/client-session";
import { sessionDraftStorage } from "@/lib/auth/client-session";
import { readWorkspaceDraft, writeWorkspaceDraft, type WorkspaceDraft } from "@/lib/workspace/workspace-draft";

import { useQuery } from "@tanstack/react-query";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import type { ProjectComputed } from "@/lib/services/compute-project";
import type { AcquisitionEstimateSnapshot, Parcel } from "@/lib/finance/types";
import type { RegulatoryConstraintSet } from "@/lib/regulatory/constraints";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import { SCENARIO_DECISION_MODEL_VERSION } from "@/lib/finance/scenario-decision-support";
import {
  hashProjectWorkspacePayload,
  validateProjectWorkspaceRecord,
  type ProjectWorkspaceRecord,
  type ProjectWorkspacePayload,
} from "@/lib/workspace/project-workspace";

/**
 * Site input persisted inside the organization Workspace; local drafts are session-scoped.
 */
export interface StoredParcel {
  id: string;
  address: string;
  addressRoad: string | null;
  lat: number;
  lng: number;
  lawdCd: string;
  pnu: string | null;
  lotArea: number;
  jimokCategory?: "buildable" | "farmland" | "forest" | "other";
  boundary?: [number, number][];
  boundaryPolygons?: Parcel["boundaryPolygons"];
  roads?: { name: string | null; points: [number, number][] }[];
  zoning: string;
  zoneCode: string;
  maxFAR: number;
  maxBCR: number;
  heightLimit: number;
  regulatoryConstraints?: RegulatoryConstraintSet;
  overlays?: Array<{ code: string; name: string; conflict: string }>;
  inputProvenance?: Parcel["inputProvenance"];
  landPrice: number;
  landPriceYear: string;
  setback?: { road: number; side: number; rear: number };
  estMarketPrice?: number;
  acquisitionEstimate?: AcquisitionEstimateSnapshot;
  acquired: string;
  /** null is an unpriced site intake, never a zero-cost acquisition. */
  acquiredPrice: number | null;
  intakeRevision?: string;
  selectedAt?: string;
  demolitionCost?: number;
  /** MOLIT 건축물대장 — Stage 1 현황 분석용 */
  currentBuilding?: BuildingLookupResult | null;
}

export interface DynamicProjectRequest {
  parcel: Parcel;
  lawdCd: string;
  parcelDong: string;
  intakeRevision?: string;
}

export interface DynamicProjectLoadResult {
  data: ProjectComputed;
  workspace: ProjectWorkspaceRecord | null;
  source: "demo" | "server-workspace" | "computed-local-intake";
  localDraft?: WorkspaceDraft | null;
}

export function buildDynamicProjectRequest(
  stored: StoredParcel,
): DynamicProjectRequest {
  if (!hasAcquisitionPrice(stored)) throw new Error("사업성 계산 전에 총 취득대금을 입력하세요.");
  const parcelDong =
    stored.address
      .split(/\s+/)
      .find(
        (part) =>
          part.endsWith("동") || part.endsWith("읍") || part.endsWith("면"),
      ) ?? "";

  return {
    parcel: {
      id: stored.id,
      address: stored.address,
      addressRoad: stored.addressRoad ?? "",
      lat: stored.lat,
      lng: stored.lng,
      lotArea: stored.lotArea,
      boundary: stored.boundary,
      boundaryPolygons: stored.boundaryPolygons,
      roads: stored.roads,
      zoning: stored.zoning,
      zoneCode: stored.zoneCode,
      maxFAR: stored.maxFAR,
      maxBCR: stored.maxBCR,
      heightLimit: stored.heightLimit,
      regulatoryConstraints: stored.regulatoryConstraints,
      overlays: stored.overlays,
      inputProvenance: stored.inputProvenance,
      setback: stored.setback ?? { road: 0, side: 0, rear: 0 },
      landPrice: stored.landPrice,
      estMarketPrice: stored.estMarketPrice ?? stored.landPrice,
      acquisitionEstimate: stored.acquisitionEstimate,
      acquired: stored.acquired,
      acquiredPrice: stored.acquiredPrice!,
      demolitionCost: stored.demolitionCost,
      currentBuilding: stored.currentBuilding ?? null,
    },
    lawdCd: stored.lawdCd,
    parcelDong,
    intakeRevision: stored.intakeRevision,
  };
}

/** The authenticated browser session owns intake drafts, never a global cache. */
export function setActiveStoredParcel(stored: StoredParcel | null): void {
  if (stored) sessionDraftStorage.setItem("parcelgrid:draft-parcel", JSON.stringify(stored));
  else sessionDraftStorage.removeItem("parcelgrid:draft-parcel");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("parcelgrid:parcel-changed"));
}
/** Read the active parcel. The legacy cache is used only before workspace activation. */
export function readStoredParcel(): StoredParcel | null {
  if (typeof window === "undefined") return null;
  const raw = sessionDraftStorage.getItem("parcelgrid:draft-parcel");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredParcel;
    return value && typeof value.id === "string" && typeof value.address === "string" && Number.isFinite(value.lotArea) && value.lotArea > 0 ? value : null;
  } catch {
    return null;
  }
}

export function hasAcquisitionPrice(stored: StoredParcel): boolean {
  return typeof stored.acquiredPrice === "number" && Number.isFinite(stored.acquiredPrice) && stored.acquiredPrice > 0;
}

export async function writeStoredParcel(stored: StoredParcel): Promise<void> {
  setActiveStoredParcel(stored);
}

/** No scenario, taxes, profitability, or market requests are run for site inspection. */
export function buildSiteProject(stored: StoredParcel): ProjectComputed {
  const parcel = { ...stored, addressRoad: stored.addressRoad ?? "", acquiredPrice: stored.acquiredPrice ?? 0,
    setback: stored.setback ?? { road: 0, side: 0, rear: 0 }, estMarketPrice: stored.estMarketPrice ?? stored.landPrice,
    risks: [], status: "현황 확인", risk: "미평가" };
  return { parcel, scenarios: [], pfSchedule: [], parcelRisks: [], comps: [], maxAcquisition: [],
    siteIntake: structuredClone(stored),
    decisionSupport: { modelVersion: SCENARIO_DECISION_MODEL_VERSION, method: "pareto-no-weights",
      focusScenarioId: "", focusMode: "ineligible-fallback", paretoScenarioIds: [], objectiveLeaders: [],
      entries: [], excludedMetrics: [], warnings: ["현황 확인 단계: 가격과 계획 미입력으로 사업성 비교를 실행하지 않았습니다."] },
    meta: { lastSyncedAt: stored.selectedAt ?? "", version: "site-only-2026.1", mode: "site-only", intakeRevision: stored.intakeRevision } };
}

/**
 * Hook for the project pages. Compares the URL's projectId against the
 * stored parcel; if they match, computes via /api/projects/dynamic. The
 * validated demo project is served by its deterministic seed endpoint.
 */
export function useDynamicProject(projectId: string) {
  return useQuery<DynamicProjectLoadResult>({
    queryKey: ["dynamic-project", projectId, JSON.stringify(readStoredParcel())],
    queryFn: async () => {

      const workspaceResponse = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/workspace`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (workspaceResponse.ok) {
        const candidate = (await workspaceResponse.json()) as unknown;
        const validation = validateProjectWorkspaceRecord(candidate, projectId);
        if (!validation.valid || !validation.record) {
          throw new Error(validation.errors.join(" "));
        }
        const actualHash = await hashProjectWorkspacePayload(
          validation.record.payload,
        );
        if (actualHash !== validation.record.payloadHash) {
          throw new Error("서버 프로젝트 Workspace의 SHA-256이 일치하지 않습니다.");
        }
        const existingDraft = readWorkspaceDraft(projectId);
        const localDraft = await refreshIntakeDraft(projectId, existingDraft?.payload ?? validation.record.payload,
          existingDraft?.baseRevision ?? validation.record.revision) ?? existingDraft;
        return {
          data: localDraft?.payload.projectData ?? validation.record.payload.projectData,
          workspace: validation.record,
          source: "server-workspace",
          localDraft,
        };
      }
      if (workspaceResponse.status !== 404) {
        const result = (await workspaceResponse.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          result?.error ??
            `서버 프로젝트 Workspace 조회 실패 (${workspaceResponse.status})`,
        );
      }

      const localDraft = readWorkspaceDraft(projectId);
      if (localDraft) {
        const refreshed = await refreshIntakeDraft(projectId, localDraft.payload, localDraft.baseRevision) ?? localDraft;
        return { data: refreshed.payload.projectData, workspace: null, source: "computed-local-intake", localDraft: refreshed };
      }
      if (projectId === DEMO_PROJECT_ID && readStoredParcel()?.id !== projectId) {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return {
          data: (await res.json()) as ProjectComputed,
          workspace: null,
          source: "demo",
        };
      }

      // Dynamic flow — read stored parcel
      const stored = readStoredParcel();
      if (!stored) {
        throw new Error(
          "저장된 부지 데이터가 없습니다. 새 부지 등록 페이지에서 다시 시작해주세요."
        );
      }

      // Verify the stored parcel matches this URL
      if (stored.id !== projectId) {
        throw new Error(
          `URL 부지 ID(${projectId})와 저장된 부지(${stored.id})가 일치하지 않습니다.`
        );
      }

      return {
        data: await computeStoredParcel(stored),
        workspace: null,
        source: "computed-local-intake",
      };
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

async function computeStoredParcel(stored: StoredParcel): Promise<ProjectComputed> {
  if (!hasAcquisitionPrice(stored)) return buildSiteProject(stored);
  const res = await fetch("/api/projects/dynamic", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDynamicProjectRequest(stored)) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({})) as { error?: string; nextAction?: string };
    throw new Error([error.error ?? `프로젝트 계산 실패 (${res.status})`, error.nextAction].filter(Boolean).join(" "));
  }
  return res.json() as Promise<ProjectComputed>;
}

async function refreshIntakeDraft(projectId: string, payload: ProjectWorkspacePayload, baseRevision: number): Promise<WorkspaceDraft | null> {
  const stored = readStoredParcel();
  if (stored?.id !== projectId || !stored.intakeRevision || stored.intakeRevision === payload.projectData.meta.intakeRevision) return null;
  const projectData = await computeStoredParcel(stored);
  if (readStoredParcel()?.intakeRevision !== stored.intakeRevision) throw new Error("부지 입력이 변경됐습니다. 최신 입력으로 다시 조회하세요.");
  // Keep authored plans, but never inherit a representative or approval for a different intake.
  return writeWorkspaceDraft({ ...payload, projectData, envelopePlan: null, representativeScenarioId: null,
    representativeGeometry: null, representativeParcelBasisHash: null, stage3Snapshot: null,
    pendingOverrides: [], draftAcquisitionPrice: null, draftAssumptions: {}, financialSources: {},
    revenuePricingDrafts: [], expertTaxContracts: [], priceVerifications: {},
  }, baseRevision);
}
