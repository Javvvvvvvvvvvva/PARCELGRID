/**
 * POST /api/projects/dynamic
 *
 * 본인 부지로 시나리오 4종 생성 + 계산.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateScenariosForParcel } from "@/lib/services/generate-scenarios";
import { computeProject } from "@/lib/services/compute-project";
import type { Parcel } from "@/lib/finance/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { parcel?: Parcel };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parcel = body.parcel;
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
    const scenarios = generateScenariosForParcel(parcel);

    if (scenarios.length === 0) {
      return NextResponse.json(
        { error: "이 용도지역에서 가능한 시나리오가 없습니다" },
        { status: 422 }
      );
    }

    const computed = computeProject(parcel, scenarios);
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
