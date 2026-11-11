import type { RoadLine, SetbackSpec } from "@/components/ui/MassingView";
import {
  calcBuildableArea,
  type LngLat,
} from "@/lib/finance/buildable-area";
import { analyzeParcelFrontage } from "@/lib/geo/road-frontage";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelArea, projectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { resolvePlanningParcel } from "./planning-parcel";
import {
  calculateParkingLayout,
  type ParkingLayoutInput,
  type ParkingLayoutResult,
} from "@/lib/planning/parking-layout";
import {
  applyPlanningScenarioCalculation,
  calculatePlanningScenario,
  type PlanningCalculationContext,
} from "@/lib/planning/scenario-calculator";
import {
  applySpatialValidationToCalculation,
  calculatePlanningSpatialValidation,
  type PlanningSpatialValidation,
} from "@/lib/planning/scenario-spatial-validation";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";
import { buildDwellingProgram, DEFAULT_DWELLING_PROGRAM, dwellingProgramSummary } from "@/lib/planning/dwelling-program";
import { screenZoningUse } from "@/lib/regulatory/zoning-use-screening";
import type {
  PlanningEconomicsAssumptions,
  PlanningRecommendationMetadata,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";
import {
  regulatoryConstraintIsDecisionGrade,
  type RegulatoryConstraintSet,
} from "@/lib/regulatory/constraints";
import {
  evaluateSunlightRegulation,
  toSunlightGeometryProfile,
  type SunlightDaylightInput,
  type SunlightInputStatus,
  type SunlightNorthBoundaryInput,
} from "@/lib/regulatory/sunlight-rules";

export const PLANNING_RECOMMENDATION_ENGINE_VERSION =
  "planning-recommendation-v5-bounded-search" as const;

export const RECOMMENDATION_SEARCH_BUDGET_MS = 15_000;

const ENVELOPE_UTILIZATION_RATIOS = [0.4, 0.55, 0.7, 0.85, 0.98] as const;
const UNIT_AREA_OPTIONS = [45, 60, 80] as const;
const SMALL_DWELLING_AREA_OPTIONS = [20, 26, 30, 45, 60, 80] as const;
const MAX_GENERATED_FLOORS = 7;
const MIN_PROGRAM_AREA_SQM = 18;
const GEOMETRY_BLOCKING_CODES = new Set([
  "bcr",
  "far",
  "height",
  "floor-area-vs-lot",
  "spatial-area-capacity",
  "spatial-placement",
  "spatial-floor-support",
  "floor-levels",
]);

export interface RecommendationEngineParcel {
  address?: string;
  parkingRuleAsOf?: string;
  sunlightRuleAsOf?: string;
  zoningStatus?: SunlightInputStatus;
  sunlightNorthBoundary?: SunlightNorthBoundaryInput;
  sunlightDaylight?: SunlightDaylightInput;
  lotAreaSqm: number;
  maxFARPct: number;
  maxBCRPct: number;
  heightLimitM: number;
  regulatoryConstraints?: RegulatoryConstraintSet;
  roofAllowanceM?: number;
  acquisitionCostManwon: number;
  demolitionCostManwon: number;
  boundary?: LngLat[];
  boundaryPolygons?: Wgs84ParcelPolygon[];
  zoning: string;
  roads?: RoadLine[];
  setback?: SetbackSpec;
}

export interface PlanningRecommendationEngineInput {
  projectId: string;
  sourceRevision?: string;
  parcel: RecommendationEngineParcel;
  assumptions: PlanningEconomicsAssumptions;
  generatedAt?: string;
}

export interface RecommendationCandidateEvaluation {
  scenario: PlanningScenario;
  calculation: PlanningScenarioCalculation;
  parkingLayout: ParkingLayoutResult;
  architectureScore: number;
  eligible: boolean;
  geometryEligible: boolean;
  geometryFailCount: number;
  failCount: number;
  reviewCount: number;
  farUtilizationPct: number;
  bcrUtilizationPct: number;
}

export interface PlanningRecommendationSet {
  engineVersion: string;
  searchStatus: "complete" | "incomplete";
  generatedAt: string;
  evaluatedCandidates: number;
  eligibleCandidates: number;
  architecturalFeasibility: PlanningScenario | null;
  profitOptimal: PlanningScenario | null;
  legalCeilingReference: PlanningScenario | null;
  warnings: string[];
  evaluations: RecommendationCandidateEvaluation[];
}

interface SteppedEnvelopeProfile {
  capacitiesSqm: number[];
  warnings: string[];
  source: "legal-envelope" | "bcr-fallback" | "unavailable";
  calculationIncomplete?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function maxCandidateFloors(parcel: RecommendationEngineParcel): number {
  const bcr = Math.max(1, parcel.maxBCRPct || 50);
  const far = Math.max(1, parcel.maxFARPct || 100);
  const byFar = Math.max(1, Math.ceil(far / Math.max(20, bcr * 0.75)));
  const verifiedHeight = regulatoryConstraintIsDecisionGrade(
    parcel.regulatoryConstraints?.height
  )
    ? parcel.regulatoryConstraints!.height.value!
    : null;
  const byHeight =
    verifiedHeight != null
      ? Math.max(
          1,
          1 +
            Math.floor(
              Math.max(0, verifiedHeight - (parcel.roofAllowanceM ?? 1.4) - 3.6) / 3
            )
        )
      : MAX_GENERATED_FLOORS;
  const verifiedFloors = regulatoryConstraintIsDecisionGrade(
    parcel.regulatoryConstraints?.floors
  )
    ? Math.floor(parcel.regulatoryConstraints!.floors.value!)
    : MAX_GENERATED_FLOORS;
  return clamp(
    Math.min(byHeight, verifiedFloors, byFar + 2),
    1,
    MAX_GENERATED_FLOORS
  );
}

function averageFloorHeight(floors: number): number {
  return floors <= 1 ? 3.6 : (3.6 + Math.max(0, floors - 1) * 3) / floors;
}

export function buildSteppedEnvelopeProfile(
  parcel: RecommendationEngineParcel,
  floors: number
): SteppedEnvelopeProfile {
  const maxFootprintSqm =
    parcel.lotAreaSqm * (Math.max(1, parcel.maxBCRPct) / 100);
  if (parcel.boundaryPolygons === undefined && !parcel.boundary?.length) {
    return {
      capacitiesSqm: Array.from({ length: floors }, () => maxFootprintSqm),
      warnings: ["대지 경계가 없어 입력 건폐율 면적을 층별 외곽선 대체값으로 사용했습니다."],
      source: "bcr-fallback",
    };
  }

  const region = resolvePlanningParcel(parcel);
  if (!region.available) {
    return { capacitiesSqm: Array.from({ length: floors }, () => 0), source: "unavailable",
      warnings: ["입력한 전체 대지 경계를 확인하지 못해 후보 생성을 보류했습니다. 경계를 건폐율 추정값으로 대체하지 않았습니다."] };
  }
  const frontage = analyzeParcelFrontage(region.source, parcel.roads ?? [], region.origin);
  const setback = parcel.setback ?? { road: 0.5, side: 0.5, rear: 0.5 };
  const edgeSetbacksByPolygon = region.polygons.map(part => [part.outer, ...part.holes].map(ring => ring.map(() => Math.max(0.5, setback.side))));
  for (const edge of frontage?.edges ?? []) {
    edgeSetbacksByPolygon[edge.polygonIndex][edge.ringIndex][edge.edgeIndex] =
      Math.max(edge.role === "전면" ? 0 : 0.5, edge.role === "전면" ? setback.road : edge.role === "후면" ? setback.rear : setback.side);
  }
  const floorHeightsM = Array.from(
    { length: floors },
    (_, index) => (index === 0 ? 3.6 : 3)
  );
  const roofAllowanceM = parcel.roofAllowanceM ?? 1.4;
  const sunlight = evaluateSunlightRegulation({
    context: {
      address: parcel.address,
      asOf: parcel.sunlightRuleAsOf,
    },
    zoning: parcel.zoning,
    zoningStatus: parcel.zoningStatus,
    buildingHeightM:
      floorHeightsM.reduce((sum, height) => sum + height, 0) +
      roofAllowanceM,
    floorsAbove: floors,
    legalUse: "unknown-residential",
    legalUseStatus: "user-entered",
    northBoundary: parcel.sunlightNorthBoundary,
    daylight: {
      sameLotBuildingCount: 1,
      sameLotBuildingCountStatus: "source-backed",
      ...parcel.sunlightDaylight,
    },
  });
  const buildable = calcBuildableArea(
    parcel.boundary,
    0.5,
    floors,
    averageFloorHeight(floors),
    /주거/.test(parcel.zoning),
    undefined,
    {
      polygons: region.source,
      edgeSetbacksByPolygon,
      sunlightProfile: toSunlightGeometryProfile(sunlight),
      floorHeightsM,
      floorLevels: Array.from({ length: floors }, (_, index) => index + 1),
      roofAllowanceM,
    }
  );
  const capacitiesSqm: number[] = [];
  let previous = maxFootprintSqm;

  for (let level = 1; level <= floors; level += 1) {
    const step = buildable.stepped3D.find((candidate) => candidate.floor === level);
    // A generated floor is one connected footprint, not the sum of disconnected pieces.
    const parts = step ? projectParcelPolygons(step.polygons, region.origin) : [];
    const measured = buildable.geometryStatus === "available" ? Math.max(0, ...parts.map(part => localParcelArea([part]))) : 0;
    const capped = Math.max(0, Math.min(maxFootprintSqm, measured));
    const monotonic = Math.min(previous, capped);
    capacitiesSqm.push(round(monotonic, 3));
    previous = monotonic;
  }

  return {
    capacitiesSqm,
    warnings: buildable.warnings,
    source: buildable.geometryStatus === "available" ? "legal-envelope" : "unavailable",
    calculationIncomplete: buildable.geometryStatus !== "available",
  };
}

function buildResidentialFloors(input: {
  capacitiesSqm: number[];
  utilizationRatio: number;
  maxFarAreaSqm: number;
  unitAreaSqm: number;
  piloti: boolean;
}): PlanningScenario["floorPrograms"] {
  const programs: PlanningScenario["floorPrograms"] = [];
  let remainingFarArea = input.maxFarAreaSqm;

  for (let index = 0; index < input.capacitiesSqm.length; index += 1) {
    const level = index + 1;
    const capacitySqm = Math.max(0, input.capacitiesSqm[index]);
    const targetSqm = capacitySqm * input.utilizationRatio;
    if (input.piloti && level === 1) {
      if (targetSqm >= MIN_PROGRAM_AREA_SQM) {
        programs.push(
          createFloorProgram(1, [
            createFloorZone("piloti", targetSqm, 0, "필로티 주차", "non-revenue"),
          ])
        );
      }
      continue;
    }

    const areaSqm = Math.min(targetSqm, Math.max(0, remainingFarArea));
    if (areaSqm < MIN_PROGRAM_AREA_SQM) break;
    programs.push(
      createFloorProgram(level, [
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

function createCandidate(input: {
  projectId: string;
  parcel: RecommendationEngineParcel;
  profile: SteppedEnvelopeProfile;
  utilizationRatio: number;
  unitAreaSqm: number;
  strategy: "surface" | "piloti";
  generatedAt: string;
  dwellingMix?: "uniform" | "compact-lower";
}): PlanningScenario | null {
  const piloti = input.strategy === "piloti";
  if (piloti && input.profile.capacitiesSqm.length < 2) return null;
  const programInput = {
    capacitiesSqm: input.profile.capacitiesSqm,
    utilizationRatio: input.utilizationRatio,
    maxFarAreaSqm:
      input.parcel.lotAreaSqm * (Math.max(1, input.parcel.maxFARPct) / 100),
    unitAreaSqm: input.unitAreaSqm,
    piloti,
  };
  const floorPrograms = input.dwellingMix
    ? buildDwellingProgram({ ...programInput, targetExclusiveAreaSqm: input.unitAreaSqm, mix: input.dwellingMix })
    : buildResidentialFloors(programInput);
  if (!floorPrograms) return null;
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
  if (input.dwellingMix) {
    if (residentialUnits < 2) return null;
    const useScreen = screenZoningUse(input.parcel.zoning, "multi-family", {
      address: input.parcel.address, asOf: input.generatedAt.slice(0, 10),
      legalUseCode: "BA-A1-2-C",
      residentialFloors: floorPrograms.filter((floor) => floor.zones.some((zone) => zone.useType === "residential")).length,
      useAreaSqm: floorPrograms.reduce((sum, floor) => sum + floor.zones.filter((zone) => zone.useType !== "piloti").reduce((subtotal, zone) => subtotal + zone.areaSqm, 0), 0),
      householdCount: residentialUnits,
      aboveGroundFloors: floorPrograms.length,
    });
    if (!useScreen.autoGeneratable) return null;
  }

  const scenario = createBlankPlanningScenario({
    projectId: input.projectId,
    name: "알고리즘 후보",
    origin: "algorithm-balanced",
    acquisitionCostManwon: input.parcel.acquisitionCostManwon,
  });
  scenario.createdAt = input.generatedAt;
  scenario.updatedAt = input.generatedAt;
  scenario.primaryUse = residentialUnits <= 1 ? "single-house" : "multi-family";
  scenario.floorPrograms = floorPrograms;
  if (input.dwellingMix) {
    scenario.primaryUse = "multi-family";
    scenario.sunlightLegalUse = "multi-unit-house";
    scenario.sunlightLegalUseStatus = "user-entered";
    scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM };
  }
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
  scenario.description = `${floorPrograms.filter((floor) => floor.level > 0).length}층 · 층별 법규 외곽선 ${Math.round(input.utilizationRatio * 100)}% 사용 · 기준 세대면적 ${input.unitAreaSqm}㎡ · ${piloti ? "필로티" : "지상"} 주차 후보`;
  if (input.dwellingMix) {
    const summary = dwellingProgramSummary(floorPrograms);
    scenario.description = `${floorPrograms.length}층 · ${summary.unitCount}세대 · 전용 ${summary.minExclusiveSqm.toFixed(1)}~${summary.maxExclusiveSqm.toFixed(1)}㎡ · ${input.dwellingMix === "compact-lower" ? "혼합 평형" : "층별 균등 평형"} · 미검증 면적 프로그램`;
  }
  scenario.economicsPreview.demolitionCostManwon = Math.max(
    0,
    input.parcel.demolitionCostManwon
  );
  return scenario;
}

function localParcelContext(parcel: RecommendationEngineParcel): Pick<ParkingLayoutInput, "parcelShape" | "parcelPolygons" | "frontages" | "frontEdge"> {
  const region = resolvePlanningParcel(parcel);
  const frontage = region.available ? analyzeParcelFrontage(region.source, parcel.roads ?? [], region.origin) : null;
  const primary = frontage?.frontages.reduce<(typeof frontage.frontages)[number] | null>((best, edge) =>
    !best || edge.roadDistM < best.roadDistM ? edge : best, null);
  return { parcelShape: region.simple ? region.polygons[0].outer : [], parcelPolygons: region.polygons,
    frontages: frontage?.frontages ?? [], frontEdge: primary?.edge ?? null };
}

/**
 * 공간 검증은 층별 총면적·층 형상·배치에만 좌우된다.
 * 세대면적 옵션이 달라 unitCount만 바뀐 후보는 같은 3D 형상을 공유하므로
 * 추천 한 번의 실행 안에서 동일한 기하 검증을 재사용한다.
 */
function spatialGeometryKey(scenario: PlanningScenario): string {
  return JSON.stringify({
    floors: scenario.floorPrograms.map((floor) => ({
      level: floor.level,
      floorHeightM: round(floor.floorHeightM, 3),
      footprintScalePct: round(floor.footprintScalePct, 3),
      northSetbackM: round(floor.northSetbackM, 3),
      areaSqm: round(
        floor.zones.reduce((sum, zone) => sum + Math.max(0, zone.areaSqm), 0),
        3
      ),
    })),
    placement: scenario.placement,
  });
}

function evaluateCandidate(
  scenario: PlanningScenario,
  input: PlanningRecommendationEngineInput,
  context: PlanningCalculationContext,
  parcelContext: ReturnType<typeof localParcelContext>,
  spatialCache: Map<string, PlanningSpatialValidation | null>,
  onIncomplete: () => void,
): RecommendationCandidateEvaluation {
  const initial = calculatePlanningScenario(scenario, context);
  const spatialKey = spatialGeometryKey(scenario);
  let initialSpatial: PlanningSpatialValidation | null =
    spatialCache.get(spatialKey) ?? null;
  if (!spatialCache.has(spatialKey)) {
    initialSpatial = calculatePlanningSpatialValidation(
      input.parcel.boundary,
      input.parcel.zoning,
      scenario,
      input.parcel.roads,
      input.parcel.setback,
      initial.sunlight,
      initial.metrics.roofAllowanceM,
      input.parcel.boundaryPolygons
    );
    spatialCache.set(spatialKey, initialSpatial);
  }
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
  const parkingLayout = calculateParkingLayout({
    strategy: scenario.parking.strategy,
    ...parcelContext,
    buildingShape: firstMass?.shape ?? [],
    pilotiShape: firstMass?.shape ?? [],
    pilotiEnabled,
    requiredCars: initial.parking.requiredCars,
    parking: scenario.parking,
  });
  if (parkingLayout.generationStatus === "budget-exhausted"
    || (parkingLayout.generationStatus === "invalid-input" && Boolean(parcelContext.parcelPolygons?.length))
    || initialSpatial?.model.floors.some(floor => floor.generationStatus === "budget-exhausted")
    || initialSpatial?.envelopeSteps.some(step => !step.envelopeAvailable)
    || (!initialSpatial && Boolean(parcelContext.parcelPolygons?.length))) onIncomplete();
  const withParking: PlanningScenario = {
    ...scenario,
    parking: { ...scenario.parking, providedCars: parkingLayout.capacityCars },
  };
  const base = calculatePlanningScenario(withParking, context);
  // providedCars만 달라졌으므로 층별 형상·배치 검증 결과는 그대로다.
  const calculation = applySpatialValidationToCalculation(base, initialSpatial);
  const applied = applyPlanningScenarioCalculation(withParking, calculation);
  applied.status = "saved";

  const failedChecks = calculation.checks.filter((check) => check.status === "fail");
  const failCount = failedChecks.length;
  const geometryFailCount = failedChecks.filter((check) =>
    GEOMETRY_BLOCKING_CODES.has(check.code)
  ).length;
  const envelopeUnknown = calculation.checks.some(
    (check) => check.code === "spatial-envelope-data" && check.status === "unknown"
  );
  const geometryEligible = geometryFailCount === 0 && !envelopeUnknown;
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
    geometryEligible &&
    failCount === 0 &&
    parkingLayout.supportedStrategy &&
    parkingShortfall === 0;

  let architectureScore = 100;
  architectureScore -= failCount * 40;
  architectureScore -= reviewCount * 4;
  architectureScore -= parkingShortfall * 18;
  architectureScore -= Math.abs(farUtilizationPct - 68) * 0.16;
  architectureScore -= Math.max(0, farUtilizationPct - 82) * 0.55;
  architectureScore -= Math.max(0, bcrUtilizationPct - 82) * 0.45;
  architectureScore -= Math.max(0, calculation.metrics.aboveGroundFloors - 4) * 2.5;
  if (scenario.parking.strategy === "piloti") architectureScore -= 2;

  return {
    scenario: applied,
    calculation,
    parkingLayout,
    architectureScore: round(clamp(architectureScore, 0, 100), 1),
    eligible,
    geometryEligible,
    geometryFailCount,
    failCount,
    reviewCount,
    farUtilizationPct: round(farUtilizationPct, 1),
    bcrUtilizationPct: round(bcrUtilizationPct, 1),
  };
}

function metadata(input: {
  objective: PlanningRecommendationMetadata["objective"];
  generatedAt: string;
  evaluatedCandidates: number;
  eligibleCandidates: number;
  evaluation: RecommendationCandidateEvaluation;
  reasons: string[];
  warnings?: string[];
}): PlanningRecommendationMetadata {
  return {
    engineVersion: PLANNING_RECOMMENDATION_ENGINE_VERSION,
    objective: input.objective,
    generatedAt: input.generatedAt,
    evaluatedCandidates: input.evaluatedCandidates,
    eligibleCandidates: input.eligibleCandidates,
    architectureScore: input.evaluation.architectureScore,
    eligible: input.evaluation.eligible,
    reasons: input.reasons,
    warnings: input.warnings ?? [],
  };
}

function recommendation(
  evaluation: RecommendationCandidateEvaluation,
  input: {
    slot: "safe" | "profit" | "max";
    origin: PlanningScenario["origin"];
    name: string;
    description: string;
    recommendation: PlanningRecommendationMetadata;
  }
): PlanningScenario {
  return {
    ...evaluation.scenario,
    id: `${evaluation.scenario.id}-${input.slot}`,
    name: input.name,
    description: input.description,
    origin: input.origin,
    status: "saved",
    recommendation: input.recommendation,
  };
}

export function generatePlanningRecommendations(
  input: PlanningRecommendationEngineInput
): PlanningRecommendationSet {
  const deadline = performance.now() + RECOMMENDATION_SEARCH_BUDGET_MS;
  const searchState: { status: PlanningRecommendationSet["searchStatus"] } = { status: "complete" };
  const expired = () => {
    if (performance.now() < deadline) return false;
    searchState.status = "incomplete";
    return true;
  };
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const context: PlanningCalculationContext = {
    parcel: {
      address: input.parcel.address,
      parkingRuleAsOf:
        input.parcel.parkingRuleAsOf ?? generatedAt.slice(0, 10),
      zoning: input.parcel.zoning,
      zoningStatus: input.parcel.zoningStatus,
      sunlightRuleAsOf:
        input.parcel.sunlightRuleAsOf ?? generatedAt.slice(0, 10),
      sunlightNorthBoundary: input.parcel.sunlightNorthBoundary,
      sunlightDaylight: input.parcel.sunlightDaylight,
      lotAreaSqm: input.parcel.lotAreaSqm,
      maxFARPct: input.parcel.maxFARPct,
      maxBCRPct: input.parcel.maxBCRPct,
      heightLimitM: input.parcel.heightLimitM,
      regulatoryConstraints: input.parcel.regulatoryConstraints,
      roofAllowanceM: input.parcel.roofAllowanceM,
      acquisitionCostManwon: input.parcel.acquisitionCostManwon,
      demolitionCostManwon: input.parcel.demolitionCostManwon,
    },
    assumptions: input.assumptions,
    calculatedAt: generatedAt,
  };
  const parcelContext = localParcelContext(input.parcel);
  const evaluations: RecommendationCandidateEvaluation[] = [];
  const profileWarnings = new Set<string>();
  const spatialCache = new Map<string, PlanningSpatialValidation | null>();
  const dwellingSearch = input.parcel.lotAreaSqm > 0 && input.parcel.lotAreaSqm <= 330 &&
    /^(서울특별시|서울)(?:\s|$)/.test(input.parcel.address ?? "") &&
    (input.parcel.parkingRuleAsOf ?? generatedAt).slice(0, 10) >= "2026-09-08";
  const uniquePrograms = new Set<string>();

  search: for (let floors = 1; floors <= maxCandidateFloors(input.parcel); floors += 1) {
    if (expired()) break;
    const profile = buildSteppedEnvelopeProfile(input.parcel, floors);
    profile.warnings.forEach((warning) => profileWarnings.add(warning));
    if (profile.calculationIncomplete) {
      searchState.status = "incomplete";
      break;
    }
    for (const utilizationRatio of dwellingSearch ? [...ENVELOPE_UTILIZATION_RATIOS, 1] : ENVELOPE_UTILIZATION_RATIOS) {
      for (const unitAreaSqm of dwellingSearch ? SMALL_DWELLING_AREA_OPTIONS : UNIT_AREA_OPTIONS) {
        for (const strategy of ["surface", "piloti"] as const) {
          for (const dwellingMix of dwellingSearch ? ["uniform", "compact-lower"] as const : [undefined]) {
          if (expired()) break search;
          const candidate = createCandidate({
            projectId: input.projectId,
            parcel: input.parcel,
            profile,
            utilizationRatio,
            unitAreaSqm,
            strategy,
            generatedAt,
            dwellingMix,
          });
          if (candidate) {
            const key = JSON.stringify({ strategy, floors: candidate.floorPrograms.map((floor) => ({ level: floor.level,
              zones: floor.zones.map((zone) => [zone.useType, round(zone.areaSqm, 5), zone.unitCount]) })) });
            if (uniquePrograms.has(key)) continue;
            uniquePrograms.add(key);
            evaluations.push(
              evaluateCandidate(
                candidate,
                input,
                context,
                parcelContext,
                spatialCache,
                () => { searchState.status = "incomplete"; },
              )
            );
            if (searchState.status === "incomplete") break search;
          }
          }
        }
      }
    }
  }

  const warnings = [...profileWarnings];
  if (!parcelContext.parcelPolygons?.length) {
    warnings.push("대지 경계가 없어 층별 법규 외곽선과 배치를 검증하지 못했습니다.");
  } else if (!parcelContext.parcelShape?.length) {
    warnings.push("전체 대지 조각과 내부 빈 공간을 입력으로 검사합니다. 현재 자동 후보는 층별 단일 연속 건물이며 다동 배치·합필 가능 여부·공식 경계·허가는 별도 검토가 필요합니다.");
  }
  expired();
  const searchStatus = searchState.status;
  if (searchStatus === "incomplete") {
    return {
      engineVersion: PLANNING_RECOMMENDATION_ENGINE_VERSION,
      searchStatus,
      generatedAt,
      evaluatedCandidates: evaluations.length,
      eligibleCandidates: evaluations.filter(candidate => candidate.eligible).length,
      architecturalFeasibility: null,
      profitOptimal: null,
      legalCeilingReference: null,
      warnings: [...warnings, "전체 후보 탐색 또는 개별 형상·주차 검사를 완료하지 못해 추천 순위와 상한안을 확정하지 않았습니다. 계산 시간·입력 한도를 확인해야 하며 기존 계획은 유지됩니다."],
      evaluations,
    };
  }

  const eligible = evaluations.filter((candidate) => candidate.eligible);
  const geometryEligible = evaluations.filter(
    (candidate) => candidate.geometryEligible
  );
  const safe = [...eligible].sort(
    (a, b) =>
      b.architectureScore - a.architectureScore ||
      b.calculation.economicsPreview.profitManwon -
        a.calculation.economicsPreview.profitManwon
  )[0];
  const profit = [...eligible].sort(
    (a, b) =>
      b.calculation.economicsPreview.profitManwon -
        a.calculation.economicsPreview.profitManwon ||
      b.calculation.economicsPreview.profitMarginPct -
        a.calculation.economicsPreview.profitMarginPct ||
      b.architectureScore - a.architectureScore
  )[0];
  const maximum = [...geometryEligible].sort(
    (a, b) =>
      b.calculation.metrics.preliminaryFarPct -
        a.calculation.metrics.preliminaryFarPct ||
      b.calculation.metrics.preliminaryBcrPct -
        a.calculation.metrics.preliminaryBcrPct ||
      a.calculation.parking.shortfallCars - b.calculation.parking.shortfallCars
  )[0];
  const evaluatedCandidates = evaluations.length;
  const eligibleCandidates = eligible.length;
  if (!safe || !profit) {
    warnings.push(
      "법규 외곽선과 실제 주차 배치를 모두 통과하는 자동 후보를 찾지 못했습니다. 직접 설계안에서 면적·층수·주차 전략을 조정해야 합니다."
    );
  }
  if (!maximum) {
    warnings.push(
      "층별 법규 외곽선·이동·회전·층간 연결을 통과하는 배치 가능 상한 후보를 찾지 못했습니다."
    );
  }

  return {
    engineVersion: PLANNING_RECOMMENDATION_ENGINE_VERSION,
    searchStatus,
    generatedAt,
    evaluatedCandidates,
    eligibleCandidates,
    architecturalFeasibility: safe
      ? recommendation(safe, {
          slot: "safe",
          origin: "algorithm-safe",
          name: "건축 타당성안",
          description:
            "층별 법규 외곽선·배치·층간 연결·실제 주차 배치를 통과한 후보 중 건축 여유와 단순성이 가장 높은 안입니다.",
          recommendation: metadata({
            objective: "architectural-feasibility",
            generatedAt,
            evaluatedCandidates,
            eligibleCandidates,
            evaluation: safe,
            reasons: [
              `건축 타당성 ${safe.architectureScore.toFixed(1)}점`,
              `법규·배치 필수 미충족 ${safe.failCount}건`,
              `주차 ${safe.parkingLayout.capacityCars}/${safe.calculation.parking.requiredCars}대`,
              `입력 용적률의 ${safe.farUtilizationPct.toFixed(1)}% 사용`,
            ],
          }),
        })
      : null,
    profitOptimal: profit
      ? recommendation(profit, {
          slot: "profit",
          origin: "algorithm-balanced",
          name: "수익 최적안",
          description:
            "층별 법규 외곽선과 실제 주차 배치를 통과한 후보만 대상으로 Stage 2 개략 이익이 가장 높은 안을 선택했습니다.",
          recommendation: metadata({
            objective: "profit",
            generatedAt,
            evaluatedCandidates,
            eligibleCandidates,
            evaluation: profit,
            reasons: [
              `실행 가능 후보 ${eligibleCandidates}개 중 개략 이익 최대`,
              `개략 이익 ${round(
                profit.calculation.economicsPreview.profitManwon,
                0
              ).toLocaleString()}만원`,
              `이익률 ${profit.calculation.economicsPreview.profitMarginPct.toFixed(1)}%`,
              `건축 타당성 ${profit.architectureScore.toFixed(1)}점`,
            ],
          }),
        })
      : null,
    legalCeilingReference: maximum
      ? recommendation(maximum, {
          slot: "max",
          origin: "algorithm-max",
          name: "배치 가능 상한 참고안",
          description:
            "층별 정북일조·후퇴 외곽선의 실제 수용면적을 따라 프로그램을 줄이고, 배치·층간 연결을 통과한 후보 중 실현 용적률이 가장 높은 비교안입니다.",
          recommendation: metadata({
            objective: "legal-ceiling",
            generatedAt,
            evaluatedCandidates,
            eligibleCandidates,
            evaluation: maximum,
            reasons: [
              `실현 용적률 ${maximum.calculation.metrics.preliminaryFarPct.toFixed(1)}%`,
              `입력 용적률의 ${maximum.farUtilizationPct.toFixed(1)}% 사용`,
              `예비 건폐율 ${maximum.calculation.metrics.preliminaryBcrPct.toFixed(1)}%`,
              `층별 외곽선·배치 미충족 ${maximum.geometryFailCount}건`,
            ],
            warnings:
              maximum.calculation.parking.shortfallCars > 0
                ? [
                    `배치 가능한 상한 매스이지만 주차가 ${maximum.calculation.parking.shortfallCars}대 부족하여 대표안으로 확정할 수 없습니다.`,
                  ]
                : [
                    "배치 가능한 상한 비교 기준이며 수익 또는 건축 타당성 추천안은 아닙니다.",
                  ],
          }),
        })
      : null,
    warnings,
    evaluations,
  };
}
