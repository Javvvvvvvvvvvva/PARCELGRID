'use client';

// components/PriceDistributionChart.tsx
// PARCELGRID — Round H
// 주변 실거래 평당가 히스토그램 + 인수가 위치 마커 + percentile 주석.
// 차트 라이브러리 의존성 없음(순수 SVG). 색/폰트는 className/CSS var로 갈아끼우기 쉽게.

import { useMemo } from 'react';
import {
  buildHistogram,
  computeStats,
  percentRank,
  trimOutliers,
  formatManwonPerPyeong,
  type HistogramBin,
  type TrimOptions,
} from '@/lib/priceDistribution';

interface Props {
  /** 주변 실거래 평당가 배열 (원/평). 원본을 넘기면 내부에서 트림 */
  values: number[];
  /** 사용자가 입력한 인수가의 평당가 (원/평). null이면 마커 숨김 */
  marker?: number | null;
  /** 차트 가독성용 트림 옵션 (percentile은 항상 원본 기준) */
  trim?: TrimOptions;
  binCount?: number;
  height?: number;
  className?: string;
}

const PAD = { top: 34, right: 20, bottom: 44, left: 20 };

export default function PriceDistributionChart({
  values,
  marker = null,
  trim = { method: 'iqr' },
  binCount,
  height = 300,
  className,
}: Props) {
  const model = useMemo(() => {
    const chartValues = trimOutliers(values, trim);
    const bins = buildHistogram(chartValues, binCount);
    const stats = computeStats(values); // percentile은 원본 기준
    const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0) || 1;
    const domainMin = bins.length ? bins[0].x0 : 0;
    const domainMax = bins.length ? bins[bins.length - 1].x1 : 1;
    const pct = marker != null ? percentRank(values, marker) : null;
    return { bins, stats, maxCount, domainMin, domainMax, pct };
  }, [values, marker, trim, binCount]);

  const { bins, stats, maxCount, domainMin, domainMax, pct } = model;

  if (!bins.length || !stats) {
    return (
      <div className={className} style={{ height, display: 'grid', placeItems: 'center', color: 'var(--pg-muted, #9ca3af)', fontSize: 13 }}>
        주변 실거래 데이터가 부족합니다
      </div>
    );
  }

  // viewBox 기준 좌표 (반응형: width 100%)
  const VB_W = 700;
  const plotW = VB_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const span = domainMax - domainMin || 1;

  const xOf = (v: number) => PAD.left + ((v - domainMin) / span) * plotW;
  const barGap = 3;
  const barW = Math.max(1, plotW / bins.length - barGap);

  // 마커가 트림 범위 밖이면 가장자리로 클램프 + 표시
  const markerInRange = marker != null && marker >= domainMin && marker <= domainMax;
  const markerX = marker != null ? xOf(Math.min(Math.max(marker, domainMin), domainMax)) : null;

  const inMarkerBin = (b: HistogramBin) => marker != null && marker >= b.x0 && marker < b.x1;

  const topPercent = pct != null ? 100 - pct : null;
  const markerLabelRight = markerX != null && markerX > VB_W * 0.65;

  return (
    <div className={className} style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${VB_W} ${height}`} width="100%" role="img"
        aria-label="주변 실거래 평당가 분포와 입력 인수가 위치">
        {/* 중앙값 점선 */}
        <line
          x1={xOf(stats.median)} x2={xOf(stats.median)} y1={PAD.top} y2={PAD.top + plotH}
          stroke="var(--pg-grid, #d1d5db)" strokeWidth={1} strokeDasharray="3 3"
        />
        <text x={xOf(stats.median)} y={PAD.top - 14} textAnchor="middle"
          fontSize={11} fill="var(--pg-muted, #9ca3af)">
          중간값 {formatManwonPerPyeong(stats.median)}
        </text>

        {/* 막대 */}
        {bins.map((b, i) => {
          const h = (b.count / maxCount) * plotH;
          const x = xOf(b.x0) + barGap / 2;
          const active = inMarkerBin(b);
          return (
            <rect
              key={i}
              x={x}
              y={PAD.top + plotH - h}
              width={barW}
              height={h}
              rx={2}
              fill={active ? 'var(--pg-accent, #2563eb)' : 'var(--pg-bar, #cbd5e1)'}
              opacity={active ? 1 : 0.85}
            >
              <title>{`${formatManwonPerPyeong(b.x0)} ~ ${formatManwonPerPyeong(b.x1)} · ${b.count}건`}</title>
            </rect>
          );
        })}

        {/* 인수가 마커 */}
        {markerX != null && (
          <g>
            <line
              x1={markerX} x2={markerX} y1={PAD.top - 6} y2={PAD.top + plotH}
              stroke="var(--pg-accent, #2563eb)" strokeWidth={2}
              strokeDasharray={markerInRange ? undefined : '4 3'}
            />
            <circle cx={markerX} cy={PAD.top - 6} r={3.5} fill="var(--pg-accent, #2563eb)" />
            <text
              x={markerLabelRight ? markerX - 8 : markerX + 8}
              y={PAD.top + 8}
              textAnchor={markerLabelRight ? 'end' : 'start'}
              fontSize={12} fontWeight={600} fill="var(--pg-accent, #2563eb)">
              {marker != null ? formatManwonPerPyeong(marker) : ''}
              {topPercent != null ? `  ·  상위 ${Math.round(topPercent)}%` : ''}
            </text>
          </g>
        )}

        {/* x축 라벨 (min / median / max) */}
        <text x={PAD.left} y={height - 14} textAnchor="start" fontSize={11} fill="var(--pg-muted, #9ca3af)">
          {formatManwonPerPyeong(domainMin)}
        </text>
        <text x={VB_W - PAD.right} y={height - 14} textAnchor="end" fontSize={11} fill="var(--pg-muted, #9ca3af)">
          {formatManwonPerPyeong(domainMax)}
        </text>
        <text x={PAD.left} y={height - 0} textAnchor="start" fontSize={10} fill="var(--pg-muted, #9ca3af)">
          n={stats.n}건{trim.method !== 'none' ? ' · 이상치 제외' : ''}
        </text>
      </svg>

      {!markerInRange && marker != null && (
        <p style={{ margin: '4px 2px 0', fontSize: 11, color: 'var(--pg-muted, #9ca3af)' }}>
          ※ 입력값이 주변 실거래 범위를 벗어났습니다(차트 가장자리로 표시).
        </p>
      )}
    </div>
  );
}
