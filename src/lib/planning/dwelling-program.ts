import { createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import type { FloorProgram, PlanningDwellingProgram } from "@/lib/planning/types";

export const DWELLING_PROGRAM_VERSION = "dwelling-program-2026.1" as const;
export const DEFAULT_DWELLING_PROGRAM: PlanningDwellingProgram = {
  modelVersion: DWELLING_PROGRAM_VERSION,
  baseNetRatio: 0.75,
  extraCommonAreaPerSplitSqm: 2,
  minimumCommonAreaSqm: 9,
  baselineDwellingCount: 4,
  additionalDwellingCostWon: 20_000_000,
  costEvidenceStatus: "assumed",
};

export interface DwellingProgramInput {
  capacitiesSqm: number[];
  utilizationRatio: number;
  maxFarAreaSqm: number;
  targetExclusiveAreaSqm: number;
  mix: "uniform" | "compact-lower";
  piloti: boolean;
  assumptions?: PlanningDwellingProgram;
}

/** A discrete area program, not an interior floor plan or a legal minimum room size. */
export function buildDwellingProgram(input: DwellingProgramInput): FloorProgram[] | null {
  const a = input.assumptions ?? DEFAULT_DWELLING_PROGRAM;
  if (!Number.isFinite(input.targetExclusiveAreaSqm) || input.targetExclusiveAreaSqm < 18 ||
      !(a.baseNetRatio > 0 && a.baseNetRatio < 1) || !(a.minimumCommonAreaSqm > 0) ||
      !Number.isFinite(a.extraCommonAreaPerSplitSqm) || a.extraCommonAreaPerSplitSqm < 0 ||
      !(input.utilizationRatio > 0 && input.utilizationRatio <= 1) ||
      !Number.isFinite(input.maxFarAreaSqm) || input.maxFarAreaSqm <= 0 ||
      input.capacitiesSqm.some((area) => !Number.isFinite(area) || area <= 0)) return null;
  const targets = input.capacitiesSqm.map((area) => area * input.utilizationRatio);
  const residentialTargets = input.piloti ? targets.slice(1) : targets;
  if (!residentialTargets.length || residentialTargets.length > 4) return null;
  const groundCommon = input.piloti ? a.minimumCommonAreaSqm : 0;
  const farBudget = input.maxFarAreaSqm - groundCommon;
  if (farBudget <= 0 || (input.piloti && targets[0] <= groundCommon)) return null;
  const capacitySum = residentialTargets.reduce((sum, area) => sum + area, 0);
  const ratio = Math.min(1, farBudget / capacitySum);
  const programs: FloorProgram[] = input.piloti ? [createFloorProgram(1, [
    createFloorZone("piloti", targets[0] - groundCommon, 0, "주차", "non-revenue"),
    createFloorZone("common", groundCommon, 0, "계단·승강기 코어", "non-revenue"),
  ])] : [];

  for (let index = 0; index < residentialTargets.length; index += 1) {
    const gross = residentialTargets[index] * ratio;
    const baseCommon = Math.max(a.minimumCommonAreaSqm, gross * (1 - a.baseNetRatio));
    const baseNet = gross - baseCommon;
    const splitLoss = a.extraCommonAreaPerSplitSqm;
    const compactCount = Math.max(1, Math.floor((baseNet + splitLoss) / (input.targetExclusiveAreaSqm + splitLoss)));
    const unitCount = input.mix === "compact-lower" && index >= Math.ceil(residentialTargets.length / 2)
      ? 1 : compactCount;
    const net = baseNet - (unitCount - 1) * splitLoss;
    const perUnit = net / unitCount;
    //18sqm is a bounded search setting, not a declaration of housing-code compliance.
    if (perUnit < 18 || unitCount > 20) return null;
    const level = index + (input.piloti ? 2 : 1);
    const dwellings = Array.from({ length: unitCount }, (_, unitIndex) => ({
      ...createFloorZone("residential", perUnit, 1, `${level}${String(unitIndex + 1).padStart(2, "0")}호`, "sale"),
      saleableAreaSqm: perUnit,
      parkingExclusiveAreaSqm: perUnit,
      parkingExclusiveAreaStatus: "user-entered" as const,
    }));
    programs.push(createFloorProgram(level, [
      ...dwellings,
      createFloorZone("common", gross - net, 0, "공용부·벽체 여유", "non-revenue"),
    ]));
  }
  return programs;
}

export function dwellingProgramSummary(floors: FloorProgram[]) {
  const zones = floors.flatMap((floor) => floor.zones).filter((zone) => zone.useType === "residential");
  const unitCount = zones.reduce((sum, zone) => sum + zone.unitCount, 0);
  const areas = zones.filter((zone) => zone.unitCount > 0).map((zone) =>
    (zone.parkingExclusiveAreaSqm ?? zone.saleableAreaSqm ?? zone.areaSqm) / zone.unitCount);
  return {
    unitCount,
    minExclusiveSqm: areas.length ? Math.min(...areas) : 0,
    maxExclusiveSqm: areas.length ? Math.max(...areas) : 0,
    netAreaSqm: zones.reduce((sum, zone) => sum + (zone.saleableAreaSqm ?? zone.areaSqm), 0),
  };
}

/** Guided edits preserve gross area and rebuild one zone per dwelling. */
export function redistributeDwellingFloor(floor: FloorProgram, unitCount: number, assumptions: PlanningDwellingProgram): FloorProgram | null {
  if (!Number.isInteger(unitCount) || unitCount < 1 || unitCount > 20 ||
      floor.zones.some((zone) => zone.useType !== "residential" && zone.useType !== "common")) return null;
  const oldUnits = dwellingProgramSummary([floor]).unitCount;
  if (oldUnits <= 0) return null;
  const gross = floor.zones.reduce((sum, zone) => sum + zone.areaSqm, 0);
  const common = floor.zones.filter((zone) => zone.useType === "common").reduce((sum, zone) => sum + zone.areaSqm, 0);
  const nextCommon = Math.max(assumptions.minimumCommonAreaSqm, gross * (1 - assumptions.baseNetRatio),
    common + (unitCount - oldUnits) * assumptions.extraCommonAreaPerSplitSqm);
  const perUnit = (gross - nextCommon) / unitCount;
  if (!Number.isFinite(perUnit) || perUnit < 18) return null;
  const oldDwellings = floor.zones.filter((zone) => zone.useType === "residential");
  if (oldDwellings.some((zone) => zone.revenueModel !== "sale")) return null;
  return { ...floor, zones: [
    ...Array.from({ length: unitCount }, (_, index) => ({
      ...createFloorZone("residential", perUnit, 1, `${floor.level}${String(index + 1).padStart(2, "0")}호`, "sale"),
      ...(oldDwellings[index] ? { id: oldDwellings[index].id } : {}),
      saleableAreaSqm: perUnit, parkingExclusiveAreaSqm: perUnit, parkingExclusiveAreaStatus: "user-entered" as const,
    })),
    createFloorZone("common", nextCommon, 0, "공용부·벽체 여유", "non-revenue"),
  ] };
}

export function additionalDwellingCostManwon(floors: FloorProgram[], assumptions?: PlanningDwellingProgram): number {
  if (!assumptions) return 0;
  const units = dwellingProgramSummary(floors).unitCount;
  const baseline = Math.max(0, Math.floor(assumptions.baselineDwellingCount));
  const rate = Math.max(0, assumptions.additionalDwellingCostWon);
  if (!Number.isFinite(baseline) || !Number.isFinite(rate)) return 0;
  return Math.max(0, units - baseline) * rate / 10_000;
}
