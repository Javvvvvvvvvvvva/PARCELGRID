"use client";
import { useQuery } from "@tanstack/react-query";
import { contextMatchesSelection, selectionContextResponseSchema, type SelectionContextRequest } from "@/lib/parcels/selection-context";

export function useSelectionContext(selection: SelectionContextRequest | null) {
  return useQuery({
    queryKey: ["parcel-selection-context", selection?.pnu, selection?.center.lat, selection?.center.lng, selection?.revision],
    enabled: selection !== null,
    staleTime: 30_000, gcTime: 60_000, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      if (!selection) throw new Error("부지를 먼저 선택하세요.");
      const response = await fetch("/api/parcels/selection-context", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error("주변 도형을 불러오지 못했습니다.");
      const result = selectionContextResponseSchema.parse(await response.json());
      if (!contextMatchesSelection(result, selection)) throw new Error("선택한 부지와 주변 조회 결과가 일치하지 않습니다.");
      return result;
    },
  });
}
