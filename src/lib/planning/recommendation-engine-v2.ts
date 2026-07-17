import type { RoadLine, SetbackSpec } from "@/components/ui/MassingView";
import {
  calcBuildableArea,
  type LngLat,
} from "@/lib/finance/buildable-area";
import {
  analyzeFrontage,
  edgeSetbacksFromFrontage,
} from "@/lib/geo/road-frontage";
import {
  calculateParkingLayout,
  type ParkingLayoutResult,
} from "@/lib/planning/parking-layout";
import {
  polygonAreaSqm,
  type LocalPlanPoint,
} from "@/lib/planning/planning-massing";
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
import type {
  PlanningEconomicsAssumptions,
  PlanningRecommendationMetadata,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

export const PLANNING_RECOMMENDATION_ENGINE_VERSION =
  "planning-recommendation-v2-stepped-envelope" as const;

const ENVELOPE_UTILIZATION_RATIOS = [0.4, 0.55, 0.7, 0.85, 0.98] as const;
const UNIT_AREA_OPTIONS = [45, 60, 80] as const;
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
  lotAreaSqm: number;
  maxFARPct: number;
  maxBCRPct: number;
  heightLimitM: number;
  acquisitionCostManwon: number;
  demolitionCostManwon: number;
  boundary?: LngLat[];
  zoning: string;
  roads?: RoadLine[];
  setback?: SetbackSpec;
}

export interface PlanningRecommendationEngineInput {
  projectId: string;
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
  source: "legal-envelope" | "bcr-fallback";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

function ringAreaSqm(ring: LngLat[] | undefined, origin: LngLat): number {
  return ring && ring.length >= 3
    ? polygonAreaSqm(ringToLocalMeters(ring, origin))
    : 0;
}

function maxCandidateFloors(parcel: RecommendationEngineParcel): number {
  const bcr = Math.max(1, parcel.maxBCRPct || 50);
  const far = Math.max(1, parcel.maxFARPct || 100);
  const byFar = Math.max(1, Math.ceil(far / Math.max(20, bcr * 0.75)));
  const byHeight =
    parcel.heightLimitM > 0
      ? Math.max(1, 1 + Math.floor(Math.max(0, parcel.heightLimitM - 3.6) / 3))
      : MAX_GENERATED_FLOORS;
  return clamp(Math.min(byHeight, byFar + 2), 1, MAX_GENERATED_FLOORS);
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
  if (!parcel.boundary || parcel.boundary.length < 3) {
    return {
      capacitiesSqm: Array.from({ length: floors }, () => maxFootprintSqm),
      warnings: ["대지 경계가 없어 법정 건폐율 면적을 층별 외곽선 대체값으로 사용했습니다."],
      source: "bcr-fallback",
    };
  }

  const frontage = parcel.roads?.length
    ? analyzeFrontage(parcel.boundary, parcel.roads)
    : null;
  const edgeSetbacks = edgeSetbacksFromFrontage(
    frontage,
    parcel.setback ?? { road: 0.5, side: 0.5, rear: 0.5 }
  );
  const buildable = calcBuildableArea(
    parcel.boundary,
    0.5,
    floors,
    averageFloorHeight(floors),
    /주거/.test(parcel.zoning),
    edgeSetbacks
  );
  const origin = ringCentroid(parcel.boundary);
  const fallbackArea = Math.min(
    maxFootprintSqm,
    ringAreaSqm(buildable.buildable2DRing ?? parcel.boundary, origin)
  );
  const capacitiesSqm: number[] = [];
  let previous = fallbackArea;

  for (let level = 1; level <= floors; level += 1) {
    const step = buildable.stepped3D.find((candidate) => candidate.floor === level);
    const measured = step?.ringLngLat
      ? ringAreaSqm(step.ringLngLat, origin)
      : step?.floorPlateSqm ?? fallbackArea;
    const capped = Math.max(0, Math.min(maxFootprintSqm, measured || fallbackArea));
    const monotonic = Math.min(previous, capped);
    capacitiesSqm.push(round(monotonic, 3));
    previous = monotonic;
  }

  return {
    capacitiesSqm,
    warnings: buildable.warnings,
    source: "legal-envelope",
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
}): PlanningScenario | null {
  const piloti = input.strategy === "piloti";
  if (piloti && input.profile.capacitiesSqm.length < 2) return null;
  const floorPrograms = buildResidentialFloors({
    capacitiesSqm: input.profile.capacitiesSqm,
    utilizationRatio: input.utilizationRatio,
    maxFarAreaSqm:
      input.parcel.lotAreaSqm * (Math.max(1, input.parcel.maxFARPct) / 100),
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
    name: "알고리즘 후보",
    origin: "algorithm-balanced",
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
  scenario.description = `${floorPrograms.filter((floor) => floor.level > 0).length}층 · 층별 법규 외곽선 ${Math.round(input.utilizationRatio * 100)}% 사용 · 기준 세대면적 ${input.unitAreaSqm}㎡ · ${piloti ? "필로티" : "지상"} 주차 후보`;
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
    frontage && frontage.frontIndex >= 0 && parcelShape.length > frontage.frontIndex
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
  const parkingLayout = calculateParkingLayout({
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
  const calculation = applySpatialValidationToCalculation(base, spatial);
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
  const profileWarnings = new Set<string>();

  for (let floors = 1; floors <= maxCandidateFloors(input.parcel); floors += 1) {
    const profile = buildSteppedEnvelopeProfile(input.parcel, floors);
    profile.warnings.forEach((warning) => profileWarnings.add(warning));
    for (const utilizationRatio of ENVELOPE_UTILIZATION_RATIOS) {
      for (const unitAreaSqm of UNIT_AREA_OPTIONS) {
        for (const strategy of ["surface", "piloti"] as const) {
          const candidate = createCandidate({
            projectId: input.projectId,
            parcel: input.parcel,
            profile,
            utilizationRatio,
            unitAreaSqm,
            strategy,
            generatedAt,
          });
          if (candidate) {
            evaluations.push(
              evaluateCandidate(candidate, input, context, parcelShape, frontEdge)
            );
          }
        }
      }
    }
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
  const warnings = [...profileWarnings];
  if (!input.parcel.boundary?.length) {
    warnings.push("대지 경계가 없어 층별 법규 외곽선과 배치를 검증하지 못했습니다.");
  }
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
              `법정 용적률의 ${safe.farUtilizationPct.toFixed(1)}% 사용`,
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
              `법정 용적률의 ${maximum.farUtilizationPct.toFixed(1)}% 사용`,
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
