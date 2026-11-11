import {
  createRevenuePricingSnapshot,
  DEFAULT_OPERATING_EXPENSE_RATE_PCT,
  DEFAULT_STABILIZATION_FACTOR_PCT,
  revenuePricingFromAssumptions,
  valueRevenueAreaPools,
} from "@/lib/finance/revenue-contract";
import type {
  AssumptionSet,
  FinancialRevenueProjectionSnapshot,
} from "@/lib/finance/types";
import {
  calculateParkingRequirement,
  type ParkingExclusiveAreaStatus,
  type ParkingUseInput,
} from "@/lib/regulatory/parking-rules";
import {
  constraintStatusLabel,
  regulatoryConstraintIsDecisionGrade,
  type RegulatoryConstraintEvidence,
} from "@/lib/regulatory/constraints";
import {
  summarizePlanningScenario,
} from "@/lib/planning/scenario-utils";
import { additionalDwellingCostManwon } from "@/lib/planning/dwelling-program";
import { evaluateQuantityCost } from "@/lib/planning/quantity-cost";
import { quantityCostPlanBasis } from "@/lib/planning/quantity-cost-contract";
import { layoutFinancePlanningCheck } from "@/lib/planning/layout-finance-state";
import { applyDwellingSalePricing } from "@/lib/planning/dwelling-pricing";
import { screenZoningUse } from "@/lib/regulatory/zoning-use-screening";
import {
  planningRevenueAreas,
  unsupportedRevenueZones,
} from "@/lib/planning/revenue-pools";
import {
  evaluateSunlightRegulation,
  type SunlightInputStatus,
  type SunlightLegalUse,
  type SunlightRegulationResult,
} from "@/lib/regulatory/sunlight-rules";
import {
  calculatePlanningMaterialAdjustment,
  PLANNING_FACADE_LABELS,
  resolvePlanningMaterials,
} from "@/lib/planning/materials";
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
const CONVENTIONAL_PARKING_AREA_PER_CAR_SQM = 25;
const MECHANICAL_PARKING_AREA_PER_CAR_SQM = 16;
const DEFAULT_ROOF_ALLOWANCE_M = 1.4;

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

function primaryResidentialType(
  scenario: PlanningScenario,
  units: number
): "single-house" | "multi-family" {
  if (scenario.primaryUse === "single-house") return "single-house";
  if (scenario.primaryUse === "multi-family") return "multi-family";
  return units <= 1 ? "single-house" : "multi-family";
}

function sunlightLegalUseForScenario(scenario: PlanningScenario): {
  legalUse: SunlightLegalUse;
  status: SunlightInputStatus;
} {
  if (scenario.sunlightLegalUse) {
    return {
      legalUse: scenario.sunlightLegalUse,
      status: scenario.sunlightLegalUseStatus ?? "user-entered",
    };
  }

  if (scenario.primaryUse === "single-house") {
    return { legalUse: "detached-house", status: "source-backed" };
  }
  if (scenario.primaryUse === "multi-family") {
    // 기존 UI의 "다가구·다세대" 선택은 단독주택과 공동주택을 함께 뜻한다.
    return { legalUse: "unknown-residential", status: "user-entered" };
  }
  if (scenario.primaryUse === "mixed") {
    const hasResidential = scenario.floorPrograms.some((floor) =>
      floor.zones.some((zone) => zone.useType === "residential")
    );
    return hasResidential
      ? { legalUse: "unknown-residential", status: "user-entered" }
      : { legalUse: "general-building", status: "source-backed" };
  }
  return { legalUse: "general-building", status: "source-backed" };
}

function assessSunlight(
  scenario: PlanningScenario,
  parcel: PlanningCalculationParcel,
  buildingHeightM: number,
  floorsAbove: number
): SunlightRegulationResult {
  const legalUse = sunlightLegalUseForScenario(scenario);
  return evaluateSunlightRegulation({
    context: {
      address: parcel.address,
      asOf: parcel.sunlightRuleAsOf,
    },
    zoning: parcel.zoning,
    zoningStatus: parcel.zoningStatus,
    buildingHeightM,
    floorsAbove,
    legalUse: legalUse.legalUse,
    legalUseStatus: legalUse.status,
    northBoundary: parcel.sunlightNorthBoundary,
    daylight: {
      sameLotBuildingCount: 1,
      sameLotBuildingCountStatus: "source-backed",
      ...parcel.sunlightDaylight,
    },
  });
}

