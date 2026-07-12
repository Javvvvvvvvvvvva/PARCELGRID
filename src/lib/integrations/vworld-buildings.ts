import type {
  BuildingInfo,
  BuildingLookupResult,
  RedevelopmentSignal,
} from "@/lib/integrations/molit-building";
import type {
  BuildingPolygon,
  ExistingBuildingFootprint,
  ExistingBuildingGeometry,
  LngLat,
  ViolationStatus,
} from "@/lib/geo/existing-building-geometry";

const KEY = process.env.VWORLD_API_KEY;
const DOMAIN = process.env.VWORLD_API_DOMAIN ?? "http://localhost:3000";
const WFS_URL = "https://api.vworld.kr/ned/wfs/BldgisSpceService";
const LAYER = "dt_d010";

interface RawBuildingFeature {
  id?: string;
  geometry?: {
    type?: "Polygon" | "MultiPolygon" | string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
}

interface RawFeatureCollection {
  type?: string;
  features?: RawBuildingFeature[];
  totalFeatures?: number | string;
  numberMatched?: number | string;
}

export interface ExistingBuildingGeometryQuery {
  pnu: string;
  boundary: LngLat[];
  center: { lat: number; lng: number };
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(asText(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePnu(value: unknown): string {
  return asText(value).replace(/\D/g, "");
}

function normalizeDate(value: unknown): string {
  const digits = asText(value).replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function normalizeViolationStatus(value: unknown): ViolationStatus {
  const raw = asText(value).toLowerCase();
  if (!raw) return "unknown";
  if (["y", "yes", "1", "true", "위반", "위반건축물"].includes(raw)) return "yes";
  if (["n", "no", "0", "false", "정상", "해당없음"].includes(raw)) return "no";
  return "unknown";
}

function distanceScore(point: LngLat, center: { lat: number; lng: number }): number {
  const dLat = (point[1] - center.lat) * 111_000;
  const dLng =
    (point[0] - center.lng) *
    111_000 *
    Math.cos((center.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function normalizeCoordinate(raw: unknown, center: { lat: number; lng: number }): LngLat | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const a = asNumber(raw[0]);
  const b = asNumber(raw[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const normal: LngLat = [a, b];
  const swapped: LngLat = [b, a];
  return distanceScore(normal, center) <= distanceScore(swapped, center) ? normal : swapped;
}

function normalizeRing(raw: unknown, center: { lat: number; lng: number }): LngLat[] {
  if (!Array.isArray(raw)) return [];
  const points = raw
    .map((point) => normalizeCoordinate(point, center))
    .filter((point): point is LngLat => point !== null);
  if (points.length < 3) return [];

  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push(first);
  return points.length >= 4 ? points : [];
}

function normalizePolygon(raw: unknown, center: { lat: number; lng: number }): BuildingPolygon {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((ring) => normalizeRing(ring, center))
    .filter((ring) => ring.length >= 4);
}

function normalizePolygons(
  geometry: RawBuildingFeature["geometry"],
  center: { lat: number; lng: number }
): BuildingPolygon[] {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Polygon") {
    const polygon = normalizePolygon(geometry.coordinates, center);
    return polygon.length > 0 ? [polygon] : [];
  }
  if (geometry.type === "MultiPolygon") {
    if (!Array.isArray(geometry.coordinates)) return [];
    return geometry.coordinates
      .map((polygon) => normalizePolygon(polygon, center))
      .filter((polygon) => polygon.length > 0);
  }
  return [];
}

function ringAreaSqm(ring: LngLat[]): number {
  if (ring.length < 4) return 0;
  const centerLat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const xScale = 111_000 * Math.cos((centerLat * Math.PI) / 180);
  const yScale = 111_000;
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    const [lng1, lat1] = ring[index];
    const [lng2, lat2] = ring[index + 1];
    twiceArea += lng1 * xScale * (lat2 * yScale) - lng2 * xScale * (lat1 * yScale);
  }
  return Math.abs(twiceArea) / 2;
}

function polygonsAreaSqm(polygons: BuildingPolygon[]): number {
  return polygons.reduce((total, polygon) => {
    if (polygon.length === 0) return total;
    const outer = ringAreaSqm(polygon[0]);
    const holes = polygon.slice(1).reduce((sum, ring) => sum + ringAreaSqm(ring), 0);
    return total + Math.max(0, outer - holes);
  }, 0);
}

function openRing(ring: LngLat[]): LngLat[] {
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  }
  return ring;
}

function pointInRing(point: LngLat, ring: LngLat[]): boolean {
  const open = openRing(ring);
  let inside = false;
  for (let i = 0, j = open.length - 1; i < open.length; j = i++) {
    const [xi, yi] = open[i];
    const [xj, yj] = open[j];
    const intersects =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function ringCentroid(ring: LngLat[]): LngLat {
  const open = openRing(ring);
  const sum = open.reduce(
    (acc, point) => ({ lng: acc.lng + point[0], lat: acc.lat + point[1] }),
    { lng: 0, lat: 0 }
  );
  return [sum.lng / open.length, sum.lat / open.length];
}

function footprintTouchesParcel(polygons: BuildingPolygon[], parcelBoundary: LngLat[]): boolean {
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    const centroid = ringCentroid(outer);
    if (pointInRing(centroid, parcelBoundary)) return true;
    if (outer.some((point) => pointInRing(point, parcelBoundary))) return true;
  }
  return false;
}

function property(props: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (props[key] != null && props[key] !== "") return props[key];
  }
  return undefined;
}

function parseFeature(
  feature: RawBuildingFeature,
  center: { lat: number; lng: number },
  matchMethod: "pnu" | "geometry"
): ExistingBuildingFootprint | null {
  const props = feature.properties ?? {};
  const polygons = normalizePolygons(feature.geometry, center);
  if (polygons.length === 0) return null;

  const calculatedArea = polygonsAreaSqm(polygons);
  const rawViolation = asText(property(props, "violt_bild", "VIOLT_BILD"));
  const pnu = normalizePnu(property(props, "pnu", "PNU"));
  const id =
    asText(property(props, "buld_idntfc_no", "gis_idntfc_no", "src_objectid")) ||
    feature.id ||
    `${pnu}-${Math.round(calculatedArea * 100)}`;

  return {
    id,
    pnu,
    buildingName: asText(property(props, "buld_nm", "dong_nm")),
    polygons,
    footprintAreaSqm:
      asNumber(property(props, "ar", "plot_ar")) || Math.round(calculatedArea * 100) / 100,
    totalAreaSqm: asNumber(property(props, "totar")),
    heightM: asNumber(property(props, "hg")),
    groundFloors: Math.max(0, Math.round(asNumber(property(props, "ground_floor_co")))),
    undergroundFloors: Math.max(
      0,
      Math.round(asNumber(property(props, "undgrnd_floor_co")))
    ),
    useApprovalDate: normalizeDate(property(props, "use_confm_de")),
    purposeCode: asText(property(props, "buld_prpos_code")),
    structureCode: asText(property(props, "strct_code")),
    violationStatus: normalizeViolationStatus(rawViolation),
    violationRaw: rawViolation,
    matchMethod,
    source: "vworld-dt_d010",
  };
}

export function parseBuildingFeatureCollection(
  raw: unknown,
  query: ExistingBuildingGeometryQuery
): ExistingBuildingGeometry {
  const collection = raw as RawFeatureCollection;
  const features = Array.isArray(collection?.features) ? collection.features : [];
  const normalizedTargetPnu = normalizePnu(query.pnu);

  const exact = features.filter(
    (feature) =>
      normalizePnu(property(feature.properties ?? {}, "pnu", "PNU")) === normalizedTargetPnu
  );
  const candidateFeatures = exact.length > 0 ? exact : features;
  const method = exact.length > 0 ? "pnu" : "geometry";

  const footprints = candidateFeatures
    .map((feature) => parseFeature(feature, query.center, method))
    .filter((footprint): footprint is ExistingBuildingFootprint => footprint !== null)
    .filter(
      (footprint) =>
        method === "pnu" || footprintTouchesParcel(footprint.polygons, query.boundary)
    )
    .sort((a, b) => b.footprintAreaSqm - a.footprintAreaSqm);

  return {
    source: "vworld-dt_d010",
    status: footprints.length > 0 ? "matched" : "not_found",
    footprints,
    queryFeatureCount: features.length,
  };
}

function bboxForBoundary(boundary: LngLat[], center: { lat: number; lng: number }): string {
  const points = boundary.length >= 3 ? boundary : [[center.lng, center.lat] as LngLat];
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  const padLat = 12 / 111_000;
  const padLng = 12 / (111_000 * Math.cos((center.lat * Math.PI) / 180));
  return `${minLng - padLng},${minLat - padLat},${maxLng + padLng},${maxLat + padLat},EPSG:4326`;
}

export async function fetchExistingBuildingGeometry(
  query: ExistingBuildingGeometryQuery
): Promise<ExistingBuildingGeometry> {
  if (!KEY) throw new Error("VWORLD_API_KEY not set");

  const url = new URL(WFS_URL);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("version", "1.1.0");
  url.searchParams.set("typeName", LAYER);
  url.searchParams.set("srsName", "EPSG:4326");
  url.searchParams.set("bbox", bboxForBoundary(query.boundary, query.center));
  url.searchParams.set("maxFeatures", "50");
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("key", KEY);
  url.searchParams.set("domain", DOMAIN);

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`V-World building WFS HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new Error("V-World building WFS returned a non-JSON response");
  }

  return parseBuildingFeatureCollection(await response.json(), query);
}

function ageFromApprovalDate(date: string): number {
  const year = Number.parseInt(date.slice(0, 4), 10);
  if (!Number.isFinite(year) || year < 1800) return 0;
  return Math.max(0, new Date().getFullYear() - year);
}

function redevelopmentSignalFromAge(age: number): RedevelopmentSignal {
  if (age >= 30) return "rebuild";
  if (age >= 15) return "renovate";
  return "keep";
}

function signalText(signal: RedevelopmentSignal, age: number): { label: string; reasoning: string } {
  if (signal === "rebuild") {
    return { label: "노후 건물 · 재건축 검토", reasoning: `${age}년 경과한 건물입니다.` };
  }
  if (signal === "renovate") {
    return { label: "리모델링·신축 비교", reasoning: `${age}년 경과한 건물입니다.` };
  }
  return { label: "기존 건물 유지 검토", reasoning: `${age}년 경과한 건물입니다.` };
}

export type BuildingLookupResultWithGeometry = BuildingLookupResult & {
  geometry: ExistingBuildingGeometry;
};

export function attachExistingBuildingGeometry(
  current: BuildingLookupResult | null,
  geometry: ExistingBuildingGeometry,
  lotAreaSqm: number
): BuildingLookupResultWithGeometry | null {
  if (current) return { ...current, geometry };
  if (geometry.status !== "matched" || geometry.footprints.length === 0) return null;

  const largestId = geometry.footprints[0]?.id;
  const buildings: BuildingInfo[] = geometry.footprints.map((footprint) => {
    const totalArea =
      footprint.totalAreaSqm ||
      footprint.footprintAreaSqm * Math.max(1, footprint.groundFloors);
    const ageYears = ageFromApprovalDate(footprint.useApprovalDate);
    return {
      name: footprint.buildingName,
      mainPurpose: "건축물",
      detailPurpose: "GIS건물통합정보",
      groundFloors: footprint.groundFloors || 1,
      undergroundFloors: footprint.undergroundFloors,
      totalArea,
      buildingArea: footprint.footprintAreaSqm,
      buildingCoverage:
        lotAreaSqm > 0 ? (footprint.footprintAreaSqm / lotAreaSqm) * 100 : 0,
      floorAreaRatio: lotAreaSqm > 0 ? (totalArea / lotAreaSqm) * 100 : 0,
      structure: footprint.structureCode
        ? `구조 코드 ${footprint.structureCode}`
        : "GIS 속성 미제공",
      height: footprint.heightM,
      approvalDate: footprint.useApprovalDate,
      ageYears,
      isMainBuilding: footprint.id === largestId,
      householdCount: 0,
      familyCount: 0,
      unitCount: 0,
    };
  });

  const ages = buildings.map((building) => building.ageYears).filter((age) => age > 0);
  const maxAgeYears = ages.length > 0 ? Math.max(...ages) : 0;
  const averageAgeYears =
    ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0;
  const dated = buildings
    .map((building) => building.approvalDate)
    .filter(Boolean)
    .sort();
  const signal = redevelopmentSignalFromAge(maxAgeYears);
  const text = signalText(signal, maxAgeYears);

  return {
    buildings,
    hasBuilding: true,
    totalBuildingArea: buildings.reduce((sum, building) => sum + building.totalArea, 0),
    oldestApprovalDate: dated[0] ?? "",
    maxAgeYears,
    averageAgeYears,
    redevelopmentSignal: signal,
    signalLabel: text.label,
    signalReasoning: text.reasoning,
    geometry,
  };
}
