"use client";

import { useState } from "react";
import type { SalePriceEstimate } from "@/lib/finance/sale-price-from-comps";

/**
 * 매각 단가 산정 근거 — 알고리즘 분석 (Comparable).
 * 형 리포트: "비용은 숫자보다 출처·계산식이 신뢰도" / C: "사용자는 평균보다 사례를 신뢰한다".
 * 투자요약 바로 아래에 배치.
 */
export function SaleBasisNote({
  saleEstimate,
}: {
  saleEstimate?: SalePriceEstimate | null;
}) {
  const [open, setOpen] = useState(false);
  if (!saleEstimate) return null;
  const e = saleEstimate;

  const confDots =
    e.confidence === "high" ? "●●●" : e.confidence === "medium" ? "●●○" : "●○○";
  const confLabel =
    e.confidence === "high" ? "높음" : e.confidence === "medium" ? "보통" : "낮음";
  const manPerSqM = Math.round(e.salePricePerSqM / 10_000);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderTop: "none",
        borderRadius: "0 0 8px 8px",
        background: "var(--bg-sunken)",
        padding: "12px 20px",
        fontSize: 12.5,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontWeight: 600 }}>
            매각 단가 {manPerSqM.toLocaleString()}만/㎡ (평당 {e.medianPPP.toLocaleString()}만)
          </span>
          <span style={{ color: "var(--fg-muted)", marginLeft: 8 }}>
            알고리즘 분석 — {e.basis.replace(" — 알고리즘 분석", "")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--fg-muted)" }}>
            신뢰도 <span style={{ letterSpacing: 2 }}>{confDots}</span> {confLabel}
          </span>
          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              fontSize: 11.5,
              padding: "3px 10px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--fg-muted)",
              cursor: "pointer",
            }}
          >
            참고 사례 {e.cases.length}건 {open ? "접기 ▴" : "보기 ▾"}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--border-faint, var(--border))", paddingTop: 8 }}>
          {e.cases.map((c, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "3px 0",
                color: "var(--fg)",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span>
                <span style={{ color: "var(--fg-muted)", marginRight: 6 }}>{i + 1}.</span>
                {c.address}
                {c.sameDong && (
                  <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--accent, #2563eb)", fontWeight: 600 }}>
                    같은 동
                  </span>
                )}
              </span>
              <span className="mono" style={{ color: "var(--fg-muted)" }}>
                {c.buildYear ? `${c.buildYear} 준공 · ` : ""}
                {c.priceWon ? `${(c.priceWon / 1e8).toFixed(1)}억 · ` : ""}
                평당 {c.pricePerPyeong.toLocaleString()}만
              </span>
            </div>
          ))}
          <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--fg-subtle)", lineHeight: 1.5 }}>
            보수 기준: 주변 단독/다가구 전체 {e.conservativeCount}건 중앙값 평당{" "}
            {e.conservativePPP.toLocaleString()}만. 산정은 같은 동·준공 연식 가중 상위 사례의
            연면적 기준 평당 중앙값이며, 감정평가·시세 보증이 아닙니다.
          </div>
        </div>
      )}
    </div>
  );
}
