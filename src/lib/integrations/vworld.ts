import { createRegulatoryReferenceSet, VWORLD_LAND_USE_SOURCE_URL, type RegulatoryConstraintSet } from "@/lib/regulatory/constraints";
import { fetchVworldJson } from "./vworld-response";
import { vworldRuntimeState } from "@/lib/runtime/integration-mode";
import { vworldResultEvidence, vworldUnavailableEvidence, type VworldSourceEvidence } from "./vworld-evidence";
import { area, booleanPointInPolygon, centerOfMass, multiPolygon, point, polygon } from "@turf/turf";
import { z } from "zod";
import { createProviderDeadline } from "@/lib/http/provider-deadline";
import { projectPolygon } from "@/lib/geo/project-polygon";
import { polygonSelfIntersects } from "@/lib/planning/planning-geometry";

/**
 * V-World API adapter — verified against real API responses.
 *
 * UPDATED: now extracts jimok (지목) from the cadastral response.
 * This enables filtering MOLIT comparables to the same land-use category
 * (대지 / 임야 / 전 / 답 etc) so the user's commercial-lot parcel doesn't
 * get its price compared against forest-land transactions.
 *
 * Three sources of truth (unchanged):
 *
 *   1. 2D Data API: LP_PA_CBND_BUBUN (연속지적도)
 *      Single call returns: pnu, jibun, addr, bonbun/bubun, jiga,
 *      gosi_year/gosi_month, geometry (for area calc),
 *      AND jimokCd/jimokName (지목 코드 + 명칭).
 *
 *   2. NED API: getLandUseAttr (토지이용계획속성조회) — zoning overlays
 *
 *   3. Turf geodesic area from the full source polygon topology
 */

const KEY = process.env.VWORLD_API_KEY;
const DATA_BASE = "https://api.vworld.kr/req/data";
const NED_BASE = "https://api.vworld.kr/ned/data";

/* ─────────────────────────── Area calculation ─────────────────────────── */

export type CadastralPolygons = [number, number][][][];

export class CadastralGeometryError extends Error {
  constructor(readonly sourceGeometry: { pnu: string; polygons: CadastralPolygons; measuredAreaSqm: number }) {
    super("V-World parcel topology requires full geometry support");
  }
}

/* ─────────────────────────── Jimok (지목) classification ─────────────────────────── */

/**
 * 지목은 28가지가 있지만 시행 관점에서 4그룹으로 정리:
 *   buildable: 대(8), 잡종지(27) — 건축 가능, 시행 대상
 *   farmland:  전(1), 답(2), 과수원(3) — 농지, 농지전용 필요
 *   forest:    임야(5) — 산지, 산지전용/개발제한
 *   other:    그 외 (도로, 하천, 학교 등) — 거래 대상 아님
 *
 * 카테고리 결정은 시행사가 비교거래 평가할 때 핵심.
 * "대지 사려는데 임야 거래랑 비교하면 무의미" 문제를 풀어줍니다.
 */
export type JimokCategory = "buildable" | "farmland" | "forest" | "other";

export function jimokToCategory(jimokName: string): JimokCategory {
  if (!jimokName) return "other";
  const n = jimokName.trim();
  if (n === "대" || n === "잡종지") return "buildable";
  if (n === "전" || n === "답" || n === "과수원") return "farmland";
  if (n === "임야") return "forest";
  return "other";
}

export function jimokCategoryLabel(cat: JimokCategory): string {
  return cat === "buildable"
    ? "건축 가능 (대/잡종지)"
    : cat === "farmland"
      ? "농지 (전/답/과수원)"
      : cat === "forest"
        ? "임야"
        : "기타";
}

/* ─────────────────────────── 1. Cadastral ─────────────────────────── */

interface CadastralResponseFeature {
  geometry: {
    type: "MultiPolygon" | "Polygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    pnu?: string;
    jibun?: string;
    addr?: string;
    bonbun?: string;
    bubun?: string;
    jiga?: string;
    gosi_year?: string;
    gosi_month?: string;
    // V-World cadastral response includes these fields too — we now extract them
    jimokCd?: string;       // 지목 코드 (예: "08" for 대)
    jimokName?: string;     // 지목 명칭 (예: "대")
  };
}

