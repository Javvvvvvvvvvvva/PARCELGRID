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

import { transactionEvidenceMessage } from "@/lib/integrations/molit-evidence";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { JSON_REQUEST_LIMITS, readJsonObject } from "@/lib/http/json-request";
import { checkAcquisition } from "@/lib/finance/acquisition-check";
import { fetchMolitRangeWithEvidence } from "@/lib/integrations/molit";
import { requireApiCapability } from "@/lib/auth/request";

export const runtime = "nodejs";

const requestSchema = z.object({
  parcel: z.object({ lotAreaSqm: z.number().positive().max(10_000_000),
    landPriceWonPerSqm: z.number().nonnegative().max(10_000_000_000),
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    jimokCategory: z.enum(["buildable", "farmland", "forest", "other"]).optional() }),
  acquisitionPriceManwon: z.number().positive().max(1_000_000_000_000),
  acquisitionDate: z.iso.date(), lawdCd: z.string().regex(/^\d{5}$/),
  scope: z.enum(["dong", "sigungu", "radius"]).default("dong"),
  radiusKm: z.number().positive().max(100).optional(), targetDong: z.string().trim().max(40).optional(),
  jimokFilter: z.enum(["match-parcel", "buildable-only", "all"]).default("match-parcel"),
});

function recentYearMonth(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  const authorization = await requireApiCapability(req, "analysis.run");
  if (!authorization.ok) return authorization.response;
  const input = await readJsonObject(req, { maxBytes: JSON_REQUEST_LIMITS.calculation });
  if (!input.ok) return input.response;
  const parsed = requestSchema.safeParse(input.value);
  if (!parsed.success) {
    return NextResponse.json({ code: "INVALID_ACQUISITION_INPUT", error: "부지·인수가·기준일·지역 입력을 확인하세요." }, { status: 422 });
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
  } = parsed.data;

  if (scope === "radius") {
    return NextResponse.json(
      {
        error: "반경 비교 미지원",
        detail:
          "현재 국토부 토지 실거래 응답에는 거래별 좌표가 없어 실제 반경 필터를 검증할 수 없습니다. 동 또는 시군구 비교를 사용하세요.",
      },
      { status: 422 }
    );
  }

  try {
    // 최근 12개월 토지 실거래
    const start = recentYearMonth(12);
    const end = recentYearMonth(0);
    const landResult = await fetchMolitRangeWithEvidence({
      lawdCd,
      type: "land",
      startYearMonth: start,
      endYearMonth: end,
      signal: req.signal,
    });

    const result = checkAcquisition({
      parcel,
      acquisitionPriceManwon,
      acquisitionDate,
      landTransactions: landResult.evidence.status === "complete" ? landResult.transactions : [],
      scope,
      radiusKm,
      targetDong,
      jimokFilter,
    });

    return NextResponse.json({ ...result, transactionEvidence: [landResult.evidence], warnings: [...result.warnings, transactionEvidenceMessage([landResult.evidence])] });
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
