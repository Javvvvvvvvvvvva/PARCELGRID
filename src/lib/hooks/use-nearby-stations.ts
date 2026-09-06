"use client";

import { useQuery } from "@tanstack/react-query";

export interface NearbyStationMarker {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
}

export type NearbyStationsStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable";

interface NearbyStationsPayload {
  stations?: NearbyStationMarker[];
  error?: string;
}

export function useNearbyStations(
  lat: number | undefined,
  lng: number | undefined,
  radiusM = 1000,
) {
  const enabled =
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Number.isFinite(radiusM) &&
    radiusM >= 100 &&
    radiusM <= 20_000;
  const query = useQuery<NearbyStationMarker[]>({
    enabled,
    queryKey: ["nearby-stations", lat, lng, radiusM],
    queryFn: async () => {
      const response = await fetch(
        `/api/parcels/nearby-stations?lat=${lat}&lng=${lng}&radius=${radiusM}`,
      );
      const payload = (await response.json().catch(() => ({}))) as
        NearbyStationsPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "역세권 조회에 실패했습니다.");
      }
      return Array.isArray(payload.stations) ? payload.stations : [];
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  const status: NearbyStationsStatus = !enabled
    ? "idle"
    : query.isLoading
      ? "loading"
      : query.isError
        ? "unavailable"
        : "ready";

  return {
    stations: query.data ?? [],
    status,
    errorMessage:
      query.error instanceof Error ? query.error.message : undefined,
  };
}
