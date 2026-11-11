import { planningEnvelopeSteps } from "@/lib/planning/envelope-steps";
import { calcBuildableArea, type LngLat } from "@/lib/finance/buildable-area";
import { analyzeParcelFrontage } from "@/lib/geo/road-frontage";
import type { LocalParcelPolygon, Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelArea } from "@/lib/geo/parcel-topology-geometry";
import { resolvePlanningParcel } from "./planning-parcel";
import {
  buildPlanningMassModel,
  type LocalPlanPoint,
  type PlanningFloorMass,
  type PlanningMassModel,
} from "@/lib/planning/planning-massing";
import type { PlanningScenario } from "@/lib/planning/types";
import { polygonSelfIntersects } from "@/lib/geo/planar-ring";
export { polygonSelfIntersects, segmentsIntersect } from "@/lib/geo/planar-ring";
import { resolvePlanningGeometrySource } from "@/lib/planning/geometry-source";
import {
  toSunlightGeometryProfile,
  type SunlightRegulationResult,
} from "@/lib/regulatory/sunlight-rules";
import { validateInteriorLayout } from "@/lib/planning/interior/geometry";
import { interiorFinanceSignature, isInteriorFinanceCurrent } from "@/lib/planning/interior/finance";
import type { InteriorLayout, InteriorAssessment } from "@/lib/planning/interior/types";

export const PLANNING_GEOMETRY_VERSION = "planning-geometry-v6" as const;
export const GEOMETRY_AREA_PASS_TOLERANCE_PCT = 0.1;
export const GEOMETRY_AREA_REVIEW_TOLERANCE_PCT = 0.5;

export interface PlanningGeometryRoadInput {
  name: string | null;
  points: [number, number][];
}

export interface PlanningGeometrySetbackInput {
  road: number;
  side: number;
  rear: number;
}

export type GeometryValidationSeverity = "review" | "fail";

export interface GeometryValidationIssue {
  code: string;
  severity: GeometryValidationSeverity;
  message: string;
  floorId?: string;
  floorLabel?: string;
}

export interface PlanningGeometryFloor extends PlanningFloorMass {
  areaDifferenceSqm: number;
  areaStatus: "pass" | "review" | "fail";
  selfIntersects: boolean;
  interior?: { layout: InteriorLayout; assessment: InteriorAssessment };
}

export interface PlanningGeometrySnapshot {
  analysisReference?: import("./analysis-reference-contract").AnalysisReferenceSelection;
  version: typeof PLANNING_GEOMETRY_VERSION;
  projectId: string;
  scenarioId: string;
  scenarioVersion: number;
  scenarioInputBasis?: string;
  scenarioName: string;
  generatedAt: string;
  geometryHash: string;
  coordinateSystem: {
    unit: "meter";
    horizontalCrs: "LOCAL_ENU_FROM_WGS84";
    northAxis: "-Z";
    eastAxis: "+X";
    upAxis: "+Y";
    originLngLat: [number, number];
  };
  parcel: {
    /** Authoritative full region. polygon is populated only for a single hole-free component. */
    polygons?: LocalParcelPolygon[];
    polygon: LocalPlanPoint[];
    officialAreaSqm: number;
    measuredAreaSqm: number;
    areaDifferencePct: number;
  };
  roads: Array<{
    name: string | null;
    points: LocalPlanPoint[];
    source: "VWorld road centerline";
  }>;
  building: {
    floors: PlanningGeometryFloor[];
    aboveGroundFloors: PlanningGeometryFloor[];
    basementFloors: PlanningGeometryFloor[];
    totalHeightM: number;
    basementDepthM: number;
    totalProgramAreaSqm: number;
    totalGeometryAreaSqm: number;
    preliminaryFarAreaSqm: number;
    preliminaryFarPct: number;
    preliminaryBcrPct: number;
  };
  validation: {
    status: "pass" | "review" | "fail";
    representativeEligible: boolean;
    exportable: boolean;
    maxFloorAreaDifferencePct: number;
    issues: GeometryValidationIssue[];
  };
  sourceNotes: string[];
}

