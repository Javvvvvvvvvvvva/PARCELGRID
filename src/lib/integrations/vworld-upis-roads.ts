import type { CadastralParcelFeature } from "@/lib/geo/cadastral-context";

const KEY = process.env.VWORLD_API_KEY;
const DATA_BASE = "https://api.vworld.kr/req/data";
const DOMAIN = process.env.VWORLD_API_DOMAIN ?? "http://localhost:3000";

export const VWORLD_UPIS_ROAD_DATA = "LT_C_UPISUQ151" as const;

interface RawUpisRoadFeature {
  geometry?: {
    type?: "Polygon" | "MultiPolygon" | string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
}

interface RawUpisRoadResponse {
  response?: {
    status?: "OK" | "NOT_FOUND" | "ERROR" | string;
    error?: { code?: string; text?: string };
    result?: {
      featureCollection?: {
        features?: RawUpisRoadFeature[];
      };
    };
  };
}

function property(
  properties: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (properties[key] != null) return properties[key];
    const lower = key.toLowerCase();
    if (properties[lower] != null) return properties[lower];
    const upper = key.toUpperCase();
    if (properties[upper] != null) return properties[upper];
  }
  return undefined;
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function openRing(ring: [number, number][]): [number, number][] {
  if (ring.length <= 1) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring;
}

function outerRings(feature: RawUpisRoadFeature): [number, number][][] {
  const geometry = feature.geometry;
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Polygon") {
    const coordinates = geometry.coordinates as number[][][];
    const ring = openRing((coordinates[0] ?? []) as [number, number][]);
    return ring.length >= 3 ? [ring] : [];
  }
  if (geometry.type === "MultiPolygon") {
    const coordinates = geometry.coordinates as number[][][][];
    return coordinates
      .map((polygon) => openRing((polygon[0] ?? []) as [number, number][]))
      .filter((ring) => ring.length >= 3);
  }
  return [];
}

function polygonAreaSqm(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const centerLat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const lngScale = 111_000 * Math.cos((centerLat * Math.PI) / 180);
  const origin = ring[0];
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const currentX = (current[0] - origin[0]) * lngScale;
    const currentY = (current[1] - origin[1]) * 111_000;
    const nextX = (next[0] - origin[0]) * lngScale;
    const nextY = (next[1] - origin[1]) * 111_000;
    sum += currentX * nextY - nextX * currentY;
  }
  return Math.abs(sum) / 2;
}

function centroid(ring: [number, number][]): { lng: number; lat: number } {
  return {
    lng: ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    lat: ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  };
}

function distanceM(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number }
): number {
  const latM = (b.lat - a.lat) * 111_000;
  const lngM =
    (b.lng - a.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(latM, lngM);
}

export interface UpisRoadSummary {
  presentSn: string;
  label: string;
  grade: string;
  roadType: string;
  roadNo: string;
  roadRole: string;
  executionCode: string;
  declaredAreaSqm: number;
  declaredLengthM: number;
  featurePartCount: number;
}

export interface ParsedUpisRoadResult {
  parcels: CadastralParcelFeature[];
  summaries: UpisRoadSummary[];
}

export function parseUpisRoadFeatures(input: {
  features: RawUpisRoadFeature[];
  center: { lng: number; lat: number };
  radiusM: number;
  maxCount: number;
}): ParsedUpisRoadResult {
  const parcels: CadastralParcelFeature[] = [];
  const summaries: UpisRoadSummary[] = [];
  const seen = new Set<string>();

  for (const feature of input.features) {
    const properties = feature.properties ?? {};
    const presentSn = text(property(properties, "present_sn", "PRESENT_SN"));
    if (!presentSn || seen.has(presentSn)) continue;
    const rings = outerRings(feature);
    if (rings.length === 0) continue;

    const label = text(property(properties, "dgm_nm", "DGM_NM"));
    const grade = text(property(properties, "grad_se", "GRAD_SE"));
    const roadType = text(property(properties, "road_ty", "ROAD_TY"));
    const roadNo = text(property(properties, "road_no", "ROAD_NO"));
    const roadRole = text(property(properties, "road_role", "ROAD_ROLE"));
    const executionCode = text(property(properties, "excut_se", "EXCUT_SE"));
    const declaredAreaSqm = numberValue(property(properties, "dgm_ar", "DGM_AR"));
    const declaredLengthM = numberValue(property(properties, "dgm_lt", "DGM_LT"));

    let acceptedParts = 0;
    rings.forEach((ring, partIndex) => {
      const ringCenter = centroid(ring);
      const distance = distanceM(input.center, ringCenter);
      if (distance > input.radiusM * 1.6) return;
      const measuredArea = polygonAreaSqm(ring);
      if (!Number.isFinite(measuredArea) || measuredArea <= 0.5) return;
      const id = `UPIS-${presentSn}-${partIndex + 1}`;
      parcels.push({
        pnu: id,
        jibun: label || `${grade}${roadType ? ` ${roadType}류` : ""}`.trim() || "도시계획 도로",
        jimok: "도로",
        jimokCode: "UPIS-UQ151",
        lotAreaSqm: Math.round(measuredArea * 100) / 100,
        boundary: ring,
        distanceM: Math.round(distance * 10) / 10,
        boundarySource: "upis-planned-road",
      });
      acceptedParts += 1;
    });

    if (acceptedParts > 0) {
      seen.add(presentSn);
      summaries.push({
        presentSn,
        label,
        grade,
        roadType,
        roadNo,
        roadRole,
        executionCode,
        declaredAreaSqm,
        declaredLengthM,
        featurePartCount: acceptedParts,
      });
    }
  }

  parcels.sort((a, b) => a.distanceM - b.distanceM);
  return {
    parcels: parcels.slice(0, input.maxCount),
    summaries,
  };
}

export async function fetchUpisRoadBoundaries(input: {
  center: { lng: number; lat: number };
  radiusM?: number;
  maxCount?: number;
}): Promise<ParsedUpisRoadResult> {
  if (!KEY) return { parcels: [], summaries: [] };
  const radiusM = input.radiusM ?? 120;
  const maxCount = input.maxCount ?? 40;
  const latBuffer = radiusM / 111_000;
  const lngScale = 111_000 * Math.cos((input.center.lat * Math.PI) / 180);
  const lngBuffer = lngScale > 0 ? radiusM / lngScale : latBuffer;
  const bbox = [
    input.center.lng - lngBuffer,
    input.center.lat - latBuffer,
    input.center.lng + lngBuffer,
    input.center.lat + latBuffer,
  ].join(",");

  const url = new URL(DATA_BASE);
  url.searchParams.set("service", "data");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", VWORLD_UPIS_ROAD_DATA);
  url.searchParams.set("key", KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", String(Math.min(200, Math.max(30, maxCount * 3))));
  url.searchParams.set("geomFilter", `BOX(${bbox})`);
  url.searchParams.set("geometry", "true");
  url.searchParams.set("attribute", "true");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("domain", DOMAIN);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`V-World UPIS road HTTP ${response.status}`);
  }
  const raw = (await response.json()) as RawUpisRoadResponse;
  if (raw.response?.status === "ERROR") {
    throw new Error(
      `V-World UPIS road ${raw.response.error?.code ?? "ERROR"}: ${
        raw.response.error?.text ?? "unknown error"
      }`
    );
  }
  if (raw.response?.status !== "OK") return { parcels: [], summaries: [] };

  return parseUpisRoadFeatures({
    features: raw.response.result?.featureCollection?.features ?? [],
    center: input.center,
    radiusM,
    maxCount,
  });
}
