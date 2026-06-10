/**
 * POST /api/parcels/acquisition-check
 *
 * 인수가 검증 (3축 분석):
 *   - 시장가 대비 (실거래 중앙값)
 *   - 공시지가 대비
 *   - 시행 가능성 (잠재 매출 대비)
 *
 * 본인 도구의 checkAcquisition() 호출.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkAcquisition } from "@/lib/finance/acquisition-check";
import { fetchMolitRange } from "@/lib/integrations/molit";
import type { JimokCategory } from "@/lib/integrations/vworld";

export const runtime = "nodejs";

function recentYearMonth(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  let body: {
    parcel?: {
      lotAreaSqm: number;
      landPriceWonPerSqm: number;
      lat: number;
      lng: number;
      jimokCategory?: JimokCategory;
    };
    acquisitionPriceManwon?: number;
    acquisitionDate?: string;
    lawdCd?: string;
    scope?: "dong" | "sigungu" | "radius";
    radiusKm?: number;
    targetDong?: string;
    jimokFilter?: "match-parcel" | "buildable-only" | "all";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    parcel,
    acquisitionPriceManwon,
    acquisitionDate,
    lawdCd,
    scope = "dong",
    radiusKm,
    targetDong,
    jimokFilter = "match-parcel",
  } = body;

  if (!parcel || !acquisitionPriceManwon || !acquisitionDate || !lawdCd) {
    return NextResponse.json(
      { error: "parcel, acquisitionPriceManwon, acquisitionDate, lawdCd 필수" },
      { status: 400 }
    );
  }

  try {
    // 최근 12개월 토지 실거래
    const start = recentYearMonth(12);
    const end = recentYearMonth(0);
    const landTransactions = await fetchMolitRange({
      lawdCd,
      type: "land",
      startYearMonth: start,
      endYearMonth: end,
    }).catch((err) => {
      console.warn("MOLIT 토지 실거래 조회 실패:", err);
      return [];
    });

    const result = checkAcquisition({
      parcel,
      acquisitionPriceManwon,
      acquisitionDate,
      landTransactions,
      scope,
      radiusKm,
      targetDong,
      jimokFilter,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("acquisition-check 실패:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "인수가 검증 중 오류",
      },
      { status: 500 }
    );
  }
}
