/** 건축HUB 관측값. 조회 0건은 실제 빈 토지나 신축 허가를 뜻하지 않는다. */
import {
  BUILDING_REGISTRY_SOURCE, BUILDING_REGISTRY_VERSION, registryNumber,
  type BuildingRegistryEvidence, type RegistryQuery, type RegistryRecord,
} from "@/lib/building-registry/types";
import { emptyRegistryDataset, fetchRegistryDataset } from "./molit-building-client";

export type RedevelopmentSignal = "vacant" | "rebuild" | "renovate" | "keep" | "unknown";

export interface BuildingInfo {
  /** Provider PK verbatim; absent in legacy/GIS-only observations. */
  registryId?: string;
  dongName?: string;
  source?: "building-registry" | "vworld-gis";
  missingFields?: string[];
  parkingCount?: number | null;
  passengerElevators?: number | null;
  emergencyElevators?: number | null;
  roof?: string;
  /** 동 이름. 없으면 빈 문자열 (단독주택 등) */
  name: string;
  /** 주용도 (단독주택, 업무시설, 공동주택 등) */
  mainPurpose: string;
  /** 세부 용도 (다가구주택, 오피스텔 등) */
  detailPurpose: string;
  /** 지상 층수 */
  groundFloors: number;
  /** 지하 층수 */
  undergroundFloors: number;
  /** 연면적 (m²) */
  totalArea: number;
  /** 건축면적 (m²) */
  buildingArea: number;
  /** 건폐율 (%) */
  buildingCoverage: number;
  /** 용적률 (%) */
  floorAreaRatio: number;
  /** 구조 (철근콘크리트, 조적조 등) */
  structure: string;
  /** 높이 (m). 없으면 0 */
  height: number;
  /** 사용승인일 (YYYY-MM-DD 형식) */
  approvalDate: string;
  /** 노후 연수 (사용승인일 기준) */
  ageYears: number;
  /** 주건축물 여부 (부속건물 아닌 본 건물) */
  isMainBuilding: boolean;
  /** 세대수 (다세대·공동주택 구분소유). 없으면 0 */
  householdCount: number;
  /** 가구수 (다가구 단독소유 임대). 없으면 0 */
  familyCount: number;
  /** 호수 (근생·오피스텔 등). 없으면 0 */
  unitCount: number;
}

export type PnuParts = RegistryQuery;

export interface BuildingLookupResult {
  /** Optional for older saved parcels. Without provenance, false is unverified. */
  registry?: BuildingRegistryEvidence;
  source?: "building-registry" | "vworld-gis";
  buildings: BuildingInfo[];
  /** 수신한 건물 속성이 있는가. false만으로 실제 나대지를 판정하지 않는다. */
  hasBuilding: boolean;
  /** 모든 동 연면적 합계 (m²) */
  totalBuildingArea: number;
  /** 가장 오래된 사용승인일 */
  oldestApprovalDate: string;
  /** 가장 오래된 건물의 노후 연수 */
  maxAgeYears: number;
  /** 평균 노후 연수 */
  averageAgeYears: number;
  /** 의사결정 시그널 */
  redevelopmentSignal: RedevelopmentSignal;
  /** 사람이 읽을 수 있는 시그널 라벨 */
  signalLabel: string;
  /** 시그널 설명 */
  signalReasoning: string;
}

/**
 * 기존 건물의 용도별 세대당 면적 산정 (하드코딩 50㎡ 대체용).
 * 다가구 → 가구수, 다세대·공동주택 → 세대수, 근생·오피스텔 → 호수.
 * 계산 불가(건물 없음·세대수 0)면 null → 호출부에서 기본값 사용.
 */
export function estimateUnitAreaSqm(
  result: BuildingLookupResult | null
): { unitAreaSqm: number; basis: string; count: number; sourceBuilding: string } | null {
  if (!result || !result.hasBuilding || result.buildings.length === 0 || (result.registry && result.registry.title.status !== "complete")) {
    return null;
  }

  // 주건축물 우선, 없으면 연면적 가장 큰 동
  const main =
    result.buildings.find((b) => b.isMainBuilding) ??
    result.buildings.reduce((a, b) => (b.totalArea > a.totalArea ? b : a));

  const purpose = `${main.detailPurpose} ${main.mainPurpose}`;

  let count = 0;
  let basis = "";
  if (purpose.includes("다가구")) {
    count = main.familyCount;
    basis = "가구수";
  } else if (
    purpose.includes("다세대") ||
    purpose.includes("공동주택") ||
    purpose.includes("아파트") ||
    purpose.includes("연립")
  ) {
    count = main.householdCount;
    basis = "세대수";
  } else if (purpose.includes("오피스텔") || purpose.includes("근린생활")) {
    count = main.unitCount;
    basis = "호수";
  } else {
    // 기타 — 세대수 > 가구수 > 호수 순으로 존재하는 값
    if (main.householdCount > 0) {
      count = main.householdCount;
      basis = "세대수";
    } else if (main.familyCount > 0) {
      count = main.familyCount;
      basis = "가구수";
    } else {
      count = main.unitCount;
      basis = "호수";
    }
  }

  if (count <= 0 || main.totalArea <= 0) return null;

  return {
    unitAreaSqm: Math.round((main.totalArea / count) * 10) / 10,
    basis: `연면적 ÷ ${basis} (전유면적 아님)`,
    count,
    sourceBuilding: main.name || main.detailPurpose || "기존 건물",
  };
}

