/**
 * Conservative zoning/use pre-screening for automatically generated options.
 * It records an exact statutory building use before considering a product and
 * never grants a building-permit determination.
 */

import {
  BUILDING_USE_CATALOG_AS_OF,
  evaluateBuildingUseConditions,
  resolveBuildingUse,
  type BuildingProductUse,
  type BuildingUseCode,
  type BuildingUseConditionAssessment,
  type BuildingUseFacts,
  type BuildingUseResolution,
  type RegulatorySourceReference,
} from "@/lib/regulatory/building-use-catalog";

export const ZONING_USE_SCREENING_VERSION =
  "zoning-use-screening-2026.2" as const;

export type ZoningFamily =
  | "first-exclusive-residential"
  | "second-exclusive-residential"
  | "first-general-residential"
  | "second-general-residential"
  | "third-general-residential"
  | "semi-residential"
  | "central-commercial"
  | "general-commercial"
  | "neighborhood-commercial"
  | "distribution-commercial"
  | "exclusive-industrial"
  | "general-industrial"
  | "semi-industrial"
  | "green"
  | "management"
  | "agricultural-forest"
  | "natural-environment"
  | "unknown";

export type ZoningScreenableUse = BuildingProductUse;

export type ZoningUseScreeningStatus =
  | "national-reference"
  | "seoul-ordinance-reference"
  | "local-ordinance-review"
  | "building-use-input-required"
  | "condition-input-required"
  | "condition-failed"
  | "source-date-uncovered"
  | "unsupported-auto"
  | "unknown";

export type JurisdictionCode = "KR-11" | "KR";

export interface ZoningUseScreeningContext extends BuildingUseFacts {
  address?: string;
  asOf?: string;
  legalUseCode?: BuildingUseCode;
  aboveGroundFloors?: number;
  roadWidthM?: number;
}

export interface ZoningUseScreeningResult {
  modelVersion: typeof ZONING_USE_SCREENING_VERSION;
  asOf: string;
  jurisdictionCode: JurisdictionCode;
  jurisdictionLabel: string;
  ordinanceCoverage: "seoul-current" | "national-only";
  zoning: string;
  zoningFamily: ZoningFamily;
  zoningFamilyLabel: string;
  use: ZoningScreenableUse;
  legalUse: BuildingUseResolution;
  conditionAssessment: BuildingUseConditionAssessment;
  status: ZoningUseScreeningStatus;
  /** Candidate generation permission, not a building-permit determination. */
  autoGeneratable: boolean;
  /** Always false until parcel overlays and the competent authority are checked. */
  decisionGrade: false;
  basis: string;
  reviewItems: string[];
  sources: RegulatorySourceReference[];
}

const RULESET_EFFECTIVE_FROM = "2026-09-08";

const NATIONAL_SOURCE: RegulatorySourceReference = {
  title: "국토의 계획 및 이용에 관한 법률 시행령 제71조 및 별표 2~22",
  url: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=287269",
  level: "national",
  effectiveFrom: "2026-07-01",
  checkedAt: BUILDING_USE_CATALOG_AS_OF,
};

const LOCAL_SOURCE: RegulatorySourceReference = {
  title: "국가법령정보센터 현행 자치법규 검색",
  url: "https://www.law.go.kr/ordinSc.do?menuId=3",
  level: "local",
  effectiveFrom: RULESET_EFFECTIVE_FROM,
  checkedAt: BUILDING_USE_CATALOG_AS_OF,
};

const SEOUL_SOURCE: RegulatorySourceReference = {
  title: "서울특별시 도시계획 조례 제33조 및 별표 2~12",
  url: "https://www.law.go.kr/LSW/ordinInfoP.do?ordinId=2000719",
  level: "local",
  effectiveFrom: "2026-07-13",
  checkedAt: BUILDING_USE_CATALOG_AS_OF,
};

const FAMILY_LABELS: Record<ZoningFamily, string> = {
  "first-exclusive-residential": "제1종전용주거지역",
  "second-exclusive-residential": "제2종전용주거지역",
  "first-general-residential": "제1종일반주거지역",
  "second-general-residential": "제2종일반주거지역",
  "third-general-residential": "제3종일반주거지역",
  "semi-residential": "준주거지역",
  "central-commercial": "중심상업지역",
  "general-commercial": "일반상업지역",
  "neighborhood-commercial": "근린상업지역",
  "distribution-commercial": "유통상업지역",
  "exclusive-industrial": "전용공업지역",
  "general-industrial": "일반공업지역",
  "semi-industrial": "준공업지역",
  green: "녹지지역",
  management: "관리지역",
  "agricultural-forest": "농림지역",
  "natural-environment": "자연환경보전지역",
  unknown: "미분류 용도지역",
};

type RuleCoverage =
  | "national-direct"
  | "seoul-local"
  | "local-review"
  | "unsupported";

function normalizeZoning(zoning: string): string {
  return zoning.replace(/\s+/g, "");
}