interface CadastralResponse {
  response: {
    status: "OK" | "NOT_FOUND" | "ERROR";
    result?: {
      featureCollection?: {
        features: CadastralResponseFeature[];
      };
    };
    error?: { code: string; text: string };
  };
}

export interface CadastralMatchHint {
  pnu?: string;
  mainAddressNo?: string;
  subAddressNo?: string;
  mountainYn?: string;
}

export interface CadastralInfo {
  pnu: string;
  jibun: string;
  address: string;
  lotAreaSqm: number;
  landPriceWonPerSqm: number;
  landPriceYear: string;
  landPriceMonth: string;
  /** 지목 명칭 (예: "대", "임야", "전") */
  jimok: string;
  /** 지목 코드 (예: "08", "05") */
  jimokCode: string;
  /** 그룹 분류 (buildable / farmland / forest / other) */
  jimokCategory: JimokCategory;
  /** 필지 경계 폴리곤 [lng, lat][] (WGS84) — 3D 매싱·면적 계산용. 없으면 빈 배열 */
  boundary: [number, number][];
  /** 필지 중심 (지도 핀·3D 원점) */
  centroid: { lat: number; lng: number };
  /** 부지 주변 도로 중심선. 빈 배열의 조회 상태는 roadsEvidence로 구분한다. */
  roads: RoadLine[];
  roadsEvidence: VworldSourceEvidence;
  /** Full source topology, never a convex hull or selected polygon part. */
  polygons: CadastralPolygons;
}

/** 도로 중심선 1개 (새주소도로 LT_L_SPRD) */
export interface RoadLine {
  /** 도로명 (예: "노해로41길") */
  name: string | null;
  /** 중심선 좌표 [lng, lat][] (WGS84) */
  points: [number, number][];
  topology?: "source-part";
}

/**
 * 부지 주변 도로 중심선 조회 (LT_L_SPRD 새주소도로).
 * 전면 식별용 — 도로 폭은 이 레이어에 없음.
 */
