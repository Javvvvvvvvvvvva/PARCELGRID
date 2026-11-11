/**
 * 부지별 시나리오 자동 생성기.
 *
 * UPDATED: 지역 분류를 6단계로 세분화하여 한국 부동산 시장의 실제
 * 가격 분포를 반영합니다.
 *
 * 지역 6단계 (내부 기준 단가 대비 예비 multiplier):
 *   gangnam-core    1.30×  강남/서초/송파
 *   mid-prime       1.05×  용산/마포/성동/광진
 *   seoul-standard  0.85×  영등포/양천/강서/동작/관악/중구/종로 등
 *   seoul-outer     0.65×  노원/도봉/강북/은평/금천/구로/중랑
 *   metro-outskirt  0.55×  경기·인천 신도시
 *   rural           0.45×  지방
 */

import type { Parcel, Scenario, BuildingProgram } from "@/lib/finance/types";
import { defaultAssumptions, defaultProgram } from "@/lib/finance/scenario";
import {
  classifyZoningFamily,
  screenZoningUse,
  type ZoningFamily,
  type ZoningScreenableUse,
  type ZoningUseScreeningResult,
} from "@/lib/regulatory/zoning-use-screening";
import type { BuildingUseCode } from "@/lib/regulatory/building-use-catalog";

const SQM_PER_PYEONG = 3.305785;

function wonPerPyeongToWonPerSqm(wonPerPyeong: number): number {
  return wonPerPyeong / SQM_PER_PYEONG;
}

export interface GenerateOptions {
  scenarioTypes?: ZoningScreenableUse[];
  /** Legal-source snapshot date. Defaults to the current bundled ruleset. */
  asOf?: string;
}

type CandidateStrategy = NonNullable<Scenario["generation"]>["strategy"];

interface CandidateDefinition {
  name: string;
  tag: string;
  type: ZoningScreenableUse;
  legalUseCode: BuildingUseCode;
  strategy: CandidateStrategy;
}

type PricingTier =
  | "gangnam-core"
  | "mid-prime"
  | "seoul-standard"
  | "seoul-outer"
  | "metro-outskirt"
  | "rural";

function pricingTier(address: string): PricingTier {
  if (/강남구|서초구|송파구/.test(address)) return "gangnam-core";

  if (/용산구|마포구|성동구|광진구/.test(address)) return "mid-prime";

  if (/노원구|도봉구|강북구|은평구|금천구|관악구|구로구|중랑구/.test(address)) {
    return "seoul-outer";
  }

  if (/^경기|^인천|^세종/.test(address)) return "metro-outskirt";

  if (/^충|^전|^경상|^강원|^제주|^부산|^대구|^대전|^광주|^울산/.test(address)) {
    return "rural";
  }

  // 서울 그 외 — 영등포, 양천, 강서, 동작, 중구, 종로, 동대문, 서대문, 성북 등
  return "seoul-standard";
}

function tierMultipliers(tier: PricingTier): {
  saleMult: number;
  rentMult: number;
  capDelta: number;
  interestDelta: number;
} {
  switch (tier) {
    case "gangnam-core":
      return { saleMult: 1.30, rentMult: 1.25, capDelta: -0.5, interestDelta: 0 };
    case "mid-prime":
      return { saleMult: 1.05, rentMult: 1.10, capDelta: -0.2, interestDelta: 0 };
    case "seoul-standard":
      return { saleMult: 0.85, rentMult: 0.90, capDelta: 0.1, interestDelta: 0 };
    case "seoul-outer":
      return { saleMult: 0.65, rentMult: 0.75, capDelta: 0.3, interestDelta: 0.1 };
    case "metro-outskirt":
      return { saleMult: 0.55, rentMult: 0.65, capDelta: 0.5, interestDelta: 0.2 };
    case "rural":
      return { saleMult: 0.45, rentMult: 0.55, capDelta: 0.7, interestDelta: 0.3 };
  }
}

