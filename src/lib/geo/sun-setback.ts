/**
 * 정북 일조 사선제한 계산 (건축법 제61조 + 시행령 제86조 1항).
 *
 * 전용·일반주거지역에서 건축물의 각 부분을 정북방향 인접대지경계선으로부터:
 *  - 높이 10m 이하 부분: 1.5m 이상
 *  - 높이 10m 초과 부분: 해당 부분 높이의 1/2 이상
 * (2023.9 개정으로 9m → 10m 완화)
 *
 * "사실만" 원칙: 필요 이격은 건물 높이로 계산되는 사실.
 * 준수 여부는 북측 인접대지경계선까지 실제 거리가 있어야 판정 가능.
 */

/** 일조 사선 적용 기준 높이 (m) — 2023 개정 후 */
const ILJO_THRESHOLD_M = 10;
/** 기준 높이 이하 최소 이격 (m) */
const BASE_SETBACK_M = 1.5;
/** 조례 배제 가능 상한 (2층 이하 & 8m 이하) */
const EXEMPT_HEIGHT_M = 8;

export interface SunSetbackResult {
  /** 건물 최고높이 기준 필요한 북측 이격 (m) */
  requiredSetbackM: number;
  /** 건물 높이 (m) */
  buildingHeightM: number;
  /** 10m 초과 여부 (사선제한 본격 적용) */
  exceedsThreshold: boolean;
  /** 2층 이하 & 8m 이하 — 조례로 배제 가능 */
  exemptPossible: boolean;
  /** 북측 경계 거리를 알 때만: 준수 여부 */
  compliant: boolean | null;
  /** 부족분 (m) — 경계 거리 알 때만 */
  shortfallM: number | null;
}

/**
 * 정북 일조 필요 이격 계산.
 * @param buildingHeightM 건물 최고높이 (m)
 * @param northBoundaryDistM 북측 인접대지경계선까지 거리 (m). 모르면 null.
 */
export function calcSunSetback(
  buildingHeightM: number,
  northBoundaryDistM: number | null = null
): SunSetbackResult {
  const exceedsThreshold = buildingHeightM > ILJO_THRESHOLD_M;
  // 10m 이하: 1.5m. 초과: 최고높이의 1/2 (보수적 — 최상부 기준)
  const requiredSetbackM = exceedsThreshold
    ? buildingHeightM / 2
    : BASE_SETBACK_M;
  const exemptPossible = buildingHeightM <= EXEMPT_HEIGHT_M;

  let compliant: boolean | null = null;
  let shortfallM: number | null = null;
  if (northBoundaryDistM != null) {
    compliant = northBoundaryDistM >= requiredSetbackM;
    shortfallM = Math.max(0, requiredSetbackM - northBoundaryDistM);
  }

  return {
    requiredSetbackM,
    buildingHeightM,
    exceedsThreshold,
    exemptPossible,
    compliant,
    shortfallM,
  };
}
