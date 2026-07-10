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
 *   3. Polygon area calculation (Shoelace + lat/lng → m²)
 */

const KEY = process.env.VWORLD_API_KEY;
const DATA_BASE = "https://api.vworld.kr/req/data";
const NED_BASE = "https://api.vworld.kr/ned/data";

/* ─────────────────────────── XML helpers ─────────────────────────── */

function extractXmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

function extractXmlField(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

async function fetchText(url: string): Promise<string> {
  if (!KEY) throw new Error("VWORLD_API_KEY not set");
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`V-World HTTP ${res.status}`);
  return res.text();
}

/* ─────────────────────────── Area calculation ─────────────────────────── */

function polygonAreaSqm(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const R = 6_378_137;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    area +=
      ((lng2 - lng1) * Math.PI) / 180 *
      (2 +
        Math.sin((lat1 * Math.PI) / 180) +
        Math.sin((lat2 * Math.PI) / 180));
  }
  area = (area * R * R) / 2;
  return Math.abs(area);
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
  /** 부지 주변 도로 중심선 — 전면/측면/후면 식별용. 없으면 빈 배열 */
  roads: RoadLine[];
}

/** 도로 중심선 1개 (새주소도로 LT_L_SPRD) */
export interface RoadLine {
  /** 도로명 (예: "노해로41길") */
  name: string | null;
  /** 중심선 좌표 [lng, lat][] (WGS84) */
  points: [number, number][];
}

/**
 * 부지 주변 도로 중심선 조회 (LT_L_SPRD 새주소도로).
 * 전면 식별용 — 도로 폭은 이 레이어에 없음.
 */
async function fetchRoads(lat: number, lng: number): Promise<RoadLine[]> {
  if (!KEY) return [];
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
  url.searchParams.set("domain", "http://localhost:3000");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
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
      const geom = f.geometry;
      if (!geom) continue;
      // MultiLineString → 모든 점 평탄화
      let pts: [number, number][] = [];
      if (geom.type === "MultiLineString") {
        const co = geom.coordinates as number[][][];
        pts = co.flat() as [number, number][];
      } else if (geom.type === "LineString") {
        pts = geom.coordinates as [number, number][];
      }
      if (pts.length >= 2) roads.push({ name, points: pts });
    }
    return roads;
  } catch {
    return [];
  }
}

function normalizeLotNum(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "0") return "";
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) ? String(n) : trimmed;
}

function jibunMatchesHint(
  props: CadastralResponseFeature["properties"],
  hint?: CadastralMatchHint
): boolean {
  if (!hint?.mainAddressNo) return false;
  const bon = normalizeLotNum(props.bonbun);
  const bub = normalizeLotNum(props.bubun);
  const main = normalizeLotNum(hint.mainAddressNo);
  const sub = normalizeLotNum(hint.subAddressNo || "");
  if (bon !== main) return false;
  if (!sub) return !bub;
  return bub === sub;
}

function openRingCoords(ring: [number, number][]): [number, number][] {
  if (
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    return ring.slice(0, -1);
  }
  return ring;
}

