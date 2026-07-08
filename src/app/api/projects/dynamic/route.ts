/**
 * POST /api/projects/dynamic
 *
 * 본인 부지로 시나리오 4종 생성 + 계산 + 실거래 가져오기.
 *
 * 흐름:
 *   1. generateScenariosForParcel(parcel) → Scenario[]
 *   2. MOLIT 토지+오피스텔+도시형생활주택 실거래 가져오기 (최근 12개월)
 *   3. computeProject(parcel, scenarios, { transactions }) → ProjectComputed
 */

import { NextRequest, NextResponse } from "next/server";
import { generateScenariosForParcel } from "@/lib/services/generate-scenarios";
import { computeProject } from "@/lib/services/compute-project";
import { fetchMolitRange, type MolitTransaction } from "@/lib/integrations/molit";
import { estimateSalePriceFromComps } from "@/lib/finance/sale-price-from-comps";
import type { Parcel } from "@/lib/finance/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function recentYearMonth(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 본인 도구가 받을 추가 필드 (parcel 외에)
interface DynamicBody {
  parcel: Parcel;
  /** 법정동 코드 (MOLIT lawdCd, 5자리, 예: "11680") */
  lawdCd?: string;
  /** 본인 부지의 법정동 이름 (예: "역삼동") — 같은 동 표시용 */
  parcelDong?: string;
}

export async function POST(req: NextRequest) {
  let body: DynamicBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { parcel, lawdCd, parcelDong } = body;
  if (!parcel) {
    return NextResponse.json({ error: "parcel 필수" }, { status: 400 });
  }

  if (!parcel.lotArea || !parcel.zoning || !parcel.acquiredPrice) {
    return NextResponse.json(
      { error: "parcel.lotArea, zoning, acquiredPrice는 필수" },
      { status: 400 }
    );
  }

  try {
    // 1. 시나리오 4종 생성
    const scenarios = generateScenariosForParcel(parcel);

    if (scenarios.length === 0) {
      return NextResponse.json(
        { error: "이 용도지역에서 가능한 시나리오가 없습니다" },
        { status: 422 }
      );
    }

    // 2. MOLIT 실거래 가져오기 (병렬 — 4개 유형)
    // lawdCd가 없으면 빈 배열
    let transactions: MolitTransaction[] = [];
    if (lawdCd) {
      const start = recentYearMonth(12);
      const end = recentYearMonth(0);

      const fetchType = (type: "land" | "officetel" | "commercial" | "apartment" | "house") =>
        fetchMolitRange({
          lawdCd,
          type,
          startYearMonth: start,
          endYearMonth: end,
        }).catch((err) => {
          console.warn(`MOLIT ${type} 실패:`, err instanceof Error ? err.message : err);
          return [] as MolitTransaction[];
        });

      const [land, officetel, commercial, apartment, house] = await Promise.all([
        fetchType("land"),
        fetchType("officetel"),
        fetchType("commercial"),
        fetchType("apartment"),
        fetchType("house"),
      ]);

      transactions = [...land, ...officetel, ...commercial, ...apartment, ...house];
      console.log(
        `MOLIT 거래 ${transactions.length}건 (토지 ${land.length} / 오피스텔 ${officetel.length} / 상업 ${commercial.length} / 아파트 ${apartment.length} / 단독다가구 ${house.length})`
      );
    }

    // 2.5 매각 단가 실거래 보정 (recompute와 동일 유틸 — 신축 우선)
    const saleEst = estimateSalePriceFromComps(
      transactions
        .filter((t) => t.exclusiveArea > 0 && t.priceManwon > 0)
        .map((t) => ({
          type: t.type,
          pricePerPyeong: t.priceManwon / (t.exclusiveArea / 3.305785),
          buildYear: t.buildYear,
          sameDong: parcelDong ? t.dongName === parcelDong : false,
          address: `${t.dongName} ${t.jibun}`.trim(),
          date: t.date,
          priceWon: t.priceManwon * 10_000,
        }))
    );
    if (saleEst) {
      for (const sc of scenarios) {
        sc.assumptions = { ...sc.assumptions, salePricePerSqM: saleEst.salePricePerSqM };
      }
      console.log(
        `매각 단가 실거래 보정(dynamic): ${saleEst.basis} 평당 ${saleEst.medianPPP.toLocaleString()}만 → ${saleEst.salePricePerSqM.toLocaleString()}원/㎡ (보수: 전체 ${saleEst.conservativeCount}건 평당 ${saleEst.conservativePPP.toLocaleString()}만)`
      );
    }

    // 3. 시나리오 계산 + 실거래 변환
    const computed = computeProject(parcel, scenarios, {
      transactions,
      parcelDong: parcelDong ?? "",
      calculateMaxAcquisition: true, // 역산 활성화 (~100ms)
    });
    if (saleEst) computed.saleEstimate = saleEst;

    return NextResponse.json(computed);
  } catch (err) {
    console.error("dynamic project 계산 실패:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "시나리오 계산 중 예상치 못한 오류",
      },
      { status: 500 }
    );
  }
}
