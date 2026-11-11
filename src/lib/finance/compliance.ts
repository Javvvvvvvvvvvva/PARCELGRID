/**
 * Preliminary regulatory risk summary, not a legal compliance decision.
 *
 * Runs a parcel + program combination against the Korean building/zoning
 * code checks that matter for feasibility:
 *
 *   GFA-01  Floor area ratio (용적률) cap
 *   GFA-02  Building coverage ratio (건폐율) cap
 *   GFA-03  Explicit floor-count input (height and permit review are separate)
 *   SUN-02  Sun-shadow setback (일조권 사선제한)
 *   PRK-04  Parking requirements (주차 대수)
 *   CUL-01  Unresolved heritage scope (국가유산 영향)
 *   ENV-03  Unresolved environmental assessment scope (환경영향평가)
 *
 * Each check returns:
 *   - level: ok | low | med | high
 *   - finding: human-readable
 *   - reference: legal citation (시행령 조항)
 *
 * References identify the separate review scope, not approval of the parcel.
 * Statutory egress and fire compliance are outside this summary.
 */

import type { Parcel, BuildingProgram } from "./types";
import { calcProgramParking } from "./parking";
import {
  evaluateSunlightRegulation,
  type SunlightLegalUse,
} from "@/lib/regulatory/sunlight-rules";
import { BUILDING_HEIGHT_SOURCE_URL } from "@/lib/regulatory/constraints";

export const COMPLIANCE_MODEL_VERSION = "regulatory-risk-summary-2026.1" as const;

export type RiskLevel = "ok" | "low" | "med" | "high";
export type RiskEvidenceStatus = "confirmed" | "preliminary";

