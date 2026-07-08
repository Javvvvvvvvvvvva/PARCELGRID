/**
 * 국토교통부 실거래가 공개시스템 API adapter.
 *
 * UPDATED: jimok (지목) is now a first-class field on MolitTransaction.
 * Previously it was buried as a fallback for buildingName; now it's
 * exposed separately so the acquisition-check engine can filter
 * comparables by land-use category (대지 vs 임야 vs 전 etc).
 *
 * Critical fixes from earlier versions (kept):
 *   1. Must include User-Agent header — default fetch UA gets blocked
 *      by the data.go.kr WAF.
 *   2. Must use XML response — `_type=json` returns "400 Bad Request".
 *   3. Land transactions use `dealArea`, not `excluUseAr` (officetel).
 */

const SERVICE_KEY = process.env.MOLIT_SERVICE_KEY;

const ENDPOINTS = {
  officetel:
    "https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
  apartment:
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
  land:
    "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade",
  commercial:
    "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade",
  officeRent:
    "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
  aptRent:
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
  // 단독/다가구 매매 — 다가구 통매각 실거래 (연면적 totalFloorAr 기준 평당가)
  house:
    "https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade",
} as const;

export type PropertyType = keyof typeof ENDPOINTS;

export interface MolitTransaction {
  externalId: string;
  date: string;
  buildingName: string;
  lawdCd: string;
  dongName: string;
  jibun: string;
  exclusiveArea: number;
  priceManwon: number;
  floor: number;
  buildYear?: number;
  type: string;
  dealingGbn?: string;
  /** 지목 (land transactions only): "대", "임야", "전", "답", "잡종지", etc */
  jimok?: string;
  /** 주택유형 (house only): "단독" | "다가구" */
  houseType?: string;
  /** 대지면적 m2 (house only) — exclusiveArea에는 연면적(totalFloorAr)이 들어감 */
  plottageAr?: number;
}

export interface FetchOptions {
  lawdCd: string;
  dealYearMonth: string;
  page?: number;
  pageSize?: number;
  type?: PropertyType;
}

/* ─────────────────────────── XML parsing ─────────────────────────── */

