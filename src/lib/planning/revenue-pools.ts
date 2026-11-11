import type { FinancialRevenueAreaPools } from "@/lib/finance/types";
import {
  isRevenueBearingUse,
  resolveZoneRevenueModel,
} from "@/lib/planning/scenario-utils";
import type {
  FloorUseType,
  FloorZone,
  PlanningScenario,
} from "@/lib/planning/types";

function nonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function areaKey(
  useType: FloorUseType,
  model: "sale" | "lease",
): keyof FinancialRevenueAreaPools | null {
  if (useType === "residential") {
    return model === "sale" ? "residentialSaleSqm" : "residentialLeaseSqm";
  }
  if (useType === "retail") {
    return model === "sale" ? "retailSaleSqm" : "retailLeaseSqm";
  }
  if (useType === "office") {
    return model === "sale" ? "officeSaleSqm" : "officeLeaseSqm";
  }
  return null;
}

export function unsupportedRevenueZones(
  scenario: PlanningScenario,
): FloorZone[] {
  return scenario.floorPrograms.flatMap((floor) =>
    floor.zones.filter(
      (zone) =>
        resolveZoneRevenueModel(zone) !== "non-revenue" &&
        !isRevenueBearingUse(zone.useType),
    ),
  );
}

/** Converts every supported Stage 2 zone into one of six explicit pools. */
export function planningRevenueAreas(
  scenario: PlanningScenario,
): FinancialRevenueAreaPools {
  const result: FinancialRevenueAreaPools = {
    residentialSaleSqm: 0,
    retailSaleSqm: 0,
    officeSaleSqm: 0,
    residentialLeaseSqm: 0,
    retailLeaseSqm: 0,
    officeLeaseSqm: 0,
  };

  for (const floor of scenario.floorPrograms) {
    for (const zone of floor.zones) {
      const model = resolveZoneRevenueModel(zone);
      if (model === "non-revenue") continue;
      const key = areaKey(zone.useType, model);
      if (!key) continue;
      const areaSqm = nonNegative(zone.areaSqm);
      const eligibleAreaSqm = Math.min(
        areaSqm,
        nonNegative(
          model === "sale"
            ? (zone.saleableAreaSqm ?? areaSqm)
            : (zone.rentableAreaSqm ?? areaSqm),
        ),
      );
      result[key] = nonNegative(result[key]) + eligibleAreaSqm;
    }
  }

  return result;
}
