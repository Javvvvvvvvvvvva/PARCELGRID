import {
  calculatePlanningMaterialAdjustment,
  PLANNING_FACADE_LABELS,
  resolvePlanningMaterials,
} from "./materials";
import type {
  PlanningScenario,
  PlanningScenarioCalculation,
} from "./types";

export const PLANNING_DESIGN_INTENT_VERSION =
  "parcelgrid-design-intent-2026.1";

export interface PlanningDesignIntentParcel {
  projectId: string;
  address: string;
  parcelAreaSqm: number;
  maxBuildingCoveragePct: number;
  maxFloorAreaRatioPct: number;
}

export function buildPlanningDesignIntent(
  scenario: PlanningScenario,
  parcel: PlanningDesignIntentParcel,
  calculation?: PlanningScenarioCalculation
) {
  const materials = resolvePlanningMaterials(scenario.materials);
  const materialCost = calculatePlanningMaterialAdjustment(scenario);
  const primaryLabel =
    PLANNING_FACADE_LABELS[materials.primaryFacadeMaterial];
  const secondaryLabel =
    PLANNING_FACADE_LABELS[materials.secondaryFacadeMaterial];
  const floors = [...scenario.floorPrograms]
    .sort((a, b) => a.level - b.level)
    .map((floor) => ({
      level: floor.level,
      label: floor.label,
      floorHeightM: floor.floorHeightM,
      footprintScalePct: floor.footprintScalePct,
      northSetbackM: floor.northSetbackM,
      zones: floor.zones.map((zone) => ({
        useType: zone.useType,
        areaSqm: zone.areaSqm,
        unitCount: zone.unitCount,
      })),
    }));

  return {
    schemaVersion: PLANNING_DESIGN_INTENT_VERSION,
    documentType: "parcelgrid-plan-dna",
    generatedAt: new Date().toISOString(),
    project: {
      projectId: parcel.projectId,
      address: parcel.address,
      parcelAreaSqm: parcel.parcelAreaSqm,
      regulatoryReference: {
        maxBuildingCoveragePct: parcel.maxBuildingCoveragePct,
        maxFloorAreaRatioPct: parcel.maxFloorAreaRatioPct,
        status: "reference-only",
      },
    },
    scenario: {
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      name: scenario.name,
      primaryUse: scenario.primaryUse,
      origin: scenario.origin,
    },
    geometryLock: {
      source: "parcelgrid-planning-scenario",
      referenceImageRequired: true,
      placement: scenario.placement,
      floors,
      calculatedMetrics: calculation
        ? {
            aboveGroundFloors: calculation.metrics.aboveGroundFloors,
            undergroundFloors: calculation.metrics.undergroundFloors,
            totalHeightM: calculation.metrics.totalHeightM,
            preliminaryBcrPct: calculation.metrics.preliminaryBcrPct,
            preliminaryFarPct: calculation.metrics.preliminaryFarPct,
          }
        : null,
      preserveExactly: [
        "floor-count",
        "floor-outlines",
        "step-backs",
        "parcel-placement",
        "building-rotation",
        "camera-angle",
      ],
    },
    materials: {
      structure: "reinforced-concrete",
      primaryFacade: materials.primaryFacadeMaterial,
      primaryFacadeLabel: primaryLabel,
      secondaryFacade: materials.secondaryFacadeMaterial,
      secondaryFacadeLabel: secondaryLabel,
      primaryFacadeSharePct: materials.primaryFacadeSharePct,
      windowRatioPct: materials.windowRatioPct,
    },
    costEvidence: {
      priced: materialCost.priced,
      facadeAreaSqm: materialCost.facadeAreaSqm,
      facadeAreaBasis: materialCost.areaBasis,
      baselineFacadeUnitCostPerSqmWon:
        materialCost.baselineUnitCostPerSqmWon,
      selectedFacadeUnitCostPerSqmWon:
        materialCost.selectedUnitCostPerSqmWon,
      materialAdjustmentManwon: materialCost.adjustmentManwon,
      evidenceStatus: materialCost.evidenceStatus,
      sourceLabel: materialCost.sourceLabel,
      observedAt: materials.rateEvidence?.observedAt ?? null,
      sourceUrl: materials.rateEvidence?.sourceUrl ?? null,
    },
    generationInstruction: {
      promptKo:
        `첨부한 PARCELGRID 3D 기준 이미지의 층수, 외곽 실루엣, 층별 후퇴, 대지 내 위치, 회전 방향과 카메라 시점을 변경하지 않는다. ` +
        `계획 매스 외벽은 ${primaryLabel} ${materials.primaryFacadeSharePct}%와 ${secondaryLabel} ${100 - materials.primaryFacadeSharePct}%로 표현한다. ` +
        `창호 비율은 약 ${materials.windowRatioPct}%로 유지한다. 추가 층, 옥탑, 발코니, 캔틸레버와 새로운 건물 동을 임의로 만들지 않는다.`,
      conceptOnly: true,
      disclaimer:
        "AI 콘셉트 시각화이며 건축설계도서, 인허가 도면, 시공도 또는 견적서가 아니다.",
    },
  };
}
