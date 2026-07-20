/**
 * 주변 단독/다가구 매매 실거래 → 통매각 단가 참고 추정.
 *
 * 동일 동·건물 연식에 자체 점수를 부여하고 상위 사례(최대 8건)의
 * 중앙값을 사용한다. 외부 통계검증 또는 감정평가를 거친 모형이 아니다:
 *   같은 동 +40 / 같은 구 +20(수집 범위 기본)
 *   준공 15년 이내 +30 / 20년 이내 +15
 *   용도(단독/다가구)는 전제 필터
 *   [v2 예정] 인접 동 +30 (동 인접 데이터 확보 후), 면적 ±20% +15
 *
 * 평균 하나가 아니라 "참고한 사례" 목록을 함께 반환 —
 * 사용자는 평균보다 유사 사례를 신뢰한다 (알고리즘 분석 근거 표시용).
 */

export interface HouseCompLike {
  type: string;
  /** 연면적 기준 평당가 (만원/평) */
  pricePerPyeong: number;
  buildYear?: number;
  /** 본인 부지와 같은 법정동 여부 */
  sameDong?: boolean;
  /** 표시용 */
  address?: string;
  date?: string;
  priceWon?: number;
}

export interface ComparableCase {
  address: string;
  date: string;
  buildYear?: number;
  priceWon?: number;
  pricePerPyeong: number;
  sameDong: boolean;
  score: number;
}

export const SALE_PRICE_MODEL_VERSION = "experimental-2026.1";

export interface SalePriceEstimate {
  modelVersion: typeof SALE_PRICE_MODEL_VERSION;
  modelStatus: "experimental-unvalidated";
  asOfYear: number;
  warnings: string[];
  /** 채택된 매각 단가 (원/㎡) */
  salePricePerSqM: number;
  /** 채택 사례 평당 중앙값 (만원/평) */
  medianPPP: number;
  /** 채택 사례 수 */
  count: number;
  /** 산정 기준 설명 (화면·로그용) */
  basis: string;
  /** 참고한 유사 사례 (점수 내림차순, 화면 표시용) */
  cases: ComparableCase[];
  /** 표본 근거 수준: 같은동·신축 사례 비중 기반. 정확도 등급이 아니다. */
  confidence: "high" | "medium" | "low";
  /** 비교 기준: 필터 전 전체 단독·다가구 거래 중앙값 (만원/평) */
  conservativePPP: number;
  conservativeCount: number;
}

const SQM_PER_PYEONG = 3.305785;
const MAX_CASES = 8;
const MIN_CASES = 3;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function scoreComp(c: HouseCompLike, currentYear: number): number {
  let s = 20; // 같은 구 (수집 범위 기본)
  if (c.sameDong) s += 40;
  if (c.buildYear != null) {
    const age = currentYear - c.buildYear;
    // 신축 > 지리 (C 확정: "신축을 먼저 유지한다" — 같은동 구축이
    // 타동 신축을 밀어내지 않게 +50 > 같은동 +40)
    // → 같은동 신축 110 > 타동 신축 90 > 같은동 구축 60 > 타동 구축 20
    if (age <= 15) s += 50;
    else if (age <= 20) s += 25;
  }
  return s;
}

export function estimateSalePriceFromComps(
  comps: HouseCompLike[],
  currentYear: number = new Date().getFullYear()
): SalePriceEstimate | null {
  const all = comps.filter(
    (c) => c.type === "단독다가구" && c.pricePerPyeong > 0
  );
  if (all.length < MIN_CASES) return null;

  // 점수 부여 → 내림차순 (동점은 최신 거래 우선)
  const scored = all
    .map((c) => ({ c, score: scoreComp(c, currentYear) }))
    .sort(
      (a, b) =>
        b.score - a.score || (b.c.date ?? "").localeCompare(a.c.date ?? "")
    );

  const picked = scored.slice(0, MAX_CASES);
  const ppp = picked.map((p) => p.c.pricePerPyeong).sort((a, b) => a - b);
  const medianPPP = median(ppp);

  const allPPP = all.map((c) => c.pricePerPyeong).sort((a, b) => a - b);
  const conservativePPP = median(allPPP);

  const cases: ComparableCase[] = picked.map((p) => ({
    address: p.c.address ?? "—",
    date: p.c.date ?? "—",
    buildYear: p.c.buildYear,
    priceWon: p.c.priceWon,
    pricePerPyeong: Math.round(p.c.pricePerPyeong),
    sameDong: p.c.sameDong ?? false,
    score: p.score,
  }));

  const nSameDong = picked.filter((p) => p.c.sameDong).length;
  const nNew = picked.filter(
    (p) => p.c.buildYear != null && currentYear - p.c.buildYear <= 15
  ).length;
  const confidence: SalePriceEstimate["confidence"] =
    nSameDong >= 3 && nNew >= 3
      ? "high"
      : nSameDong >= 2 || nNew >= 3
        ? "medium"
        : "low";

  const parts: string[] = [];
  if (nSameDong > 0) parts.push(`같은 동 ${nSameDong}건`);
  if (picked.length - nSameDong > 0)
    parts.push(`같은 구 ${picked.length - nSameDong}건`);
  if (nNew > 0) parts.push(`준공 15년 이내 ${nNew}건`);

  return {
    modelVersion: SALE_PRICE_MODEL_VERSION,
    modelStatus: "experimental-unvalidated",
    asOfYear: currentYear,
    warnings: [
      "동일 동·건물 연식 점수는 외부 통계검증 전 자체 사례선정 규칙입니다.",
      "대지·연면적 유사도, 도로, 상태, 권리관계와 거래조건을 보정하지 않습니다.",
      "전체 거래 중앙값은 비교 기준일 뿐 항상 보수적인 하한값이 아닙니다.",
      "감정평가액이나 확정 매각가가 아닌 민감도 검토용 참고값입니다.",
    ],
    salePricePerSqM: Math.round((medianPPP * 10_000) / SQM_PER_PYEONG),
    medianPPP: Math.round(medianPPP),
    count: picked.length,
    basis: `자체 점수 상위 사례 ${picked.length}건 중앙값 (${parts.join(" · ")}) — 외부 검증 전`,
    cases,
    confidence,
    conservativePPP: Math.round(conservativePPP),
    conservativeCount: all.length,
  };
}
