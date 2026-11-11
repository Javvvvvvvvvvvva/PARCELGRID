/**
 * Auditable mapping between PARCELGRID product names and statutory building
 * uses. Product names are commercial concepts; they must never be treated as
 * legal classifications without an exact Appendix 1 code.
 */

export const BUILDING_USE_CATALOG_VERSION =
  "building-use-catalog-2026.1" as const;

export const BUILDING_USE_CATALOG_AS_OF = "2026-09-09" as const;

export type BuildingProductUse =
  | "officetel"
  | "urban-housing"
  | "retail"
  | "coliving"
  | "office"
  | "single-house"
  | "multi-family";

export type BuildingUseCode =
  | "BA-A1-1-A"
  | "BA-A1-1-B"
  | "BA-A1-1-C"
  | "BA-A1-2-A"
  | "BA-A1-2-B"
  | "BA-A1-2-C"
  | "BA-A1-2-D-2"
  | "BA-A1-3-A"
  | "BA-A1-4-GEO"
  | "BA-A1-14-B-1"
  | "BA-A1-14-B-2";

export type HousingSubtypeCode =
  | "HA-ED-A10-1-1"
  | "HA-ED-A10-1-2"
  | "HA-ED-A10-1-3";

export interface RegulatorySourceReference {
  title: string;
  url: string;
  level: "national" | "local";
  effectiveFrom: string;
  checkedAt: string;
}

export interface BuildingUseQuantitativeLimits {
  minResidentialFloors?: number;
  maxResidentialFloors?: number;
  minUseAreaSqm?: number;
  minUseAreaExclusiveSqm?: number;
  maxUseAreaSqm?: number;
  maxUseAreaExclusiveSqm?: number;
  maxHouseholds?: number;
  minRooms?: number;
}

export interface BuildingUseCatalogEntry {
  code: BuildingUseCode;
  label: string;
  category: string;
  appendixClause: string;
  compatibleProducts: BuildingProductUse[];
  limits: BuildingUseQuantitativeLimits;
  notes: string[];
}

export interface BuildingUseFacts {
  residentialFloors?: number;
  useAreaSqm?: number;
  householdCount?: number;
  roomCount?: number;
}

export type BuildingUseResolutionStatus =
  | "exact"
  | "requires-subtype"
  | "incompatible";

export interface BuildingUseResolution {
  modelVersion: typeof BUILDING_USE_CATALOG_VERSION;
  productUse: BuildingProductUse;
  status: BuildingUseResolutionStatus;
  requestedCode?: BuildingUseCode;
  primaryUse?: BuildingUseCatalogEntry;
  housingSubtypeCode?: HousingSubtypeCode;
  basis: string;
  alternatives: BuildingUseCode[];
  sources: RegulatorySourceReference[];
}

export type BuildingUseConditionStatus = "pass" | "missing-input" | "fail";

export interface BuildingUseConditionAssessment {
  status: BuildingUseConditionStatus;
  checks: Array<{
    field: keyof BuildingUseFacts;
    label: string;
    status: BuildingUseConditionStatus;
    actual: number | null;
    rule: string;
  }>;
  issues: string[];
}

export const BUILDING_ACT_APPENDIX_1_SOURCE: RegulatorySourceReference = {
  title: "건축법 시행령 별표 1 용도별 건축물의 종류",
  url: "https://law.go.kr/LSW/flDownload.do?bylClsCd=110201&flSeq=155803643",
  level: "national",
  effectiveFrom: "2026-07-28",
  checkedAt: BUILDING_USE_CATALOG_AS_OF,
};

export const HOUSING_ACT_URBAN_HOUSING_SOURCE: RegulatorySourceReference = {
  title: "주택법 시행령 제10조 도시형 생활주택",
  url: "https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1030114713",
  level: "national",
  effectiveFrom: "2026-09-08",
  checkedAt: BUILDING_USE_CATALOG_AS_OF,
};

