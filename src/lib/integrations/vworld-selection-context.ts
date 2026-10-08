import { area, bboxPolygon, booleanIntersects, booleanValid, kinks, pointOnFeature, polygon } from "@turf/turf";
import {
  contextFeatureSchema, SELECTION_CONTEXT_LIMIT, SELECTION_CONTEXT_RADIUS_M,
  type ContextFeature, type ContextLayer, type SelectionContext, type SelectionContextRequest,
} from "@/lib/parcels/selection-context";
import { buildExistingBuildingWfsUrl } from "./vworld-buildings-client";

type Dataset = "parcels" | "buildings";
type RecordValue = Record<string, unknown>;
const DATASET = { parcels: "LP_PA_CBND_BUBUN", buildings: "dt_d010" } as const;
const SOURCES = { parcels: "https://api.vworld.kr/req/data", buildings: "https://api.vworld.kr/ned/wfs/BldgisSpceService" };
const record = (v: unknown): RecordValue => v && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {};
const text = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
function prop(p: RecordValue, ...keys: string[]): unknown {
  for (const key of keys) if (p[key] != null || p[key.toUpperCase()] != null) return p[key] ?? p[key.toUpperCase()];
}

export function selectionContextBounds(center: SelectionContextRequest["center"]): [number, number, number, number] {
  const lat = SELECTION_CONTEXT_RADIUS_M / 111_000;
  const lng = lat / Math.cos(center.lat * Math.PI / 180);
  return [center.lng - lng, center.lat - lat, center.lng + lng, center.lat + lat];
}

export function emptyContextLayer(dataset: Dataset, status: ContextLayer["status"], message: string): ContextLayer {
  return { status, message, features: [], source: "VWorld", dataset: DATASET[dataset], sourceUrl: SOURCES[dataset],
    queriedAt: new Date().toISOString(), sourceUpdatedAt: null, crs: "EPSG:4326", radiusM: SELECTION_CONTEXT_RADIUS_M,
    receivedCount: 0, omittedCount: 0, limited: false };
}

/** Keep all rings/parts. A malformed hole must never silently become a filled polygon. */
function normalizeGeometry(value: unknown, allowAxisSwap: boolean): ContextFeature["polygons"] | null {
  const g = record(value);
  const parts = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;
  if (!Array.isArray(parts) || !parts.length || parts.length > 32) return null;
  const result: ContextFeature["polygons"] = [];
  for (const part of parts) {
    if (!Array.isArray(part) || !part.length || part.length > 32) return null;
    const rings: ContextFeature["polygons"][number] = [];
    for (const rawRing of part) {
      if (!Array.isArray(rawRing) || rawRing.length < 3 || rawRing.length > 1023) return null;
      const ring: [number, number][] = [];
      for (const c of rawRing) {
        if (!Array.isArray(c) || c.length < 2 || !c.slice(0, 2).every(n => typeof n === "number" && Number.isFinite(n))) return null;
        let [lng, lat] = c as number[];
        if (allowAxisSwap && lng >= 33 && lng <= 39.5 && lat >= 124 && lat <= 132) [lng, lat] = [lat, lng];
        if (lng < 124 || lng > 132 || lat < 33 || lat > 39.5) return null;
        ring.push([lng, lat]);
      }
      const first = ring[0], last = ring.at(-1)!;
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
      rings.push(ring);
    }
    try {
      const feature = polygon(rings);
      if (!booleanValid(feature) || area(feature) <= 0 || kinks(feature).features.length) return null;
    } catch { return null; }
    result.push(rings);
  }
  return result;
}

