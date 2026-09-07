import { NextRequest, NextResponse } from "next/server";
import { fetchCadastralContextParcels } from "@/lib/integrations/vworld-cadastral-context";
import {
  fetchUpisRoadBoundaries,
  VWORLD_UPIS_ROAD_DATA,
} from "@/lib/integrations/vworld-upis-roads";
import { vworldRuntimeState } from "@/lib/runtime/integration-mode";

export const runtime = "nodejs";

interface RequestBody {
  targetPnu?: string;
  lat?: number;
  lng?: number;
  radiusM?: number;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetPnu = body.targetPnu?.trim();
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!targetPnu || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "targetPnu, lat, lng가 필요합니다." },
      { status: 400 }
    );
  }

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

  const radiusM = Math.min(180, Math.max(40, Number(body.radiusM) || 100));
  const center = { lat, lng };

  try {
    const [cadastralResult, upisResult] = await Promise.allSettled([
      fetchCadastralContextParcels({
        targetPnu,
        center,
        radiusM,
        maxCount: 80,
      }),
      fetchUpisRoadBoundaries({
        center,
        radiusM: Math.max(120, radiusM),
        maxCount: 40,
      }),
    ]);

    const cadastralParcels =
      cadastralResult.status === "fulfilled" ? cadastralResult.value : [];
    const upisRoads =
      upisResult.status === "fulfilled" ? upisResult.value.parcels : [];
    const upisRoadSummaries =
      upisResult.status === "fulfilled" ? upisResult.value.summaries : [];

    if (cadastralResult.status === "rejected") {
      console.warn("주변 연속지적도 조회 실패:", cadastralResult.reason);
    }
    if (upisResult.status === "rejected") {
      console.warn("도시계획 도로 경계 조회 실패:", upisResult.reason);
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
      sourceSummary: {
        cadastralParcelCount: cadastralParcels.length,
        cadastralRoadCount,
        upisRoadBoundaryCount: upisRoads.length,
        activeRoadBoundarySource:
          cadastralRoadCount > 0
            ? "cadastral-road-parcel"
            : upisRoads.length > 0
              ? "upis-road-boundary"
              : "centerline-reference-only",
        upisDataCode: VWORLD_UPIS_ROAD_DATA,
      },
      upisRoadSummaries,
      warnings: [
        ...(cadastralResult.status === "rejected"
          ? ["연속지적도 주변 필지 조회에 실패했습니다."]
          : []),
        ...(upisResult.status === "rejected"
          ? ["도시계획 도로 경계 API 조회에 실패했습니다."]
          : []),
      ],
    });
  } catch (error) {
    console.error("지적·도로 context 조회 실패:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "지적·도로 context 조회 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