/**
 * 부지 크기에 맞춰 program 보정.
 * 작은 부지(<50평)에서 retail 6층은 코어/주차가 면적을 다 잡아먹어
 * 분양가능면적이 0이 됨. 저층(3층)으로 낮춰 현실적인 매출이 나오게 한다.
 */
function adjustProgramForLot(
  program: BuildingProgram,
  type: string,
  parcel: Parcel
): BuildingProgram {
  const lotPyeong = parcel.lotArea / 3.305785;
  if (type === "retail" && lotPyeong < 50) {
    return {
      ...program,
      floorsAbove: 3,
      floorsBelow: 0,
      far: Math.min(program.far, 150),
    };
  }
  return program;
}

function applyStrategy(
  program: BuildingProgram,
  strategy: CandidateStrategy,
): BuildingProgram {
  if (strategy === "sale-exit") {
    if (
      program.type === "single-house" ||
      program.type === "multi-family" ||
      program.type === "urban-housing"
    ) {
      return {
        ...program,
        mix: { residentialSale: 1, residentialLease: 0, retail: 0 },
      };
    }
    if (program.type === "officetel") {
      return {
        ...program,
        units: { ...program.units, retail: 0 },
        mix: { residentialSale: 1, residentialLease: 0, retail: 0 },
      };
    }
    return program;
  }

  if (
    program.type === "single-house" ||
    program.type === "multi-family" ||
    program.type === "urban-housing"
  ) {
    return {
      ...program,
      mix: { residentialSale: 0, residentialLease: 1, retail: 0 },
    };
  }
  if (program.type === "officetel") {
    return {
      ...program,
      units: { ...program.units, retail: 0 },
      mix: { residentialSale: 0, residentialLease: 1, retail: 0 },
    };
  }
  if (program.type === "office") {
    return {
      ...program,
      units: { ...program.units, retail: 0 },
      mix: { residentialSale: 0, residentialLease: 1, retail: 0 },
    };
  }
  return program;
}

function buildCandidateProgram(
  candidate: CandidateDefinition,
  parcel: Parcel,
): BuildingProgram {
  const adjusted = adjustProgramForLot(
    applyStrategy(
      defaultProgram(candidate.type, parcel.maxFAR, parcel.maxBCR),
      candidate.strategy,
    ),
    candidate.type,
    parcel,
  );
  return {
    ...adjusted,
    far: Math.min(adjusted.far, adjusted.bcr * adjusted.floorsAbove),
  };
}

function legalUseFacts(
  program: BuildingProgram,
  parcel: Parcel,
): {
  aboveGroundFloors: number;
  residentialFloors?: number;
  useAreaSqm: number;
  householdCount?: number;
} {
  const residential =
    program.type === "single-house" ||
    program.type === "multi-family" ||
    program.type === "urban-housing";

  return {
    aboveGroundFloors: program.floorsAbove,
    residentialFloors: residential ? program.floorsAbove : undefined,
    useAreaSqm: parcel.lotArea * (program.far / 100),
    householdCount: residential ? program.units.residential : undefined,
  };
}

