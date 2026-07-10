/**
 * Kakao REST API adapter — Geocoding.
 *
 * Address → coordinates + 행정구역 code resolution.
 *
 * Auth: header-based.
 *   Authorization: KakaoAK <REST_API_KEY>
 *
 * Endpoints:
 *   /v2/local/search/address.json  — keyword address search
 */

import { z } from "zod";

const KEY = process.env.KAKAO_REST_API_KEY;
const BASE = "https://dapi.kakao.com";

/* ─── Response shape (only fields we use) ──────────────────────────── */

const AddressDocSchema = z.object({
  address_name: z.string(),
  address_type: z.enum(["REGION", "ROAD", "REGION_ADDR", "ROAD_ADDR"]),
  x: z.string(),
  y: z.string(),
  address: z
    .object({
      address_name: z.string(),
      region_1depth_name: z.string(),
      region_2depth_name: z.string(),
      region_3depth_name: z.string(),
      region_3depth_h_name: z.string().optional(),
      h_code: z.string(),
      b_code: z.string(),
      mountain_yn: z.string(),
      main_address_no: z.string(),
      sub_address_no: z.string(),
    })
    .nullable(),
  road_address: z
    .object({
      address_name: z.string().optional(),
      region_1depth_name: z.string().optional(),
      region_2depth_name: z.string().optional(),
      region_3depth_name: z.string().optional(),
      road_name: z.string().optional(),
      underground_yn: z.string().optional(),
      main_building_no: z.string().optional(),
      sub_building_no: z.string().optional(),
      building_name: z.string().optional(),
      zone_no: z.string().optional(),
    })
    .nullable(),
});

const AddressSearchResponse = z.object({
  documents: z.array(AddressDocSchema),
  meta: z.object({
    total_count: z.number(),
    pageable_count: z.number(),
    is_end: z.boolean(),
  }),
});

/* ─── Public types ──────────────────────────────────────────────────── */

export interface GeocodeResult {
  address: string;
  roadAddress: string | null;
  lat: number;
  lng: number;
  bCode: string;
  lawdCd: string;
  sido: string;
  sigungu: string;
  dong: string;
  jibun: string | null;
  /** 본번 (예: "281"). 카카오 정확 지번 데이터 */
  mainAddressNo: string;
  /** 부번 (예: "23"). 부번 없으면 빈 문자열 */
  subAddressNo: string;
  /** 산 여부 ("Y" 산, "N" 일반) */
  mountainYn: "Y" | "N" | "";
}

/** 주소 자동완성 후보 */
export interface AddressSuggestion {
  /** lookup에 넘길 주소 (지번 우선) */
  address: string;
  roadAddress: string | null;
  sido: string;
  sigungu: string;
  dong: string;
}

type AddressDoc = z.infer<typeof AddressDocSchema>;

function parseAddressDoc(doc: AddressDoc): GeocodeResult {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const addr = doc.address;
  const road = doc.road_address;
  const bCode = addr?.b_code ?? "";
  const lawdCd = bCode.slice(0, 5);

  return {
    address: doc.address_name,
    roadAddress: road?.address_name ?? null,
    lat,
    lng,
    bCode,
    lawdCd,
    sido: addr?.region_1depth_name ?? "",
    sigungu: addr?.region_2depth_name ?? "",
    dong: addr?.region_3depth_name ?? "",
    jibun:
      addr && addr.main_address_no
        ? `${addr.main_address_no}${addr.sub_address_no ? `-${addr.sub_address_no}` : ""}`
        : null,
    mainAddressNo: addr?.main_address_no ?? "",
    subAddressNo: addr?.sub_address_no ?? "",
    mountainYn: (addr?.mountain_yn as "Y" | "N" | undefined) ?? "",
  };
}

async function fetchAddressDocuments(
  query: string,
  size: number
): Promise<AddressDoc[]> {
  if (!KEY) {
    throw new Error(
      "KAKAO_REST_API_KEY not set. Add it to .env.local."
    );
  }

  const url = new URL(`${BASE}/v2/local/search/address.json`);
  url.searchParams.set("query", query);
  url.searchParams.set("size", String(Math.min(Math.max(size, 1), 15)));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${KEY}` },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("KAKAO error body:", body);
    throw new Error(`Kakao geocode HTTP ${res.status}: ${body}`);
  }

  const raw = await res.json();
  const parsed = AddressSearchResponse.safeParse(raw);
  if (!parsed.success) {
    console.error("KAKAO parse error:", parsed.error.issues);
    throw new Error(
      `Kakao response shape unexpected: ${parsed.error.issues[0]?.message}`
    );
  }

  return parsed.data.documents;
}

/* ─── Public API ────────────────────────────────────────────────────── */

export async function geocodeAddress(
  query: string
): Promise<GeocodeResult | null> {
  const docs = await fetchAddressDocuments(query, 1);
  if (docs.length === 0) {
    console.log("KAKAO: no results for query:", query);
    return null;
  }
  return parseAddressDoc(docs[0]);
}

/** 주소 자동완성 — 입력 중 후보 목록 (지번·도로명) */
export async function searchAddressSuggestions(
  query: string,
  size = 10
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const docs = await fetchAddressDocuments(trimmed, size);
  return docs.map((doc) => {
    const parsed = parseAddressDoc(doc);
    return {
      address: parsed.address,
      roadAddress: parsed.roadAddress,
      sido: parsed.sido,
      sigungu: parsed.sigungu,
      dong: parsed.dong,
    };
  });
}

export async function lookupLawdCd(address: string): Promise<string | null> {
  const result = await geocodeAddress(address);
  return result?.lawdCd ?? null;
}

/* ─────────────────────────── 지하철역 검색 ─────────────────────────── */

export interface NearbyStation {
  /** 역명 (예: "쌍문역 4호선") */
  name: string;
  lat: number;
  lng: number;
  /** 대지에서 직선거리 (m) */
  distanceM: number;
}

/**
 * 좌표 기준 반경 내 지하철역 검색 (Kakao 카테고리 SW8).
 * 역세권 판단용 — 가까운 순 정렬.
 */
export async function searchNearbyStations(
  lat: number,
  lng: number,
  radiusM = 1000
): Promise<NearbyStation[]> {
  if (!KEY) {
    throw new Error("KAKAO_REST_API_KEY not set. Add it to .env.local.");
  }

  const url = new URL(`${BASE}/v2/local/search/category.json`);
  url.searchParams.set("category_group_code", "SW8"); // 지하철역
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("radius", String(Math.min(radiusM, 20000)));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", "5");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${KEY}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kakao station search HTTP ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    documents?: Array<{
      place_name: string;
      x: string;
      y: string;
      distance: string;
    }>;
  };

  return (data.documents ?? []).map((d) => ({
    name: d.place_name,
    lat: Number(d.y),
    lng: Number(d.x),
    distanceM: Number(d.distance),
  }));
}
