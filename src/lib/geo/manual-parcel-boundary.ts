import { validateJsonStructure } from "@/lib/http/bounded-json";
import { localParcelArea, validateLocalParcelTopology } from "@/lib/geo/parcel-topology-geometry";
import type { LocalParcelPolygon, ParcelBoundaryInput, Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";

export const PARCEL_BOUNDARY_INPUT_LIMITS = {
  maxBytes: 1_500_000,
  maxDepth: 16,
  maxNodes: 80_000,
  maxPoints: 10_000,
  maxPolygons: 200,
  validationTimeoutMs: 2_000,
} as const;

export interface ParsedManualParcelBoundary {
  boundary: [number, number][];
  polygons: Wgs84ParcelPolygon[];
  /** Approximate net area in the planning projection, not an official cadastral area. */
  measuredAreaSqm: number;
  /** Midpoint of the full bounds; may lie in a hole or between separate components. */
  center: { lng: number; lat: number };
}

interface BoundaryValidationOptions {
  signal?: AbortSignal;
  /** Absolute performance.now() deadline, shared with the caller's parsing work. */
  deadline?: number;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord) : null;
}

function validationBudget(options: BoundaryValidationOptions) {
  const localDeadline = performance.now() + PARCEL_BOUNDARY_INPUT_LIMITS.validationTimeoutMs;
  if (options.deadline !== undefined && !Number.isFinite(options.deadline)) {
    throw new Error("경계 검증 시간 제한이 올바르지 않습니다.");
  }
  const deadline = Math.min(options.deadline ?? localDeadline, localDeadline);
  const check = () => {
    if (options.signal?.aborted) throw new DOMException("경계 검증 요청이 취소되었습니다.", "AbortError");
    if (performance.now() >= deadline) throw new DOMException("경계 검증 시간 제한을 초과했습니다.", "TimeoutError");
  };
  check();
  return { deadline, check };
}

function polygonGeometry(value: unknown): JsonRecord {
  let root = record(value);
  if (!root) throw new Error("GeoJSON 객체를 읽을 수 없습니다.");
  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features) || root.features.length !== 1 || record(root.features[0])?.type !== "Feature") {
      throw new Error("필지 Polygon 또는 MultiPolygon Feature 한 개만 포함한 GeoJSON이 필요합니다.");
    }
    root = record(root.features[0])!;
  }
  if (root.type === "Feature") {
    const geometry = record(root.geometry);
    if (!geometry) throw new Error("Feature에 geometry가 없습니다.");
    return geometry;
  }
  return root;
}

