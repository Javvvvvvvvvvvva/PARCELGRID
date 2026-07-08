/**
 * 구축 단독/다가구 실거래 → 토지 인수가 추정 (Comparable, C 설계).
 *
 * 원리: 오래된 다가구 거래가는 토지 가치에 가장 가까운 비교사례 (토지 proxy).
 *   거래가 = 토지 + 잔존건물 − 철거비 − 명도/임차 리스크 − 개발 난이도
 * → "순수 토지값"이 아니라 "재개발 가능한 구축 주택 실거래 기반 토지 proxy"로 명시.
 *
 * 매각가 추정과 대칭·반대 방향:
 *   면적 기준 = 대지면적(plottageAr), 연식 = 구축 우선 (신축은 건물값 오염 → 0점).
 * 가중치: 같은 동 +40 / 같은 구 +20(기본) / 20년 이상 구축 +50 / 15년 이상 +25 /
 *         대지면적 ±30% +30, ±50% +15
 */

export interface LandProxyTxLike {
  type: string;
  priceManwon: number;
  /** 대지면적 m² */
  plottageAr?: number;
  buildYear?: number;
  sameDong?: boolean;
  address?: string;
  date?: string;
}

export interface LandProxyCase {
  address: string;
  date: string;
  buildYear?: number;
  priceManwon: number;
  lotAreaSqm: number;
  /** 대지면적 기준 평당가 (만원/평) */
  pricePerPyeongLand: number;
  sameDong: boolean;
  score: number;
}

export interface LandPriceEstimate {
  /** 대지 평당 중앙값 (만원/평) */
  medianPPPLand: number;
  /** 대상 부지 환산 추정가 (만원) */
  estimateManwon: number;
  count: number;
  basis: string;
  cases: LandProxyCase[];
  confidence: "high" | "medium" | "low";
  /** 필수 주의 문구 */
  caution: string;
}

const SQM_PER_PYEONG = 3.305785;
const MAX_CASES = 8;
const MIN_CASES = 3;

export const LAND_PROXY_CAUTION =
  "구축 주택 실거래 기반 토지 proxy — 건물 잔존가치·철거비·명도/임차 리스크 미반영";

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function scoreTx(
  t: LandProxyTxLike,
  targetLotAreaSqm: number,
  currentYear: number
): number {
  let s = 20; // 같은 구 (수집 범위 기본)
  if (t.sameDong) s += 40;
  if (t.buildYear != null) {
    const age = currentYear - t.buildYear;
    // 구축 우선 — 신축 거래가는 건물값이 섞여 토지값 추정에 방해 (C)
    if (age >= 20) s += 50;
    else if (age >= 15) s += 25;
  }
  if (t.plottageAr && targetLotAreaSqm > 0) {
    const dev = Math.abs(t.plottageAr - targetLotAreaSqm) / targetLotAreaSqm;
    if (dev <= 0.3) s += 30;
    else if (dev <= 0.5) s += 15;
  }
  return s;
}

export function estimateLandPriceFromHouseComps(
  txns: LandProxyTxLike[],
  targetLotAreaSqm: number,
  currentYear: number = new Date().getFullYear()
): LandPriceEstimate | null {
  const all = txns.filter(
    (t) =>
      t.type === "단독다가구" &&
      t.priceManwon > 0 &&
      t.plottageAr != null &&
      t.plottageAr > 0
  );
  if (all.length < MIN_CASES) return null;

  const scored = all
    .map((t) => ({ t, score: scoreTx(t, targetLotAreaSqm, currentYear) }))
    .sort(
      (a, b) =>
        b.score - a.score || (b.t.date ?? "").localeCompare(a.t.date ?? "")
    );

  const picked = scored.slice(0, MAX_CASES);
  const pppLand = picked
    .map((p) => p.t.priceManwon / ((p.t.plottageAr as number) / SQM_PER_PYEONG))
    .sort((a, b) => a - b);
  const medianPPPLand = median(pppLand);

  const targetPyeong = targetLotAreaSqm / SQM_PER_PYEONG;
  const estimateManwon = Math.round(medianPPPLand * targetPyeong);

  const cases: LandProxyCase[] = picked.map((p) => ({
    address: p.t.address ?? "—",
    date: p.t.date ?? "—",
    buildYear: p.t.buildYear,
    priceManwon: p.t.priceManwon,
    lotAreaSqm: p.t.plottageAr as number,
    pricePerPyeongLand: Math.round(
      p.t.priceManwon / ((p.t.plottageAr as number) / SQM_PER_PYEONG)
    ),
    sameDong: p.t.sameDong ?? false,
    score: p.score,
  }));

  const nSameDong = picked.filter((p) => p.t.sameDong).length;
  const nOld = picked.filter(
    (p) => p.t.buildYear != null && currentYear - p.t.buildYear >= 20
  ).length;
  const nSimilar = picked.filter((p) => {
    const a = p.t.plottageAr as number;
    return Math.abs(a - targetLotAreaSqm) / targetLotAreaSqm <= 0.3;
  }).length;
  const confidence: LandPriceEstimate["confidence"] =
    nSameDong >= 3 && nOld >= 3
      ? "high"
      : nSameDong >= 2 || nOld >= 3
        ? "medium"
        : "low";

  const parts: string[] = [];
  if (nSameDong > 0) parts.push(`같은 동 ${nSameDong}건`);
  if (nOld > 0) parts.push(`20년 이상 구축 ${nOld}건`);
  if (nSimilar > 0) parts.push(`대지 ±30% 유사 ${nSimilar}건`);

  return {
    medianPPPLand: Math.round(medianPPPLand),
    estimateManwon,
    count: picked.length,
    basis: `구축 단독/다가구 유사 사례 ${picked.length}건 (${parts.join(" · ")}) — 거래가÷대지면적 중앙값, 알고리즘 분석`,
    cases,
    confidence,
    caution: LAND_PROXY_CAUTION,
  };
}