function pointInPolygon(lng: number, lat: number, ring: [number, number][]): boolean {
  const open = openRingCoords(ring);
  let inside = false;
  for (let i = 0, j = open.length - 1; i < open.length; j = i++) {
    const [xi, yi] = open[i];
    const [xj, yj] = open[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringCentroidLngLat(ring: [number, number][]): { lat: number; lng: number } {
  const open = openRingCoords(ring);
  let lng = 0;
  let lat = 0;
  for (const [x, y] of open) {
    lng += x;
    lat += y;
  }
  return { lng: lng / open.length, lat: lat / open.length };
}

function selectBestCadastralFeature(
  features: CadastralResponseFeature[],
  lat: number,
  lng: number,
  hint?: CadastralMatchHint
): CadastralResponseFeature | null {
  if (features.length === 0) return null;

  type Scored = { f: CadastralResponseFeature; score: number };
  const scored: Scored[] = [];

  for (const f of features) {
    const parsed = parseCadastralFeature(f);
    if (!parsed) continue;

    let score = 0;
    if (jibunMatchesHint(f.properties, hint)) score += 1000;
    if (pointInPolygon(lng, lat, parsed.boundary)) score += 100;
    score -= distM(lat, lng, parsed.centroid.lat, parsed.centroid.lng) * 0.5;
    scored.push({ f, score });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].f;
}

async function featureToCadastralInfo(
  f: CadastralResponseFeature,
  roadsCenter: { lat: number; lng: number }
): Promise<CadastralInfo> {
  const props = f.properties;
  let ring: [number, number][] = [];
  if (f.geometry.type === "MultiPolygon") {
    const coords = f.geometry.coordinates as number[][][][];
    ring = (coords[0]?.[0] ?? []) as [number, number][];
  } else if (f.geometry.type === "Polygon") {
    const coords = f.geometry.coordinates as number[][][];
    ring = (coords[0] ?? []) as [number, number][];
  }
  const lotAreaSqm = ring.length >= 3 ? polygonAreaSqm(ring) : 0;
  const centroid = ringCentroidLngLat(ring);

  const jigaRaw = props.jiga ?? "";
  const landPrice = jigaRaw ? parseInt(jigaRaw, 10) : 0;
  const jimokName = props.jimokName ?? "";
  const jimokCode = props.jimokCd ?? "";

  return {
    pnu: props.pnu ?? "",
    jibun: props.jibun ?? "",
    address: props.addr ?? "",
    lotAreaSqm: Math.round(lotAreaSqm * 100) / 100,
    landPriceWonPerSqm: Number.isFinite(landPrice) ? landPrice : 0,
    landPriceYear: props.gosi_year ?? "",
    landPriceMonth: props.gosi_month ?? "",
    jimok: jimokName,
    jimokCode,
    jimokCategory: jimokToCategory(jimokName),
    boundary: ring,
    centroid,
    roads: await fetchRoads(roadsCenter.lat, roadsCenter.lng),
  };
}

export async function lookupCadastral(
  lat: number,
  lng: number,
  hint?: CadastralMatchHint
): Promise<CadastralInfo | null> {
  if (!KEY) throw new Error("VWORLD_API_KEY not set");

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
  url.searchParams.set("domain", "http://localhost:3000");

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`V-World HTTP ${res.status}`);

  const data = (await res.json()) as CadastralResponse;
  if (data.response.status === "ERROR") {
    throw new Error(
      `V-World error ${data.response.error?.code}: ${data.response.error?.text}`
    );
  }
  if (data.response.status === "NOT_FOUND") return null;

  const features = data.response.result?.featureCollection?.features ?? [];
  const best = selectBestCadastralFeature(features, lat, lng, hint);
  if (!best) return null;

  const parsed = parseCadastralFeature(best);
  if (!parsed) return null;

  return featureToCadastralInfo(best, parsed.centroid);
}

function parseCadastralFeature(f: CadastralResponseFeature): {
  pnu: string;
  jibun: string;
  lotAreaSqm: number;
  boundary: [number, number][];
  centroid: { lat: number; lng: number };
} | null {
  const props = f.properties;
  let ring: [number, number][] = [];
  if (f.geometry.type === "MultiPolygon") {
    const coords = f.geometry.coordinates as number[][][][];
    ring = (coords[0]?.[0] ?? []) as [number, number][];
  } else if (f.geometry.type === "Polygon") {
    const coords = f.geometry.coordinates as number[][][];
    ring = (coords[0] ?? []) as [number, number][];
  }
  if (ring.length < 3) return null;
  const lotAreaSqm = polygonAreaSqm(ring);
  let lng = 0;
  let lat = 0;
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return {
    pnu: props.pnu ?? "",
    jibun: props.jibun ?? "",
    lotAreaSqm: Math.round(lotAreaSqm * 100) / 100,
    boundary: ring,
    centroid: { lat: lat / n, lng: lng / n },
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
  options: { excludePnu?: string; radiusM?: number; maxCount?: number } = {}
): Promise<NearbyCadastralParcel[]> {
  if (!KEY) return [];
  const radiusM = options.radiusM ?? 75;
  const maxCount = options.maxCount ?? 14;
  const buf = radiusM / 111_000;
  const bbox = `${lng - buf},${lat - buf},${lng + buf},${lat + buf}`;

  const url = new URL(DATA_BASE);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LP_PA_CBND_BUBUN");
  url.searchParams.set("key", KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", String(Math.min(30, maxCount + 4)));
  url.searchParams.set("geomFilter", `BOX(${bbox})`);
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("domain", "http://localhost:3000");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as CadastralResponse;
    if (data.response.status !== "OK") return [];

    const features = data.response.result?.featureCollection?.features ?? [];
    const out: NearbyCadastralParcel[] = [];

    for (const f of features) {
      const parsed = parseCadastralFeature(f);
      if (!parsed || !parsed.pnu) continue;
      if (options.excludePnu && parsed.pnu === options.excludePnu) continue;
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

    return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, maxCount);
  } catch {
    return [];
  }
}

/* ─────────────────────────── 2. 용도지역 추출 (NED 토지이용계획) ─────────────────────────── */

export interface ZoningInfo {
  zoning: string;
  zoneCode: string;
  maxFAR: number;
  maxBCR: number;
  heightLimitM: number;
  overlays: Array<{ code: string; name: string; conflict: string }>;
}

const ZONE_RULES_BY_NAME: Record<
  string,
  { maxFAR: number; maxBCR: number; height: number }
> = {
  제1종전용주거지역: { maxFAR: 100, maxBCR: 50, height: 12 },
  제2종전용주거지역: { maxFAR: 150, maxBCR: 50, height: 16 },
  제1종일반주거지역: { maxFAR: 200, maxBCR: 60, height: 16 },
  제2종일반주거지역: { maxFAR: 250, maxBCR: 60, height: 22 },
  제3종일반주거지역: { maxFAR: 300, maxBCR: 50, height: 28 },
  준주거지역: { maxFAR: 500, maxBCR: 70, height: 50 },
  중심상업지역: { maxFAR: 1500, maxBCR: 90, height: 80 },
  일반상업지역: { maxFAR: 1300, maxBCR: 80, height: 70 },
  근린상업지역: { maxFAR: 900, maxBCR: 70, height: 50 },
  유통상업지역: { maxFAR: 1100, maxBCR: 80, height: 50 },
  전용공업지역: { maxFAR: 300, maxBCR: 70, height: 30 },
  일반공업지역: { maxFAR: 350, maxBCR: 70, height: 30 },
  준공업지역: { maxFAR: 400, maxBCR: 70, height: 40 },
  보전녹지지역: { maxFAR: 80, maxBCR: 20, height: 12 },
  생산녹지지역: { maxFAR: 100, maxBCR: 20, height: 12 },
  자연녹지지역: { maxFAR: 100, maxBCR: 20, height: 12 },
};

function isBaseZoneCode(code: string): boolean {
  if (!/^UQA[1-4]\d{2}$/.test(code)) return false;
  if (code === "UQA01X") return false;
  return true;
}

export async function lookupZoningByPNU(pnu: string): Promise<ZoningInfo> {
  if (!KEY) throw new Error("VWORLD_API_KEY not set");

  const url = new URL(`${NED_BASE}/getLandUseAttr`);
  url.searchParams.set("key", KEY);
  url.searchParams.set("pnu", pnu);
  url.searchParams.set("numOfRows", "30");
  url.searchParams.set("domain", "http://localhost:3000");

  const raw = await fetchText(url.toString());

  // V-World NED API responds with JSON (despite no _type=json param).
  // Parse it as JSON; structure is { landUses: { field: [...] } }.
  let fields: Array<Record<string, string>> = [];
  try {
    const parsed = JSON.parse(raw);
    fields = parsed?.landUses?.field ?? [];
    if (!Array.isArray(fields)) {
      // Single-field responses come back as object, not array
      fields = [fields as unknown as Record<string, string>];
    }
  } catch (err) {
    console.error("V-World NED parse failed:", err);
    fields = [];
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

  const rules = ZONE_RULES_BY_NAME[baseZoneName] ?? {
    maxFAR: 0,
    maxBCR: 0,
    height: 0,
  };

  return {
    zoning: baseZoneName,
    zoneCode: baseZoneCode,
    maxFAR: rules.maxFAR,
    maxBCR: rules.maxBCR,
    heightLimitM: rules.height,
    overlays,
  };
}
