import { calcParking } from "@/lib/finance/parking";
import type { AssumptionSet, BuildingType } from "@/lib/finance/types";
import {
  resolveZoneRevenueModel,
  summarizePlanningScenario,
} from "@/lib/planning/scenario-utils";
import type {
  FloorUseType,
  FloorZone,
  PlanningCalculationParcel,
  PlanningCheck,
  PlanningEconomicsAssumptions,
  PlanningEconomicsPreview,
  PlanningParkingAssessment,
  PlanningScenario,
  PlanningScenarioCalculation,
  PlanningScenarioMetrics,
} from "@/lib/planning/types";

const WON_PER_MANWON = 10_000;
const RETAIL_AREA_PER_CAR_SQM = 134;
const CONVENTIONAL_PARKING_AREA_PER_CAR_SQM = 25;
const MECHANICAL_PARKING_AREA_PER_CAR_SQM = 16;

export interface PlanningCalculationContext {
  parcel: PlanningCalculationParcel;
  assumptions: PlanningEconomicsAssumptions;
  calculatedAt?: string;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function floorArea(floor: PlanningScenario["floorPrograms"][number]): number {
  return floor.zones.reduce((sum, zone) => sum + nonNegative(zone.areaSqm), 0);
}

function preliminaryFarZoneArea(zone: FloorZone): number {
  if (zone.useType === "parking" || zone.useType === "piloti") return 0;
  return nonNegative(zone.areaSqm);
}

function primaryResidentialType(scenario: PlanningScenario, units: number): BuildingType {
  if (scenario.primaryUse === "single-house") return "single-house";
  if (scenario.primaryUse === "multi-family") return "multi-family";
  return units <= 1 ? "single-house" : "multi-family";
}

function assessParking(
  scenario: PlanningScenario,
  residentialAreaSqm: number,
  commercialAreaSqm: number,
  unitCount: number,
  parkingAreaSqm: number
): PlanningParkingAssessment {
  const basis: string[] = [];
  const reference: string[] = [];
  let requiredCars = 0;
  let estimated = false;
  let exemptPossible = false;

  if (residentialAreaSqm > 0 || unitCount > 0) {
    const residential = calcParking(
      primaryResidentialType(scenario, unitCount),
      residentialAreaSqm,
      unitCount,
      0
    );
    requiredCars += residential.requiredCars;
    estimated ||= residential.estimated;
    exemptPossible ||= residential.exemptPossible;
    basis.push(`주거: ${residential.basis}`);
    reference.push(residential.reference);
  }

  if (commercialAreaSqm > 0) {
    const commercialCars = Math.ceil(commercialAreaSqm / RETAIL_AREA_PER_CAR_SQM);
    requiredCars += commercialCars;
    basis.push(
      `상가·업무: ${commercialAreaSqm.toFixed(1)}㎡ ÷ ${RETAIL_AREA_PER_CAR_SQM}㎡/대 → ${commercialCars}대`
    );
    reference.push("주차장법 시행령 별표1 (시설면적 기준 · 관할 조례 확인)");
  }

  const providedCars = Math.max(0, Math.floor(scenario.parking.providedCars));
  const shortfallCars = Math.max(0, requiredCars - providedCars);
  const programBasedStrategy = ["piloti", "basement", "mechanical", "mixed"].includes(
    scenario.parking.strategy
  );
  const areaPerCar =
    scenario.parking.strategy === "mechanical"
      ? MECHANICAL_PARKING_AREA_PER_CAR_SQM
      : CONVENTIONAL_PARKING_AREA_PER_CAR_SQM;
  const estimatedCapacityFromProgram =
    programBasedStrategy && parkingAreaSqm > 0
      ? Math.floor(parkingAreaSqm / areaPerCar)
      : null;

  return {
    requiredCars,
    providedCars,
    shortfallCars,
    estimatedCapacityFromProgram,
    estimated,
    exemptPossible,
    basis,
    reference: unique(reference),
  };
}

function salePriceForUse(
  useType: FloorUseType,
  assumptions: PlanningEconomicsAssumptions
): number {
  if (useType === "retail" || useType === "office") {
    return nonNegative(assumptions.commercialSalePricePerSqmWon);
  }
  return nonNegative(assumptions.residentialSalePricePerSqmWon);
}

function rentForUse(
  useType: FloorUseType,
  assumptions: PlanningEconomicsAssumptions
): number {
  if (useType === "retail") return nonNegative(assumptions.retailRentPerSqmMonthWon);
  if (useType === "office") return nonNegative(assumptions.officeRentPerSqmMonthWon);
  return nonNegative(assumptions.residentialRentPerSqmMonthWon);
}

function calculateEconomics(
  scenario: PlanningScenario,
  parcel: PlanningCalculationParcel,
  assumptions: PlanningEconomicsAssumptions,
  aboveGroundAreaSqm: number,
  basementAreaSqm: number,
  calculatedAt?: string
): PlanningEconomicsPreview {
  const weightedConstructionAreaSqm =
    aboveGroundAreaSqm +
    basementAreaSqm * Math.max(1, assumptions.basementCostMultiplier);
  const constructionCostManwon =
    (weightedConstructionAreaSqm * nonNegative(assumptions.constructionCostPerSqmWon)) /
    WON_PER_MANWON;
  const softCostManwon =
    constructionCostManwon * (nonNegative(assumptions.softCostRatePct) / 100);
  const contingencyCostManwon =
    (constructionCostManwon + softCostManwon) *
    (nonNegative(assumptions.contingencyRatePct) / 100);
  const financingCostManwon =
    (constructionCostManwon + softCostManwon + contingencyCostManwon) *
    (nonNegative(assumptions.financingCostRatePct) / 100);

  let saleRevenueWon = 0;
  let annualNoiWon = 0;
  const vacancyFactor = 1 - Math.min(100, nonNegative(assumptions.vacancyRatePct)) / 100;

  for (const floor of scenario.floorPrograms) {
    for (const zone of floor.zones) {
      const area = nonNegative(zone.areaSqm);
      const model = resolveZoneRevenueModel(zone);
      if (model === "sale") {
        const saleable = Math.min(area, nonNegative(zone.saleableAreaSqm ?? area));
        saleRevenueWon += saleable * salePriceForUse(zone.useType, assumptions);
      }
      if (model === "lease") {
        const rentable = Math.min(area, nonNegative(zone.rentableAreaSqm ?? area));
        annualNoiWon +=
          rentable * rentForUse(zone.useType, assumptions) * 12 * vacancyFactor;
      }
    }
  }

  const capRate = nonNegative(assumptions.capRatePct);
  const capitalizedLeaseValueWon = capRate > 0 ? annualNoiWon / (capRate / 100) : 0;
  const saleRevenueManwon = saleRevenueWon / WON_PER_MANWON;
  const expectedAnnualNoiManwon = annualNoiWon / WON_PER_MANWON;
  const capitalizedLeaseValueManwon = capitalizedLeaseValueWon / WON_PER_MANWON;
  const expectedRevenueManwon = saleRevenueManwon + capitalizedLeaseValueManwon;

  const acquisitionCostManwon = nonNegative(parcel.acquisitionCostManwon);
  const demolitionCostManwon = nonNegative(parcel.demolitionCostManwon);
  const totalCostManwon =
    acquisitionCostManwon +
    demolitionCostManwon +
    constructionCostManwon +
    softCostManwon +
    contingencyCostManwon +
    financingCostManwon;
  const profitManwon = expectedRevenueManwon - totalCostManwon;
  const profitMarginPct =
    expectedRevenueManwon > 0 ? (profitManwon / expectedRevenueManwon) * 100 : 0;

  return {
    status: "estimated",
    acquisitionCostManwon: round(acquisitionCostManwon),
    demolitionCostManwon: round(demolitionCostManwon),
    constructionCostManwon: round(constructionCostManwon),
    softCostManwon: round(softCostManwon),
    contingencyCostManwon: round(contingencyCostManwon),
    financingCostManwon: round(financingCostManwon),
    totalCostManwon: round(totalCostManwon),
    saleRevenueManwon: round(saleRevenueManwon),
    capitalizedLeaseValueManwon: round(capitalizedLeaseValueManwon),
    expectedRevenueManwon: round(expectedRevenueManwon),
    expectedAnnualNoiManwon: round(expectedAnnualNoiManwon),
    profitManwon: round(profitManwon),
    profitMarginPct: round(profitMarginPct, 1),
    assumptionsVersion: assumptions.version,
    calculatedAt: calculatedAt ?? new Date().toISOString(),
  };
}

function buildChecks(
  scenario: PlanningScenario,
  parcel: PlanningCalculationParcel,
  metrics: PlanningScenarioMetrics,
  parking: PlanningParkingAssessment,
  economics: PlanningEconomicsPreview,
  assumptions: PlanningEconomicsAssumptions
): PlanningCheck[] {
  const checks: PlanningCheck[] = [];
  const levelCounts = new Map<number, number>();
  scenario.floorPrograms.forEach((floor) => {
    levelCounts.set(floor.level, (levelCounts.get(floor.level) ?? 0) + 1);
  });
  const duplicateLevels = [...levelCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([level]) => level);

  checks.push({
    code: "floor-levels",
    label: "층 구성",
    status: duplicateLevels.length > 0 ? "fail" : "pass",
    message:
      duplicateLevels.length > 0
        ? `중복된 층 레벨이 있습니다: ${duplicateLevels.join(", ")}`
        : `${metrics.aboveGroundFloors}개 지상 레벨 · ${metrics.undergroundFloors}개 지하 레벨`,
    source: "층별 프로그램",
  });

  const emptyFloors = scenario.floorPrograms.filter(
    (floor) => floor.zones.length === 0 || floorArea(floor) <= 0
  );
  if (emptyFloors.length > 0) {
    checks.push({
      code: "empty-floors",
      label: "빈 층",
      status: "review",
      message: `${emptyFloors.map((floor) => floor.label).join(", ")}에 면적 프로그램이 없습니다.`,
      source: "층별 프로그램",
    });
  }

  const overLotFloors = scenario.floorPrograms.filter(
    (floor) => floor.level > 0 && floorArea(floor) > parcel.lotAreaSqm * 1.01
  );
  if (overLotFloors.length > 0) {
    checks.push({
      code: "floor-area-vs-lot",
      label: "층 면적",
      status: "fail",
      message: `${overLotFloors.map((floor) => floor.label).join(", ")} 면적이 대지면적보다 큽니다.`,
      source: "대지면적 대비 층별 프로그램",
    });
  }

  checks.push({
    code: "bcr",
    label: "예비 건폐율",
    status: metrics.preliminaryBcrPct <= parcel.maxBCRPct + 0.01 ? "pass" : "fail",
    message: `${metrics.preliminaryBcrPct.toFixed(1)}% / 상한 ${parcel.maxBCRPct.toFixed(1)}% · 실제 수평투영면적은 배치 3D에서 재검토`,
    source: "층별 최대 외곽면적 ÷ 대지면적",
  });

  checks.push({
    code: "far",
    label: "예비 용적률",
    status: metrics.preliminaryFarPct <= parcel.maxFARPct + 0.01 ? "pass" : "fail",
    message: `${metrics.preliminaryFarPct.toFixed(1)}% / 상한 ${parcel.maxFARPct.toFixed(1)}% · 지상 주차·필로티 제외 예비값`,
    source: "예비 용적률 산입면적 ÷ 대지면적",
  });

  if (parcel.heightLimitM > 0) {
    checks.push({
      code: "height",
      label: "높이",
      status: metrics.totalHeightM <= parcel.heightLimitM + 0.01 ? "pass" : "fail",
      message: `${metrics.totalHeightM.toFixed(1)}m / 높이 한도 ${parcel.heightLimitM.toFixed(1)}m`,
      source: "층고 합계 · 높이 한도",
    });
  } else {
    checks.push({
      code: "height",
      label: "높이",
      status: "unknown",
      message: `계획 높이 ${metrics.totalHeightM.toFixed(1)}m · 별도 높이 한도 미확인`,
      source: "층고 합계",
    });
  }

  checks.push({
    code: "parking",
    label: "주차",
    status:
      parking.shortfallCars > 0
        ? "fail"
        : parking.exemptPossible && parking.requiredCars === 0
          ? "review"
          : "pass",
    message:
      parking.shortfallCars > 0
        ? `예상 의무 ${parking.requiredCars}대 · 계획 ${parking.providedCars}대 · ${parking.shortfallCars}대 부족`
        : parking.exemptPossible && parking.requiredCars === 0
          ? `예상 의무 0대 · 면제 가능성은 관할 조례 최종 확인 필요`
          : `예상 의무 ${parking.requiredCars}대 · 계획 ${parking.providedCars}대`,
    source: parking.reference.join(" · "),
  });

  if (
    parking.estimatedCapacityFromProgram != null &&
    parking.providedCars > parking.estimatedCapacityFromProgram
  ) {
    checks.push({
      code: "parking-area-capacity",
      label: "주차 배치 면적",
      status: "review",
      message: `입력 주차 ${parking.providedCars}대가 프로그램 면적 기준 개략 수용 ${parking.estimatedCapacityFromProgram}대를 초과합니다.`,
      source: "일반식 25㎡/대 · 기계식 16㎡/대 개략 검토",
    });
  }

  const invalidRevenueAreas = scenario.floorPrograms.flatMap((floor) =>
    floor.zones.filter(
      (zone) =>
        (zone.saleableAreaSqm ?? 0) > zone.areaSqm + 0.01 ||
        (zone.rentableAreaSqm ?? 0) > zone.areaSqm + 0.01
    )
  );
  if (invalidRevenueAreas.length > 0) {
    checks.push({
      code: "revenue-area",
      label: "수익 면적",
      status: "review",
      message: `${invalidRevenueAreas.length}개 구역의 매각·임대 면적이 구역 면적을 초과해 계산 시 상한 처리했습니다.`,
      source: "층별 수익 면적",
    });
  }

  if (metrics.rentableAreaSqm > 0 && assumptions.capRatePct <= 0) {
    checks.push({
      code: "cap-rate",
      label: "임대 수익 환산",
      status: "fail",
      message: "임대 구역이 있지만 Cap rate가 0이어서 자산가치를 계산할 수 없습니다.",
      source: "사업성 가정",
    });
  }

  checks.push({
    code: "economics-preview",
    label: "개략 사업성",
    status: economics.expectedRevenueManwon > 0 ? "pass" : "review",
    message:
      economics.expectedRevenueManwon > 0
        ? `예상 매출 ${economics.expectedRevenueManwon.toFixed(0)}만원 · 예상 이익 ${economics.profitManwon.toFixed(0)}만원`
        : "수익 방식 또는 매각·임대 단가를 입력해야 예상 매출을 계산할 수 있습니다.",
    source: `Stage 2 개략 계산 · ${assumptions.version}`,
  });

  return checks;
}

export function planningEconomicsAssumptionsFromLegacy(
  assumptions: AssumptionSet,
  version = "legacy-assumptions-v1"
): PlanningEconomicsAssumptions {
  const financingCostRatePct =
    nonNegative(assumptions.interestRate) *
    (nonNegative(assumptions.constructionMonths) / 12) *
    (nonNegative(assumptions.ltcTarget) / 100) *
    0.5;

  return {
    version,
    constructionCostPerSqmWon: nonNegative(assumptions.constCostPerSqM),
    basementCostMultiplier: 1.25,
    softCostRatePct: nonNegative(assumptions.softCostRate),
    contingencyRatePct: nonNegative(assumptions.contingencyRate),
    financingCostRatePct,
    residentialSalePricePerSqmWon: nonNegative(assumptions.salePricePerSqM),
    commercialSalePricePerSqmWon: nonNegative(assumptions.salePricePerSqM),
    residentialRentPerSqmMonthWon: nonNegative(assumptions.rentPerSqMMonth),
    retailRentPerSqmMonthWon: nonNegative(assumptions.rentPerSqMMonth) * 1.2,
    officeRentPerSqmMonthWon: nonNegative(assumptions.rentPerSqMMonth),
    vacancyRatePct: nonNegative(assumptions.vacancyRate),
    capRatePct: nonNegative(assumptions.capRate),
  };
}

export function calculatePlanningScenario(
  scenario: PlanningScenario,
  context: PlanningCalculationContext
): PlanningScenarioCalculation {
  const { parcel, assumptions } = context;
  const summary = summarizePlanningScenario(scenario);
  const aboveFloors = scenario.floorPrograms.filter((floor) => floor.level > 0);
  const basementFloors = scenario.floorPrograms.filter((floor) => floor.level < 0);
  const aboveGroundProgramAreaSqm = aboveFloors.reduce(
    (sum, floor) => sum + floorArea(floor),
    0
  );
  const basementProgramAreaSqm = basementFloors.reduce(
    (sum, floor) => sum + floorArea(floor),
    0
  );
  const preliminaryFarAreaSqm = aboveFloors.reduce(
    (sum, floor) =>
      sum + floor.zones.reduce((floorSum, zone) => floorSum + preliminaryFarZoneArea(zone), 0),
    0
  );
  const gradeFootprintAreaSqm = aboveFloors.reduce(
    (max, floor) => Math.max(max, floorArea(floor)),
    0
  );
  const totalHeightM = aboveFloors.reduce(
    (sum, floor) => sum + nonNegative(floor.floorHeightM),
    0
  );

  const parking = assessParking(
    scenario,
    summary.residentialAreaSqm,
    summary.commercialAreaSqm,
    summary.unitCount,
    summary.parkingAreaSqm
  );

  const metrics: PlanningScenarioMetrics = {
    ...summary,
    gradeFootprintAreaSqm,
    constructionAreaSqm: aboveGroundProgramAreaSqm + basementProgramAreaSqm,
    aboveGroundProgramAreaSqm,
    basementProgramAreaSqm,
    preliminaryFarAreaSqm,
    preliminaryBcrPct:
      parcel.lotAreaSqm > 0 ? (gradeFootprintAreaSqm / parcel.lotAreaSqm) * 100 : 0,
    preliminaryFarPct:
      parcel.lotAreaSqm > 0 ? (preliminaryFarAreaSqm / parcel.lotAreaSqm) * 100 : 0,
    totalHeightM,
    requiredCars: parking.requiredCars,
    parkingShortfallCars: parking.shortfallCars,
  };

  const economicsPreview = calculateEconomics(
    scenario,
    parcel,
    assumptions,
    aboveGroundProgramAreaSqm,
    basementProgramAreaSqm,
    context.calculatedAt
  );
  const checks = buildChecks(
    scenario,
    parcel,
    metrics,
    parking,
    economicsPreview,
    assumptions
  );

  return {
    scenarioId: scenario.id,
    metrics: {
      ...metrics,
      totalProgramAreaSqm: round(metrics.totalProgramAreaSqm),
      gradeFootprintAreaSqm: round(metrics.gradeFootprintAreaSqm),
      residentialAreaSqm: round(metrics.residentialAreaSqm),
      commercialAreaSqm: round(metrics.commercialAreaSqm),
      parkingAreaSqm: round(metrics.parkingAreaSqm),
      commonAreaSqm: round(metrics.commonAreaSqm),
      saleableAreaSqm: round(metrics.saleableAreaSqm),
      rentableAreaSqm: round(metrics.rentableAreaSqm),
      constructionAreaSqm: round(metrics.constructionAreaSqm),
      aboveGroundProgramAreaSqm: round(metrics.aboveGroundProgramAreaSqm),
      basementProgramAreaSqm: round(metrics.basementProgramAreaSqm),
      preliminaryFarAreaSqm: round(metrics.preliminaryFarAreaSqm),
      preliminaryBcrPct: round(metrics.preliminaryBcrPct, 1),
      preliminaryFarPct: round(metrics.preliminaryFarPct, 1),
      totalHeightM: round(metrics.totalHeightM, 1),
    },
    parking,
    checks,
    economicsPreview,
  };
}

export function applyPlanningScenarioCalculation(
  scenario: PlanningScenario,
  calculation: PlanningScenarioCalculation
): PlanningScenario {
  if (scenario.id !== calculation.scenarioId) return scenario;
  return {
    ...scenario,
    checks: calculation.checks,
    economicsPreview: calculation.economicsPreview,
  };
}
