import type {
  BuildingPolygon,
  ExistingBuildingFootprint,
  ExistingBuildingGeometry,
} from "@/lib/geo/existing-building-geometry";
import {
  planningRingToLocalMeters,
  polygonSelfIntersects,
  type PlanningGeometrySnapshot,
} from "@/lib/planning/planning-geometry";
import { polygonAreaSqm, type LocalPlanPoint } from "@/lib/planning/planning-massing";

export const CONTEXT_GEOMETRY_VERSION = "context-geometry-v1" as const;
export const SKETCHUP_EXPORT_PACKAGE_VERSION = "sketchup-export-package-v1" as const;
export const DEFAULT_CONTEXT_FLOOR_HEIGHT_M = 3;

export type ContextHeightSource =
  | "registered-height"
  | "floor-count-estimate"
  | "default-one-floor-estimate";

export type ContextAccuracy = "verified" | "estimated";

export interface LocalContextPolygon {
  outer: LocalPlanPoint[];
  holes: LocalPlanPoint[][];
}

export interface ContextGeometryBuilding {
  id: string;
  name: string;
  polygons: LocalContextPolygon[];
  sourceFootprintAreaSqm: number;
  measuredFootprintAreaSqm: number;
  groundFloors: number;
  heightM: number;
  heightSource: ContextHeightSource;
  accuracy: ContextAccuracy;
  source: "vworld-dt_d010";
}

export interface ContextGeometryIssue {
  code: string;
  severity: "review";
  message: string;
  buildingId?: string;
}

export interface ContextGeometrySnapshot {
  version: typeof CONTEXT_GEOMETRY_VERSION;
  projectId: string;
  generatedAt: string;
  contextHash: string;
  coordinateSystem: PlanningGeometrySnapshot["coordinateSystem"];
  radiusM: number;
  buildings: ContextGeometryBuilding[];
  summary: {
    totalBuildings: number;
    verifiedHeightBuildings: number;
    estimatedHeightBuildings: number;
    defaultHeightBuildings: number;
    excludedBuildings: number;
  };
  validation: {
    status: "pass" | "review";
    usable: boolean;
    issues: ContextGeometryIssue[];
  };
  sourceNotes: string[];
}

export type SketchupLayerName =
  | "PG_PARCEL"
  | "PG_PROPOSED_MASS"
  | "PG_CONTEXT_BUILDINGS_VERIFIED"
  | "PG_CONTEXT_BUILDINGS_ESTIMATED"
  | "PG_ROADS"
  | "PG_NORTH"
  | "PG_METADATA";

export interface SketchupExportLayer {
  name: SketchupLayerName;
  objectCount: number;
  accuracy: "verified" | "mixed" | "reference";
  purpose: string;
}

export interface SketchupExportPackageSnapshot {
  version: typeof SKETCHUP_EXPORT_PACKAGE_VERSION;
  projectId: string;
  scenarioId: string;
  scenarioVersion: number;
  generatedAt: string;
  planningGeometryHash: string;
  contextGeometryHash: string;
  exportPackageHash: string;
  planning: PlanningGeometrySnapshot;
  context: ContextGeometrySnapshot;
  layers: SketchupExportLayer[];
  validation: {
    status: "ready" | "ready-with-warnings" | "blocked";
    exportable: boolean;
    blockingReasons: string[];
    warnings: string[];
  };
}

