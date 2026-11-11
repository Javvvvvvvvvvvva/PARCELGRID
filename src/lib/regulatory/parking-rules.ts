export const PARKING_RULE_ENGINE_VERSION = "parking-rules-2026.2-unit-mix" as const;

export type ParkingRuleEvidenceStatus =
  | "source-backed"
  | "reference-only";

export type ParkingExclusiveAreaStatus =
  | "user-entered"
  | "source-backed"
  | "expert-approved";

export type ParkingUse =
  | "single-house"
  | "multi-family"
  | "urban-housing"
  | "officetel"
  | "coliving"
  | "retail"
  | "office"
  | "other";

export interface ParkingRuleSource {
  id: string;
  sourceName: string;
  sourceRef: string;
  sourceUrl: string;
  effectiveFrom: string;
  promulgationNo: string;
  verifiedAt: string;
}

export interface ParkingRuleSet {
  id: string;
  engineVersion: typeof PARKING_RULE_ENGINE_VERSION;
  jurisdictionCode: "KR" | "KR-11";
  jurisdictionName: string;
  effectiveFrom: string;
  sources: ParkingRuleSource[];
  ratios: {
    retailSqmPerCar: number;
    officeSqmPerCar: number;
    otherSqmPerCar: number;
    housingAtMost85SqmPerCar: number;
    housingOver85SqmPerCar: number;
  };
  housingMinimum: {
    atMost30CarsPerUnit: number;
    atMost60CarsPerUnit: number;
    over60CarsPerUnit: number;
  };
}

export interface ParkingRuleContext {
  jurisdictionCode?: string;
  address?: string;
  /** 적용 기준일 YYYY-MM-DD. 생략하면 계산 시점의 현행 규칙을 사용한다. */
  asOf?: string;
}

export interface ResolvedParkingRuleSet {
  ruleSet: ParkingRuleSet;
  status: ParkingRuleEvidenceStatus;
  asOf: string;
  warnings: string[];
}

export interface ParkingDwellingGroup {
  unitCount: number;
  exclusiveAreaPerUnitSqm: number;
  /** 기존 구역 합계를 균등 분할한 경우 실제 평형 분포로 확정하지 않는다. */
  estimated?: boolean;
}

export interface ParkingUseInput {
  use: ParkingUse;
  /** 해당 용도의 공용면적을 포함하고 주차장 면적은 제외한 시설면적. */
  facilityAreaSqm: number;
  unitCount?: number;
  /** 주거 전용면적 합계. 주거 법정대수의 면적식과 세대당 구간 판정에 사용한다. */
  exclusiveAreaSqm?: number;
  exclusiveAreaStatus?: ParkingExclusiveAreaStatus;
  /** 같은 건물의 세대별 또는 동일 평형별 구성. 면적은 세대당 전용면적이다. */
  dwellingGroups?: ParkingDwellingGroup[];
}

export interface ParkingRequirementInput {
  context?: ParkingRuleContext;
  uses: ParkingUseInput[];
}

export interface ParkingRequirementComponent {
  use: ParkingUse;
  facilityAreaSqm: number;
  exclusiveAreaSqm?: number;
  exclusiveAreaStatus?: ParkingExclusiveAreaStatus | "estimated";
  unitCount: number;
  rawCars: number;
  requiredCars: number;
  denominatorSqmPerCar?: number;
  areaRuleCars?: number;
  unitMinimumCars?: number;
  dwellingGroups?: ParkingDwellingGroup[];
  distributionStatus?: "per-dwelling" | "equal-area-assumption" | "invalid";
  estimated: boolean;
  basis: string;
}

export interface ParkingRuleSnapshot {
  engineVersion: typeof PARKING_RULE_ENGINE_VERSION | "parking-rules-2026.1";
  id: string;
  jurisdictionCode: ParkingRuleSet["jurisdictionCode"];
  jurisdictionName: string;
  effectiveFrom: string;
  asOf: string;
  status: ParkingRuleEvidenceStatus;
  sources: ParkingRuleSource[];
}

