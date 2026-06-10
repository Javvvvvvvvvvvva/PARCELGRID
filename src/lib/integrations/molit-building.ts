/**
 * 국토교통부 건축물대장 API adapter.
 *
 * 부지의 현재 건물 상태를 가져와서 시행 의사결정에 활용:
 *   - 빈 땅 → 즉시 신축 시행 가능
 *   - 30년+ 노후 → 재건축 검토
 *   - 15-30년 → 리모델링 검토
 *   - 15년 미만 → 시행 부적합 (이미 신축)
 *
 * Required key: MOLIT_SERVICE_KEY (data.go.kr).
 * 같은 키를 실거래가 API에도 사용. 별도 신청 불필요한 경우 많음.
 *
 * Endpoint: 건축물대장 표제부 (getBrTitleInfo)
 *   같은 부지에 여러 동 있을 수 있음 — 모든 동 반환.
 */

const SERVICE_KEY = process.env.MOLIT_SERVICE_KEY;

const ENDPOINT =
  "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";

export type RedevelopmentSignal = "vacant" | "rebuild" | "renovate" | "keep";

export interface BuildingInfo {
  /** 동 이름. 없으면 빈 문자열 (단독주택 등) */
  name: string;
  /** 주용도 (단독주택, 업무시설, 공동주택 등) */
  mainPurpose: string;
  /** 세부 용도 (다가구주택, 오피스텔 등) */
  detailPurpose: string;
  /** 지상 층수 */
  groundFloors: number;
  /** 지하 층수 */
  undergroundFloors: number;
  /** 연면적 (m²) */
  totalArea: number;
  /** 건축면적 (m²) */
  buildingArea: number;
  /** 건폐율 (%) */
  buildingCoverage: number;
  /** 용적률 (%) */
  floorAreaRatio: number;
  /** 구조 (철근콘크리트, 조적조 등) */
  structure: string;
  /** 높이 (m). 없으면 0 */
  height: number;
  /** 사용승인일 (YYYY-MM-DD 형식) */
  approvalDate: string;
  /** 노후 연수 (사용승인일 기준) */
  ageYears: number;
  /** 주건축물 여부 (부속건물 아닌 본 건물) */
  isMainBuilding: boolean;
}

export interface PnuParts {
  sigunguCd: string;  // 5자리
  bjdongCd: string;   // 5자리
  platGbCd: string;   // "0" 일반, "1" 산
  bun: string;        // 4자리
  ji: string;         // 4자리
}

export interface BuildingLookupResult {
  buildings: BuildingInfo[];
  /** 건물 있는가 */
  hasBuilding: boolean;
  /** 모든 동 연면적 합계 (m²) */
  totalBuildingArea: number;
  /** 가장 오래된 사용승인일 */
  oldestApprovalDate: string;
  /** 가장 오래된 건물의 노후 연수 */
  maxAgeYears: number;
  /** 평균 노후 연수 */
  averageAgeYears: number;
  /** 의사결정 시그널 */
  redevelopmentSignal: RedevelopmentSignal;
  /** 사람이 읽을 수 있는 시그널 라벨 */
  signalLabel: string;
  /** 시그널 설명 */
  signalReasoning: string;
}

/* ─────────────────────────── PNU helpers ─────────────────────────── */

/**
 * Decompose 19-digit PNU into building-registry query parts.
 *
 * PNU structure: [시군구5][법정동5][특수1][본번4][부번4]
 *   특수 1자리: 1 = 일반, 2 = 산
 *
 * MOLIT API uses platGbCd: 0 = 일반, 1 = 산.
 */
export function pnuToBuildingQuery(pnu: string): PnuParts | null {
  if (!/^\d{19}$/.test(pnu)) return null;
  const special = pnu.slice(10, 11);
  return {
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    platGbCd: special === "2" ? "1" : "0",
    bun: pnu.slice(11, 15),
    ji: pnu.slice(15, 19),
  };
}

/**
 * Build query directly from Kakao's exact 지번 data — bypasses V-World
 * coordinate-based matching which can return adjacent parcels for small lots.
 *
 *   bCode (10): [시군구5][법정동5]
 *   mainAddressNo: 본번 (e.g. "281")
 *   subAddressNo:  부번 (e.g. "23"). Empty if none.
 *   mountainYn:    "Y"=산, "N"=일반
 */
export function geocodeToBuildingQuery(
  bCode: string,
  mainAddressNo: string,
  subAddressNo: string,
  mountainYn: string
): PnuParts | null {
  if (!/^\d{10}$/.test(bCode)) return null;
  if (!mainAddressNo) return null;
  return {
    sigunguCd: bCode.slice(0, 5),
    bjdongCd: bCode.slice(5, 10),
    platGbCd: mountainYn === "Y" ? "1" : "0",
    bun: mainAddressNo.padStart(4, "0"),
    ji: (subAddressNo || "0").padStart(4, "0"),
  };
}

/* ─────────────────────────── XML helpers ─────────────────────────── */

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

