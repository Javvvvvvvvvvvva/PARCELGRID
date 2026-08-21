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
import { z } from "zod";
import { estimateMarketPrice } from "@/lib/finance/estimate-price";
import { fetchMolitRange } from "@/lib/integrations/molit";
import {
  jimokToCategory,
  type JimokCategory,
} from "@/lib/integrations/vworld";

export const runtime = "nodejs";

const WON_TO_MANWON = 10_000;

const requestSchema = z.object({
  address: z.string().trim().min(1).max(200),
  lotArea: z.number().finite().positive().max(10_000_000),
  landPrice: z.number().finite().nonnegative().max(10_000_000_000),
  lawdCd: z.string().regex(/^\d{5}$/, "법정동 코드는 5자리 숫자여야 합니다."),
  jimokCategory: z
    .enum(["buildable", "farmland", "forest", "other"])
    .optional(),
});

function recentYearMonth(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "입력값을 확인하세요.", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { address, lotArea, landPrice, lawdCd, jimokCategory } = parsed.data;

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
      // 대상 지목 카테고리와 일치하는 거래만 지도·분포 표본으로 반환
      transactions: (() => {
        const targetCategory: JimokCategory =
          (jimokCategory ?? "buildable") === "other"
            ? "buildable"
            : (jimokCategory ?? "buildable");
        return landTransactions
          .filter(
            (transaction) =>
              transaction.exclusiveArea > 0 &&
              transaction.priceManwon > 0 &&
              transaction.jimok != null &&
              jimokToCategory(transaction.jimok) === targetCategory,
          )
          .map((transaction) => ({
            priceManwon: transaction.priceManwon,
            areaSqm: transaction.exclusiveArea,
            date: transaction.date,
            address: `${transaction.dongName} ${transaction.jibun}`,
            jimok: transaction.jimok ?? null,
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