async function fetchRoads(lat: number, lng: number, parent: { signal: AbortSignal; deadline: number }): Promise<{ roads: RoadLine[]; evidence: VworldSourceEvidence }> {
  const mode = vworldRuntimeState().mode;
  if (!KEY || mode !== "enabled") {
    return {
      roads: [],
      evidence: vworldUnavailableEvidence("LT_L_SPRD", mode === "disabled" ? "disabled" : "not-configured"),
    };
  }
  // 부지 주변 약 ±60m (도로까지 닿게)
  const buf = 0.0006;
  const bbox = `${lng - buf},${lat - buf},${lng + buf},${lat + buf}`;
  const url = new URL(DATA_BASE);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LT_L_SPRD");
  url.searchParams.set("key", KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", "30");
  url.searchParams.set("geomFilter", `BOX(${bbox})`);
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("domain", process.env.VWORLD_API_DOMAIN?.trim() || "http://localhost:3000");

  try {
    const data = (await fetchVworldJson(url.toString(), { timeoutMs: 10_000, envelope: "data", geometryKind: "line", signal: parent.signal, outerDeadline: parent.deadline })) as {
      response?: { result?: { featureCollection?: { features?: unknown[] } } };
    };
    const features = data.response?.result?.featureCollection?.features ?? [];
    const roads: RoadLine[] = [];
    for (const fRaw of features) {
      const f = fRaw as {
        geometry?: { type?: string; coordinates?: unknown };
        properties?: { rn?: string };
      };
      const name = f.properties?.rn ?? null;
      if (name !== null && typeof name !== "string") throw new Error("Invalid road name");
      const geom = f.geometry;
      if (!geom) continue;
      const parts = geom.type === "MultiLineString" ? geom.coordinates as number[][][]
        : geom.type === "LineString" ? [geom.coordinates as number[][]] : [];
      for (const part of parts) {
        const points = part.map(([lng, lat]) => [lng, lat] as [number, number]);
        if (points.length >= 2) roads.push({ name, points, topology: "source-part" });
      }
    }
    return { roads, evidence: vworldResultEvidence("LT_L_SPRD", roads.length) };
  } catch {
    return { roads: [], evidence: vworldUnavailableEvidence("LT_L_SPRD", "request-failed") };
  }
}

const optionalText = z.string().trim().max(500).optional();
const cadastralPropertiesSchema = z.object({
  pnu: z.string().regex(/^\d{10}[12]\d{8}$/),
  jibun: optionalText, addr: optionalText, bonbun: optionalText, bubun: optionalText,
  jiga: optionalText, gosi_year: optionalText, gosi_month: optionalText,
  jimokCd: optionalText, jimokName: optionalText,
});

function validatedCadastralProperties(feature: CadastralResponseFeature) {
  const result = cadastralPropertiesSchema.safeParse(feature.properties);
  if (!result.success) throw new Error("V-World cadastral properties invalid");
  const props = result.data;
  for (const [value, expected] of [[props.bonbun, props.pnu.slice(11, 15)], [props.bubun, props.pnu.slice(15)]] as const) {
    if (value && (!/^\d{1,4}$/.test(value) || Number(value) !== Number(expected))) throw new Error("V-World cadastral identity inconsistent");
  }
  if (props.jiga && (!/^\d+(?:\.\d+)?$/.test(props.jiga) || !Number.isFinite(Number(props.jiga)) || Number(props.jiga) > Number.MAX_SAFE_INTEGER)) throw new Error("V-World cadastral price invalid");
  return props;
}

function polygonsFromFeature(feature: CadastralResponseFeature): CadastralPolygons {
  const polygons = feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates as number[][][]] : feature.geometry.coordinates as number[][][][];
  return polygons.map(rings => rings.map(ring => ring.map(([lng, lat]) => [lng, lat])));
}

export class CadastralIdentityError extends Error {
  constructor() { super("V-World cadastral identity ambiguous"); }
}

function matchesHint(pnu: string, hint: CadastralMatchHint): boolean {
  if (hint.pnu) {
    if (!/^\d{10}[12]\d{8}$/.test(hint.pnu)) throw new Error("Invalid cadastral identity hint");
    return pnu === hint.pnu;
  }
  const main = hint.mainAddressNo?.trim() ?? "", sub = hint.subAddressNo?.trim() || "0";
  if (!/^\d{1,4}$/.test(main) || !/^\d{1,4}$/.test(sub) || !["Y", "N"].includes(hint.mountainYn ?? "")) throw new Error("Incomplete cadastral identity hint");
  return Number(pnu.slice(11, 15)) === Number(main) && Number(pnu.slice(15)) === Number(sub)
    && pnu[10] === (hint.mountainYn === "Y" ? "2" : "1");
}

function selectBestCadastralFeature(
  features: CadastralResponseFeature[],
  lat: number,
  lng: number,
  hint?: CadastralMatchHint
): CadastralResponseFeature | null {
  if (features.length === 0) return null;

  const candidates = features.filter(f => {
    const props = validatedCadastralProperties(f);
    if (hint?.pnu || hint?.mainAddressNo) return matchesHint(props.pnu, hint);
    return booleanPointInPolygon(point([lng, lat]), multiPolygon(polygonsFromFeature(f)));
  });
  if (candidates.length === 0) return null;
  const unique = new Map(candidates.map(f => [JSON.stringify(f), f]));
  if (unique.size !== 1) throw new CadastralIdentityError();
  return unique.values().next().value!;
}

