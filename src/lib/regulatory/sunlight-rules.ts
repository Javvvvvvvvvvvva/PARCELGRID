export const SUNLIGHT_RULE_ENGINE_VERSION = "sunlight-rules-2026.1" as const;

export type SunlightRuleEvidenceStatus = "source-backed" | "reference-only";

export type SunlightInputStatus =
  | "user-entered"
  | "public-observation"
  | "source-backed"
  | "expert-approved";

export type SunlightApplicability = "applies" | "not-applicable" | "review";

export type SunlightLegalUse =
  | "general-building"
  | "detached-house"
  | "multi-family-house"
  | "multi-unit-house"
  | "row-house"
  | "apartment"
  | "urban-housing"
  | "officetel"
  | "dormitory"
  | "unknown-residential";

export type SunlightSeparatorType =
  | "none"
  | "road"
  | "park"
  | "railway"
  | "river"
  | "plaza"
  | "public-open-space"
  | "green-space"
  | "retention-basin"
  | "expressway"
  | "amusement-park"
  | "non-buildable-open-space"
  | "unknown";

export type SameLotFacingRelation =
  | "opening-to-opening"
  | "high-opening-to-low"
  | "accessory-facing"
  | "blank-wall"
  | "side-to-side"
  | "urban-complex";

export interface SunlightRuleSource {
  id: string;
  sourceName: string;
  sourceRef: string;
  sourceUrl: string;
  effectiveFrom: string;
  promulgationNo: string;
  verifiedAt: string;
}

export interface SunlightRuleSet {
  id: string;
  engineVersion: typeof SUNLIGHT_RULE_ENGINE_VERSION;
  jurisdictionCode: "KR" | "KR-11";
  jurisdictionName: string;
  effectiveFrom: string;
  sources: SunlightRuleSource[];
  north: {
    thresholdHeightM: number;
    lowHeightSetbackM: number;
    highHeightRatio: number;
    lowRiseLocalException: "not-adopted" | "unknown";
  };
  daylight: {
    boundaryHeightRatio: number;
    reducedBoundaryHeightRatio: number;
    seoulMultiUnitBoundaryM?: number;
    sameLotHeightRatio: number;
    urbanSameLotHeightRatio: number;
    urbanSameLotMinimumM: number;
    blankWallDistanceM: number;
    sideToSideDistanceM: number;
  };
}

export interface SunlightRuleContext {
  jurisdictionCode?: string;
  address?: string;
  /** 적용 기준일 YYYY-MM-DD. 생략하면 계산 시점의 현행 규칙을 사용한다. */
  asOf?: string;
}

export interface ResolvedSunlightRuleSet {
  ruleSet: SunlightRuleSet;
  status: SunlightRuleEvidenceStatus;
  asOf: string;
  warnings: string[];
}

export interface SunlightNorthBoundaryInput {
  adjacentZoning?: string;
  adjacentZoningStatus?: SunlightInputStatus;
  separatorType?: SunlightSeparatorType;
  separatorStatus?: SunlightInputStatus;
  separatorWidthM?: number;
  separatorWidthStatus?: SunlightInputStatus;
  /** 계획 건물 외벽에서 원래 북측 인접대지경계선까지의 최단거리. */
  actualBuildingSetbackM?: number;
  actualBuildingSetbackStatus?: SunlightInputStatus;
  /** 20m 도로 및 지정구역 등 시행령상 요건 전체가 확인된 경우에만 true. */
  wideRoadDistrictExceptionConfirmed?: boolean;
  wideRoadDistrictExceptionStatus?: SunlightInputStatus;
  buildingAgreementExceptionConfirmed?: boolean;
  buildingAgreementExceptionStatus?: SunlightInputStatus;
  /** 건축법 제61조제4항에 따른 해당 관할 조례의 저층 배제가 확인된 경우. */
  lowRiseLocalExceptionConfirmed?: boolean;
  lowRiseLocalExceptionStatus?: SunlightInputStatus;
}

export interface SunlightDaylightInput {
  /** 채광창이 있는 벽면에서 원래 인접대지경계선까지의 거리. */
  actualBoundaryDistanceM?: number;
  actualBoundaryDistanceStatus?: SunlightInputStatus;
  sameLotBuildingCount?: number;
  sameLotBuildingCountStatus?: SunlightInputStatus;
  sameLotRelation?: SameLotFacingRelation;
  sameLotRelationStatus?: SunlightInputStatus;
  actualSameLotDistanceM?: number;
  actualSameLotDistanceStatus?: SunlightInputStatus;
  /** 고층·저층 또는 부속건축물 관계식에 사용하는 맞은편 건물 높이. */
  facingBuildingHeightM?: number;
  facingBuildingHeightStatus?: SunlightInputStatus;
}

export interface SunlightRegulationInput {
  context?: SunlightRuleContext;
  zoning?: string;
  zoningStatus?: SunlightInputStatus;
  buildingHeightM: number;
  floorsAbove: number;
  legalUse: SunlightLegalUse;
  legalUseStatus?: SunlightInputStatus;
  northBoundary?: SunlightNorthBoundaryInput;
  daylight?: SunlightDaylightInput;
}

