"use client";

import Link from "next/link";

/**
 * 홈 페이지. PARCELGRID 진입점.
 *
 * "새 부지 분석"으로 /projects/new로 보내거나,
 * 데모용 sample 프로젝트로 보낼 수 있음.
 */
export default function HomePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        gap: 24,
      }}
    >
      {/* 로고 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 48,
            height: 48,
            background: "var(--fg)",
            color: "var(--bg)",
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 18,
            fontFamily: "var(--font-mono)",
            borderRadius: 6,
          }}
        >
          PG
        </div>
        <div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            PARCELGRID
          </div>
          <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>
            한국 도시 타당성 분석 · v2.4
          </div>
        </div>
      </div>

      {/* 설명 */}
      <div
        style={{
          maxWidth: 560,
          textAlign: "center",
          color: "var(--fg-muted)",
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        시행사·건축·투자팀을 위한 부지 분석 도구. 카카오·V월드·MOLIT 5개 공공
        API를 통합해 부지 정보·인수가·시나리오 4종을 자동 생성합니다.
      </div>

      {/* CTA */}
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <Link
          href="/projects/new"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 16px",
            height: 36,
            background: "var(--fg)",
            color: "var(--bg)",
            borderRadius: 5,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          새 부지 분석 →
        </Link>
        <Link
          href="/projects/sample"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 16px",
            height: 36,
            background: "var(--bg-elev)",
            color: "var(--fg)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          데모 프로젝트 (역삼동)
        </Link>
      </div>
    </div>
  );
}
