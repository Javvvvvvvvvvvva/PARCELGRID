import type { CadastralContextSnapshot } from "@/lib/geo/cadastral-context";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import type { ContextGeometrySnapshot } from "@/lib/planning/sketchup-export-package";

export const SITE_DELIVERY_AUDIT_VERSION = "site-delivery-audit-v1" as const;

export type SiteDeliveryCheckStatus = "pass" | "review" | "fail";

export interface SiteDeliveryCheck {
  id: string;
  status: SiteDeliveryCheckStatus;
  label: string;
  message: string;
}

export interface SiteDeliveryAudit {
  version: typeof SITE_DELIVERY_AUDIT_VERSION;
  status: SiteDeliveryCheckStatus;
  exportable: boolean;
  checks: SiteDeliveryCheck[];
  roadOverlapFloorIds: string[];
  summary: {
    roadBoundaryCount: number;
    verifiedWidthFrontageCount: number;
    widthSampleCount: number;
    totalContextBuildings: number;
    estimatedContextBuildings: number;
    maxCoordinateAbsM: number;
  };
}

function openRing(points: LocalPlanPoint[]): LocalPlanPoint[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.z === last.z ? points.slice(0, -1) : points;
}

function orientation(
  a: LocalPlanPoint,
  b: LocalPlanPoint,
  c: LocalPlanPoint
): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function properSegmentsIntersect(
  a: LocalPlanPoint,
  b: LocalPlanPoint,
  c: LocalPlanPoint,
  d: LocalPlanPoint
): boolean {
  const epsilon = 1e-7;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (
    ((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon)) &&
    ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))
  );
}

function pointOnSegment(
  point: LocalPlanPoint,
  start: LocalPlanPoint,
  end: LocalPlanPoint
): boolean {
  const epsilon = 1e-7;
  if (Math.abs(orientation(start, end, point)) > epsilon) return false;
  return (
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.z >= Math.min(start.z, end.z) - epsilon &&
    point.z <= Math.max(start.z, end.z) + epsilon
  );
}

function pointStrictlyInsidePolygon(
  point: LocalPlanPoint,
  polygon: LocalPlanPoint[]
): boolean {
  const ring = openRing(polygon);
  if (ring.length < 3) return false;
  for (let index = 0; index < ring.length; index += 1) {
    if (pointOnSegment(point, ring[index], ring[(index + 1) % ring.length])) {
      return false;
    }
  }
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index];
    const b = ring[previous];
    const crosses =
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function polygonsHaveAreaOverlap(
  first: LocalPlanPoint[],
  second: LocalPlanPoint[]
): boolean {
  const a = openRing(first);
  const b = openRing(second);
  if (a.length < 3 || b.length < 3) return false;

  for (let firstIndex = 0; firstIndex < a.length; firstIndex += 1) {
    const firstStart = a[firstIndex];
    const firstEnd = a[(firstIndex + 1) % a.length];
    for (let secondIndex = 0; secondIndex < b.length; secondIndex += 1) {
      if (
        properSegmentsIntersect(
          firstStart,
          firstEnd,
          b[secondIndex],
          b[(secondIndex + 1) % b.length]
        )
      ) {
        return true;
      }
    }
  }

  return (
    a.some((point) => pointStrictlyInsidePolygon(point, b)) ||
    b.some((point) => pointStrictlyInsidePolygon(point, a))
  );
}

function maxCoordinateAbs(input: {
  planning: PlanningGeometrySnapshot;
  context: ContextGeometrySnapshot;
  cadastral: CadastralContextSnapshot;
}): number {
  const points: LocalPlanPoint[] = [
    ...input.planning.parcel.polygon,
    ...input.planning.building.floors.flatMap((floor) => floor.shape),
    ...input.planning.roads.flatMap((road) => road.points),
    ...input.context.buildings.flatMap((building) =>
      building.polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes].flat())
    ),
    ...input.cadastral.adjacentParcels.flatMap((parcel) => parcel.polygon),
    ...input.cadastral.roadParcels.flatMap((parcel) => parcel.polygon),
  ];
  return points.reduce(
    (maximum, point) => Math.max(maximum, Math.abs(point.x), Math.abs(point.z)),
    0
  );
}

