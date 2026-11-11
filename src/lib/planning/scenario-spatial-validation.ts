import { planningEnvelopeSteps } from "@/lib/planning/envelope-steps";
import {
  calcBuildableArea,
  type LngLat,
} from "@/lib/finance/buildable-area";
import { analyzeParcelFrontage } from "@/lib/geo/road-frontage";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { resolvePlanningParcel } from "./planning-parcel";
import {
  assessPlanningPlacement,
  type PlanningPlacementAssessment,
} from "@/lib/planning/placement-assessment";
import {
  buildPlanningMassModel,
  type PlanningEnvelopeStep,
  type PlanningMassModel,
} from "@/lib/planning/planning-massing";
import type {
  PlanningCheck,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";
import {
  toSunlightGeometryProfile,
  type SunlightRegulationResult,
} from "@/lib/regulatory/sunlight-rules";
import type { RoadLine, SetbackSpec } from "@/components/ui/MassingView";
import { interiorPlanningCheck } from "./interior-layout";
import { roomPlanningCheck } from "./room-layout";
import { assessEgressCore, egressPlanningCheck } from "./egress-core";

export interface PlanningSpatialValidation {
  model: PlanningMassModel;
  envelopeSteps: PlanningEnvelopeStep[];
  assessment: PlanningPlacementAssessment;
  checks: PlanningCheck[];
  warnings: string[];
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
        `${floor.label} ${round(floor.capacityShortfallSqm)}㎡ 미확보`
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
      label: "층별 면적 수용",
      status: areaFailures.length > 0 ? "fail" : "pass",
      message:
        areaFailures.length > 0
          ? `${areaFailures.length}개 층의 요청 면적 중 총 ${round(
              assessment.totalCapacityShortfallSqm
            )}㎡를 자동 생성 평면에 확보하지 못했습니다. ${areaDetails}. 탐색 한계와 부지 제약을 추가 검토해야 하며 건축 불가 확정이 아닙니다.`
          : "모든 층의 프로그램 면적이 층별 법규 외곽선 안에 수용됩니다.",
      source: "3D 층별 건축가능영역·프로그램 면적 비교",
    },
    {
      code: "spatial-placement",
      label: "건물 배치",
      status: placementFailures.length > 0 ? "fail" : "pass",
      message:
        placementFailures.length > 0
          ? `${placementDetails}의 형상 생성 또는 이동·회전 후 영역 포함 검사를 통과하지 못했습니다. 미완료·빈 형상은 적합으로 간주하지 않습니다.`
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
      status: "unknown",
      message: `${unavailableFloors
        .map((floor) => floor.label)
        .join(", ")}은 층별 외곽선을 확인하지 못해 생성·검증을 보류했습니다. 대지나 다른 층으로 대체하지 않았습니다.`,
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
  _setback?: SetbackSpec,
  sunlight?: SunlightRegulationResult,
  roofAllowanceM = 1.4,
  boundaryPolygons?: Wgs84ParcelPolygon[]
): PlanningSpatialValidation | null {
  // 사용자 디자인 이격은 법적 envelope를 바꾸지 않는다는 계약을 유지한다.
  void _setback;
  const parcel = resolvePlanningParcel({ boundary, boundaryPolygons });
  if (!parcel.available) return null;
  const { origin } = parcel;
  const groundFloors = scenario.floorPrograms
    .filter((floor) => floor.level > 0)
    .sort((a, b) => a.level - b.level);
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

  const frontage = analyzeParcelFrontage(parcel.source, roads ?? [], origin);
  // Stage 2의 통합 통과/실패 판정은 대표안·3D·Export와 같은
  // 법적 최대 외곽선을 사용한다. 사용자 설계 여유거리는 별도 UI 안내값이며
  // 법규 판정으로 섞지 않는다.
  const edgeSetbacksByPolygon = frontage?.edgeSetbacksByPolygon;
  const sunlightProfile = sunlight
    ? toSunlightGeometryProfile(sunlight)
    : undefined;

  const buildable = calcBuildableArea(
    boundary,
    0.5,
    maxFloor,
    averageFloorHeight,
    /주거/.test(zoning),
    undefined,
    {
      polygons: parcel.source,
      edgeSetbacksByPolygon,
      sunlightProfile,
      floorHeightsM: groundFloors.map((floor) => floor.floorHeightM),
      floorLevels: groundFloors.map((floor) => floor.level),
      roofAllowanceM,
    }
  );
  const basementBuildable = calcBuildableArea(
    boundary,
    0.5,
    1,
    3,
    false,
    undefined,
    { reportSunApplicability: false, polygons: parcel.source, edgeSetbacksByPolygon }
  );

  const envelopeSteps = planningEnvelopeSteps(scenario.floorPrograms, buildable, basementBuildable, origin);

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
    checks: [
      ...buildSpatialChecks(model, assessment, warnings),
      ...scenario.floorPrograms.filter(floor => floor.interiorLayout || floor.zones.some(zone => zone.useType === "residential"))
        .map(floor => interiorPlanningCheck(floor, model.floors.find(mass => mass.id === floor.id)?.shape)),
      ...scenario.floorPrograms.filter(floor => floor.zones.some(zone => zone.useType === "residential"))
        .map(floor => roomPlanningCheck(floor, model.floors.find(mass => mass.id === floor.id)?.shape)),
      ...(scenario.floorPrograms.some(floor => floor.zones.some(zone => zone.useType === "residential"))
        ? [egressPlanningCheck(assessEgressCore({ scenario, floors: model.floors,
          parcelShape: parcel.simple ? parcel.polygons[0].outer : [], parcelPolygons: parcel.polygons }))] : []),
    ],
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