export interface ParkingRequirementResult {
  requiredCars: number;
  components: ParkingRequirementComponent[];
  estimated: boolean;
  decisionGrade: boolean;
  exemptPossible: boolean;
  basis: string[];
  references: string[];
  warnings: string[];
  rule: ParkingRuleSnapshot;
}

const NATIONAL_DECREE_SOURCE: ParkingRuleSource = {
  id: "parking-act-enforcement-decree-annex-1-2026-08-28",
  sourceName: "주차장법 시행령",
  sourceRef: "제6조제1항 및 별표 1",
  sourceUrl:
    "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=288729",
  effectiveFrom: "2026-08-28",
  promulgationNo: "대통령령 제36623호",
  verifiedAt: "2026-09-08",
};

const HOUSING_STANDARD_SOURCE: ParkingRuleSource = {
  id: "housing-construction-standards-article-27-2026-06-30",
  sourceName: "주택건설기준 등에 관한 규정",
  sourceRef: "제27조제1항",
  sourceUrl:
    "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1028323963",
  effectiveFrom: "2026-06-30",
  promulgationNo: "대통령령 제36475호",
  verifiedAt: "2026-09-08",
};

const SEOUL_ORDINANCE_SOURCE_2026_07_13: ParkingRuleSource = {
  id: "seoul-parking-ordinance-annex-2-2026-07-13",
  sourceName: "서울특별시 주차장 설치 및 관리 조례",
  sourceRef: "제20조제1항 및 별표 2 (별표 최종개정 2025. 9. 29.)",
  sourceUrl:
    "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2147707",
  effectiveFrom: "2026-07-13",
  promulgationNo: "서울특별시조례 제10142호",
  verifiedAt: "2026-09-08",
};

const SEOUL_ORDINANCE_SOURCE_2026_10_01: ParkingRuleSource = {
  id: "seoul-parking-ordinance-annex-2-2026-10-01",
  sourceName: "서울특별시 주차장 설치 및 관리 조례",
  sourceRef: "제20조제1항 및 별표 2",
  sourceUrl:
    "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2171833",
  effectiveFrom: "2026-10-01",
  promulgationNo: "서울특별시조례 제10187호",
  verifiedAt: "2026-10-17",
};

const NATIONAL_REFERENCE_RULE_SET: ParkingRuleSet = {
  id: "parking-kr-national-2026-08-28",
  engineVersion: PARKING_RULE_ENGINE_VERSION,
  jurisdictionCode: "KR",
  jurisdictionName: "대한민국 국가 기준",
  effectiveFrom: "2026-08-28",
  sources: [NATIONAL_DECREE_SOURCE, HOUSING_STANDARD_SOURCE],
  ratios: {
    retailSqmPerCar: 200,
    officeSqmPerCar: 150,
    otherSqmPerCar: 300,
    // 관할 지역 등급을 모를 때 특별시의 가장 엄격한 표 값을 참고값으로 사용한다.
    housingAtMost85SqmPerCar: 75,
    housingOver85SqmPerCar: 65,
  },
  housingMinimum: {
    atMost30CarsPerUnit: 0.7,
    atMost60CarsPerUnit: 0.7,
    over60CarsPerUnit: 1,
  },
};

const SEOUL_RULE_SET_2026_07_13: ParkingRuleSet = {
  id: "parking-kr-seoul-2026-07-13",
  engineVersion: PARKING_RULE_ENGINE_VERSION,
  jurisdictionCode: "KR-11",
  jurisdictionName: "서울특별시",
  effectiveFrom: "2026-07-13",
  sources: [
    SEOUL_ORDINANCE_SOURCE_2026_07_13,
    NATIONAL_DECREE_SOURCE,
    HOUSING_STANDARD_SOURCE,
  ],
  ratios: {
    retailSqmPerCar: 134,
    officeSqmPerCar: 100,
    otherSqmPerCar: 200,
    housingAtMost85SqmPerCar: 75,
    housingOver85SqmPerCar: 65,
  },
  housingMinimum: {
    atMost30CarsPerUnit: 0.5,
    atMost60CarsPerUnit: 0.8,
    over60CarsPerUnit: 1,
  },
};