async function featureToCadastralInfo(
  f: CadastralResponseFeature,
  parsed: ReturnType<typeof parseCadastralFeature>,
  budget: ReturnType<typeof createProviderDeadline>,
  includeRoads = true,
): Promise<CadastralInfo> {
  const props = validatedCadastralProperties(f);
  const landPrice = Number(props.jiga || 0);
  const jimokName = props.jimokName ?? "";
  const jimokCode = props.jimokCd ?? "";
  const roadResult = includeRoads ? await fetchRoads(parsed.centroid.lat, parsed.centroid.lng, budget)
    : { roads: [], evidence: vworldUnavailableEvidence("LT_L_SPRD", "not-recorded") };

  return {
    pnu: props.pnu ?? "",
    jibun: props.jibun ?? "",
    address: props.addr ?? "",
    lotAreaSqm: parsed.lotAreaSqm,
    landPriceWonPerSqm: Number.isFinite(landPrice) ? landPrice : 0,
    landPriceYear: props.gosi_year ?? "",
    landPriceMonth: props.gosi_month ?? "",
    jimok: jimokName,
    jimokCode,
    jimokCategory: jimokToCategory(jimokName),
    boundary: parsed.boundary,
    centroid: parsed.centroid,
    polygons: parsed.polygons,
    roads: roadResult.roads,
    roadsEvidence: roadResult.evidence,
  };
}

