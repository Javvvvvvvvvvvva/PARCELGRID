import type { RoadLine, SetbackSpec } from "@/components/ui/MassingView";
import type { LngLat } from "@/lib/finance/buildable-area";
import { analyzeFrontage } from "@/lib/geo/road-frontage";
import {
  calculateParkingLayout,
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
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";

export const PLANNING_RECOMMENDATION_ENGINE_VERSION =
  "planning-recommendation-v1" as const;

const FOOTPRINT_RATIOS = [0.4, 0.55, 0.7, 0.85, 0.98] as const;
const UNIT_AREA_OPTIONS = [45, 60, 80] as const;
const MAX_GENERATED_FLOORS = 7;

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
  const [originLng, originLat] = origin;
  const longitudeScale = Math.cos((originLat * Math.PI) / 180);
  return openRing(ring).map(([lng, lat]) => ({
    x: (lng - originLng) * 111_000 * longitudeScale,
    z: -(lat - originLat) * 111_000,
  }));
}

function maxCandidateFloors(parcel: RecommendationEngineParcel): number {
  const maxFootprintPct = Math.max(1, parcel.maxBCRPct || 50);
  const maxFarPct = Math.max(1, parcel.maxFARPct || 100);
  const byFar = Math.max(1, Math.ceil(maxFarPct / Math.max(20, maxFootprintPct * 0.75)));
  const byHeight =
    parcel.heightLimitM > 0
      ? Math.max(1, 1 + Math.floor(Math.max(0, parcel.heightLimitM - 3.6) / 3))
      : MAX_GENERATED_FLOORS;
  return clamp(Math.min(byHeight, byFar + 2), 1, MAX_GENERATED_FLOORS);
}

function buildResidentialFloors(input: {
  footprintSqm: number;
  floors: number;
  maxFarAreaSqm: number;
  unitAreaSqm: number;
  piloti: boolean;
}) {
  const floorPrograms: PlanningScenario["floorPrograms"] = [];
  let remainingFarArea = input.maxFarAreaSqm;

  for (let level = 1; level <= input.floors; level += 1) {
    if (input.piloti && level === 1) {
      floorPrograms.push(
        createFloorProgram(1, [
          createFloorZone("piloti", input.footprintSqm, 0, "필로티 주차", "non-revenue"),
        ])
      );
      continue;
    }

    const areaSqm = Math.min(input.footprintSqm, Math.max(0, remainingFarArea));
    if (areaSqm < 18) break;
    const units = Math.max(1, Math.floor(areaSqm / input.unitAreaSqm));
    floorPrograms.push(
      createFloorProgram(level, [
        createFloorZone("residential", areaSqm, units, "주거", "sale"),
      ])
    );
    remainingFarArea -= areaSqm;
    if (remainingFarArea < 18) break;
  }

  return floorPrograms;
}

function candidateScenario(input: {
  projectId: string;
  parcel: RecommendationEngineParcel;
  footprintSqm: number;
  floors: number;
  unitAreaSqm: number;
  strategy: "surface" | "piloti";
  generatedAt: string;
}): PlanningScenario | null {
  const piloti = input.strategy === "piloti";
  if (piloti && input.floors < 2) return null;
  const floorPrograms = buildResidentialFloors({
    footprintSqm: input.footprintSqm,
    floors: input.floors,
    maxFarAreaSqm:
      input.parcel.lotAreaSqm * (Math.max(1, input.parcel.maxFARPct) / 100),
    unitAreaSqm: input.unitAreaSqm,
    piloti,
  });
  const residentialFloors = floorPrograms.filter((floor) =>
    floor.zones.some((zone) => zone.useType === "residential" && zone.areaSqm > 0)
  );
  if (residentialFloors.length === 0) return null;

  const scenario = createBlankPlanningScenario({
    projectId: input.projectId,
    name: "알고리즘 후보",
    origin: "algorithm-balanced",
    acquisitionCostManwon: input.parcel.acquisitionCostManwon,
  });
  scenario.createdAt = input.generatedAt;
  scenario.updatedAt = input.generatedAt;
  scenario.primaryUse =
    residentialFloors.reduce(
      (sum, floor) =>
        sum + floor.zones.reduce((zoneSum, zone) => zoneSum + zone.unitCount, 0),
      0
    ) <= 1
      ? "single-house"
      : "multi-family";
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
  scenario.description = `${input.floors}층 · 기준 세대면적 ${input.unitAreaSqm}㎡ · ${
    piloti ? "필로티" : "지상"
  } 주차 후보`;
  scenario.economicsPreview.demolitionCostManwon = Math.max(
    0,
    input.parcel.demolitionCostManwon
  );
  return scenario;
}

