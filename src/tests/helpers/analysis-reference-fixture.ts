import { integratedVerificationFixture } from "@/tests/helpers/integrated-verification-fixture";
import { createRegulatoryReferenceSet } from "@/lib/regulatory/constraints";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { buildPlanningParkingGeometry } from "@/lib/planning/planning-parking-geometry";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { calculatePlanningSpatialValidation, applySpatialValidationToCalculation } from "@/lib/planning/scenario-spatial-validation";
import { assessPlanningAnalysisReference } from "@/lib/planning/analysis-reference";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { generateInteriorDraft, DEFAULT_INTERIOR_SETTINGS } from "@/lib/planning/interior-layout";
import { generateRoomLayout } from "@/lib/planning/room-layout";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/planning/room-layout-schema";
import { groundExitCandidates, groundExitBasis } from "@/lib/planning/egress-core";

export function analysisReferenceFixture(width = 24, depth = 24, projectId = "synthetic-analysis-reference") {
  const input = integratedVerificationFixture(projectId);
  const scenario = input.planningScenario!, parcel = input.data.parcel;
  const geo = (x: number, z: number): [number, number] => [127.03 + x / (111000 * Math.cos(37.65 * Math.PI / 180)), 37.65 - z / 111000];
  parcel.boundary = [[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2],[-width/2,-depth/2]].map(([x,z]) => geo(x,z));
  delete parcel.boundaryPolygons;
  parcel.roads = [{ name: "Synthetic road observation, not a permit", points: [geo(-width, depth/2+3), geo(width, depth/2+3)] }];
  parcel.address = "서울특별시 도봉구 합성검증동 1";
  parcel.lotArea = width * depth; parcel.maxBCR = 60; parcel.maxFAR = 200; parcel.heightLimit = 30;
  parcel.regulatoryConstraints = createRegulatoryReferenceSet({ bcrPct: 60, farPct: 200, heightM: 30 });
  const base = calculatePlanningScenario(scenario, { parcel: {
    address: parcel.address, zoning: parcel.zoning, lotAreaSqm: parcel.lotArea, maxBCRPct: 60, maxFARPct: 200,
    heightLimitM: 30, regulatoryConstraints: parcel.regulatoryConstraints, acquisitionCostManwon: 50000, demolitionCostManwon: 1000,
  }, assumptions: planningEconomicsAssumptionsFromLegacy(defaultAssumptions(), "analysis-fixture") });
  const geometry = buildPlanningGeometry({ projectId: parcel.id, scenario, boundary: parcel.boundary, roads: parcel.roads,
    zoning: parcel.zoning, lotAreaSqm: parcel.lotArea, sunlight: base.sunlight, roofAllowanceM: base.metrics.roofAllowanceM }).snapshot;
  for (const floor of scenario.floorPrograms) {
    const outline = geometry.building.floors.find(f => f.id === floor.id)!.shape;
    floor.interiorLayout = generateInteriorDraft(floor, outline, { ...DEFAULT_INTERIOR_SETTINGS, coreDepthM: 5.5 }).draft ?? undefined;
    if (floor.interiorLayout) floor.interiorLayout.roomLayouts = floor.interiorLayout.spaces.filter(s => s.kind === "unit")
      .flatMap(unit => { const draft = generateRoomLayout(floor, unit.id, outline, DEFAULT_ROOM_SETTINGS).draft; return draft ? [draft] : []; });
  }
  const ground = scenario.floorPrograms[0];
  const exit = groundExitCandidates(ground, geometry.building.floors[0].shape)[0];
  if (exit && ground.interiorLayout) scenario.egressPlan!.exit = { floorId: ground.id, spaceId: exit.spaceId, edgeIndex: exit.edgeIndex,
    offsetRatio: 0.5, widthM: 0.9, layoutBasis: groundExitBasis(ground.interiorLayout) };
  const calculation = applySpatialValidationToCalculation(base, calculatePlanningSpatialValidation(parcel.boundary, parcel.zoning,
    scenario, parcel.roads, parcel.setback, base.sunlight, base.metrics.roofAllowanceM));
  const parking = buildPlanningParkingGeometry({ scenario, planning: geometry, requiredCars: calculation.parking.requiredCars,
    boundary: parcel.boundary, roads: parcel.roads });
  return { input, scenario, parcel, calculation, geometry, parking,
    assessment: assessPlanningAnalysisReference({ scenario, parcel, calculation, geometry, parking }) };
}

