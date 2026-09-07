/**
 * POST /api/projects/dynamic
 *
 * 본인 부지에 맞는 시나리오 생성 + 계산 + 실거래 가져오기.
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
import { z } from "zod";

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

const coordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

const sourceMetadataSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(300),
    sourceRef: z.string().trim().max(2_000).optional(),
    asOf: z.string().max(40).optional(),
    retrievedAt: z.string().max(40).optional(),
    checkedBy: z.string().trim().max(120).optional(),
    checkedRole: z.string().trim().max(120).optional(),
    note: z.string().trim().max(2_000).optional(),
  })
  .passthrough();

const constraintEvidenceSchema = sourceMetadataSchema.extend({
  value: z.number().finite().nonnegative().nullable(),
  unit: z.enum(["%", "m", "층"]),
  status: z.enum([
    "unknown",
    "reference-only",
    "user-entered",
    "source-backed",
    "expert-approved",
  ]),
  referenceValue: z.number().finite().nonnegative().nullable().optional(),
  referenceSourceName: z.string().trim().max(300).optional(),
  referenceSourceRef: z.string().trim().max(2_000).optional(),
});

const regulatoryConstraintsSchema = z
  .object({
    version: z.literal("regulatory-provenance-2026.1"),
    retrievedAt: z.string().max(40),
    zoningSource: sourceMetadataSchema.extend({
      status: z.enum(["source-backed", "unknown"]),
    }),
    far: constraintEvidenceSchema,
    bcr: constraintEvidenceSchema,
    height: constraintEvidenceSchema,
    floors: constraintEvidenceSchema,
  })
  .passthrough();

const inputProvenanceSchema = z.object({
  mode: z.enum(["vworld", "manual"]),
  parcelFacts: z.enum(["vworld-cadastral", "user-entered"]),
  geometry: z.enum([
    "vworld-cadastral",
    "user-geojson",
    "unavailable",
  ]),
  zoning: z.enum(["vworld-land-use", "user-entered"]),
  recordedAt: z.string().max(40),
  note: z.string().trim().max(2_000).optional(),
});

const buildingLookupSchema = z
  .object({
    hasBuilding: z.boolean(),
    buildings: z.array(z.record(z.unknown())).max(500),
    totalBuildingArea: z.number().finite().nonnegative(),
    oldestApprovalDate: z.string().max(40),
    maxAgeYears: z.number().finite().nonnegative(),
    averageAgeYears: z.number().finite().nonnegative(),
    redevelopmentSignal: z.enum(["vacant", "rebuild", "renovate", "keep"]),
    signalLabel: z.string().max(200),
    signalReasoning: z.string().max(2_000),
  })
  .passthrough();

const parcelSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    address: z.string().trim().min(1).max(200),
    addressRoad: z.string().max(200),
    lat: z.number().finite().min(-90).max(90).optional(),
    lng: z.number().finite().min(-180).max(180).optional(),
    lotArea: z.number().finite().positive().max(100_000_000),
    boundary: z.array(coordinateSchema).min(3).max(20_000).optional(),
    roads: z
      .array(
        z.object({
          name: z.string().max(200).nullable(),
          points: z.array(coordinateSchema).min(2).max(5_000),
        }),
      )
      .max(500)
      .optional(),
    zoning: z.string().trim().min(1).max(200),
    zoneCode: z.string().max(40),
    maxFAR: z.number().finite().positive().max(10_000),
    maxBCR: z.number().finite().positive().max(100),
    heightLimit: z.number().finite().nonnegative().max(10_000),
    regulatoryConstraints: regulatoryConstraintsSchema.optional(),
    inputProvenance: inputProvenanceSchema.optional(),
    overlays: z
      .array(
        z.object({
          code: z.string().max(100),
          name: z.string().max(300),
          conflict: z.string().max(2_000),
        }),
      )
      .max(200)
      .optional(),
    setback: z.object({
      road: z.number().finite().nonnegative().max(1_000),
      side: z.number().finite().nonnegative().max(1_000),
      rear: z.number().finite().nonnegative().max(1_000),
    }),
    currentBuilding: buildingLookupSchema.nullable().optional(),
    landPrice: z.number().finite().nonnegative().max(1_000_000_000_000),
    estMarketPrice: z.number().finite().nonnegative().max(1_000_000_000_000),
    acquired: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    acquiredPrice: z.number().finite().positive().max(1_000_000_000_000),
    demolitionCost: z
      .number()
      .finite()
      .nonnegative()
      .max(1_000_000_000_000)
      .optional(),
  })
  .passthrough()
  .refine(({ lat, lng }) => (lat == null) === (lng == null), {
    message: "lat과 lng는 함께 입력해야 합니다.",
    path: ["lat"],
  });

const dynamicBodySchema = z.object({
  parcel: parcelSchema,
  lawdCd: z.string().regex(/^\d{5}$/).optional(),
  parcelDong: z.string().trim().max(40).optional(),
});

export async function POST(req: NextRequest) {
  let body: DynamicBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        code: "INVALID_JSON",
        error: "프로젝트 요청 형식을 읽을 수 없습니다.",
        nextAction: "주소 등록 단계에서 다시 시작하세요.",
      },
      { status: 400 },
    );
  }

  const parsed = dynamicBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "INVALID_PROJECT_INPUT",
        error: "프로젝트 계산 입력값이 올바르지 않습니다.",
        nextAction: "주소 등록 단계에서 부지를 다시 조회하세요.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }
  body = parsed.data as DynamicBody;

  const { parcel, lawdCd, parcelDong } = body;

  try {
    // 1. 용도지역과 부지 규모에 맞는 시나리오 생성
    const scenarios = generateScenariosForParcel(parcel);

    if (scenarios.length === 0) {
      return NextResponse.json(
        {
          code: "NO_ELIGIBLE_SCENARIO",
          error: "현재 확인된 조건으로 생성할 수 있는 예비 시나리오가 없습니다.",
          nextAction: "용도지역 원문과 사용자 입력값을 확인하세요.",
        },
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

    // 2.5 매각 단가 실거래 참고 보정 (recompute와 동일 유틸 — 신축 우선)
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
        `매각 단가 실거래 참고 보정(dynamic): ${saleEst.basis} 평당 ${saleEst.medianPPP.toLocaleString()}만 → ${saleEst.salePricePerSqM.toLocaleString()}원/㎡ (전체 거래 중앙값: ${saleEst.conservativeCount}건 평당 ${saleEst.conservativePPP.toLocaleString()}만)`
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
        code: "PROJECT_COMPUTE_FAILED",
        error: "프로젝트 시나리오 계산을 완료하지 못했습니다.",
        nextAction: "저장된 부지 입력을 다시 확인하고 재시도하세요.",
      },
      { status: 500 }
    );
  }
}