const CATALOG: Record<BuildingUseCode, BuildingUseCatalogEntry> = {
  "BA-A1-1-A": {
    code: "BA-A1-1-A",
    label: "단독주택",
    category: "단독주택",
    appendixClause: "건축법 시행령 별표 1 제1호가목",
    compatibleProducts: ["single-house"],
    limits: {},
    notes: ["지구단위계획과 관할 조례의 규모 제한은 별도 확인한다."],
  },
  "BA-A1-1-B": {
    code: "BA-A1-1-B",
    label: "다중주택",
    category: "단독주택",
    appendixClause: "건축법 시행령 별표 1 제1호나목",
    compatibleProducts: ["coliving"],
    limits: {
      maxResidentialFloors: 3,
      maxUseAreaSqm: 660,
    },
    notes: ["독립 취사시설을 둘 수 없어 운영계획 확인이 필요하다."],
  },
  "BA-A1-1-C": {
    code: "BA-A1-1-C",
    label: "다가구주택",
    category: "단독주택",
    appendixClause: "건축법 시행령 별표 1 제1호다목",
    compatibleProducts: ["multi-family"],
    limits: {
      maxResidentialFloors: 3,
      maxUseAreaSqm: 660,
      maxHouseholds: 19,
    },
    notes: ["공동주택에 해당하지 않는 단독주택 분류여야 한다."],
  },
  "BA-A1-2-A": {
    code: "BA-A1-2-A",
    label: "아파트",
    category: "공동주택",
    appendixClause: "건축법 시행령 별표 1 제2호가목",
    compatibleProducts: ["urban-housing"],
    limits: { minResidentialFloors: 5 },
    notes: ["도시형 생활주택이면 주택법 시행령 제10조의 추가 요건을 확인한다."],
  },
  "BA-A1-2-B": {
    code: "BA-A1-2-B",
    label: "연립주택",
    category: "공동주택",
    appendixClause: "건축법 시행령 별표 1 제2호나목",
    compatibleProducts: ["urban-housing"],
    limits: { maxResidentialFloors: 4, minUseAreaExclusiveSqm: 660 },
    notes: ["건축위원회 심의에 따른 도시형 생활주택 층수 특례는 별도 판정한다."],
  },
  "BA-A1-2-C": {
    code: "BA-A1-2-C",
    label: "다세대주택",
    category: "공동주택",
    appendixClause: "건축법 시행령 별표 1 제2호다목",
    compatibleProducts: ["urban-housing", "multi-family"],
    limits: {
      maxResidentialFloors: 4,
      maxUseAreaSqm: 660,
    },
    notes: ["건축위원회 심의에 따른 도시형 생활주택 층수 특례는 별도 판정한다."],
  },
  "BA-A1-2-D-2": {
    code: "BA-A1-2-D-2",
    label: "임대형기숙사",
    category: "공동주택",
    appendixClause: "건축법 시행령 별표 1 제2호라목2)",
    compatibleProducts: ["coliving"],
    limits: { minRooms: 20 },
    notes: ["적격 임대사업자와 공동취사시설 이용 비율을 확인해야 한다."],
  },
  "BA-A1-3-A": {
    code: "BA-A1-3-A",
    label: "일용품 소매점",
    category: "제1종 근린생활시설",
    appendixClause: "건축법 시행령 별표 1 제3호가목",
    compatibleProducts: ["retail"],
    limits: { maxUseAreaExclusiveSqm: 1_000 },
    notes: ["일반적인 retail 전체가 아니라 일용품 소매점에 한정한 코드다."],
  },
  "BA-A1-4-GEO": {
    code: "BA-A1-4-GEO",
    label: "다중생활시설",
    category: "제2종 근린생활시설",
    appendixClause: "건축법 시행령 별표 1 제4호거목",
    compatibleProducts: ["coliving"],
    limits: { maxUseAreaExclusiveSqm: 500 },
    notes: ["고시원업 시설 기준과 서울특별시 건축조례의 실별 기준을 확인한다."],
  },
  "BA-A1-14-B-1": {
    code: "BA-A1-14-B-1",
    label: "일반업무시설",
    category: "업무시설",
    appendixClause: "건축법 시행령 별표 1 제14호나목1)",
    compatibleProducts: ["office"],
    limits: { minUseAreaSqm: 500 },
    notes: ["500㎡ 미만 사무소는 근린생활시설 분류 가능성을 먼저 판정한다."],
  },
  "BA-A1-14-B-2": {
    code: "BA-A1-14-B-2",
    label: "오피스텔",
    category: "업무시설",
    appendixClause: "건축법 시행령 별표 1 제14호나목2)",
    compatibleProducts: ["officetel"],
    limits: {},
    notes: ["오피스텔 건축기준과 주거 사용에 따른 세무·운영 쟁점을 별도 확인한다."],
  },
};