export interface BuildContextGeometryInput {
  projectId: string;
  planning: PlanningGeometrySnapshot;
  existingGeometry?: ExistingBuildingGeometry | null;
  generatedAt?: string;
  defaultFloorHeightM?: number;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableHash(prefix: "CTX" | "EXP", value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function canonicalPoint(point: LocalPlanPoint): [number, number] {
  return [round(point.x), round(point.z)];
}

function toLocalPolygon(
  polygon: BuildingPolygon,
  origin: [number, number]
): LocalContextPolygon | null {
  const rings = polygon
    .map((ring) => planningRingToLocalMeters(ring, origin))
    .filter((ring) => ring.length >= 3);
  const outer = rings[0];
  if (!outer || outer.length < 3 || polygonAreaSqm(outer) <= 0) return null;
  return { outer, holes: rings.slice(1) };
}

function heightForFootprint(
  footprint: ExistingBuildingFootprint,
  defaultFloorHeightM: number
): Pick<ContextGeometryBuilding, "heightM" | "heightSource" | "accuracy"> {
  if (Number.isFinite(footprint.heightM) && footprint.heightM > 0) {
    return {
      heightM: footprint.heightM,
      heightSource: "registered-height",
      accuracy: "verified",
    };
  }
  if (Number.isFinite(footprint.groundFloors) && footprint.groundFloors > 0) {
    return {
      heightM: footprint.groundFloors * defaultFloorHeightM,
      heightSource: "floor-count-estimate",
      accuracy: "estimated",
    };
  }
  return {
    heightM: defaultFloorHeightM,
    heightSource: "default-one-floor-estimate",
    accuracy: "estimated",
  };
}

function buildContextBuilding(
  footprint: ExistingBuildingFootprint,
  origin: [number, number],
  defaultFloorHeightM: number
): { building: ContextGeometryBuilding | null; issue?: ContextGeometryIssue } {
  const polygons = footprint.polygons
    .map((polygon) => toLocalPolygon(polygon, origin))
    .filter((polygon): polygon is LocalContextPolygon => polygon !== null);

  if (polygons.length === 0) {
    return {
      building: null,
      issue: {
        code: "context-empty-geometry",
        severity: "review",
        buildingId: footprint.id,
        message: `${footprint.buildingName || footprint.id} 주변 건물의 유효한 외곽선을 만들 수 없어 export에서 제외했습니다.`,
      },
    };
  }

  const selfIntersects = polygons.some(
    (polygon) =>
      polygonSelfIntersects(polygon.outer) ||
      polygon.holes.some((hole) => polygonSelfIntersects(hole))
  );
  if (selfIntersects) {
    return {
      building: null,
      issue: {
        code: "context-self-intersection",
        severity: "review",
        buildingId: footprint.id,
        message: `${footprint.buildingName || footprint.id} 주변 건물 외곽선이 자기 교차해 export에서 제외했습니다.`,
      },
    };
  }

  const height = heightForFootprint(footprint, defaultFloorHeightM);
  const measuredFootprintAreaSqm = polygons.reduce((sum, polygon) => {
    const holesArea = polygon.holes.reduce(
      (holeSum, hole) => holeSum + polygonAreaSqm(hole),
      0
    );
    return sum + Math.max(0, polygonAreaSqm(polygon.outer) - holesArea);
  }, 0);

  return {
    building: {
      id: footprint.id,
      name: footprint.buildingName,
      polygons,
      sourceFootprintAreaSqm: footprint.footprintAreaSqm,
      measuredFootprintAreaSqm,
      groundFloors: Math.max(0, Math.floor(footprint.groundFloors)),
      ...height,
      source: "vworld-dt_d010",
    },
  };
}

export function buildContextGeometry(
  input: BuildContextGeometryInput
): ContextGeometrySnapshot {
  const defaultFloorHeightM =
    Number.isFinite(input.defaultFloorHeightM) && (input.defaultFloorHeightM ?? 0) > 0
      ? input.defaultFloorHeightM!
      : DEFAULT_CONTEXT_FLOOR_HEIGHT_M;
  const contextFootprints = input.existingGeometry?.contextFootprints ?? [];
  const issues: ContextGeometryIssue[] = [];
  const buildings: ContextGeometryBuilding[] = [];

  for (const footprint of [...contextFootprints].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    const result = buildContextBuilding(
      footprint,
      input.planning.coordinateSystem.originLngLat,
      defaultFloorHeightM
    );
    if (result.building) buildings.push(result.building);
    if (result.issue) issues.push(result.issue);
  }

  const estimatedHeightBuildings = buildings.filter(
    (building) => building.accuracy === "estimated"
  ).length;
  const defaultHeightBuildings = buildings.filter(
    (building) => building.heightSource === "default-one-floor-estimate"
  ).length;
  if (estimatedHeightBuildings > 0) {
    issues.push({
      code: "context-height-estimated",
      severity: "review",
      message: `주변 건물 ${estimatedHeightBuildings}동의 높이는 건축물대장 실측 높이가 없어 층수 또는 기본 ${defaultFloorHeightM.toFixed(1)}m 층고로 추정했습니다.`,
    });
  }

  const radiusM = input.existingGeometry?.contextRadiusM ?? 0;
  const canonicalBuildings = buildings.map((building) => ({
    id: building.id,
    heightM: round(building.heightM),
    heightSource: building.heightSource,
    polygons: building.polygons.map((polygon) => ({
      outer: polygon.outer.map(canonicalPoint),
      holes: polygon.holes.map((hole) => hole.map(canonicalPoint)),
    })),
  }));
  const contextHash = stableHash("CTX", {
    version: CONTEXT_GEOMETRY_VERSION,
    projectId: input.projectId,
    planningOrigin: input.planning.coordinateSystem.originLngLat.map((value) =>
      round(value, 8)
    ),
    radiusM: round(radiusM),
    buildings: canonicalBuildings,
  });

  return {
    version: CONTEXT_GEOMETRY_VERSION,
    projectId: input.projectId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    contextHash,
    coordinateSystem: input.planning.coordinateSystem,
    radiusM,
    buildings,
    summary: {
      totalBuildings: buildings.length,
      verifiedHeightBuildings: buildings.filter(
        (building) => building.accuracy === "verified"
      ).length,
      estimatedHeightBuildings,
      defaultHeightBuildings,
      excludedBuildings: Math.max(0, contextFootprints.length - buildings.length),
    },
    validation: {
      status: issues.length > 0 ? "review" : "pass",
      usable: true,
      issues,
    },
    sourceNotes: [
      "주변 건물 외곽·위치·방향은 VWorld GIS건물통합정보를 계획 매스와 동일한 로컬 미터 좌표로 변환합니다.",
      "등록 높이가 없으면 층수 × 기준 층고를 사용하며 PG_CONTEXT_BUILDINGS_ESTIMATED 레이어로 분리합니다.",
      "주변 건물은 설계 맥락용이며 계획 매스의 치수 검증 기준으로 사용하지 않습니다.",
    ],
  };
}

export function buildSketchupExportPackage(input: {
  planning: PlanningGeometrySnapshot;
  existingGeometry?: ExistingBuildingGeometry | null;
  generatedAt?: string;
  defaultFloorHeightM?: number;
}): SketchupExportPackageSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const context = buildContextGeometry({
    projectId: input.planning.projectId,
    planning: input.planning,
    existingGeometry: input.existingGeometry,
    generatedAt,
    defaultFloorHeightM: input.defaultFloorHeightM,
  });
  const verifiedContextCount = context.summary.verifiedHeightBuildings;
  const estimatedContextCount = context.summary.estimatedHeightBuildings;
  const layers: SketchupExportLayer[] = [
    {
      name: "PG_PARCEL",
      objectCount: input.planning.parcel.polygon.length >= 3 ? 1 : 0,
      accuracy: "verified",
      purpose: "대상 필지 경계",
    },
    {
      name: "PG_PROPOSED_MASS",
      objectCount: input.planning.building.floors.length,
      accuracy: "verified",
      purpose: "건축가 설계 시작 기준 계획 매스",
    },
    {
      name: "PG_CONTEXT_BUILDINGS_VERIFIED",
      objectCount: verifiedContextCount,
      accuracy: "verified",
      purpose: "등록 높이가 확인된 주변 건물",
    },
    {
      name: "PG_CONTEXT_BUILDINGS_ESTIMATED",
      objectCount: estimatedContextCount,
      accuracy: "mixed",
      purpose: "높이를 층수 또는 기본 층고로 추정한 주변 건물",
    },
    {
      name: "PG_ROADS",
      objectCount: input.planning.roads.length,
      accuracy: "reference",
      purpose: "VWorld 도로 중심선",
    },
    {
      name: "PG_NORTH",
      objectCount: 1,
      accuracy: "verified",
      purpose: "정북 방향 및 좌표축",
    },
    {
      name: "PG_METADATA",
      objectCount: 1,
      accuracy: "verified",
      purpose: "출처·단위·해시·검증 결과",
    },
  ];

  const blockingReasons = input.planning.validation.issues
    .filter((issue) => issue.severity === "fail")
    .map((issue) => issue.message);
  const warnings = [
    ...input.planning.validation.issues
      .filter((issue) => issue.severity === "review")
      .map((issue) => issue.message),
    ...context.validation.issues.map((issue) => issue.message),
  ];
  const exportable = input.planning.validation.exportable;
  const status = !exportable
    ? "blocked"
    : warnings.length > 0
      ? "ready-with-warnings"
      : "ready";
  const exportPackageHash = stableHash("EXP", {
    version: SKETCHUP_EXPORT_PACKAGE_VERSION,
    projectId: input.planning.projectId,
    scenarioId: input.planning.scenarioId,
    scenarioVersion: input.planning.scenarioVersion,
    planningGeometryHash: input.planning.geometryHash,
    contextGeometryHash: context.contextHash,
    layers: layers.map((layer) => ({ name: layer.name, count: layer.objectCount })),
  });

  return {
    version: SKETCHUP_EXPORT_PACKAGE_VERSION,
    projectId: input.planning.projectId,
    scenarioId: input.planning.scenarioId,
    scenarioVersion: input.planning.scenarioVersion,
    generatedAt,
    planningGeometryHash: input.planning.geometryHash,
    contextGeometryHash: context.contextHash,
    exportPackageHash,
    planning: input.planning,
    context,
    layers,
    validation: {
      status,
      exportable,
      blockingReasons,
      warnings,
    },
  };
}
