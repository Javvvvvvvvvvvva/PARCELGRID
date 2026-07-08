"use client";

import { useState } from "react";
import type { LandPriceEstimate } from "@/lib/finance/land-price-from-comps";

/**
 * 예상 토지 인수가 근거 — 구축 다가구 토지 proxy (알고리즘 분석).
 * C 확정 라벨: "토지 시세" 단정 금지, proxy·주의 문구 필수, 참고 사례 표시.
 */
export function LandProxyNote({
  est,
  onApply,
}: {
  est?: LandPriceEstimate | null;
  /** [이 값으로 입력] — 만원 단위 전달 */
  onApply?: (manwon: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!est) return null;

  const eok = (est.estimateManwon / 10_000).toFixed(1);
  const confDots =
    est.confidence === "high" ? "●●●" : est.confidence === "medium" ? "●●○" : "●○○";
  const confLabel =
    est.confidence === "high" ? "높음" : est.confidence === "medium" ? "보통" : "낮음";

  return (
    <div
      style={{
        marginTop: 10,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-sunken)",
        padding: "10px 12px",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            예상 토지 인수가 {eok}억
            <span style={{ fontWeight: 400, color: "var(--fg-muted)", marginLeft: 8 }}>
              대지 평당 {est.medianPPPLand.toLocaleString()}만 · 알고리즘 분석
            </span>
          </div>
          <div style={{ color: "var(--fg-muted)", marginTop: 2 }}>
            근거: {est.basis.replace(" — 거래가÷대지면적 중앙값, 알고리즘 분석", "")} — 거래가÷대지면적 중앙값
            <span style={{ marginLeft: 8 }}>
              신뢰도 <span style={{ letterSpacing: 2 }}>{confDots}</span> {confLabel}
            </span>
          </div>
        </div>
        {onApply && (
          <button
            onClick={() => onApply(est.estimateManwon)}
            style={{
              fontSize: 11.5,
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid var(--accent, #2563eb)",
              background: "var(--accent-soft, #dbeafe)",
              color: "var(--accent, #2563eb)",
              cursor: "pointer",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            이 값으로 입력
          </button>
        )}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          marginTop: 6,
          fontSize: 11,
          padding: "2px 8px",
          borderRadius: 4,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--fg-muted)",
          cursor: "pointer",
        }}
      >
        참고 사례 {est.cases.length}건 {open ? "접기 ▴" : "보기 ▾"}
      </button>

      {open && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--border-faint, var(--border))", paddingTop: 6 }}>
          {est.cases.map((c, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "2px 0",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span>
                <span style={{ color: "var(--fg-muted)", marginRight: 4 }}>{i + 1}.</span>
                {c.address}
                {c.sameDong && (
                  <span style={{ marginLeft: 5, fontSize: 10, color: "var(--accent, #2563eb)", fontWeight: 600 }}>
                    같은 동
                  </span>
                )}
              </span>
              <span className="mono" style={{ color: "var(--fg-muted)" }}>
                {c.buildYear ? `${c.buildYear} · ` : ""}대지 {Math.round(c.lotAreaSqm)}㎡ ·{" "}
                {(c.priceManwon / 10_000).toFixed(1)}억 · 평당 {c.pricePerPyeongLand.toLocaleString()}만
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--fg-subtle)", lineHeight: 1.5 }}>
        주의: {est.caution}. 실제 매입가는 협상·물건 상태에 따라 달라집니다.
      </div>
    </div>
  );
}
