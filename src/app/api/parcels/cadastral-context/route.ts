import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { JSON_REQUEST_LIMITS, readJsonObject } from "@/lib/http/json-request";
import { fetchCadastralContextParcels } from "@/lib/integrations/vworld-cadastral-context";
import {
  fetchUpisRoadBoundaries,
  VWORLD_UPIS_ROAD_DATA,
} from "@/lib/integrations/vworld-upis-roads";
import { vworldRuntimeState } from "@/lib/runtime/integration-mode";
import { requireApiCapability } from "@/lib/auth/request";
import { createProviderDeadline } from "@/lib/http/provider-deadline";
import { vworldEvidenceWarnings, vworldResultEvidence, vworldUnavailableEvidence } from "@/lib/integrations/vworld-evidence";

export const runtime = "nodejs";

const requestSchema = z.object({
  targetPnu: z.string().trim().min(1).max(128),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  radiusM: z.number().positive().max(10_000).optional(),
});

export async function POST(request: NextRequest) {
  const authorization = await requireApiCapability(request, "project.read");
  if (!authorization.ok) return authorization.response;
  const input = await readJsonObject(request, { maxBytes: JSON_REQUEST_LIMITS.lookup });
  if (!input.ok) return input.response;
  const parsed = requestSchema.safeParse(input.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "targetPnu, lat, lng가 필요합니다." },
      { status: 400 }
    );
  }
  const { targetPnu, lat, lng } = parsed.data;

  const vworld = vworldRuntimeState();
  if (vworld.mode !== "enabled") {
    return NextResponse.json(
      {
        code:
          vworld.mode === "disabled"
            ? "VWORLD_DISABLED"
            : "VWORLD_NOT_CONFIGURED",
        error: "VWorld 지적·도로 컨텍스트가 현재 비활성 상태입니다.",
        nextAction:
          "수동 GeoJSON 필지 경계를 사용하거나 VWorld 연결이 가능한 환경에서 다시 조회하세요.",
        retryable: false,
      },
      { status: 503 },
    );
  }

  const radiusM = Math.min(180, Math.max(40, parsed.data.radiusM ?? 100));
  const center = { lat, lng };

  try {
    const budget = createProviderDeadline(12_000, request.signal);
    budget.check();
    const [cadastralResult, upisResult] = await Promise.allSettled([
      fetchCadastralContextParcels({
        targetPnu,
        center,
        radiusM,
        maxCount: 80,
        signal: budget.signal,
        outerDeadline: budget.deadline,
      }),
      fetchUpisRoadBoundaries({
        center,
        radiusM: Math.max(120, radiusM),
        maxCount: 40,
        signal: budget.signal,
        outerDeadline: budget.deadline,
      }),
    ]);

    const cadastralParcels =
      cadastralResult.status === "fulfilled" ? cadastralResult.value : [];
    const upisRoads =
      upisResult.status === "fulfilled" ? upisResult.value.parcels : [];
    const upisRoadSummaries =
      upisResult.status === "fulfilled" ? upisResult.value.summaries : [];

    if (cadastralResult.status === "rejected") {
      console.warn("주변 연속지적도 조회 실패");
    }
    if (upisResult.status === "rejected") {
      console.warn("도시계획 도로 경계 조회 실패");
    }
    budget.check();
    const sourceEvidence = {
      cadastral: cadastralResult.status === "fulfilled"
        ? vworldResultEvidence("LP_PA_CBND_BUBUN", cadastralParcels.length)
        : vworldUnavailableEvidence("LP_PA_CBND_BUBUN", "request-failed"),
      upis: upisResult.status === "fulfilled"
        ? vworldResultEvidence("LT_C_UPISUQ151", upisRoads.length)
        : vworldUnavailableEvidence("LT_C_UPISUQ151", "request-failed"),
    };
    if (cadastralResult.status === "rejected" && upisResult.status === "rejected") {
      return NextResponse.json({
        code: "VWORLD_CONTEXT_UNAVAILABLE",
        error: "지적·도로 컨텍스트 데이터를 확인하지 못했습니다.",
        sourceEvidence,
        retryable: true,
      }, { status: 502 });
    }

    const cadastralRoadCount = cadastralParcels.filter(
      (parcel) => parcel.jimok.trim() === "도로"
    ).length;
    const parcels =
      cadastralRoadCount > 0
        ? cadastralParcels
        : [...cadastralParcels, ...upisRoads];

    return NextResponse.json({
      source: "VWorld LP_PA_CBND_BUBUN + LT_C_UPISUQ151",
      targetPnu,
      parcels,
      sourceEvidence,
      queryCompleteness: "unconfirmed",
      sourceSummary: {
        cadastralParcelCount: sourceEvidence.cadastral.resultCount,
        cadastralRoadCount: cadastralResult.status === "fulfilled" ? cadastralRoadCount : null,
        upisRoadBoundaryCount: sourceEvidence.upis.resultCount,
        activeRoadBoundarySource:
          cadastralRoadCount > 0
            ? "cadastral-road-parcel"
            : upisRoads.length > 0
              ? "upis-road-boundary"
              : "centerline-reference-only",
        upisDataCode: VWORLD_UPIS_ROAD_DATA,
      },
      upisRoadSummaries,
      warnings: vworldEvidenceWarnings(Object.values(sourceEvidence)),
    });
  } catch {
    console.warn("지적·도로 컨텍스트 조회를 완료하지 못했습니다.");
    return NextResponse.json(
      {
        code: "VWORLD_CONTEXT_UNAVAILABLE",
        error: "지적·도로 컨텍스트 데이터를 확인하지 못했습니다.",
        sourceEvidence: {
          cadastral: vworldUnavailableEvidence("LP_PA_CBND_BUBUN", "request-failed"),
          upis: vworldUnavailableEvidence("LT_C_UPISUQ151", "request-failed"),
        },
        retryable: true,
      },
      { status: 502 }
    );
  }
}
