import { projectPolygon } from "@/lib/geo/project-polygon";

export interface ParsedManualParcelBoundary {
  boundary: [number, number][];
  measuredAreaSqm: number;
  center: { lng: number; lat: number };
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function polygonGeometry(value: unknown): JsonRecord {
  const root = record(value);
  if (!root) throw new Error("GeoJSON 객체를 읽을 수 없습니다.");

  if (root.type === "Feature") {
    const geometry = record(root.geometry);
    if (!geometry) throw new Error("Feature에 geometry가 없습니다.");
    return geometry;
  }

  if (root.type === "FeatureCollection") {
    const features = Array.isArray(root.features) ? root.features : [];
    if (features.length !== 1) {
      throw new Error("필지 Polygon Feature 한 개만 포함한 GeoJSON이 필요합니다.");
    }
    return polygonGeometry(features[0]);
  }

  return root;
}

function outerRing(geometry: JsonRecord): unknown[] {
  if (geometry.type === "Polygon") {
    const coordinates = Array.isArray(geometry.coordinates)
      ? geometry.coordinates
      : [];
    if (coordinates.length === 0 || !Array.isArray(coordinates[0])) {
      throw new Error("Polygon 외곽선 좌표가 없습니다.");
    }
    if (coordinates.length !== 1) {
      throw new Error(
        "내부 구멍이 있는 Polygon은 현재 지원하지 않습니다. 단일 외곽선으로 정리하세요.",
      );
    }
    return coordinates[0] as unknown[];
  }

  if (geometry.type === "MultiPolygon") {
    const coordinates = Array.isArray(geometry.coordinates)
      ? geometry.coordinates
      : [];
    if (coordinates.length !== 1) {
      throw new Error(
        "여러 조각의 MultiPolygon은 현재 지원하지 않습니다. 대상 필지 한 개만 내보내세요.",
      );
    }
    const polygon = Array.isArray(coordinates[0]) ? coordinates[0] : [];
    if (polygon.length === 0 || !Array.isArray(polygon[0])) {
      throw new Error("MultiPolygon 외곽선 좌표가 없습니다.");
    }
    if (polygon.length !== 1) {
      throw new Error(
        "내부 구멍이 있는 MultiPolygon은 현재 지원하지 않습니다. 단일 외곽선으로 정리하세요.",
      );
    }
    return polygon[0] as unknown[];
  }

  throw new Error("GeoJSON geometry는 Polygon 또는 단일 MultiPolygon이어야 합니다.");
}

function coordinate(value: unknown, index: number): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${index + 1}번째 좌표가 [경도, 위도] 형식이 아닙니다.`);
  }
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`${index + 1}번째 좌표가 숫자가 아닙니다.`);
  }
  if (lng < 120 || lng > 135 || lat < 30 || lat > 40) {
    throw new Error(
      `${index + 1}번째 좌표가 국내 WGS84 [경도, 위도] 범위를 벗어났습니다.`,
    );
  }
  return [lng, lat];
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function cross(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

const SEGMENT_EPSILON = 1e-9;

function pointOnSegment(
  start: [number, number],
  point: [number, number],
  end: [number, number],
): boolean {
  return (
    point[0] >= Math.min(start[0], end[0]) - SEGMENT_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + SEGMENT_EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - SEGMENT_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + SEGMENT_EPSILON
  );
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  if (
    Math.max(a[0], b[0]) + SEGMENT_EPSILON < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) + SEGMENT_EPSILON < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) + SEGMENT_EPSILON < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) + SEGMENT_EPSILON < Math.min(a[1], b[1])
  ) {
    return false;
  }

  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);

  if (abC * abD < 0 && cdA * cdB < 0) return true;
  if (Math.abs(abC) <= SEGMENT_EPSILON && pointOnSegment(a, c, b)) return true;
  if (Math.abs(abD) <= SEGMENT_EPSILON && pointOnSegment(a, d, b)) return true;
  if (Math.abs(cdA) <= SEGMENT_EPSILON && pointOnSegment(c, a, d)) return true;
  return Math.abs(cdB) <= SEGMENT_EPSILON && pointOnSegment(c, b, d);
}

function selfIntersects(points: [number, number][]): boolean {
  const edgeCount = points.length - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    for (let j = i + 1; j < edgeCount; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === edgeCount - 1);
      if (adjacent) continue;
      if (segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

export function parseManualParcelBoundaryGeoJson(
  text: string,
): ParsedManualParcelBoundary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("GeoJSON 파일이 올바른 JSON 형식이 아닙니다.");
  }

  const ring = outerRing(polygonGeometry(parsed));
  if (ring.length < 3 || ring.length > 5_000) {
    throw new Error("필지 외곽선은 3개 이상 5,000개 이하 좌표여야 합니다.");
  }

  const normalized: [number, number][] = [];
  ring.forEach((item, index) => {
    const next = coordinate(item, index);
    if (!normalized.length || !samePoint(normalized[normalized.length - 1], next)) {
      normalized.push(next);
    }
  });
  if (normalized.length < 3) {
    throw new Error("서로 다른 필지 외곽선 좌표가 3개 이상 필요합니다.");
  }
  if (!samePoint(normalized[0], normalized[normalized.length - 1])) {
    normalized.push([...normalized[0]] as [number, number]);
  }

  const projected = projectPolygon(normalized);
  if (!projected) {
    throw new Error("필지 외곽선 면적을 계산할 수 없습니다.");
  }
  if (selfIntersects(projected.points)) {
    throw new Error("필지 외곽선이 서로 교차합니다. Polygon 좌표 순서를 확인하세요.");
  }
  if (projected.areaSqm < 1) {
    throw new Error("필지 외곽선 면적을 계산할 수 없습니다.");
  }
  if (projected.areaSqm > 100_000_000) {
    throw new Error("필지 외곽선 면적이 허용 범위를 초과합니다.");
  }

  return {
    boundary: normalized,
    measuredAreaSqm: Math.round(projected.areaSqm * 100) / 100,
    center: projected.center,
  };
}

export function boundaryAreaDifferencePct(
  officialAreaSqm: number,
  measuredAreaSqm: number,
): number | null {
  if (officialAreaSqm <= 0 || measuredAreaSqm <= 0) return null;
  return (Math.abs(measuredAreaSqm - officialAreaSqm) / officialAreaSqm) * 100;
}

export function boundaryCenterDistanceM(
  addressCenter: { lat: number; lng: number },
  boundaryCenter: { lat: number; lng: number },
): number {
  const dLat = (boundaryCenter.lat - addressCenter.lat) * 111_000;
  const dLng =
    (boundaryCenter.lng - addressCenter.lng) *
    111_000 *
    Math.cos((addressCenter.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}
