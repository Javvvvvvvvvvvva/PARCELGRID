export type RegulatoryEvidenceStatus =
  | "unknown"
  | "reference-only"
  | "user-entered"
  | "source-backed"
  | "expert-approved";

export type RegulatoryConstraintKey = "far" | "bcr" | "height" | "floors";
export type RegulatoryConstraintUnit = "%" | "m" | "층";

export interface RegulatorySourceMetadata {
  sourceName: string;
  sourceRef?: string;
  asOf?: string;
  retrievedAt?: string;
  checkedBy?: string;
  checkedRole?: string;
  note?: string;
}

export interface RegulatoryConstraintEvidence extends RegulatorySourceMetadata {
  value: number | null;
  unit: RegulatoryConstraintUnit;
  status: RegulatoryEvidenceStatus;
  /** 시행령 전국 범위 등 필지별 확정 전 참고값. 확인값으로 덮어써도 보존한다. */
  referenceValue?: number | null;
  referenceSourceName?: string;
  referenceSourceRef?: string;
}

export interface RegulatoryConstraintSet {
  version: "regulatory-provenance-2026.1";
  retrievedAt: string;
  zoningSource: RegulatorySourceMetadata & {
    status: "source-backed" | "unknown";
  };
  far: RegulatoryConstraintEvidence;
  bcr: RegulatoryConstraintEvidence;
  height: RegulatoryConstraintEvidence;
  floors: RegulatoryConstraintEvidence;
}

export interface RegulatoryReferenceInput {
  farPct?: number | null;
  bcrPct?: number | null;
  heightM?: number | null;
  floors?: number | null;
  retrievedAt?: string;
  zoningSourceName?: string;
  zoningSourceRef?: string;
}

const NATIONAL_BCR_SOURCE = "국토계획법 시행령 제84조 전국 범위";
const NATIONAL_FAR_SOURCE = "국토계획법 시행령 제85조 전국 범위";
const BUILDING_HEIGHT_SOURCE = "건축법 제60조·제61조 및 관할 도시계획";

export const NATIONAL_BCR_SOURCE_URL =
  "https://www.law.go.kr/LSW/lumLsLinkPop.do?lspttninfSeq=137032";
export const NATIONAL_FAR_SOURCE_URL =
  "https://www.law.go.kr/LSW/lumLsLinkPop.do?lspttninfSeq=135430";
export const BUILDING_HEIGHT_SOURCE_URL =
  "https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsId=001823&lsJoLnkSeq=1000908025";
export const VWORLD_LAND_USE_SOURCE_URL =
  "https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do";

