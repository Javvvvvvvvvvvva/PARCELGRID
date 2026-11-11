import type { CadastralParcelFeature } from "@/lib/geo/cadastral-context";
import { createProviderDeadline } from "@/lib/http/provider-deadline";
import { z } from "zod";
import { parseContextFeatureGeometry } from "./vworld-cadastral-context";
import { fetchVworldJson } from "./vworld-response";

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
        features?: unknown;
      };
    };
  };
}

function property(
  properties: Record<string, unknown>,
  ...keys: string[]
): unknown {
  let value: unknown;
  for (const key of keys) {
    for (const alias of new Set([key, key.toLowerCase(), key.toUpperCase()])) {
      const candidate = properties[alias];
      if (candidate == null) continue;
      if (value !== undefined && value !== candidate) throw new Error("V-World UPIS road property aliases conflict");
      value = candidate;
    }
  }
  return value;
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 500) throw new Error("V-World UPIS road text property invalid");
  return value.trim();
}

function numberValue(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim()))) {
    throw new Error("V-World UPIS road numeric property invalid");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    throw new Error("V-World UPIS road numeric property invalid");
  }
  return parsed;
}

const featuresSchema = z.array(z.object({
  geometry: z.unknown(),
  properties: z.record(z.string(), z.unknown()),
})).max(200);

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
  signal?: AbortSignal;
  outerDeadline?: number;
}): ParsedUpisRoadResult {
  const budget = createProviderDeadline(12_000, input.signal, input.outerDeadline);
  budget.check();
  const parsed = featuresSchema.safeParse(input.features);
  if (!parsed.success) throw new Error("V-World UPIS road features invalid");
  const candidates: Array<{ parcel: CadastralParcelFeature; summary: UpisRoadSummary }> = [];
  const seen = new Map<string, string>();

  for (const [index, feature] of parsed.data.entries()) {
    budget.check();
    const properties = feature.properties;
    const presentSn = text(property(properties, "present_sn", "PRESENT_SN"));
    if (!presentSn) throw new Error("V-World UPIS road identity missing");

    const label = text(property(properties, "dgm_nm", "DGM_NM"));
    const grade = text(property(properties, "grad_se", "GRAD_SE"));
    const roadType = text(property(properties, "road_ty", "ROAD_TY"));
    const roadNo = text(property(properties, "road_no", "ROAD_NO"));
    const roadRole = text(property(properties, "road_role", "ROAD_ROLE"));
    const executionCode = text(property(properties, "excut_se", "EXCUT_SE"));
    const declaredAreaSqm = numberValue(property(properties, "dgm_ar", "DGM_AR"));
    const declaredLengthM = numberValue(property(properties, "dgm_lt", "DGM_LT"));

    const signature = JSON.stringify(input.features[index]);
    const previous = seen.get(presentSn);
    if (previous !== undefined) {
      if (previous !== signature) throw new Error("V-World UPIS road duplicate identity conflict");
      continue;
    }
    seen.set(presentSn, signature);
    const geometry = parseContextFeatureGeometry(feature.geometry, input.center, budget.check);
    if (geometry.distanceM > input.radiusM * 1.6) continue;
    candidates.push({
      parcel: {
        // Keep the former first-part identifier while retaining the whole source feature.
        pnu: `UPIS-${presentSn}-1`,
        jibun: label || `${grade}${roadType ? ` ${roadType}류` : ""}`.trim() || "도시계획 도로",
        jimok: "도로",
        jimokCode: "UPIS-UQ151",
        ...geometry,
        boundary: geometry.boundary.slice(0, -1),
        boundarySource: "upis-planned-road",
      },
      summary: {
        presentSn,
        label,
        grade,
        roadType,
        roadNo,
        roadRole,
        executionCode,
        declaredAreaSqm,
        declaredLengthM,
        featurePartCount: geometry.polygons.length,
      },
    });
  }

  const selected = candidates.sort((a, b) => a.parcel.distanceM - b.parcel.distanceM).slice(0, input.maxCount);
  budget.check();
  return {
    parcels: selected.map(candidate => candidate.parcel),
    summaries: selected.map(candidate => candidate.summary),
  };
}

export async function fetchUpisRoadBoundaries(input: {
  center: { lng: number; lat: number };
  radiusM?: number;
  maxCount?: number;
  signal?: AbortSignal;
  outerDeadline?: number;
}): Promise<ParsedUpisRoadResult> {
  if (!KEY) return { parcels: [], summaries: [] };
  const budget = createProviderDeadline(12_000, input.signal, input.outerDeadline);
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

  const raw = (await fetchVworldJson(url.toString(), {
    envelope: "data", signal: budget.signal, outerDeadline: budget.deadline,
  })) as RawUpisRoadResponse;
  budget.check();
  if (raw.response?.status === "NOT_FOUND") return { parcels: [], summaries: [] };
  if (raw.response?.status !== "OK") throw new Error("V-World UPIS road response invalid");

  return parseUpisRoadFeatures({
    features: raw.response.result?.featureCollection?.features as RawUpisRoadFeature[],
    center: input.center,
    radiusM,
    maxCount,
    signal: budget.signal,
    outerDeadline: budget.deadline,
  });
}
