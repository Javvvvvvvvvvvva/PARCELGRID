import type { CadastralContextSnapshot } from "@/lib/geo/cadastral-context";
import type {
  ContextGeometryBuilding,
  ContextGeometrySnapshot,
} from "@/lib/planning/sketchup-export-package";
import { localParcelPolygons, type LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelArea, localParcelCoveredArea, localParcelIntersectionArea, validateLocalParcelTopology } from "@/lib/geo/parcel-topology-geometry";

export const CONTEXT_PARCEL_ALIGNMENT_VERSION =
  "context-parcel-alignment-v2" as const;
export const CONTEXT_PARCEL_ALIGNED_MIN_RATIO = 0.85;
export const CONTEXT_PARCEL_REVIEW_MIN_RATIO = 0.6;

export type ContextParcelAlignmentStatus = "aligned" | "review" | "mismatch" | "unavailable";

export interface ContextBuildingParcelAlignment {
  buildingId: string;
  buildingName: string;
  status: ContextParcelAlignmentStatus;
  coverageRatio: number | null;
  coveragePct: number | null;
  bestParcelPnu: string | null;
  bestParcelCoverageRatio: number | null;
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
    unavailableBuildings: number;
    averageCoveragePct: number | null;
  };
  sourceNotes: string[];
}

interface ParcelCandidate {
  pnu: string;
  polygons: LocalParcelPolygon[];
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unavailableBuilding(building: ContextGeometryBuilding): ContextBuildingParcelAlignment {
  return { buildingId: building.id, buildingName: building.name,
    status: "unavailable", coverageRatio: null, coveragePct: null, bestParcelPnu: null, bestParcelCoverageRatio: null };
}

function assessBuilding(
  building: ContextGeometryBuilding,
  parcels: ParcelCandidate[],
  checkDeadline: () => void,
): ContextBuildingParcelAlignment {
  checkDeadline();
  const valid = validateLocalParcelTopology(building.polygons, checkDeadline);
  checkDeadline();
  if (!valid || !parcels.length) return unavailableBuilding(building);
  const totalArea = localParcelArea(building.polygons);

  let bestParcelPnu: string | null = null;
  let bestParcelArea = 0;

  checkDeadline();
  const coveredArea = localParcelCoveredArea(building.polygons, parcels.map(parcel => parcel.polygons));
  checkDeadline();
  for (const candidate of parcels) {
    checkDeadline();
    const parcelOverlap = localParcelIntersectionArea(building.polygons, candidate.polygons);
    checkDeadline();
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
  const deadline = performance.now() + 2_000;
  let timedOut = false;
  const checkDeadline = () => {
    if (timedOut || performance.now() >= deadline) {
      timedOut = true;
      throw new DOMException("Context parcel alignment deadline exceeded", "TimeoutError");
    }
  };
  const parcels: ParcelCandidate[] = [
    {
      pnu: input.cadastral.targetParcel.pnu,
      polygons: [{ outer: input.cadastral.targetParcel.polygon, holes: [] }],
    },
    ...input.cadastral.adjacentParcels.map((parcel) => ({
      pnu: parcel.pnu,
      polygons: localParcelPolygons(parcel),
    })),
  ];
  let contextValid = input.cadastral.validation.usable;
  try {
    contextValid = contextValid && parcels.every(parcel => {
      checkDeadline();
      const valid = validateLocalParcelTopology(parcel.polygons, checkDeadline);
      checkDeadline();
      return valid;
    });
  } catch { contextValid = false; }
  const buildings = input.context.buildings.map(building => {
    if (!contextValid || timedOut) return unavailableBuilding(building);
    try { return assessBuilding(building, parcels, checkDeadline); }
    catch { return unavailableBuilding(building); }
  });
  const alignedBuildings = buildings.filter(
    (building) => building.status === "aligned"
  ).length;
  const reviewBuildings = buildings.filter(
    (building) => building.status === "review"
  ).length;
  const mismatchBuildings = buildings.filter(
    (building) => building.status === "mismatch"
  ).length;
  const unavailableBuildings = buildings.filter(building => building.status === "unavailable").length;
  const measured = buildings.filter(building => building.coveragePct !== null);
  const averageCoveragePct = measured.length ? measured.reduce((sum, building) => sum + building.coveragePct!, 0) / measured.length : null;

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
      unavailableBuildings,
      averageCoveragePct: averageCoveragePct === null ? null : round(averageCoveragePct, 1),
    },
    sourceNotes: [
      "주변 건물 외곽과 대상·인접 필지 경계를 동일한 로컬 meter 좌표에서 면적 교차로 비교합니다.",
      "필지 경계 내 포함 비율 85% 이상은 정합, 60~85%는 확인, 60% 미만은 불일치로 분류합니다.",
      "이 검사는 VWorld 건물통합정보와 연속지적도의 상대 정합을 확인하며 경계측량을 대체하지 않습니다.",
    ],
  };
}
