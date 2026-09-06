/**
 * 주변 지하철역 API — 역세권 판단용.
 * GET ?lat=..&lng=..&radius=1000 → 가까운 순 역 목록.
 */

import { NextRequest, NextResponse } from "next/server";
import { searchNearbyStations } from "@/lib/integrations/kakao";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rawLat = sp.get("lat");
  const rawLng = sp.get("lng");
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const radius = Number(sp.get("radius") ?? "1000");

  if (
    rawLat === null ||
    rawLng === null ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180 ||
    !Number.isFinite(radius) ||
    radius < 100 ||
    radius > 20_000
  ) {
    return NextResponse.json(
      {
        code: "INVALID_STATION_SEARCH",
        error: "유효한 좌표와 100~20,000m 검색 반경이 필요합니다.",
      },
      { status: 400 },
    );
  }

  if (!process.env.KAKAO_REST_API_KEY?.trim()) {
    return NextResponse.json(
      {
        code: "KAKAO_NOT_CONFIGURED",
        error: "카카오 장소 검색이 설정되지 않았습니다.",
      },
      { status: 503 },
    );
  }

  try {
    const stations = await searchNearbyStations(lat, lng, radius);
    return NextResponse.json(
      { stations },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (err) {
    console.error("nearby station search failed", err);
    return NextResponse.json(
      {
        code: "KAKAO_STATION_SEARCH_FAILED",
        error: "카카오 장소 검색에 연결하지 못했습니다.",
      },
      { status: 502 },
    );
  }
}
