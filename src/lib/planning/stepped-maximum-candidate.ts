import type { RoadLine, SetbackSpec } from "@/components/ui/MassingView";
import {
  calcBuildableArea,
  type LngLat,
  type SunStep,
} from "@/lib/finance/buildable-area";
import {
  analyzeFrontage,
  edgeSetbacksFromFrontage,
} from "@/lib/geo/road-frontage";
import {
  calculateParkingLayout,
  type ParkingLayoutResult,
} from "@/lib/planning/parking-layout";
import type {
  PlanningRecommendationEngineInput,
  RecommendationCandidateEvaluation,
  RecommendationEngineParcel,
} from "@/lib/planning/recommendation-engine";
import {
  applyPlanningScenarioCalculation,
  calculatePlanningScenario,
  type PlanningCalculationContext,
} from "@/lib/planning/scenario-calculator";
import {
  applySpatialValidationToCalculation,
  calculatePlanningSpatialValidation,
} from "@/lib/planning/scenario-spatial-validation";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import type {
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

export const STEPPED_MAXIMUM_ENGINE_VERSION =
  "stepped-maximum-candidate-v1" as const;

const UNIT_AREA_OPTIONS = [45, 60, 80] as const;
const MAX_GENERATED_FLOORS = 7;
const MIN_PROGRAM_AREA_SQM = 18;
const CAPACITY_USE_RATIO = 0.995;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function floorDown(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.floor(value * factor) / factor;
}

function openRing(ring: LngLat[]): LngLat[] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring;
}