function assessParking(
  scenario: PlanningScenario,
  parkingAreaSqm: number,
  context: Pick<PlanningCalculationParcel, "address" | "parkingRuleAsOf">
): PlanningParkingAssessment {
  const zones = scenario.floorPrograms.flatMap((floor) => floor.zones);
  const residentialZones = zones.filter((zone) => zone.useType === "residential");
  const areaFor = (...useTypes: FloorUseType[]) =>
    zones
      .filter((zone) => useTypes.includes(zone.useType))
      .reduce((sum, zone) => sum + nonNegative(zone.areaSqm), 0);
  const baseAreas = {
    residential: areaFor("residential"),
    retail: areaFor("retail"),
    office: areaFor("office"),
    other: areaFor("storage", "other"),
  };
  const allocatableCommonAreaSqm = areaFor("common", "mechanical");
  const allocationBase = Object.values(baseAreas).reduce(
    (sum, area) => sum + area,
    0
  );
  const facilityArea = (area: number) =>
    area +
    (allocationBase > 0
      ? allocatableCommonAreaSqm * (area / allocationBase)
      : 0);

  const unitCount = residentialZones.reduce(
    (sum, zone) => sum + Math.max(0, Math.floor(zone.unitCount)),
    0
  );
  const hasCompleteExclusiveArea =
    residentialZones.length > 0 &&
    residentialZones.every(
      (zone) =>
        Number.isFinite(zone.parkingExclusiveAreaSqm) &&
        Number(zone.parkingExclusiveAreaSqm) > 0 &&
        zone.parkingExclusiveAreaStatus != null
    );
  const exclusiveAreaSqm = hasCompleteExclusiveArea
    ? residentialZones.reduce(
        (sum, zone) => sum + nonNegative(zone.parkingExclusiveAreaSqm ?? 0),
        0
      )
    : undefined;
  const exclusiveAreaStatuses = residentialZones
    .map((zone) => zone.parkingExclusiveAreaStatus)
    .filter((status): status is ParkingExclusiveAreaStatus => status != null);
  const exclusiveAreaStatus = hasCompleteExclusiveArea
    ? exclusiveAreaStatuses.includes("user-entered")
      ? "user-entered"
      : exclusiveAreaStatuses.includes("source-backed")
        ? "source-backed"
        : "expert-approved"
    : undefined;
  const uses: ParkingUseInput[] = [];

  if (baseAreas.residential > 0) {
    uses.push({
      use: primaryResidentialType(scenario, unitCount),
      facilityAreaSqm: facilityArea(baseAreas.residential),
      unitCount,
      exclusiveAreaSqm,
      exclusiveAreaStatus,
      dwellingGroups: hasCompleteExclusiveArea
        ? residentialZones.map((zone) => ({
            unitCount: zone.unitCount,
            exclusiveAreaPerUnitSqm: (zone.parkingExclusiveAreaSqm ?? 0) / zone.unitCount,
            estimated: zone.unitCount !== 1,
          }))
        : undefined,
    });
  }
  if (baseAreas.retail > 0) {
    uses.push({ use: "retail", facilityAreaSqm: facilityArea(baseAreas.retail) });
  }
  if (baseAreas.office > 0) {
    uses.push({ use: "office", facilityAreaSqm: facilityArea(baseAreas.office) });
  }
  if (baseAreas.other > 0 || (allocationBase === 0 && allocatableCommonAreaSqm > 0)) {
    uses.push({
      use: "other",
      facilityAreaSqm:
        facilityArea(baseAreas.other) +
        (allocationBase === 0 ? allocatableCommonAreaSqm : 0),
    });
  }

  const requirement = calculateParkingRequirement({
    context: {
      address: context.address,
      asOf: context.parkingRuleAsOf,
    },
    uses,
  });
  const invalidExclusiveArea = residentialZones.some(
    (zone) =>
      zone.parkingExclusiveAreaSqm != null &&
      zone.parkingExclusiveAreaSqm > zone.areaSqm + 0.01
  );
  const warnings = invalidExclusiveArea
    ? [
        ...requirement.warnings,
        "주차 산정용 주거 전용면적이 해당 주거 구역 면적을 초과합니다.",
      ]
    : requirement.warnings;

  const providedCars = Math.max(0, Math.floor(scenario.parking.providedCars));
  const shortfallCars = Math.max(0, requirement.requiredCars - providedCars);
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
    requiredCars: requirement.requiredCars,
    providedCars,
    shortfallCars,
    estimatedCapacityFromProgram,
    estimated: requirement.estimated,
    exemptPossible: requirement.exemptPossible,
    basis: requirement.basis,
    reference: unique(requirement.references),
    decisionGrade: requirement.decisionGrade && !invalidExclusiveArea,
    warnings,
    rule: requirement.rule,
    components: requirement.components,
  };
}

