import type {
  AssumptionSet,
  BuildingProgram,
  BuildingType,
  Parcel,
  Scenario,
} from "@/lib/finance/types";
import { calculatePlanningMaterialAdjustment } from "@/lib/planning/materials";
import {
  resolveZoneRevenueModel,
  summarizePlanningScenario,
} from "@/lib/planning/scenario-utils";
import type {
  FloorUseType,
  FloorZone,
  PlanningScenario,
} from "@/lib/planning/types";

const WON_PER_MANWON = 10_000;

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function financeType(scenario: PlanningScenario): BuildingType {
  return scenario.primaryUse;
}

function zoneRevenueArea(zone: FloorZone): number {
  const area = nonNegative(zone.areaSqm);
  const model = resolveZoneRevenueModel(zone);
  if (model === "sale") {
    return Math.min(area, nonNegative(zone.saleableAreaSqm ?? area));
  }
  if (model === "lease") {
    return Math.min(area, nonNegative(zone.rentableAreaSqm ?? area));
  }
  return 0;
}

function isCommercialUse(useType: FloorUseType): boolean {
  return useType === "retail" || useType === "office";
}

function revenueMix(scenario: PlanningScenario): BuildingProgram["mix"] {
  let saleArea = 0;
  let residentialLeaseArea = 0;
  let retailLeaseArea = 0;

  scenario.floorPrograms.forEach((floor) => {
    floor.zones.forEach((zone) => {
      const area = zoneRevenueArea(zone);
      const model = resolveZoneRevenueModel(zone);
      if (model === "sale") {
        saleArea += area;
      } else if (model === "lease") {
        if (zone.useType === "retail") retailLeaseArea += area;
        else residentialLeaseArea += area;
      }
    });
  });

  const total = saleArea + residentialLeaseArea + retailLeaseArea;
  if (total <= 0) {
    if (scenario.primaryUse === "retail") {
      return { residentialSale: 0, residentialLease: 0, retail: 1 };
    }
    if (scenario.primaryUse === "office") {
      return { residentialSale: 0, residentialLease: 1, retail: 0 };
    }
    return { residentialSale: 1, residentialLease: 0, retail: 0 };
  }

  return {
    residentialSale: saleArea / total,
    residentialLease: residentialLeaseArea / total,
    retail: retailLeaseArea / total,
  };
}

function aboveGroundConstructionArea(scenario: PlanningScenario): number {
  return scenario.floorPrograms
    .filter((floor) => floor.level > 0)
    .reduce(
      (sum, floor) =>
        sum +
        floor.zones.reduce(
          (floorSum, zone) => floorSum + nonNegative(zone.areaSqm),
          0
        ),
      0
    );
}

function gradeFootprintArea(scenario: PlanningScenario): number {
  const areas = scenario.floorPrograms
    .filter((floor) => floor.level > 0)
    .map((floor) =>
      floor.zones.reduce(
        (sum, zone) => sum + nonNegative(zone.areaSqm),
        0
      )
    );
  return areas.length > 0 ? Math.max(...areas) : 0;
}

function constructionCostPerSqm(
  scenario: PlanningScenario,
  base: AssumptionSet,
  constructionAreaSqm: number
): number {
  if (
    constructionAreaSqm > 0 &&
    scenario.economicsPreview.status === "estimated" &&
    scenario.economicsPreview.constructionCostManwon > 0
  ) {
    return (
      (scenario.economicsPreview.constructionCostManwon * WON_PER_MANWON) /
      constructionAreaSqm
    );
  }

  const material = calculatePlanningMaterialAdjustment(scenario);
  const materialPerSqmWon =
    constructionAreaSqm > 0
      ? (material.adjustmentManwon * WON_PER_MANWON) / constructionAreaSqm
      : 0;
  return Math.max(0, base.constCostPerSqM + materialPerSqmWon);
}

/**
 * Converts the exact Stage 2 representative plan into the legacy finance engine
 * contract used by Stage 3. The planning scenario ID is preserved so the
 * dashboard can reject unrelated or stale financial results.
 *
 * The finance engine currently models above-ground construction area through
 * BuildingProgram.far. Geometry remains the legal FAR and massing source of
 * truth; this adapter uses all above-ground program area for construction cost.
 */
export function planningScenarioToFinanceScenario(
  planning: PlanningScenario,
  parcel: Pick<Parcel, "lotArea">,
  baseAssumptions: AssumptionSet
): Scenario {
  const summary = summarizePlanningScenario(planning);
  const constructionAreaSqm = aboveGroundConstructionArea(planning);
  const footprintAreaSqm = gradeFootprintArea(planning);
  const lotAreaSqm = Math.max(0, parcel.lotArea);

  const far =
    lotAreaSqm > 0 ? (constructionAreaSqm / lotAreaSqm) * 100 : 0;
  const bcr = lotAreaSqm > 0 ? (footprintAreaSqm / lotAreaSqm) * 100 : 0;

  return {
    id: planning.id,
    name: planning.name,
    shortName: planning.name,
    tag: `Stage 2 대표안 v${planning.version}`,
    program: {
      type: financeType(planning),
      far,
      bcr,
      floorsAbove: summary.aboveGroundFloors,
      floorsBelow: summary.undergroundFloors,
      units: {
        residential: summary.residentialUnitCount,
        retail: summary.commercialUnitCount,
      },
      mix: revenueMix(planning),
    },
    assumptions: {
      ...baseAssumptions,
      constCostPerSqM: constructionCostPerSqm(
        planning,
        baseAssumptions,
        constructionAreaSqm
      ),
    },
  };
}