export async function lookupCadastral(
  lat: number,
  lng: number,
  hint?: CadastralMatchHint,
  options?: { includeRoads?: boolean },
): Promise<CadastralInfo | null> {
  const budget = createProviderDeadline(20_000);
  if (!KEY || vworldRuntimeState().mode !== "enabled") throw new Error("V-World integration unavailable");

  const buffer = 0.00008;
  const bbox = `${lng - buffer},${lat - buffer},${lng + buffer},${lat + buffer}`;

  const url = new URL(DATA_BASE);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LP_PA_CBND_BUBUN");
  url.searchParams.set("key", KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", "25");
  url.searchParams.set("geomFilter", `BOX(${bbox})`);
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("domain", process.env.VWORLD_API_DOMAIN?.trim() || "http://localhost:3000");

  const data = (await fetchVworldJson(url.toString(), { timeoutMs: 10_000, envelope: "data", signal: budget.signal, outerDeadline: budget.deadline })) as CadastralResponse;
  if (data.response.status === "ERROR") {
    throw new Error(
      "V-World provider error"
    );
  }
  if (data.response.status === "NOT_FOUND") return null;

  const features = data.response.result?.featureCollection?.features ?? [];
  const best = selectBestCadastralFeature(features, lat, lng, hint);
  budget.check();
  if (!best) return null;

  const parsed = parseCadastralFeature(best, budget.check);
  budget.check();
  return featureToCadastralInfo(best, parsed, budget, options?.includeRoads ?? true);
}

function parseCadastralFeature(f: CadastralResponseFeature, checkDeadline: () => void): {
  pnu: string;
  jibun: string;
  lotAreaSqm: number;
  boundary: [number, number][];
  polygons: CadastralPolygons;
  centroid: { lat: number; lng: number };
} {
  const props = validatedCadastralProperties(f);
  const polygons = polygonsFromFeature(f);
  const shape = multiPolygon(polygons);
  const lotAreaSqm = area(shape);
  if (!Number.isFinite(lotAreaSqm) || lotAreaSqm <= 0) throw new Error("V-World cadastral area invalid");
  if (polygons.length !== 1 || polygons[0].length !== 1) throw new CadastralGeometryError({ pnu: props.pnu, polygons, measuredAreaSqm: Math.round(lotAreaSqm * 100) / 100 });
  const ring = polygons[0][0];
  const projected = projectPolygon(ring);
  if (!projected) throw new Error("V-World cadastral boundary invalid");
  // Stop on the first crossing; never materialize every intersection from untrusted geometry.
  if (polygonSelfIntersects(projected.points.slice(0, -1).map(([x, z]) => ({ x, z })), checkDeadline)) {
    throw new Error("V-World cadastral boundary self-intersects");
  }
  const [lng, lat] = centerOfMass(polygon([ring])).geometry.coordinates;
  return {
    pnu: props.pnu ?? "",
    jibun: props.jibun ?? "",
    lotAreaSqm: Math.round(lotAreaSqm * 100) / 100,
    boundary: ring,
    polygons,
    centroid: { lat, lng },
  };
}

function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111_000;
  const dLng = (lng2 - lng1) * 111_000 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export interface NearbyCadastralParcel {
  pnu: string;
  jibun: string;
  lotAreaSqm: number;
  boundary: [number, number][];
  distanceM: number;
}

/**
 * 대상지 주변 연속지적 필지 (3D 맥락용).
 */
export async function fetchNearbyCadastralParcels(
  lat: number,
  lng: number,
  options: { excludePnu?: string; radiusM?: number; maxCount?: number; signal?: AbortSignal; outerDeadline?: number } = {}
): Promise<NearbyCadastralParcel[]> {
  const budget = createProviderDeadline(12_000, options.signal, options.outerDeadline);
  if (!KEY || vworldRuntimeState().mode !== "enabled") throw new Error("V-World integration unavailable");
  const radiusM = options.radiusM ?? 75;
  const maxCount = options.maxCount ?? 14;
  const latBuffer = radiusM / 111_000;
  const lngBuffer = latBuffer / Math.max(0.001, Math.cos(lat * Math.PI / 180));
  const bbox = `${lng - lngBuffer},${lat - latBuffer},${lng + lngBuffer},${lat + latBuffer}`;

  const url = new URL(DATA_BASE);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LP_PA_CBND_BUBUN");
  url.searchParams.set("key", KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", String(Math.min(30, maxCount + 4)));
  url.searchParams.set("geomFilter", `BOX(${bbox})`);
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("domain", process.env.VWORLD_API_DOMAIN?.trim() || "http://localhost:3000");

  const data = (await fetchVworldJson(url.toString(), { envelope: "data", signal: budget.signal, outerDeadline: budget.deadline })) as CadastralResponse;
  if (data.response.status === "NOT_FOUND") return [];

  const features = data.response.result?.featureCollection?.features ?? [];
  const out: NearbyCadastralParcel[] = [];

  for (const f of features) {
    budget.check();
    const props = validatedCadastralProperties(f);
    if (options.excludePnu && props.pnu === options.excludePnu) continue;
    const parsed = parseCadastralFeature(f, budget.check);
    const distanceM = distM(lat, lng, parsed.centroid.lat, parsed.centroid.lng);
    if (distanceM > radiusM) continue;
    out.push({
      pnu: parsed.pnu,
      jibun: parsed.jibun,
      lotAreaSqm: parsed.lotAreaSqm,
      boundary: parsed.boundary,
      distanceM: Math.round(distanceM),
    });
  }

  budget.check();
  return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, maxCount);
}

/* ─────────────────────────── 2. 용도지역 추출 (NED 토지이용계획) ─────────────────────────── */

export interface ZoningInfo {
  zoning: string;
  zoneCode: string;
  maxFAR: number;
  maxBCR: number;
  /** Legacy compatibility: no parcel-specific height was returned, therefore always 0. */
  heightLimitM: number;
  regulatoryConstraints: RegulatoryConstraintSet;
  overlays: Array<{ code: string; name: string; conflict: string }>;
}

/**
 * National Enforcement Decree ceiling references.
 *
 * These are not parcel-specific confirmed limits. Local ordinances,
 * district-unit plans and overlapping districts may impose lower values.
 */
const NATIONAL_ZONE_CEILINGS_BY_NAME: Record<
  string,
  { maxFAR: number; maxBCR: number }
> = {
  제1종전용주거지역: { maxFAR: 100, maxBCR: 50 },
  제2종전용주거지역: { maxFAR: 150, maxBCR: 50 },
  제1종일반주거지역: { maxFAR: 200, maxBCR: 60 },
  제2종일반주거지역: { maxFAR: 250, maxBCR: 60 },
  제3종일반주거지역: { maxFAR: 300, maxBCR: 50 },
  준주거지역: { maxFAR: 500, maxBCR: 70 },
  중심상업지역: { maxFAR: 1500, maxBCR: 90 },
  일반상업지역: { maxFAR: 1300, maxBCR: 80 },
  근린상업지역: { maxFAR: 900, maxBCR: 70 },
  유통상업지역: { maxFAR: 1100, maxBCR: 80 },
  전용공업지역: { maxFAR: 300, maxBCR: 70 },
  일반공업지역: { maxFAR: 350, maxBCR: 70 },
  준공업지역: { maxFAR: 400, maxBCR: 70 },
  보전녹지지역: { maxFAR: 80, maxBCR: 20 },
  생산녹지지역: { maxFAR: 100, maxBCR: 20 },
  자연녹지지역: { maxFAR: 100, maxBCR: 20 },
};

function isBaseZoneCode(code: string): boolean {
  if (!/^UQA[1-4]\d{2}$/.test(code)) return false;
  if (code === "UQA01X") return false;
  return true;
}

export async function lookupZoningByPNU(pnu: string): Promise<ZoningInfo> {
  if (!KEY || vworldRuntimeState().mode !== "enabled") throw new Error("V-World integration unavailable");

  const url = new URL(`${NED_BASE}/getLandUseAttr`);
  url.searchParams.set("key", KEY);
  url.searchParams.set("pnu", pnu);
  url.searchParams.set("numOfRows", "30");
  url.searchParams.set("domain", process.env.VWORLD_API_DOMAIN?.trim() || "http://localhost:3000");

  // V-World NED API responds with JSON (despite no _type=json param).
  // Parse it as JSON; structure is { landUses: { field: [...] } }.
  let fields: Array<Record<string, string>> = [];
  try {
    const parsed = await fetchVworldJson(url.toString(), { timeoutMs: 10_000, maxBytes: 1_048_576 }) as { landUses?: { field?: unknown } };
    if (!parsed?.landUses || !("field" in parsed.landUses)) throw new Error("Invalid zoning response");
    const rawFields = parsed.landUses.field ?? [];
    const list = Array.isArray(rawFields) ? rawFields : [rawFields];
    if (list.length > 100 || list.some(f => f === null || typeof f !== "object" || Array.isArray(f)
      || ["prposAreaDstrcCode", "prposAreaDstrcCodeNm", "cnflcAt"].some(key =>
        (f as Record<string, unknown>)[key] != null && typeof (f as Record<string, unknown>)[key] !== "string"))) {
      throw new Error("Invalid zoning response");
    }
    fields = list as Array<Record<string, string>>;
  } catch {
    throw new Error("VWorld 용도지역 응답 형식을 확인할 수 없습니다.");
  }

  const overlays: Array<{ code: string; name: string; conflict: string }> = [];
  let baseZoneName = "";
  let baseZoneCode = "";

  for (const f of fields) {
    const code = (f.prposAreaDstrcCode as string) ?? "";
    const name = (f.prposAreaDstrcCodeNm as string) ?? "";
    const conflict = (f.cnflcAt as string) ?? "";

    if (isBaseZoneCode(code) && !baseZoneCode) {
      baseZoneName = name;
      baseZoneCode = code;
    } else if (name && code !== "UQA01X") {
      overlays.push({ code, name, conflict });
    }
  }

  if (!baseZoneName || !baseZoneCode) throw new Error("VWorld 용도지역을 확인하지 못했습니다.");

  const rules = NATIONAL_ZONE_CEILINGS_BY_NAME[baseZoneName] ?? {
    maxFAR: 0,
    maxBCR: 0,
  };
  const retrievedAt = new Date().toISOString();
  const regulatoryConstraints = createRegulatoryReferenceSet({
    farPct: rules.maxFAR,
    bcrPct: rules.maxBCR,
    // VWorld getLandUseAttr returns land-use zone/district names, not a
    // parcel-specific legal maximum height. Never manufacture one here.
    heightM: null,
    floors: null,
    retrievedAt,
    zoningSourceName: "VWorld NED 토지이용계획속성조회",
    zoningSourceRef: VWORLD_LAND_USE_SOURCE_URL,
  });

  return {
    zoning: baseZoneName,
    zoneCode: baseZoneCode,
    maxFAR: rules.maxFAR,
    maxBCR: rules.maxBCR,
    heightLimitM: 0,
    regulatoryConstraints,
    overlays,
  };
}