function ringCentroid(ring: LngLat[]): LngLat {
  const points = openRing(ring);
  if (points.length === 0) return [0, 0];
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

function ringToLocalMeters(ring: LngLat[], origin: LngLat): LocalPlanPoint[] {
  const longitudeScale = Math.cos((origin[1] * Math.PI) / 180);
  return openRing(ring).map(([lng, lat]) => ({
    x: (lng - origin[0]) * 111_000 * longitudeScale,
    z: -(lat - origin[1]) * 111_000,
  }));
}

function maxCandidateFloors(parcel: RecommendationEngineParcel): number {
  const bcr = Math.max(1, parcel.maxBCRPct || 50);
  const far = Math.max(1, parcel.maxFARPct || 100);
  const byFar = Math.max(1, Math.ceil(far / Math.max(20, bcr * 0.55)));
  const byHeight =
    parcel.heightLimitM > 0
      ? Math.max(
          1,
          1 + Math.floor(Math.max(0, parcel.heightLimitM - 3.6) / 3)
        )
      : MAX_GENERATED_FLOORS;
  return clamp(Math.min(byHeight, byFar + 2), 1, MAX_GENERATED_FLOORS);
}

function averageFloorHeight(floors: number): number {
  if (floors <= 1) return 3.6;
  return (3.6 + (floors - 1) * 3) / floors;
}

function steppedCapacity(input: {
  parcel: RecommendationEngineParcel;
  floors: number;
}): { steps: SunStep[]; warnings: string[] } {
  const boundary = input.parcel.boundary;
  if (!boundary || boundary.length < 3) {
    return { steps: [], warnings: ["대지 경계가 없어 층별 상한 후보를 만들 수 없습니다."] };
  }

  const frontage = input.parcel.roads?.length
    ? analyzeFrontage(boundary, input.parcel.roads)
    : null;
  const edgeSetbacks = edgeSetbacksFromFrontage(
    frontage,
    input.parcel.setback ?? { road: 0.5, side: 0.5, rear: 0.5 }
  );
  const result = calcBuildableArea(
    boundary,
    0.5,
    input.floors,
    averageFloorHeight(input.floors),
    /주거/.test(input.parcel.zoning),
    edgeSetbacks
  );
  return { steps: result.stepped3D, warnings: result.warnings };
}

function buildSteppedResidentialFloors(input: {
  steps: SunStep[];
  maxFootprintSqm: number;
  maxFarAreaSqm: number;
  unitAreaSqm: number;
  piloti: boolean;
}): PlanningScenario["floorPrograms"] {
  const programs: PlanningScenario["floorPrograms"] = [];
  let remainingFarArea = input.maxFarAreaSqm;

  for (const step of input.steps) {
    const capacitySqm = floorDown(
      Math.min(step.floorPlateSqm, input.maxFootprintSqm) * CAPACITY_USE_RATIO,
      1
    );
    if (capacitySqm < MIN_PROGRAM_AREA_SQM) break;

    if (input.piloti && step.floor === 1) {
      programs.push(
        createFloorProgram(1, [
          createFloorZone(
            "piloti",
            capacitySqm,
            0,
            "필로티 주차",
            "non-revenue"
          ),
        ])
      );
      continue;
    }

    const areaSqm = floorDown(
      Math.min(capacitySqm, Math.max(0, remainingFarArea)),
      1
    );
    if (areaSqm < MIN_PROGRAM_AREA_SQM) break;
    programs.push(
      createFloorProgram(step.floor, [
        createFloorZone(
          "residential",
          areaSqm,
          Math.max(1, Math.floor(areaSqm / input.unitAreaSqm)),
          "주거",
          "sale"
        ),
      ])
    );
    remainingFarArea -= areaSqm;
    if (remainingFarArea < MIN_PROGRAM_AREA_SQM) break;
  }

  return programs;
}

function createSteppedCandidate(input: {
  projectId: string;
  parcel: RecommendationEngineParcel;
  floors: number;
  unitAreaSqm: number;
  strategy: "surface" | "piloti";
  generatedAt: string;
}): PlanningScenario | null {
  const piloti = input.strategy === "piloti";
  if (piloti && input.floors < 2) return null;

  const capacity = steppedCapacity({
    parcel: input.parcel,
    floors: input.floors,
  });
  if (capacity.steps.length === 0) return null;

  const maxFootprintSqm =
    input.parcel.lotAreaSqm * (Math.max(1, input.parcel.maxBCRPct) / 100);
  const maxFarAreaSqm =
    input.parcel.lotAreaSqm * (Math.max(1, input.parcel.maxFARPct) / 100);
  const floorPrograms = buildSteppedResidentialFloors({
    steps: capacity.steps,
    maxFootprintSqm,
    maxFarAreaSqm,
    unitAreaSqm: input.unitAreaSqm,
    piloti,
  });
  const residentialUnits = floorPrograms.reduce(
    (sum, floor) =>
      sum +
      floor.zones.reduce(
        (zoneSum, zone) =>
          zoneSum + (zone.useType === "residential" ? zone.unitCount : 0),
        0
      ),
    0
  );
  if (residentialUnits <= 0) return null;

  const scenario = createBlankPlanningScenario({
    projectId: input.projectId,
    name: "층별 상한 후보",
    origin: "algorithm-max",
    acquisitionCostManwon: input.parcel.acquisitionCostManwon,
  });
  scenario.createdAt = input.generatedAt;
  scenario.updatedAt = input.generatedAt;
  scenario.primaryUse = residentialUnits <= 1 ? "single-house" : "multi-family";
  scenario.floorPrograms = floorPrograms;
  scenario.parking = {
    strategy: input.strategy,
    providedCars: 0,
    orientation: "auto",
    stallWidthM: 2.5,
    stallDepthM: 5,
    aisleWidthM: 6,
    entryWidthM: 3,
    coreAreaSqm: piloti ? 9 : 0,
    columnLossPct: piloti ? 8 : 0,
  };
  scenario.description = `층별 법규 외곽선 자동 채움 · ${input.floors}층 검토 · 기준 세대면적 ${input.unitAreaSqm}㎡ · ${
    piloti ? "필로티" : "지상"
  } 주차`;
  scenario.economicsPreview.demolitionCostManwon = Math.max(
    0,
    input.parcel.demolitionCostManwon
  );
  return scenario;
}

function localParcelContext(
  boundary: LngLat[] | undefined,
  roads: RoadLine[] | undefined
): {
  parcelShape: LocalPlanPoint[];
  frontEdge: [LocalPlanPoint, LocalPlanPoint] | null;
} {
  if (!boundary || boundary.length < 3) {
    return { parcelShape: [], frontEdge: null };
  }
  const parcelShape = ringToLocalMeters(boundary, ringCentroid(boundary));
  const frontage = roads?.length ? analyzeFrontage(boundary, roads) : null;
  const frontEdge =
    frontage &&
    frontage.frontIndex >= 0 &&
    parcelShape.length > frontage.frontIndex
      ? ([
          parcelShape[frontage.frontIndex],
          parcelShape[(frontage.frontIndex + 1) % parcelShape.length],
        ] as [LocalPlanPoint, LocalPlanPoint])
      : null;
  return { parcelShape, frontEdge };
}

function evaluateCandidate(
  scenario: PlanningScenario,
  input: PlanningRecommendationEngineInput,
  context: PlanningCalculationContext,
  parcelShape: LocalPlanPoint[],
  frontEdge: [LocalPlanPoint, LocalPlanPoint] | null
): RecommendationCandidateEvaluation {
  const initial = calculatePlanningScenario(scenario, context);
  const initialSpatial = calculatePlanningSpatialValidation(
    input.parcel.boundary,
    input.parcel.zoning,
    scenario,
    input.parcel.roads,
    input.parcel.setback
  );
  const firstMass = initialSpatial?.model.aboveGroundFloors.find(
    (floor) => floor.level === 1
  );
  const pilotiEnabled = Boolean(
    scenario.floorPrograms
      .find((floor) => floor.level === 1)
      ?.zones.some(
        (zone) =>
          zone.areaSqm > 0 &&
          (zone.useType === "piloti" || zone.useType === "parking")
      )
  );
  const parkingLayout: ParkingLayoutResult = calculateParkingLayout({
    strategy: scenario.parking.strategy,
    parcelShape,
    buildingShape: firstMass?.shape ?? [],
    pilotiShape: firstMass?.shape ?? [],
    pilotiEnabled,
    requiredCars: initial.parking.requiredCars,
    frontEdge,
    parking: scenario.parking,
  });
  const withParking: PlanningScenario = {
    ...scenario,
    parking: { ...scenario.parking, providedCars: parkingLayout.capacityCars },
  };
  const base = calculatePlanningScenario(withParking, context);
  const spatial = calculatePlanningSpatialValidation(
    input.parcel.boundary,
    input.parcel.zoning,
    withParking,
    input.parcel.roads,
    input.parcel.setback
  );
  const calculation: PlanningScenarioCalculation =
    applySpatialValidationToCalculation(base, spatial);
  const applied = applyPlanningScenarioCalculation(withParking, calculation);
  applied.status = "saved";

  const failCount = calculation.checks.filter(
    (check) => check.status === "fail"
  ).length;
  const reviewCount = calculation.checks.filter(
    (check) => check.status === "review" || check.status === "unknown"
  ).length;
  const farUtilizationPct =
    input.parcel.maxFARPct > 0
      ? (calculation.metrics.preliminaryFarPct / input.parcel.maxFARPct) * 100
      : 0;
  const bcrUtilizationPct =
    input.parcel.maxBCRPct > 0
      ? (calculation.metrics.preliminaryBcrPct / input.parcel.maxBCRPct) * 100
      : 0;
  const parkingShortfall = Math.max(
    calculation.parking.shortfallCars,
    parkingLayout.shortfallCars
  );
  const eligible =
    failCount === 0 && parkingLayout.supportedStrategy && parkingShortfall === 0;

  let architectureScore = 100;
  architectureScore -= failCount * 40;
  architectureScore -= reviewCount * 4;
  architectureScore -= parkingShortfall * 18;
  architectureScore -= Math.abs(farUtilizationPct - 68) * 0.16;
  architectureScore -= Math.max(0, farUtilizationPct - 82) * 0.55;
  architectureScore -= Math.max(0, bcrUtilizationPct - 82) * 0.45;
  architectureScore -=
    Math.max(0, calculation.metrics.aboveGroundFloors - 4) * 2.5;
  if (scenario.parking.strategy === "piloti") architectureScore -= 2;

  return {
    scenario: applied,
    calculation,
    parkingLayout,
    architectureScore: round(clamp(architectureScore, 0, 100), 1),
    eligible,
    failCount,
    reviewCount,
    farUtilizationPct: round(farUtilizationPct, 1),
    bcrUtilizationPct: round(bcrUtilizationPct, 1),
  };
}

export function isSteppedMaximumEvaluation(
  evaluation: RecommendationCandidateEvaluation
): boolean {
  return evaluation.scenario.description.includes(
    "층별 법규 외곽선 자동 채움"
  );
}

export function generateSteppedMaximumEvaluations(
  input: PlanningRecommendationEngineInput
): RecommendationCandidateEvaluation[] {
  if (!input.parcel.boundary || input.parcel.boundary.length < 3) return [];

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const context: PlanningCalculationContext = {
    parcel: {
      lotAreaSqm: input.parcel.lotAreaSqm,
      maxFARPct: input.parcel.maxFARPct,
      maxBCRPct: input.parcel.maxBCRPct,
      heightLimitM: input.parcel.heightLimitM,
      acquisitionCostManwon: input.parcel.acquisitionCostManwon,
      demolitionCostManwon: input.parcel.demolitionCostManwon,
    },
    assumptions: input.assumptions,
    calculatedAt: generatedAt,
  };
  const { parcelShape, frontEdge } = localParcelContext(
    input.parcel.boundary,
    input.parcel.roads
  );
  const evaluations: RecommendationCandidateEvaluation[] = [];

  for (
    let floors = 1;
    floors <= maxCandidateFloors(input.parcel);
    floors += 1
  ) {
    for (const unitAreaSqm of UNIT_AREA_OPTIONS) {
      for (const strategy of ["surface", "piloti"] as const) {
        const candidate = createSteppedCandidate({
          projectId: input.projectId,
          parcel: input.parcel,
          floors,
          unitAreaSqm,
          strategy,
          generatedAt,
        });
        if (!candidate) continue;
        evaluations.push(
          evaluateCandidate(candidate, input, context, parcelShape, frontEdge)
        );
      }
    }
  }

  return evaluations;
}
