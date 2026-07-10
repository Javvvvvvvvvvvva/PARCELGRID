/**
 * GET /api/parcels/address-suggest?q=서울+도봉
 *
 * Kakao 주소 검색 자동완성 — 입력 중 후보 목록 반환.
 * API 키는 서버에서만 사용.
 */

import { NextRequest, NextResponse } from "next/server";
import { searchAddressSuggestions } from "@/lib/integrations/kakao";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const suggestions = await searchAddressSuggestions(q, 10);
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("address-suggest error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "주소 검색 실패" },
      { status: 502 }
    );
  }
}
