/**
 * 주변 지하철역 API — 역세권 판단용.
 * GET ?lat=..&lng=..&radius=1000 → 가까운 순 역 목록.
 */

import { NextRequest, NextResponse } from "next/server";
import { searchNearbyStations } from "@/lib/integrations/kakao";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const lat = Number(sp.get("lat"));
    const lng = Number(sp.get("lng"));
    const radius = Number(sp.get("radius") ?? "1000");

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "lat·lng 필요" }, { status: 400 });
    }

    const stations = await searchNearbyStations(lat, lng, radius);
    return NextResponse.json({ stations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "역 검색 실패" },
      { status: 500 }
    );
  }
}