/**
 * 기존 건물의 층고 참고값 (하드코딩 3.0m 대체용).
 * 주건축물 높이(heit) ÷ 지상층수. 합리 범위(2.4~4.5m) 밖이면 null (옥탑 등 이상값 방지).
 */
export function estimateFloorHeightM(
  result: BuildingLookupResult | null
): number | null {
  if (!result || !result.hasBuilding || result.buildings.length === 0 || (result.registry && result.registry.title.status !== "complete")) {
    return null;
  }
  const main =
    result.buildings.find((b) => b.isMainBuilding) ??
    result.buildings.reduce((a, b) => (b.totalArea > a.totalArea ? b : a));
  if (main.height <= 0 || main.groundFloors <= 0) return null;
  const fh = main.height / main.groundFloors;
  if (fh < 2.4 || fh > 4.5) return null;
  return Math.round(fh * 10) / 10;
}

/* ─────────────────────────── PNU helpers ─────────────────────────── */

/**
 * Decompose 19-digit PNU into building-registry query parts.
 *
 * PNU structure: [시군구5][법정동5][특수1][본번4][부번4]
 *   특수 1자리: 1 = 일반, 2 = 산
 *
 * MOLIT API uses platGbCd: 0 = 일반, 1 = 산.
 */
export function pnuToBuildingQuery(pnu: string): PnuParts | null {
  if (!/^\d{19}$/.test(pnu)) return null;
  const special = pnu.slice(10, 11);
  if (special !== "1" && special !== "2") return null;
  return {
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    platGbCd: special === "2" ? "1" : "0",
    bun: pnu.slice(11, 15),
    ji: pnu.slice(15, 19),
  };
}

/**
 * Build query directly from Kakao's exact 지번 data — bypasses V-World
 * coordinate-based matching which can return adjacent parcels for small lots.
 *
 *   bCode (10): [시군구5][법정동5]
 *   mainAddressNo: 본번 (e.g. "281")
 *   subAddressNo:  부번 (e.g. "23"). Empty if none.
 *   mountainYn:    "Y"=산, "N"=일반
 */
export function geocodeToBuildingQuery(
  bCode: string,
  mainAddressNo: string,
  subAddressNo: string,
  mountainYn: string
): PnuParts | null {
  if (!/^\d{10}$/.test(bCode)) return null;
  if (!/^\d{1,4}$/.test(mainAddressNo) || !/^\d{0,4}$/.test(subAddressNo)) return null;
  if (mountainYn !== "Y" && mountainYn !== "N") return null;
  return {
    sigunguCd: bCode.slice(0, 5),
    bjdongCd: bCode.slice(5, 10),
    platGbCd: mountainYn === "Y" ? "1" : "0",
    bun: mainAddressNo.padStart(4, "0"),
    ji: (subAddressNo || "0").padStart(4, "0"),
  };
}

function parseDate(yyyymmdd: string): string {
  const s = yyyymmdd.trim();
  if (!/^\d{8}$/.test(s)) return "";
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso && date.getTime() <= Date.now() ? iso : "";
}

function yearsSince(dateStr: string): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25)));
}

/* ─────────────────────────── Signal computation ─────────────────────────── */

function computeSignal(
  buildings: BuildingInfo[]
): Pick<BuildingLookupResult, "redevelopmentSignal" | "signalLabel" | "signalReasoning"> {
  if (buildings.length === 0) {
    return {
      redevelopmentSignal: "vacant",
      signalLabel: "조회 범위 내 표제부 0건",
      signalReasoning: "요청 지번의 표제부 조회 결과가 0건입니다. 부속지번·미등재·멸실·현장 상태는 별도 확인해야 합니다.",
    };
  }

  if (buildings.some((building) => !building.approvalDate)) {
    return { redevelopmentSignal: "unknown", signalLabel: "노후도 미확인",
      signalReasoning: "일부 사용승인일이 없어 전체 건물의 노후도를 판단하지 않습니다." };
  }
  // 가장 오래된 확인 가능한 사용승인일 기준의 참고
  const oldestAge = Math.max(...buildings.map((b) => b.ageYears));

  if (oldestAge >= 30) {
    return {
      redevelopmentSignal: "rebuild",
      signalLabel: "재건축 검토",
      signalReasoning: `가장 오래된 건물 ${oldestAge}년 노후 — 유지·보수·철거 후 신축 비교 필요.`,
    };
  }

  if (oldestAge >= 15) {
    return {
      redevelopmentSignal: "renovate",
      signalLabel: "리모델링 검토",
      signalReasoning: `${oldestAge}년 노후 — 구조·설비·운영 현황 확인 후 대안 비교 필요.`,
    };
  }

  return {
    redevelopmentSignal: "keep",
    signalLabel: "기존 건물 유지 검토",
    signalReasoning: `${oldestAge}년 노후 — 노후도만으로 철거나 개발 적합성을 판단하지 않습니다.`,
  };
}