function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function extractField(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

/* ─────────────────────────── Fetch ─────────────────────────── */

export async function fetchMolitTransactions(
  opts: FetchOptions
): Promise<MolitTransaction[]> {
  if (!SERVICE_KEY) {
    throw new Error(
      "MOLIT_SERVICE_KEY environment variable is not set."
    );
  }

  const type = opts.type ?? "officetel";
  const baseUrl = ENDPOINTS[type];

  const qs = new URLSearchParams({
    serviceKey: SERVICE_KEY,
    LAWD_CD: opts.lawdCd,
    DEAL_YMD: opts.dealYearMonth,
    pageNo: String(opts.page ?? 1),
    numOfRows: String(opts.pageSize ?? 100),
  });

  const res = await fetch(`${baseUrl}?${qs.toString()}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PARCELGRID/2.4; +https://parcelgrid.app)",
      Accept: "application/xml",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `MOLIT HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}`
    );
  }

  const xml = await res.text();

  const resultCode = extractField(xml, "resultCode");
  if (resultCode && resultCode !== "000" && resultCode !== "00") {
    const msg = extractField(xml, "resultMsg");
    throw new Error(`MOLIT API error ${resultCode}: ${msg}`);
  }

  const totalCount = extractField(xml, "totalCount");
  if (totalCount === "0") return [];

  const items = extractAll(xml, "item");
  return items.map((item) => parseTxn(item, opts.lawdCd, type));
}

/* ─────────────────────────── Field parsing ─────────────────────────── */

function parseTxn(
  item: string,
  lawdCd: string,
  type: PropertyType
): MolitTransaction {
  const str = (tag: string) => extractField(item, tag);
  const numFrom = (s: string) =>
    s ? Number(s.replace(/,/g, "").trim()) : NaN;

  const y = str("dealYear");
  const mRaw = str("dealMonth");
  const dRaw = str("dealDay");
  const m = mRaw ? mRaw.padStart(2, "0") : "01";
  const d = dRaw ? dRaw.padStart(2, "0") : "01";
  const date = y ? `${y}-${m}-${d}` : "";

  // For land transactions, jimok is its own field. Use it for building name display
  // since there's no building. For non-land, jimok is undefined.
  const jimok = type === "land" ? str("jimok") || undefined : undefined;

  const buildingName =
    str("offiNm") || str("aptNm") || str("bldgNm") || str("houseType") || jimok || "—";

  const jibun = str("jibun");
  const dongName = str("umdNm");

  const exclusiveArea =
    numFrom(str("excluUseAr")) ||
    numFrom(str("totalFloorAr")) || // 단독/다가구: 연면적 (통매각 평단가 기준)
    numFrom(str("dealArea")) ||
    numFrom(str("lndAr"));
  const priceManwon = numFrom(str("dealAmount"));
  const floor = numFrom(str("floor")) || 0;
  const buildYear = numFrom(str("buildYear")) || undefined;
  const dealingGbn = str("dealingGbn") || undefined;
  const houseType = str("houseType") || undefined;
  const plottageArV = numFrom(str("plottageAr")) || undefined;

  const externalId = [
    lawdCd,
    y,
    m,
    d,
    jibun,
    buildingName,
    Math.round(exclusiveArea * 100),
  ]
    .map((p) => String(p).replace(/[^\w가-힣]/g, ""))
    .join("-");

  const typeLabel =
    type === "house"
      ? "단독다가구"
      : type === "officetel"
      ? "오피스텔"
      : type === "apartment"
        ? "아파트"
        : type === "land"
          ? "토지"
          : type === "commercial"
            ? "상업업무용"
            : type === "officeRent"
              ? "오피스텔(임대)"
              : type === "aptRent"
                ? "아파트(임대)"
                : type;

  return {
    externalId,
    date,
    buildingName,
    lawdCd,
    dongName,
    jibun,
    exclusiveArea: Number.isFinite(exclusiveArea) ? exclusiveArea : 0,
    priceManwon: Number.isFinite(priceManwon) ? priceManwon : 0,
    floor: Number.isFinite(floor) ? floor : 0,
    buildYear,
    type: typeLabel,
    dealingGbn,
    jimok,
    houseType,
    plottageAr: plottageArV,
  };
}

/* ─────────────────────────── Range fetch ─────────────────────────── */

export async function fetchMolitRange(
  opts: Omit<FetchOptions, "dealYearMonth"> & {
    startYearMonth: string;
    endYearMonth: string;
  }
): Promise<MolitTransaction[]> {
  const months = monthsBetween(opts.startYearMonth, opts.endYearMonth);
  const all: MolitTransaction[] = [];
  for (const ym of months) {
    try {
      const page = await fetchMolitTransactions({ ...opts, dealYearMonth: ym });
      all.push(...page);
    } catch (err) {
      console.warn(`MOLIT ${ym} failed:`, err);
    }
  }
  return all;
}

function monthsBetween(startYM: string, endYM: string): string[] {
  const [sy, sm] = [parseInt(startYM.slice(0, 4)), parseInt(startYM.slice(4, 6))];
  const [ey, em] = [parseInt(endYM.slice(0, 4)), parseInt(endYM.slice(4, 6))];
  const out: string[] = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); ) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      y++;
      m = 1;
    }
  }
  return out;
}

/* ─────────────────────────── To-comp adapter ─────────────────────────── */

export function molitToComp(
  txn: MolitTransaction,
  targetCoords?: { lat: number; lng: number; lat0?: number; lng0?: number }
) {
  let dist = 0;
  if (targetCoords?.lat0 && targetCoords?.lng0) {
    dist = haversine(
      targetCoords.lat,
      targetCoords.lng,
      targetCoords.lat0,
      targetCoords.lng0
    );
  }

  const pricePerPyeong =
    txn.exclusiveArea > 0
      ? Math.round(txn.priceManwon / (txn.exclusiveArea * 0.3025))
      : 0;

  return {
    id: txn.externalId,
    date: txn.date,
    address: `${txn.dongName} ${txn.jibun}`,
    type: txn.type,
    area: 0,
    gfa: txn.exclusiveArea,
    price: txn.priceManwon,
    pricePerPyeong,
    far: 0,
    dist,
  };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