function coordinate(value: unknown, allowElevation = false): [number, number] {
  if (!Array.isArray(value) || value.length < 2 || value.length > (allowElevation ? 3 : 2) ||
      value.some(item => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error("경계 좌표는 유한한 숫자의 WGS84 [경도, 위도] 형식이어야 합니다.");
  }
  const [lng, lat] = value as number[];
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    throw new Error("경계 좌표가 WGS84 [경도, 위도] 범위를 벗어났습니다.");
  }
  return [lng, lat];
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function unclosed(ring: [number, number][]): [number, number][] {
  return ring.length > 1 && samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
}

function sameRing(first: [number, number][], second: [number, number][]): boolean {
  const a = unclosed(first), b = unclosed(second);
  if (a.length !== b.length) return false;
  const start = b.findIndex(point => samePoint(a[0], point));
  return start >= 0 && [1, -1].some(direction =>
    a.every((point, index) => samePoint(point, b[(start + direction * index + b.length) % b.length])));
}

/** Shared by manual GeoJSON and the dynamic API. Never changes the supplied topology or legal facts. */
export function validateParcelBoundaryTopology(
  polygons: Wgs84ParcelPolygon[],
  options: BoundaryValidationOptions = {},
): Pick<ParsedManualParcelBoundary, "measuredAreaSqm" | "center"> {
  const { check } = validationBudget(options);
  if (!Array.isArray(polygons) || !polygons.length || polygons.length > PARCEL_BOUNDARY_INPUT_LIMITS.maxPolygons) {
    throw new Error("필지 경계는 1개 이상 200개 이하의 Polygon이어야 합니다.");
  }
  let pointCount = 0;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const part of polygons) {
    check();
    if (!part || !Array.isArray(part.outer) || !Array.isArray(part.holes) || part.holes.length > PARCEL_BOUNDARY_INPUT_LIMITS.maxPoints / 3) {
      throw new Error("필지 경계의 외곽선과 내부 제외 영역 형식이 올바르지 않습니다.");
    }
    for (const ring of [part.outer, ...part.holes]) {
      if (!Array.isArray(ring) || ring.length < 3) throw new Error("각 경계 링에는 좌표가 3개 이상 필요합니다.");
      pointCount += ring.length;
      if (pointCount > PARCEL_BOUNDARY_INPUT_LIMITS.maxPoints) throw new Error("필지 전체 경계는 10,000개 이하 좌표여야 합니다.");
      for (let i = 0; i < ring.length; i++) {
        if (i % 256 === 0) check();
        const [lng, lat] = coordinate(ring[i]);
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
    }
  }
  const center = { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
  const longitudeScale = 111_000 * Math.cos(center.lat * Math.PI / 180);
  const project = (ring: [number, number][]) => ring.map(([lng, lat]) => ({
    x: (lng - center.lng) * longitudeScale, z: -(lat - center.lat) * 111_000,
  }));
  const local: LocalParcelPolygon[] = polygons.map(part => ({ outer: project(part.outer), holes: part.holes.map(project) }));
  if (!validateLocalParcelTopology(local, check)) {
    throw new Error("필지 경계가 서로 교차하거나 내부 제외 영역·분리 조각의 위치가 올바르지 않습니다.");
  }
  check();
  const area = localParcelArea(local);
  if (!Number.isFinite(area) || area < 1 || area > 100_000_000) {
    throw new Error("필지 순면적이 허용 범위(1~100,000,000㎡)를 벗어났습니다.");
  }
  return { measuredAreaSqm: Math.round(area * 100) / 100, center };
}

/** Empty full topology is invalid, whereas absent legacy geometry remains explicitly unavailable. */
export function validateParcelBoundaryInput(
  input: ParcelBoundaryInput,
  options: BoundaryValidationOptions = {},
): ParcelBoundaryInput {
  const { deadline, check } = validationBudget(options);
  const validationOptions = { ...options, deadline };
  if (input.boundary !== undefined && !Array.isArray(input.boundary)) throw new Error("필지 경계 배열 형식이 올바르지 않습니다.");
  if (input.boundaryPolygons !== undefined) {
    const polygons = input.boundaryPolygons;
    validateParcelBoundaryTopology(polygons, validationOptions);
    const simple = polygons.length === 1 && polygons[0].holes.length === 0;
    if (input.boundary?.length) {
      if (!simple) throw new Error("복합 경계는 일부 외곽선을 legacy boundary로 제공할 수 없습니다.");
      if (input.boundary.length > PARCEL_BOUNDARY_INPUT_LIMITS.maxPoints) throw new Error("필지 전체 경계는 10,000개 이하 좌표여야 합니다.");
      input.boundary.forEach(point => coordinate(point));
      if (!sameRing(input.boundary, polygons[0].outer)) throw new Error("boundary와 boundaryPolygons의 경계가 일치하지 않습니다.");
    }
    check();
    return { boundaryPolygons: polygons, boundary: simple ? (input.boundary?.length ? input.boundary : polygons[0].outer) : [] };
  }
  if (input.boundary?.length) validateParcelBoundaryTopology([{ outer: input.boundary, holes: [] }], validationOptions);
  check();
  return input.boundary === undefined ? {} : { boundary: input.boundary };
}

export function parseManualParcelBoundaryGeoJson(
  text: string,
  options: BoundaryValidationOptions = {},
): ParsedManualParcelBoundary {
  const { deadline, check } = validationBudget(options);
  if (typeof text !== "string" || text.length > PARCEL_BOUNDARY_INPUT_LIMITS.maxBytes ||
      new TextEncoder().encode(text).byteLength > PARCEL_BOUNDARY_INPUT_LIMITS.maxBytes) {
    throw new Error("GeoJSON 파일이 허용 크기(1,500,000바이트)를 초과합니다.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("GeoJSON 파일이 올바른 JSON 형식이 아닙니다."); }
  check();
  const structure = validateJsonStructure(parsed, {
    maxDepth: PARCEL_BOUNDARY_INPUT_LIMITS.maxDepth, maxNodes: PARCEL_BOUNDARY_INPUT_LIMITS.maxNodes,
    deadline, signal: options.signal,
  });
  check();
  if (!structure.ok) throw new Error(structure.error);
  const geometry = polygonGeometry(parsed);
  const rawPolygons = geometry.type === "Polygon" ? [geometry.coordinates]
    : geometry.type === "MultiPolygon" ? geometry.coordinates : null;
  if (!Array.isArray(rawPolygons) || !rawPolygons.length || rawPolygons.length > PARCEL_BOUNDARY_INPUT_LIMITS.maxPolygons) {
    throw new Error("GeoJSON geometry는 1개 이상 200개 이하 조각의 Polygon 또는 MultiPolygon이어야 합니다.");
  }
  let pointCount = 0;
  const polygons: Wgs84ParcelPolygon[] = rawPolygons.map(raw => {
    check();
    if (!Array.isArray(raw) || !raw.length || raw.length > PARCEL_BOUNDARY_INPUT_LIMITS.maxPoints / 3) throw new Error("Polygon 경계 링 형식이 올바르지 않습니다.");
    const rings = raw.map(ring => {
      check();
      if (!Array.isArray(ring) || ring.length < 3) throw new Error("각 경계 링에는 좌표가 3개 이상 필요합니다.");
      pointCount += ring.length;
      if (pointCount > PARCEL_BOUNDARY_INPUT_LIMITS.maxPoints) throw new Error("필지 전체 경계는 10,000개 이하 좌표여야 합니다.");
      const points = ring.map(point => coordinate(point, true));
      if (!samePoint(points[0], points[points.length - 1])) {
        points.push([...points[0]]);
        if (++pointCount > PARCEL_BOUNDARY_INPUT_LIMITS.maxPoints) throw new Error("필지 전체 경계는 10,000개 이하 좌표여야 합니다.");
      }
      return points;
    });
    return { outer: rings[0], holes: rings.slice(1) };
  });
  const measured = validateParcelBoundaryTopology(polygons, { ...options, deadline });
  return {
    polygons,
    boundary: polygons.length === 1 && !polygons[0].holes.length ? polygons[0].outer : [],
    ...measured,
  };
}

export function boundaryAreaDifferencePct(officialAreaSqm: number, measuredAreaSqm: number): number | null {
  if (!Number.isFinite(officialAreaSqm) || !Number.isFinite(measuredAreaSqm) || officialAreaSqm <= 0 || measuredAreaSqm <= 0) return null;
  return (Math.abs(measuredAreaSqm - officialAreaSqm) / officialAreaSqm) * 100;
}

export function boundaryCenterDistanceM(
  addressCenter: { lat: number; lng: number },
  boundaryCenter: { lat: number; lng: number },
): number {
  const dLat = (boundaryCenter.lat - addressCenter.lat) * 111_000;
  const dLng = (boundaryCenter.lng - addressCenter.lng) * 111_000 * Math.cos((addressCenter.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}