const SEOUL_RULE_SET_2026_10_01: ParkingRuleSet = {
  ...SEOUL_RULE_SET_2026_07_13,
  id: "parking-kr-seoul-2026-10-01",
  effectiveFrom: "2026-10-01",
  sources: [
    SEOUL_ORDINANCE_SOURCE_2026_10_01,
    NATIONAL_DECREE_SOURCE,
    HOUSING_STANDARD_SOURCE,
  ],
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value: string | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return todayIsoDate();
}

function inferredJurisdiction(context: ParkingRuleContext): "KR" | "KR-11" {
  const explicit = context.jurisdictionCode?.trim().toUpperCase();
  if (explicit === "KR-11" || explicit === "SEOUL") return "KR-11";

  const address = context.address?.replace(/\s/g, "") ?? "";
  if (address.startsWith("서울특별시") || address.startsWith("서울")) {
    return "KR-11";
  }
  return "KR";
}

export function resolveParkingRuleSet(
  context: ParkingRuleContext = {}
): ResolvedParkingRuleSet {
  const asOf = normalizeDate(context.asOf);
  const jurisdiction = inferredJurisdiction(context);
  const ruleSet = jurisdiction === "KR-11"
    ? asOf >= SEOUL_RULE_SET_2026_10_01.effectiveFrom
      ? SEOUL_RULE_SET_2026_10_01
      : SEOUL_RULE_SET_2026_07_13
    : NATIONAL_REFERENCE_RULE_SET;
  const warnings: string[] = [];

  let status: ParkingRuleEvidenceStatus =
    jurisdiction === "KR-11" ? "source-backed" : "reference-only";

  if (jurisdiction !== "KR-11") {
    warnings.push(
      "관할 지방자치단체의 현행 주차 조례가 등록되지 않아 국가 기준 참고값만 계산했습니다."
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
      `${asOf}에 적용되는 주차 규칙 이력이 완전하지 않아 ${nextRegisteredEffectiveDate} 이후 출처를 포함한 현행 규칙을 참고값으로 사용했습니다.`
    );
  }

  return { ruleSet, status, asOf, warnings };
}

function finiteNonNegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** 별표 비고의 0.5 반올림과 전체 1대 미만 0대 규칙. */
function roundGeneralFacilityCars(rawCars: number): number {
  if (rawCars < 1 - 1e-9) return 0;
  const whole = Math.floor(rawCars + 1e-9);
  return rawCars - whole >= 0.5 - 1e-9 ? whole + 1 : whole;
}

function detachedHouseComponent(
  input: ParkingUseInput
): ParkingRequirementComponent {
  const area = finiteNonNegative(input.facilityAreaSqm);
  let rawCars = 0;
  let requiredCars = 0;
  let basis = `단독주택 시설면적 ${area.toFixed(1)}㎡ · 50㎡ 이하`;

  if (area > 50 && area <= 150) {
    rawCars = 1;
    requiredCars = 1;
    basis = `단독주택 시설면적 ${area.toFixed(1)}㎡ · 50㎡ 초과 150㎡ 이하 → 1대`;
  } else if (area > 150) {
    rawCars = 1 + (area - 150) / 100;
    requiredCars = roundGeneralFacilityCars(rawCars);
    basis =
      `단독주택 1대 + 150㎡ 초과분 ${(area - 150).toFixed(1)}㎡ ÷ 100㎡/대` +
      ` → ${requiredCars}대`;
  }

  return {
    use: input.use,
    facilityAreaSqm: area,
    unitCount: Math.max(0, Math.floor(input.unitCount ?? 1)),
    rawCars: round(rawCars),
    requiredCars,
    estimated: false,
    basis,
  };
}