function buildScenario(
  id: string,
  candidate: CandidateDefinition,
  parcel: Parcel,
  tier: PricingTier,
  useScreening: ZoningUseScreeningResult,
  program: BuildingProgram,
): Scenario {
  const { name, tag, type, strategy } = candidate;
  const baseA = defaultAssumptions();
  const { saleMult, rentMult, capDelta, interestDelta } = tierMultipliers(tier);

  let salePricePerSqM = baseA.salePricePerSqM;
  let rentPerSqMMonth = baseA.rentPerSqMMonth;
  let vacancyRate = baseA.vacancyRate;
  let capRate = baseA.capRate;
  let interestRate = baseA.interestRate;

  if (type === "officetel") {
    if (strategy === "stabilized-lease-exit") salePricePerSqM = 0;
  } else if (type === "urban-housing") {
    if (strategy === "sale-exit") {
      salePricePerSqM = 17_200_000;
      rentPerSqMMonth = 0;
      vacancyRate = 0;
    } else {
      salePricePerSqM = 0;
    }
    capRate = 4.6;
  } else if (type === "retail") {
    rentPerSqMMonth = 52_000;
    salePricePerSqM = 0;
    vacancyRate = 7.0;
    capRate = 5.2;
  } else if (type === "coliving") {
    rentPerSqMMonth = 89_000;
    salePricePerSqM = 0;
    vacancyRate = 6.2;
    capRate = 5.0;
    interestRate = 6.1;
  } else if (type === "office") {
    rentPerSqMMonth = 75_000;
    salePricePerSqM = 0;
    vacancyRate = 8.0;
    capRate = 5.5;
  } else if (type === "single-house") {
    // 단독주택 신축매매 — 100% 매매. 평당 1,800만 (지역 multiplier 별도 적용)
    salePricePerSqM = wonPerPyeongToWonPerSqm(18_000_000);
    rentPerSqMMonth = 0;
    vacancyRate = 0;
  } else if (type === "multi-family") {
    if (strategy === "sale-exit") {
      // 다가구 통매각 — 평당 1,500만 내부 기준(지역 multiplier 별도 적용)
      salePricePerSqM = wonPerPyeongToWonPerSqm(15_000_000);
      rentPerSqMMonth = 0;
      vacancyRate = 0;
    } else {
      salePricePerSqM = 0;
    }
  }

  // 임대수입이 있는 외곽 후보에만 추가 공실 위험을 반영한다.
  if (
    rentPerSqMMonth > 0 &&
    (tier === "seoul-outer" ||
      tier === "metro-outskirt" ||
      tier === "rural")
  ) {
    vacancyRate = vacancyRate + 1.5;
  }

  return {
    id,
    name,
    shortName: id,
    tag,
    program,
    assumptions: {
      ...baseA,
      salePricePerSqM: Math.round(salePricePerSqM * saleMult),
      rentPerSqMMonth: Math.round(rentPerSqMMonth * rentMult),
      vacancyRate,
      capRate: capRate + capDelta,
      interestRate: interestRate + interestDelta,
    },
    generation: {
      modelVersion: "scenario-generation-2026.2",
      strategy,
      strategyLabel:
        strategy === "sale-exit" ? "분양·통매각" : "임대 안정화 후 매각",
      useScreening,
    },
  };
}

function generatedLegalUseCode(type: ZoningScreenableUse): BuildingUseCode {
  switch (type) {
    case "single-house":
      return "BA-A1-1-A";
    case "multi-family":
      return "BA-A1-1-C";
    case "urban-housing":
      return "BA-A1-2-A";
    case "retail":
      return "BA-A1-3-A";
    case "office":
      return "BA-A1-14-B-1";
    case "officetel":
      return "BA-A1-14-B-2";
    case "coliving":
      throw new Error("코리빙은 법정 세부용도 선택 전 자동 생성할 수 없습니다.");
  }
}

function sale(
  name: string,
  type: ZoningScreenableUse,
  tag = "매각형",
): CandidateDefinition {
  return {
    name,
    tag,
    type,
    legalUseCode: generatedLegalUseCode(type),
    strategy: "sale-exit",
  };
}

function lease(
  name: string,
  type: ZoningScreenableUse,
  tag = "임대형",
): CandidateDefinition {
  return {
    name,
    tag,
    type,
    legalUseCode: generatedLegalUseCode(type),
    strategy: "stabilized-lease-exit",
  };
}