export interface RiskCheck {
  code: string;
  label: string;
  level: RiskLevel;
  finding: string;
  reference: string;
  /** 법규 위험도와 별개인 입력·출처 확실성. */
  evidenceStatus?: RiskEvidenceStatus;
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

function sunlightLegalUseForProgram(program: BuildingProgram): SunlightLegalUse {
  switch (program.type) {
    case "single-house":
      return "detached-house";
    case "multi-family":
      return "multi-family-house";
    case "urban-housing":
      return "urban-housing";
    case "officetel":
      return "officetel";
    case "coliving":
    case "mixed":
      return "unknown-residential";
    default:
      return "general-building";
  }
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

  // FAR/maximum BCR assumes full equal-sized plates, not a maximum floor count.
  // Compare only the separate input; the program is not a statutory floor audit.
  const floorEvidence = parcel.regulatoryConstraints?.floors;
  const floorLimit = floorEvidence?.status !== "unknown" && floorEvidence?.unit === "층" &&
    Number.isInteger(floorEvidence.value) && Number(floorEvidence.value) > 0 ? Number(floorEvidence.value) : null;
  const floorReference = floorEvidence?.sourceRef || BUILDING_HEIGHT_SOURCE_URL;
  if (!Number.isInteger(program.floorsAbove) || program.floorsAbove < 1) {
    checks.push({
      code: "GFA-03", label: "계획 층수 입력 확인", level: "high", evidenceStatus: "preliminary",
      finding: "지상 층수는 양의 정수여야 합니다. 유효한 계획 층수와 별도 높이·층수 제한을 확인해야 합니다.",
      reference: floorReference,
    });
  } else if (floorLimit === null) {
    checks.push({
      code: "GFA-03", label: "층수 상한 미확인", level: "low", evidenceStatus: "preliminary",
      finding: `계획 지상 ${program.floorsAbove}층 · 별도 층수·높이·일조 제한과 허가 확인 필요. 용적률÷건폐율로 최대 층수를 판정하지 않습니다.`,
      reference: floorReference,
    });
  } else {
    const exceeded = program.floorsAbove > floorLimit;
    checks.push({
      code: "GFA-03", label: exceeded ? "층수 입력 상한 초과" : "층수 입력 상한 이내",
      level: exceeded ? "high" : "ok", evidenceStatus: "preliminary",
      finding: `계획 지상 ${program.floorsAbove}층 / 입력 상한 ${floorLimit}층 · 모델 층수 대사이며 법정 층수 산정·높이·일조·허가 적합성은 미확정입니다.`,
      reference: floorReference,
      headroom: { actual: program.floorsAbove, limit: floorLimit, unit: "층" },
    });
  }

  // ─── SUN-02 정북 일조 사선제한 ──────────────────────────────────────
  // Stage 2 계약이 있으면 당시 규칙·높이·예외 판정을 그대로 소비한다.
  const sunlight =
    program.areaContract?.sunlightAssessment ??
    evaluateSunlightRegulation({
      context: { address: parcel.address },
      zoning: parcel.zoning,
      zoningStatus:
        parcel.inputProvenance?.zoning === "vworld-land-use"
          ? "public-observation"
          : "user-entered",
      buildingHeightM: program.floorsAbove * 3 + 1.4,
      floorsAbove: program.floorsAbove,
      legalUse: sunlightLegalUseForProgram(program),
      legalUseStatus: "source-backed",
      daylight: {
        sameLotBuildingCount: 1,
        sameLotBuildingCountStatus: "source-backed",
      },
    });
  const north = sunlight.north;
  const confirmed = north.complianceDecisionGrade;
  const confirmedFailure = confirmed && north.compliant === false;
  const confirmedPass = confirmed && north.compliant === true;
  checks.push({
    code: "SUN-02",
    label:
      north.applicability === "not-applicable"
        ? "정북 일조 — 미적용"
        : "정북 일조 — 북측 이격 검토",
    level:
      north.applicability === "not-applicable" &&
      north.requirementDecisionGrade
        ? "ok"
        : confirmedFailure
          ? "high"
          : confirmedPass
            ? "ok"
            : "low",
    evidenceStatus:
      north.requirementDecisionGrade &&
      (north.applicability === "not-applicable" || confirmed)
        ? "confirmed"
        : "preliminary",
    finding:
      north.applicability === "not-applicable"
        ? north.basis.join(" · ")
        : north.effectiveDistanceM != null
          ? "북측 유효 이격 " +
            north.effectiveDistanceM.toFixed(1) +
            "m 필요" +
            (north.actualDistanceM != null
              ? " · 계획 " + north.actualDistanceM.toFixed(1) + "m"
              : " · 실제 경계 거리 확인 전") +
            (north.warnings[0] ? " · " + north.warnings[0] : "")
          : north.warnings.join(" · "),
    reference:
      "건축법 제61조·시행령 제86조 · " +
      sunlight.rule.id +
      " · 시행 " +
      sunlight.rule.effectiveFrom,
    headroom:
      north.actualDistanceM != null && north.effectiveDistanceM != null
        ? {
            actual: north.actualDistanceM,
            limit: north.effectiveDistanceM,
            unit: "m",
          }
        : undefined,
  });

  // ─── PRK-04 주차 (유형별·규모별 — 주차장법 별표1, 주택건설기준 §27) ──
  // 가짜 제거: 유형무관 0.7대 일률 + 계획 1.1배 임의생성 삭제.
  // 진짜: 건물유형 + 연면적/세대당전용면적으로 법정대수. 단독 소규모 면제.
  const parking = calcProgramParking(parcel, program);
  if (parking.exemptPossible) {
    checks.push({
      code: "PRK-04",
      label: "주차 — 면제 가능",
      level: "ok",
      evidenceStatus: "preliminary",
      finding: `${parking.basis} (${parking.warnings.join(" · ") || "관할 기준 확인 필요"})`,
      reference: parking.reference,
    });
  } else {
    const note = parking.estimated ? " (전용면적 추정 · 예비값)" : "";
    checks.push({
      code: "PRK-04",
      label: parking.decisionGrade ? "법정 주차대수" : "예비 주차대수",
      // 계획 주차면수가 이 계약에 없으므로 여기서는 부족/위반을 판정하지 않는다.
      level: "low",
      evidenceStatus: parking.decisionGrade ? "confirmed" : "preliminary",
      finding: `${parking.requiredCars}대 필요 — ${parking.basis}${note}`,
      reference: `${parking.reference} · ${parking.rule.id}`,
      headroom: {
        actual: parking.requiredCars,
        limit: parking.requiredCars,
        unit: "대",
      },
    });
  }

  // Distance alone does not establish designated boundaries or permitted acts.
  const distM = context.nearCulturalHeritageM;
  const distanceNote = typeof distM === "number" && Number.isFinite(distM) && distM >= 0
    ? `입력 거리 ${distM}m` : "국가유산 거리 미확인";
  checks.push({
    code: "CUL-01", label: "국가유산 영향 미확인", level: "low", evidenceStatus: "preliminary",
    finding: `${distanceNote} · 지정·보호구역 경계, 역사문화환경 보존지역, 개별 허용기준과 관할 검토가 필요합니다. 거리만으로 의무 또는 비대상을 판정하지 않습니다.`,
    reference: "문화유산의 보존 및 활용에 관한 법률 제13조·자연유산의 보존 및 활용에 관한 법률 제10조 · https://www.law.go.kr/admRulLsInfoP.do?admRulSeq=2100000279606",
  });

  // National, local and small-scale assessment scopes need more than GFA.
  checks.push({
    code: "ENV-03", label: "환경영향평가 적용 미확인", level: "low", evidenceStatus: "preliminary",
    finding: "사업 종류·사업구역 규모·입지·보전지역·관할 조례와 소규모 환경영향평가 적용 범위가 미확인입니다. 건물 연면적만으로 대상 여부를 판정하지 않습니다.",
    reference: "환경영향평가법 제22조·제42조·제43조 · https://law.go.kr/LSW/lsInfoP.do?ancYnChk=0&lsId=002016",
  });

  return checks;
}

/** Overall risk score 0–100, where 100 = no issues. */
export function complianceScore(checks: RiskCheck[]): number {
  const weights = { ok: 0, low: 1, med: 4, high: 12 } as const;
  const penalty = checks.reduce((sum, c) => sum + weights[c.level], 0);
  return Math.max(0, 100 - penalty);
}