export interface SunlightRuleSnapshot {
  engineVersion: typeof SUNLIGHT_RULE_ENGINE_VERSION;
  id: string;
  jurisdictionCode: SunlightRuleSet["jurisdictionCode"];
  jurisdictionName: string;
  effectiveFrom: string;
  asOf: string;
  status: SunlightRuleEvidenceStatus;
  sources: SunlightRuleSource[];
  north: SunlightRuleSet["north"];
}

export interface SunlightDistanceAssessment {
  applicability: SunlightApplicability;
  statutoryDistanceM: number | null;
  effectiveDistanceM: number | null;
  boundaryOffsetM: number;
  boundaryBasis: "parcel-boundary" | "opposite-edge" | "centerline";
  requirementDecisionGrade: boolean;
  compliant: boolean | null;
  complianceDecisionGrade: boolean;
  actualDistanceM: number | null;
  shortfallM: number | null;
  basis: string[];
  warnings: string[];
}

export interface NorthSunlightAssessment extends SunlightDistanceAssessment {
  geometryApplies: boolean;
  exception:
    | "none"
    | "target-zoning"
    | "adjacent-zoning"
    | "wide-road-district"
    | "building-agreement"
    | "local-low-rise"
    | "unconfirmed";
}

export interface DaylightAssessment {
  applicability: SunlightApplicability;
  boundary: SunlightDistanceAssessment;
  sameLot: SunlightDistanceAssessment;
  decisionGrade: boolean;
  basis: string[];
  warnings: string[];
}

export interface SunlightRegulationResult {
  rule: SunlightRuleSnapshot;
  north: NorthSunlightAssessment;
  daylight: DaylightAssessment;
  decisionGrade: boolean;
  warnings: string[];
}

export interface SunlightGeometryProfile {
  engineVersion: typeof SUNLIGHT_RULE_ENGINE_VERSION;
  ruleId: string;
  applies: boolean;
  applicability: SunlightApplicability;
  thresholdHeightM: number;
  lowHeightSetbackM: number;
  highHeightRatio: number;
  boundaryOffsetM: number;
  decisionGrade: boolean;
  warnings: string[];
}

const BUILDING_ACT_SOURCE: SunlightRuleSource = {
  id: "building-act-article-61-2026-02-27",
  sourceName: "건축법",
  sourceRef: "제61조",
  sourceUrl:
    "https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1026131073",
  effectiveFrom: "2026-02-27",
  promulgationNo: "법률 제21035호",
  verifiedAt: "2026-09-08",
};

const BUILDING_DECREE_SOURCE: SunlightRuleSource = {
  id: "building-act-enforcement-decree-article-86-2026-07-28",
  sourceName: "건축법 시행령",
  sourceRef: "제86조",
  sourceUrl:
    "https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1032886681",
  effectiveFrom: "2026-07-28",
  promulgationNo: "대통령령 제36541호",
  verifiedAt: "2026-09-08",
};

const SEOUL_BUILDING_ORDINANCE_SOURCE: SunlightRuleSource = {
  id: "seoul-building-ordinance-article-35-2026-03-30",
  sourceName: "서울특별시 건축 조례",
  sourceRef: "제35조",
  sourceUrl:
    "https://www.law.go.kr/LSW/ordinSideInfoP.do?chrClsCd=010202&docCls=jo&gubun=&joBrNo=00&joNo=0035&ordinSeq=2116749&urlMode=ordinScJoAllRltInfoR",
  effectiveFrom: "2026-03-30",
  promulgationNo: "서울특별시조례 제10083호",
  verifiedAt: "2026-09-08",
};

const NATIONAL_REFERENCE_RULE_SET: SunlightRuleSet = {
  id: "sunlight-kr-national-2026-07-28",
  engineVersion: SUNLIGHT_RULE_ENGINE_VERSION,
  jurisdictionCode: "KR",
  jurisdictionName: "대한민국 국가 기준",
  effectiveFrom: "2026-07-28",
  sources: [BUILDING_ACT_SOURCE, BUILDING_DECREE_SOURCE],
  north: {
    thresholdHeightM: 10,
    lowHeightSetbackM: 1.5,
    highHeightRatio: 0.5,
    lowRiseLocalException: "unknown",
  },
  daylight: {
    boundaryHeightRatio: 0.5,
    reducedBoundaryHeightRatio: 0.25,
    sameLotHeightRatio: 0.5,
    urbanSameLotHeightRatio: 0.25,
    urbanSameLotMinimumM: 4,
    blankWallDistanceM: 8,
    sideToSideDistanceM: 4,
  },
};

const SEOUL_RULE_SET: SunlightRuleSet = {
  ...NATIONAL_REFERENCE_RULE_SET,
  id: "sunlight-kr-seoul-2026-03-30",
  jurisdictionCode: "KR-11",
  jurisdictionName: "서울특별시",
  effectiveFrom: "2026-03-30",
  sources: [
    SEOUL_BUILDING_ORDINANCE_SOURCE,
    BUILDING_ACT_SOURCE,
    BUILDING_DECREE_SOURCE,
  ],
  north: {
    ...NATIONAL_REFERENCE_RULE_SET.north,
    lowRiseLocalException: "not-adopted",
  },
  daylight: {
    ...NATIONAL_REFERENCE_RULE_SET.daylight,
    seoulMultiUnitBoundaryM: 1,
  },
};

