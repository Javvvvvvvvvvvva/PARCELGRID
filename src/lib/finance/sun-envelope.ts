/**
 * 정북 일조 사선제한 — 건축 가능 높이/층수 보정 (V1).
 *
 * 건축법 제61조 + 시행령 제86조: 전용·일반주거지역에서
 * 정북방향 인접대지경계선으로부터:
 *  - 높이 10m 이하: 1.5m 이상 이격
 *  - 높이 10m 초과: 해당 높이의 1/2 이상 이격
 *
 * V1 범위 (C 확정):
 *  - 우리 필지의 북측 경계선을 자동 추출해 기준선으로 사용.
 *  - 대부분의 일반 필지에서 충분히 현실적.
 *  - ⚠️ 일반화 금지: 북측이 도로이거나, 특수 대지형상(L자 등),
 *    지자체 조례 적용 시 별도 계산 필요 → 경고 플래그로 표시.
 *
 * V2: 북측 도로 판별 / V3: 다중 북측경계 / V4: 지자체 조례 (로드맵).
 */

export type LngLat = [number, number];

export interface NorthEdgeResult {
  /** 북측 경계 변의 두 끝점 */
  edge: { a: LngLat; b: LngLat };
  /** 북측 변 중점 위도 */
  midLat: number;
  /** 북측 변 길이 (m) */
  lengthM: number;
}