export function classifyZoningFamily(zoning: string): ZoningFamily {
  const value = normalizeZoning(zoning);
  if (value.includes("제1종전용주거지역")) return "first-exclusive-residential";
  if (value.includes("제2종전용주거지역")) return "second-exclusive-residential";
  if (value.includes("제1종일반주거지역")) return "first-general-residential";
  if (value.includes("제2종일반주거지역")) return "second-general-residential";
  if (value.includes("제3종일반주거지역")) return "third-general-residential";
  if (value.includes("준주거지역")) return "semi-residential";
  if (value.includes("중심상업지역")) return "central-commercial";
  if (value.includes("일반상업지역")) return "general-commercial";
  if (value.includes("근린상업지역")) return "neighborhood-commercial";
  if (value.includes("유통상업지역")) return "distribution-commercial";
  if (value.includes("전용공업지역")) return "exclusive-industrial";
  if (value.includes("일반공업지역")) return "general-industrial";
  if (value.includes("준공업지역")) return "semi-industrial";
  if (/보전녹지지역|생산녹지지역|자연녹지지역/.test(value)) return "green";
  if (/보전관리지역|생산관리지역|계획관리지역/.test(value)) return "management";
  if (value.includes("농림지역")) return "agricultural-forest";
  if (value.includes("자연환경보전지역")) return "natural-environment";
  return "unknown";
}

function jurisdictionForAddress(address = ""): {
  code: JurisdictionCode;
  label: string;
  coverage: ZoningUseScreeningResult["ordinanceCoverage"];
} {
  return address.trimStart().startsWith("서울")
    ? { code: "KR-11", label: "서울특별시", coverage: "seoul-current" }
    : { code: "KR", label: "관할 미지정", coverage: "national-only" };
}

function nationalRuleCoverage(
  family: ZoningFamily,
  code: BuildingUseCode,
): RuleCoverage {
  const residentialAndNeighborhood: BuildingUseCode[] = [
    "BA-A1-1-A",
    "BA-A1-1-B",
    "BA-A1-1-C",
    "BA-A1-2-A",
    "BA-A1-2-B",
    "BA-A1-2-C",
    "BA-A1-2-D-2",
    "BA-A1-3-A",
  ];

  switch (family) {
    case "first-exclusive-residential":
      if (code === "BA-A1-1-A" || code === "BA-A1-3-A") {
        return "national-direct";
      }
      if (
        code === "BA-A1-1-C" ||
        code === "BA-A1-2-B" ||
        code === "BA-A1-2-C"
      ) {
        return "seoul-local";
      }
      return "unsupported";
    case "second-exclusive-residential":
      return residentialAndNeighborhood.includes(code)
        ? "national-direct"
        : "unsupported";
    case "first-general-residential":
    case "second-general-residential":
    case "third-general-residential":
      if (residentialAndNeighborhood.includes(code)) return "national-direct";
      return family === "third-general-residential" &&
        (code === "BA-A1-14-B-1" || code === "BA-A1-14-B-2")
        ? "seoul-local"
        : "unsupported";
    case "semi-residential":
      return [
        "BA-A1-2-A",
        "BA-A1-2-B",
        "BA-A1-2-C",
        "BA-A1-3-A",
        "BA-A1-14-B-1",
        "BA-A1-14-B-2",
      ].includes(code)
        ? "local-review"
        : "unsupported";
    case "central-commercial":
    case "general-commercial":
    case "neighborhood-commercial":
      return ["BA-A1-3-A", "BA-A1-14-B-1", "BA-A1-14-B-2"].includes(code)
        ? "local-review"
        : "unsupported";
    case "distribution-commercial":
      return code === "BA-A1-3-A" ? "local-review" : "unsupported";
    case "semi-industrial":
      return code === "BA-A1-3-A" || code === "BA-A1-14-B-1"
        ? "local-review"
        : "unsupported";
    case "exclusive-industrial":
    case "general-industrial":
    case "green":
    case "management":
    case "agricultural-forest":
    case "natural-environment":
    case "unknown":
      return "unsupported";
  }
}

function zoningProgramIssues(
  zoning: string,
  family: ZoningFamily,
  context: ZoningUseScreeningContext,
): string[] {
  const issues: string[] = [];
  if (
    family === "first-general-residential" &&
    context.aboveGroundFloors !== undefined &&
    context.aboveGroundFloors > 4
  ) {
    issues.push("제1종일반주거지역의 국가 기준 4층 이하를 초과합니다.");
  }
  if (
    family === "second-general-residential" &&
    /7층이하/.test(normalizeZoning(zoning)) &&
    context.aboveGroundFloors !== undefined &&
    context.aboveGroundFloors > 7
  ) {
    issues.push("제2종일반주거지역(7층 이하)의 표시 층수를 초과합니다.");
  }
  return issues;
}