const SEPARATOR_RELOCATES_BOUNDARY = new Set<SunlightSeparatorType>([
  "road",
  "park",
  "railway",
  "river",
  "plaza",
  "public-open-space",
  "green-space",
  "retention-basin",
  "expressway",
  "amusement-park",
  "non-buildable-open-space",
]);

const COMMUNAL_HOUSING_USES = new Set<SunlightLegalUse>([
  "multi-unit-house",
  "row-house",
  "apartment",
  "urban-housing",
]);

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : todayIsoDate();
}

function inferredJurisdiction(
  context: SunlightRuleContext
): SunlightRuleSet["jurisdictionCode"] {
  const explicit = context.jurisdictionCode?.trim().toUpperCase();
  if (explicit === "KR-11" || explicit === "SEOUL") return "KR-11";

  const address = context.address?.replace(/\s/g, "") ?? "";
  return address.startsWith("서울특별시") || address.startsWith("서울")
    ? "KR-11"
    : "KR";
}

export function resolveSunlightRuleSet(
  context: SunlightRuleContext = {}
): ResolvedSunlightRuleSet {
  const asOf = normalizeDate(context.asOf);
  const jurisdiction = inferredJurisdiction(context);
  const ruleSet =
    jurisdiction === "KR-11" ? SEOUL_RULE_SET : NATIONAL_REFERENCE_RULE_SET;
  const warnings: string[] = [];
  let status: SunlightRuleEvidenceStatus =
    jurisdiction === "KR-11" ? "source-backed" : "reference-only";

  if (jurisdiction !== "KR-11") {
    warnings.push(
      "관할 건축 조례가 등록되지 않아 건축법과 시행령의 국가 기준을 참고값으로 사용했습니다."
    );
  }

  const unavailableEffectiveDates = [
    ruleSet.effectiveFrom,
    ...ruleSet.sources.map((source) => source.effectiveFrom),
  ].filter((effectiveFrom) => asOf < effectiveFrom);

  if (unavailableEffectiveDates.length > 0) {
    status = "reference-only";
    const nextRegisteredEffectiveDate = unavailableEffectiveDates.sort()[0];
    warnings.push(
      asOf +
        "에 적용되는 일조·채광 규칙 이력이 완전하지 않아 " +
        nextRegisteredEffectiveDate +
        " 이후 출처를 포함한 현행 규칙을 참고값으로 사용했습니다."
    );
  }

  return { ruleSet, status, asOf, warnings };
}

export function sunlightInputIsDecisionGrade(
  status: SunlightInputStatus | undefined
): boolean {
  return status === "source-backed" || status === "expert-approved";
}

export function isNorthSunlightResidentialZone(zoning: string): boolean {
  const normalized = zoning.replace(/\s/g, "");
  return (
    normalized.includes("전용주거지역") ||
    normalized.includes("일반주거지역")
  );
}

function isGeneralOrCentralCommercialZone(zoning: string): boolean {
  const normalized = zoning.replace(/\s/g, "");
  return (
    normalized.includes("일반상업지역") ||
    normalized.includes("중심상업지역")
  );
}

function isReducedDaylightZone(zoning: string): boolean {
  const normalized = zoning.replace(/\s/g, "");
  return (
    normalized.includes("근린상업지역") ||
    normalized.includes("준주거지역")
  );
}

