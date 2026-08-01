import type { LngLat } from "@/lib/finance/buildable-area";
import { analyzeFrontage } from "@/lib/geo/road-frontage";
import {
  calculateParkingLayout,
  type ParkingLayoutResult,
} from "@/lib/planning/parking-layout";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import type { PlanningScenario } from "@/lib/planning/types";

export const PLANNING_PARKING_GEOMETRY_VERSION =
  "planning-parking-geometry-v1" as const;

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
  };
  layout: ParkingLayoutResult;
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

function closeBoundary(boundary: LngLat[]): LngLat[] {
  const first = boundary[0];
  const last = boundary[boundary.length - 1];
  if (!first || !last) return boundary;
  return first[0] === last[0] && first[1] === last[1]
    ? boundary
    : [...boundary, first];
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

function resolveFrontage(input: BuildPlanningParkingGeometryInput): {
  frontEdge: [LocalPlanPoint, LocalPlanPoint] | null;
  roadName: string | null;
  frontEdgeIndex: number | null;
} {
  const frontage =
    input.boundary && input.boundary.length >= 3 && input.roads?.length
      ? analyzeFrontage(closeBoundary(input.boundary), input.roads)
      : null;
  const polygon = input.planning.parcel.polygon;
  if (
    !frontage ||
    frontage.frontIndex < 0 ||
    frontage.frontIndex >= polygon.length
  ) {
    return { frontEdge: null, roadName: null, frontEdgeIndex: null };
  }
  return {
    frontEdge: [
      polygon[frontage.frontIndex],
      polygon[(frontage.frontIndex + 1) % polygon.length],
    ],
    roadName: frontage.roadName,
    frontEdgeIndex: frontage.frontIndex,
  };
}

function validationFor(input: {
  strategy: PlanningScenario["parking"]["strategy"];
  requiredCars: number;
  frontageKnown: boolean;
  layout: ParkingLayoutResult;
}): PlanningParkingGeometrySnapshot["validation"] {
  const issues: PlanningParkingGeometryIssue[] = [];
  if (input.strategy === "none" && input.requiredCars === 0) {
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
  return {
    status: failed ? "fail" : issues.length > 0 ? "review" : "pass",
    exportable: !failed,
    issues,
  };
}

export function buildPlanningParkingGeometry(
  input: BuildPlanningParkingGeometryInput
): PlanningParkingGeometrySnapshot {
  const requiredCars = Math.max(0, Math.ceil(input.requiredCars));
  const firstMass = input.planning.building.aboveGroundFloors.find(
    (floor) => floor.level === 1
  );
  const frontage = resolveFrontage(input);
  const layout = calculateParkingLayout({
    strategy: input.scenario.parking.strategy,
    parcelShape: input.planning.parcel.polygon,
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
    layout,
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
    },
    layout,
    validation,
    sourceNotes: [
      "주차면·통로·코어·기둥 참고점·진입선은 Stage 2 주차 배치 엔진의 동일 로컬 미터 좌표를 사용합니다.",
      "도로 중심선은 접면 방향에만 사용하며 검증되지 않은 도로 폭을 생성하지 않습니다.",
      "PG_PARKING_COLUMNS_REFERENCE는 구조설계 확정 기둥이 아니라 주차 효율 검토용 참고점입니다.",
    ],
  };
}
