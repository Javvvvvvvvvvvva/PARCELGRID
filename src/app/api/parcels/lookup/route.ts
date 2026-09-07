/**
 * POST /api/parcels/lookup
 *
 * 주소를 받아 외부 데이터를 통합 반환:
 *   1. Kakao                    → 좌표 + 행정코드 + 정확 지번
 *   2. V월드 연속지적도          → PNU + 면적 + 지목 + 공시지가 + 필지 경계
 *   3. V월드 주변 연속지적도      → 인접 필지 + 지목이 도로인 필지 경계
 *   4. V월드 용도지역            → 용도지역·지구 조회 사실 + 전국 법령 상한 참고
 *   5. MOLIT 건축물대장          → 현재 건물 속성 + 재건축 시그널
 *   6. V월드 GIS건물통합정보     → 실제 건물 외곽선·위치·방향 (dt_d010)
 *
 * 작은 부지에서 V월드 PNU 부정확 문제 때문에 건축물대장 lookup은
 * 카카오 지번 기반(lookupBuildingByJibun)을 우선 사용한다.
 * 건물 외곽선·주변 지적 조회 실패는 비치명적으로 처리한다.
 * VWorld가 비활성·미설정·접속 불가이면 Kakao/MOLIT 결과를 보존한
 * manual-required 응답으로 전환하며 토지·규제 수치를 임의 생성하지 않는다.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  geocodeAddress,
  type GeocodeResult,
} from "@/lib/integrations/kakao";
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
import { manualParcelId } from "@/lib/parcels/parcel-id";
import type {
  ManualLookupReasonCode,
  ParcelLookupBase,
} from "@/lib/parcels/lookup-contract";
import { vworldRuntimeState } from "@/lib/runtime/integration-mode";

export const runtime = "nodejs";

async function lookupCurrentBuilding(
  geo: GeocodeResult,
): Promise<BuildingLookupResult | null> {
  try {
    return await lookupBuildingByJibun(
      geo.bCode,
      geo.mainAddressNo,
      geo.subAddressNo,
      geo.mountainYn || "N",
    );
  } catch (error) {
    console.warn("MOLIT 건축물대장 조회 실패 (비치명적):", error);
    return null;
  }
}

function baseLookupResult(
  geo: GeocodeResult,
  currentBuilding: BuildingLookupResult | null,
): ParcelLookupBase {
  return {
    address: geo.address,
    addressRoad: geo.roadAddress,
    lat: geo.lat,
    lng: geo.lng,
    bCode: geo.bCode,
    lawdCd: geo.lawdCd,
    sido: geo.sido,
    sigungu: geo.sigungu,
    dong: geo.dong,
    jibun: geo.jibun,
    mainAddressNo: geo.mainAddressNo,
    subAddressNo: geo.subAddressNo,
    mountainYn: geo.mountainYn,
    pnu: manualParcelId({
      bCode: geo.bCode,
      mainAddressNo: geo.mainAddressNo,
      subAddressNo: geo.subAddressNo,
      mountainYn: geo.mountainYn,
      lat: geo.lat,
      lng: geo.lng,
    }),
    currentBuilding,
    existingUnitArea: estimateUnitAreaSqm(currentBuilding),
  };
}

async function manualLookupResponse(
  geo: GeocodeResult,
  currentBuildingPromise: Promise<BuildingLookupResult | null>,
  code: ManualLookupReasonCode,
  message: string,
) {
  const currentBuilding = await currentBuildingPromise;
  return NextResponse.json({
    ...baseLookupResult(geo, currentBuilding),
    mode: "manual-required" as const,
    reason: { code, message },
  });
}

export async function POST(req: NextRequest) {
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        code: "INVALID_JSON",
        error: "주소 요청 형식을 읽을 수 없습니다.",
        nextAction: "페이지를 새로고침한 뒤 다시 조회하세요.",
        retryable: true,
      },
      { status: 400 },
    );
  }

  const address = body.address?.trim();
  if (!address) {
    return NextResponse.json(
      {
        code: "ADDRESS_REQUIRED",
        error: "조회할 주소가 필요합니다.",
        nextAction: "지번 또는 도로명 주소를 입력하세요.",
        retryable: false,
      },
      { status: 400 },
    );
  }

  try {
    const geo = await geocodeAddress(address);
    if (!geo) {
      return NextResponse.json(
        {
          code: "ADDRESS_NOT_FOUND",
          error: `주소를 찾을 수 없습니다: ${address}`,
          nextAction: "지번 주소를 포함해 다시 입력하고 Kakao REST 키 상태를 확인하세요.",
          retryable: true,
        },
        { status: 404 }
      );
    }

    const currentBuildingPromise = lookupCurrentBuilding(geo);
    const vworld = vworldRuntimeState();
    if (vworld.mode === "disabled") {
      return manualLookupResponse(
        geo,
        currentBuildingPromise,
        "VWORLD_DISABLED",
        "VWorld 연동이 현재 꺼져 있습니다. 확보한 주소·건축물대장에 수동 토지 정보를 더해 분석을 계속할 수 있습니다.",
      );
    }
    if (vworld.mode === "unconfigured") {
      return manualLookupResponse(
        geo,
        currentBuildingPromise,
        "VWORLD_NOT_CONFIGURED",
        "VWorld 키가 설정되지 않았습니다. 확보한 주소·건축물대장에 수동 토지 정보를 더해 분석을 계속할 수 있습니다.",
      );
    }

    let cadastral: Awaited<ReturnType<typeof lookupCadastral>>;
    try {
      cadastral = await lookupCadastral(geo.lat, geo.lng, {
        mainAddressNo: geo.mainAddressNo,
        subAddressNo: geo.subAddressNo,
        mountainYn: geo.mountainYn,
      });
    } catch (error) {
      console.warn("VWorld 지적 조회 실패, 수동 등록으로 전환:", error);
      return manualLookupResponse(
        geo,
        currentBuildingPromise,
        "VWORLD_UNREACHABLE",
        "VWorld에 연결하지 못했습니다. VPN·네트워크와 무관하게 수동 토지 정보로 분석을 계속할 수 있습니다.",
      );
    }
    if (!cadastral) {
      return manualLookupResponse(
        geo,
        currentBuildingPromise,
        "CADASTRAL_NOT_FOUND",
        "주소 좌표에서 일치하는 VWorld 지적 필지를 찾지 못했습니다. 수동 토지 정보로 분석을 계속할 수 있습니다.",
      );
    }

    const normalizedRoads = normalizeRoadLines(cadastral.roads);

    const zoningPromise = lookupZoningByPNU(cadastral.pnu);
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

    const [zoningResult, currentBuilding, geometryResult, cadastralContextResult] =
      await Promise.allSettled([
        zoningPromise,
        currentBuildingPromise,
        geometryPromise,
        cadastralContextPromise,
      ]);

    if (zoningResult.status === "rejected") {
      console.warn("VWorld 용도지역 조회 실패, 수동 등록으로 전환:", zoningResult.reason);
      return manualLookupResponse(
        geo,
        currentBuildingPromise,
        "VWORLD_UNREACHABLE",
        "VWorld 용도지역 조회를 완료하지 못했습니다. 규제 수치를 추정하지 않고 수동 입력으로 전환했습니다.",
      );
    }
    const zoning = zoningResult.value;

    const currentBuildingResult =
      currentBuilding.status === "fulfilled" ? currentBuilding.value : null;

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

    const currentBuildingWithGeometry = attachExistingBuildingGeometry(
      currentBuildingResult,
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
      // maxFAR/maxBCR are national ceiling references retained for legacy
      // candidate generation. regulatoryConstraints carries their provenance.
      maxFAR: zoning.maxFAR,
      maxBCR: zoning.maxBCR,
      heightLimit: zoning.heightLimitM,
      regulatoryConstraints: zoning.regulatoryConstraints,
      overlays: zoning.overlays,

      mode: "vworld",
      inputProvenance: {
        mode: "vworld",
        parcelFacts: "vworld-cadastral",
        geometry: "vworld-cadastral",
        zoning: "vworld-land-use",
        recordedAt: new Date().toISOString(),
      },
      currentBuilding: currentBuildingWithGeometry,
      existingUnitArea: estimateUnitAreaSqm(currentBuildingWithGeometry),
    });
  } catch (err) {
    console.error("lookup 실패:", err);
    return NextResponse.json(
      {
        code: "PARCEL_LOOKUP_FAILED",
        error: "부지 조회 중 외부 데이터 연결 오류가 발생했습니다.",
        nextAction: "환경 점검 화면에서 API 연결을 확인한 뒤 다시 조회하세요.",
        retryable: true,
      },
      { status: 500 }
    );
  }
}
