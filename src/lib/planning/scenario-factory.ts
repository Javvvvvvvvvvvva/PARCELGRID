import type { EnvelopePlan } from "@/lib/stores/project-store";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";
import type { PlanningScenario } from "@/lib/planning/types";

export interface PlanningScenarioParcelSeed {
  lotAreaSqm: number;
  maxFARPct: number;
  maxBCRPct: number;
  acquisitionCostManwon: number;
  demolitionCostManwon?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function maxFootprintArea(parcel: PlanningScenarioParcelSeed): number {
  const bcr = parcel.maxBCRPct > 0 ? parcel.maxBCRPct : 50;
  return Math.max(0, parcel.lotAreaSqm * (bcr / 100));
}

function distributeUnits(totalUnits: number, floors: number): number[] {
  const safeFloors = Math.max(1, floors);
  const safeUnits = Math.max(0, Math.floor(totalUnits));
  const base = Math.floor(safeUnits / safeFloors);
  const remainder = safeUnits % safeFloors;
  return Array.from({ length: safeFloors }, (_, index) =>
    base + (index < remainder ? 1 : 0)
  );
}

export function createBlankScenarioForParcel(
  parcel: PlanningScenarioParcelSeed,
  name = "새 계획안"
): PlanningScenario {
  const scenario = createBlankPlanningScenario({
    name,
    origin: "custom",
    acquisitionCostManwon: parcel.acquisitionCostManwon,
  });
  const footprint = Math.min(
    maxFootprintArea(parcel),
    Math.max(10, parcel.lotAreaSqm * 0.4)
  );

  scenario.floorPrograms = [
    createFloorProgram(1, [createFloorZone("residential", footprint, 1)]),
  ];
  scenario.economicsPreview.demolitionCostManwon = Math.max(
    0,
    parcel.demolitionCostManwon ?? 0
  );
  return scenario;
}

export function createStarterPlanningScenario(
  parcel: PlanningScenarioParcelSeed,
  legacyPlan?: EnvelopePlan | null
): PlanningScenario {
  if (!legacyPlan) {
    return createBlankScenarioForParcel(parcel, "현재 계획 초안");
  }

  const floors = clamp(Math.floor(legacyPlan.floors || 1), 1, 30);
  const targetFarPct = clamp(
    legacyPlan.farPct || Math.min(parcel.maxFARPct, 120),
    1,
    parcel.maxFARPct > 0 ? parcel.maxFARPct : 500
  );
  const targetGfa = parcel.lotAreaSqm * (targetFarPct / 100);
  const footprint = Math.min(maxFootprintArea(parcel), targetGfa / floors);
  const unitsByFloor = distributeUnits(legacyPlan.units, floors);
  const scenario = createBlankPlanningScenario({
    name: "기존 입력안",
    origin: "legacy",
    acquisitionCostManwon: parcel.acquisitionCostManwon,
  });

  scenario.primaryUse = legacyPlan.scenarioType ?? "multi-family";
  scenario.floorPrograms = Array.from({ length: floors }, (_, index) => {
    const level = index + 1;
    return createFloorProgram(level, [
      createFloorZone("residential", footprint, unitsByFloor[index] ?? 0),
    ]);
  });
  scenario.parking = {
    strategy: legacyPlan.requiredCars > 0 ? "surface" : "none",
    providedCars: Math.max(0, Math.floor(legacyPlan.requiredCars)),
  };
  scenario.economicsPreview.demolitionCostManwon = Math.max(
    0,
    parcel.demolitionCostManwon ?? 0
  );
  return scenario;
}
