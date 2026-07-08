// lib/priceDistribution.ts
// PARCELGRID — Round H
// 주변 실거래 "평당가" 분포 + percentile 엔진 (순수 TS, UI/차트 의존 없음)
//
// 핵심 아이디어:
//   - MOLIT 등 주변 실거래를 평당가(원/평) 분포로 만든다
//   - 사용자가 입력한 인수가(총액 or 평당가)가 그 분포에서 몇 %ile인지 보여준다
//   - "자동 추정값"은 더 이상 답이 아니라 분포 위의 한 점일 뿐

export const SQM_PER_PYEONG = 3.305785; // 1평 = 3.305785㎡

// ──────────────────────────────────────────────────────────────
// 1. 타입 + 어댑터
// ──────────────────────────────────────────────────────────────

/** 외부(MOLIT/comps) → 이 타입으로만 매핑하면 됨 */
export interface RawTransaction {
  amount: number; // 거래금액 (원)
  areaSqm: number; // 토지면적 (㎡)
  date?: string; // 거래일 YYYY-MM-DD (최근성 필터/표시용)
  zoning?: string; // 용도지역 (필터용)
  label?: string; // 지번 등 표시용
}

export interface PyeongTransaction extends RawTransaction {
  pricePerPyeong: number; // 평당가 (원/평)
  areaPyeong: number; // 면적 (평)
}

export function sqmToPyeong(sqm: number): number {
  return sqm / SQM_PER_PYEONG;
}

export function enrich(raw: RawTransaction): PyeongTransaction | null {
  if (!raw.amount || !raw.areaSqm || raw.areaSqm <= 0) return null;
  const areaPyeong = sqmToPyeong(raw.areaSqm);
  if (!Number.isFinite(areaPyeong) || areaPyeong <= 0) return null;
  return { ...raw, areaPyeong, pricePerPyeong: raw.amount / areaPyeong };
}

export function enrichMany(raws: RawTransaction[]): PyeongTransaction[] {
  return raws
    .map(enrich)
    .filter((t): t is PyeongTransaction => t !== null);
}

// ──────────────────────────────────────────────────────────────
// 2. 통계 유틸
// ──────────────────────────────────────────────────────────────

/** 선형보간 분위수 (numpy 기본 type-7) */
export function quantile(sortedAsc: number[], q: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0];
  const pos = (n - 1) * Math.min(Math.max(q, 0), 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedAsc[base + 1];
  return next !== undefined ? sortedAsc[base] + rest * (next - sortedAsc[base]) : sortedAsc[base];
}

export interface DistributionStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  std: number;
}

export function computeStats(values: number[]): DistributionStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: quantile(sorted, 0.5),
    p10: quantile(sorted, 0.1),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    std: Math.sqrt(variance),
  };
}

// ──────────────────────────────────────────────────────────────
// 3. 아웃라이어 트림 (강남구 같은 데서 분포 깨지는 거 방지)
// ──────────────────────────────────────────────────────────────

export interface TrimOptions {
  method?: 'iqr' | 'percentile' | 'none';
  iqrFactor?: number; // default 1.5
  lowerPct?: number; // percentile 모드, default 1
  upperPct?: number; // percentile 모드, default 99
}

/** 차트 가독성용으로만 트림. percentRank 계산엔 원본 쓰는 걸 권장 */
export function trimOutliers(values: number[], opts: TrimOptions = {}): number[] {
  const { method = 'iqr', iqrFactor = 1.5, lowerPct = 1, upperPct = 99 } = opts;
  if (method === 'none' || values.length < 4) return [...values];
  const sorted = [...values].sort((a, b) => a - b);
  if (method === 'percentile') {
    const lo = quantile(sorted, lowerPct / 100);
    const hi = quantile(sorted, upperPct / 100);
    return sorted.filter((v) => v >= lo && v <= hi);
  }
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - iqrFactor * iqr;
  const hi = q3 + iqrFactor * iqr;
  return sorted.filter((v) => v >= lo && v <= hi);
}

// ──────────────────────────────────────────────────────────────
// 4. percentile rank (입력값이 분포에서 몇 %ile인가)
// ──────────────────────────────────────────────────────────────

/**
 * PERCENTRANK.INC 스타일. 반환 0~100.
 * = "이 값 이하인 실거래의 비율(%)". 즉 클수록 비싼 축.
 * 소량 comp(8~10건)에서도 선형보간으로 부드럽게.
 */
export function percentRank(values: number[], value: number): number {
  const n = values.length;
  if (n === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (value <= sorted[0]) return 0;
  if (value >= sorted[n - 1]) return 100;
  let i = 0;
  while (i < n - 1 && sorted[i + 1] <= value) i++;
  const lo = sorted[i];
  const hi = sorted[i + 1];
  const frac = hi === lo ? 0 : (value - lo) / (hi - lo);
  const rank = (i + frac) / (n - 1);
  return Math.max(0, Math.min(100, rank * 100));
}

// ──────────────────────────────────────────────────────────────
// 5. 히스토그램
// ──────────────────────────────────────────────────────────────

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
}

