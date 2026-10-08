import { NextRequest, NextResponse } from "next/server";
import { selectionContextRequestSchema } from "@/lib/parcels/selection-context";
import { emptyContextLayer, fetchSelectionContext } from "@/lib/integrations/vworld-selection-context";
import { vworldRuntimeState } from "@/lib/runtime/integration-mode";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = selectionContextRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "선택한 필지와 위치를 확인하세요." }, { status: 400 });
  const mode = vworldRuntimeState().mode;
  if (mode !== "enabled") {
    const message = mode === "disabled" ? "주변 도형 연결이 비활성 상태입니다." : "주변 도형 연결이 설정되지 않았습니다.";
    const cadastral = emptyContextLayer("parcels", "unavailable", message);
    return NextResponse.json({ ...parsed.data, layers: { parcels: cadastral, roads: cadastral,
      buildings: emptyContextLayer("buildings", "unavailable", message) } }, { headers: { "Cache-Control": "no-store" } });
  }
  const context = await fetchSelectionContext(parsed.data, request.signal);
  return NextResponse.json(context, { headers: { "Cache-Control": "no-store" } });
}
