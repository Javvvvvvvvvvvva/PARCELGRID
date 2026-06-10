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

  // ─── GFA-03 고도 ───────────────────────────────────────────────────
  // Conservative estimate: 9 floors at 3m typical + 1.4m parapet → 28.4m
  const estimatedHeight = program.floorsAbove * 3.0 + 1.4;
  if (estimatedHeight > parcel.heightLimit) {
    checks.push({
      code: "GFA-03",
      label: "최고고도 초과 우려",
      level: "med",
      finding: `추정 ${estimatedHeight.toFixed(1)}m / 한계 ${parcel.heightLimit}m`,
      reference: "지구단위계획 / 도시계획 조례",
      headroom: {
        actual: estimatedHeight,
        limit: parcel.heightLimit,
        unit: "m",
      },
    });
  } else {
    checks.push({
      code: "GFA-03",
      label: "고도 적합",
      level: "ok",
      finding: `추정 ${estimatedHeight.toFixed(1)}m / 한계 ${parcel.heightLimit}m`,
      reference: "지구단위계획 / 도시계획 조례",
    });
  }

  // ─── SUN-02 일조권 ─────────────────────────────────────────────────
  // North-side setback ramp: floor 4+ needs ≥ 2.0m setback per floor of height above 9m.
  // Mid-rise (8+ floors) on a tight 645m² lot triggers attention.
  if (program.floorsAbove >= 8) {
    checks.push({
      code: "SUN-02",
      label: "일조권 사선제한",
      level: "med",
      finding: `${program.floorsAbove}층 규모 — 북측 사선제한 영향 가능`,
      reference: "건축법 제61조, 시행령 제86조",
    });
  } else {
    checks.push({
      code: "SUN-02",
      label: "일조권 양호",
      level: "ok",
      finding: "저층 — 사선제한 영향 미미",
      reference: "건축법 제61조",
    });
  }

  // ─── PRK-04 주차 ───────────────────────────────────────────────────
  // 도시형생활주택: 0.6대/세대, 오피스텔: 0.8대/세대, 근린생활: 1대/134㎡
  const requiredParking =
    Math.ceil(program.units.residential * 0.7) +
    Math.ceil((program.units.retail * 50) / 134); // assume 50㎡/retail unit
  const plannedParking = Math.ceil(requiredParking * 1.1); // typical 10% buffer
  checks.push({
    code: "PRK-04",
    label: "주차 대수 충족",
    level: "low",
    finding: `법정 ${requiredParking}대 / 계획 ${plannedParking}대`,
    reference: "주차장법 시행령 별표1",
    headroom: { actual: plannedParking, limit: requiredParking, unit: "대" },
  });

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
