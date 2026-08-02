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
import type { AcquisitionEstimateSnapshot } from "@/lib/finance/types";

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
 * stored parcel; if they match, computes via /api/projects/dynamic. If
 * the URL is "sample", falls back to the seed GET endpoint.
 */
export function useDynamicProject(projectId: string) {
  return useQuery<ProjectComputed>({
    queryKey: ["dynamic-project", projectId],
    queryFn: async () => {
      if (projectId === "sample") {
        // Seed project flow
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

      // Build the request body
      // address에서 법정동 추출 (예: "서울 도봉구 쌍문동 281-23" → "쌍문동")
      const parcelDong = (() => {
        const parts = stored.address.split(/\s+/);
        const dong = parts.find((p) => p.endsWith("동") || p.endsWith("읍") || p.endsWith("면"));
        return dong ?? "";
      })();

      const body = {
        parcel: {
          id: stored.id,
          address: stored.address,
          addressRoad: stored.addressRoad,
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
          setback: stored.setback,
          landPrice: stored.landPrice,
          estMarketPrice: stored.estMarketPrice,
          acquisitionEstimate: stored.acquisitionEstimate,
          acquired: stored.acquired,
          acquiredPrice: stored.acquiredPrice,
          demolitionCost: stored.demolitionCost,
          currentBuilding: stored.currentBuilding ?? null,
        },
        lawdCd: stored.lawdCd,
        parcelDong,
      };

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