export interface PlanningGeometryBuildResult {
  snapshot: PlanningGeometrySnapshot;
  model: PlanningMassModel;
  groundShape: LocalPlanPoint[];
  groundPolygons: LocalParcelPolygon[];
  extent: number;
  warnings: string[];
}

export interface BuildPlanningGeometryInput {
  projectId: string;
  scenario: PlanningScenario;
  boundary?: LngLat[];
  boundaryPolygons?: Wgs84ParcelPolygon[];
  lotAreaSqm: number;
  zoning: string;
  roads?: PlanningGeometryRoadInput[];
  setback?: PlanningGeometrySetbackInput;
  sunlight?: SunlightRegulationResult;
  roofAllowanceM?: number;
  generatedAt?: string;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function round(value: number, digits = 6): number {
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

export function planningRingCentroid(ring: LngLat[]): LngLat {
  const points = openRing(ring);
  if (points.length === 0) return [0, 0];
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

export function planningRingToLocalMeters(
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

function lineToLocalMeters(
  points: [number, number][],
  origin: LngLat
): LocalPlanPoint[] {
  return points.map(([lng, lat]) => {
    const [originLng, originLat] = origin;
    const longitudeScale = Math.cos((originLat * Math.PI) / 180);
    return {
      // Match geometry identity precision across browser/server trig implementations.
      x: round((lng - originLng) * 111_000 * longitudeScale),
      z: round(-(lat - originLat) * 111_000),
    };
  });
}

function areaStatus(absDifferencePct: number): "pass" | "review" | "fail" {
  if (absDifferencePct <= GEOMETRY_AREA_PASS_TOLERANCE_PCT) return "pass";
  if (absDifferencePct <= GEOMETRY_AREA_REVIEW_TOLERANCE_PCT) return "review";
  return "fail";
}

function stableGeometryHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `PG-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

export function planningGeometryInputBasis(scenario: PlanningScenario): string {
  const { rotationDeg, offsetXM, offsetZM, roadSetbackM, northSetbackM } = scenario.placement;
  return stableGeometryHash({
    id: scenario.id, projectId: scenario.projectId,
    // Preserve the original field order even after canonical JSON/JSONB storage.
    placement: { rotationDeg, offsetXM, offsetZM, roadSetbackM, northSetbackM },
    floors: scenario.floorPrograms.map(f => ({
      id: f.id, level: f.level, floorHeightM: f.floorHeightM,
      footprintScalePct: f.footprintScalePct, northSetbackM: f.northSetbackM,
      gross: f.zones.reduce((sum, z) => sum + z.areaSqm, 0),
      ...(f.interior ? { interior: interiorFinanceSignature(f.interior, []) } : {}),
    })),
  });
}

function canonicalPoint(point: LocalPlanPoint): [number, number] {
  return [round(point.x), round(point.z)];
}

/** Deterministic model identity, not a cryptographic signature or an approval. */
export function planningGeometryContentHash(input: {
  projectId: string; scenarioId: string; origin: [number, number]; polygons: LocalParcelPolygon[];
  parcelAvailable: boolean; officialAreaSqm: number; zoning: string;
  floors: Pick<PlanningGeometryFloor, "id" | "level" | "baseHeightM" | "topHeightM" | "programAreaSqm" | "visualAreaSqm" | "shape" | "interior">[];
  roads: Pick<PlanningGeometrySnapshot["roads"][number], "name" | "points">[];
}): string {
  return stableGeometryHash({
    version: PLANNING_GEOMETRY_VERSION,
    projectId: input.projectId,
    scenarioId: input.scenarioId,
    origin: input.origin.map(value => round(value, 8)),
    parcel: input.polygons.map(part => ({ outer: part.outer.map(canonicalPoint), holes: part.holes.map(ring => ring.map(canonicalPoint)) })),
    parcelAvailable: input.parcelAvailable,
    officialAreaSqm: input.officialAreaSqm,
    zoning: input.zoning,
    floors: input.floors.map(floor => ({
      id: floor.id, level: floor.level, baseHeightM: round(floor.baseHeightM), topHeightM: round(floor.topHeightM),
      programAreaSqm: round(floor.programAreaSqm), visualAreaSqm: round(floor.visualAreaSqm), shape: floor.shape.map(canonicalPoint),
      ...(floor.interior ? { interior: interiorFinanceSignature(floor.interior.layout, []) } : {}),
    })),
    roads: input.roads.map(road => ({ name: road.name, points: road.points.map(canonicalPoint) })),
  });
}

function floorFarArea(floor: PlanningScenario["floorPrograms"][number]): number {
  if (floor.level <= 0) return 0;
  return floor.zones.reduce((sum, zone) => {
    if (zone.useType === "parking" || zone.useType === "piloti") return sum;
    return sum + nonNegative(zone.areaSqm);
  }, 0);
}

function buildValidation(
  floors: PlanningGeometryFloor[],
  officialParcelAreaSqm: number,
  measuredParcelAreaSqm: number
): PlanningGeometrySnapshot["validation"] {
  const issues: GeometryValidationIssue[] = [];
  const parcelDifferencePct =
    officialParcelAreaSqm > 0
      ? Math.abs(
          ((measuredParcelAreaSqm - officialParcelAreaSqm) /
            officialParcelAreaSqm) *
            100
        )
      : 0;

  if (parcelDifferencePct > 5) {
    issues.push({
      code: "parcel-area-mismatch",
      severity: "fail",
      message: `GIS 필지 면적과 공식 대지면적 차이가 ${parcelDifferencePct.toFixed(2)}%입니다. 좌표 또는 필지 매칭을 확인해야 합니다.`,
    });
  } else if (parcelDifferencePct > 2) {
    issues.push({
      code: "parcel-area-review",
      severity: "review",
      message: `GIS 필지 면적과 공식 대지면적 차이가 ${parcelDifferencePct.toFixed(2)}%입니다. Export 전에 원자료를 확인하세요.`,
    });
  }

  for (const floor of floors) {
    const absDifferencePct = Math.abs(floor.areaDifferencePct);
    if (floor.shape.length < 3 || floor.visualAreaSqm <= 0) {
      issues.push({
        code: "floor-empty-geometry",
        severity: "fail",
        floorId: floor.id,
        floorLabel: floor.label,
        message: `${floor.label}의 3D 외곽선이 생성되지 않았습니다.`,
      });
    }
    if (floor.selfIntersects) {
      issues.push({
        code: "floor-self-intersection",
        severity: "fail",
        floorId: floor.id,
        floorLabel: floor.label,
        message: `${floor.label} 외곽선이 자기 교차합니다.`,
      });
    }
    if (floor.areaStatus === "fail") {
      issues.push({
        code: "floor-area-mismatch",
        severity: "fail",
        floorId: floor.id,
        floorLabel: floor.label,
        message: `${floor.label} 프로그램 ${floor.programAreaSqm.toFixed(2)}㎡와 실제 매스 ${floor.visualAreaSqm.toFixed(2)}㎡의 차이가 ${absDifferencePct.toFixed(2)}%입니다.`,
      });
    } else if (floor.areaStatus === "review") {
      issues.push({
        code: "floor-area-review",
        severity: "review",
        floorId: floor.id,
        floorLabel: floor.label,
        message: `${floor.label} 프로그램 면적과 실제 매스 면적 차이가 ${absDifferencePct.toFixed(2)}%입니다.`,
      });
    }
    if (!floor.fitsEnvelope) {
      issues.push({
        code: "floor-outside-envelope",
        severity: "fail",
        floorId: floor.id,
        floorLabel: floor.label,
        message: `${floor.label}이 법규 외곽선 안에 완전히 들어오지 않습니다.`,
      });
    }
    if (floor.level > 1 && !floor.supportedByLowerFloor) {
      issues.push({
        code: "floor-support-insufficient",
        severity: "fail",
        floorId: floor.id,
        floorLabel: floor.label,
        message: `${floor.label} 실제 외곽선의 하부 지지율이 ${(floor.supportOverlapRatio * 100).toFixed(1)}%입니다. 상층 전체가 바로 아래층 안에 들어오지 않아 자동 확정할 수 없습니다.`,
      });
    }
    if (!Number.isFinite(floor.floorHeightM) || floor.floorHeightM <= 0) {
      issues.push({
        code: "floor-height-invalid",
        severity: "fail",
        floorId: floor.id,
        floorLabel: floor.label,
        message: `${floor.label} 층고가 유효하지 않습니다.`,
      });
    }
  }

  const hasFail = issues.some((issue) => issue.severity === "fail");
  const hasReview = issues.some((issue) => issue.severity === "review");
  return {
    status: hasFail ? "fail" : hasReview ? "review" : "pass",
    representativeEligible: !hasFail && !hasReview,
    exportable: !hasFail && !hasReview,
    maxFloorAreaDifferencePct: floors.reduce(
      (max, floor) => Math.max(max, Math.abs(floor.areaDifferencePct)),
      0
    ),
    issues,
  };
}

function applyGeometrySourceValidation(
  baseValidation: PlanningGeometrySnapshot["validation"],
  scenario: PlanningScenario,
  geometryHash: string
): PlanningGeometrySnapshot["validation"] {
  const source = resolvePlanningGeometrySource(scenario);
  const issues = [...baseValidation.issues];

  if (source.mode !== "engine-generated") {
    if (!source.exactGeometryAvailable) {
      issues.push({
        code: "geometry-source-exact-missing",
        severity: "fail",
        message:
          source.mode === "reference-image"
            ? "기준 이미지와 JSON만으로는 정확한 평면 좌표를 복원할 수 없습니다. 원본 3D/CAD 좌표를 연결하기 전에는 대표안과 내보내기를 확정할 수 없습니다."
            : "외부 설계 모델의 정확한 좌표 검증이 완료되지 않았습니다. DAE·GLB·DXF 원본을 연결하고 Geometry Hash를 확인해야 합니다.",
      });
    } else if (!source.sourceGeometryHash) {
      issues.push({
        code: "geometry-source-hash-missing",
        severity: "fail",
        message:
          "외부 형상의 좌표는 표시됐지만 검증된 Geometry Hash가 없습니다. 원본 파일 검증을 완료해야 합니다.",
      });
    } else if (source.sourceGeometryHash !== geometryHash) {
      issues.push({
        code: "geometry-source-hash-mismatch",
        severity: "fail",
        message:
          "연결된 외부 형상의 Geometry Hash가 현재 계획 매스와 다릅니다. 좌표계·층 외곽선·대지 배치를 다시 확인해야 합니다.",
      });
    }
  }

  if (
    source.locked &&
    (!source.lockedGeometryHash || source.lockedGeometryHash !== geometryHash)
  ) {
    issues.push({
      code: "geometry-lock-mismatch",
      severity: "fail",
      message:
        "잠금 당시 Geometry Hash와 현재 형상이 다릅니다. 변경 원인을 확인한 뒤 원래 형상으로 복구하거나 명시적으로 잠금을 해제하세요.",
    });
  }

  const hasFail = issues.some((issue) => issue.severity === "fail");
  const hasReview = issues.some((issue) => issue.severity === "review");
  return {
    ...baseValidation,
    status: hasFail ? "fail" : hasReview ? "review" : "pass",
    representativeEligible: !hasFail && !hasReview,
    exportable: !hasFail && !hasReview,
    issues,
  };
}

export function buildPlanningGeometry(
  input: BuildPlanningGeometryInput
): PlanningGeometryBuildResult {
  const { scenario, boundary } = input;
  const parcel = resolvePlanningParcel(input);
  const { origin, polygons: groundPolygons } = parcel;
  const groundShape = parcel.simple ? groundPolygons[0].outer : [];
  const groundFloors = scenario.floorPrograms
    .filter((floor) => floor.level > 0)
    .sort((a, b) => a.level - b.level);
  const maxFloor = Math.max(1, ...groundFloors.map((floor) => floor.level));
  const averageFloorHeight =
    groundFloors.length > 0
      ? groundFloors.reduce(
          (sum, floor) => sum + Math.max(2, floor.floorHeightM),
          0
        ) / groundFloors.length
      : 3;
  const frontage = parcel.available ? analyzeParcelFrontage(parcel.source, input.roads ?? [], origin) : null;
  // 법적 최대 외곽선과 사용자의 설계 여유거리를 분리한다. parcel.setback은
  // 배치 대안용 값이며 법규 외곽선을 임의로 3/1.5/3m 축소하지 않는다.
  const edgeSetbacksByPolygon = frontage?.edgeSetbacksByPolygon;
  const sunlightProfile = input.sunlight
    ? toSunlightGeometryProfile(input.sunlight)
    : undefined;

  const buildable = calcBuildableArea(
    boundary,
    0.5,
    maxFloor,
    averageFloorHeight,
    /주거/.test(input.zoning),
    undefined,
    {
      polygons: parcel.source,
      edgeSetbacksByPolygon,
      sunlightProfile,
      floorHeightsM: groundFloors.map((floor) => floor.floorHeightM),
      floorLevels: groundFloors.map((floor) => floor.level),
      roofAllowanceM: input.roofAllowanceM,
    }
  );
  const basementBuildable = calcBuildableArea(
    boundary,
    0.5,
    1,
    3,
    false,
    undefined,
    { polygons: parcel.source, edgeSetbacksByPolygon }
  );

  const envelopeSteps = planningEnvelopeSteps(scenario.floorPrograms, buildable, basementBuildable, origin);

  const model = buildPlanningMassModel(
    scenario.floorPrograms,
    envelopeSteps,
    scenario.placement
  );
  const floors: PlanningGeometryFloor[] = model.floors.map((floor) => {
    const absDifferencePct = Math.abs(floor.areaDifferencePct);
    const interior = scenario.floorPrograms.find(program => program.id === floor.id)?.interior;
    return {
      ...floor,
      areaDifferenceSqm: floor.visualAreaSqm - floor.programAreaSqm,
      areaStatus: areaStatus(absDifferencePct),
      selfIntersects: polygonSelfIntersects(floor.shape),
      ...(interior ? { interior: { layout: interior, assessment: validateInteriorLayout(interior, floor.shape) } } : {}),
    };
  });
  const aboveGroundFloors = floors.filter((floor) => floor.level > 0);
  const basementFloors = floors.filter((floor) => floor.level < 0);
  const totalProgramAreaSqm = floors.reduce(
    (sum, floor) => sum + floor.programAreaSqm,
    0
  );
  const totalGeometryAreaSqm = floors.reduce(
    (sum, floor) => sum + floor.visualAreaSqm,
    0
  );
  const preliminaryFarAreaSqm = scenario.floorPrograms.reduce(
    (sum, floor) => sum + floorFarArea(floor),
    0
  );
  const officialArea = nonNegative(input.lotAreaSqm);
  const measuredArea = localParcelArea(groundPolygons);
  const preliminaryFarPct =
    officialArea > 0 ? (preliminaryFarAreaSqm / officialArea) * 100 : 0;
  const preliminaryBcrPct =
    officialArea > 0
      ? (aboveGroundFloors.reduce(
          (max, floor) => Math.max(max, floor.visualAreaSqm),
          0
        ) /
          officialArea) *
        100
      : 0;
  const baseValidation = buildValidation(floors, officialArea, measuredArea);
  if (!parcel.available) baseValidation.issues.push({ code: "parcel-topology-unavailable", severity: "fail",
    message: "전체 대지 경계가 없거나 유효하지 않아 형상 검증을 보류했습니다. 외곽선 일부로 대체하지 않았습니다." });
  if (parcel.available && !frontage) baseValidation.issues.push({ code: "parcel-frontage-unavailable", severity: "review",
    message: "도로 접면 계산을 완료하지 못했습니다. 전체 경계에 기본 이격을 적용했으며 도로측 완화는 확인되지 않았습니다." });
  const interiorFailures = floors.flatMap(floor =>
    (floor.interior?.assessment.issues ?? []).filter(issue => issue.severity === "fail").map(issue => ({
      code: `interior-${issue.code}`, severity: "fail" as const,
      floorId: floor.id, floorLabel: floor.label, message: `${floor.label}: ${issue.message}`,
    }))
  );
  for (const floor of scenario.floorPrograms) {
    if (floor.interior && !isInteriorFinanceCurrent(floor)) interiorFailures.push({
      code: "interior-finance-stale", severity: "fail", floorId: floor.id, floorLabel: floor.label,
      message: `${floor.label}: 내부 구획과 사업성 면적을 다시 대조·반영해야 합니다.`,
    });
  }
  if (interiorFailures.length) {
    baseValidation.issues.push(...interiorFailures);
    baseValidation.status = "fail";
    baseValidation.exportable = false;
    baseValidation.representativeEligible = false;
  }
  const roads = (input.roads ?? []).map((road) => ({
    name: road.name,
    points: lineToLocalMeters(road.points, origin),
    source: "VWorld road centerline" as const,
  }));

  const geometryHash = planningGeometryContentHash({
    projectId: input.projectId,
    scenarioId: scenario.id,
    origin,
    polygons: groundPolygons,
    parcelAvailable: parcel.available,
    officialAreaSqm: officialArea,
    zoning: input.zoning,
    floors,
    roads,
  });
  const validation = applyGeometrySourceValidation(
    baseValidation,
    scenario,
    geometryHash
  );
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const snapshot: PlanningGeometrySnapshot = {
    version: PLANNING_GEOMETRY_VERSION,
    projectId: input.projectId,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    scenarioInputBasis: planningGeometryInputBasis(scenario),
    scenarioName: scenario.name,
    generatedAt,
    geometryHash,
    coordinateSystem: {
      unit: "meter",
      horizontalCrs: "LOCAL_ENU_FROM_WGS84",
      northAxis: "-Z",
      eastAxis: "+X",
      upAxis: "+Y",
      originLngLat: origin,
    },
    parcel: {
      polygon: groundShape,
      polygons: groundPolygons,
      officialAreaSqm: officialArea,
      measuredAreaSqm: measuredArea,
      areaDifferencePct:
        officialArea > 0 ? ((measuredArea - officialArea) / officialArea) * 100 : 0,
    },
    roads,
    building: {
      floors,
      aboveGroundFloors,
      basementFloors,
      totalHeightM: model.totalHeightM,
      basementDepthM: model.basementDepthM,
      totalProgramAreaSqm,
      totalGeometryAreaSqm,
      preliminaryFarAreaSqm,
      preliminaryFarPct,
      preliminaryBcrPct,
    },
    validation,
    sourceNotes: [
      "모든 대지 조각과 내부 빈 공간을 보존합니다. 층별 단일 연속 평면을 검사하며 다동 배치·합필 가능성·공식 경계·허가는 별도 확인이 필요합니다.",
      "입력 대지 경계 전체와 도로 중심선을 공통 WGS84 원점의 로컬 미터 좌표로 변환합니다. 입력 출처와 공식 경계 승인은 별도 확인합니다.",
      input.sunlight
        ? "정북일조는 " +
          input.sunlight.rule.id +
          " 계약과 실제 층고 누적값을 사용하며, 확인된 공지 경계 이동만 반영합니다."
        : "정북일조는 원본 북측 필지 경계를 진남으로 평행 이동한 참고 기준선으로 계산하며 적용 조건은 별도 확인이 필요합니다.",
      "법적 최대 외곽선은 도로측 추가 0m, 인접대지측 0.5m 검토 기본값을 사용하며 사용자 설계 여유거리와 분리합니다.",
      "대표안과 SketchUp·CAD export는 프로그램 면적과 실제 매스 면적이 허용오차 안에 있을 때만 가능합니다.",
      "기준 이미지와 검증되지 않은 외부 모델은 정확한 평면 좌표와 Geometry Hash가 연결될 때까지 시각 참고자료로만 사용합니다.",
    ],
  };

  let extent = 10;
  [...groundPolygons.flatMap(part => [part.outer, ...part.holes].flat()), ...floors.flatMap((floor) => floor.shape)].forEach((point) => {
    extent = Math.max(extent, Math.abs(point.x), Math.abs(point.z));
  });
  extent = Math.max(
    extent,
    model.totalHeightM * 0.7,
    model.basementDepthM * 0.7
  );

  return {
    snapshot,
    model: {
      ...model,
      floors,
      aboveGroundFloors,
      basementFloors,
    },
    groundShape,
    groundPolygons,
    extent,
    warnings: [...buildable.warnings, ...model.floors.filter(floor => floor.generationStatus && floor.generationStatus !== "fitted")
      .map(floor => `${floor.label}: ${floor.generationReason}`)],
  };
}
