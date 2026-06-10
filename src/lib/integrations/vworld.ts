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
}

export async function lookupCadastral(
  lat: number,
  lng: number
): Promise<CadastralInfo | null> {
  if (!KEY) throw new Error("VWORLD_API_KEY not set");

  const buffer = 0.00005;
  const bbox = `${lng - buffer},${lat - buffer},${lng + buffer},${lat + buffer}`;

  const url = new URL(DATA_BASE);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LP_PA_CBND_BUBUN");
  url.searchParams.set("key", KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", "1");
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
  if (features.length === 0) return null;

  const f = features[0];
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

  const jigaRaw = props.jiga ?? "";
  const landPrice = jigaRaw ? parseInt(jigaRaw, 10) : 0;

  // NEW: jimok parsing
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
  };
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
