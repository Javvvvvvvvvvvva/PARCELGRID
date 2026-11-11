import {
  FINANCIAL_GEOMETRY_CONTRACT_VERSION,
  STAGE2_ECONOMICS_CONTRACT_VERSION,
  type BuildingProgram,
  type BuildingType,
  type FinancialRevenueAreaPools,
} from "@/lib/finance/types";
import { resolvePlanningGeometrySource } from "@/lib/planning/geometry-source";
import { assessFullQuoteAdoption } from "./full-quote-adoption";
import { planningRevenueAreas } from "@/lib/planning/revenue-pools";
import { evaluateQuantityCost } from "@/lib/planning/quantity-cost";
import { quantityCostPlanBasis, type QuantityCostContract } from "@/lib/planning/quantity-cost-contract";
import { calculatePlanningMaterialAdjustment } from "@/lib/planning/materials";
import { additionalDwellingCostManwon } from "@/lib/planning/dwelling-program";
import { planningGeometryInputBasis, type PlanningGeometrySnapshot } from "./planning-geometry";
import type {
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

export { planningRevenueAreas } from "@/lib/planning/revenue-pools";

function buildingTypeForScenario(scenario: PlanningScenario): BuildingType {
  switch (scenario.primaryUse) {
    case "single-house":
      return "single-house";
    case "multi-family":
      return "multi-family";
    case "retail":
      return "retail";
    case "office":
      return "office";
    case "mixed":
      return "mixed";
    default:
      return "mixed";
  }
}

function fallbackMix(type: BuildingType): BuildingProgram["mix"] {
  if (type === "retail" || type === "office") {
    return { residentialSale: 0, residentialLease: 0, retail: 1 };
  }
  return { residentialSale: 1, residentialLease: 0, retail: 0 };
}

function mixFromRevenueAreas(
  type: BuildingType,
  areas: FinancialRevenueAreaPools
): BuildingProgram["mix"] {
  const saleArea =
    areas.residentialSaleSqm + areas.retailSaleSqm + areas.officeSaleSqm;
  const commercialLeaseArea = areas.retailLeaseSqm + areas.officeLeaseSqm;
  const total =
    saleArea + areas.residentialLeaseSqm + commercialLeaseArea;
  if (total <= 0) return fallbackMix(type);

  return {
    // BuildingProgram.mix is retained for legacy screens. The area contract is
    // the authoritative six-pool revenue source for all current plans.
    residentialSale: saleArea / total,
    residentialLease: areas.residentialLeaseSqm / total,
    retail: commercialLeaseArea / total,
  };
}

export interface PlanningBuildingProgramOptions {
  geometryHash?: string;
  geometry?: PlanningGeometrySnapshot;
}

function validateQuantityCostSnapshot(
  scenario: PlanningScenario,
  calculation: PlanningScenarioCalculation,
  contract: QuantityCostContract,
  adjustmentManwon: number,
  geometry?: PlanningGeometrySnapshot,
): void {
  const preview = calculation.economicsPreview;
  const inputs = preview.costInputs!;
  const basis = quantityCostPlanBasis(scenario.quantityCost);
  if (!basis || preview.quantityCostInputBasis !== basis ||
      preview.quantityCostStatus !== "ready" || preview.status !== "estimated") {
    throw new Error("Stage 2/3 상세 수량 원가와 계산 입력 기준이 다릅니다. 현재 계획을 다시 계산해야 합니다.");
  }
  const matches = (actual: unknown, expected: number, tolerance = 0.0051): boolean =>
    typeof actual === "number" && Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual - expected) <= tolerance;
  if (!matches(calculation.metrics.aboveGroundProgramAreaSqm, contract.constructionAreas.aboveGroundSqm) ||
      !matches(calculation.metrics.basementProgramAreaSqm, contract.constructionAreas.basementSqm) ||
      !matches(calculation.metrics.constructionAreaSqm, contract.constructionAreas.aboveGroundSqm + contract.constructionAreas.basementSqm)) {
    throw new Error("Stage 2/3 상세 수량 원가와 계산 면적이 다릅니다.");
  }
  if (Object.values(inputs).some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0) ||
      !Number.isFinite(preview.acquisitionCostManwon) || preview.acquisitionCostManwon < 0 ||
      !Number.isFinite(preview.demolitionCostManwon) || preview.demolitionCostManwon < 0) {
    throw new Error("Stage 2/3 상세 수량 원가의 비용 입력이 올바르지 않습니다.");
  }

  // Derive from raw amounts, not individually rounded preview components.
  const base = contract.baseConstructionCostWon / 10_000;
  const needsGeometry = preview.facadeCost?.areaBasis === "geometry-derived" ||
    Object.keys(scenario.materials?.faceAssignments ?? {}).length > 0;
  if ((needsGeometry && !geometry) || (geometry && (geometry.projectId !== scenario.projectId ||
      geometry.scenarioId !== scenario.id || geometry.scenarioVersion !== scenario.version ||
      geometry.scenarioInputBasis !== planningGeometryInputBasis(scenario)))) {
    throw new Error("Stage 2/3 외벽 원가를 검증할 현재 형상 원본이 필요합니다.");
  }
  const materialResult = calculatePlanningMaterialAdjustment(scenario, geometry);
  if (preview.facadeCost && materialResult.costKey !== preview.facadeCost.costKey) {
    throw new Error("Stage 2/3 외벽 수량·단가 비용 스냅샷이 다릅니다.");
  }
  const material = materialResult.adjustmentManwon;
  const dwelling = additionalDwellingCostManwon(scenario.floorPrograms, scenario.dwellingProgram);
  const hard = base + material + dwelling + adjustmentManwon;
  if (!Number.isFinite(hard) || hard < 0) {
    throw new Error("Stage 2/3 상세 수량 원가를 반영한 공사비가 올바르지 않습니다.");
  }
  const soft = hard * inputs.softCostRatePct / 100;
  const contingency = (hard + soft) * inputs.contingencyRatePct / 100;
  const construction = hard + soft + contingency;
  const interest = construction * inputs.financingCostRatePct / 100;
  const pfFee = construction * inputs.ltcTargetPct / 100 * inputs.pfUpfrontFeeRatePct / 100;
  const financing = interest + pfFee + inputs.trustFeeManwon;
  const expected = {
    baseConstructionCostManwon: base,
    materialAdjustmentCostManwon: material,
    additionalDwellingCostManwon: dwelling,
    quantityCostAdjustmentManwon: adjustmentManwon,
    constructionCostManwon: hard,
    softCostManwon: soft,
    contingencyCostManwon: contingency,
    interestEstimateManwon: interest,
    pfFeeManwon: pfFee,
    trustFeeManwon: inputs.trustFeeManwon,
    financingCostManwon: financing,
    acquisitionTaxManwon: inputs.acquisitionTaxManwon,
    acquisitionOtherCostManwon: inputs.acquisitionOtherCostManwon,
    tenantRelocationCostManwon: inputs.tenantRelocationCostManwon,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (!matches(preview[key as keyof typeof expected], value)) {
      throw new Error(`Stage 2/3 상세 수량 원가의 비용 스냅샷이 다릅니다: ${key}`);
    }
  }
  const total = preview.acquisitionCostManwon + preview.demolitionCostManwon +
    inputs.acquisitionTaxManwon + inputs.acquisitionOtherCostManwon + inputs.tenantRelocationCostManwon +
    construction + financing;
  const revenue = calculation.revenueProjection.totalRevenueManwon;
  // Acquisition and demolition are available only as rounded snapshot values.
  if (!matches(preview.totalCostManwon, total, 0.0151) ||
      !matches(preview.expectedRevenueManwon, revenue) ||
      !matches(preview.profitManwon, revenue - total, 0.0151)) {
    throw new Error("Stage 2/3 상세 수량 원가의 총사업비·매출·손익 스냅샷이 다릅니다.");
  }
}

