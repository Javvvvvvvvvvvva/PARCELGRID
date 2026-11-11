import type { IntegratedVerificationInput } from "@/lib/handoff/integrated-verification";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { DEFAULT_EGRESS_SETTINGS, EGRESS_VERSION, groundExitBasis, groundExitCandidates } from "@/lib/planning/egress-core";
import { DEFAULT_INTERIOR_SETTINGS, generateInteriorDraft } from "@/lib/planning/interior-layout";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { generateRoomLayout } from "@/lib/planning/room-layout";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/planning/room-layout-schema";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { DEMO_PARCEL } from "@/lib/seed/demo-project";
import { computeProject } from "@/lib/services/compute-project";

const AT = "2026-10-24T12:00:00.000Z";

/** Synthetic model evidence only; no official boundary, permit or professional approval. */
export function integratedVerificationFixture(projectId = "IV-P1"): IntegratedVerificationInput {
  const origin = [127.03, 37.65];
  const geo = (x: number, z: number): [number, number] => [
    origin[0] + x / (111000 * Math.cos(origin[1] * Math.PI / 180)),
    origin[1] - z / 111000,
  ];
  const boundary = [geo(-15, -15), geo(15, -15), geo(15, 15), geo(-15, 15), geo(-15, -15)];
  const roads = [{ name: "Synthetic frontage", points: [geo(-25, 17), geo(25, 17)] }];
  const scenario = createBlankPlanningScenario({ projectId });
  scenario.id = "IV-S1";
  scenario.version = 3;
  scenario.createdAt = AT;
  scenario.updatedAt = AT;
  scenario.floorPrograms = [1, 2, 3].map(level => {
    const floor = createFloorProgram(level, [
      { ...createFloorZone(level === 1 ? "piloti" : "residential", 108, level === 1 ? 0 : 1),
        id: `zone-${level}`, ...(level === 1 ? {} : { saleableAreaSqm: 90, parkingExclusiveAreaSqm: 90 }) },
      { ...createFloorZone("common", 36, 0), id: `common-${level}` },
    ]);
    return { ...floor, id: `floor-${level}`, floorHeightM: 3 };
  });
  scenario.parking = { strategy: "surface", providedCars: 4, orientation: "parallel-front",
    stallWidthM: 2.5, stallDepthM: 5, aisleWidthM: 6, entryWidthM: 3, coreAreaSqm: 0, columnLossPct: 0 };
  const geometry = buildPlanningGeometry({ projectId, scenario, boundary, roads, lotAreaSqm: 900,
    zoning: "일반상업지역", setback: { road: 0, side: 0, rear: 0 }, generatedAt: AT }).snapshot;
  for (const floor of scenario.floorPrograms) {
    const outline = geometry.building.floors.find(f => f.id === floor.id)!.shape;
    const draft = generateInteriorDraft(floor, outline, { ...DEFAULT_INTERIOR_SETTINGS, coreDepthM: 5.5 }).draft;
    if (!draft) throw new Error("Synthetic floor template did not fit");
    floor.interiorLayout = draft;
    draft.roomLayouts = draft.spaces.filter(s => s.kind === "unit").map(unit => {
      const room = generateRoomLayout(floor, unit.id, outline, DEFAULT_ROOM_SETTINGS).draft;
      if (!room) throw new Error("Synthetic room template did not fit");
      return room;
    });
  }
  const ground = scenario.floorPrograms[0];
  const exit = groundExitCandidates(ground, geometry.building.floors[0].shape)[0];
  scenario.egressPlan = { version: EGRESS_VERSION, settings: { ...DEFAULT_EGRESS_SETTINGS }, exit: {
    floorId: ground.id, spaceId: exit.spaceId, edgeIndex: exit.edgeIndex, offsetRatio: 0.5,
    widthM: 0.9, layoutBasis: groundExitBasis(ground.interiorLayout!),
  } };
  const assumptions = defaultAssumptions();
  const calculation = calculatePlanningScenario(scenario, {
    parcel: { address: "서울특별시 도봉구", lotAreaSqm: 900, maxFARPct: 200, maxBCRPct: 60,
      heightLimitM: 30, acquisitionCostManwon: 50000, demolitionCostManwon: 1000,
      parkingRuleAsOf: "2026-10-24" },
    assumptions: planningEconomicsAssumptionsFromLegacy(assumptions, "integrated-fixture"), calculatedAt: AT,
  });
  const data = computeProject({ ...DEMO_PARCEL, id: projectId, address: "Synthetic verification parcel",
    addressRoad: "Synthetic frontage", lotArea: 900, boundary, roads,
    zoning: "일반상업지역", acquiredPrice: 50000, demolitionCost: 1000 }, [{
    id: scenario.id, name: "Synthetic integrated model", shortName: "Synthetic",
    program: planningScenarioToBuildingProgram(scenario, calculation, { geometryHash: geometry.geometryHash }), assumptions,
  }], { startDate: "2026-10-01", recommendedId: scenario.id, calculateMaxAcquisition: false });
  data.meta.lastSyncedAt = AT;
  return { projectId, representativeScenarioId: scenario.id, representativeScenarioVersion: scenario.version,
    geometryHash: geometry.geometryHash, data, planningScenario: scenario, geometry };
}