function residentialCandidates(
  family: ZoningFamily,
  lotPyeong: number,
): CandidateDefinition[] {
  if (
    family === "first-exclusive-residential" ||
    family === "second-exclusive-residential"
  ) {
    return [
      sale("단독주택 신축매매", "single-house"),
      sale("다가구주택 통매각", "multi-family"),
      lease("다가구 임대 안정화 후 매각", "multi-family"),
    ];
  }

  const lowRise = [
    sale("단독주택 신축매매", "single-house"),
    sale("다가구주택 통매각", "multi-family"),
    lease("다가구 임대 안정화 후 매각", "multi-family"),
    lease("제1종 근린생활시설 소매점 임대 안정화 후 매각", "retail", "용도확정"),
  ];
  if (family === "first-general-residential" || lotPyeong < 50) {
    return lowRise;
  }

  const urbanStrategies = [
    sale("도시형생활주택 분양", "urban-housing"),
    lease("도시형생활주택 임대 안정화 후 매각", "urban-housing"),
  ];
  if (lotPyeong < 100) {
    return [
      sale("다가구주택 통매각", "multi-family"),
      lease("다가구 임대 안정화 후 매각", "multi-family"),
      sale("단독주택 신축매매", "single-house"),
      ...urbanStrategies,
      lease("제1종 근린생활시설 소매점 임대 안정화 후 매각", "retail", "용도확정"),
    ];
  }

  return [
    ...urbanStrategies,
    sale("다가구주택 통매각", "multi-family"),
    lease("다가구 임대 안정화 후 매각", "multi-family"),
    lease("제1종 근린생활시설 소매점 임대 안정화 후 매각", "retail", "용도확정"),
  ];
}

/**
 * Generate a bounded candidate space from an exact zoning family.
 * Unsupported or ambiguous zones intentionally return no candidates.
 */
function pickCandidateDefinitions(parcel: Parcel): CandidateDefinition[] {
  const family = classifyZoningFamily(parcel.zoning);
  const lotPyeong = parcel.lotArea / SQM_PER_PYEONG;

  switch (family) {
    case "first-exclusive-residential":
    case "second-exclusive-residential":
    case "first-general-residential":
    case "second-general-residential":
    case "third-general-residential":
      return residentialCandidates(family, lotPyeong);
    case "semi-residential":
      return [
        sale("도시형생활주택 분양", "urban-housing"),
        lease("도시형생활주택 임대 안정화 후 매각", "urban-housing"),
        lease("일반업무시설 임대 안정화 후 매각", "office"),
        sale("오피스텔 분양", "officetel"),
        lease("오피스텔 임대 안정화 후 매각", "officetel"),
        lease("제1종 근린생활시설 소매점 임대 안정화 후 매각", "retail"),
      ];
    case "central-commercial":
    case "general-commercial":
    case "neighborhood-commercial":
      return [
        lease("일반업무시설 임대 안정화 후 매각", "office"),
        sale("오피스텔 분양", "officetel"),
        lease("오피스텔 임대 안정화 후 매각", "officetel"),
        lease("제1종 근린생활시설 소매점 임대 안정화 후 매각", "retail"),
      ];
    case "distribution-commercial":
      return [lease("제1종 근린생활시설 소매점 임대 안정화 후 매각", "retail")];
    case "semi-industrial":
      return [
        lease("일반업무시설 임대 검토", "office", "조례검토"),
        lease("제1종 근린생활시설 소매점 임대 검토", "retail", "조례검토"),
      ];
    case "exclusive-industrial":
    case "general-industrial":
    case "green":
    case "management":
    case "agricultural-forest":
    case "natural-environment":
    case "unknown":
      return [];
  }
}

export function generateScenariosForParcel(
  parcel: Parcel,
  options: GenerateOptions = {}
): Scenario[] {
  const tier = pricingTier(parcel.address);
  const picks = pickCandidateDefinitions(parcel);

  let filtered = picks;
  if (options.scenarioTypes && options.scenarioTypes.length > 0) {
    filtered = picks.filter((p) => options.scenarioTypes!.includes(p.type));
  }

  return filtered
    .map((candidate) => {
      const program = buildCandidateProgram(candidate, parcel);
      return {
        candidate,
        program,
        useScreening: screenZoningUse(parcel.zoning, candidate.type, {
          address: parcel.address,
          asOf: options.asOf,
          legalUseCode: candidate.legalUseCode,
          ...legalUseFacts(program, parcel),
        }),
      };
    })
    .filter(({ useScreening }) => useScreening.autoGeneratable)
    .map(({ candidate, useScreening, program }, index) =>
      buildScenario(`S${index + 1}`, candidate, parcel, tier, useScreening, program),
    );
}
