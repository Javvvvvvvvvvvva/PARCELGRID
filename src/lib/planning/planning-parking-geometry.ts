import type { LngLat } from "@/lib/finance/buildable-area";
import { analyzeParcelFrontage, type ParcelFrontageEdge } from "@/lib/geo/road-frontage";
import { localParcelPolygons, type Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelIntersectionArea } from "@/lib/geo/parcel-topology-geometry";
import { planningParcelMatchesSnapshot, planningRoadsMatchSnapshot, resolvePlanningParcel } from "./planning-parcel";
import {
  calculateParkingLayout,
  type ParkingLayoutResult,
} from "@/lib/planning/parking-layout";
import { GEOMETRY_AREA_PASS_TOLERANCE_PCT, PLANNING_GEOMETRY_VERSION, planningGeometryInputBasis, type PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import { polygonAreaSqm, type LocalPlanPoint } from "@/lib/planning/planning-massing";
import { validPlanPolygon } from "./layout-geometry";
import type { PlanningScenario } from "@/lib/planning/types";
import { assessVehicleCirculation, type VehicleCirculationAssessment } from "./vehicle-circulation";

export const PLANNING_PARKING_GEOMETRY_VERSION =
  "planning-parking-geometry-v3-ground-binding" as const;

export interface PlanningParkingGeometryIssue {
  code: string;
  severity: "review" | "fail";
  message: string;
}

export interface PlanningParkingGeometrySnapshot {
  version: typeof PLANNING_PARKING_GEOMETRY_VERSION;
  projectId: string;
  scenarioId: string;
  scenarioVersion: number;
  generatedAt: string;
  planningGeometryHash: string;
  parkingGeometryHash: string;
  coordinateSystem: PlanningGeometrySnapshot["coordinateSystem"];
  strategy: PlanningScenario["parking"]["strategy"];
  frontage: {
    status: "known" | "unknown";
    roadName: string | null;
    source: "VWorld road centerline" | "none";
    frontEdgeIndex: number | null;
    verifiedWidthM: null;
    candidates?: ParcelFrontageEdge[];
    sourceMatched?: boolean;
  };
  layout: ParkingLayoutResult;
  circulation: VehicleCirculationAssessment;
  validation: {
    status: "pass" | "review" | "fail" | "not-applicable";
    exportable: boolean;
    issues: PlanningParkingGeometryIssue[];
  };
  sourceNotes: string[];
}

export interface BuildPlanningParkingGeometryInput {
  scenario: PlanningScenario;
  planning: PlanningGeometrySnapshot;
  requiredCars: number;
  boundary?: LngLat[];
  boundaryPolygons?: Wgs84ParcelPolygon[];
  roads?: Array<{ name: string | null; points: [number, number][] }>;
  generatedAt?: string;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function canonicalPoints(points: LocalPlanPoint[]): Array<[number, number]> {
  return points.map((point) => [round(point.x), round(point.z)]);
}

function stableParkingHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `PGP-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function pilotiEnabled(scenario: PlanningScenario): boolean {
  return Boolean(
    scenario.floorPrograms
      .find((floor) => floor.level === 1)
      ?.zones.some(
        (zone) =>
          zone.areaSqm > 0 &&
          (zone.useType === "piloti" || zone.useType === "parking")
      )
  );
}

function groundGeometryMatchesScenario(scenario: PlanningScenario, planning: PlanningGeometrySnapshot): boolean {
  const programs = scenario.floorPrograms.filter(floor => floor.level === 1);
  const floors = planning.building.floors.filter(floor => floor.level === 1);
  const masses = planning.building.aboveGroundFloors.filter(floor => floor.level === 1);
  if (programs.length !== 1 || floors.length !== 1 || masses.length !== 1) return false;
  const [program] = programs, [floor] = floors, [mass] = masses;
  if (floor.id !== program.id || mass.id !== program.id
    || scenario.floorPrograms.filter(item => item.id === program.id).length !== 1
    || planning.building.floors.filter(item => item.id === program.id).length !== 1
    || planning.building.aboveGroundFloors.filter(item => item.id === program.id).length !== 1
    || !validPlanPolygon(floor.shape) || !validPlanPolygon(mass.shape)) return false;
  if (floor.shape.length !== mass.shape.length || floor.shape.some((point, index) =>
    Math.hypot(point.x - mass.shape[index].x, point.z - mass.shape[index].z) > 1e-6)) return false;
  if (!program.zones.length || program.zones.some(zone => !Number.isFinite(zone.areaSqm) || zone.areaSqm < 0)) return false;
  const programArea = program.zones.reduce((sum, zone) => sum + zone.areaSqm, 0);
  const area = polygonAreaSqm(mass.shape);
  if (!Number.isFinite(programArea) || programArea <= 0 || programArea > 1e9
    || Math.abs(area - programArea) > Math.max(0.01, programArea * GEOMETRY_AREA_PASS_TOLERANCE_PCT / 100)) return false;
  // Recheck the actual region; stored pass flags and hashes cannot establish containment.
  const deadline = performance.now() + 2_000;
  const covered = localParcelIntersectionArea(localParcelPolygons(planning.parcel), [{ outer: mass.shape, holes: [] }]);
  return performance.now() < deadline && Math.abs(area - covered) <= Math.max(1e-6, area * 1e-8);
}

export function resolvePlanningParkingFrontage(input: Pick<BuildPlanningParkingGeometryInput, "scenario" | "planning" | "boundary" | "boundaryPolygons" | "roads">): {
  frontEdge: [LocalPlanPoint, LocalPlanPoint] | null;
  roadName: string | null;
  frontEdgeIndex: number | null;
  candidates: ParcelFrontageEdge[];
  sourceMatched: boolean;
} {
  const empty = { frontEdge: null, roadName: null, frontEdgeIndex: null, candidates: [], sourceMatched: false };
  try {
    const parcel = resolvePlanningParcel(input);
    if (!parcel.available || input.planning.version !== PLANNING_GEOMETRY_VERSION
      || input.planning.projectId !== input.scenario.projectId
      || input.planning.scenarioId !== input.scenario.id || input.planning.scenarioVersion !== input.scenario.version
      || input.planning.scenarioInputBasis !== planningGeometryInputBasis(input.scenario)) return empty;
    const coordinates = input.planning.coordinateSystem;
    if (coordinates.unit !== "meter" || coordinates.horizontalCrs !== "LOCAL_ENU_FROM_WGS84"
      || coordinates.northAxis !== "-Z" || coordinates.eastAxis !== "+X" || coordinates.upAxis !== "+Y") return empty;
    const origin = input.planning.coordinateSystem.originLngLat;
    if (!planningParcelMatchesSnapshot(parcel, input.planning)) return empty;
    const roads = input.roads ?? [];
    if (!planningRoadsMatchSnapshot(roads, input.planning)) return empty;
    if (!groundGeometryMatchesScenario(input.scenario, input.planning)) return empty;
    const frontage = analyzeParcelFrontage(parcel.source, roads, origin);
    if (!frontage) return empty;
    const primary = frontage.frontages.reduce<ParcelFrontageEdge | null>((best, edge) => !best || edge.roadDistM < best.roadDistM ? edge : best, null);
    return { frontEdge: primary?.edge ?? null, roadName: primary?.roadName ?? null,
      frontEdgeIndex: parcel.simple ? primary?.edgeIndex ?? null : null, candidates: frontage.frontages, sourceMatched: true };
  } catch { return empty; }
}

function validationFor(input: {
  strategy: PlanningScenario["parking"]["strategy"];
  requiredCars: number;
  frontageKnown: boolean;
  layout: ParkingLayoutResult;
  sourceMatched: boolean;
  requiredCarsValid: boolean;
}): PlanningParkingGeometrySnapshot["validation"] {
  const issues: PlanningParkingGeometryIssue[] = [];
  if (!input.sourceMatched) issues.push({ code: "parking-source-mismatch", severity: "fail",
    message: "전체 대지·도로·계획안 원자료와 일치하고 대지 안에 포함된 유효한 1층 형상이 없어 주차 검증을 보류했습니다." });
  if (!input.requiredCarsValid) issues.push({ code: "parking-required-cars-invalid", severity: "fail",
    message: "요구 주차대수가 유효한 0 이상의 수가 아닙니다." });
  if (input.strategy === "none" && input.requiredCars === 0 && issues.length === 0) {
    return { status: "not-applicable", exportable: true, issues };
  }
  if (input.strategy === "none") {
    issues.push({
      code: "parking-strategy-missing",
      severity: "fail",
      message: `요구 주차 ${input.requiredCars}대가 있으나 주차 계획이 없습니다.`,
    });
  } else if (!input.layout.supportedStrategy) {
    issues.push({
      code: "parking-layout-unsupported",
      severity: "fail",
      message:
        input.layout.warnings[0] ??
        "선택한 주차 전략의 실제 면·통로 형상을 만들 수 없습니다.",
    });
  }
  if (
    ["surface", "piloti", "mixed"].includes(input.strategy) &&
    !input.frontageKnown
  ) {
    issues.push({
      code: "parking-frontage-unknown",
      severity: "fail",
      message:
        "도로 접면 방향이 없어 주차 진입 형상을 검증할 수 없습니다. 임의의 도로 폭은 사용하지 않습니다.",
    });
  }
  if (input.layout.shortfallCars > 0) {
    issues.push({
      code: "parking-capacity-shortfall",
      severity: "fail",
      message: `실제 주차 배치가 요구 대수보다 ${input.layout.shortfallCars}대 부족합니다.`,
    });
  }
  const failed = issues.some((issue) => issue.severity === "fail");
  issues.push({
    code: "parking-circulation-unverified",
    severity: "review",
    message: "주차면 형상과 차량 동선은 별개입니다. 내부 후보 궤적과 외부 도로·진출입 허가·전문가 승인은 구분됩니다.",
  });
  return {
    status: failed ? "fail" : issues.length > 0 ? "review" : "pass",
    exportable: !failed,
    issues,
  };
}

export function buildPlanningParkingGeometry(
  input: BuildPlanningParkingGeometryInput
): PlanningParkingGeometrySnapshot {
  const requiredCarsValid = Number.isFinite(input.requiredCars) && input.requiredCars >= 0 && input.requiredCars <= 1000;
  const requiredCars = requiredCarsValid ? Math.ceil(input.requiredCars) : 0;
  const frontage = resolvePlanningParkingFrontage(input);
  const inputsValid = frontage.sourceMatched && requiredCarsValid;
  const firstMass = inputsValid ? input.planning.building.aboveGroundFloors.find(
    (floor) => floor.level === 1
  ) : undefined;
  const parcelPolygons = inputsValid ? localParcelPolygons(input.planning.parcel) : [];
  const layout = calculateParkingLayout({
    strategy: input.scenario.parking.strategy,
    parcelShape: inputsValid ? input.planning.parcel.polygon : [],
    parcelPolygons,
    frontages: frontage.candidates,
    buildingShape: firstMass?.shape ?? [],
    pilotiShape: firstMass?.shape ?? [],
    pilotiEnabled: pilotiEnabled(input.scenario),
    requiredCars,
    frontEdge: frontage.frontEdge,
    parking: input.scenario.parking,
  });
  const validation = validationFor({
    strategy: input.scenario.parking.strategy,
    requiredCars,
    frontageKnown: frontage.frontEdge != null,
    sourceMatched: frontage.sourceMatched,
    requiredCarsValid,
    layout,
  });
  const circulation = assessVehicleCirculation({
    layout, parcel: input.planning.parcel.polygon, parcelPolygons, frontEdge: frontage.frontEdge, parking: input.scenario.parking,
  });
  const parkingGeometryHash = stableParkingHash({
    version: PLANNING_PARKING_GEOMETRY_VERSION,
    projectId: input.planning.projectId,
    scenarioId: input.scenario.id,
    scenarioVersion: input.scenario.version,
    planningGeometryHash: input.planning.geometryHash,
    strategy: input.scenario.parking.strategy,
    parking: {
      orientation: input.scenario.parking.orientation ?? "auto",
      stallWidthM: input.scenario.parking.stallWidthM ?? 2.5,
      stallDepthM: input.scenario.parking.stallDepthM ?? 5,
      aisleWidthM: input.scenario.parking.aisleWidthM ?? 6,
      entryWidthM: input.scenario.parking.entryWidthM ?? 3,
      coreAreaSqm: input.scenario.parking.coreAreaSqm ?? 0,
      columnLossPct: input.scenario.parking.columnLossPct ?? 0,
    },
    requiredCars,
    requiredCarsValid,
    sourceMatched: frontage.sourceMatched,
    vehicleProfile: circulation.profile,
    entryOffsetRatio: input.scenario.parking.entryOffsetRatio ?? 0.5,
    frontages: frontage.candidates.map(edge => ({ polygonIndex: edge.polygonIndex, ringIndex: edge.ringIndex,
      edgeIndex: edge.edgeIndex, edge: canonicalPoints(edge.edge), roadName: edge.roadName })),
    components: layout.components.map(component => ({ id: component.id, polygonIndex: component.polygonIndex,
      accessStatus: component.accessStatus, frontage: component.frontage ? {
        polygonIndex: component.frontage.polygonIndex, ringIndex: component.frontage.ringIndex,
        edgeIndex: component.frontage.edgeIndex, edge: canonicalPoints(component.frontage.edge),
      } : null,
      aisleShape: canonicalPoints(component.aisleShape), coreShape: canonicalPoints(component.coreShape),
      columns: canonicalPoints(component.columns),
      entryPaths: component.entryPaths.map(path => ({ stallId: path.stallId, points: canonicalPoints(path.points) })),
      obstacles: component.obstacles.map(obstacle => ({ id: obstacle.id, shape: canonicalPoints(obstacle.shape) })),
    })),
    capacityCars: layout.capacityCars,
    shortfallCars: layout.shortfallCars,
    accessMode: layout.accessMode,
    orientationDeg: round(layout.orientationDeg),
    stalls: layout.stalls.map((stall) => ({
      id: stall.id,
      source: stall.source,
      corners: canonicalPoints(stall.corners),
    })),
    aisleShape: canonicalPoints(layout.aisleShape),
    coreShape: canonicalPoints(layout.coreShape),
    columns: canonicalPoints(layout.columns),
    entryPath: canonicalPoints(layout.entryPath),
  });

  return {
    version: PLANNING_PARKING_GEOMETRY_VERSION,
    projectId: input.planning.projectId,
    scenarioId: input.scenario.id,
    scenarioVersion: input.scenario.version,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    planningGeometryHash: input.planning.geometryHash,
    parkingGeometryHash,
    coordinateSystem: input.planning.coordinateSystem,
    strategy: input.scenario.parking.strategy,
    frontage: {
      status: frontage.frontEdge ? "known" : "unknown",
      roadName: frontage.roadName,
      source: frontage.frontEdge ? "VWorld road centerline" : "none",
      frontEdgeIndex: frontage.frontEdgeIndex,
      verifiedWidthM: null,
      candidates: frontage.candidates,
      sourceMatched: frontage.sourceMatched,
    },
    layout,
    circulation,
    validation,
    sourceNotes: [
      "주차면·통로·코어·기둥 참고점·진입선은 Stage 2 주차 배치 엔진의 동일 로컬 미터 좌표를 사용합니다.",
      "도로 중심선은 접면 방향에만 사용하며 검증되지 않은 도로 폭을 생성하지 않습니다.",
      "PG_PARKING_COLUMNS_REFERENCE는 구조설계 확정 기둥이 아니라 주차 효율 검토용 참고점입니다.",
      "차량 후보 궤적은 설정 제원 기반 예비 검사이며 공식 경계·도로 진출입·허가·주차 가능 대수 확정값이 아닙니다.",
    ],
  };
}