function positiveOrNull(value: number | null | undefined): number | null {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

function referenceEvidence(
  value: number | null | undefined,
  unit: RegulatoryConstraintUnit,
  sourceName: string,
  sourceRef: string,
  note: string
): RegulatoryConstraintEvidence {
  const normalized = positiveOrNull(value);
  return {
    value: normalized,
    unit,
    status: normalized == null ? "unknown" : "reference-only",
    sourceName,
    sourceRef,
    referenceValue: normalized,
    referenceSourceName: sourceName,
    referenceSourceRef: sourceRef,
    note,
  };
}

export function createRegulatoryReferenceSet(
  input: RegulatoryReferenceInput = {}
): RegulatoryConstraintSet {
  const retrievedAt = input.retrievedAt ?? new Date().toISOString();
  return {
    version: "regulatory-provenance-2026.1",
    retrievedAt,
    zoningSource: {
      status: input.zoningSourceName ? "source-backed" : "unknown",
      sourceName: input.zoningSourceName ?? "용도지역 원문 미확인",
      sourceRef: input.zoningSourceRef,
      retrievedAt,
      note: input.zoningSourceName
        ? "용도지역·지구 명칭 조회 사실만 확인합니다. 건폐율·용적률·높이 숫자의 필지별 확정을 뜻하지 않습니다."
        : "용도지역 원문 조회가 필요합니다.",
    },
    far: referenceEvidence(
      input.farPct,
      "%",
      NATIONAL_FAR_SOURCE,
      NATIONAL_FAR_SOURCE_URL,
      "전국 시행령 범위의 상단 참고값입니다. 관할 조례·지구단위계획·중첩 규제로 달라질 수 있습니다."
    ),
    bcr: referenceEvidence(
      input.bcrPct,
      "%",
      NATIONAL_BCR_SOURCE,
      NATIONAL_BCR_SOURCE_URL,
      "전국 시행령 범위의 상단 참고값입니다. 관할 조례·지구단위계획·중첩 규제로 달라질 수 있습니다."
    ),
    height: referenceEvidence(
      input.heightM,
      "m",
      BUILDING_HEIGHT_SOURCE,
      BUILDING_HEIGHT_SOURCE_URL,
      "용도지역만으로 필지별 최고높이를 확정할 수 없습니다. 가로구역·지구단위계획·고도지구·정북일조를 별도로 확인합니다."
    ),
    floors: referenceEvidence(
      input.floors,
      "층",
      "관할 지구단위계획·도시계획 결정",
      BUILDING_HEIGHT_SOURCE_URL,
      "층수 제한은 지정된 경우에만 적용합니다. 용적률÷건폐율은 법정 층수 확정식이 아닙니다."
    ),
  };
}

export function regulatoryConstraintIsDecisionGrade(
  evidence: RegulatoryConstraintEvidence | undefined | null
): boolean {
  return Boolean(
    evidence &&
      evidence.value != null &&
      evidence.value > 0 &&
      (evidence.status === "source-backed" ||
        evidence.status === "expert-approved")
  );
}

export function decisionGradeConstraintCount(
  set: RegulatoryConstraintSet | undefined | null
): number {
  if (!set) return 0;
  return ([set.far, set.bcr, set.height, set.floors] as const).filter(
    regulatoryConstraintIsDecisionGrade
  ).length;
}

export function coreRegulatoryConstraintsVerified(
  set: RegulatoryConstraintSet | undefined | null
): boolean {
  return Boolean(
    set &&
      regulatoryConstraintIsDecisionGrade(set.far) &&
      regulatoryConstraintIsDecisionGrade(set.bcr) &&
      regulatoryConstraintIsDecisionGrade(set.height)
  );
}

export function constraintStatusLabel(status: RegulatoryEvidenceStatus): string {
  if (status === "expert-approved") return "전문가 승인";
  if (status === "source-backed") return "원문 확인";
  if (status === "user-entered") return "사용자 입력";
  if (status === "reference-only") return "참고값";
  return "미확인";
}

export function replaceConstraintEvidence(
  current: RegulatoryConstraintEvidence,
  input: {
    value: number | null;
    status: "user-entered" | "source-backed" | "expert-approved";
    sourceName: string;
    sourceRef?: string;
    asOf?: string;
    checkedBy?: string;
    checkedRole?: string;
    note?: string;
  }
): RegulatoryConstraintEvidence {
  return {
    ...current,
    value: positiveOrNull(input.value),
    status: positiveOrNull(input.value) == null ? "unknown" : input.status,
    sourceName: input.sourceName.trim() || "사용자 입력",
    sourceRef: input.sourceRef?.trim() || undefined,
    asOf: input.asOf || undefined,
    checkedBy: input.checkedBy?.trim() || undefined,
    checkedRole: input.checkedRole?.trim() || undefined,
    note: input.note?.trim() || undefined,
  };
}

export function restoreReferenceConstraint(
  current: RegulatoryConstraintEvidence
): RegulatoryConstraintEvidence {
  const value = positiveOrNull(current.referenceValue);
  return {
    ...current,
    value,
    status: value == null ? "unknown" : "reference-only",
    sourceName: current.referenceSourceName ?? current.sourceName,
    sourceRef: current.referenceSourceRef ?? current.sourceRef,
    asOf: undefined,
    checkedBy: undefined,
    checkedRole: undefined,
    note:
      current.unit === "m"
        ? "필지별 높이 원문이 확인되지 않았습니다."
        : "전국 시행령 범위의 참고값이며 필지별 적용값은 확인되지 않았습니다.",
  };
}
