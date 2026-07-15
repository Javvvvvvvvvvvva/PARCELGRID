import { NextRequest, NextResponse } from "next/server";
import { fetchCadastralContextParcels } from "@/lib/integrations/vworld-cadastral-context";

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

  try {
    const parcels = await fetchCadastralContextParcels({
      targetPnu,
      center: { lat, lng },
      radiusM: Math.min(150, Math.max(40, Number(body.radiusM) || 80)),
      maxCount: 80,
    });
    return NextResponse.json({
      source: "VWorld LP_PA_CBND_BUBUN",
      targetPnu,
      parcels,
    });
  } catch (error) {
    console.error("주변 연속지적도 조회 실패:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "주변 연속지적도 조회 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
