/**
 * GET /api/parcels/nearby-context
 * 주변 필지 + 건축물대장 (Stage 1 3D 맥락용).
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchNearbyCadastralParcels } from "@/lib/integrations/vworld";
import { lookupBuildingByPnu } from "@/lib/integrations/molit-building";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { vworldRuntimeState } from "@/lib/runtime/integration-mode";
import { requireApiCapability } from "@/lib/auth/request";
import { vworldResultEvidence, vworldUnavailableEvidence } from "@/lib/integrations/vworld-evidence";
import { createProviderDeadline } from "@/lib/http/provider-deadline";
import type { RegistryDataset } from "@/lib/building-registry/types";

export const runtime = "nodejs";
export const maxDuration = 45;

const BUILDING_LOOKUP_LIMIT = 12;
const BUILDING_LOOKUP_WORKERS = 3;
const ROUTE_TIMEOUT_MS = 35_000;
const MAX_RADIUS_M = 180;

export async function GET(req: NextRequest) {
  const budget = createProviderDeadline(ROUTE_TIMEOUT_MS, req.signal);
  const authorization = await requireApiCapability(req, "project.read");
  if (!authorization.ok) return authorization.response;
  const sp = req.nextUrl.searchParams;
  const rawLat = sp.get("lat");
  const rawLng = sp.get("lng");
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const pnu = sp.get("pnu") ?? "";
  const radiusM = Number(sp.get("radiusM") ?? "75");

  if (
    !rawLat?.trim() || !rawLng?.trim() ||
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(radiusM) || radiusM < 1 || radiusM > MAX_RADIUS_M
  ) {
    return NextResponse.json(
      { code: "INVALID_NEARBY_SEARCH", error: "유효한 좌표와 1~180m 검색 반경이 필요합니다." },
      { status: 400 },
    );
  }

  const vworld = vworldRuntimeState();
  if (vworld.mode !== "enabled") {
    return NextResponse.json(
      {
        code:
          vworld.mode === "disabled"
            ? "VWORLD_DISABLED"
            : "VWORLD_NOT_CONFIGURED",
        error: "VWorld 주변 필지 조회가 현재 비활성 상태입니다.",
        nextAction: "주변 필지 없이 현재 부지 분석을 계속할 수 있습니다.",
        retryable: false,
        sourceEvidence: {
          cadastral: vworldUnavailableEvidence("LP_PA_CBND_BUBUN", vworld.mode === "disabled" ? "disabled" : "not-configured"),
        },
      },
      { status: 503 },
    );
  }

  try {
    budget.check();
    const parcels = await fetchNearbyCadastralParcels(lat, lng, {
      excludePnu: pnu || undefined,
      radiusM,
      maxCount: radiusM <= 35 ? 8 : radiusM <= 50 ? 16 : 14,
      signal: budget.signal,
      outerDeadline: budget.deadline,
    });

    const neighbors: Array<{
      pnu: string;
      jibun: string;
      lotAreaSqm: number;
      boundary: [number, number][];
      distanceM: number;
      building: BuildingLookupResult | null;
      buildingEvidence: Pick<RegistryDataset, "status" | "issues">;
    }> = parcels.map((p, index) => ({
      ...p, building: null,
      buildingEvidence: { status: "not-requested", issues: index >= BUILDING_LOOKUP_LIMIT ? ["lookup-limit"] : [] },
    }));

    const interruption = () => req.signal.aborted ? "request-aborted"
      : budget.signal.aborted || performance.now() >= budget.deadline ? "timeout" : null;
    const lookupCount = Math.min(neighbors.length, BUILDING_LOOKUP_LIMIT);
    let nextIndex = 0;
    let attemptedCount = 0;
    const worker = async () => {
      while (nextIndex < lookupCount) {
        const neighbor = neighbors[nextIndex++];
        const stopped = interruption();
        if (stopped) {
          neighbor.buildingEvidence.issues = [stopped];
          continue;
        }
        attemptedCount++;
        try {
          neighbor.building = await lookupBuildingByPnu(neighbor.pnu, {
            signal: budget.signal, outerDeadline: budget.deadline,
          });
          const title = neighbor.building?.registry?.title;
          neighbor.buildingEvidence = title
            ? { status: title.status, issues: [...title.issues] }
            : { status: "unavailable", issues: ["invalid-query"] };
        } catch {
          neighbor.buildingEvidence = { status: "unavailable", issues: [interruption() ?? "request-failed"] };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BUILDING_LOOKUP_WORKERS, lookupCount) }, () => worker()));
    const completedCount = neighbors.filter((neighbor) => neighbor.buildingEvidence.status === "complete").length;
    const partialCount = neighbors.filter((neighbor) => neighbor.buildingEvidence.status === "partial").length;

    return NextResponse.json({
      neighbors,
      count: neighbors.length,
      sourceEvidence: {
        cadastral: vworldResultEvidence("LP_PA_CBND_BUBUN", neighbors.length),
        buildingRegistry: {
          status: !neighbors.length ? "not-requested" : completedCount === neighbors.length ? "complete"
            : completedCount || partialCount ? "partial" : "unavailable",
          attemptedCount, completedCount, partialCount, skippedCount: neighbors.length - attemptedCount,
          issues: [...new Set(neighbors.flatMap((neighbor) => neighbor.buildingEvidence.issues))],
        },
      },
    });
  } catch {
    return NextResponse.json(
      {
        code: "VWORLD_NEARBY_UNAVAILABLE",
        error: "VWorld 주변 필지 데이터를 확인하지 못했습니다.",
        retryable: true,
        sourceEvidence: { cadastral: vworldUnavailableEvidence("LP_PA_CBND_BUBUN", "request-failed") },
      },
      { status: 502 },
    );
  }
}
