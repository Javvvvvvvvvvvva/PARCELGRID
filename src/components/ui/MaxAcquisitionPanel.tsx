"use client";

/**
 * 최대 시행 가능 인수가 패널 — 본인 도구의 진짜 차별화.
 *
 * 표시:
 *   - 시장가 (실거래 추정) vs 시행 가능가 (IRR 10/15/20%)
 *   - 시나리오마다 한 행
 *   - 음수 갭 (시장가 > 시행가) = 적색 = 시행 부적합
 *   - 양수 갭 (시장가 < 시행가) = 녹색 = 시행 가능
 */

import type { ScenarioMaxAcquisition } from "@/lib/finance/max-acquisition";
import { won } from "@/lib/utils/format";

interface MaxAcquisitionPanelProps {
  analyses: ScenarioMaxAcquisition[];
  /** 시장가 (parcel.acquiredPrice, 만원 단위) */
  marketPrice: number;
  /** 시장 토지 proxy (구축 다가구 실거래 기반, 만원 단위) — 있으면 병기 */
  marketProxyPrice?: number;
}

export function MaxAcquisitionPanel({
  analyses,
  marketPrice,
  marketProxyPrice,
}: MaxAcquisitionPanelProps) {
  if (analyses.length === 0) return null;

  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 7,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 36,
          padding: "0 14px",
          borderBottom: "1px solid var(--border)",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--fg-muted)",
          }}
        >
          최대 시행 가능 인수가
        </div>
        <span style={{ fontSize: 11.5, color: "var(--fg-subtle)" }}>
          {marketProxyPrice != null && marketProxyPrice > 0 ? (
            <>
              시장 토지 proxy {won(marketProxyPrice)} (실거래 기반) · 내 인수가 {won(marketPrice)} · IRR 목표별 역산
            </>
          ) : (
            <>시장가 {won(marketPrice)} 대비 · IRR 목표별 역산</>
          )}
        </span>
      </div>

      {/* Sub-header explanation */}
      <div
        style={{
          padding: "8px 14px",
          fontSize: 11.5,
          color: "var(--fg-muted)",
          background: "var(--bg-sunken)",
          borderBottom: "1px solid var(--border-faint)",
        }}
      >
        "이 부지를 얼마에 사야 시행 가능한가?" 시장 평균 인수가는 시행 가능 인수가와 다를 수 있습니다.
      </div>

      {/* Table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            <Th width="auto">시나리오</Th>
            <Th width={90} align="right">시장가 IRR</Th>
            <Th width={120} align="right">IRR 20% 인수가</Th>
            <Th width={120} align="right">IRR 15% 인수가</Th>
            <Th width={120} align="right">IRR 10% 인수가</Th>
            <Th width={100} align="right">갭 (15% 기준)</Th>
          </tr>
        </thead>
        <tbody>
          {analyses.map((a) => {
            const r20 = a.results.find((r) => r.targetIRR === 20);
            const r15 = a.results.find((r) => r.targetIRR === 15);
            const r10 = a.results.find((r) => r.targetIRR === 10);
            const gap15 = r15?.marketGap ?? 0;
            const gapPositive = gap15 >= 0;

            return (
              <tr key={a.scenarioId}>
                <Td>
                  <span style={{ fontWeight: 500, color: "var(--fg)" }}>
                    {a.scenarioName}
                  </span>
                </Td>
                <Td align="right" mono>
                  <span
                    style={{
                      color: a.marketIRR >= 15 ? "var(--pos-fg)" : a.marketIRR > 0 ? "var(--fg)" : "var(--neg-fg)",
                      fontWeight: 500,
                    }}
                  >
                    {a.marketIRR.toFixed(1)}%
                  </span>
                </Td>
                <Td align="right" mono>
                  {r20 ? (r20.maxLandCost > 0 ? won(r20.maxLandCost) : <span style={{ color: "var(--fg-faint)" }}>불가</span>) : "—"}
                </Td>
                <Td align="right" mono>
                  <span style={{ color: r15 && r15.maxLandCost > 0 ? "var(--fg)" : "var(--fg-faint)", fontWeight: 500 }}>
                    {r15 ? (r15.maxLandCost > 0 ? won(r15.maxLandCost) : "불가") : "—"}
                  </span>
                </Td>
                <Td align="right" mono>
                  {r10 ? (r10.maxLandCost > 0 ? won(r10.maxLandCost) : <span style={{ color: "var(--fg-faint)" }}>불가</span>) : "—"}
                </Td>
                <Td align="right" mono>
                  <span
                    style={{
                      color: gapPositive ? "var(--pos-fg)" : "var(--neg-fg)",
                      fontWeight: 500,
                    }}
                  >
                    {gapPositive ? "+" : ""}{won(gap15)}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Footer explanation */}
      <div
        style={{
          padding: "8px 14px",
          fontSize: 11,
          color: "var(--fg-muted)",
          borderTop: "1px solid var(--border-faint)",
          display: "flex",
          gap: 16,
        }}
      >
        <span>
          <span style={{ color: "var(--pos-fg)", fontWeight: 500 }}>+ 갭</span> = 시장가가 더 쌈 (시행 적합)
        </span>
        <span>
          <span style={{ color: "var(--neg-fg)", fontWeight: 500 }}>− 갭</span> = 시장가가 더 비쌈 (시행 부적합)
        </span>
      </div>
    </section>
  );
}

/* ─────────────────────────── 헬퍼 ─────────────────────────── */

function Th({
  children,
  width,
  align = "left",
}: {
  children: React.ReactNode;
  width?: number | string;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        width,
        textAlign: align,
        padding: "0 10px",
        height: 32,
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--fg-muted)",
        background: "var(--bg-sunken)",
        borderBottom: "1px solid var(--border)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "10px",
        borderBottom: "1px solid var(--border-faint)",
        whiteSpace: "nowrap",
        fontFamily: mono ? "var(--font-mono)" : "inherit",
        fontVariantNumeric: mono ? "tabular-nums" : "normal",
      }}
    >
      {children}
    </td>
  );
}
