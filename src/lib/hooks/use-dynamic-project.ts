/**
 * Hooks for the dynamic project flow (본인 부지로 분석).
 *
 * Separate from `useProject(id)` which targets the seed/DB-backed projects.
 * This one reads the user's draft parcel from sessionStorage and calls
 * /api/projects/dynamic to compute scenarios.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import type { ProjectComputed } from "@/lib/services/compute-project";
import type { AcquisitionEstimateSnapshot, Parcel } from "@/lib/finance/types";
import type { RegulatoryConstraintSet } from "@/lib/regulatory/constraints";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";

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
  roads?: { name: string | null; points: [number, number][] }[];
  zoning: string;
  zoneCode: string;
  maxFAR: number;
  maxBCR: number;
  heightLimit: number;
  regulatoryConstraints?: RegulatoryConstraintSet;
  overlays?: Array<{ code: string; name: string; conflict: string }>;
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
      roads: stored.roads,
      zoning: stored.zoning,
      zoneCode: stored.zoneCode,
      maxFAR: stored.maxFAR,
      maxBCR: stored.maxBCR,
      heightLimit: stored.heightLimit,
      regulatoryConstraints: stored.regulatoryConstraints,
      overlays: stored.overlays,
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
  const raw = sessionStorage.getItem("parcelgrid:draft-parcel");
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
  return useQuery<ProjectComputed>({
    queryKey: ["dynamic-project", projectId],
    queryFn: async () => {
      if (projectId === DEMO_PROJECT_ID) {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
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

      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}
