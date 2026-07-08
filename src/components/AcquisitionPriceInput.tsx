'use client';

// components/AcquisitionPriceInput.tsx
// PARCELGRID — Round H
// 인수가 입력 UX 재설계:
//   - 자동 추정값을 "정답"에서 "참고 칩"으로 강등 (pre-fill 안 함)
//   - 사용자가 직접 입력 (총액 억 ↔ 평당가 만원/평 토글, 부지면적으로 동기화)
//   - 입력하는 즉시 "주변 시세 대비 N%ile" 컨텍스트 + 분포 위 위치

import { useEffect, useMemo, useState } from 'react';
import PriceDistributionChart from './PriceDistributionChart';
import {
  buildDistribution,
  describeContext,
  totalToPerPyeong,
  perPyeongToTotal,
  formatEok,
  formatManwonPerPyeong,
  type RawTransaction,
} from '@/lib/priceDistribution';

type Mode = 'total' | 'perPyeong';

interface Props {
  /** 대상 부지면적 (평). 총액↔평당가 변환 기준 */
  subjectAreaPyeong: number;
  /** 주변 실거래 (MOLIT/comps에서 매핑) */
  transactions: RawTransaction[];
  /** 현재 인수가 (총액, 원). 상위 상태와 연결 */
  value: number | null;
  onChange: (totalWon: number | null) => void;
  /** 참고용 자동추정 (총액, 원). 있으면 칩으로만 노출 */
  estimatedTotalWon?: number | null;
  /** 분포 차트 높이(px). 좁은 컬럼/무스크롤 레이아웃에서 축소용 */
  chartHeight?: number;
  className?: string;
}

const tone = {
  caution: { bg: 'var(--pg-caution-bg, #fef2f2)', fg: 'var(--pg-caution-fg, #b91c1c)' },
  neutral: { bg: 'var(--pg-neutral-bg, #f1f5f9)', fg: 'var(--pg-neutral-fg, #334155)' },
  good: { bg: 'var(--pg-good-bg, #f0fdf4)', fg: 'var(--pg-good-fg, #15803d)' },
} as const;

export default function AcquisitionPriceInput({
  subjectAreaPyeong,
  transactions,
  value,
  onChange,
  estimatedTotalWon = null,
  chartHeight = 320,
  className,
}: Props) {
  const [mode, setMode] = useState<Mode>('total');
  // 입력창 표시용 로컬 텍스트 — 편집 중엔 사용자가 친 그대로 보존(재포맷 X)
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);

  const dist = useMemo(() => buildDistribution(transactions, { trim: { method: 'iqr' } }), [transactions]);

  // 현재 인수가의 평당가
  const perPyeong = value != null ? totalToPerPyeong(value, subjectAreaPyeong) : null;
  const ctx = perPyeong != null && dist.values.length ? describeContext(perPyeong, dist.values, dist.stats) : null;
  const estPerPyeong = estimatedTotalWon != null ? totalToPerPyeong(estimatedTotalWon, subjectAreaPyeong) : null;

  // 표시값 동기화: 편집 중이 아닐 때만 부모 value로 재포맷.
  // (외부 '이 값으로 입력' 적용 / 모드 전환 / 블러 시 반영. 편집 중엔 건드리지 않음)
  useEffect(() => {
    if (focused) return;
    if (value == null) {
      setDraft('');
      return;
    }
    setDraft(
      mode === 'total'
        ? String(Math.round((value / 1e8) * 100) / 100) // 억 (불필요한 소수 0 제거)
        : String(Math.round(totalToPerPyeong(value, subjectAreaPyeong) / 1e4)) // 만원/평
    );
  }, [value, mode, subjectAreaPyeong, focused]);

  // 입력 핸들링: 사용자가 친 텍스트는 그대로 draft에 보존, 숫자만 부모로 전달
  const handleInput = (raw: string) => {
    setDraft(raw);
    const num = parseFloat(raw.replace(/,/g, ''));
    if (raw.trim() === '' || Number.isNaN(num)) {
      onChange(null);
      return;
    }
    if (mode === 'total') onChange(num * 1e8);
    else onChange(perPyeongToTotal(num * 1e4, subjectAreaPyeong));
  };

  const t = ctx ? tone[ctx.tone] : tone.neutral;

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 헤더 + 토글 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--pg-fg, #111827)' }}>인수가</label>
        <div style={{ display: 'inline-flex', border: '1px solid var(--pg-border, #e5e7eb)', borderRadius: 8, overflow: 'hidden' }}>
          {(['total', 'perPyeong'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                border: 'none',
                cursor: 'pointer',
                background: mode === m ? 'var(--pg-accent, #2563eb)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--pg-muted, #6b7280)',
              }}
            >
              {m === 'total' ? '총액(억)' : '평당가(만원)'}
            </button>
          ))}
        </div>
      </div>

      {/* 입력 + 단위 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          inputMode="decimal"
          value={draft}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={mode === 'total' ? '예: 35.0' : '예: 4500'}
          style={{
            flex: 1,
            padding: '10px 12px',
            fontSize: 18,
            fontWeight: 600,
            textAlign: 'right',
            border: '1px solid var(--pg-border, #e5e7eb)',
            borderRadius: 8,
            color: 'var(--pg-fg, #111827)',
          }}
        />
        <span style={{ fontSize: 14, color: 'var(--pg-muted, #6b7280)', minWidth: 56 }}>
          {mode === 'total' ? '억원' : '만원/평'}
        </span>
      </div>

      {/* 다른 단위 환산 + 참고추정 칩 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--pg-muted, #6b7280)' }}>
          {value != null
            ? mode === 'total'
              ? `≈ ${formatManwonPerPyeong(perPyeong!)}`
              : `≈ ${formatEok(value)} (부지 ${subjectAreaPyeong.toFixed(1)}평)`
            : `부지 ${subjectAreaPyeong.toFixed(1)}평`}
        </span>
        {estimatedTotalWon != null && (
          <span
            style={{ fontSize: 12, color: 'var(--pg-muted, #6b7280)' }}
            title="참고 추정값 — 적용은 아래 '이 값으로 입력'"
          >
            참고 추정 {formatEok(estimatedTotalWon)}
            {estPerPyeong ? ` · ${formatManwonPerPyeong(estPerPyeong)}` : ''}
          </span>
        )}
      </div>

      {/* 실시간 percentile 뱃지 */}
      {ctx && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: t.bg,
            color: t.fg,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>{ctx.message}</span>
        </div>
      )}

      {/* 분포 차트 */}
      <PriceDistributionChart values={dist.values} marker={perPyeong} height={chartHeight} />
    </div>
  );
}