function parseDate(yyyymmdd: string): string {
  const s = yyyymmdd.trim();
  if (s.length !== 8) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function yearsSince(dateStr: string): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

/* ─────────────────────────── Signal computation ─────────────────────────── */

function computeSignal(
  buildings: BuildingInfo[]
): Pick<BuildingLookupResult, "redevelopmentSignal" | "signalLabel" | "signalReasoning"> {
  if (buildings.length === 0) {
    return {
      redevelopmentSignal: "vacant",
      signalLabel: "빈 토지",
      signalReasoning: "현재 건물이 없어 즉시 신축 시행 가능합니다.",
    };
  }

  // 가장 오래된 건물 기준으로 판단
  const oldestAge = Math.max(...buildings.map((b) => b.ageYears));

  if (oldestAge >= 30) {
    return {
      redevelopmentSignal: "rebuild",
      signalLabel: "재건축 검토",
      signalReasoning: `가장 오래된 건물 ${oldestAge}년 노후 — 철거 후 신축 시행 적합.`,
    };
  }

  if (oldestAge >= 15) {
    return {
      redevelopmentSignal: "renovate",
      signalLabel: "리모델링 검토",
      signalReasoning: `${oldestAge}년 노후 — 리모델링 또는 운영 유지가 일반적.`,
    };
  }

  return {
    redevelopmentSignal: "keep",
    signalLabel: "신축 (유지 권장)",
    signalReasoning: `${oldestAge}년 노후 — 시행 부적합. 이미 신축 상태.`,
  };
}

/* ─────────────────────────── Main fetcher ─────────────────────────── */

/**
 * Internal: fetch building registry given pre-computed parts.
 */
async function lookupBuildingByParts(
  parts: PnuParts
): Promise<BuildingLookupResult | null> {
  if (!SERVICE_KEY) {
    throw new Error("MOLIT_SERVICE_KEY environment variable is not set.");
  }

  const qs = new URLSearchParams({
    serviceKey: SERVICE_KEY,
    sigunguCd: parts.sigunguCd,
    bjdongCd: parts.bjdongCd,
    platGbCd: parts.platGbCd,
    bun: parts.bun,
    ji: parts.ji,
    numOfRows: "30",
    pageNo: "1",
  });

  const res = await fetch(`${ENDPOINT}?${qs.toString()}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PARCELGRID/2.4; +https://parcelgrid.app)",
      Accept: "application/xml",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`MOLIT building HTTP ${res.status}`);
  }

  const xml = await res.text();

  const resultCode = extractField(xml, "resultCode");
  if (resultCode && resultCode !== "00" && resultCode !== "000") {
    const msg = extractField(xml, "resultMsg");
    throw new Error(`MOLIT building error ${resultCode}: ${msg}`);
  }

  const totalCount = parseInt(extractField(xml, "totalCount") || "0", 10);

  // 빈 땅
  if (totalCount === 0) {
    const sig = computeSignal([]);
    return {
      buildings: [],
      hasBuilding: false,
      totalBuildingArea: 0,
      oldestApprovalDate: "",
      maxAgeYears: 0,
      averageAgeYears: 0,
      ...sig,
    };
  }

  // 각 동(棟) 파싱
  const items = extractAll(xml, "item");
  const buildings: BuildingInfo[] = items.map((item) => parseBuilding(item));

  // 주건축물 우선 정렬
  buildings.sort((a, b) => {
    if (a.isMainBuilding && !b.isMainBuilding) return -1;
    if (!a.isMainBuilding && b.isMainBuilding) return 1;
    return b.totalArea - a.totalArea; // 큰 동부터
  });

  // 집계
  const totalBuildingArea = buildings.reduce((sum, b) => sum + b.totalArea, 0);
  const approvalDates = buildings.map((b) => b.approvalDate).filter(Boolean);
  approvalDates.sort();
  const oldestApprovalDate = approvalDates[0] || "";
  const ages = buildings.map((b) => b.ageYears).filter((a) => a > 0);
  const maxAgeYears = ages.length > 0 ? Math.max(...ages) : 0;
  const averageAgeYears =
    ages.length > 0
      ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)
      : 0;

  const sig = computeSignal(buildings);

  return {
    buildings,
    hasBuilding: true,
    totalBuildingArea,
    oldestApprovalDate,
    maxAgeYears,
    averageAgeYears,
    ...sig,
  };
}

function parseBuilding(item: string): BuildingInfo {
  const str = (tag: string) => extractField(item, tag);
  const num = (tag: string) => {
    const v = str(tag);
    if (!v) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const approvalDate = parseDate(str("useAprDay"));
  const isMainBuilding = str("mainAtchGbCd") === "0";

  return {
    name: str("bldNm").trim(),
    mainPurpose: str("mainPurpsCdNm"),
    detailPurpose: str("etcPurps"),
    groundFloors: num("grndFlrCnt"),
    undergroundFloors: num("ugrndFlrCnt"),
    totalArea: num("totArea"),
    buildingArea: num("archArea"),
    buildingCoverage: num("bcRat"),
    floorAreaRatio: num("vlRat"),
    structure: str("strctCdNm"),
    height: num("heit"),
    approvalDate,
    ageYears: yearsSince(approvalDate),
    isMainBuilding,
  };
}

/**
 * Public: lookup by 19-digit PNU (V-World cadastral response).
 * May match adjacent parcel for very small lots — prefer lookupBuildingByJibun.
 */
export async function lookupBuildingByPnu(
  pnu: string
): Promise<BuildingLookupResult | null> {
  const parts = pnuToBuildingQuery(pnu);
  if (!parts) return null;
  return lookupBuildingByParts(parts);
}

/**
 * Public: lookup by Kakao's exact 지번 data — preferred for accuracy.
 */
export async function lookupBuildingByJibun(
  bCode: string,
  mainAddressNo: string,
  subAddressNo: string,
  mountainYn: string
): Promise<BuildingLookupResult | null> {
  const parts = geocodeToBuildingQuery(bCode, mainAddressNo, subAddressNo, mountainYn);
  if (!parts) return null;
  return lookupBuildingByParts(parts);
}