function frontEdgeForParcel(
  boundary: LngLat[] | undefined,
  roads: RoadLine[] | undefined
): {
  parcelShape: LocalPlanPoint[];
  frontEdge: [LocalPlanPoint, LocalPlanPoint] | null;
} {
  if (!boundary || boundary.length < 3) {
    return { parcelShape: [], frontEdge: null };
  }
  const origin = ringCentroid(boundary);
  const parcelShape = ringToLocalMeters(boundary, origin);
  const frontage = roads && roads.length > 0 ? analyzeFrontage(boundary, roads) : null;
  const frontEdge =
    frontage && frontage.frontIndex >= 0 && parcelShape.length > frontage.frontIndex
      ? ([
          parcelShape[frontage.frontIndex],
          parcelShape[(frontage.frontIndex + 1) % parcelShape.length],
        ] as [LocalPlanPoint, LocalPlanPoint])
      : null;
  return { parcelShape, frontEdge };
}

function calculateCandidate(
  scenario: PlanningScenario,
  input: PlanningRecommendationEngineInput,
  calculationContext: PlanningCalculationContext,
  parcelShape: LocalPlanPoint[],
  frontEdge: [LocalPlanPoint, LocalPlanPoint] | null
): RecommendationCandidateEvaluation {
  const firstCalculation = calculatePlanningScenario(scenario, calculationContext);
  const firstSpatial = calculatePlanningSpatialValidation(
    input.parcel.boundary,
    input.parcel.zoning,
    scenario,
    input.parcel.roads,
    input.parcel.setback
  );
  const firstMass = firstSpatial?.model.aboveGroundFloors.find(
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
    requiredCars: firstCalculation.parking.requiredCars,
    frontEdge,
    parking: scenario.parking,
  });

  const scenarioWithParking: PlanningScenario = {
    ...scenario,
    parking: {
      ...scenario.parking,
      providedCars: parkingLayout.capacityCars,
    },
  };
  const baseCalculation = calculatePlanningScenario(
    scenarioWithParking,
    calculationContext
  );
  const spatial = calculatePlanningSpatialValidation(
    input.parcel.boundary,
    input.parcel.zoning,
    scenarioWithParking,
    input.parcel.roads,
    input.parcel.setback
  );
  const calculation = applySpatialValidationToCalculation(baseCalculation, spatial);
  const appliedScenario = applyPlanningScenarioCalculation(
    scenarioWithParking,
    calculation
  );
  appliedScenario.status = "saved";

  const failCount = calculation.checks.filter((check) => check.status === "fail").length;
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
  architectureScore = round(clamp(architectureScore, 0, 100), 1);

  return {
    scenario: appliedScenario,
    calculation,
    parkingLayout,
    architectureScore,
    eligible,
    failCount,
    reviewCount,
    farUtilizationPct: round(farUtilizationPct, 1),
    bcrUtilizationPct: round(bcrUtilizationPct, 1),
  };
}

