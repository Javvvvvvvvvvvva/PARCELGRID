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

/* ─── Public API ────────────────────────────────────────────────────── */

export async function geocodeAddress(
  query: string
): Promise<GeocodeResult | null> {
  if (!KEY) {
    throw new Error(
      "KAKAO_REST_API_KEY not set. Add it to .env.local."
    );
  }

  const url = new URL(`${BASE}/v2/local/search/address.json`);
  url.searchParams.set("query", query);
  url.searchParams.set("size", "1");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${KEY}` },
    signal: AbortSignal.timeout(8_000),
  });

  // Single diagnostic log line
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

  if (parsed.data.documents.length === 0) {
    console.log("KAKAO: no results for query:", query);
    return null;
  }

  const doc = parsed.data.documents[0];
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

export async function lookupLawdCd(address: string): Promise<string | null> {
  const result = await geocodeAddress(address);
  return result?.lawdCd ?? null;
}
