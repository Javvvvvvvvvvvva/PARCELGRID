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
    // 최근 12개월 토지 + 구축 단독/다가구 실거래를 병렬로 조회
    // (land / house 두 범위를 동시에 — 내부 월별 호출도 병렬, 동시성은 전역 세마포어가 제한)
    const start = recentYearMonth(12);
    const end = recentYearMonth(0);
    const [landTransactions, houseTransactionsRaw] = await Promise.all([
      fetchMolitRange({
        lawdCd,
        type: "land",
        startYearMonth: start,
        endYearMonth: end,
      }).catch((err) => {
        console.warn("MOLIT 토지 실거래 조회 실패:", err);
        return [];
      }),
      // 구축 단독/다가구 (토지 proxy — 인수가 추정 C)
      fetchMolitRange({
        lawdCd,
        type: "house",
        startYearMonth: start,
        endYearMonth: end,
      }).catch((err) => {
        console.warn("MOLIT 단독/다가구 실거래 조회 실패:", err);
        return [];
      }),
    ]);
    const houseTransactions = houseTransactionsRaw.map((t) => ({
      type: t.type,
      priceManwon: t.priceManwon,
      plottageAr: t.plottageAr,
      buildYear: t.buildYear,
      sameDong: t.dongName ? address.includes(t.dongName) : false,
      address: `${t.dongName} ${t.jibun}`.trim(),
      date: t.date,
    }));

    // 추정 호출
    const result = estimateMarketPrice({
      publicLandValueManwon: landPrice / WON_TO_MANWON,
      lotAreaSqm: lotArea,
      landTransactions,
      houseTransactions,
      jimokCategory: jimokCategory ?? "buildable",
      address,
    });

    if (result.houseEstimate) {
      console.log(
        `인수가 토지 proxy: ${result.houseEstimate.basis} 대지 평당 ${result.houseEstimate.medianPPPLand.toLocaleString()}만 → 추정 ${(result.houseEstimate.estimateManwon / 10000).toFixed(1)}억`
      );
    }

    return NextResponse.json({
      ...result,
      transactionCount: landTransactions.length,
      // Round H-2: 비건축 지목 제외(분포 오염 방지) + fallback
      transactions: (() => {
        const base = landTransactions.filter(
          (t) => t.exclusiveArea > 0 && t.priceManwon > 0
        );
        const NON_BUILDABLE = [
          "임야", "전", "답", "과수원", "목장용지",
          "잡종지", "도로", "구거", "하천", "제방",
        ];
        const buildable = base.filter(
          (t) => !t.jimok || !NON_BUILDABLE.includes(t.jimok)
        );
        // 대지성 거래가 너무 적으면(<10건) 필터 풀고 전체 사용
        const rows = buildable.length >= 10 ? buildable : base;
        return rows.map((t) => ({
          priceManwon: t.priceManwon,
          areaSqm: t.exclusiveArea,
          date: t.date,
          address: `${t.dongName} ${t.jibun}`,
          jimok: t.jimok ?? null,
        }));
      })(),
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
