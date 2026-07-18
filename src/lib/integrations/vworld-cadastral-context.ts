import type { CadastralParcelFeature } from "@/lib/geo/cadastral-context";

const KEY = process.env.VWORLD_API_KEY;
const DATA_BASE = "https://api.vworld.kr/req/data";
const DOMAIN = process.env.VWORLD_API_DOMAIN ?? "http://localhost:3000";

interface RawFeature {
  geometry?: {
    type?: "Polygon" | "MultiPolygon" | string;
    coordinates?: unknown;
  };
  properties?: {
    pnu?: string;
    jibun?: string;
    bonbun?: string;
    bubun?: string;
    jimokCd?: string;
    jimokName?: string;
  };
}

interface RawResponse {
  response?: {
    status?: "OK" | "NOT_FOUND" | "ERROR" | string;
    result?: {
      featureCollection?: {
        features?: RawFeature[];
      };
    };
  };
}

function openRing(ring: [number, number][]): [number, number][] {
  if (ring.length <= 1) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

function extractOuterRing(feature: RawFeature): [number, number][] {
  const geometry = feature.geometry;
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Polygon") {
    const polygons = geometry.coordinates as number[][][];
    return (polygons[0] ?? []) as [number, number][];
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates as number[][][][];
    return (polygons[0]?.[0] ?? []) as [number, number][];
  }
  return [];
}

function polygonAreaSqm(ring: [number, number][]): number {
  const points = openRing(ring);
  if (points.length < 3) return 0;
  const centerLat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const lngScale = 111_000 * Math.cos((centerLat * Math.PI) / 180);
  const latScale = 111_000;
  const origin = points[0];
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const currentX = (current[0] - origin[0]) * lngScale;
    const currentY = (current[1] - origin[1]) * latScale;
    const nextX = (next[0] - origin[0]) * lngScale;
    const nextY = (next[1] - origin[1]) * latScale;
    sum += currentX * nextY - nextX * currentY;
  }
  return Math.abs(sum) / 2;
}

function centroid(ring: [number, number][]): { lng: number; lat: number } | null {
  const points = openRing(ring);
  if (points.length < 3) return null;
  return {
    lng: points.reduce((sum, point) => sum + point[0], 0) / points.length,
    lat: points.reduce((sum, point) => sum + point[1], 0) / points.length,
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

function fallbackJibun(props: NonNullable<RawFeature["properties"]>): string {
  const bon = String(props.bonbun ?? "").replace(/^0+/, "");
  const bub = String(props.bubun ?? "").replace(/^0+/, "");
  return bub ? `${bon}-${bub}` : bon;
}

export async function fetchCadastralContextParcels(input: {
  center: { lng: number; lat: number };
  targetPnu: string;
  radiusM?: number;
  maxCount?: number;
}): Promise<CadastralParcelFeature[]> {
  if (!KEY) return [];
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

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`V-World cadastral context HTTP ${response.status}`);
  const raw = (await response.json()) as RawResponse;
  if (raw.response?.status !== "OK") return [];

  const features = raw.response.result?.featureCollection?.features ?? [];
  const parcels: CadastralParcelFeature[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    const props = feature.properties ?? {};
    const pnu = String(props.pnu ?? "").trim();
    if (!pnu || pnu === input.targetPnu || seen.has(pnu)) continue;
    const boundary = extractOuterRing(feature);
    const center = centroid(boundary);
    if (!center || boundary.length < 3) continue;
    const distance = distanceM(input.center, center);
    if (distance > radiusM * 1.35) continue;
    const area = polygonAreaSqm(boundary);
    if (!Number.isFinite(area) || area <= 0.5) continue;

    seen.add(pnu);
    parcels.push({
      pnu,
      jibun: String(props.jibun ?? "").trim() || fallbackJibun(props),
      jimok: String(props.jimokName ?? "").trim(),
      jimokCode: String(props.jimokCd ?? "").trim(),
      lotAreaSqm: Math.round(area * 100) / 100,
      boundary,
      distanceM: Math.round(distance * 10) / 10,
      boundarySource: "continuous-cadastral",
    });
  }

  return parcels
    .sort((a, b) => {
      const aRoad = a.jimok === "도로" ? 0 : 1;
      const bRoad = b.jimok === "도로" ? 0 : 1;
      return aRoad - bRoad || a.distanceM - b.distanceM;
    })
    .slice(0, maxCount);
}
