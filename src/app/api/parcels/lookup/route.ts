/**
 * POST /api/parcels/lookup
 *
 * 주소를 받아 외부 데이터를 통합 반환:
 *   1. Kakao                    → 좌표 + 행정코드 + 정확 지번
 *   2. V월드 연속지적도          → PNU + 면적 + 지목 + 공시지가 + 필지 경계
 *   3. V월드 주변 연속지적도      → 인접 필지 + 지목이 도로인 필지 경계
 *   4. V월드 용도지역            → 용도지역 + 건폐율 + 용적률 + 높이제한
 *   5. MOLIT 건축물대장          → 현재 건물 속성 + 재건축 시그널
 *   6. V월드 GIS건물통합정보     → 실제 건물 외곽선·위치·방향 (dt_d010)
 *
 * 작은 부지에서 V월드 PNU 부정확 문제 때문에 건축물대장 lookup은
 * 카카오 지번 기반(lookupBuildingByJibun)을 우선 사용한다.
 * 건물 외곽선·주변 지적 조회 실패는 비치명적으로 처리한다.
 */

import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/integrations/kakao";
import { lookupCadastral, lookupZoningByPNU } from "@/lib/integrations/vworld";
import {
  lookupBuildingByJibun,
  estimateUnitAreaSqm,
  type BuildingLookupResult,
} from "@/lib/integrations/molit-building";
import { attachExistingBuildingGeometry } from "@/lib/integrations/vworld-buildings";
import { fetchExistingBuildingGeometry } from "@/lib/integrations/vworld-buildings-client";
import { fetchCadastralContextParcels } from "@/lib/integrations/vworld-cadastral-context";
import type { ExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";
import type { CadastralParcelFeature } from "@/lib/geo/cadastral-context";
import { normalizeRoadLines } from "@/lib/geo/normalize-road-lines";

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
    const geo = await geocodeAddress(address);
    if (!geo) {
      return NextResponse.json(
        { error: `주소를 찾을 수 없습니다: ${address}` },
        { status: 404 }
      );
    }

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

    const normalizedRoads = normalizeRoadLines(cadastral.roads);

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
    const cadastralContextPromise = fetchCadastralContextParcels({
      center: cadastral.centroid,
      targetPnu: cadastral.pnu,
      radiusM: 80,
      maxCount: 80,
    });

    const [zoningResult, buildingResult, geometryResult, cadastralContextResult] =
      await Promise.allSettled([
        zoningPromise,
        buildingPromise,
        geometryPromise,
        cadastralContextPromise,
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

    let cadastralParcels: CadastralParcelFeature[] = [];
    if (cadastralContextResult.status === "fulfilled") {
      cadastralParcels = cadastralContextResult.value;
    } else {
      console.warn("V월드 주변 연속지적도 조회 실패 (비치명적):", cadastralContextResult.reason);
    }

    currentBuilding = attachExistingBuildingGeometry(
      currentBuilding,
      buildingGeometry,
      cadastral.lotAreaSqm
    );

    return NextResponse.json({
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

      pnu: cadastral.pnu,
      lotArea: cadastral.lotAreaSqm,
      boundary: cadastral.boundary,
      roads: normalizedRoads,
      cadastralParcels,
      jimok: cadastral.jimok,
      jimokCode: cadastral.jimokCode,
      jimokCategory: cadastral.jimokCategory,
      landPrice: cadastral.landPriceWonPerSqm,
      landPriceYear: cadastral.landPriceYear,

      zoning: zoning.zoning,
      zoneCode: zoning.zoneCode,
      maxFAR: zoning.maxFAR,
      maxBCR: zoning.maxBCR,
      heightLimit: zoning.heightLimitM,
      overlays: zoning.overlays,

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
