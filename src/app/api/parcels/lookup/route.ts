/**
 * POST /api/parcels/lookup
 *
 * 주소를 받아서 5개 외부 API를 호출하고 부지 정보를 통합 반환:
 *   1. Kakao         → 좌표 + 행정코드 + 정확 지번 (mainAddressNo/subAddressNo)
 *   2. V월드 지적    → PNU + 면적 + 지목 + 공시지가
 *   3. V월드 용도지역 → 용도지역 + 건폐율 + 용적률 + 높이제한
 *   4. MOLIT 건축물대장 → 현재 건물 정보 + 재건축 시그널
 *
 * 작은 부지에서 V월드 PNU 부정확 문제 때문에 건축물대장 lookup은
 * 카카오 지번 기반(lookupBuildingByJibun)을 우선 사용.
 */

import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/integrations/kakao";
import {
  lookupCadastral,
  lookupZoningByPNU,
} from "@/lib/integrations/vworld";
import { lookupBuildingByJibun, estimateUnitAreaSqm } from "@/lib/integrations/molit-building";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const address = body.address?.trim();
  if (!address) {
    return NextResponse.json({ error: "address가 필요합니다" }, { status: 400 });
  }

  try {
    // 1. Kakao 지오코딩
    const geo = await geocodeAddress(address);
    if (!geo) {
      return NextResponse.json(
        { error: `주소를 찾을 수 없습니다: ${address}` },
        { status: 404 }
      );
    }

    // 2. V월드 지적 정보 — 지번 매칭으로 올바른 필지 선택
    const cadastral = await lookupCadastral(geo.lat, geo.lng, {
      mainAddressNo: geo.mainAddressNo,
      subAddressNo: geo.subAddressNo,
      mountainYn: geo.mountainYn,
    });
    if (!cadastral) {
      return NextResponse.json(
        { error: "V월드 지적 정보 조회 실패" },
        { status: 502 }
      );
    }

    // 3. V월드 용도지역 정보 (PNU 기반)
    let zoning;
    try {
      zoning = await lookupZoningByPNU(cadastral.pnu);
    } catch (err) {
      console.error("V월드 용도지역 조회 실패:", err);
      return NextResponse.json(
        { error: "용도지역 정보 조회 실패" },
        { status: 502 }
      );
    }

    // 4. MOLIT 건축물대장 (카카오 지번 기반 — 더 정확)
    let currentBuilding = null;
    try {
      currentBuilding = await lookupBuildingByJibun(
        geo.bCode,
        geo.mainAddressNo,
        geo.subAddressNo,
        geo.mountainYn || "N"
      );
    } catch (err) {
      console.warn("MOLIT 건축물대장 조회 실패 (비치명적):", err);
      // 건축물대장 실패는 빈땅으로 간주하고 계속
    }

    return NextResponse.json({
      // Kakao
      address: geo.address,
      addressRoad: geo.roadAddress,
      lat: cadastral.centroid.lat,
      lng: cadastral.centroid.lng,
      bCode: geo.bCode,
      lawdCd: geo.lawdCd,
      sido: geo.sido,
      sigungu: geo.sigungu,
      dong: geo.dong,
      jibun: geo.jibun,
      mainAddressNo: geo.mainAddressNo,
      subAddressNo: geo.subAddressNo,
      mountainYn: geo.mountainYn,

      // V월드 지적
      pnu: cadastral.pnu,
      lotArea: cadastral.lotAreaSqm,
      boundary: cadastral.boundary,
      roads: cadastral.roads,
      jimok: cadastral.jimok,
      jimokCode: cadastral.jimokCode,
      jimokCategory: cadastral.jimokCategory,
      landPrice: cadastral.landPriceWonPerSqm,
      landPriceYear: cadastral.landPriceYear,

      // V월드 용도지역
      zoning: zoning.zoning,
      zoneCode: zoning.zoneCode,
      maxFAR: zoning.maxFAR,
      maxBCR: zoning.maxBCR,
      heightLimit: zoning.heightLimitM,
      overlays: zoning.overlays,

      // MOLIT 건축물대장 (있으면)
      currentBuilding,
      // 기존 건물 기반 세대당 면적 (하드코딩 50㎡ 대체, 없으면 null)
      existingUnitArea: estimateUnitAreaSqm(currentBuilding),
    });
  } catch (err) {
    console.error("lookup 실패:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "부지 조회 중 예상치 못한 오류 발생",
      },
      { status: 500 }
    );
  }
}
