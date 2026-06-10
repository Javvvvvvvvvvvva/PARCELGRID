/**
 * POST /api/parcels/estimate-price
 *
 * 부지의 시장 평균 인수가를 추정.
 *
 * 본인 도구가 6단계 시군구 티어 multiplier로 정확도 향상 (estimate-price.ts).
 *
 * Input:
 *   address: 전체 주소 (시군구 추출에 사용)
 *   lotArea: m²
 *   landPrice: 공시지가 원/m²
 *   lawdCd: 법정동 코드 (MOLIT 토지 실거래 조회용)
 *   jimokCategory: "buildable" | "farmland" | "forest" | "other"
 */

import { NextRequest, NextResponse } from "next/server";
import { estimateMarketPrice } from "@/lib/finance/estimate-price";
import { fetchMolitRange } from "@/lib/integrations/molit";
import type { JimokCategory } from "@/lib/integrations/vworld";

export const runtime = "nodejs";

const WON_TO_MANWON = 10_000;

function recentYearMonth(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  let body: {
    address?: string;
    lotArea?: number;
    landPrice?: number;
    lawdCd?: string;
    jimokCategory?: JimokCategory;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { address, lotArea, landPrice, lawdCd, jimokCategory } = body;

  if (!address || !lotArea || !landPrice || !lawdCd) {
    return NextResponse.json(
      { error: "address, lotArea, landPrice, lawdCd 필수" },
      { status: 400 }
    );
  }

  try {
    // 최근 12개월 토지 실거래 가져오기
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

    // 추정 호출
    const result = estimateMarketPrice({
      publicLandValueManwon: landPrice / WON_TO_MANWON,
      lotAreaSqm: lotArea,
      landTransactions,
      jimokCategory: jimokCategory ?? "buildable",
      address,
    });

    return NextResponse.json({
      ...result,
      transactionCount: landTransactions.length,
    });
  } catch (err) {
    console.error("estimate-price 실패:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "인수가 추정 중 오류",
      },
      { status: 500 }
    );
  }
}