/** 위경도 두 점 간 거리 (m) — 위도 보정 근사 */
function distanceM(p1: LngLat, p2: LngLat): number {
  const dLat = (p2[1] - p1[1]) * 111_000;
  const dLng = (p2[0] - p1[0]) * 111_000 * Math.cos((p1[1] * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * 부지 경계에서 북측 변 자동 추출 (위도가 가장 큰 변).
 * @param boundary 부지 경계 폴리곤 [[lng,lat], ...]
 */
export function findNorthEdge(boundary: LngLat[]): NorthEdgeResult | null {
  if (!boundary || boundary.length < 3) return null;
  let idx = 0;
  let maxLat = -Infinity;
  for (let i = 0; i < boundary.length; i++) {
    const j = (i + 1) % boundary.length;
    const mid = (boundary[i][1] + boundary[j][1]) / 2;
    if (mid > maxLat) {
      maxLat = mid;
      idx = i;
    }
  }
  const a = boundary[idx];
  const b = boundary[(idx + 1) % boundary.length];
  return { edge: { a, b }, midLat: maxLat, lengthM: distanceM(a, b) };
}

/** 정북일조: 건물 높이 → 필요 북측 이격 (m) */
export function requiredNorthSetback(buildingHeightM: number): number {
  if (buildingHeightM <= 10) return 1.5;
  return buildingHeightM / 2;
}

/** 정북일조: 북측 이격 거리 → 가능 최대 높이 (m) */
export function maxHeightAtSetback(setbackM: number): number {
  if (setbackM < 1.5) return 0;
  if (setbackM <= 5) return 10; // 1.5~5m → 10m까지
  return setbackM * 2; // 5m 초과 → 높이 = 2×이격 (높이÷2 역산)
}

export interface SunFloorResult {
  /** 층별 필요 북측 이격 (층고 기준) */
  floorSetbacks: { floors: number; heightM: number; requiredSetbackM: number }[];
  /** 북측 변 정보 */
  northEdge: NorthEdgeResult | null;
  /** 일반화 주의: 북측이 도로/특수형상이면 별도 계산 필요 */
  caveat: string;
}

/**
 * 부지 경계 + 층고로 정북일조 층수별 필요 이격 계산 (V1).
 * @param boundary 부지 경계
 * @param floorHeightM 층고 (기본 3m)
 * @param maxFloors 검토할 최대 층수
 */
export function calcSunFloors(
  boundary: LngLat[],
  floorHeightM = 3,
  maxFloors = 5
): SunFloorResult {
  const northEdge = findNorthEdge(boundary);
  const floorSetbacks: SunFloorResult["floorSetbacks"] = [];
  for (let f = 2; f <= maxFloors; f++) {
    const heightM = f * floorHeightM + 1; // 옥탑/파라펫 +1m
    floorSetbacks.push({
      floors: f,
      heightM,
      requiredSetbackM: requiredNorthSetback(heightM),
    });
  }
  return {
    floorSetbacks,
    northEdge,
    caveat:
      "북측 경계선 기준 (V1). 북측이 도로이거나 특수 대지형상·지자체 조례 적용 시 별도 계산 필요.",
  };
}

/** 부지 남북 깊이 (m) — 최북단·최남단 위도차 */
export function northSouthDepthM(boundary: LngLat[]): number {
  if (!boundary || boundary.length < 3) return 0;
  const lats = boundary.map((p) => p[1]);
  return (Math.max(...lats) - Math.min(...lats)) * 111_000;
}

/** 부지 동서 폭 (m) */
export function eastWestWidthM(boundary: LngLat[]): number {
  if (!boundary || boundary.length < 3) return 0;
  const lngs = boundary.map((p) => p[0]);
  const midLat = boundary[0][1];
  return (
    (Math.max(...lngs) - Math.min(...lngs)) *
    111_000 *
    Math.cos((midLat * Math.PI) / 180)
  );
}

export type FloorVerdict = "ok" | "marginal" | "infeasible";

export interface FloorCheck {
  floors: number;
  heightM: number;
  requiredSetbackM: number;
  availableSetbackM: number;
  gfaSqm: number;
  maxGfaSqm: number;
  verdict: FloorVerdict;
  reason: string;
}

/**
 * 층수별 가능 여부 — 정북일조(남북깊이 기준) + 용적률 동시 검토.
 * 0.4 같은 임의 비율 없이 boundary 기하 + 건폐율로 계산.
 *
 * @param boundary 부지 경계
 * @param maxBuildingAreaSqm 최대 건축면적 (대지×건폐율)
 * @param maxFarFloorAreaSqm 최대 용적률 연면적
 * @param floorHeightM 층고 (기본 3m)
 * @param maxFloors 검토 최대 층수
 */
export function checkFloorsByLaw(
  boundary: LngLat[],
  maxBuildingAreaSqm: number,
  maxFarFloorAreaSqm: number,
  floorHeightM = 3,
  maxFloors = 5
): FloorCheck[] {
  const depth = northSouthDepthM(boundary);
  const width = eastWestWidthM(boundary);
  // 최소 건물 깊이 = 건축면적 / 폭 (건물이 폭을 다 쓸 때)
  const minBuildingDepth = width > 0 ? maxBuildingAreaSqm / width : 0;
  // 북측 가능 이격 = 남북 깊이 - 건물 깊이
  const availableSetbackM = Math.max(0, depth - minBuildingDepth);

  const checks: FloorCheck[] = [];
  for (let f = 2; f <= maxFloors; f++) {
    const heightM = f * floorHeightM + 1;
    const requiredSetbackM = requiredNorthSetback(heightM);
    const gfaSqm = maxBuildingAreaSqm * f;
    const sunOK = requiredSetbackM <= availableSetbackM;
    const farOK = gfaSqm <= maxFarFloorAreaSqm;

    let verdict: FloorVerdict;
    if (sunOK && farOK) verdict = "ok";
    else if (!sunOK && requiredSetbackM <= availableSetbackM + 1.5 && farOK)
      verdict = "marginal";
    else verdict = "infeasible";

    let reason = "";
    if (!sunOK)
      reason += `정북일조 ${requiredSetbackM.toFixed(1)}m 필요 (가능 ${availableSetbackM.toFixed(1)}m) `;
    if (!farOK) reason += "용적률 초과 ";

    checks.push({
      floors: f,
      heightM,
      requiredSetbackM,
      availableSetbackM,
      gfaSqm,
      maxGfaSqm: maxFarFloorAreaSqm,
      verdict,
      reason: reason.trim(),
    });
  }
  return checks;
}

/** 정북일조 개략 검토 주의 문구 (C 확정 — 반드시 표시) */
export const SUN_CHECK_CAVEAT =
  "정북일조 판정은 부지 남북 깊이와 층수별 필요 이격을 기준으로 한 개략 검토이며, 실제 가능 여부는 건물 배치·평면 깊이·지자체 조례 검토에 따라 달라질 수 있습니다.";

// ═══════════════════════════════════════════════════════════════════
// 정북일조 종합 판정 (V2) — 용도지역·도로·배제조건 포괄
// 건축법 §61 + 시행령 §86 (2023.9.12 개정: 9m→10m)
// ═══════════════════════════════════════════════════════════════════

/** 정북일조가 적용되는 용도지역인지 (일반 건축물 §61①) */
export function sunRestrictionApplies(zoning: string): boolean {
  // 전용주거지역·일반주거지역만 (제1·2·3종 포함). 준주거는 일반건축물 미적용.
  if (zoning.includes("준주거")) return false;
  return zoning.includes("주거지역");
}

/** 북측 변이 도로에 접하는지 (roads 위치 기반) */
export function isNorthEdgeAbuttingRoad(
  northEdge: NorthEdgeResult,
  roads: { name: string | null; points: LngLat[] }[] | undefined
): { isRoad: boolean; roadName: string | null } {
  if (!roads || roads.length === 0) return { isRoad: false, roadName: null };
  const { a, b } = northEdge.edge;
  const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (const road of roads) {
    for (const pt of road.points) {
      if (distanceM(mid, pt) < 20) {
        return { isRoad: true, roadName: road.name };
      }
    }
  }
  return { isRoad: false, roadName: null };
}

export interface SunEvaluation {
  /** 정북일조가 적용되는가 */
  applies: boolean;
  /** 2층↓·8m↓ 조례 배제 가능 */
  exemptByOrdinance: boolean;
  /** 필요 북측 이격 (m) — 적용 시 */
  requiredSetbackM: number;
  /** 북측이 도로에 접하는가 */
  northIsRoad: boolean;
  /** 사람이 읽는 결론 */
  conclusion: string;
  /** 데이터 부족·확인 필요 경고 (가정 금지 — 정직 표시) */
  warnings: string[];
}

/**
 * 정북일조 종합 판정 — 모든 조건 포괄.
 * 데이터 있는 조건은 정확히, 없는 조건은 경고 (가정 금지).
 *
 * @param zoning 용도지역명
 * @param heightM 건물 높이 (m)
 * @param floors 지상 층수
 * @param northEdge 북측 변 (findNorthEdge 결과)
 * @param roads 도로 데이터 (너비 없음 — 위치만)
 */
export function evaluateSunSetback(
  zoning: string,
  heightM: number,
  floors: number,
  northEdge: NorthEdgeResult | null,
  roads?: { name: string | null; points: LngLat[] }[]
): SunEvaluation {
  const warnings: string[] = [];

  // 1) 용도지역 판정
  if (!sunRestrictionApplies(zoning)) {
    return {
      applies: false,
      exemptByOrdinance: false,
      requiredSetbackM: 0,
      northIsRoad: false,
      conclusion: `${zoning} — 일반 건축물 정북일조 미적용 (전용·일반주거지역만 적용)`,
      warnings: zoning.includes("준주거")
        ? ["준주거지역: 공동주택(아파트)이면 채광방향 §61② 별도 적용"]
        : [],
    };
  }

  // 2) 2층 이하 & 높이 8m 이하 → 조례 배제 가능
  if (floors <= 2 && heightM <= 8) {
    return {
      applies: true,
      exemptByOrdinance: true,
      requiredSetbackM: 0,
      northIsRoad: false,
      conclusion: `2층 이하·높이 ${heightM.toFixed(1)}m (8m 이하) — 조례로 사선제한 배제 가능`,
      warnings: ["배제 여부는 해당 지자체 건축조례 확인 필요"],
    };
  }

  // 3) 북측 도로 판별
  const northRoad = northEdge
    ? isNorthEdgeAbuttingRoad(northEdge, roads)
    : { isRoad: false, roadName: null };

  // 4) 기본 이격 (10m 개정 기준)
  const requiredSetbackM = heightM <= 10 ? 1.5 : heightM / 2;

  // 5) 경고 — 데이터 없는 배제조건 (가정 금지)
  if (northRoad.isRoad) {
    warnings.push(
      "북측이 도로에 접함 — 너비 20m 이상이고 정북 대지도 20m 도로 접하면 적용 배제 가능 (도로 너비 데이터 없음, 확인 필요)"
    );
  }
  warnings.push(
    "정북방향 인접대지 용도지역 미확인 — 전용·일반주거 아니면 적용 배제 가능 (시행령 §86②3)"
  );
  warnings.push(
    "정북방향 공원·하천 등 공지, 지표면 고저차 미반영 — 별도 확인 필요"
  );

  return {
    applies: true,
    exemptByOrdinance: false,
    requiredSetbackM,
    northIsRoad: northRoad.isRoad,
    conclusion: `건물 ${heightM.toFixed(1)}m → 북측 경계서 ${requiredSetbackM.toFixed(1)}m 이격 필요`,
    warnings,
  };
}
