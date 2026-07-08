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

  // 평당가 오름차순 정렬 + 추정 근거(중앙값)에 가장 가까운 사례 하이라이트
  const sortedCases = [...est.cases].sort(
    (a, b) => a.pricePerPyeongLand - b.pricePerPyeongLand
  );
  const minPPP = sortedCases.length ? sortedCases[0].pricePerPyeongLand : 0;
  const maxPPP = sortedCases.length
    ? sortedCases[sortedCases.length - 1].pricePerPyeongLand
    : 0;
  let medianIdx = -1;
  let bestDiff = Infinity;
  sortedCases.forEach((c, i) => {
    const d = Math.abs(c.pricePerPyeongLand - est.medianPPPLand);
    if (d < bestDiff) {
      bestDiff = d;
      medianIdx = i;
    }
  });

  const COLS = "1.5fr 0.8fr 0.7fr 0.8fr 1fr";

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
        <div style={{ marginTop: 8, borderTop: "1px solid var(--border-faint, var(--border))", paddingTop: 8 }}>
          {/* 요약 */}
          <div style={{ fontSize: 11, color: "var(--fg-muted)", marginBottom: 6 }}>
            {est.cases.length}건 · 평당 {minPPP.toLocaleString()}~{maxPPP.toLocaleString()}만
            <span style={{ marginLeft: 6, color: "var(--fg-faint)" }}>
              · 중앙값 {est.medianPPPLand.toLocaleString()}만 (평당가순)
            </span>
          </div>

          {/* 헤더 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLS,
              gap: 8,
              padding: "0 6px 4px",
              fontSize: 10,
              letterSpacing: "0.03em",
              textTransform: "uppercase",
              color: "var(--fg-faint)",
              borderBottom: "1px solid var(--border-faint, var(--border))",
            }}
          >
            <span>위치</span>
            <span style={{ textAlign: "right" }}>거래일</span>
            <span style={{ textAlign: "right" }}>대지</span>
            <span style={{ textAlign: "right" }}>거래가</span>
            <span style={{ textAlign: "right" }}>평당가</span>
          </div>

          {/* 행 */}
          {sortedCases.map((c, i) => {
            const isMed = i === medianIdx;
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: COLS,
                  gap: 8,
                  padding: "5px 6px",
                  alignItems: "center",
                  fontSize: 11.5,
                  borderLeft: isMed ? "2px solid var(--fg)" : "2px solid transparent",
                  background: isMed ? "var(--bg-sunken)" : "transparent",
                  borderBottom: "1px dashed var(--border-faint, var(--border))",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--fg)",
                      }}
                    >
                      {c.address}
                    </span>
                    {isMed && (
                      <span
                        className="ui-tag ui-tag--solid"
                        style={{ height: 15, fontSize: 9, padding: "0 4px", flexShrink: 0 }}
                      >
                        중앙값
                      </span>
                    )}
                  </div>
                  {c.buildYear != null && (
                    <div style={{ fontSize: 9.5, color: "var(--fg-faint)" }}>
                      준공 {c.buildYear}
                    </div>
                  )}
                </div>
                <span className="mono" style={{ textAlign: "right", color: "var(--fg-muted)" }}>
                  {fmtDealDate(c.date)}
                </span>
                <span className="mono" style={{ textAlign: "right", color: "var(--fg-muted)" }}>
                  {Math.round(c.lotAreaSqm)}㎡
                </span>
                <span className="mono" style={{ textAlign: "right", color: "var(--fg-muted)" }}>
                  {(c.priceManwon / 10_000).toFixed(1)}억
                </span>
                <span
                  className="mono"
                  style={{ textAlign: "right", fontWeight: 600, color: "var(--fg)" }}
                >
                  {c.pricePerPyeongLand.toLocaleString()}만
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--fg-subtle)", lineHeight: 1.5 }}>
        주의: {est.caution}. 실제 매입가는 협상·물건 상태에 따라 달라집니다.
      </div>
    </div>
  );
}

/** 실거래 거래일 문자열 → "YYYY.MM" (형식 불확실해도 견고하게) */
function fmtDealDate(d?: string): string {
  if (!d || d === "—") return "—";
  const digits = d.replace(/[^0-9]/g, "");
  if (digits.length >= 6) return `${digits.slice(0, 4)}.${digits.slice(4, 6)}`;
  if (digits.length >= 4) return digits.slice(0, 4);
  return d;
}
