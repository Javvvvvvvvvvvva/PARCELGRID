/**
 * Regulatory compliance engine.
 *
 * Runs a parcel + program combination against the Korean building/zoning
 * code checks that matter for feasibility:
 *
 *   GFA-01  Floor area ratio (용적률) cap
 *   GFA-02  Building coverage ratio (건폐율) cap
 *   GFA-03  Height limit (고도 제한)
 *   SUN-02  Sun-shadow setback (일조권 사선제한)
 *   PRK-04  Parking requirements (주차 대수)
 *   CUL-01  Cultural heritage buffer (문화재 보호구역)
 *   ENV-03  Environmental impact assessment (환경영향평가) threshold
 *   FIR-01  Fire egress / 소방
 *
 * Each check returns:
 *   - level: ok | low | med | high
 *   - finding: human-readable
 *   - reference: legal citation (시행령 조항)
 *
 * The legal references make this auditable. When a regulation changes
 * (e.g. 주차장법 시행규칙 개정), the rule lives in one place — this
 * module — and the audit trail still resolves to the prior version.
 */

import type { Parcel, BuildingProgram } from "./types";
import { calcSunSetback } from "@/lib/geo/sun-setback";
import { calcParking } from "./parking";

export type RiskLevel = "ok" | "low" | "med" | "high";

export interface RiskCheck {
  code: string;
  label: string;
  level: RiskLevel;
  finding: string;
  reference: string;
  /** Optional: numeric headroom or violation for UI display */
  headroom?: { actual: number; limit: number; unit: string };
}

export interface ComplianceInput {
  parcel: Parcel;
  program: BuildingProgram;
  /** Optional context flags */
  context?: {
    nearCulturalHeritageM?: number; // distance to nearest heritage site
    isInDistrictUnitPlan?: boolean; // 지구단위계획 여부
  };
}