const PRODUCT_ALTERNATIVES: Record<BuildingProductUse, BuildingUseCode[]> = {
  "single-house": ["BA-A1-1-A"],
  "multi-family": ["BA-A1-1-C", "BA-A1-2-C"],
  "urban-housing": ["BA-A1-2-A", "BA-A1-2-B", "BA-A1-2-C"],
  retail: ["BA-A1-3-A"],
  office: ["BA-A1-14-B-1"],
  officetel: ["BA-A1-14-B-2"],
  coliving: ["BA-A1-1-B", "BA-A1-2-D-2", "BA-A1-4-GEO"],
};

const UNAMBIGUOUS_DEFAULTS: Partial<Record<BuildingProductUse, BuildingUseCode>> = {
  "single-house": "BA-A1-1-A",
  "multi-family": "BA-A1-1-C",
  office: "BA-A1-14-B-1",
  officetel: "BA-A1-14-B-2",
};

const URBAN_HOUSING_SUBTYPE: Partial<Record<BuildingUseCode, HousingSubtypeCode>> = {
  "BA-A1-2-A": "HA-ED-A10-1-1",
  "BA-A1-2-B": "HA-ED-A10-1-2",
  "BA-A1-2-C": "HA-ED-A10-1-3",
};

export function getBuildingUse(code: BuildingUseCode): BuildingUseCatalogEntry {
  return CATALOG[code];
}

export function resolveBuildingUse(
  productUse: BuildingProductUse,
  requestedCode?: BuildingUseCode,
): BuildingUseResolution {
  const alternatives = PRODUCT_ALTERNATIVES[productUse];
  const resolvedCode = requestedCode ?? UNAMBIGUOUS_DEFAULTS[productUse];
  const sources = [BUILDING_ACT_APPENDIX_1_SOURCE];

  if (!resolvedCode) {
    return {
      modelVersion: BUILDING_USE_CATALOG_VERSION,
      productUse,
      status: "requires-subtype",
      basis: `${productUse} 상품명만으로 건축법상 세부 용도를 확정할 수 없습니다.`,
      alternatives,
      sources:
        productUse === "urban-housing"
          ? [...sources, HOUSING_ACT_URBAN_HOUSING_SOURCE]
          : sources,
    };
  }

  if (!alternatives.includes(resolvedCode)) {
    return {
      modelVersion: BUILDING_USE_CATALOG_VERSION,
      productUse,
      status: "incompatible",
      requestedCode: resolvedCode,
      basis: `${resolvedCode}는 ${productUse} 상품에 사용할 수 있는 법정 용도코드가 아닙니다.`,
      alternatives,
      sources,
    };
  }

  const housingSubtypeCode = productUse === "urban-housing"
    ? URBAN_HOUSING_SUBTYPE[resolvedCode]
    : undefined;
  return {
    modelVersion: BUILDING_USE_CATALOG_VERSION,
    productUse,
    status: "exact",
    requestedCode: resolvedCode,
    primaryUse: CATALOG[resolvedCode],
    housingSubtypeCode,
    basis: housingSubtypeCode
      ? `${CATALOG[resolvedCode].appendixClause}와 주택법 시행령 제10조의 도시형 생활주택 세부형으로 매핑했습니다.`
      : `${CATALOG[resolvedCode].appendixClause}의 세부 용도로 매핑했습니다.`,
    alternatives,
    sources: housingSubtypeCode
      ? [...sources, HOUSING_ACT_URBAN_HOUSING_SOURCE]
      : sources,
  };
}

