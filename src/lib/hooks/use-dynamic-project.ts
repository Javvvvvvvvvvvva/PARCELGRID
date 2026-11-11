/**
 * Hooks for the dynamic project flow (본인 부지로 분석).
 *
 * Separate from `useProject(id)` which targets the seed/DB-backed projects.
 * This one reads the user's draft parcel from sessionStorage and calls
 * /api/projects/dynamic to compute scenarios.
 */

"use client";

import { sessionFetch as fetch } from "@/lib/auth/client-session";
import { sessionDraftStorage } from "@/lib/auth/client-session";
import { readWorkspaceDraft, type WorkspaceDraft } from "@/lib/workspace/workspace-draft";

import { useQuery } from "@tanstack/react-query";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import type { ProjectComputed } from "@/lib/services/compute-project";
import type { AcquisitionEstimateSnapshot, Parcel } from "@/lib/finance/types";
import type { RegulatoryConstraintSet } from "@/lib/regulatory/constraints";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import {
  hashProjectWorkspacePayload,
  validateProjectWorkspaceRecord,
  type ProjectWorkspaceRecord,
} from "@/lib/workspace/project-workspace";

/**
 * Stored parcel shape — matches what /projects/new writes to sessionStorage.
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
  acquiredPrice: number;
  demolitionCost?: number;
  /** MOLIT 건축물대장 — Stage 1 현황 분석용 */
  currentBuilding?: BuildingLookupResult | null;
}

export interface DynamicProjectRequest {
  parcel: Parcel;
  lawdCd: string;
  parcelDong: string;
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
      acquiredPrice: stored.acquiredPrice,
      demolitionCost: stored.demolitionCost,
      currentBuilding: stored.currentBuilding ?? null,
    },
    lawdCd: stored.lawdCd,
    parcelDong,
  };
}

/** Read the stored parcel. Returns null if nothing stored. */
export function readStoredParcel(): StoredParcel | null {
  if (typeof window === "undefined") return null;
  const raw = sessionDraftStorage.getItem("parcelgrid:draft-parcel");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredParcel;
  } catch {
    return null;
  }
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
        const localDraft = readWorkspaceDraft(projectId);
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
        return { data: localDraft.payload.projectData, workspace: null, source: "computed-local-intake", localDraft };
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

      const body = buildDynamicProjectRequest(stored);

      const res = await fetch("/api/projects/dynamic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          nextAction?: string;
        };
        throw new Error(
          [err.error ?? `프로젝트 계산 실패 (${res.status})`, err.nextAction]
            .filter(Boolean)
            .join(" ")
        );
      }

      return {
        data: (await res.json()) as ProjectComputed,
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
