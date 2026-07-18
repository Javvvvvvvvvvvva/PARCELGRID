import {
  calcBuildableArea,
  type LngLat,
} from "@/lib/finance/buildable-area";
import {
  analyzeFrontage,
  edgeSetbacksFromFrontage,
} from "@/lib/geo/road-frontage";
import {
  assessPlanningPlacement,
  type PlanningPlacementAssessment,
} from "@/lib/planning/placement-assessment";
import {
  buildPlanningMassModel,
  polygonAreaSqm,
  type LocalPlanPoint,
  type PlanningEnvelopeStep,
  type PlanningMassModel,
} from "@/lib/planning/planning-massing";
import type {
  PlanningCheck,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";
import type { RoadLine, SetbackSpec } from "@/components/ui/MassingView";

export interface PlanningSpatialValidation {
  model: PlanningMassModel;
  envelopeSteps: PlanningEnvelopeStep[];
  assessment: PlanningPlacementAssessment;
  checks: PlanningCheck[];
  warnings: string[];
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

function ringToLocalMeters(
  ring: LngLat[],
  origin: LngLat
): LocalPlanPoint[] {
  const [originLng, originLat] = origin;
  const longitudeScale = Math.cos((originLat * Math.PI) / 180);
  return openRing(ring).map(([lng, lat]) => ({
    x: (lng - originLng) * 111_000 * longitudeScale,
    z: -(lat - originLat) * 111_000,
  }));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildSpatialChecks(
  model: PlanningMassModel,
  assessment: PlanningPlacementAssessment,
  warnings: string[]
): PlanningCheck[] {
  const areaFailures = assessment.floors.filter((floor) => !floor.areaFits);
  const placementFailures = assessment.floors.filter(
    (floor) => !floor.placementFits
  );
  const supportFailures = model.aboveGroundFloors.filter(
    (floor) => floor.level > 1 && !floor.supportedByLowerFloor
  );
  const unavailableFloors = model.floors.filter(
    (floor) => !floor.envelopeAvailable
  );

  const areaDetails = areaFailures
    .map(
      (floor) =>
        `${floor.label} ${round(floor.capacityShortfallSqm)}㎡ 초과`
    )
    .join(" · ");
  const placementDetails = placementFailures
    .map((floor) => floor.label)
    .join(", ");
  const supportDetails = supportFailures
    .map(
      (floor) =>
        `${floor.label} 실제 하부 지지 ${round(floor.supportOverlapRatio * 100, 1)}%`
    )
    .join(" · ");

  const checks: PlanningCheck[] = [
    {
      code: "spatial-area-capacity",
      label: "층별 법규 외곽선",
      status: areaFailures.length > 0 ? "fail" : "pass",
      message:
        areaFailures.length > 0
          ? `${areaFailures.length}개 층이 법규 외곽선보다 총 ${round(
              assessment.totalCapacityShortfallSqm
            )}㎡ 큽니다. ${areaDetails}`
          : "모든 층의 프로그램 면적이 층별 법규 외곽선 안에 수용됩니다.",
      source: "3D 층별 건축가능영역·프로그램 면적 비교",
    },
    {
      code: "spatial-placement",
      label: "건물 배치",
      status: placementFailures.length > 0 ? "fail" : "pass",
      message:
        placementFailures.length > 0
          ? `${placementDetails}이 이동·회전 후 법규 외곽선을 벗어납니다.`
          : "현재 이동·회전·후퇴 조건에서 모든 층이 법규 외곽선 안에 있습니다.",
      source: "3D 배치 외곽선 포함 판정",
    },
    {
      code: "spatial-floor-support",
      label: "층간 기하 지지",
      status: supportFailures.length > 0 ? "fail" : "pass",
      message:
        supportFailures.length > 0
          ? `${supportFailures.length}개 상층의 실제 외곽선 전체가 바로 아래층 내부에 포함되지 않습니다. ${supportDetails}. 자동 확정할 수 없으며, 배치를 조정하거나 별도 구조 모델과 구조기술자 검토를 반영해야 합니다.`
          : "모든 지상 상층의 실제 외곽선이 바로 아래층 내부에 완전히 포함됩니다. 이는 보수적 기하 판정이며 구조 안전을 확정하지 않습니다.",
      source: "실제 다각형 교차면적·완전 지지 예비 판정",
    },
  ];

  if (unavailableFloors.length > 0) {
    checks.push({
      code: "spatial-envelope-data",
      label: "배치 데이터",
      status: "review",
      message: `${unavailableFloors
        .map((floor) => floor.label)
        .join(", ")}은 정확한 법규 외곽선이 없어 대지 경계를 대체 사용했습니다.`,
      source: "건축가능영역 엔진",
    });
  } else if (warnings.length > 0) {
    checks.push({
      code: "spatial-envelope-data",
      label: "배치 데이터",
      status: "review",
      message: warnings.join(" · "),
      source: "건축가능영역 엔진",
    });
  }

  return checks;
}

export function calculatePlanningSpatialValidation(
  boundary: LngLat[] | undefined,
  zoning: string,
  scenario: PlanningScenario,
  roads?: RoadLine[],
  setback?: SetbackSpec
): PlanningSpatialValidation | null {
  if (!boundary || boundary.length < 3) return null;

  const origin = ringCentroid(boundary);
  const groundFloors = scenario.floorPrograms.filter(
    (floor) => floor.level > 0
  );
  const maxFloor = Math.max(
    1,
    ...groundFloors.map((floor) => floor.level)
  );
  const averageFloorHeight =
    groundFloors.length > 0
      ? groundFloors.reduce(
          (sum, floor) => sum + Math.max(2, floor.floorHeightM),
          0
        ) / groundFloors.length
      : 3;

  const frontage =
    roads && roads.length > 0 ? analyzeFrontage(boundary, roads) : null;
  const edgeSetbacks = edgeSetbacksFromFrontage(
    frontage,
    setback ?? { road: 0.5, side: 0.5, rear: 0.5 }
  );

  const buildable = calcBuildableArea(
    boundary,
    0.5,
    maxFloor,
    averageFloorHeight,
    /주거/.test(zoning),
    edgeSetbacks
  );
  const basementBuildable = calcBuildableArea(
    boundary,
    0.5,
    1,
    3,
    false,
    edgeSetbacks
  );

  const fallbackRing = buildable.buildable2DRing ?? boundary;
  const firstStep = buildable.stepped3D.find((step) => step.ringLngLat);
  const basementRing = basementBuildable.buildable2DRing ?? boundary;

  const envelopeSteps: PlanningEnvelopeStep[] = scenario.floorPrograms.map(
    (floor) => {
      const step =
        floor.level > 0
          ? buildable.stepped3D.find(
              (candidate) => candidate.floor === floor.level
            )
          : undefined;
      const ring =
        floor.level < 0
          ? basementRing
          : step?.ringLngLat ?? firstStep?.ringLngLat ?? fallbackRing;
      const shape = ringToLocalMeters(ring, origin);
      return {
        level: floor.level,
        shape,
        envelopeAreaSqm:
          floor.level < 0
            ? polygonAreaSqm(shape)
            : step?.floorPlateSqm ?? polygonAreaSqm(shape),
        requiredSetbackM:
          floor.level < 0 ? 0 : step?.requiredSetbackM ?? 0,
        envelopeAvailable:
          floor.level < 0
            ? Boolean(basementBuildable.buildable2DRing)
            : Boolean(step?.ringLngLat ?? buildable.buildable2DRing),
      };
    }
  );

  const model = buildPlanningMassModel(
    scenario.floorPrograms,
    envelopeSteps,
    scenario.placement
  );
  const assessment = assessPlanningPlacement(model, envelopeSteps);
  const warnings = [...buildable.warnings, ...basementBuildable.warnings];

  return {
    model,
    envelopeSteps,
    assessment,
    checks: buildSpatialChecks(model, assessment, warnings),
    warnings,
  };
}

export function mergePlanningChecks(
  baseChecks: PlanningCheck[],
  spatialChecks: PlanningCheck[]
): PlanningCheck[] {
  const spatialCodes = new Set(spatialChecks.map((check) => check.code));
  return [
    ...baseChecks.filter((check) => !spatialCodes.has(check.code)),
    ...spatialChecks,
  ];
}

export function applySpatialValidationToCalculation(
  calculation: PlanningScenarioCalculation,
  validation: PlanningSpatialValidation | null
): PlanningScenarioCalculation {
  if (!validation) {
    return {
      ...calculation,
      checks: mergePlanningChecks(calculation.checks, [
        {
          code: "spatial-envelope-data",
          label: "배치 데이터",
          status: "unknown",
          message: "대지 경계 데이터가 없어 층별 외곽선과 배치를 판정할 수 없습니다.",
          source: "Stage 1 대지 경계",
        },
      ]),
    };
  }
  return {
    ...calculation,
    checks: mergePlanningChecks(calculation.checks, validation.checks),
  };
}
