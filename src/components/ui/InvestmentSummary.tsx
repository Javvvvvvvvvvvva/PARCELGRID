"use client";

import { useState } from "react";
import type { ScenarioVM } from "@/lib/adapters/view-model";
import { won, pct } from "@/lib/utils/format";

interface Props {
  scenarios: ScenarioVM[];
  defaultScenarioId?: string;
}

/**
 * 투자 요약 박스 — 한 화면에 투입 비용 vs 산출 + 순이익.
 *
 * 시나리오 4개 탭으로 전환 가능. S4 권장이 기본.
 */
export function InvestmentSummary({ scenarios, defaultScenarioId }: Props) {
  const initialId =
    defaultScenarioId ??
    scenarios.find((s) => s.recommended)?.id ??
    scenarios[0]?.id ??
    "";

  const [activeId, setActiveId] = useState(initialId);
  const active = scenarios.find((s) => s.id === activeId) ?? scenarios[0];

  // DEBUG: 매출 0 진단 (작업 후 제거 예정)
  if (typeof window !== "undefined" && active) {
    console.log("[InvestmentSummary] active scenario:", active.id, active.name);
    console.log("  revenueSale:", active.revenueSale);
    console.log("  revenueLease:", active.revenueLease);
    console.log("  revenueRetail:", active.revenueRetail);
    console.log("  revenue (total):", active.revenue);
    console.log("  gfa:", active.gfa, "effectiveGFA:", (active as any).effectiveGFA);
    console.log("  parkingSpaces:", (active as any).parkingSpaces, "coreArea:", (active as any).coreArea);
  }

  if (!active) return null;

  // 비용 항목 (0인 것은 표시 안 함)
  const costRows = [
    { label: "인수가", value: active.landCost, prefix: "" },
    { label: "철거비", value: active.demolitionCost, prefix: "+" },
    { label: "공사비", value: active.hardCost, prefix: "+" },
    { label: "설계/감리", value: active.softCost, prefix: "+" },
    { label: "예비비", value: active.contingency, prefix: "+" },
    { label: "금융비", value: active.financingCost, prefix: "+" },
  ].filter((r) => r.value > 0);

  const revenueRows = [
    { label: "매각 수입", value: active.revenueSale },
    { label: "임대 가치", value: active.revenueLease },
    { label: "상가 가치", value: active.revenueRetail },
  ].filter((r) => r.value > 0);

  const totalCost = active.cost;
  const totalRevenue = active.revenue;
  const profit = active.profit;
  const profitMargin = active.profitMargin;
  const profitPositive = profit >= 0;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      {/* Header with scenario tabs */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--fg-muted)",
          }}
        >
          투자 요약 — {active.shortName} {active.recommended && "권장"}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {scenarios.map((s) => {
            const isActive = s.id === activeId;
            return (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                style={{
                  fontSize: 11.5,
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: isActive ? "var(--fg)" : "var(--bg)",
                  color: isActive ? "var(--bg)" : "var(--fg-muted)",
                  cursor: "pointer",
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {s.shortName}
                {s.recommended && " ★"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body: 좌우 2단 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
        }}
      >
        {/* 좌: 투입 비용 */}
        <div
          style={{
            padding: "16px 20px",
            borderRight: "1px solid var(--border-faint)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--fg-muted)",
              marginBottom: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            투입
          </div>
          {costRows.map((r) => (
            <div
              key={r.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                padding: "4px 0",
                color: "var(--fg)",
              }}
            >
              <span style={{ color: "var(--fg-muted)" }}>{r.label}</span>
              <span className="mono">
                {r.prefix}
                {won(r.value)}
              </span>
            </div>
          ))}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              marginTop: 8,
              paddingTop: 8,
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <span>총 투입</span>
            <span className="mono">{won(totalCost)}</span>
          </div>
        </div>

        {/* 우: 산출 */}
        <div style={{ padding: "16px 20px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--fg-muted)",
              marginBottom: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            산출
          </div>
          {revenueRows.length > 0 ? (
            revenueRows.map((r) => (
              <div
                key={r.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  padding: "4px 0",
                  color: "var(--fg)",
                }}
              >
                <span style={{ color: "var(--fg-muted)" }}>{r.label}</span>
                <span className="mono">{won(r.value)}</span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: "var(--fg-muted)", padding: "4px 0" }}>
              매출 데이터 없음
            </div>
          )}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              marginTop: 8,
              paddingTop: 8,
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <span>총 산출</span>
            <span className="mono">{won(totalRevenue)}</span>
          </div>
        </div>
      </div>

      {/* Footer: 이익 요약 */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: "12px 20px",
          background: profitPositive ? "var(--pos-soft)" : "var(--neg-soft)",
          color: profitPositive ? "var(--pos-fg)" : "var(--neg-fg)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <span style={{ fontSize: 11, opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            순 이익
          </span>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
            {profitPositive && "+"}
            <span className="mono">{won(profit)}</span>
            <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 8 }}>
              ({profitPositive && "+"}
              {profitMargin.toFixed(1)}%)
            </span>
          </div>
          {active.profitAtLowCost != null && active.profitAtHighCost != null && (
            <div style={{ fontSize: 11.5, marginTop: 4, opacity: 0.85 }}>
              공사비 범위 손익 — Low(-15%) {active.profitAtLowCost >= 0 ? "+" : ""}
              <span className="mono">{won(active.profitAtLowCost)}</span> · High(+20%){" "}
              {active.profitAtHighCost >= 0 ? "+" : ""}
              <span className="mono">{won(active.profitAtHighCost)}</span>
              {active.constructionCostLow != null && active.constructionCostHigh != null && (
                <span style={{ marginLeft: 8, opacity: 0.75 }}>
                  (공사비 {won(active.constructionCostLow)}~{won(active.constructionCostHigh)} — 견적 아님)
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
          <div>
            <span style={{ opacity: 0.8 }}>IRR </span>
            <span className="mono" style={{ fontWeight: 600 }}>
              {active.irr.toFixed(1)}%
            </span>
          </div>
          <div>
            <span style={{ opacity: 0.8 }}>DSCR </span>
            <span className="mono" style={{ fontWeight: 600 }}>
              {active.dscr.toFixed(2)}x
            </span>
          </div>
          <div>
            <span style={{ opacity: 0.8 }}>회수 </span>
            <span className="mono" style={{ fontWeight: 600 }}>
              {active.timeline}개월
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