/** These are context outlines, never proof of parcel ownership or building absence. */
export function parseSelectionContextLayer(raw: unknown, dataset: Dataset, request: SelectionContextRequest): ContextLayer {
  let collection: RecordValue, declaredCount: unknown;
  if (dataset === "parcels") {
    const response = record(record(raw).response);
    if (response.status === "NOT_FOUND") return emptyContextLayer(dataset, "empty", "조회 범위에서 수신된 도형이 없습니다.");
    if (response.status !== "OK") throw new Error("Invalid cadastral context response");
    collection = record(record(response.result).featureCollection);
    declaredCount = record(response.record).total;
  } else {
    collection = record(raw);
    if (collection.type !== "FeatureCollection") throw new Error("Invalid building context response");
    declaredCount = collection.numberMatched ?? collection.totalFeatures;
  }
  if (!Array.isArray(collection.features)) throw new Error("Missing context features");
  const declaredCrs = text(record(record(collection.crs).properties).name);
  if (declaredCrs && !/(?:4326|CRS:?84)$/i.test(declaredCrs)) throw new Error("Unsupported context CRS");
  const received = collection.features;
  const bounds = bboxPolygon(selectionContextBounds(request.center));
  const features: ContextFeature[] = [];
  let omittedCount = 0;
  for (const [index, value] of received.slice(0, SELECTION_CONTEXT_LIMIT).entries()) {
    const f = record(value), p = record(f.properties);
    const pnuText = text(prop(p, "pnu"));
    const pnu = /^\d{19}$/.test(pnuText) ? pnuText : null;
    if (dataset === "parcels" && pnu === request.pnu) continue;
    const polygons = normalizeGeometry(f.geometry, dataset === "buildings");
    if (!polygons || (dataset === "parcels" && !pnu)) { omittedCount++; continue; }
    if (!polygons.some(rings => booleanIntersects(polygon(rings), bounds))) continue;
    const id = text(f.id || prop(p, "buld_idntfc_no", "gis_idntfc_no")) || `${DATASET[dataset]}-${pnu ?? "shape"}-${index}`;
    const label = dataset === "parcels" ? text(prop(p, "jibun")) || "지번 미제공" : text(prop(p, "buld_nm", "dong_nm")) || "건물 외곽";
    const labelPosition = pointOnFeature(polygon(polygons[0])).geometry.coordinates.slice(0, 2);
    const kind = dataset === "buildings" ? "building" : text(prop(p, "jimokName", "jimok")) === "도로" ? "road" : "parcel";
    const parsed = contextFeatureSchema.safeParse({ id: id.slice(0, 200), pnu, label: label.slice(0, 100), kind, polygons, labelPosition });
    if (!parsed.success) { omittedCount++; continue; }
    features.push(parsed.data);
  }
  const total = Number(declaredCount);
  const limited = received.length >= SELECTION_CONTEXT_LIMIT || (Number.isFinite(total) && total > received.length);
  const base = emptyContextLayer(dataset, limited || omittedCount ? "partial" : features.length ? "available" : "empty",
    limited || omittedCount ? "조회 상한 또는 해석하지 못한 도형이 있어 일부만 표시합니다." : features.length ? "조회 범위에서 수신한 도형입니다." : "조회 범위에서 수신된 도형이 없습니다.");
  return { ...base, features, receivedCount: received.length, omittedCount, limited };
}

export function splitCadastralContext(layer: ContextLayer): { parcels: ContextLayer; roads: ContextLayer } {
  const subset = (road: boolean): ContextLayer => {
    const features = layer.features.filter(f => (f.kind === "road") === road);
    const status = ["available", "empty"].includes(layer.status) ? features.length ? "available" : "empty" : layer.status;
    return { ...layer, features, status, message: status === "empty" ? `조회 범위에서 ${road ? "도로 필지" : "주변 필지"} 도형이 수신되지 않았습니다.` : layer.message };
  };
  return { parcels: subset(false), roads: subset(true) };
}

async function fetchLayer(dataset: Dataset, request: SelectionContextRequest, signal: AbortSignal): Promise<ContextLayer> {
  const url = dataset === "buildings"
    ? new URL(buildExistingBuildingWfsUrl({ pnu: request.pnu, boundary: [], center: request.center, contextRadiusM: SELECTION_CONTEXT_RADIUS_M }))
    : new URL(SOURCES.parcels);
  if (dataset === "parcels") {
    const params = { service: "data", request: "GetFeature", data: DATASET.parcels, key: process.env.VWORLD_API_KEY!,
      domain: process.env.VWORLD_API_DOMAIN ?? "http://localhost:3000", format: "json", size: String(SELECTION_CONTEXT_LIMIT),
      geomFilter: `BOX(${selectionContextBounds(request.center).join(",")})`, crs: "EPSG:4326", geometry: "true", attribute: "true" };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), cache: "no-store" });
  if (!response.ok) throw new Error(`Context upstream HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 4_000_000) throw new Error("Context response too large");
  return parseSelectionContextLayer(JSON.parse(body), dataset, request);
}

export async function fetchSelectionContext(request: SelectionContextRequest, signal: AbortSignal): Promise<SelectionContext> {
  const [cadastral, buildings] = await Promise.allSettled([fetchLayer("parcels", request, signal), fetchLayer("buildings", request, signal)]);
  const failed = (dataset: Dataset) => emptyContextLayer(dataset, "error", "조회하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.");
  const layers = splitCadastralContext(cadastral.status === "fulfilled" ? cadastral.value : failed("parcels"));
  return { ...request, layers: { ...layers, buildings: buildings.status === "fulfilled" ? buildings.value : failed("buildings") } };
}
