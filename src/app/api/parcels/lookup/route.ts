/**
 * POST /api/parcels/lookup
 *
 * 주소를 받아 외부 데이터를 통합 반환:
 *   1. Kakao                    → 좌표 + 행정코드 + 정확 지번
 *   2. V월드 연속지적도          → PNU + 면적 + 지목 + 공시지가 + 필지 경계
 *   3. V월드 용도지역            → 용도지역 + 건폐율 + 용적률 + 높이제한
 *   4. MOLIT 건축물대장          → 현재 건물 속성 + 재건축 시그널
 *   5. V월드 GIS건물통합정보     → 실제 건물 외곽선·위치·방향 (dt_d010)
 *
 * 작은 부지에서 V월드 PNU 부정확 문제 때문에 건축물대장 lookup은
 * 카카오 지번 기반(lookupBuildingByJibun)을 우선 사용한다.
 * 건물 외곽선 조회 실패는 비치명적으로 처리하고 건폐율 기반 개략 매스로 fallback한다.
 */

import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/integrations/kakao";
import { lookupCadastral, lookupZoningByPNU } from "@/lib/integrations/vworld";
import {
  lookupBuildingByJibun,
  estimateUnitAreaSqm,
  type BuildingLookupResult,
} from "@/lib/integrations/molit-building";
import {
  attachExistingBuildingGeometry,
  fetchExistingBuildingGeometry,
} from "@/lib/integrations/vworld-buildings";
import type { ExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";

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

    // 3~5. PNU가 확보된 뒤 독립 조회를 병렬 실행
    const zoningPromise = lookupZoningByPNU(cadastral.pnu);
    const buildingPromise = lookupBuildingByJibun(
      geo.bCode,
      geo.mainAddressNo,
      geo.subAddressNo,
      geo.mountainYn || "N"
    );
    const geometryPromise = fetchExistingBuildingGeometry({
      pnu: cadastral.pnu,
      boundary: cadastral.boundary,
      center: cadastral.centroid,
    });

    const [zoningResult, buildingResult, geometryResult] = await Promise.allSettled([
      zoningPromise,
      buildingPromise,
      geometryPromise,
    ]);

    if (zoningResult.status === "rejected") {
      console.error("V월드 용도지역 조회 실패:", zoningResult.reason);
      return NextResponse.json(
        { error: "용도지역 정보 조회 실패" },
        { status: 502 }
      );
    }
    const zoning = zoningResult.value;

    let currentBuilding: BuildingLookupResult | null = null;
    if (buildingResult.status === "fulfilled") {
      currentBuilding = buildingResult.value;
    } else {
      console.warn("MOLIT 건축물대장 조회 실패 (비치명적):", buildingResult.reason);
    }

    let buildingGeometry: ExistingBuildingGeometry;
    if (geometryResult.status === "fulfilled") {
      buildingGeometry = geometryResult.value;
    } else {
      console.warn("V월드 GIS건물통합정보 조회 실패 (비치명적):", geometryResult.reason);
      buildingGeometry = {
        source: "vworld-dt_d010",
        status: "error",
        footprints: [],
        queryFeatureCount: 0,
      };
    }

    // MOLIT 속성을 우선 유지하고 V월드 실제 외곽선을 결합한다.
    // MOLIT 실패 시에도 dt_d010 속성으로 최소 건물 정보를 구성한다.
    currentBuilding = attachExistingBuildingGeometry(
      currentBuilding,
      buildingGeometry,
      cadastral.lotAreaSqm
    );

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

      // MOLIT 속성 + V월드 dt_d010 실제 외곽선
      currentBuilding,
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