function housingComponent(
  input: ParkingUseInput,
  ruleSet: ParkingRuleSet,
  warnings: string[]
): ParkingRequirementComponent {
  const facilityAreaSqm = finiteNonNegative(input.facilityAreaSqm);
  const unitCount = Math.max(0, Math.floor(input.unitCount ?? 0));
  const suppliedGroups = input.dwellingGroups;
  const groupArea = suppliedGroups?.reduce(
    (sum, group) => sum + group.unitCount * group.exclusiveAreaPerUnitSqm, 0
  ) ?? 0;
  const validGroups = suppliedGroups != null && suppliedGroups.length > 0 &&
    suppliedGroups.every((group) => Number.isInteger(group.unitCount) && group.unitCount > 0 &&
      Number.isFinite(group.exclusiveAreaPerUnitSqm) && group.exclusiveAreaPerUnitSqm > 0) &&
    suppliedGroups.reduce((sum, group) => sum + group.unitCount, 0) === unitCount &&
    groupArea <= facilityAreaSqm + 0.01 &&
    (input.exclusiveAreaSqm == null ||
      (Number.isFinite(input.exclusiveAreaSqm) && Math.abs(groupArea - input.exclusiveAreaSqm) <= 0.01));
  const hasExplicitExclusiveArea =
    (validGroups || (Number.isFinite(input.exclusiveAreaSqm) && Number(input.exclusiveAreaSqm) > 0)) &&
    input.exclusiveAreaStatus != null;
  const exclusiveAreaSqm = validGroups
    ? groupArea
    : hasExplicitExclusiveArea ? finiteNonNegative(input.exclusiveAreaSqm) : facilityAreaSqm * 0.75;
  const averageExclusiveSqm = unitCount > 0 ? exclusiveAreaSqm / unitCount : 0;
  const invalidTotal = input.exclusiveAreaSqm != null &&
    (!Number.isFinite(input.exclusiveAreaSqm) || input.exclusiveAreaSqm <= 0 || input.exclusiveAreaSqm > facilityAreaSqm + 0.01);
  const invalidCount = input.unitCount != null && (!Number.isInteger(input.unitCount) || input.unitCount < 0);
  const distributionStatus = (suppliedGroups != null && !validGroups) || invalidTotal || invalidCount
    ? "invalid"
    : (validGroups ? !suppliedGroups.some((group) => group.estimated) : unitCount === 1)
      ? "per-dwelling" : "equal-area-assumption";
  const groups: ParkingDwellingGroup[] = validGroups
    ? suppliedGroups
    : [{ unitCount, exclusiveAreaPerUnitSqm: averageExclusiveSqm, estimated: unitCount > 1 }];
  const estimated = !hasExplicitExclusiveArea || input.use === "coliving" || distributionStatus !== "per-dwelling";

  if (distributionStatus === "invalid") {
    warnings.push("세대별 전용면적 구성과 세대수·전용합계·시설면적이 일치하지 않아 주차 산정을 확정할 수 없습니다.");
  } else if (distributionStatus === "equal-area-assumption") {
    warnings.push("세대별 전용면적 분포가 없어 구역 내 균등 평형으로 추정했습니다. 혼합 평형은 세대별 구역으로 입력해야 합니다.");
  }

  if (!hasExplicitExclusiveArea) {
    warnings.push(
      "주거 전용면적이 없어 시설면적의 75%를 사용한 예비값입니다."
    );
  }
  if (unitCount === 0 && facilityAreaSqm > 0) {
    warnings.push("주거 세대수가 없어 세대당 최소 주차기준을 확정할 수 없습니다.");
  }
  if (input.use === "coliving") {
    warnings.push(
      "공유주거는 인허가상 건축물 용도가 확정되지 않아 다가구·공동주택 기준 참고값으로 계산했습니다."
    );
  }

  if (input.use === "urban-housing") {
    const rawCars = groups.reduce((sum, group) => sum + group.unitCount *
      (group.exclusiveAreaPerUnitSqm < 30 ? 0.5 : group.exclusiveAreaPerUnitSqm <= 60 ? 0.6 : 1), 0);
    const requiredCars = Math.ceil(rawCars - 1e-9);
    return {
      use: input.use,
      facilityAreaSqm,
      exclusiveAreaSqm: round(exclusiveAreaSqm),
      exclusiveAreaStatus: hasExplicitExclusiveArea
        ? input.exclusiveAreaStatus
        : "estimated",
      unitCount,
      rawCars: round(rawCars),
      requiredCars,
      unitMinimumCars: round(rawCars),
      dwellingGroups: groups.map((group) => ({ ...group })),
      distributionStatus,
      estimated,
      basis:
        `도시형 생활주택 세대별 면적 구간 합산 ${round(rawCars)}대` +
        ` → 건물 합계 올림 ${requiredCars}대`,
    };
  }

  const denominatorFor = (area: number) => area <= 85
    ? ruleSet.ratios.housingAtMost85SqmPerCar : ruleSet.ratios.housingOver85SqmPerCar;
  const denominators = new Set(groups.map((group) => denominatorFor(group.exclusiveAreaPerUnitSqm)));
  const denominatorSqmPerCar = denominators.size === 1 ? [...denominators][0] : undefined;
  const areaRuleCars = unitCount > 0
    ? groups.reduce((sum, group) => sum + group.unitCount * group.exclusiveAreaPerUnitSqm / denominatorFor(group.exclusiveAreaPerUnitSqm), 0)
    : exclusiveAreaSqm / denominatorFor(0);
  const unitMinimumCars = groups.reduce((sum, group) => sum + group.unitCount *
    (group.exclusiveAreaPerUnitSqm <= 30 ? ruleSet.housingMinimum.atMost30CarsPerUnit
      : group.exclusiveAreaPerUnitSqm <= 60 ? ruleSet.housingMinimum.atMost60CarsPerUnit
        : ruleSet.housingMinimum.over60CarsPerUnit), 0);
  const rawCars = Math.max(areaRuleCars, unitMinimumCars);
  const requiredCars = Math.ceil(rawCars - 1e-9);

  return {
    use: input.use,
    facilityAreaSqm,
    exclusiveAreaSqm: round(exclusiveAreaSqm),
    exclusiveAreaStatus: hasExplicitExclusiveArea
      ? input.exclusiveAreaStatus
      : "estimated",
    unitCount,
    rawCars: round(rawCars),
    requiredCars,
    denominatorSqmPerCar,
    areaRuleCars: round(areaRuleCars),
    unitMinimumCars: round(unitMinimumCars),
    dwellingGroups: groups.map((group) => ({ ...group })),
    distributionStatus,
    estimated,
    basis:
      `주거 ${groups.map((group) => `${group.exclusiveAreaPerUnitSqm.toFixed(2)}㎡ × ${group.unitCount}세대`).join(" + ")}` +
      ` · 면적식 ${round(areaRuleCars)}대와 세대별 최소 ${round(unitMinimumCars)}대 중 큰 값` +
      ` → 건물 합계 올림 ${requiredCars}대`,
  };
}

