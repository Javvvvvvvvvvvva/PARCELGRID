/**
 * GET /api/parcels/nearby-context
 * 주변 필지 + 건축물대장 (Stage 1 3D 맥락용).
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchNearbyCadastralParcels } from "@/lib/integrations/vworld";
import { lookupBuildingByPnu } from "@/lib/integrations/molit-building";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";

export const runtime = "nodejs";
export const maxDuration = 45;

const BUILDING_LOOKUP_LIMIT = 12;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get("lat") ?? "");
  const lng = parseFloat(sp.get("lng") ?? "");
  const pnu = sp.get("pnu") ?? "";
  const radiusM = parseInt(sp.get("radiusM") ?? "75", 10);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat, lng 필수" }, { status: 400 });
  }

  try {
    const parcels = await fetchNearbyCadastralParcels(lat, lng, {
      excludePnu: pnu || undefined,
      radiusM,
      maxCount: radiusM <= 35 ? 8 : radiusM <= 50 ? 16 : 14,
    });

    const neighbors: Array<{
      pnu: string;
      jibun: string;
      lotAreaSqm: number;
      boundary: [number, number][];
      distanceM: number;
      building: BuildingLookupResult | null;
    }> = [];

    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      let building: BuildingLookupResult | null = null;
      if (i < BUILDING_LOOKUP_LIMIT) {
        try {
          building = await lookupBuildingByPnu(p.pnu);
        } catch {
          building = null;
        }
      }
      neighbors.push({ ...p, building });
    }

    return NextResponse.json({ neighbors, count: neighbors.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "조회 실패" },
      { status: 500 }
    );
  }
}
