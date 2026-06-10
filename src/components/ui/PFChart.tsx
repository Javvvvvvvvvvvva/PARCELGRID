"use client";

import type { CashflowRowVM } from "@/lib/adapters/view-model";
import { won } from "@/lib/utils/format";

interface PFChartProps {
  rows: CashflowRowVM[];
  height?: number;
  showAxis?: boolean;
  showLegend?: boolean;
}

/**
 * Quarter-by-quarter waterfall: red outflows below zero, green inflows above,
 * black cumulative balance line laid on top.
 *
 * Rendered in two sizes:
 *   - 미니 (dashboard PF preview): height ~140, no legend
 *   - 풀 (scenario detail): height ~340, with legend & axis labels
 */
export function PFChart({
  rows,
  height = 200,
  showAxis = false,
  showLegend = false,
}: PFChartProps) {
  if (rows.length === 0) return null;

  const W = 800;
  const H = height;
  const PADDING = { top: 30, right: 40, bottom: 30, left: 50 };
  const innerW = W - PADDING.left - PADDING.right;
  const innerH = H - PADDING.top - PADDING.bottom;

  // Scales
  const maxOut = Math.max(...rows.map((r) => r.outflow));
  const maxIn = Math.max(...rows.map((r) => r.inflow));
  const maxBar = Math.max(maxOut, maxIn);
  const minCum = Math.min(...rows.map((r) => r.cumulative), 0);
  const maxCum = Math.max(...rows.map((r) => r.cumulative), 0);
  const yScale = Math.max(maxBar, Math.abs(minCum), maxCum);

  const barW = innerW / rows.length;
  const innerBarW = Math.max(barW * 0.6, 8);
  const zeroY = PADDING.top + innerH / 2;
  const scale = (innerH / 2) / yScale;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{ display: "block", overflow: "visible" }}
    >
      {/* Zero line */}
      <line
        x1={PADDING.left}
        x2={W - PADDING.right}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--border)"
        strokeWidth={1}
      />

      {/* Bars */}
      {rows.map((r, i) => {
        const x = PADDING.left + i * barW + (barW - innerBarW) / 2;
        const outHeight = r.outflow * scale;
        const inHeight = r.inflow * scale;
        return (
          <g key={i}>
            {r.outflow > 0 && (
              <rect
                x={x}
                y={zeroY}
                width={innerBarW}
                height={outHeight}
                fill="var(--neg)"
                opacity={0.85}
                rx={1}
              />
            )}
            {r.inflow > 0 && (
              <rect
                x={x}
                y={zeroY - inHeight}
                width={innerBarW}
                height={inHeight}
                fill="var(--pos)"
                opacity={0.85}
                rx={1}
              />
            )}
            {showAxis && (
              <text
                x={x + innerBarW / 2}
                y={H - 10}
                textAnchor="middle"
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--fg-muted)"
              >
                {r.quarter.slice(5)}
              </text>
            )}
          </g>
        );
      })}

      {/* Cumulative line */}
      <polyline
        points={rows
          .map((r, i) => {
            const x = PADDING.left + i * barW + barW / 2;
            const y = zeroY - r.cumulative * scale;
            return `${x},${y}`;
          })
          .join(" ")}
        fill="none"
        stroke="var(--fg)"
        strokeWidth={1.5}
      />
      {rows.map((r, i) => {
        const x = PADDING.left + i * barW + barW / 2;
        const y = zeroY - r.cumulative * scale;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={3}
            fill="var(--bg-elev)"
            stroke="var(--fg)"
            strokeWidth={1.5}
          />
        );
      })}

      {/* Min / max cumulative labels */}
      {(() => {
        const minIdx = rows.findIndex((r) => r.cumulative === minCum);
        const maxIdx = rows.findIndex((r) => r.cumulative === maxCum);
        return (
          <>
            {minCum < 0 && (
              <text
                x={PADDING.left + minIdx * barW + barW / 2}
                y={zeroY - minCum * scale + 14}
                textAnchor="middle"
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--neg-fg)"
                fontWeight={500}
              >
                {won(minCum)}
              </text>
            )}
            {maxCum > 0 && (
              <text
                x={PADDING.left + maxIdx * barW + barW / 2}
                y={zeroY - maxCum * scale - 8}
                textAnchor="middle"
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--pos-fg)"
                fontWeight={500}
              >
                +{won(maxCum)}
              </text>
            )}
          </>
        );
      })()}

      {/* Legend */}
      {showLegend && (
        <g transform={`translate(${W - PADDING.right - 200}, ${PADDING.top - 18})`}>
          <rect width={10} height={10} fill="var(--neg)" opacity={0.85} />
          <text x={14} y={9} fontSize={11} fill="var(--fg-muted)">유출</text>
          <rect x={50} width={10} height={10} fill="var(--pos)" opacity={0.85} />
          <text x={64} y={9} fontSize={11} fill="var(--fg-muted)">유입</text>
          <line x1={100} y1={5} x2={120} y2={5} stroke="var(--fg)" strokeWidth={1.5} />
          <circle cx={110} cy={5} r={3} fill="var(--bg-elev)" stroke="var(--fg)" strokeWidth={1.5} />
          <text x={126} y={9} fontSize={11} fill="var(--fg-muted)">누적 잔액</text>
        </g>
      )}
    </svg>
  );
}