export function checkCompliance(input: ComplianceInput): RiskCheck[] {
  const { parcel, program, context = {} } = input;
  const checks: RiskCheck[] = [];

  // ─── GFA-01 용적률 ─────────────────────────────────────────────────
  if (program.far > parcel.maxFAR) {
    checks.push({
      code: "GFA-01",
      label: "용적률 위반",
      level: "high",
      finding: `계획 ${program.far}% > 상한 ${parcel.maxFAR}%`,
      reference: "국토계획법 시행령 제85조",
      headroom: { actual: program.far, limit: parcel.maxFAR, unit: "%" },
    });
  } else {
    const utilization = (program.far / parcel.maxFAR) * 100;
    checks.push({
      code: "GFA-01",
      label: "용적률 상한 여유",
      level: utilization > 95 ? "med" : "low",
      finding: `현 계획 ${program.far}% vs 상한 ${parcel.maxFAR}%`,
      reference: "국토계획법 시행령 제85조",
      headroom: { actual: program.far, limit: parcel.maxFAR, unit: "%" },
    });
  }

  // ─── GFA-02 건폐율 ─────────────────────────────────────────────────
  if (program.bcr > parcel.maxBCR) {
    checks.push({
      code: "GFA-02",
      label: "건폐율 위반",
      level: "high",
      finding: `계획 ${program.bcr}% > 상한 ${parcel.maxBCR}%`,
      reference: "국토계획법 시행령 제84조",
      headroom: { actual: program.bcr, limit: parcel.maxBCR, unit: "%" },
    });
  } else {
    checks.push({
      code: "GFA-02",
      label: "건폐율 확인",
      level: "ok",
      finding: `${program.bcr}% / 상한 ${parcel.maxBCR}%`,
      reference: "국토계획법 시행령 제84조",
    });
  }

  // ─── GFA-03 층수 여유 (용적률 기준) ──────────────────────────────────
  // 제2종일반주거 등에 법적 절대고도 22m는 없음 (고도지구 지정시만).
  // 진짜 한계는 용적률 — 최대 층수 = 용적률상한 / 건폐율상한 (국토계획법 §85).
  // 건폐율을 꽉 채운 가정의 상한 가능치 (실제는 일조·주차로 더 낮을 수 있음).
  const maxFloorsByFAR =
    parcel.maxBCR > 0
      ? Math.floor(parcel.maxFAR / parcel.maxBCR)
      : program.floorsAbove;
  const floorHeadroom = maxFloorsByFAR - program.floorsAbove;
  if (floorHeadroom < 0) {
    checks.push({
      code: "GFA-03",
      label: "용적률 상한 초과 우려",
      level: "high",
      finding: `현재 ${program.floorsAbove}층 / 용적률 ${parcel.maxFAR}% 기준 약 ${maxFloorsByFAR}층`,
      reference: "국토계획법 시행령 §85 (용적률)",
      headroom: {
        actual: program.floorsAbove,
        limit: maxFloorsByFAR,
        unit: "층",
      },
    });
  } else {
    checks.push({
      code: "GFA-03",
      label: floorHeadroom === 0 ? "용적률 상한 근접" : "층수 여유",
      level: floorHeadroom === 0 ? "med" : "ok",
      finding: `현재 ${program.floorsAbove}층 / 용적률 ${parcel.maxFAR}% 기준 약 ${maxFloorsByFAR}층 가능`,
      reference: "국토계획법 시행령 §85 (용적률)",
      headroom: {
        actual: program.floorsAbove,
        limit: maxFloorsByFAR,
        unit: "층",
      },
    });
  }

  // ─── SUN-02 정북 일조 사선제한 (건축법 §86) ──────────────────────────
  // 진짜 계산: 건물높이 → 필요 북측이격 (10m↓ 1.5m, 초과분 높이/2).
  // 준수여부는 북측 인접대지경계선 거리 필요 — 현재 인접필지 데이터 없어 미판정.
  // 가짜 "8층 임계값" 제거.
  const sunHeight = program.floorsAbove * 3.0 + 1.4;
  const sun = calcSunSetback(sunHeight, null);
  if (sun.exemptPossible) {
    checks.push({
      code: "SUN-02",
      label: "정북 일조 — 완화 대상",
      level: "ok",
      finding: `${sunHeight.toFixed(1)}m (2층·8m 이하) — 조례로 사선제한 배제 가능`,
      reference: "건축법 §61④, 시행령 §86",
    });
  } else {
    checks.push({
      code: "SUN-02",
      label: "정북 일조 — 북측 이격 필요",
      level: "med",
      finding: `건물 ${sunHeight.toFixed(1)}m → 북측 ${sun.requiredSetbackM.toFixed(1)}m 이격 필요 (준수여부는 인접대지 거리 확인 필요)`,
      reference: "건축법 §61, 시행령 §86 (10m↓ 1.5m, 초과분 높이÷2)",
    });
  }

  // ─── PRK-04 주차 (유형별·규모별 — 주차장법 별표1, 주택건설기준 §27) ──
  // 가짜 제거: 유형무관 0.7대 일률 + 계획 1.1배 임의생성 삭제.
  // 진짜: 건물유형 + 연면적/세대당전용면적으로 법정대수. 단독 소규모 면제.
  // 연면적 = 대지면적 × 용적률 (BuildingProgram에 gfa 직접 없음)
  const grossFloorArea = parcel.lotArea * (program.far / 100);
  const parking = calcParking(
    program.type,
    grossFloorArea,
    program.units.residential,
    program.units.retail
  );
  if (parking.exemptPossible) {
    checks.push({
      code: "PRK-04",
      label: "주차 — 면제 가능",
      level: "ok",
      finding: `${parking.basis} (조례 확인 필요)`,
      reference: parking.reference,
    });
  } else {
    const note = parking.estimated ? " (전용면적 추정)" : "";
    checks.push({
      code: "PRK-04",
      label: "법정 주차대수",
      level: "low",
      finding: `${parking.requiredCars}대 필요 — ${parking.basis}${note}`,
      reference: parking.reference,
      headroom: {
        actual: parking.requiredCars,
        limit: parking.requiredCars,
        unit: "대",
      },
    });
  }

  // ─── CUL-01 문화재 ────────────────────────────────────────────────
  const distM = context.nearCulturalHeritageM;
  if (distM !== undefined) {
    if (distM <= 100) {
      checks.push({
        code: "CUL-01",
        label: "문화재 영향구역",
        level: "high",
        finding: `${distM}m — 영향평가 필수`,
        reference: "문화재보호법 제13조",
      });
    } else if (distM <= 500) {
      checks.push({
        code: "CUL-01",
        label: "문화재 보호구역",
        level: "high",
        finding: `${distM}m 인접 — 협의 필요`,
        reference: "문화재보호법 제13조",
      });
    }
  }

  // ─── ENV-03 환경영향평가 ────────────────────────────────────────────
  // Threshold: 30,000m² 이상 사업장 (urban housing). Most small parcels are well under.
  const lotArea = parcel.lotArea;
  const gfa = (lotArea * program.far) / 100;
  if (gfa >= 30_000) {
    checks.push({
      code: "ENV-03",
      label: "환경영향평가 대상",
      level: "med",
      finding: `연면적 ${Math.round(gfa).toLocaleString()}㎡ — 평가 필요`,
      reference: "환경영향평가법 제22조",
    });
  } else {
    checks.push({
      code: "ENV-03",
      label: "환경영향평가",
      level: "ok",
      finding: "연면적 기준 미해당",
      reference: "환경영향평가법 제22조",
    });
  }

  return checks;
}

/** Overall risk score 0–100, where 100 = no issues. */
export function complianceScore(checks: RiskCheck[]): number {
  const weights = { ok: 0, low: 1, med: 4, high: 12 } as const;
  const penalty = checks.reduce((sum, c) => sum + weights[c.level], 0);
  return Math.max(0, 100 - penalty);
}