/** Shared deadline bounds pagination and optional detail requests together. */
async function lookupBuildingByParts(parts: PnuParts, includeDetails: boolean): Promise<BuildingLookupResult> {
  const signal = AbortSignal.timeout(25_000);
  const title = await fetchRegistryDataset("getBrTitleInfo", parts, signal);
  const [floors, exclusiveCommon] = includeDetails && title.rows.length
    ? await Promise.all([
        fetchRegistryDataset("getBrFlrOulnInfo", parts, signal),
        fetchRegistryDataset("getBrExposPubuseAreaInfo", parts, signal),
      ])
    : [emptyRegistryDataset("getBrFlrOulnInfo", parts), emptyRegistryDataset("getBrExposPubuseAreaInfo", parts)];
  const registry: BuildingRegistryEvidence = { version: BUILDING_REGISTRY_VERSION,
    sourceUrl: BUILDING_REGISTRY_SOURCE, query: parts, title, floors, exclusiveCommon };
  const buildings = title.rows.map(parseBuilding).sort((a, b) =>
    Number(b.isMainBuilding) - Number(a.isMainBuilding) || b.totalArea - a.totalArea);
  const approvalDates = buildings.map((b) => b.approvalDate).filter(Boolean).sort();
  const ages = buildings.filter((b) => b.approvalDate).map((b) => b.ageYears);
  const unknown = title.status !== "complete";
  const sig = unknown ? { redevelopmentSignal: "unknown" as const,
    signalLabel: buildings.length ? "일부 대장 확보 · 추가 확인" : "대장 조회 미확인",
    signalReasoning: "조회가 완결되지 않아 건물 부재나 전체 노후도를 확정하지 않습니다." } : computeSignal(buildings);
  return {
    registry, source: "building-registry", buildings, hasBuilding: buildings.length > 0,
    totalBuildingArea: buildings.reduce((sum, b) => sum + b.totalArea, 0),
    oldestApprovalDate: approvalDates[0] || "", maxAgeYears: ages.length ? Math.max(...ages) : 0,
    averageAgeYears: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0,
    ...sig,
  };
}

function parseBuilding(record: RegistryRecord): BuildingInfo {
  const str = (tag: string) => record.fields[tag] || "";
  const nullable = (tag: string) => registryNumber(record.fields[tag]);
  const num = (tag: string) => nullable(tag) ?? 0;
  const approvalDate = parseDate(str("useAprDay"));
  const parking = ["indrMechUtcnt", "oudrMechUtcnt", "indrAutoUtcnt", "oudrAutoUtcnt"].map(nullable);
  return {
    registryId: record.registryPk || undefined, dongName: str("dongNm"), source: "building-registry",
    missingFields: ["totArea", "archArea", "grndFlrCnt", "ugrndFlrCnt", "heit", "bcRat", "vlRat"].filter((key) => nullable(key) == null),
    parkingCount: parking.every((value) => value != null) ? parking.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
    passengerElevators: nullable("rideUseElvtCnt"), emergencyElevators: nullable("emgenUseElvtCnt"),
    roof: str("roofCdNm") || str("etcRoof"),
    name: str("bldNm"), mainPurpose: str("mainPurpsCdNm"), detailPurpose: str("etcPurps"),
    groundFloors: num("grndFlrCnt"), undergroundFloors: num("ugrndFlrCnt"),
    totalArea: num("totArea"), buildingArea: num("archArea"), buildingCoverage: num("bcRat"), floorAreaRatio: num("vlRat"),
    structure: str("strctCdNm"), height: num("heit"), approvalDate, ageYears: yearsSince(approvalDate),
    isMainBuilding: str("mainAtchGbCd") === "0", householdCount: num("hhldCnt"), familyCount: num("fmlyCnt"), unitCount: num("hoCnt"),
  };
}

/**
 * Public: lookup by 19-digit PNU (V-World cadastral response).
 * May match adjacent parcel for very small lots — prefer lookupBuildingByJibun.
 */
export async function lookupBuildingByPnu(
  pnu: string
): Promise<BuildingLookupResult | null> {
  const parts = pnuToBuildingQuery(pnu);
  if (!parts) return null;
  return lookupBuildingByParts(parts, false);
}

/**
 * Public: lookup by Kakao's exact 지번 data — preferred for accuracy.
 */
export async function lookupBuildingByJibun(
  bCode: string,
  mainAddressNo: string,
  subAddressNo: string,
  mountainYn: string
): Promise<BuildingLookupResult | null> {
  const parts = geocodeToBuildingQuery(bCode, mainAddressNo, subAddressNo, mountainYn);
  if (!parts) return null;
  return lookupBuildingByParts(parts, true);
}