function calculateEconomics(
  scenario: PlanningScenario,
  parcel: PlanningCalculationParcel,
  assumptions: PlanningEconomicsAssumptions,
  aboveGroundAreaSqm: number,
  basementAreaSqm: number,
  calculatedAt?: string
): {
  preview: PlanningEconomicsPreview;
  revenueProjection: FinancialRevenueProjectionSnapshot;
  quantityCost: ReturnType<typeof evaluateQuantityCost>;
} {
  const weightedConstructionAreaSqm =
    aboveGroundAreaSqm +
    basementAreaSqm * Math.max(1, assumptions.basementCostMultiplier);
  const baseConstructionCostManwon =
    (weightedConstructionAreaSqm * nonNegative(assumptions.constructionCostPerSqmWon)) /
    WON_PER_MANWON;
  const materialAdjustment = calculatePlanningMaterialAdjustment(scenario);
  const dwellingCostManwon = additionalDwellingCostManwon(scenario.floorPrograms, scenario.dwellingProgram);
  const quantityCost = evaluateQuantityCost(scenario, {
    constructionCostPerSqmWon: assumptions.constructionCostPerSqmWon,
    basementCostMultiplier: assumptions.basementCostMultiplier,
  });
  const quantityCostReady =
    quantityCost.status === "ready" &&
    quantityCost.contract !== null &&
    quantityCost.adjustmentManwon !== null &&
    Number.isFinite(quantityCost.adjustmentManwon);
  const quantityCostAdjustmentManwon = quantityCostReady
    ? quantityCost.adjustmentManwon!
    : 0;
  const invalidQuantityCost = scenario.quantityCost !== undefined && !quantityCostReady;
  const constructionCostManwon = Math.max(
    0,
    baseConstructionCostManwon + materialAdjustment.adjustmentManwon + dwellingCostManwon +
      quantityCostAdjustmentManwon
  );
  const softCostManwon =
    constructionCostManwon * (nonNegative(assumptions.softCostRatePct) / 100);
  const contingencyCostManwon =
    (constructionCostManwon + softCostManwon) *
    (nonNegative(assumptions.contingencyRatePct) / 100);
  const interestEstimateManwon =
    (constructionCostManwon + softCostManwon + contingencyCostManwon) *
    (nonNegative(assumptions.financingCostRatePct) / 100);
  const pfCommitmentManwon =
    (constructionCostManwon + softCostManwon + contingencyCostManwon) *
    (nonNegative(assumptions.ltcTargetPct) / 100);
  const pfFeeManwon =
    pfCommitmentManwon *
    (nonNegative(assumptions.pfUpfrontFeeRatePct) / 100);
  const trustFeeManwon = nonNegative(assumptions.trustFeeManwon);
  const financingCostManwon =
    interestEstimateManwon + pfFeeManwon + trustFeeManwon;

  const residentialRent = nonNegative(
    assumptions.residentialRentPerSqmMonthWon
  );
  const pricing = assumptions.revenuePricing ?? createRevenuePricingSnapshot({
    assumptionsVersion: assumptions.version,
    unitPricesWon: {
      residentialSale: nonNegative(
        assumptions.residentialSalePricePerSqmWon
      ),
      retailSale: nonNegative(assumptions.commercialSalePricePerSqmWon),
      officeSale: nonNegative(assumptions.commercialSalePricePerSqmWon),
      residentialLease: residentialRent,
      retailLease:
        residentialRent > 0
          ? residentialRent
          : nonNegative(assumptions.retailRentPerSqmMonthWon),
      officeLease:
        residentialRent > 0
          ? residentialRent
          : nonNegative(assumptions.officeRentPerSqmMonthWon),
    },
    vacancyRatePct: assumptions.vacancyRatePct,
    operatingExpenseRatePct: assumptions.operatingExpenseRatePct,
    capRatePct: assumptions.capRatePct,
    stabilizationFactorPct: DEFAULT_STABILIZATION_FACTOR_PCT,
    adjustmentFactors: {
      retailLease:
        residentialRent > 0
          ? nonNegative(assumptions.retailRentPerSqmMonthWon) /
            residentialRent
          : 1,
      officeLease:
        residentialRent > 0
          ? nonNegative(assumptions.officeRentPerSqmMonthWon) /
            residentialRent
          : 1,
    },
  });
  const revenueProjection = valueRevenueAreaPools(
    planningRevenueAreas(scenario),
    applyDwellingSalePricing(scenario, pricing)
  );
  const saleRevenueManwon = revenueProjection.saleRevenueManwon;
  const expectedAnnualNoiManwon = revenueProjection.annualNoiManwon;
  const capitalizedLeaseValueManwon =
    revenueProjection.capitalizedLeaseValueManwon;
  const expectedRevenueManwon = revenueProjection.totalRevenueManwon;

  const acquisitionCostManwon = nonNegative(parcel.acquisitionCostManwon);
  const acquisitionTaxManwon = nonNegative(
    assumptions.acquisitionTaxManwon
  );
  const acquisitionOtherCostManwon = nonNegative(
    assumptions.acquisitionOtherCostManwon
  );
  const demolitionCostManwon = nonNegative(parcel.demolitionCostManwon);
  const tenantRelocationCostManwon = nonNegative(
    assumptions.tenantRelocationCostManwon
  );
  const totalCostManwon =
    acquisitionCostManwon +
    acquisitionTaxManwon +
    acquisitionOtherCostManwon +
    demolitionCostManwon +
    tenantRelocationCostManwon +
    constructionCostManwon +
    softCostManwon +
    contingencyCostManwon +
    financingCostManwon;
  const profitManwon = expectedRevenueManwon - totalCostManwon;
  const profitMarginPct =
    expectedRevenueManwon > 0 ? (profitManwon / expectedRevenueManwon) * 100 : 0;

  return {
    preview: {
      status: invalidQuantityCost ? "stale" : "estimated",
      acquisitionCostManwon: round(acquisitionCostManwon),
      acquisitionTaxManwon: round(acquisitionTaxManwon),
      acquisitionOtherCostManwon: round(acquisitionOtherCostManwon),
      demolitionCostManwon: round(demolitionCostManwon),
      tenantRelocationCostManwon: round(tenantRelocationCostManwon),
      constructionCostManwon: round(constructionCostManwon),
      baseConstructionCostManwon: round(baseConstructionCostManwon),
      materialAdjustmentCostManwon: round(
        materialAdjustment.adjustmentManwon
      ),
      additionalDwellingCostManwon: round(dwellingCostManwon),
      ...(scenario.quantityCost !== undefined ? {
        quantityCostInputBasis: quantityCostPlanBasis(scenario.quantityCost) ?? undefined,
        quantityCostStatus: quantityCost.status === "ready" && !quantityCostReady
          ? "conflict" as const
          : quantityCost.status,
        quantityCostAdjustmentManwon: quantityCostReady
          ? round(quantityCostAdjustmentManwon)
          : undefined,
      } : {}),
      residentialFallbackUnitPriceWon: pricing.pools.residentialSale.unitPriceWon,
      facadeAreaSqm: round(materialAdjustment.facadeAreaSqm),
      materialCostStatus: materialAdjustment.priced
        ? materialAdjustment.evidenceStatus === "source-backed" &&
          materialAdjustment.areaBasis === "user-input"
          ? "source-backed"
          : materialAdjustment.areaBasis === "user-input"
            ? "user-input"
            : "estimated"
        : "unpriced",
      materialCostSource: materialAdjustment.sourceLabel,
      softCostManwon: round(softCostManwon),
      contingencyCostManwon: round(contingencyCostManwon),
      financingCostManwon: round(financingCostManwon),
      interestEstimateManwon: round(interestEstimateManwon),
      pfFeeManwon: round(pfFeeManwon),
      trustFeeManwon: round(trustFeeManwon),
      totalCostManwon: round(totalCostManwon),
      saleRevenueManwon: round(saleRevenueManwon),
      capitalizedLeaseValueManwon: round(capitalizedLeaseValueManwon),
      expectedRevenueManwon: round(expectedRevenueManwon),
      expectedAnnualNoiManwon: round(expectedAnnualNoiManwon),
      profitManwon: round(profitManwon),
      profitMarginPct: round(profitMarginPct, 1),
      costInputs: {
        constructionCostPerSqmWon: nonNegative(
          assumptions.constructionCostPerSqmWon
        ),
        basementCostMultiplier: Math.max(
          1,
          nonNegative(assumptions.basementCostMultiplier)
        ),
        softCostRatePct: nonNegative(assumptions.softCostRatePct),
        contingencyRatePct: nonNegative(assumptions.contingencyRatePct),
        financingCostRatePct: nonNegative(assumptions.financingCostRatePct),
        acquisitionTaxManwon,
        acquisitionOtherCostManwon,
        tenantRelocationCostManwon,
        pfUpfrontFeeRatePct: nonNegative(
          assumptions.pfUpfrontFeeRatePct
        ),
        trustFeeManwon,
        ltcTargetPct: nonNegative(assumptions.ltcTargetPct),
      },
      assumptionsVersion: assumptions.version,
      calculatedAt: calculatedAt ?? new Date().toISOString(),
    },
    revenueProjection,
    quantityCost,
  };
}

