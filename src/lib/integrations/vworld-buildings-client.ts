import type { ExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";
import {
  parseBuildingFeatureCollection,
  type ExistingBuildingGeometryQuery,
} from "@/lib/integrations/vworld-buildings";

const KEY = process.env.VWORLD_API_KEY;
const DOMAIN = process.env.VWORLD_API_DOMAIN ?? "http://localhost:3000";
const WFS_URL = "https://api.vworld.kr/ned/wfs/BldgisSpceService";
const LAYER = "dt_d010";

function bboxForBoundary(
  boundary: ExistingBuildingGeometryQuery["boundary"],
  center: ExistingBuildingGeometryQuery["center"]
): string {
  const points =
    boundary.length >= 3
      ? boundary
      : ([[center.lng, center.lat]] as ExistingBuildingGeometryQuery["boundary"]);

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
  const lngScale = 111_000 * Math.cos((center.lat * Math.PI) / 180);
  const padLng = lngScale > 0 ? 12 / lngScale : padLat;

  // BldgisSpceService accepts the successful terminal-test form:
  // minLng,minLat,maxLng,maxLat. Do not append a CRS token here.
  return `${minLng - padLng},${minLat - padLat},${maxLng + padLng},${maxLat + padLat}`;
}

export function buildExistingBuildingWfsUrl(
  query: ExistingBuildingGeometryQuery
): string {
  if (!KEY) throw new Error("VWORLD_API_KEY not set");

  const url = new URL(WFS_URL);

  // This NED endpoint uses OUTPUT=application/json rather than the standard
  // outputFormat parameter. outputFormat is ignored and returns default GML.
  url.searchParams.set("SERVICE", "WFS");
  url.searchParams.set("REQUEST", "GetFeature");
  url.searchParams.set("VERSION", "1.1.0");
  url.searchParams.set("TYPENAME", LAYER);
  url.searchParams.set("SRSNAME", "EPSG:4326");
  url.searchParams.set("BBOX", bboxForBoundary(query.boundary, query.center));
  url.searchParams.set("MAXFEATURES", "50");
  url.searchParams.set("OUTPUT", "application/json");
  url.searchParams.set("KEY", KEY);
  url.searchParams.set("DOMAIN", DOMAIN);

  return url.toString();
}

export async function fetchExistingBuildingGeometry(
  query: ExistingBuildingGeometryQuery
): Promise<ExistingBuildingGeometry> {
  const response = await fetch(buildExistingBuildingWfsUrl(query), {
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`V-World building WFS HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  try {
    const parsed = JSON.parse(body) as unknown;
    return parseBuildingFeatureCollection(parsed, query);
  } catch {
    const responseKind = contentType || "unknown content-type";
    const isXml = body.trimStart().startsWith("<");
    throw new Error(
      `V-World building WFS returned ${isXml ? "XML/GML" : "non-JSON"} (${responseKind})`
    );
  }
}