/**
 * 새 PlanningScenario를 기존 금융 BuildingProgram으로 연결한다.
 *
 * 가장 중요한 원칙은 사용자가 화면에서 확정한 실현값을 다시 법정 최대치로
 * 덮어쓰지 않는 것이다. FAR/BCR은 층별 프로그램 계산 결과를 그대로 사용한다.
 */
export function planningScenarioToBuildingProgram(
  scenario: PlanningScenario,
  calculation: PlanningScenarioCalculation,
  options: PlanningBuildingProgramOptions = {},
): BuildingProgram {
  if (scenario.id !== calculation.scenarioId) {
    throw new Error(
      `계획안과 계산 결과 ID가 일치하지 않습니다: ${scenario.id} / ${calculation.scenarioId}`
    );
  }

  const type = buildingTypeForScenario(scenario);
  const revenueAreas = planningRevenueAreas(scenario);
  const geometrySource = resolvePlanningGeometrySource(scenario);
  if (scenario.fullQuoteAdoption === undefined && (calculation.economicsPreview.fullQuoteCostStatus !== undefined ||
      calculation.economicsPreview.fullQuoteSourceKey !== undefined)) {
    throw new Error("전체 견적 채택이 해제됐습니다. 기존 산식으로 다시 계산해야 합니다.");
  }
  const fullQuoteCost = scenario.fullQuoteAdoption === undefined ? undefined : assessFullQuoteAdoption(scenario,
    { constructionCostPerSqmWon: calculation.economicsPreview.costInputs?.constructionCostPerSqmWon as number,
      basementCostMultiplier: calculation.economicsPreview.costInputs?.basementCostMultiplier as number }, options.geometry);
  if (fullQuoteCost) {
    const preview = calculation.economicsPreview, inputs = preview.costInputs;
    if (!inputs || preview.status !== "estimated" || preview.fullQuoteCostStatus !== "ready" ||
        preview.fullQuoteSourceKey !== fullQuoteCost.sourceKey) throw new Error("전체 견적 비용 계산 기준이 다릅니다.");
    const hard = fullQuoteCost.totalWon / 10_000;
    const soft = hard * inputs.softCostRatePct / 100;
    const contingency = (hard + soft) * inputs.contingencyRatePct / 100;
    const construction = hard + soft + contingency;
    const interest = construction * inputs.financingCostRatePct / 100;
    const pfFee = construction * inputs.ltcTargetPct / 100 * inputs.pfUpfrontFeeRatePct / 100;
    const financing = interest + pfFee + inputs.trustFeeManwon;
    const total = preview.acquisitionCostManwon + preview.demolitionCostManwon + inputs.acquisitionTaxManwon +
      inputs.acquisitionOtherCostManwon + inputs.tenantRelocationCostManwon + construction + financing;
    for (const [actual, expected, tolerance] of [
      [preview.constructionCostManwon, hard, 0.0051], [preview.softCostManwon, soft, 0.0051],
      [preview.contingencyCostManwon, contingency, 0.0051], [preview.financingCostManwon, financing, 0.0051],
      [preview.interestEstimateManwon ?? NaN, interest, 0.0051], [preview.pfFeeManwon ?? NaN, pfFee, 0.0051],
      [preview.trustFeeManwon ?? NaN, inputs.trustFeeManwon, 0.0051],
      [preview.acquisitionTaxManwon ?? NaN, inputs.acquisitionTaxManwon, 0.0051],
      [preview.acquisitionOtherCostManwon ?? NaN, inputs.acquisitionOtherCostManwon, 0.0051],
      [preview.tenantRelocationCostManwon ?? NaN, inputs.tenantRelocationCostManwon, 0.0051],
      [preview.expectedRevenueManwon, calculation.revenueProjection.totalRevenueManwon, 0.0051],
      [preview.totalCostManwon, total, 0.0151],
      [preview.profitManwon, calculation.revenueProjection.totalRevenueManwon - total, 0.0151],
    ]) if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tolerance) {
      throw new Error("전체 견적 반영 사업비 스냅샷이 원본 계산과 다릅니다.");
    }
  }
  let quantityCostAdjustment: QuantityCostContract | undefined;
  if (scenario.quantityCost !== undefined && !fullQuoteCost) {
    const inputs = calculation.economicsPreview.costInputs;
    if (!inputs) {
      throw new Error("Stage 2/3 상세 수량 원가를 검증할 기본 공사비 입력이 없습니다.");
    }
    const quantityCost = evaluateQuantityCost(scenario, {
      constructionCostPerSqmWon: inputs.constructionCostPerSqmWon,
      basementCostMultiplier: inputs.basementCostMultiplier,
    });
    if (
      quantityCost.status !== "ready" ||
      quantityCost.contract === null ||
      quantityCost.adjustmentManwon === null ||
      !Number.isFinite(quantityCost.adjustmentManwon) ||
      calculation.economicsPreview.status === "stale"
    ) {
      throw new Error(
        `Stage 2/3 상세 수량 원가를 다시 검증해야 합니다: ${quantityCost.issues.join(" · ") || quantityCost.status}`
      );
    }
    validateQuantityCostSnapshot(scenario, calculation, quantityCost.contract, quantityCost.adjustmentManwon, options.geometry);
    quantityCostAdjustment = quantityCost.contract;
  }

  return {
    type,
    far: calculation.metrics.preliminaryFarPct,
    bcr: calculation.metrics.preliminaryBcrPct,
    floorsAbove: calculation.metrics.aboveGroundFloors,
    floorsBelow: calculation.metrics.undergroundFloors,
    areaContract: {
      schemaVersion: FINANCIAL_GEOMETRY_CONTRACT_VERSION,
      source: "stage2-planning",
      sourceScenarioId: scenario.id,
      sourceScenarioVersion: scenario.version,
      constructionAreaSqm: calculation.metrics.constructionAreaSqm,
      aboveGroundAreaSqm: calculation.metrics.aboveGroundProgramAreaSqm,
      basementAreaSqm: calculation.metrics.basementProgramAreaSqm,
      farAreaSqm: calculation.metrics.preliminaryFarAreaSqm,
      gradeFootprintAreaSqm: calculation.metrics.gradeFootprintAreaSqm,
      parkingAreaSqm: calculation.metrics.parkingAreaSqm,
      commonAreaSqm: calculation.metrics.commonAreaSqm,
      saleableAreaSqm: calculation.metrics.saleableAreaSqm,
      rentableAreaSqm: calculation.metrics.rentableAreaSqm,
      revenueAreas,
      revenueProjection: calculation.revenueProjection,
      stage2Economics: calculation.economicsPreview.costInputs
        ? {
            modelVersion: STAGE2_ECONOMICS_CONTRACT_VERSION,
            assumptionsVersion:
              calculation.economicsPreview.assumptionsVersion,
            inputs: calculation.economicsPreview.costInputs,
            acquisitionCostManwon:
              calculation.economicsPreview.acquisitionCostManwon,
            acquisitionTaxManwon:
              calculation.economicsPreview.acquisitionTaxManwon ?? 0,
            acquisitionOtherCostManwon:
              calculation.economicsPreview.acquisitionOtherCostManwon ?? 0,
            demolitionCostManwon:
              calculation.economicsPreview.demolitionCostManwon,
            tenantRelocationCostManwon:
              calculation.economicsPreview.tenantRelocationCostManwon ?? 0,
            hardCostManwon:
              calculation.economicsPreview.constructionCostManwon,
            softCostManwon: calculation.economicsPreview.softCostManwon,
            contingencyCostManwon:
              calculation.economicsPreview.contingencyCostManwon,
            interestEstimateManwon:
              calculation.economicsPreview.interestEstimateManwon ?? 0,
            pfFeeManwon: calculation.economicsPreview.pfFeeManwon ?? 0,
            trustFeeManwon:
              calculation.economicsPreview.trustFeeManwon ?? 0,
            financingCostManwon:
              calculation.economicsPreview.financingCostManwon,
            totalCostManwon: calculation.economicsPreview.totalCostManwon,
            totalRevenueManwon:
              calculation.economicsPreview.expectedRevenueManwon,
            profitManwon: calculation.economicsPreview.profitManwon,
          }
        : undefined,
      providedParkingSpaces: calculation.parking.providedCars,
      requiredParkingSpaces: calculation.parking.requiredCars,
      parkingRequirement: {
        rule: calculation.parking.rule,
        decisionGrade: calculation.parking.decisionGrade,
        estimated: calculation.parking.estimated,
        components: calculation.parking.components,
        basis: calculation.parking.basis,
        warnings: calculation.parking.warnings,
      },
      sunlightAssessment: calculation.sunlight,
      facadeCost: calculation.economicsPreview.facadeCost,
      materialAdjustmentCostManwon:
        calculation.economicsPreview.materialAdjustmentCostManwon ?? 0,
      ...(quantityCostAdjustment ? { quantityCostAdjustment } : {}),
      ...(fullQuoteCost ? { fullQuoteCost } : {}),
      dwellingCostAdjustment: scenario.dwellingProgram ? {
        unitCount: calculation.metrics.residentialUnitCount,
        baselineDwellingCount: scenario.dwellingProgram.baselineDwellingCount,
        costPerAdditionalUnitWon: scenario.dwellingProgram.additionalDwellingCostWon,
        costManwon: calculation.economicsPreview.additionalDwellingCostManwon ?? 0,
        evidenceStatus: scenario.dwellingProgram.costEvidenceStatus,
        source: scenario.dwellingProgram.costSource,
      } : undefined,
      planningAssumptionsVersion:
        calculation.economicsPreview.assumptionsVersion,
      geometrySource: {
        mode: geometrySource.mode,
        exactGeometryAvailable: geometrySource.exactGeometryAvailable,
        locked: Boolean(options.geometryHash || geometrySource.locked),
        geometryHash:
          options.geometryHash ??
          geometrySource.lockedGeometryHash ??
          geometrySource.sourceGeometryHash,
        verificationVersion: geometrySource.verificationVersion,
      },
    },
    units: {
      residential: calculation.metrics.residentialUnitCount,
      retail: calculation.metrics.commercialUnitCount,
    },
    mix: mixFromRevenueAreas(type, revenueAreas),
  };
}