function reviewForUse(use: ZoningScreenableUse): string {
  switch (use) {
    case "urban-housing":
      return "도시형 생활주택의 세부형, 세대수, 전용면적, 혼합 제한과 사업계획승인 기준 확인";
    case "officetel":
      return "업무시설 중 오피스텔 건축기준, 접도·규모와 복합 비율 제한 확인";
    case "retail":
      return "선택한 근린생활시설 세부 업종과 같은 건축물 내 용도별 바닥면적 확인";
    case "coliving":
      return "운영방식에 맞는 다중주택·임대형기숙사·다중생활시설 중 법정 용도 선택";
    case "office":
      return "근린생활시설 사무소와 일반업무시설의 면적 구분 및 접도 조건 확인";
    case "multi-family":
      return "다가구주택의 3개 주택층·660㎡·19가구 기준과 필로티 산정 확인";
    case "single-house":
      return "단독주택 세부 계획과 지구단위계획 제한 확인";
  }
}

export function screenZoningUse(
  zoning: string,
  use: ZoningScreenableUse,
  context: ZoningUseScreeningContext = {},
): ZoningUseScreeningResult {
  const asOf = context.asOf ?? BUILDING_USE_CATALOG_AS_OF;
  const jurisdiction = jurisdictionForAddress(context.address);
  const zoningFamily = classifyZoningFamily(zoning);
  const legalUse = resolveBuildingUse(use, context.legalUseCode);
  const conditionAssessment: BuildingUseConditionAssessment = legalUse.primaryUse
    ? evaluateBuildingUseConditions(legalUse.primaryUse, context)
    : { status: "missing-input", checks: [], issues: [legalUse.basis] };
  const localSource = jurisdiction.code === "KR-11" ? SEOUL_SOURCE : LOCAL_SOURCE;
  const sources = [...legalUse.sources, NATIONAL_SOURCE, localSource];
  const sourceCovered = asOf >= RULESET_EFFECTIVE_FROM;
  const coverage = legalUse.primaryUse
    ? nationalRuleCoverage(zoningFamily, legalUse.primaryUse.code)
    : "unsupported";
  const programIssues = zoningProgramIssues(zoning, zoningFamily, context);

  let status: ZoningUseScreeningStatus;
  if (zoningFamily === "unknown") status = "unknown";
  else if (!sourceCovered) status = "source-date-uncovered";
  else if (legalUse.status !== "exact") status = "building-use-input-required";
  else if (conditionAssessment.status === "missing-input") status = "condition-input-required";
  else if (conditionAssessment.status === "fail" || programIssues.length > 0) {
    status = "condition-failed";
  } else if (coverage === "national-direct") status = "national-reference";
  else if (coverage === "seoul-local" && jurisdiction.code === "KR-11") {
    status = "seoul-ordinance-reference";
  } else if (coverage === "local-review") status = "local-ordinance-review";
  else status = "unsupported-auto";

  const autoGeneratable =
    status === "national-reference" ||
    status === "seoul-ordinance-reference" ||
    (status === "local-ordinance-review" && jurisdiction.code === "KR-11");

  const reviewItems = [
    "관할 도시·군계획조례의 용도·규모·층수·접도 제한 확인",
    "지구단위계획, 용도지구·구역, 경관·고도 등 중첩 규제 확인",
    reviewForUse(use),
    ...conditionAssessment.issues,
    ...programIssues,
  ];
  if (zoningFamily === "semi-industrial" && use === "office") {
    reviewItems.unshift("준공업지역의 업무시설 허용 범위와 산업기능 유지 조건 확인");
  }

  const basis =
    status === "national-reference"
      ? "정확한 건축물 용도코드와 정량조건이 국가 기준의 직접 허용 범위에 대응합니다. 최종 허가 판정은 아닙니다."
      : status === "seoul-ordinance-reference"
        ? "정확한 건축물 용도코드와 정량조건이 현재 서울 조례 스냅샷의 비교 후보 범위에 대응합니다."
        : status === "local-ordinance-review"
          ? "국가 기준이 조례 검토를 요구합니다. 서울은 현행 조례 원문을 연결한 예비 비교 후보이며 개별 필지 확인이 남습니다."
          : status === "building-use-input-required"
            ? legalUse.basis
            : status === "condition-input-required"
              ? "법정 용도의 정량조건을 판정할 입력이 없어 자동 후보 생성을 중단합니다."
              : status === "condition-failed"
                ? [...conditionAssessment.issues, ...programIssues].join(" ")
                : status === "source-date-uncovered"
                  ? `${asOf}은 현재 규칙 스냅샷의 적용 기준일 ${RULESET_EFFECTIVE_FROM} 이전입니다.`
                  : status === "unknown"
                    ? "세부 용도지역을 분류하지 못해 자동 후보 생성을 중단합니다."
                    : "현재 규칙 버전에서 이 용도 조합을 자동 생성할 근거를 확보하지 못했습니다.";

  return {
    modelVersion: ZONING_USE_SCREENING_VERSION,
    asOf,
    jurisdictionCode: jurisdiction.code,
    jurisdictionLabel: jurisdiction.label,
    ordinanceCoverage: jurisdiction.coverage,
    zoning,
    zoningFamily,
    zoningFamilyLabel: FAMILY_LABELS[zoningFamily],
    use,
    legalUse,
    conditionAssessment,
    status,
    autoGeneratable,
    decisionGrade: false,
    basis,
    reviewItems: [...new Set(reviewItems)],
    sources,
  };
}