function generalFacilityComponent(
  input: ParkingUseInput,
  ruleSet: ParkingRuleSet
): ParkingRequirementComponent {
  const facilityAreaSqm = finiteNonNegative(input.facilityAreaSqm);
  const denominatorSqmPerCar =
    input.use === "retail"
      ? ruleSet.ratios.retailSqmPerCar
      : input.use === "office"
        ? ruleSet.ratios.officeSqmPerCar
        : ruleSet.ratios.otherSqmPerCar;
  const rawCars = facilityAreaSqm / denominatorSqmPerCar;
  const label =
    input.use === "retail"
      ? "근린생활시설"
      : input.use === "office"
        ? "업무시설"
        : "기타 건축물";

  return {
    use: input.use,
    facilityAreaSqm,
    unitCount: Math.max(0, Math.floor(input.unitCount ?? 0)),
    rawCars: round(rawCars),
    requiredCars: roundGeneralFacilityCars(rawCars),
    denominatorSqmPerCar,
    estimated: false,
    basis: `${label} ${facilityAreaSqm.toFixed(1)}㎡ ÷ ${denominatorSqmPerCar}㎡/대`,
  };
}

export function calculateParkingRequirement(
  input: ParkingRequirementInput
): ParkingRequirementResult {
  const resolved = resolveParkingRuleSet(input.context);
  const warnings = [...resolved.warnings];
  const components: ParkingRequirementComponent[] = [];

  for (const use of input.uses) {
    if (!(finiteNonNegative(use.facilityAreaSqm) > 0)) continue;
    if (use.use === "single-house") {
      components.push(detachedHouseComponent(use));
    } else if (
      use.use === "multi-family" ||
      use.use === "urban-housing" ||
      use.use === "officetel" ||
      use.use === "coliving"
    ) {
      components.push(housingComponent(use, resolved.ruleSet, warnings));
    } else {
      components.push(generalFacilityComponent(use, resolved.ruleSet));
    }
  }

  const housingCars = components
    .filter((component) =>
      ["multi-family", "urban-housing", "officetel", "coliving"].includes(
        component.use
      )
    )
    .reduce((sum, component) => sum + component.requiredCars, 0);
  const detachedCars = components
    .filter((component) => component.use === "single-house")
    .reduce((sum, component) => sum + component.requiredCars, 0);
  const generalRawCars = components
    .filter((component) =>
      ["retail", "office", "other"].includes(component.use)
    )
    .reduce((sum, component) => sum + component.rawCars, 0);
  const generalCars = roundGeneralFacilityCars(generalRawCars);

  if (
    components.some((component) => component.use === "single-house") &&
    components.length > 1
  ) {
    warnings.push(
      "단독주택과 다른 용도의 복합 산정은 별표 비고의 소수점 합산 특례를 별도 확인해야 합니다."
    );
  }

  const requiredCars = housingCars + detachedCars + generalCars;
  const estimated = components.some((component) => component.estimated);
  const hasUserEnteredExclusiveArea = components.some(
    (component) => component.exclusiveAreaStatus === "user-entered"
  );
  if (hasUserEnteredExclusiveArea) {
    warnings.push(
      "주거 전용면적이 사용자 입력 상태라 도면 근거 또는 전문가 승인 전에는 예비값입니다."
    );
  }
  const hasUnresolvedInput = warnings.some(
    (warning) =>
      warning.includes("세대수가 없어") ||
      warning.includes("공유주거는") ||
      warning.includes("복합 산정")
  );
  const decisionGrade =
    resolved.status === "source-backed" &&
    components.length > 0 &&
    !estimated &&
    !hasUserEnteredExclusiveArea &&
    !hasUnresolvedInput;
  const references = resolved.ruleSet.sources.map(
    (source) =>
      `${source.sourceName} ${source.sourceRef} · ${source.promulgationNo} · 시행 ${source.effectiveFrom}`
  );
  const basis = [
    ...components.map((component) => component.basis),
    ...(generalRawCars > 0
      ? [
          `비주거 용도 합산 ${round(generalRawCars)}대에 별표 소수점 규칙 적용 → ${generalCars}대`,
        ]
      : []),
  ];

  return {
    requiredCars,
    components,
    estimated,
    decisionGrade,
    exemptPossible: requiredCars === 0 && !decisionGrade,
    basis,
    references,
    warnings: [...new Set(warnings)],
    rule: {
      engineVersion: PARKING_RULE_ENGINE_VERSION,
      id: resolved.ruleSet.id,
      jurisdictionCode: resolved.ruleSet.jurisdictionCode,
      jurisdictionName: resolved.ruleSet.jurisdictionName,
      effectiveFrom: resolved.ruleSet.effectiveFrom,
      asOf: resolved.asOf,
      status: resolved.status,
      sources: resolved.ruleSet.sources,
    },
  };
}

export function buildingTypeToParkingUse(
  type: ParkingUse | "mixed"
): ParkingUse {
  if (type === "mixed") return "other";
  return type;
}
