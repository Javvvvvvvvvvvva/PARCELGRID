"use client";

/**
 * 규제 위험 매트릭스 — 대시보드 (PDF p1).
 *
 * 5개 규제 항목을 카드 형태로 표시:
 *   GFA-01 용적률 상한 여유 [정상]
 *   SUN-02 일조권 사선제한 [주의]
 *   PRK-04 주차 대수 충족 [정상]
 *   CUL-01 문화재 보호구역 [협의]
 *   ENV-03 환경영향평가 [정상]
 *
 * 본인 도구 데이터: RiskVM (code, label, level, levelLabel, note)
 */

import type { RiskVM } from "@/lib/adapters/view-model";

interface RiskMatrixProps {
  risks: RiskVM[];
  /** 헤더에 표시될 요약 개수 (예: "1 요주의") */
  showSummary?: boolean;
  /** 사이드바 등 좁은 영역 — 외곽 패널·헤더 없이 행만 */
  compact?: boolean;
}

export function RiskMatrix({ risks, showSummary = true, compact = false }: RiskMatrixProps) {
  // 주의/협의 항목 카운트
  const warnCount = risks.filter((r) => r.level === "med" || r.level === "high").length;

  const rows = (
    <>
      {risks.map((r) => (
        <RiskRow key={r.code} risk={r} compact={compact} />
      ))}
      {risks.length === 0 && (
        <div
          style={{
            padding: compact ? "12px 0" : 24,
            textAlign: "center",
            color: "var(--fg-faint)",
            fontSize: 12.5,
          }}
        >
          규제 데이터 없음
        </div>
      )}
    </>
  );

  if (compact) {
    return <div style={{ paddingTop: 8 }}>{rows}</div>;
  }

  return (
    <div
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
          규제 위험 매트릭스
        </div>
        {showSummary && warnCount > 0 && (
          <div style={{ marginLeft: "auto" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                background: "var(--warn-soft)",
                color: "var(--warn-fg)",
                border: "1px solid color-mix(in oklch, var(--warn) 25%, transparent)",
                fontSize: 10.5,
                fontWeight: 500,
                borderRadius: 3,
                fontFamily: "var(--font-mono)",
              }}
            >
              {warnCount} 요주의
            </span>
          </div>
        )}
      </div>

      {/* Risk rows */}
      <div style={{ padding: 6 }}>{rows}</div>
    </div>
  );
}

/* ─────────────────────────── Risk row ─────────────────────────── */

function RiskRow({ risk, compact = false }: { risk: RiskVM; compact?: boolean }) {
  const statusKind: "pos" | "warn" | "neg" =
    risk.level === "high" ? "neg" : risk.level === "med" ? "warn" : "pos";

  const statusLabel =
    risk.level === "high"
      ? "협의"
      : risk.level === "med"
        ? "주의"
        : risk.level === "low"
          ? "확인"
          : "정상";

  const pillStyle = {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    gap: 4,
    height: 18,
    padding: "0 7px",
    fontSize: 10.5,
    fontWeight: 500,
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.02em",
    background:
      statusKind === "neg"
        ? "var(--neg-soft)"
        : statusKind === "warn"
          ? "var(--warn-soft)"
          : "var(--pos-soft)",
    color:
      statusKind === "neg"
        ? "var(--neg-fg)"
        : statusKind === "warn"
          ? "var(--warn-fg)"
          : "var(--pos-fg)",
    border: `1px solid color-mix(in oklch, var(--${statusKind === "neg" ? "neg" : statusKind === "warn" ? "warn" : "pos"}) 25%, transparent)`,
    borderRadius: 3,
    textTransform: "uppercase" as const,
  };

  if (compact) {
    return (
      <div
        style={{
          padding: "8px 0",
          borderBottom: "1px solid var(--border-faint)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg)", flex: 1 }}>
            {risk.label}
          </div>
          <span style={{ ...pillStyle, height: 16, fontSize: 10 }}>{statusLabel}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.4 }}>
          {risk.note}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 12px",
        gap: 12,
        borderRadius: 5,
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-sunken)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--fg-faint)",
          minWidth: 56,
          fontWeight: 500,
        }}
      >
        {risk.code}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg)" }}>
          {risk.label}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 1 }}>
          {risk.note}
        </div>
      </div>
      <div>
        <span style={pillStyle}>{statusLabel}</span>
      </div>
    </div>
  );
}