function recommendationMetadata(input: {
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

function selectedScenario(
  evaluation: RecommendationCandidateEvaluation,
  input: {
    origin: PlanningScenario["origin"];
    name: string;
    description: string;
    metadata: PlanningRecommendationMetadata;
  }
): PlanningScenario {
  return {
    ...evaluation.scenario,
    name: input.name,
    description: input.description,
    origin: input.origin,
    status: "saved",
    recommendation: input.metadata,
  };
}

export function generatePlanningRecommendations(
  input: PlanningRecommendationEngineInput
): PlanningRecommendationSet {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const calculationContext: PlanningCalculationContext = {
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
  const { parcelShape, frontEdge } = frontEdgeForParcel(
    input.parcel.boundary,
    input.parcel.roads
  );
  const maxFootprintSqm =
    input.parcel.lotAreaSqm * (Math.max(1, input.parcel.maxBCRPct) / 100);
  const floors = maxCandidateFloors(input.parcel);
  const evaluations: RecommendationCandidateEvaluation[] = [];

  for (const footprintRatio of FOOTPRINT_RATIOS) {
    const footprintSqm = Math.max(18, maxFootprintSqm * footprintRatio);
    for (let floorCount = 1; floorCount <= floors; floorCount += 1) {
      for (const unitAreaSqm of UNIT_AREA_OPTIONS) {
        for (const strategy of ["surface", "piloti"] as const) {
          const scenario = candidateScenario({
            projectId: input.projectId,
            parcel: input.parcel,
            footprintSqm,
            floors: floorCount,
            unitAreaSqm,
            strategy,
            generatedAt,
          });
          if (!scenario) continue;
          evaluations.push(
            calculateCandidate(
              scenario,
              input,
              calculationContext,
              parcelShape,
              frontEdge
            )
          );
        }
      }
    }
  }

  const eligible = evaluations.filter((candidate) => candidate.eligible);
  const safeEvaluation = [...eligible].sort(
    (a, b) =>
      b.architectureScore - a.architectureScore ||
      b.calculation.economicsPreview.profitManwon -
        a.calculation.economicsPreview.profitManwon
  )[0];
  const profitEvaluation = [...eligible].sort(
    (a, b) =>
      b.calculation.economicsPreview.profitManwon -
        a.calculation.economicsPreview.profitManwon ||
      b.calculation.economicsPreview.profitMarginPct -
        a.calculation.economicsPreview.profitMarginPct ||
      b.architectureScore - a.architectureScore
  )[0];
  const maxEvaluation = [...evaluations].sort(
    (a, b) =>
      b.calculation.metrics.preliminaryFarPct -
        a.calculation.metrics.preliminaryFarPct ||
      b.calculation.metrics.preliminaryBcrPct -
        a.calculation.metrics.preliminaryBcrPct
  )[0];

  const evaluatedCandidates = evaluations.length;
  const eligibleCandidates = eligible.length;
  const warnings: string[] = [];
  if (!input.parcel.boundary || input.parcel.boundary.length < 3) {
    warnings.push("대지 경계가 없어 배치·주차 후보를 검증하지 못했습니다.");
  }
  if (!safeEvaluation || !profitEvaluation) {
    warnings.push(
      "현재 법규 외곽선과 실제 주차 배치를 모두 통과하는 자동 후보를 찾지 못했습니다. 직접 설계안에서 면적·층수·주차 전략을 조정해야 합니다."
    );
  }

  const architecturalFeasibility = safeEvaluation
    ? selectedScenario(safeEvaluation, {
        origin: "algorithm-safe",
        name: "건축 타당성안",
        description:
          "법규 외곽선·배치·층간 연결·실제 주차 배치를 통과한 후보 중 건축 여유와 단순성이 가장 높은 안입니다.",
        metadata: recommendationMetadata({
          objective: "architectural-feasibility",
          generatedAt,
          evaluatedCandidates,
          eligibleCandidates,
          evaluation: safeEvaluation,
          reasons: [
            `건축 타당성 ${safeEvaluation.architectureScore.toFixed(1)}점`,
            `법규·배치 필수 미충족 ${safeEvaluation.failCount}건`,
            `주차 ${safeEvaluation.parkingLayout.capacityCars}/${safeEvaluation.calculation.parking.requiredCars}대`,
            `법정 용적률의 ${safeEvaluation.farUtilizationPct.toFixed(1)}% 사용`,
          ],
        }),
      })
    : null;

  const profitOptimal = profitEvaluation
    ? selectedScenario(profitEvaluation, {
        origin: "algorithm-profit",
        name: "수익 최적안",
        description:
          "법규 외곽선과 실제 주차 배치를 통과한 후보만 대상으로 Stage 2 개략 이익이 가장 높은 안을 선택했습니다.",
        metadata: recommendationMetadata({
          objective: "profit",
          generatedAt,
          evaluatedCandidates,
          eligibleCandidates,
          evaluation: profitEvaluation,
          reasons: [
            `실행 가능 후보 ${eligibleCandidates}개 중 개략 이익 최대`,
            `개략 이익 ${round(
              profitEvaluation.calculation.economicsPreview.profitManwon,
              0
            ).toLocaleString()}만원`,
            `이익률 ${profitEvaluation.calculation.economicsPreview.profitMarginPct.toFixed(1)}%`,
            `건축 타당성 ${profitEvaluation.architectureScore.toFixed(1)}점`,
          ],
        }),
      })
    : null;

  const legalCeilingReference = maxEvaluation
    ? selectedScenario(maxEvaluation, {
        origin: "algorithm-max",
        name: "법적 상한 참고안",
        description:
          "산술상 용적률 사용량이 가장 높은 비교 기준입니다. 배치·일조·주차 미충족 항목이 있을 수 있어 자동 대표안이 아닙니다.",
        metadata: recommendationMetadata({
          objective: "legal-ceiling",
          generatedAt,
          evaluatedCandidates,
          eligibleCandidates,
          evaluation: maxEvaluation,
          reasons: [
            `예비 용적률 ${maxEvaluation.calculation.metrics.preliminaryFarPct.toFixed(1)}%`,
            `예비 건폐율 ${maxEvaluation.calculation.metrics.preliminaryBcrPct.toFixed(1)}%`,
            `법규·배치 미충족 ${maxEvaluation.failCount}건`,
          ],
          warnings: maxEvaluation.eligible
            ? ["법적 상한 비교 기준이며 수익 또는 건축 타당성 추천안은 아닙니다."]
            : [
                "법적 상한 비교 기준으로만 사용하세요. 필수 미충족 항목이 있어 대표안 확정 전에 수정이 필요합니다.",
              ],
        }),
      })
    : null;

  return {
    engineVersion: PLANNING_RECOMMENDATION_ENGINE_VERSION,
    generatedAt,
    evaluatedCandidates,
    eligibleCandidates,
    architecturalFeasibility,
    profitOptimal,
    legalCeilingReference,
    warnings,
    evaluations,
  };
}
