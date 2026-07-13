import type {
  ExistingBuildingGeometry,
  LngLat,
} from "@/lib/geo/existing-building-geometry";
import {
  parseBuildingFeatureCollection,
  type ExistingBuildingGeometryQuery,
} from "@/lib/integrations/vworld-buildings";

const KEY = process.env.VWORLD_API_KEY;
const DOMAIN = process.env.VWORLD_API_DOMAIN ?? "http://localhost:3000";
const ENDPOINTS = [
  "https://api.vworld.kr/ned/wfs/BldgisSpceService",
  "https://api.vworld.kr/req/wfs",
] as const;
const LAYER = "dt_d010";

function bboxForBoundary(
  boundary: LngLat[],
  center: { lat: number; lng: number }
): string {
  const points = boundary.length >= 3 ? boundary : ([[center.lng, center.lat]] as LngLat[]);
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
  return `${minLng - padLng},${minLat - padLat},${maxLng + padLng},${maxLat + padLat}`;
}

function buildUrl(endpoint: string, query: ExistingBuildingGeometryQuery): string {
  const url = new URL(endpoint);

  // BldgisSpceService에서 실제로 동작하는 요청 형식과 동일하게 구성한다.
  url.searchParams.set("SERVICE", "WFS");
  url.searchParams.set("REQUEST", "GetFeature");
  url.searchParams.set("VERSION", "1.1.0");
  url.searchParams.set("TYPENAME", LAYER);
  url.searchParams.set("SRSNAME", "EPSG:4326");
  url.searchParams.set("BBOX", bboxForBoundary(query.boundary, query.center));
  url.searchParams.set("MAXFEATURES", "50");
  url.searchParams.set("OUTPUT", "application/json");
  url.searchParams.set("KEY", KEY ?? "");
  url.searchParams.set("DOMAIN", DOMAIN);

  return url.toString();
}

function safeMessage(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, 180);
}

async function requestEndpoint(
  endpoint: string,
  query: ExistingBuildingGeometryQuery
): Promise<ExistingBuildingGeometry> {
  const response = await fetch(buildUrl(endpoint, query), {
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${safeMessage(text)}`);
  }

  // VWorld는 응답 본문이 JSON이어도 Content-Type이 일관되지 않을 수 있으므로
  // 헤더만 믿지 않고 실제 본문을 파싱한다.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response: ${safeMessage(text)}`);
  }

  const geometry = parseBuildingFeatureCollection(parsed, query);
  if (geometry.status === "matched") return geometry;

  // 정상 JSON이지만 결과가 없는 경우에도 다른 WFS 엔드포인트를 한 번 더 시도한다.
  return geometry;
}

export async function fetchExistingBuildingGeometryRuntime(
  query: ExistingBuildingGeometryQuery
): Promise<ExistingBuildingGeometry> {
  if (!KEY) throw new Error("VWORLD_API_KEY not set");

  const failures: string[] = [];
  let notFound: ExistingBuildingGeometry | null = null;

  for (const endpoint of ENDPOINTS) {
    try {
      const result = await requestEndpoint(endpoint, query);
      if (result.status === "matched") return result;
      notFound = result;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "unknown error");
    }
  }

  if (notFound) return notFound;
  throw new Error(`V-World building WFS failed: ${failures.join(" | ")}`);
}
