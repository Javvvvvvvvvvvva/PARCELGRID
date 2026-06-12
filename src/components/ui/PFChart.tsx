"use client";

/**
 * PF 현금흐름 차트 — 분기별 막대 + 누적 잔액 라인 (PDF p1, p3 디자인).
 *
 * 두 가지 모드:
 *   - 미니 (대시보드): height ~140, 라벨 최소, 차트만
 *   - 풀 (시나리오 상세): height ~340, X/Y축 라벨, 범례, 손익분기 표시, 평균 잔액
 *
 * 본인 도구 데이터: CashflowRowVM[]
 *   quarter | phase | outflow | inflow | net | cumulative | note
 */

import type { CashflowRowVM } from "@/lib/adapters/view-model";
import { won } from "@/lib/utils/format";

interface PFChartProps {
  rows: CashflowRowVM[];
  height?: number;
  /** "mini" or "full" — 디자인 모드 */
  variant?: "mini" | "full";
}

export function PFChart({ rows, height = 200, variant = "mini" }: PFChartProps) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          height,
          display: "grid",
          placeItems: "center",
          color: "var(--fg-faint)",
          fontSize: 12,
        }}
      >
        현금흐름 데이터 없음
      </div>
    );
  }

  const W = variant === "full" ? 800 : 600;
  const H = height;
  const PAD_T = variant === "full" ? 28 : 16;
  const PAD_B = variant === "full" ? 30 : 18;
  const PAD_L = variant === "full" ? 50 : 12;
  const PAD_R = variant === "full" ? 12 : 12;

  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // 데이터 범위 계산
  const allOutflows = rows.map((r) => -r.outflow); // 음수로
  const allInflows = rows.map((r) => r.inflow);
  const allCumulative = rows.map((r) => r.cumulative);

  const minVal = Math.min(0, ...allOutflows, ...allCumulative);
  const maxVal = Math.max(0, ...allInflows, ...allCumulative);
  const range = maxVal - minVal || 1;

  // Y 축: 0 위치
  const yZero = PAD_T + (maxVal / range) * chartH;
  const yScale = (val: number) => PAD_T + ((maxVal - val) / range) * chartH;

  // 막대 너비
  const barGap = 4;
  const barTotalW = chartW / rows.length;
  const barW = Math.max(20, barTotalW - barGap);

  // 손익분기점 (cumulative 가 처음 양수로 전환된 시점)
  const breakEvenIdx = rows.findIndex((r, i) => i > 0 && r.cumulative >= 0);
  const breakEvenQuarter = breakEvenIdx >= 0 ? rows[breakEvenIdx].quarter : null;

  // 평균 잔액
  const avgCumulative =
    rows.reduce((acc, r) => acc + r.cumulative, 0) / rows.length;
  const maxExposure = Math.min(...allCumulative);

  // 누적 라인 경로
  const linePath = rows
    .map((r, i) => {
      const x = PAD_L + i * barTotalW + barTotalW / 2;
      const y = yScale(r.cumulative);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div style={{ width: "100%", overflow: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: "block" }}
      >
        {/* 0 라인 */}
        <line
          x1={PAD_L}
          y1={yZero}
          x2={W - PAD_R}
          y2={yZero}
          stroke="var(--border)"
          strokeWidth={1}
        />
        {variant === "full" && (
          <text
            x={PAD_L - 6}
            y={yZero + 4}
            fontSize={10}
            fill="var(--fg-faint)"
            textAnchor="end"
            fontFamily="var(--font-mono)"
          >
            0
          </text>
        )}

        {/* 손익분기 수직선 (full 모드만) */}
        {variant === "full" && breakEvenIdx >= 0 && (
          <>
            <line
              x1={PAD_L + breakEvenIdx * barTotalW + barTotalW / 2}
              y1={PAD_T}
              x2={PAD_L + breakEvenIdx * barTotalW + barTotalW / 2}
              y2={H - PAD_B}
              stroke="var(--accent)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <text
              x={PAD_L + breakEvenIdx * barTotalW + barTotalW / 2 + 6}
              y={PAD_T + 12}
              fontSize={10}
              fill="var(--accent-fg)"
              fontFamily="var(--font-mono)"
            >
              손익분기
            </text>
          </>
        )}

        {/* 막대들 */}
        {rows.map((r, i) => {
          const x = PAD_L + i * barTotalW + barGap / 2;
          const yOut = yScale(0);
          const hOut = Math.max(0, yScale(-r.outflow) - yZero);

          const yIn = yScale(r.inflow);
          const hIn = Math.max(0, yZero - yScale(r.inflow));

          return (
            <g key={i}>
              {/* Outflow (아래쪽) */}
              {r.outflow > 0 && (
                <rect
                  x={x}
                  y={yOut}
                  width={barW}
                  height={hOut}
                  fill="var(--neg)"
                  opacity={0.85}
                />
              )}
              {/* Inflow (위쪽) */}
              {r.inflow > 0 && (
                <rect
                  x={x}
                  y={yIn}
                  width={barW}
                  height={hIn}
                  fill="var(--pos)"
                  opacity={0.85}
                />
              )}
              {/* 분기 라벨 (full 모드) */}
              {variant === "full" && (
                <text
                  x={x + barW / 2}
                  y={H - PAD_B + 14}
                  fontSize={10}
                  fill="var(--fg-muted)"
                  textAnchor="middle"
                  fontFamily="var(--font-mono)"
                >
                  {r.quarter.slice(-2)}
                </text>
              )}
            </g>
          );
        })}

        {/* 누적 잔액 라인 */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--fg)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* 라인 위 점들 */}
        {rows.map((r, i) => {
          const cx = PAD_L + i * barTotalW + barTotalW / 2;
          const cy = yScale(r.cumulative);
          return (
            <circle key={`pt-${i}`} cx={cx} cy={cy} r={2.5} fill="var(--fg)" />
          );
        })}

        {/* Max exposure 라벨 (full 모드) */}
        {variant === "full" && (
          <>
            <text
              x={PAD_L}
              y={H - 6}
              fontSize={10}
              fill="var(--neg-fg)"
              fontFamily="var(--font-mono)"
              fontWeight={500}
            >
              최대 노출 {won(maxExposure)}
            </text>
            <text
              x={W - PAD_R}
              y={H - 6}
              fontSize={10}
              fill="var(--fg-muted)"
              fontFamily="var(--font-mono)"
              textAnchor="end"
            >
              평균 잔액 {won(avgCumulative)}
            </text>
          </>
        )}
      </svg>

      {/* 범례 (full 모드만) */}
      {variant === "full" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "8px 0 0",
            fontSize: 11,
            color: "var(--fg-muted)",
          }}
        >
          <Legend color="var(--neg)" label="유출" />
          <Legend color="var(--pos)" label="유입" />
          <Legend color="var(--fg)" label="누적 잔액" isLine />
          {breakEvenQuarter && (
            <span style={{ marginLeft: "auto" }} className="mono">
              손익분기 {breakEvenQuarter}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({
  color,
  label,
  isLine = false,
}: {
  color: string;
  label: string;
  isLine?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      {isLine ? (
        <div style={{ width: 14, height: 1.5, background: color }} />
      ) : (
        <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
      )}
      <span>{label}</span>
    </div>
  );
}