/** binCount 미지정 시 Freedman–Diaconis로 자동 (5~30 클램프) */
export function buildHistogram(values: number[], binCount?: number): HistogramBin[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === max) return [{ x0: min, x1: max, count: sorted.length }];

  let bins = binCount;
  if (!bins) {
    const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
    const fdWidth = iqr > 0 ? (2 * iqr) / Math.cbrt(sorted.length) : 0;
    bins = fdWidth > 0 ? Math.ceil((max - min) / fdWidth) : Math.ceil(Math.sqrt(sorted.length));
    bins = Math.max(5, Math.min(30, bins));
  }

  const width = (max - min) / bins;
  const result: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of sorted) {
    let idx = Math.floor((v - min) / width);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    result[idx].count++;
  }
  return result;
}

// ──────────────────────────────────────────────────────────────
// 6. 한국어 컨텍스트 요약 (UX 뱃지용)
// ──────────────────────────────────────────────────────────────

export type PriceBand = 'low' | 'below-mid' | 'around-mid' | 'above-mid' | 'high';

export interface PriceContext {
  pricePerPyeong: number; // 평가 대상 평당가 (원/평)
  percentile: number; // 0~100 (이하 비율)
  topPercent: number; // 100 - percentile (상위 N%)
  vsMedianPct: number; // 중간값 대비 % (+가 비쌈)
  band: PriceBand;
  tone: 'caution' | 'neutral' | 'good'; // 비쌀수록 caution
  message: string; // "주변 시세 상위 15% (중간값 대비 +12%)"
}

export function describeContext(
  value: number,
  allValues: number[],
  stats?: DistributionStats | null,
): PriceContext {
  const s = stats ?? computeStats(allValues);
  const median = s?.median ?? value;
  const percentile = percentRank(allValues, value);
  const topPercent = 100 - percentile;
  const vsMedianPct = median > 0 ? (value / median - 1) * 100 : 0;

  let band: PriceBand;
  if (percentile < 10) band = 'low';
  else if (percentile < 40) band = 'below-mid';
  else if (percentile <= 60) band = 'around-mid';
  else if (percentile <= 90) band = 'above-mid';
  else band = 'high';

  const tone: PriceContext['tone'] = band === 'high' ? 'caution' : band === 'low' || band === 'below-mid' ? 'good' : 'neutral';

  const sign = vsMedianPct >= 0 ? '+' : '';
  const medianTail = `중간값 대비 ${sign}${vsMedianPct.toFixed(0)}%`;
  let message: string;
  if (band === 'around-mid') message = `주변 시세 중간 수준 (${medianTail})`;
  else if (percentile >= 50) message = `주변 시세 상위 ${Math.round(topPercent)}% (${medianTail})`;
  else message = `주변 시세 하위 ${Math.round(percentile)}% (${medianTail})`;

  return { pricePerPyeong: value, percentile, topPercent, vsMedianPct, band, tone, message };
}

// ──────────────────────────────────────────────────────────────
// 7. 포맷터
// ──────────────────────────────────────────────────────────────

export function formatManwonPerPyeong(wonPerPyeong: number): string {
  return `${Math.round(wonPerPyeong / 10000).toLocaleString('ko-KR')}만원/평`;
}

export function formatEok(won: number): string {
  const eok = won / 1e8;
  return `${eok >= 100 ? Math.round(eok).toLocaleString('ko-KR') : eok.toFixed(1)}억`;
}

/** 총액(원) ↔ 평당가(원/평) 변환 (부지면적 평 기준) */
export function totalToPerPyeong(totalWon: number, areaPyeong: number): number {
  return areaPyeong > 0 ? totalWon / areaPyeong : 0;
}
export function perPyeongToTotal(perPyeongWon: number, areaPyeong: number): number {
  return perPyeongWon * areaPyeong;
}

// ──────────────────────────────────────────────────────────────
// 8. 원샷 빌더 (컴포넌트에서 한 방에 쓰기 좋게)
// ──────────────────────────────────────────────────────────────

export interface DistributionModel {
  transactions: PyeongTransaction[];
  values: number[]; // 평당가 배열 (원본, percentRank용)
  chartValues: number[]; // 트림된 값 (히스토그램용)
  stats: DistributionStats | null;
  histogram: HistogramBin[];
}

export function buildDistribution(
  raws: RawTransaction[],
  opts: { trim?: TrimOptions; binCount?: number } = {},
): DistributionModel {
  const transactions = enrichMany(raws);
  const values = transactions.map((t) => t.pricePerPyeong);
  const chartValues = trimOutliers(values, opts.trim ?? { method: 'iqr' });
  return {
    transactions,
    values,
    chartValues,
    stats: computeStats(values),
    histogram: buildHistogram(chartValues, opts.binCount),
  };
}
