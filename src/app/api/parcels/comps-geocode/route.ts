/**
 * 실거래 지오코딩 API — 동(洞) 중심 근사 배치.
 *
 * MOLIT 실거래는 지번을 마스킹("쌍문동 2*")해서 정확한 좌표를 못 얻는다.
 * → 동 이름만 추출해 지오코딩(동 중심), 같은 동 여러 건은 살짝 흩어서 겹침 방지.
 * 동은 몇 개뿐이라 캐싱으로 빠르게.
 *
 * POST body: { addresses: string[] }
 * 응답: { coords: ({ lat, lng, approx: true } | null)[] } — 입력 순서 유지.
 */

import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/integrations/kakao";

export const runtime = "nodejs";

/** "쌍문동 2*" → "쌍문동" (동/읍/면까지만, 지번 제거) */
function extractDong(address: string): string | null {
  const m = address.match(/([가-힣]+(?:동|읍|면|리))/);
  return m ? m[1] : null;
}

/** 동 중심 좌표 주변에 결정적(deterministic) 흩뿌리기 — 인덱스 기반 */
function scatter(
  lat: number,
  lng: number,
  index: number
): { lat: number; lng: number } {
  // 황금각으로 나선 배치 (겹침 최소) — 반경 최대 ~250m
  const golden = 2.399963;
  const r = 0.0018 * Math.sqrt((index % 40) + 1) * 0.5; // 도 단위 (~200m)
  const theta = index * golden;
  return {
    lat: lat + r * Math.cos(theta),
    lng: lng + r * Math.sin(theta),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const addresses: unknown = body?.addresses;

    if (!Array.isArray(addresses)) {
      return NextResponse.json(
        { error: "addresses 배열이 필요합니다" },
        { status: 400 }
      );
    }

    const addrList = addresses.filter((a): a is string => typeof a === "string");

    // 동 이름 추출 → 고유 동만 지오코딩 (캐싱)
    const dongCache = new Map<string, { lat: number; lng: number } | null>();
    const uniqueDongs = Array.from(
      new Set(addrList.map(extractDong).filter((d): d is string => d != null))
    );

    for (const dong of uniqueDongs) {
      try {
        const r = await geocodeAddress(dong);
        dongCache.set(dong, r ? { lat: r.lat, lng: r.lng } : null);
      } catch {
        dongCache.set(dong, null);
      }
    }

    // 각 주소 → 동 좌표 + 흩뿌리기 (같은 동 내 순번으로)
    const dongIndex = new Map<string, number>();
    const coords = addrList.map((addr) => {
      const dong = extractDong(addr);
      if (!dong) return null;
      const base = dongCache.get(dong);
      if (!base) return null;
      const idx = dongIndex.get(dong) ?? 0;
      dongIndex.set(dong, idx + 1);
      const s = scatter(base.lat, base.lng, idx);
      return { lat: s.lat, lng: s.lng, approx: true };
    });

    return NextResponse.json({ coords });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "지오코딩 실패" },
      { status: 500 }
    );
  }
}
