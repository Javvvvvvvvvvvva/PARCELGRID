import {
  FINANCIAL_GEOMETRY_CONTRACT_VERSION,
  type BuildingProgram,
  type BuildingType,
} from "@/lib/finance/types";
import { resolveZoneRevenueModel } from "@/lib/planning/scenario-utils";
import type {
  FloorUseType,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

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

function isCommercial(useType: FloorUseType): boolean {
  return useType === "retail" || useType === "office";
}

interface RevenueAreas {
  residentialSaleSqm: number;
  residentialLeaseSqm: number;
  retailSqm: number;
}

/**
 * Stage 2 층별 구역을 Stage 3 금융 엔진의 세 가지 수익 풀로 변환한다.
 *
 * - 주거 매각 → residentialSale
 * - 주거 임대 → residentialLease
 * - 상가·업무 임대 → retail
 * - 상가·업무 매각은 현재 금융 엔진에 별도 상업 매각 풀이 없으므로
 *   매각 풀에 포함한다. 이후 상업 매각 단가 분리 시 확장할 수 있다.
 */
export function planningRevenueAreas(scenario: PlanningScenario): RevenueAreas {
  const result: RevenueAreas = {
    residentialSaleSqm: 0,
    residentialLeaseSqm: 0,
    retailSqm: 0,
  };

  for (const floor of scenario.floorPrograms) {
    for (const zone of floor.zones) {
      const areaSqm = nonNegative(zone.areaSqm);
      const revenueModel = resolveZoneRevenueModel(zone);

      if (revenueModel === "sale") {
        const saleableAreaSqm = Math.min(
          areaSqm,
          nonNegative(zone.saleableAreaSqm ?? areaSqm)
        );
        result.residentialSaleSqm += saleableAreaSqm;
        continue;
      }

      if (revenueModel === "lease") {
        const rentableAreaSqm = Math.min(
          areaSqm,
          nonNegative(zone.rentableAreaSqm ?? areaSqm)
        );
        if (isCommercial(zone.useType)) {
          result.retailSqm += rentableAreaSqm;
        } else if (zone.useType === "residential") {
          result.residentialLeaseSqm += rentableAreaSqm;
        }
      }
    }
  }

  return result;
}

function fallbackMix(type: BuildingType): BuildingProgram["mix"] {
  if (type === "retail" || type === "office") {
    return { residentialSale: 0, residentialLease: 0, retail: 1 };
  }
  return { residentialSale: 1, residentialLease: 0, retail: 0 };
}

function mixFromRevenueAreas(
  type: BuildingType,
  areas: RevenueAreas
): BuildingProgram["mix"] {
  const total =
    areas.residentialSaleSqm + areas.residentialLeaseSqm + areas.retailSqm;
  if (total <= 0) return fallbackMix(type);

  return {
    residentialSale: areas.residentialSaleSqm / total,
    residentialLease: areas.residentialLeaseSqm / total,
    retail: areas.retailSqm / total,
  };
}

/**
 * 새 PlanningScenario를 기존 금융 BuildingProgram으로 연결한다.
 *
 * 가장 중요한 원칙은 사용자가 화면에서 확정한 실현값을 다시 법정 최대치로
 * 덮어쓰지 않는 것이다. FAR/BCR은 층별 프로그램 계산 결과를 그대로 사용한다.
 */
export function planningScenarioToBuildingProgram(
  scenario: PlanningScenario,
  calculation: PlanningScenarioCalculation
): BuildingProgram {
  if (scenario.id !== calculation.scenarioId) {
    throw new Error(
      `계획안과 계산 결과 ID가 일치하지 않습니다: ${scenario.id} / ${calculation.scenarioId}`
    );
  }

  const type = buildingTypeForScenario(scenario);
  const revenueAreas = planningRevenueAreas(scenario);

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
      providedParkingSpaces: calculation.parking.providedCars,
      requiredParkingSpaces: calculation.parking.requiredCars,
      materialAdjustmentCostManwon:
        calculation.economicsPreview.materialAdjustmentCostManwon ?? 0,
      planningAssumptionsVersion:
        calculation.economicsPreview.assumptionsVersion,
      geometrySource: scenario.geometrySource
        ? {
            mode: scenario.geometrySource.mode,
            exactGeometryAvailable:
              scenario.geometrySource.exactGeometryAvailable,
            locked: scenario.geometrySource.locked,
            geometryHash:
              scenario.geometrySource.lockedGeometryHash ??
              scenario.geometrySource.sourceGeometryHash,
            verificationVersion:
              scenario.geometrySource.verificationVersion,
          }
        : undefined,
    },
    units: {
      residential: calculation.metrics.residentialUnitCount,
      retail: calculation.metrics.commercialUnitCount,
    },
    mix: mixFromRevenueAreas(type, revenueAreas),
  };
}