function finiteNonNegative(value: number | undefined): number | null {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function requiredNorthSunlightSetback(
  heightM: number,
  ruleSet: SunlightRuleSet = NATIONAL_REFERENCE_RULE_SET
): number {
  const height = Math.max(0, Number.isFinite(heightM) ? heightM : 0);
  return height <= ruleSet.north.thresholdHeightM
    ? ruleSet.north.lowHeightSetbackM
    : height * ruleSet.north.highHeightRatio;
}

function ruleSnapshot(
  resolved: ResolvedSunlightRuleSet
): SunlightRuleSnapshot {
  return {
    engineVersion: SUNLIGHT_RULE_ENGINE_VERSION,
    id: resolved.ruleSet.id,
    jurisdictionCode: resolved.ruleSet.jurisdictionCode,
    jurisdictionName: resolved.ruleSet.jurisdictionName,
    effectiveFrom: resolved.ruleSet.effectiveFrom,
    asOf: resolved.asOf,
    status: resolved.status,
    sources: resolved.ruleSet.sources,
    north: resolved.ruleSet.north,
  };
}

function notApplicableDistance(
  basis: string[],
  requirementDecisionGrade: boolean,
  warnings: string[] = []
): SunlightDistanceAssessment {
  return {
    applicability: "not-applicable",
    statutoryDistanceM: 0,
    effectiveDistanceM: 0,
    boundaryOffsetM: 0,
    boundaryBasis: "parcel-boundary",
    requirementDecisionGrade,
    compliant: null,
    complianceDecisionGrade: false,
    actualDistanceM: null,
    shortfallM: null,
    basis,
    warnings,
  };
}

function unresolvedDistance(
  basis: string[],
  warnings: string[]
): SunlightDistanceAssessment {
  return {
    applicability: "review",
    statutoryDistanceM: null,
    effectiveDistanceM: null,
    boundaryOffsetM: 0,
    boundaryBasis: "parcel-boundary",
    requirementDecisionGrade: false,
    compliant: null,
    complianceDecisionGrade: false,
    actualDistanceM: null,
    shortfallM: null,
    basis,
    warnings,
  };
}

function actualDistanceFields(
  actualDistanceM: number | undefined,
  actualStatus: SunlightInputStatus | undefined,
  effectiveDistanceM: number,
  requirementDecisionGrade: boolean,
  warnings: string[]
): Pick<
  SunlightDistanceAssessment,
  | "actualDistanceM"
  | "compliant"
  | "shortfallM"
  | "complianceDecisionGrade"
> {
  const actual = finiteNonNegative(actualDistanceM);
  if (actual == null) {
    warnings.push("실제 이격거리가 없어 준수 여부를 판정하지 않았습니다.");
    return {
      actualDistanceM: null,
      compliant: null,
      shortfallM: null,
      complianceDecisionGrade: false,
    };
  }

  const complianceDecisionGrade =
    requirementDecisionGrade && sunlightInputIsDecisionGrade(actualStatus);
  if (!sunlightInputIsDecisionGrade(actualStatus)) {
    warnings.push(
      "실제 이격거리가 사용자 입력 또는 관측 상태라 도면 근거나 전문가 승인 전에는 예비 비교입니다."
    );
  }
  return {
    actualDistanceM: round(actual),
    compliant: actual + 1e-9 >= effectiveDistanceM,
    shortfallM: round(Math.max(0, effectiveDistanceM - actual)),
    complianceDecisionGrade,
  };
}

function separatorBoundaryOffset(
  boundary: SunlightNorthBoundaryInput,
  mode: "opposite-edge" | "centerline",
  warnings: string[]
): {
  offsetM: number;
  basis: SunlightDistanceAssessment["boundaryBasis"];
  decisionGrade: boolean;
} {
  const type = boundary.separatorType;
  if (!type || type === "none") {
    return {
      offsetM: 0,
      basis: "parcel-boundary",
      decisionGrade: sunlightInputIsDecisionGrade(boundary.separatorStatus),
    };
  }

  if (type === "unknown") {
    warnings.push("경계 사이 공지 유형이 미확인이라 원래 대지경계선을 사용했습니다.");
    return { offsetM: 0, basis: "parcel-boundary", decisionGrade: false };
  }

  if (!SEPARATOR_RELOCATES_BOUNDARY.has(type)) {
    return { offsetM: 0, basis: "parcel-boundary", decisionGrade: false };
  }

  const widthM = finiteNonNegative(boundary.separatorWidthM);
  const decisionGrade =
    sunlightInputIsDecisionGrade(boundary.separatorStatus) &&
    sunlightInputIsDecisionGrade(boundary.separatorWidthStatus) &&
    widthM != null;
  if (!decisionGrade) {
    warnings.push(
      "경계 사이 공지의 유형·폭이 원문 확인 또는 전문가 승인 상태가 아니어서 경계선 이동을 형상에 반영하지 않았습니다."
    );
    return { offsetM: 0, basis: "parcel-boundary", decisionGrade: false };
  }

  return {
    offsetM: round(mode === "opposite-edge" ? widthM : widthM / 2),
    basis: mode,
    decisionGrade: true,
  };
}

function northNotApplicable(
  basis: string[],
  decisionGrade: boolean,
  exception: NorthSunlightAssessment["exception"],
  warnings: string[] = []
): NorthSunlightAssessment {
  return {
    ...notApplicableDistance(basis, decisionGrade, warnings),
    geometryApplies: false,
    exception,
  };
}

function assessNorthSunlight(
  input: SunlightRegulationInput,
  resolved: ResolvedSunlightRuleSet
): NorthSunlightAssessment {
  const ruleSet = resolved.ruleSet;
  const boundary = input.northBoundary ?? {};
  const warnings: string[] = [];
  const basis: string[] = [];
  const ruleIsDecisionGrade = resolved.status === "source-backed";
  const zoning = input.zoning?.trim() ?? "";
  const zoningIsDecisionGrade = sunlightInputIsDecisionGrade(
    input.zoningStatus
  );

  if (!zoning) {
    const unresolved = unresolvedDistance(
      ["대상 대지 용도지역 미확인"],
      ["전용주거지역·일반주거지역 해당 여부를 확인해야 합니다."]
    );
    return {
      ...unresolved,
      statutoryDistanceM: requiredNorthSunlightSetback(
        input.buildingHeightM,
        ruleSet
      ),
      effectiveDistanceM: requiredNorthSunlightSetback(
        input.buildingHeightM,
        ruleSet
      ),
      geometryApplies: true,
      exception: "unconfirmed",
    };
  }

  if (!isNorthSunlightResidentialZone(zoning)) {
    if (!zoningIsDecisionGrade) {
      warnings.push(
        "용도지역이 관측 또는 사용자 입력 상태라 정북일조 미적용 결론은 예비값입니다."
      );
    }
    return northNotApplicable(
      [zoning + "은 일반 건축물 정북일조 적용 용도지역이 아닙니다."],
      ruleIsDecisionGrade && zoningIsDecisionGrade,
      "target-zoning",
      warnings
    );
  }

  basis.push(
    zoning +
      " · 높이 " +
      round(input.buildingHeightM, 1).toFixed(1) +
      "m 정북일조 검토"
  );
  let applicability: SunlightApplicability = "applies";
  let boundaryFactsDecisionGrade = true;

  if (!zoningIsDecisionGrade) {
    applicability = "review";
    warnings.push(
      "대상 대지 용도지역이 원문 확인 또는 전문가 승인 상태가 아니어서 적용 판정은 예비값입니다."
    );
  }

  if (boundary.wideRoadDistrictExceptionConfirmed === true) {
    if (
      sunlightInputIsDecisionGrade(
        boundary.wideRoadDistrictExceptionStatus
      )
    ) {
      return northNotApplicable(
        ["시행령상 20m 도로·지정구역 예외 요건 전체 확인"],
        ruleIsDecisionGrade,
        "wide-road-district"
      );
    }
    applicability = "review";
    boundaryFactsDecisionGrade = false;
    warnings.push(
      "20m 도로·지정구역 예외가 입력됐지만 원문 확인 또는 전문가 승인 전에는 적용에서 제외했습니다."
    );
  }

  if (boundary.buildingAgreementExceptionConfirmed === true) {
    if (
      sunlightInputIsDecisionGrade(
        boundary.buildingAgreementExceptionStatus
      )
    ) {
      return northNotApplicable(
        ["건축협정구역 내 정북일조 예외 확인"],
        ruleIsDecisionGrade,
        "building-agreement"
      );
    }
    applicability = "review";
    boundaryFactsDecisionGrade = false;
    warnings.push(
      "건축협정 예외가 입력됐지만 원문 확인 또는 전문가 승인 전에는 적용에서 제외했습니다."
    );
  }

  const lowRiseCandidate =
    input.floorsAbove <= 2 && input.buildingHeightM <= 8;
  if (
    lowRiseCandidate &&
    boundary.lowRiseLocalExceptionConfirmed === true
  ) {
    if (ruleSet.north.lowRiseLocalException === "not-adopted") {
      warnings.push(
        "서울특별시 건축 조례 제35조에는 2층·8m 이하 자동 배제 규정이 없어 입력된 저층 예외를 적용하지 않았습니다."
      );
    } else if (
      sunlightInputIsDecisionGrade(
        boundary.lowRiseLocalExceptionStatus
      )
    ) {
      return northNotApplicable(
        ["해당 관할 조례의 2층·8m 이하 저층 예외 확인"],
        ruleIsDecisionGrade,
        "local-low-rise"
      );
    } else {
      applicability = "review";
      boundaryFactsDecisionGrade = false;
      warnings.push(
        "저층 예외가 입력됐지만 해당 관할 조례 원문 또는 전문가 승인 전에는 적용하지 않았습니다."
      );
    }
  } else if (
    lowRiseCandidate &&
    ruleSet.north.lowRiseLocalException === "unknown"
  ) {
    applicability = "review";
    boundaryFactsDecisionGrade = false;
    warnings.push(
      "2층·8m 이하 건축물의 배제 여부는 관할 건축 조례가 등록되지 않아 확인이 필요합니다."
    );
  }

  const adjacentZoning = boundary.adjacentZoning?.trim() ?? "";
  if (!adjacentZoning) {
    applicability = "review";
    boundaryFactsDecisionGrade = false;
    warnings.push(
      "정북방향 인접대지 용도지역이 없어 시행령상 적용 배제 여부를 확인하지 못했습니다."
    );
  } else if (!isNorthSunlightResidentialZone(adjacentZoning)) {
    if (sunlightInputIsDecisionGrade(boundary.adjacentZoningStatus)) {
      return northNotApplicable(
        [
          "정북방향 인접대지 " +
            adjacentZoning +
            " · 전용·일반주거지역 외 용도지역 확인",
        ],
        ruleIsDecisionGrade && zoningIsDecisionGrade,
        "adjacent-zoning"
      );
    }
    applicability = "review";
    boundaryFactsDecisionGrade = false;
    warnings.push(
      "정북방향 인접대지가 비주거 용도지역으로 입력됐지만 원문 확인 또는 전문가 승인 전에는 배제하지 않았습니다."
    );
  } else if (
    !sunlightInputIsDecisionGrade(boundary.adjacentZoningStatus)
  ) {
    applicability = "review";
    boundaryFactsDecisionGrade = false;
    warnings.push(
      "정북방향 인접대지 용도지역이 관측 또는 사용자 입력 상태라 예외 여부는 예비값입니다."
    );
  }

  if (!boundary.separatorType) {
    applicability = "review";
    boundaryFactsDecisionGrade = false;
    warnings.push(
      "북측 경계 사이 도로·공원·하천 등 공지 여부가 없어 기준 경계선을 확정하지 못했습니다."
    );
  }
  const relocated = separatorBoundaryOffset(
    boundary,
    "opposite-edge",
    warnings
  );
  if (!relocated.decisionGrade) boundaryFactsDecisionGrade = false;

  const statutoryDistanceM = requiredNorthSunlightSetback(
    input.buildingHeightM,
    ruleSet
  );
  const effectiveDistanceM = Math.max(
    0,
    statutoryDistanceM - relocated.offsetM
  );
  const requirementDecisionGrade =
    ruleIsDecisionGrade &&
    zoningIsDecisionGrade &&
    boundaryFactsDecisionGrade &&
    applicability === "applies";
  const actual = actualDistanceFields(
    boundary.actualBuildingSetbackM,
    boundary.actualBuildingSetbackStatus,
    effectiveDistanceM,
    requirementDecisionGrade,
    warnings
  );

  basis.push(
    "10m 이하 1.5m, 10m 초과 높이의 1/2 · 법정 " +
      round(statutoryDistanceM) +
      "m"
  );
  if (relocated.offsetM > 0) {
    basis.push(
      "공지 반대편 경계 기준 이동 " +
        relocated.offsetM +
        "m · 대지 내부 유효 이격 " +
        round(effectiveDistanceM) +
        "m"
    );
  }

  return {
    applicability,
    statutoryDistanceM: round(statutoryDistanceM),
    effectiveDistanceM: round(effectiveDistanceM),
    boundaryOffsetM: relocated.offsetM,
    boundaryBasis: relocated.basis,
    requirementDecisionGrade,
    ...actual,
    basis,
    warnings,
    geometryApplies: true,
    exception: applicability === "review" ? "unconfirmed" : "none",
  };
}

function assessDaylightBoundary(
  input: SunlightRegulationInput,
  resolved: ResolvedSunlightRuleSet
): SunlightDistanceAssessment {
  const ruleSet = resolved.ruleSet;
  const warnings: string[] = [];
  const basis: string[] = [];
  const legalUseIsDecisionGrade = sunlightInputIsDecisionGrade(
    input.legalUseStatus
  );
  const zoningIsDecisionGrade = sunlightInputIsDecisionGrade(
    input.zoningStatus
  );
  const zoning = input.zoning?.trim() ?? "";

  if (input.legalUse === "unknown-residential") {
    return unresolvedDistance(
      ["주거 용도는 있으나 건축법상 단독·다가구·다세대·연립·아파트 구분 미확인"],
      ["건축물 세부 용도를 확정해야 공동주택 채광방향 이격을 계산할 수 있습니다."]
    );
  }

  if (!COMMUNAL_HOUSING_USES.has(input.legalUse)) {
    return notApplicableDistance(
      ["계획 용도가 공동주택 채광방향 규정 대상이 아닙니다."],
      resolved.status === "source-backed" && legalUseIsDecisionGrade
    );
  }

  if (zoning && isGeneralOrCentralCommercialZone(zoning)) {
    if (!zoningIsDecisionGrade) {
      warnings.push(
        "용도지역이 관측 또는 사용자 입력 상태라 채광방향 규정 미적용 결론은 예비값입니다."
      );
    }
    return notApplicableDistance(
      [zoning + "은 공동주택 채광방향 이격 적용 제외 용도지역입니다."],
      resolved.status === "source-backed" &&
        legalUseIsDecisionGrade &&
        zoningIsDecisionGrade,
      warnings
    );
  }

  let applicability: SunlightApplicability = "applies";
  if (!zoning || !zoningIsDecisionGrade || !legalUseIsDecisionGrade) {
    applicability = "review";
  }
  if (!zoning) {
    warnings.push(
      "용도지역이 없어 일반·중심상업지역 적용 제외 및 거리 비율을 확정하지 못했습니다."
    );
  } else if (!zoningIsDecisionGrade) {
    warnings.push(
      "용도지역이 원문 확인 또는 전문가 승인 상태가 아니어서 채광방향 거리는 예비값입니다."
    );
  }
  if (!legalUseIsDecisionGrade) {
    warnings.push(
      "건축물 세부 용도가 원문 확인 또는 전문가 승인 상태가 아니어서 채광방향 적용 판정은 예비값입니다."
    );
  }

  let statutoryDistanceM: number;
  if (
    ruleSet.jurisdictionCode === "KR-11" &&
    input.legalUse === "multi-unit-house" &&
    ruleSet.daylight.seoulMultiUnitBoundaryM != null
  ) {
    statutoryDistanceM = ruleSet.daylight.seoulMultiUnitBoundaryM;
    basis.push("서울특별시 다세대주택 채광창 벽면 · 인접대지경계선 1m");
  } else {
    const ratio =
      zoning && isReducedDaylightZone(zoning)
        ? ruleSet.daylight.reducedBoundaryHeightRatio
        : ruleSet.daylight.boundaryHeightRatio;
    statutoryDistanceM = input.buildingHeightM * ratio;
    basis.push(
      "채광창 벽면 높이 " +
        round(input.buildingHeightM, 1).toFixed(1) +
        "m × " +
        ratio
    );
  }

  const boundary = input.northBoundary ?? {};
  if (!boundary.separatorType) {
    applicability = "review";
    warnings.push(
      "채광방향 경계 사이 공지 여부가 없어 기준 경계선을 확정하지 못했습니다."
    );
  }
  const relocated = separatorBoundaryOffset(boundary, "centerline", warnings);
  const effectiveDistanceM = Math.max(
    0,
    statutoryDistanceM - relocated.offsetM
  );
  const requirementDecisionGrade =
    resolved.status === "source-backed" &&
    zoningIsDecisionGrade &&
    legalUseIsDecisionGrade &&
    relocated.decisionGrade &&
    applicability === "applies";
  const actual = actualDistanceFields(
    input.daylight?.actualBoundaryDistanceM,
    input.daylight?.actualBoundaryDistanceStatus,
    effectiveDistanceM,
    requirementDecisionGrade,
    warnings
  );

  if (relocated.offsetM > 0) {
    basis.push(
      "공지 중심선 기준 이동 " +
        relocated.offsetM +
        "m · 대지 내부 유효 이격 " +
        round(effectiveDistanceM) +
        "m"
    );
  }

  return {
    applicability,
    statutoryDistanceM: round(statutoryDistanceM),
    effectiveDistanceM: round(effectiveDistanceM),
    boundaryOffsetM: relocated.offsetM,
    boundaryBasis: relocated.basis,
    requirementDecisionGrade,
    ...actual,
    basis,
    warnings,
  };
}

function sameLotRequiredDistance(
  relation: SameLotFacingRelation,
  input: SunlightRegulationInput,
  ruleSet: SunlightRuleSet
): { distanceM: number | null; basis: string; needsFacingHeight: boolean } {
  const buildingHeightM = Math.max(0, input.buildingHeightM);
  const facingHeightM = finiteNonNegative(
    input.daylight?.facingBuildingHeightM
  );
  const urban = input.legalUse === "urban-housing";

  switch (relation) {
    case "opening-to-opening": {
      const ratio = urban
        ? ruleSet.daylight.urbanSameLotHeightRatio
        : ruleSet.daylight.sameLotHeightRatio;
      return {
        distanceM: buildingHeightM * ratio,
        basis: "마주보는 채광창 벽면 · 높은 건물 높이 × " + ratio,
        needsFacingHeight: false,
      };
    }
    case "high-opening-to-low": {
      if (facingHeightM == null) {
        return {
          distanceM: null,
          basis: "고층 채광창과 저층 건물 관계 · 맞은편 건물 높이 필요",
          needsFacingHeight: true,
        };
      }
      const ratio = urban
        ? ruleSet.daylight.urbanSameLotHeightRatio
        : ruleSet.daylight.sameLotHeightRatio;
      return {
        distanceM: Math.max(10, facingHeightM * ratio),
        basis:
          "고층 채광창과 저층 건물 관계 · max(10m, 저층 높이 × " +
          ratio +
          ")",
        needsFacingHeight: true,
      };
    }
    case "accessory-facing":
      return {
        distanceM: facingHeightM,
        basis: "부속건축물과 마주보는 관계 · 부속건축물 높이 이상",
        needsFacingHeight: true,
      };
    case "blank-wall":
      return {
        distanceM: ruleSet.daylight.blankWallDistanceM,
        basis:
          "채광창 벽면과 맞은편 측벽·창 없는 벽면 · " +
          ruleSet.daylight.blankWallDistanceM +
          "m",
        needsFacingHeight: false,
      };
    case "side-to-side":
      return {
        distanceM: ruleSet.daylight.sideToSideDistanceM,
        basis:
          "측벽과 측벽이 마주보는 관계 · " +
          ruleSet.daylight.sideToSideDistanceM +
          "m",
        needsFacingHeight: false,
      };
    case "urban-complex":
      return {
        distanceM: Math.max(
          ruleSet.daylight.urbanSameLotMinimumM,
          buildingHeightM * ruleSet.daylight.urbanSameLotHeightRatio
        ),
        basis:
          "서울 단지형 도시형생활주택 · max(" +
          ruleSet.daylight.urbanSameLotMinimumM +
          "m, 높이 × " +
          ruleSet.daylight.urbanSameLotHeightRatio +
          ")",
        needsFacingHeight: false,
      };
  }
}

function assessSameLotDistance(
  input: SunlightRegulationInput,
  resolved: ResolvedSunlightRuleSet
): SunlightDistanceAssessment {
  const daylight = input.daylight ?? {};
  const count = finiteNonNegative(daylight.sameLotBuildingCount);
  const countDecisionGrade = sunlightInputIsDecisionGrade(
    daylight.sameLotBuildingCountStatus
  );
  const legalUseDecisionGrade = sunlightInputIsDecisionGrade(
    input.legalUseStatus
  );

  if (input.legalUse === "unknown-residential") {
    return unresolvedDistance(
      ["공동주택 해당 여부 미확인"],
      ["건축물 세부 용도를 확정해야 동일 대지 내 동간거리를 판정할 수 있습니다."]
    );
  }
  if (!COMMUNAL_HOUSING_USES.has(input.legalUse)) {
    return notApplicableDistance(
      ["계획 용도가 공동주택 동간거리 규정 대상이 아닙니다."],
      resolved.status === "source-backed" && legalUseDecisionGrade
    );
  }
  if (count == null) {
    return unresolvedDistance(
      ["동일 대지 내 건축물 수 미확인"],
      ["동일 대지에 둘 이상의 공동주택 동이 있는지 확인해야 합니다."]
    );
  }
  if (count <= 1) {
    const warnings = countDecisionGrade
      ? []
      : ["건축물 수가 사용자 입력 또는 관측 상태라 동간거리 미적용 결론은 예비값입니다."];
    return notApplicableDistance(
      ["동일 대지 내 계획 건축물 1동 · 동간거리 미적용"],
      resolved.status === "source-backed" &&
        legalUseDecisionGrade &&
        countDecisionGrade,
      warnings
    );
  }

  const relation = daylight.sameLotRelation;
  if (!relation) {
    return unresolvedDistance(
      ["동일 대지 내 공동주택 " + Math.floor(count) + "동"],
      ["마주보는 벽면의 창·측벽·고저 관계를 입력해야 동간거리를 계산할 수 있습니다."]
    );
  }

  const warnings: string[] = [];
  const formula = sameLotRequiredDistance(relation, input, resolved.ruleSet);
  if (formula.distanceM == null) {
    return unresolvedDistance([formula.basis], [
      "관계식에 필요한 맞은편 건물 높이가 없습니다.",
    ]);
  }
  const facingHeightDecisionGrade =
    !formula.needsFacingHeight ||
    sunlightInputIsDecisionGrade(daylight.facingBuildingHeightStatus);
  const requirementDecisionGrade =
    resolved.status === "source-backed" &&
    legalUseDecisionGrade &&
    countDecisionGrade &&
    sunlightInputIsDecisionGrade(daylight.sameLotRelationStatus) &&
    facingHeightDecisionGrade;
  if (!requirementDecisionGrade) {
    warnings.push(
      "동 수·벽면 관계·맞은편 높이 중 일부가 원문 확인 또는 전문가 승인 전이라 동간거리는 예비값입니다."
    );
  }
  const actual = actualDistanceFields(
    daylight.actualSameLotDistanceM,
    daylight.actualSameLotDistanceStatus,
    formula.distanceM,
    requirementDecisionGrade,
    warnings
  );

  return {
    applicability: requirementDecisionGrade ? "applies" : "review",
    statutoryDistanceM: round(formula.distanceM),
    effectiveDistanceM: round(formula.distanceM),
    boundaryOffsetM: 0,
    boundaryBasis: "parcel-boundary",
    requirementDecisionGrade,
    ...actual,
    basis: [formula.basis],
    warnings,
  };
}

function assessDaylight(
  input: SunlightRegulationInput,
  resolved: ResolvedSunlightRuleSet
): DaylightAssessment {
  const boundary = assessDaylightBoundary(input, resolved);
  const sameLot = assessSameLotDistance(input, resolved);
  const warnings = [...new Set([...boundary.warnings, ...sameLot.warnings])];
  const basis = [...new Set([...boundary.basis, ...sameLot.basis])];
  const applicability =
    boundary.applicability === "applies" ||
    sameLot.applicability === "applies"
      ? "applies"
      : boundary.applicability === "review" ||
          sameLot.applicability === "review"
        ? "review"
        : "not-applicable";

  return {
    applicability,
    boundary,
    sameLot,
    decisionGrade:
      boundary.requirementDecisionGrade &&
      sameLot.requirementDecisionGrade,
    basis,
    warnings,
  };
}

export function evaluateSunlightRegulation(
  input: SunlightRegulationInput
): SunlightRegulationResult {
  const resolved = resolveSunlightRuleSet(input.context);
  const north = assessNorthSunlight(input, resolved);
  const daylight = assessDaylight(input, resolved);
  const warnings = [
    ...new Set([
      ...resolved.warnings,
      ...north.warnings,
      ...daylight.warnings,
    ]),
  ];

  return {
    rule: ruleSnapshot(resolved),
    north,
    daylight,
    decisionGrade:
      north.requirementDecisionGrade && daylight.decisionGrade,
    warnings,
  };
}

export function toSunlightGeometryProfile(
  result: SunlightRegulationResult
): SunlightGeometryProfile {
  return {
    engineVersion: SUNLIGHT_RULE_ENGINE_VERSION,
    ruleId: result.rule.id,
    applies: result.north.geometryApplies,
    applicability: result.north.applicability,
    thresholdHeightM: result.rule.north.thresholdHeightM,
    lowHeightSetbackM: result.rule.north.lowHeightSetbackM,
    highHeightRatio: result.rule.north.highHeightRatio,
    boundaryOffsetM: result.north.boundaryOffsetM,
    decisionGrade: result.north.requirementDecisionGrade,
    warnings: result.north.warnings,
  };
}

export function requiredSetbackFromGeometryProfile(
  heightM: number,
  profile: SunlightGeometryProfile
): number {
  if (!profile.applies) return 0;
  const height = Math.max(0, Number.isFinite(heightM) ? heightM : 0);
  const statutory =
    height <= profile.thresholdHeightM
      ? profile.lowHeightSetbackM
      : height * profile.highHeightRatio;
  return Math.max(0, statutory - profile.boundaryOffsetM);
}