function buildChecks(
  scenario: PlanningScenario,
  parcel: PlanningCalculationParcel,
  metrics: PlanningScenarioMetrics,
  parking: PlanningParkingAssessment,
  sunlight: SunlightRegulationResult,
  economics: PlanningEconomicsPreview,
  assumptions: PlanningEconomicsAssumptions,
  quantityCost: ReturnType<typeof evaluateQuantityCost>
): PlanningCheck[] {
  const checks: PlanningCheck[] = [];
  if (scenario.quantityCost !== undefined) {
    const ready = economics.quantityCostStatus === "ready";
    checks.push({
      code: "quantity-cost",
      label: "상세 수량·공사비",
      status: ready ? "review" : "fail",
      message: ready
        ? "상세 수량 대체 원가에서 기본 공사비 포함액을 차감해 반영했습니다. 예비 산정이며 견적·전문가 검토는 미확정입니다."
        : `상세 수량 원가를 반영할 수 없어 사업성이 미확정입니다. ${quantityCost.issues.join(" · ") || "수량·단가·기본 포함액과 현재 계획의 연결을 확인해야 합니다."}`,
      source: "상세 수량 원가 계약 · 전문가 검토 전",
    });
  }
  const layoutAdoption = layoutFinancePlanningCheck(scenario);
  if (layoutAdoption) checks.push(layoutAdoption);
  for (const floor of scenario.floorPrograms.filter(floor => floor.zones.some(zone => zone.useType === "residential"))) {
    checks.push({
      code: `interior-layout:${floor.id}`, label: `${floor.label} 실내 구획`, status: "unknown",
      message: "현재 층 외곽에 대한 실내 구획·공용부·문 연결 검증이 필요합니다.", source: "실내 구획 예비 검증",
    });
    checks.push({ code: "room-layout:" + floor.id, label: floor.label + " 상세 실·현관", status: "unknown",
      message: "방·주방·욕실 구획과 현관 연결 검증이 필요합니다.", source: "상세 실 예비 검증" });
  }
  if (scenario.floorPrograms.some(floor => floor.zones.some(zone => zone.useType === "residential"))) checks.push({
    code: "egress-core", label: "피난·층간 코어 연결", status: "unknown",
    message: "실에서 지상 출구까지의 연결·계단 예약공간 검증이 필요합니다. 법정 적합성·승인은 미확정입니다.", source: "피난·코어 예비 검증",
  });
  if (parking.requiredCars > 0 || scenario.parking.strategy !== "none") checks.push({
    code: "vehicle-circulation", label: "차량 동선", status: "review",
    message: "주차면 개수는 차량 회전·출입구 허가를 확정하지 않습니다. 내부 후보 궤적 및 공식 도로·기둥·보행 동선·전문가 검토가 필요합니다.",
    source: "차량 동선 예비 검증",
  });
  if (scenario.dwellingProgram) {
    const a = scenario.dwellingProgram;
    const valid = Number.isInteger(a.baselineDwellingCount) && a.baselineDwellingCount >= 0 &&
      Number.isFinite(a.additionalDwellingCostWon) && a.additionalDwellingCostWon >= 0 &&
      a.baseNetRatio > 0 && a.baseNetRatio < 1 &&
      Number.isFinite(a.extraCommonAreaPerSplitSqm) && a.extraCommonAreaPerSplitSqm >= 0 &&
      Number.isFinite(a.minimumCommonAreaSqm) && a.minimumCommonAreaSqm > 0;
    checks.push({
      code: "dwelling-program-assumptions", label: "세대 구성 가정",
      status: valid ? "review" : "fail",
      message: valid
        ? `세대별 전용면적·공용부는 면적 프로그램이며 실내 평면 검증 전입니다. ${a.baselineDwellingCount}세대 초과 순증비 ${(a.additionalDwellingCostWon / 10000).toLocaleString()}만원/세대 · ${a.costEvidenceStatus === "quoted" ? "견적 입력, 포함 공종 확인 필요" : "현장 견적 미확정"}`
        : "세대 구성의 전용률·공용부·추가세대 비용 입력을 확인해야 합니다.",
      source: a.costSource || "자동 탐색 가정 · 실내 평면·견적 확인 전",
    });
    const use = screenZoningUse(parcel.zoning ?? "", "multi-family", {
      address: parcel.address,
      asOf: parcel.parkingRuleAsOf ?? scenario.createdAt.slice(0, 10),
      legalUseCode: "BA-A1-2-C",
      residentialFloors: scenario.floorPrograms.filter((floor) => floor.level > 0 && floor.zones.some((zone) => zone.useType === "residential")).length,
      useAreaSqm: scenario.floorPrograms.reduce((sum, floor) => sum + floor.zones.filter((zone) => zone.useType !== "piloti").reduce((subtotal, zone) => subtotal + zone.areaSqm, 0), 0),
      householdCount: metrics.residentialUnitCount,
      aboveGroundFloors: metrics.aboveGroundFloors,
    });
    checks.push({ code: "dwelling-legal-use", label: "다세대 용도 조건",
      status: use.status === "condition-failed" || use.status === "unsupported-auto" ? "fail" : "review",
      message: `${use.basis} · 필지별 중첩 규제·허가 미확정`, source: use.sources.map((source) => source.title).join(" · ") });
    checks.push({ code: "dwelling-layout-verification", label: "실내·차량 동선 검증", status: "review",
      message: "실내 구획·차량 후보 궤적의 예비 검사는 상세 실내 설계·구조·피난·진출입 허가·전문가 승인을 대체하지 않습니다.",
      source: "자동 면적 탐색 검증 범위" });
  }
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

  const buildLimitCheck = (
    code: "bcr" | "far",
    label: string,
    actual: number,
    fallbackLimit: number,
    evidence: RegulatoryConstraintEvidence | undefined
  ): PlanningCheck => {
    const limit = evidence?.value ?? fallbackLimit;
    if (!(limit > 0)) {
      return {
        code,
        label,
        status: "unknown",
        message: `계획 ${actual.toFixed(1)}% · 필지별 적용 상한 미확인`,
        source: "관할 조례·지구단위계획 원문 필요",
      };
    }

    const decisionGrade = regulatoryConstraintIsDecisionGrade(evidence);
    const exceeds = actual > limit + 0.01;
    const nationalReferenceExceeded =
      evidence?.status === "reference-only" && exceeds;
    return {
      code,
      label,
      status: decisionGrade
        ? exceeds
          ? "fail"
          : "pass"
        : nationalReferenceExceeded
          ? "fail"
          : "review",
      message: decisionGrade
        ? `${actual.toFixed(1)}% / 확인 상한 ${limit.toFixed(1)}%`
        : nationalReferenceExceeded
          ? `${actual.toFixed(1)}% / 전국 시행령 참고 상한 ${limit.toFixed(1)}% 초과`
          : `${actual.toFixed(1)}% / 참고 상한 ${limit.toFixed(1)}% · 필지별 원문 확인 전`,
      source: evidence
        ? `${constraintStatusLabel(evidence.status)} · ${evidence.sourceName}`
        : "구버전 저장값 · 출처 미확인",
    };
  };

  checks.push(
    buildLimitCheck(
      "bcr",
      "건폐율",
      metrics.preliminaryBcrPct,
      parcel.maxBCRPct,
      parcel.regulatoryConstraints?.bcr
    )
  );

  checks.push(
    buildLimitCheck(
      "far",
      "용적률",
      metrics.preliminaryFarPct,
      parcel.maxFARPct,
      parcel.regulatoryConstraints?.far
    )
  );

  const heightEvidence = parcel.regulatoryConstraints?.height;
  if (regulatoryConstraintIsDecisionGrade(heightEvidence)) {
    const limit = heightEvidence!.value!;
    checks.push({
      code: "height",
      label: "높이",
      status: metrics.totalHeightM <= limit + 0.01 ? "pass" : "fail",
      message:
        `계획 ${metrics.totalHeightM.toFixed(1)}m = 층고 합계 ${metrics.occupiedFloorHeightM.toFixed(1)}m + 옥상 여유 ${metrics.roofAllowanceM.toFixed(1)}m / 확인 한도 ${limit.toFixed(1)}m`,
      source: `${constraintStatusLabel(heightEvidence!.status)} · ${heightEvidence!.sourceName}`,
    });
  } else {
    checks.push({
      code: "height",
      label: "높이",
      status: "unknown",
      message:
        `계획 ${metrics.totalHeightM.toFixed(1)}m = 층고 합계 ${metrics.occupiedFloorHeightM.toFixed(1)}m + 옥상 여유 ${metrics.roofAllowanceM.toFixed(1)}m · 필지별 높이 원문 미확인`,
      source: heightEvidence
        ? `${constraintStatusLabel(heightEvidence.status)} · ${heightEvidence.sourceName}`
        : parcel.heightLimitM > 0
          ? "구버전 높이 참고값은 법규 판정에서 제외"
          : "가로구역·지구단위계획·고도지구·정북일조 원문 필요",
    });
  }

  const north = sunlight.north;
  const northConfirmedFailure =
    north.complianceDecisionGrade && north.compliant === false;
  const northConfirmedPass =
    north.complianceDecisionGrade && north.compliant === true;
  checks.push({
    code: "sunlight-north",
    label: "정북일조",
    status:
      north.applicability === "not-applicable"
        ? north.requirementDecisionGrade
          ? "pass"
          : "review"
        : northConfirmedFailure
          ? "fail"
          : northConfirmedPass
            ? "pass"
            : "review",
    message:
      north.applicability === "not-applicable"
        ? north.basis.join(" · ")
        : north.effectiveDistanceM != null
          ? "계획 높이 " +
            metrics.totalHeightM.toFixed(1) +
            "m · 북측 유효 이격 " +
            north.effectiveDistanceM.toFixed(1) +
            "m 필요" +
            (north.actualDistanceM != null
              ? " · 입력 거리 " + north.actualDistanceM.toFixed(1) + "m"
              : " · 실제 배치 거리 확인 전") +
            (north.warnings[0] ? " · " + north.warnings[0] : "")
          : north.warnings.join(" · "),
    source:
      sunlight.rule.jurisdictionName +
      " · " +
      sunlight.rule.id +
      " · 시행 " +
      sunlight.rule.effectiveFrom,
  });

  if (sunlight.daylight.applicability !== "not-applicable") {
    const applicableDaylightDistances = [
      sunlight.daylight.boundary,
      sunlight.daylight.sameLot,
    ].filter(
      (assessment) =>
        assessment.applicability !== "not-applicable" &&
        assessment.effectiveDistanceM != null
    );
    const confirmedDaylightFailure = applicableDaylightDistances.some(
      (assessment) =>
        assessment.complianceDecisionGrade && assessment.compliant === false
    );
    const confirmedDaylightPass =
      applicableDaylightDistances.length > 0 &&
      applicableDaylightDistances.every(
        (assessment) =>
          assessment.complianceDecisionGrade && assessment.compliant === true
      );
    const distanceSummary = applicableDaylightDistances
      .map((assessment) =>
        assessment.effectiveDistanceM != null
          ? assessment.effectiveDistanceM.toFixed(1) + "m"
          : ""
      )
      .filter(Boolean)
      .join(" · ");
    checks.push({
      code: "sunlight-daylight",
      label: "공동주택 채광·동간거리",
      status: confirmedDaylightFailure
        ? "fail"
        : confirmedDaylightPass
          ? "pass"
          : "review",
      message:
        sunlight.daylight.applicability === "review"
          ? sunlight.daylight.warnings[0] ??
            "건축물 세부 용도와 채광창 방향을 확인해야 합니다."
          : "법정 거리 " +
            distanceSummary +
            " · 채광창 방향과 실제 배치 거리 확인 전",
      source:
        sunlight.rule.jurisdictionName +
        " · " +
        sunlight.rule.id +
        " · 건축법 제61조·시행령 제86조",
    });
  }

  const floorEvidence = parcel.regulatoryConstraints?.floors;
  if (floorEvidence?.value != null && floorEvidence.value > 0) {
    const exceeds = metrics.aboveGroundFloors > floorEvidence.value;
    const decisionGrade = regulatoryConstraintIsDecisionGrade(floorEvidence);
    checks.push({
      code: "floor-count",
      label: "층수 제한",
      status: decisionGrade ? (exceeds ? "fail" : "pass") : "review",
      message: `계획 ${metrics.aboveGroundFloors}층 / ${decisionGrade ? "확인" : "입력·참고"} 한도 ${floorEvidence.value}층`,
      source: `${constraintStatusLabel(floorEvidence.status)} · ${floorEvidence.sourceName}`,
    });
  } else {
    checks.push({
      code: "floor-count",
      label: "층수 제한",
      status: "unknown",
      message: `계획 ${metrics.aboveGroundFloors}층 · 별도 층수 지정 여부 미확인`,
      source: "지구단위계획·도시계획 결정 원문 필요",
    });
  }

  checks.push({
    code: "parking",
    label: "주차",
    status: parking.decisionGrade
      ? parking.shortfallCars > 0
        ? "fail"
        : "pass"
      : "review",
    message:
      parking.shortfallCars > 0
        ? `${parking.decisionGrade ? "확인 의무" : "예비 의무"} ${parking.requiredCars}대 · 계획 ${parking.providedCars}대 · ${parking.shortfallCars}대 부족${parking.warnings[0] ? ` · ${parking.warnings[0]}` : ""}`
        : `${parking.decisionGrade ? "확인 의무" : "예비 의무"} ${parking.requiredCars}대 · 계획 ${parking.providedCars}대${parking.warnings[0] ? ` · ${parking.warnings[0]}` : ""}`,
    source:
      `${parking.rule.jurisdictionName} · ${parking.rule.id} · 시행 ${parking.rule.effectiveFrom}` +
      ` · ${parking.reference.join(" · ")}`,
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

  const unsupportedRevenue = unsupportedRevenueZones(scenario);
  if (unsupportedRevenue.length > 0) {
    checks.push({
      code: "unsupported-revenue-use",
      label: "수익 용도",
      status: "fail",
      message: `${unsupportedRevenue.length}개 공용·주차·기계·창고·기타 구역에 매각 또는 임대가 지정됐습니다. 주거·상가·업무 구역만 수익 풀로 계산합니다.`,
      source: "stage2-finance-area-2026.2 · 여섯 수익 풀·비용 2026.2 계약",
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

  const materials = resolvePlanningMaterials(scenario.materials);
  const materialAdjustment = calculatePlanningMaterialAdjustment(scenario);
  if (materials.primaryFacadeMaterial !== "unselected") {
    const sourceBacked =
      materialAdjustment.priced &&
      materialAdjustment.areaBasis === "user-input" &&
      materialAdjustment.evidenceStatus === "source-backed";
    checks.push({
      code: "material-cost",
      label: "외장재·공사비",
      status: sourceBacked ? "pass" : "review",
      message: materialAdjustment.priced
        ? `${PLANNING_FACADE_LABELS[materials.primaryFacadeMaterial]} · 외벽 ${materialAdjustment.facadeAreaSqm.toFixed(1)}㎡ · 기준 대비 ${materialAdjustment.adjustmentManwon >= 0 ? "+" : ""}${materialAdjustment.adjustmentManwon.toFixed(0)}만원`
        : `${PLANNING_FACADE_LABELS[materials.primaryFacadeMaterial]} 3D 표현만 적용 · 기준·선택 단가 입력 전 공사비 미반영`,
      source: materialAdjustment.priced
        ? `${materialAdjustment.sourceLabel} · ${materialAdjustment.areaNote}`
        : "사용자 단가·견적 근거 필요",
    });
  }

  checks.push({
    code: "economics-preview",
    label: "개략 사업성",
    status: economics.status === "stale"
      ? "fail"
      : economics.expectedRevenueManwon > 0 ? "pass" : "review",
    message:
      economics.status === "stale"
        ? "상세 수량 원가 검증 실패로 사업성 계산이 미확정입니다. 수량 원가를 수정하고 다시 계산해야 합니다."
        : economics.expectedRevenueManwon > 0
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
    revenuePricing: revenuePricingFromAssumptions(assumptions),
    constructionCostPerSqmWon: nonNegative(assumptions.constCostPerSqM),
    basementCostMultiplier: Math.max(
      1,
      nonNegative(assumptions.basementCostMultiplier ?? 1.25)
    ),
    softCostRatePct: nonNegative(assumptions.softCostRate),
    contingencyRatePct: nonNegative(assumptions.contingencyRate),
    acquisitionTaxManwon: nonNegative(
      assumptions.acquisitionTaxManwon ?? 0
    ),
    acquisitionOtherCostManwon: nonNegative(
      assumptions.acquisitionOtherCostManwon ?? 0
    ),
    tenantRelocationCostManwon: nonNegative(
      assumptions.tenantRelocationCostManwon ?? 0
    ),
    financingCostRatePct,
    pfUpfrontFeeRatePct: nonNegative(assumptions.pfUpfrontFeeRate ?? 0),
    trustFeeManwon: nonNegative(assumptions.trustFeeManwon ?? 0),
    ltcTargetPct: nonNegative(assumptions.ltcTarget),
    residentialSalePricePerSqmWon: nonNegative(assumptions.salePricePerSqM),
    commercialSalePricePerSqmWon: nonNegative(assumptions.salePricePerSqM),
    residentialRentPerSqmMonthWon: nonNegative(assumptions.rentPerSqMMonth),
    retailRentPerSqmMonthWon: nonNegative(assumptions.rentPerSqMMonth) * 1.2,
    officeRentPerSqmMonthWon: nonNegative(assumptions.rentPerSqMMonth),
    vacancyRatePct: nonNegative(assumptions.vacancyRate),
    operatingExpenseRatePct: nonNegative(
      assumptions.operatingExpenseRate ??
        DEFAULT_OPERATING_EXPENSE_RATE_PCT
    ),
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
  const occupiedFloorHeightM = aboveFloors.reduce(
    (sum, floor) => sum + nonNegative(floor.floorHeightM),
    0
  );
  const roofAllowanceM =
    parcel.roofAllowanceM != null
      ? nonNegative(parcel.roofAllowanceM)
      : DEFAULT_ROOF_ALLOWANCE_M;
  const totalHeightM = occupiedFloorHeightM + roofAllowanceM;

  const parking = assessParking(
    scenario,
    summary.parkingAreaSqm,
    parcel
  );

  const sunlight = assessSunlight(
    scenario,
    parcel,
    totalHeightM,
    aboveFloors.length
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
    occupiedFloorHeightM,
    roofAllowanceM,
    totalHeightM,
    requiredCars: parking.requiredCars,
    parkingShortfallCars: parking.shortfallCars,
  };

  const economics = calculateEconomics(
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
    sunlight,
    economics.preview,
    assumptions,
    economics.quantityCost
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
      occupiedFloorHeightM: round(metrics.occupiedFloorHeightM, 1),
      roofAllowanceM: round(metrics.roofAllowanceM, 1),
      totalHeightM: round(metrics.totalHeightM, 1),
    },
    parking,
    sunlight,
    checks,
    economicsPreview: economics.preview,
    revenueProjection: economics.revenueProjection,
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