export function buildSiteDeliveryAudit(input: {
  planning: PlanningGeometrySnapshot;
  context: ContextGeometrySnapshot;
  cadastral: CadastralContextSnapshot;
}): SiteDeliveryAudit {
  const checks: SiteDeliveryCheck[] = [];
  checks.push({
    id: "planning-geometry",
    status: input.planning.validation.exportable ? "pass" : "fail",
    label: "계획 매스 기하",
    message: input.planning.validation.exportable
      ? `Geometry Contract 통과 · ${input.planning.geometryHash}`
      : input.planning.validation.issues.find((issue) => issue.severity === "fail")
          ?.message ?? "계획 매스 Geometry Contract를 통과하지 못했습니다.",
  });

  checks.push({
    id: "road-boundary",
    status: input.cadastral.roadParcels.length > 0 ? "pass" : "review",
    label: "도로 경계",
    message:
      input.cadastral.roadParcels.length > 0
        ? `${input.cadastral.roadParcels.length}개 도로 경계를 동일 좌표계로 확보했습니다.`
        : "도로 폴리곤이 없어 중심선만 참고할 수 있습니다.",
  });

  const widthSampleCount = input.cadastral.frontages.reduce(
    (sum, frontage) => sum + frontage.widthSamples.length,
    0
  );
  checks.push({
    id: "road-width",
    status:
      input.cadastral.summary.verifiedWidthFrontageCount > 0 && widthSampleCount > 0
        ? "pass"
        : "review",
    label: "접도·도로 폭",
    message:
      input.cadastral.summary.verifiedWidthFrontageCount > 0 && widthSampleCount > 0
        ? `${input.cadastral.summary.verifiedWidthFrontageCount}개 접도면에서 ${widthSampleCount}개 폭 단면을 검증했습니다.`
        : "접도면 또는 반대편 도로 경계를 자동 검증하지 못했습니다.",
  });

  const roadOverlapFloorIds = input.planning.building.aboveGroundFloors
    .filter((floor) =>
      input.cadastral.roadParcels.some((road) =>
        polygonsHaveAreaOverlap(floor.shape, road.polygon)
      )
    )
    .map((floor) => floor.id);
  checks.push({
    id: "road-overlap",
    status: roadOverlapFloorIds.length > 0 ? "review" : "pass",
    label: "계획 매스·도로 경계",
    message:
      roadOverlapFloorIds.length > 0
        ? `${roadOverlapFloorIds.length}개 지상층 외곽이 도로 경계와 면적으로 겹칩니다. UPIS/지적 좌표 정합과 계획 배치를 재검토해야 합니다.`
        : "지상 계획 매스와 조회된 도로 경계 사이에 면적 중첩이 없습니다.",
  });

  checks.push({
    id: "context-buildings",
    status: input.context.summary.totalBuildings > 0 ? "pass" : "review",
    label: "주변 건물 맥락",
    message:
      input.context.summary.totalBuildings > 0
        ? `주변 건물 ${input.context.summary.totalBuildings}동을 포함합니다.`
        : "주변 건물 GIS 형상이 없어 일조·맥락 검토 범위가 제한됩니다.",
  });

  checks.push({
    id: "context-height",
    status:
      input.context.summary.estimatedHeightBuildings > 0 ? "review" : "pass",
    label: "주변 건물 높이",
    message:
      input.context.summary.estimatedHeightBuildings > 0
        ? `${input.context.summary.estimatedHeightBuildings}동의 높이가 층수 또는 기본 층고 기반 추정값입니다.`
        : "모든 포함 주변 건물의 등록 높이가 확인됐습니다.",
  });

  const maxCoordinateAbsM = maxCoordinateAbs(input);
  const coordinatesFinite = Number.isFinite(maxCoordinateAbsM);
  checks.push({
    id: "coordinate-contract",
    status: !coordinatesFinite ? "fail" : maxCoordinateAbsM > 500 ? "review" : "pass",
    label: "좌표·단위 계약",
    message: !coordinatesFinite
      ? "로컬 좌표에 유효하지 않은 숫자가 포함되어 export할 수 없습니다."
      : maxCoordinateAbsM > 500
        ? `원점에서 ${maxCoordinateAbsM.toFixed(1)}m 이상 떨어진 객체가 포함됐습니다. 조회 범위와 좌표계를 확인해야 합니다.`
        : `동일 로컬 meter 좌표계 사용 · 최대 범위 ${maxCoordinateAbsM.toFixed(1)}m`,
  });

  const status: SiteDeliveryCheckStatus = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "review")
      ? "review"
      : "pass";

  return {
    version: SITE_DELIVERY_AUDIT_VERSION,
    status,
    exportable: !checks.some((check) => check.status === "fail"),
    checks,
    roadOverlapFloorIds,
    summary: {
      roadBoundaryCount: input.cadastral.roadParcels.length,
      verifiedWidthFrontageCount:
        input.cadastral.summary.verifiedWidthFrontageCount,
      widthSampleCount,
      totalContextBuildings: input.context.summary.totalBuildings,
      estimatedContextBuildings:
        input.context.summary.estimatedHeightBuildings,
      maxCoordinateAbsM,
    },
  };
}
