/**
 * 부지별 시나리오 자동 생성기.
 *
 * UPDATED: 지역 분류를 6단계로 세분화하여 한국 부동산 시장의 실제
 * 가격 분포를 반영합니다.
 *
 * 지역 6단계 (강남 3구 기준 분양가 multiplier):
 *   gangnam-core    1.30×  강남/서초/송파
 *   mid-prime       1.05×  용산/마포/성동/광진
 *   seoul-standard  0.85×  영등포/양천/강서/동작/관악/중구/종로 등
 *   seoul-outer     0.65×  노원/도봉/강북/은평/금천/구로/중랑
 *   metro-outskirt  0.55×  경기·인천 신도시
 *   rural           0.45×  지방
 */

import type { Parcel, Scenario, BuildingProgram } from "@/lib/finance/types";
import { defaultAssumptions, defaultProgram } from "@/lib/finance/scenario";

export interface GenerateOptions {
  scenarioTypes?: Array<"officetel" | "urban-housing" | "retail" | "coliving" | "office" | "single-house" | "multi-family">;
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

function buildScenario(
  id: string,
  name: string,
  shortName: string,
  tag: string,
  type: "officetel" | "urban-housing" | "retail" | "coliving" | "office" | "single-house" | "multi-family",
  parcel: Parcel,
  tier: PricingTier
): Scenario {
  const baseA = defaultAssumptions();
  const { saleMult, rentMult, capDelta, interestDelta } = tierMultipliers(tier);

  let salePricePerSqM = baseA.salePricePerSqM;
  let rentPerSqMMonth = baseA.rentPerSqMMonth;
  let vacancyRate = baseA.vacancyRate;
  let capRate = baseA.capRate;
  let interestRate = baseA.interestRate;

  if (type === "officetel") {
    // baseline values are calibrated for officetel in 강남
  } else if (type === "urban-housing") {
    salePricePerSqM = 17_200_000;
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
    salePricePerSqM = 18_000_000;
    rentPerSqMMonth = 0;
    vacancyRate = 0;
    capRate = 0;
  } else if (type === "multi-family") {
    // 다가구주택 신축매매 — 100% 매매. 평당 1,500만 (분양보다 약간 낮음 — 통매매)
    salePricePerSqM = 15_000_000;
    rentPerSqMMonth = 0;
    vacancyRate = 0;
    capRate = 0;
  }

  // Outer regions have higher vacancy risk
  if (tier === "seoul-outer" || tier === "metro-outskirt" || tier === "rural") {
    vacancyRate = vacancyRate + 1.5;
  }

  return {
    id,
    name,
    shortName,
    tag,
    program: adjustProgramForLot(
      defaultProgram(type, parcel.maxFAR, parcel.maxBCR),
      type,
      parcel
    ),
    assumptions: {
      ...baseA,
      salePricePerSqM: Math.round(salePricePerSqM * saleMult),
      rentPerSqMMonth: Math.round(rentPerSqMMonth * rentMult),
      vacancyRate,
      capRate: capRate + capDelta,
      interestRate: interestRate + interestDelta,
    },
  };
}

function pickScenariosForZoning(zoning: string): Array<{
  id: string;
  name: string;
  shortName: string;
  tag: string;
  type: "officetel" | "urban-housing" | "retail" | "coliving" | "office";
}> {
  if (/주거지역/.test(zoning)) {
    return [
      { id: "S1", name: "오피스텔 + 근생", shortName: "S1", tag: "고수익형", type: "officetel" },
      { id: "S2", name: "도시형생활주택", shortName: "S2", tag: "안정형", type: "urban-housing" },
      { id: "S3", name: "근린생활시설", shortName: "S3", tag: "보수형", type: "retail" },
      { id: "S4", name: "공유주거 (코리빙)", shortName: "S4", tag: "신규형", type: "coliving" },
    ];
  }

  if (/상업지역/.test(zoning)) {
    return [
      { id: "S1", name: "오피스 빌딩", shortName: "S1", tag: "안정형", type: "office" },
      { id: "S2", name: "오피스텔 + 근생", shortName: "S2", tag: "고수익형", type: "officetel" },
      { id: "S3", name: "근린생활 (상가)", shortName: "S3", tag: "보수형", type: "retail" },
      { id: "S4", name: "공유주거 (코리빙)", shortName: "S4", tag: "신규형", type: "coliving" },
    ];
  }

  if (/공업지역/.test(zoning)) {
    return [
      { id: "S1", name: "지식산업센터", shortName: "S1", tag: "표준형", type: "office" },
      { id: "S2", name: "근린생활시설", shortName: "S2", tag: "보수형", type: "retail" },
      { id: "S3", name: "오피스텔", shortName: "S3", tag: "혼합형", type: "officetel" },
      { id: "S4", name: "공유주거 (코리빙)", shortName: "S4", tag: "신규형", type: "coliving" },
    ];
  }

  return [
    { id: "S1", name: "근린생활시설", shortName: "S1", tag: "보수형", type: "retail" },
    { id: "S2", name: "오피스텔", shortName: "S2", tag: "표준형", type: "officetel" },
    { id: "S3", name: "도시형생활주택", shortName: "S3", tag: "혼합형", type: "urban-housing" },
    { id: "S4", name: "공유주거 (코리빙)", shortName: "S4", tag: "신규형", type: "coliving" },
  ];
}


/**
 * 부지 크기에 맞는 시나리오 선택 (Smart Picker).
 *
 * 본인 도구의 진짜 차별화:
 * - 작은 부지 (< 50평): 단독 + 다가구 + 근생
 * - 중간 부지 (50-100평): 다가구 + 단독 + 도시형 + 근생
 * - 큰 부지 (100-200평): 도시형 + 다가구 + 오피스텔 + 코리빙
 * - 대형 부지 (200평+): 기존 다세대 4종
 *
 * 다른 PropTech는 부지 크기 무시하고 다세대만 시도 → 작은 부지에서 의미없는 답.
 * 본인 도구는 부지에 맞는 사업만 제안 → 정직한 답.
 */
function pickScenariosForSize(
  parcel: Parcel,
  zoningPicks: Array<{
    id: string;
    name: string;
    shortName: string;
    tag: string;
    type: "officetel" | "urban-housing" | "retail" | "coliving" | "office" | "single-house" | "multi-family";
  }>
): typeof zoningPicks {
  const lotPyeong = parcel.lotArea / 3.305785;

  // 주거지역에서만 단독/다가구 의미 있음
  const isResidential = /주거지역/.test(parcel.zoning);
  if (!isResidential) return zoningPicks;

  if (lotPyeong < 50) {
    // 작은 부지: 다세대 시행 거의 안 됨 → 단독/다가구 위주
    return [
      { id: "S1", name: "단독주택 신축매매", shortName: "S1", tag: "표준형", type: "single-house" },
      { id: "S2", name: "다가구주택 신축매매", shortName: "S2", tag: "수익형", type: "multi-family" },
      { id: "S3", name: "근린생활시설 (저층)", shortName: "S3", tag: "보수형", type: "retail" },
    ];
  }

  if (lotPyeong < 100) {
    // 중간 부지: 다가구 + 단독 + 도시형 일부
    return [
      { id: "S1", name: "다가구주택 신축매매", shortName: "S1", tag: "수익형", type: "multi-family" },
      { id: "S2", name: "단독주택 신축매매", shortName: "S2", tag: "안정형", type: "single-house" },
      { id: "S3", name: "도시형생활주택", shortName: "S3", tag: "고수익형", type: "urban-housing" },
      { id: "S4", name: "근린생활시설", shortName: "S4", tag: "보수형", type: "retail" },
    ];
  }

  if (lotPyeong < 200) {
    // 큰 부지: 다세대 위주 + 다가구 한 개
    return [
      { id: "S1", name: "도시형생활주택", shortName: "S1", tag: "안정형", type: "urban-housing" },
      { id: "S2", name: "오피스텔 + 근생", shortName: "S2", tag: "고수익형", type: "officetel" },
      { id: "S3", name: "다가구주택 신축매매", shortName: "S3", tag: "회수형", type: "multi-family" },
      { id: "S4", name: "근린생활시설", shortName: "S4", tag: "보수형", type: "retail" },
    ];
  }

  // 200평 이상: 기존 4종 그대로
  return zoningPicks;
}

export function generateScenariosForParcel(
  parcel: Parcel,
  options: GenerateOptions = {}
): Scenario[] {
  const tier = pricingTier(parcel.address);
  const zoningPicks = pickScenariosForZoning(parcel.zoning);
  // Smart Picker: 부지 크기 따라 시나리오 자동 조정
  const picks = pickScenariosForSize(parcel, zoningPicks);

  let filtered = picks;
  if (options.scenarioTypes && options.scenarioTypes.length > 0) {
    filtered = picks.filter((p) => options.scenarioTypes!.includes(p.type));
  }

  return filtered.map((pick) =>
    buildScenario(pick.id, pick.name, pick.shortName, pick.tag, pick.type, parcel, tier)
  );
}
