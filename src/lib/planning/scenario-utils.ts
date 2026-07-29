import type {
  FloorProgram,
  FloorUseType,
  FloorZone,
  PlanningEconomicsPreview,
  PlanningRevenueModel,
  PlanningScenario,
  PlanningScenarioOrigin,
  PlanningScenarioSummary,
} from "./types";
import { createDefaultPlanningMaterials } from "./materials";

function uid(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultRevenueModelForUse(useType: FloorUseType): PlanningRevenueModel {
  if (useType === "residential") return "sale";
  if (useType === "retail" || useType === "office") return "lease";
  return "non-revenue";
}

export function resolveZoneRevenueModel(zone: FloorZone): PlanningRevenueModel {
  return zone.revenueModel ?? defaultRevenueModelForUse(zone.useType);
}

export function emptyEconomicsPreview(
  acquisitionCostManwon = 0
): PlanningEconomicsPreview {
  return {
    status: "not-calculated",
    acquisitionCostManwon,
    demolitionCostManwon: 0,
    constructionCostManwon: 0,
    softCostManwon: 0,
    contingencyCostManwon: 0,
    financingCostManwon: 0,
    totalCostManwon: acquisitionCostManwon,
    saleRevenueManwon: 0,
    capitalizedLeaseValueManwon: 0,
    expectedRevenueManwon: 0,
    expectedAnnualNoiManwon: 0,
    profitManwon: -acquisitionCostManwon,
    profitMarginPct: 0,
  };
}

export function createFloorZone(
  useType: FloorUseType,
  areaSqm = 0,
  unitCount = 0,
  label?: string,
  revenueModel: PlanningRevenueModel = defaultRevenueModelForUse(useType)
): FloorZone {
  return {
    id: uid("zone"),
    useType,
    label,
    areaSqm: Math.max(0, areaSqm),
    unitCount: Math.max(0, Math.floor(unitCount)),
    revenueModel,
  };
}

export function createFloorProgram(
  level: number,
  zones: FloorZone[] = [],
  floorHeightM = level === 1 ? 3.6 : 3
): FloorProgram {
  return {
    id: uid("floor"),
    level,
    label: level < 0 ? `B${Math.abs(level)}` : `${level}층`,
    floorHeightM,
    footprintScalePct: 100,
    northSetbackM: 0,
    zones,
  };
}

export function createBlankPlanningScenario(input?: {
  projectId?: string;
  name?: string;
  origin?: PlanningScenarioOrigin;
  acquisitionCostManwon?: number;
}): PlanningScenario {
  const timestamp = nowIso();
  return {
    id: uid("plan"),
    projectId: input?.projectId,
    name: input?.name ?? "새 계획안",
    description: "",
    origin: input?.origin ?? "custom",
    status: "draft",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    primaryUse: "multi-family",
    floorPrograms: [
      createFloorProgram(1, [createFloorZone("residential", 50, 1)]),
    ],
    placement: {
      rotationDeg: 0,
      offsetXM: 0,
      offsetZM: 0,
      roadSetbackM: 0,
      northSetbackM: 0,
    },
    parking: {
      strategy: "none",
      providedCars: 0,
    },
    materials: createDefaultPlanningMaterials(),
    checks: [],
    economicsPreview: emptyEconomicsPreview(input?.acquisitionCostManwon ?? 0),
  };
}

export function clonePlanningScenario(
  source: PlanningScenario,
  name = `${source.name} 복사본`
): PlanningScenario {
  const timestamp = nowIso();
  return {
    ...source,
    id: uid("plan"),
    name,
    origin: "custom",
    status: "draft",
    baseScenarioId: source.id,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    floorPrograms: source.floorPrograms.map((floor) => ({
      ...floor,
      id: uid("floor"),
      zones: floor.zones.map((zone) => ({ ...zone, id: uid("zone") })),
    })),
    placement: { ...source.placement },
    parking: { ...source.parking },
    materials: source.materials
      ? {
          ...source.materials,
          rateEvidence: source.materials.rateEvidence
            ? { ...source.materials.rateEvidence }
            : undefined,
        }
      : createDefaultPlanningMaterials(),
    checks: source.checks.map((check) => ({ ...check })),
    economicsPreview: {
      ...source.economicsPreview,
      status:
        source.economicsPreview.status === "not-calculated"
          ? "not-calculated"
          : "stale",
      calculatedAt: undefined,
    },
    recommendation: undefined,
  };
}

export function touchPlanningScenario(
  scenario: PlanningScenario,
  patch: Partial<Omit<PlanningScenario, "id" | "createdAt">>
): PlanningScenario {
  return {
    ...scenario,
    ...patch,
    id: scenario.id,
    createdAt: scenario.createdAt,
    updatedAt: nowIso(),
    version: scenario.version + 1,
  };
}

export function summarizePlanningScenario(
  scenario: PlanningScenario
): PlanningScenarioSummary {
  let totalProgramAreaSqm = 0;
  let residentialAreaSqm = 0;
  let commercialAreaSqm = 0;
  let parkingAreaSqm = 0;
  let commonAreaSqm = 0;
  let saleableAreaSqm = 0;
  let rentableAreaSqm = 0;
  let residentialUnitCount = 0;
  let commercialUnitCount = 0;
  let gradeFootprintAreaSqm = 0;

  for (const floor of scenario.floorPrograms) {
    const floorArea = floor.zones.reduce((sum, zone) => sum + Math.max(0, zone.areaSqm), 0);
    totalProgramAreaSqm += floorArea;
    if (floor.level === 1) gradeFootprintAreaSqm = Math.max(gradeFootprintAreaSqm, floorArea);

    for (const zone of floor.zones) {
      const area = Math.max(0, zone.areaSqm);
      const zoneCount = Math.max(0, Math.floor(zone.unitCount));
      if (zone.useType === "residential") {
        residentialAreaSqm += area;
        residentialUnitCount += zoneCount;
      }
      if (zone.useType === "retail" || zone.useType === "office") {
        commercialAreaSqm += area;
        commercialUnitCount += zoneCount;
      }
      if (zone.useType === "parking" || zone.useType === "piloti") parkingAreaSqm += area;
      if (
        zone.useType === "common" ||
        zone.useType === "mechanical" ||
        zone.useType === "storage"
      ) {
        commonAreaSqm += area;
      }

      const revenueModel = resolveZoneRevenueModel(zone);
      if (revenueModel === "sale") {
        saleableAreaSqm += Math.min(area, Math.max(0, zone.saleableAreaSqm ?? area));
      }
      if (revenueModel === "lease") {
        rentableAreaSqm += Math.min(area, Math.max(0, zone.rentableAreaSqm ?? area));
      }
    }
  }

  const aboveLevels = scenario.floorPrograms
    .filter((floor) => floor.level > 0)
    .map((floor) => floor.level);
  const belowLevels = scenario.floorPrograms
    .filter((floor) => floor.level < 0)
    .map((floor) => Math.abs(floor.level));
  const totalUnitCount = residentialUnitCount + commercialUnitCount;

  return {
    aboveGroundFloors: aboveLevels.length > 0 ? Math.max(...aboveLevels) : 0,
    undergroundFloors: belowLevels.length > 0 ? Math.max(...belowLevels) : 0,
    totalProgramAreaSqm,
    gradeFootprintAreaSqm,
    residentialAreaSqm,
    commercialAreaSqm,
    parkingAreaSqm,
    commonAreaSqm,
    saleableAreaSqm,
    rentableAreaSqm,
    residentialUnitCount,
    commercialUnitCount,
    totalUnitCount,
    unitCount: residentialUnitCount,
    providedCars: Math.max(0, scenario.parking.providedCars),
  };
}

export function sortFloorPrograms(floors: FloorProgram[]): FloorProgram[] {
  return [...floors].sort((a, b) => b.level - a.level);
}