function addCheck(
  checks: BuildingUseConditionAssessment["checks"],
  issues: string[],
  field: keyof BuildingUseFacts,
  label: string,
  actual: number | undefined,
  predicate: (value: number) => boolean,
  rule: string,
): void {
  const status: BuildingUseConditionStatus =
    actual === undefined ? "missing-input" : predicate(actual) ? "pass" : "fail";
  checks.push({ field, label, status, actual: actual ?? null, rule });
  if (status === "missing-input") {
    issues.push(`${label} 입력이 없어 ${rule}을 판정하지 못했습니다.`);
  }
  if (status === "fail") {
    issues.push(`${label} ${actual}이(가) ${rule}을 충족하지 않습니다.`);
  }
}

export function evaluateBuildingUseConditions(
  entry: BuildingUseCatalogEntry,
  facts: BuildingUseFacts = {},
): BuildingUseConditionAssessment {
  const checks: BuildingUseConditionAssessment["checks"] = [];
  const issues: string[] = [];
  const limits = entry.limits;

  if (limits.minResidentialFloors !== undefined) {
    addCheck(checks, issues, "residentialFloors", "주택 사용층수", facts.residentialFloors,
      (value) => value >= limits.minResidentialFloors!, `${limits.minResidentialFloors}개 층 이상`);
  }
  if (limits.maxResidentialFloors !== undefined) {
    addCheck(checks, issues, "residentialFloors", "주택 사용층수", facts.residentialFloors,
      (value) => value <= limits.maxResidentialFloors!, `${limits.maxResidentialFloors}개 층 이하`);
  }
  if (limits.minUseAreaSqm !== undefined) {
    addCheck(checks, issues, "useAreaSqm", "해당 용도 바닥면적", facts.useAreaSqm,
      (value) => value >= limits.minUseAreaSqm!, `${limits.minUseAreaSqm}㎡ 이상`);
  }
  if (limits.minUseAreaExclusiveSqm !== undefined) {
    addCheck(checks, issues, "useAreaSqm", "해당 용도 바닥면적", facts.useAreaSqm,
      (value) => value > limits.minUseAreaExclusiveSqm!,
      `${limits.minUseAreaExclusiveSqm}㎡ 초과`);
  }
  if (limits.maxUseAreaSqm !== undefined) {
    addCheck(checks, issues, "useAreaSqm", "해당 용도 바닥면적", facts.useAreaSqm,
      (value) => value <= limits.maxUseAreaSqm!, `${limits.maxUseAreaSqm}㎡ 이하`);
  }
  if (limits.maxUseAreaExclusiveSqm !== undefined) {
    addCheck(checks, issues, "useAreaSqm", "해당 용도 바닥면적", facts.useAreaSqm,
      (value) => value < limits.maxUseAreaExclusiveSqm!,
      `${limits.maxUseAreaExclusiveSqm}㎡ 미만`);
  }
  if (limits.maxHouseholds !== undefined) {
    addCheck(checks, issues, "householdCount", "가구·세대수", facts.householdCount,
      (value) => value <= limits.maxHouseholds!, `${limits.maxHouseholds} 이하`);
  }
  if (limits.minRooms !== undefined) {
    addCheck(checks, issues, "roomCount", "임대 객실수", facts.roomCount,
      (value) => value >= limits.minRooms!, `${limits.minRooms}실 이상`);
  }

  return {
    status: checks.some((check) => check.status === "fail")
      ? "fail"
      : checks.some((check) => check.status === "missing-input")
        ? "missing-input"
        : "pass",
    checks,
    issues,
  };
}
