import type { CadastralParcelFeature } from "@/lib/geo/cadastral-context";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { validateLocalParcelTopology } from "@/lib/geo/parcel-topology-geometry";
import { createProviderDeadline } from "@/lib/http/provider-deadline";
import { planningRingToLocalMeters } from "@/lib/planning/planning-geometry";
import { area, multiPolygon, pointToPolygonDistance } from "@turf/turf";
import { z } from "zod";
import { fetchVworldJson } from "./vworld-response";

const KEY = process.env.VWORLD_API_KEY;
const DATA_BASE = "https://api.vworld.kr/req/data";
const DOMAIN = process.env.VWORLD_API_DOMAIN ?? "http://localhost:3000";

const optionalText = z.string().trim().max(500).optional();
const propertiesSchema = z.object({
  pnu: z.string().trim().regex(/^\d{10}[12]\d{8}$/),
  jibun: optionalText,
  bonbun: optionalText,
  bubun: optionalText,
  jimokCd: optionalText,
  jimokName: optionalText,
});
const featuresSchema = z.array(z.object({ geometry: z.unknown(), properties: propertiesSchema })).max(200);

interface RawResponse {
  response?: {
    status?: "OK" | "NOT_FOUND" | "ERROR" | string;
    result?: {
      featureCollection?: {
        features?: unknown;
      };
    };
  };
}

const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
const position = z.union([
  z.tuple([longitude, latitude]),
  z.tuple([longitude, latitude, z.number().finite()]),
]).transform(([lng, lat]): [number, number] => [lng, lat]);
const ringSchema = z.array(position).min(4).max(10_000).refine(ring => {
  const last = ring.at(-1);
  return last != null && ring[0][0] === last[0] && ring[0][1] === last[1];
});
const polygonSchema = z.array(ringSchema).min(1).max(100);
const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygonSchema }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygonSchema).min(1).max(200) }),
]);

// Shared by the two context providers; keep the source parts and holes intact.
export function parseContextFeatureGeometry(
  geometry: unknown,
  center: { lng: number; lat: number },
  checkDeadline: () => void,
): Pick<CadastralParcelFeature, "boundary" | "lotAreaSqm" | "distanceM"> & { polygons: Wgs84ParcelPolygon[] } {
  checkDeadline();
  const parsed = geometrySchema.safeParse(geometry);
  if (!parsed.success) throw new Error("V-World context geometry invalid");
  const coordinates = parsed.data.type === "Polygon" ? [parsed.data.coordinates] : parsed.data.coordinates;
  if (coordinates.reduce((sum, rings) => sum + rings.reduce((n, ring) => n + ring.length, 0), 0) > 10_000) {
    throw new Error("V-World context geometry vertex limit exceeded");
  }
  const polygons = coordinates.map(([outer, ...holes]) => ({ outer, holes }));
  const project = (ring: [number, number][]) => planningRingToLocalMeters(ring, [center.lng, center.lat]);
  if (!validateLocalParcelTopology(polygons.map(part => ({
    outer: project(part.outer), holes: part.holes.map(project),
  })), checkDeadline)) throw new Error("V-World context topology invalid");
  const shape = multiPolygon(coordinates);
  const measuredArea = area(shape);
  const distance = Math.max(0, pointToPolygonDistance([center.lng, center.lat], shape, { units: "meters" }));
  checkDeadline();
  if (!Number.isFinite(measuredArea) || measuredArea <= 0 || !Number.isFinite(distance)) {
    throw new Error("V-World context geometry measurement invalid");
  }
  return {
    polygons,
    boundary: polygons.length === 1 && polygons[0].holes.length === 0 ? polygons[0].outer : [],
    lotAreaSqm: Math.round(measuredArea * 100) / 100,
    distanceM: Math.round(distance * 10) / 10,
  };
}

function fallbackJibun(props: z.infer<typeof propertiesSchema>): string {
  const bon = String(props.bonbun ?? "").replace(/^0+/, "");
  const bub = String(props.bubun ?? "").replace(/^0+/, "");
  return bub ? `${bon}-${bub}` : bon;
}

export async function fetchCadastralContextParcels(input: {
  center: { lng: number; lat: number };
  targetPnu: string;
  radiusM?: number;
  maxCount?: number;
  signal?: AbortSignal;
  outerDeadline?: number;
}): Promise<CadastralParcelFeature[]> {
  if (!KEY) return [];
  const budget = createProviderDeadline(12_000, input.signal, input.outerDeadline);
  const radiusM = input.radiusM ?? 80;
  const maxCount = input.maxCount ?? 80;
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
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LP_PA_CBND_BUBUN");
  url.searchParams.set("key", KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", String(Math.min(100, Math.max(20, maxCount + 10))));
  url.searchParams.set("geomFilter", `BOX(${bbox})`);
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("domain", DOMAIN);

  const raw = (await fetchVworldJson(url.toString(), {
    envelope: "data", signal: budget.signal, outerDeadline: budget.deadline,
  })) as RawResponse;
  budget.check();
  if (raw.response?.status === "NOT_FOUND") return [];
  if (raw.response?.status !== "OK") throw new Error("V-World cadastral context response invalid");

  const sourceFeatures = raw.response.result?.featureCollection?.features;
  const result = featuresSchema.safeParse(sourceFeatures);
  if (!result.success) throw new Error("V-World cadastral context properties invalid");
  const parcels: CadastralParcelFeature[] = [];
  const seen = new Map<string, string>();

  for (const [index, feature] of result.data.entries()) {
    budget.check();
    const props = feature.properties;
    const pnu = props.pnu;
    for (const [value, expected] of [[props.bonbun, pnu.slice(11, 15)], [props.bubun, pnu.slice(15)]]) {
      if (value && (!/^\d{1,4}$/.test(value) || Number(value) !== Number(expected))) {
        throw new Error("V-World cadastral context identity inconsistent");
      }
    }
    const signature = JSON.stringify((sourceFeatures as unknown[])[index]);
    const previous = seen.get(pnu);
    if (previous !== undefined) {
      if (previous !== signature) throw new Error("V-World cadastral context duplicate identity conflict");
      continue;
    }
    seen.set(pnu, signature);
    const geometry = parseContextFeatureGeometry(feature.geometry, input.center, budget.check);
    if (pnu === input.targetPnu || geometry.distanceM > radiusM * 1.35) continue;

    parcels.push({
      pnu,
      jibun: String(props.jibun ?? "").trim() || fallbackJibun(props),
      jimok: String(props.jimokName ?? "").trim(),
      jimokCode: String(props.jimokCd ?? "").trim(),
      ...geometry,
      boundarySource: "continuous-cadastral",
    });
  }

  budget.check();
  return parcels
    .sort((a, b) => {
      const aRoad = a.jimok === "도로" ? 0 : 1;
      const bRoad = b.jimok === "도로" ? 0 : 1;
      return aRoad - bRoad || a.distanceM - b.distanceM;
    })
    .slice(0, maxCount);
}
