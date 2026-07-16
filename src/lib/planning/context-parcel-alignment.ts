import {
  area as turfArea,
  featureCollection,
  intersect,
  polygon as turfPolygon,
} from "@turf/turf";
import type { CadastralContextSnapshot } from "@/lib/geo/cadastral-context";
import type {
  ContextGeometryBuilding,
  ContextGeometrySnapshot,
} from "@/lib/planning/sketchup-export-package";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";

export const CONTEXT_PARCEL_ALIGNMENT_VERSION =
  "context-parcel-alignment-v1" as const;
export const CONTEXT_PARCEL_ALIGNED_MIN_RATIO = 0.85;
export const CONTEXT_PARCEL_REVIEW_MIN_RATIO = 0.6;

export type ContextParcelAlignmentStatus = "aligned" | "review" | "mismatch";

export interface ContextBuildingParcelAlignment {
  buildingId: string;
  buildingName: string;
  status: ContextParcelAlignmentStatus;
  coverageRatio: number;
  coveragePct: number;
  bestParcelPnu: string | null;
  bestParcelCoverageRatio: number;
}

export interface ContextParcelAlignmentSnapshot {
  version: typeof CONTEXT_PARCEL_ALIGNMENT_VERSION;
  projectId: string;
  generatedAt: string;
  buildings: ContextBuildingParcelAlignment[];
  summary: {
    totalBuildings: number;
    alignedBuildings: number;
    reviewBuildings: number;
    mismatchBuildings: number;
    averageCoveragePct: number;
  };
  sourceNotes: string[];
}

interface ParcelCandidate {
  pnu: string;
  polygon: LocalPlanPoint[];
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function openRing(points: LocalPlanPoint[]): LocalPlanPoint[] {
  if (points.length <= 1) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.z === last.z
    ? points.slice(0, -1)
    : points;
}

/**
 * Turf의 교차 연산을 안정적으로 사용하기 위해 로컬 meter를 작은 가상 경위도 값으로
 * 축척한다. 모든 도형에 같은 축척을 적용하므로 면적 비율은 유지된다.
 */
function pseudoLngLatRing(points: LocalPlanPoint[]): [number, number][] {
  const ring = openRing(points);
  if (ring.length < 3) return [];
  const scaled = ring.map(
    (point) => [point.x / 111_000, -point.z / 111_000] as [number, number]
  );
  return [...scaled, scaled[0]];
}

function parcelFeature(parcel: ParcelCandidate) {
  const ring = pseudoLngLatRing(parcel.polygon);
  return ring.length >= 4 ? turfPolygon([ring], { pnu: parcel.pnu }) : null;
}

function buildingFeatures(building: ContextGeometryBuilding) {
  return building.polygons.flatMap((part) => {
    const outer = pseudoLngLatRing(part.outer);
    if (outer.length < 4) return [];
    const holes = part.holes
      .map(pseudoLngLatRing)
      .filter((ring) => ring.length >= 4);
    try {
      return [turfPolygon([outer, ...holes], { buildingId: building.id })];
    } catch {
      return [];
    }
  });
}

function overlapAreaSqm(
  buildingFeature: ReturnType<typeof turfPolygon>,
  parcel: ReturnType<typeof turfPolygon>
): number {
  try {
    const overlap = intersect(featureCollection([buildingFeature, parcel]));
    return overlap ? turfArea(overlap) : 0;
  } catch {
    return 0;
  }
}

function assessBuilding(
  building: ContextGeometryBuilding,
  parcels: ParcelCandidate[]
): ContextBuildingParcelAlignment {
  const features = buildingFeatures(building);
  const totalArea = features.reduce((sum, feature) => sum + turfArea(feature), 0);
  if (totalArea <= 0 || parcels.length === 0) {
    return {
      buildingId: building.id,
      buildingName: building.name,
      status: "mismatch",
      coverageRatio: 0,
      coveragePct: 0,
      bestParcelPnu: null,
      bestParcelCoverageRatio: 0,
    };
  }

  let coveredArea = 0;
  let bestParcelPnu: string | null = null;
  let bestParcelArea = 0;

  for (const candidate of parcels) {
    const parcel = parcelFeature(candidate);
    if (!parcel) continue;
    const parcelOverlap = features.reduce(
      (sum, feature) => sum + overlapAreaSqm(feature, parcel),
      0
    );
    coveredArea += parcelOverlap;
    if (parcelOverlap > bestParcelArea) {
      bestParcelArea = parcelOverlap;
      bestParcelPnu = candidate.pnu;
    }
  }

  const coverageRatio = Math.max(0, Math.min(1, coveredArea / totalArea));
  const bestParcelCoverageRatio = Math.max(
    0,
    Math.min(1, bestParcelArea / totalArea)
  );
  const status: ContextParcelAlignmentStatus =
    coverageRatio >= CONTEXT_PARCEL_ALIGNED_MIN_RATIO
      ? "aligned"
      : coverageRatio >= CONTEXT_PARCEL_REVIEW_MIN_RATIO
        ? "review"
        : "mismatch";

  return {
    buildingId: building.id,
    buildingName: building.name,
    status,
    coverageRatio: round(coverageRatio),
    coveragePct: round(coverageRatio * 100, 1),
    bestParcelPnu,
    bestParcelCoverageRatio: round(bestParcelCoverageRatio),
  };
}

export function buildContextParcelAlignment(input: {
  context: ContextGeometrySnapshot;
  cadastral: CadastralContextSnapshot;
  generatedAt?: string;
}): ContextParcelAlignmentSnapshot {
  const parcels: ParcelCandidate[] = [
    {
      pnu: input.cadastral.targetParcel.pnu,
      polygon: input.cadastral.targetParcel.polygon,
    },
    ...input.cadastral.adjacentParcels.map((parcel) => ({
      pnu: parcel.pnu,
      polygon: parcel.polygon,
    })),
  ];
  const buildings = input.context.buildings.map((building) =>
    assessBuilding(building, parcels)
  );
  const alignedBuildings = buildings.filter(
    (building) => building.status === "aligned"
  ).length;
  const reviewBuildings = buildings.filter(
    (building) => building.status === "review"
  ).length;
  const mismatchBuildings = buildings.filter(
    (building) => building.status === "mismatch"
  ).length;
  const averageCoveragePct =
    buildings.length > 0
      ? buildings.reduce((sum, building) => sum + building.coveragePct, 0) /
        buildings.length
      : 0;

  return {
    version: CONTEXT_PARCEL_ALIGNMENT_VERSION,
    projectId: input.context.projectId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    buildings,
    summary: {
      totalBuildings: buildings.length,
      alignedBuildings,
      reviewBuildings,
      mismatchBuildings,
      averageCoveragePct: round(averageCoveragePct, 1),
    },
    sourceNotes: [
      "주변 건물 외곽과 대상·인접 필지 경계를 동일한 로컬 meter 좌표에서 면적 교차로 비교합니다.",
      "필지 경계 내 포함 비율 85% 이상은 정합, 60~85%는 확인, 60% 미만은 불일치로 분류합니다.",
      "이 검사는 VWorld 건물통합정보와 연속지적도의 상대 정합을 확인하며 경계측량을 대체하지 않습니다.",
    ],
  };
}
