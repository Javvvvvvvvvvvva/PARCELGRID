import Link from "next/link";
import {
  buildRuntimeReadiness,
  type ReadinessStatus,
} from "@/lib/runtime/readiness";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  ready: "사용 가능",
  review: "설정 필요",
  optional: "선택 설정",
};

const STATUS_COLOR: Record<ReadinessStatus, string> = {
  ready: "var(--pos-fg)",
  review: "var(--neg-fg)",
  optional: "var(--warn-fg)",
};

export default function ReadinessPage() {
  const readiness = buildRuntimeReadiness();

  return (
    <main style={{ minHeight: "100vh", padding: "32px 24px 56px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <Link href="/" style={{ color: "var(--fg-muted)", fontSize: 12 }}>
          ← 홈으로
        </Link>
        <header style={{ margin: "22px 0 18px" }}>
          <p style={{ margin: 0, color: "var(--accent)", fontSize: 10, fontWeight: 800, letterSpacing: ".16em" }}>
            LOCAL RELEASE CHECK
          </p>
          <h1 style={{ margin: "8px 0 7px", fontSize: 30 }}>로컬 환경 진단</h1>
          <p style={{ margin: 0, maxWidth: 720, color: "var(--fg-muted)", fontSize: 13, lineHeight: 1.65 }}>
            비밀 값은 표시하지 않고 기능별 연결 여부만 확인합니다. 설정을 바꾼
            뒤에는 개발 서버를 다시 시작하세요.
          </p>
        </header>

        <section className="readiness-summary-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
          <Summary label="사용 가능" value={readiness.summary.ready} />
          <Summary label="설정 필요" value={readiness.summary.review} />
          <Summary label="선택 설정" value={readiness.summary.optional} />
        </section>

        <section style={{ display: "grid", gap: 10 }}>
          {readiness.checks.map((check) => (
            <article className="readiness-check-row" key={check.id} style={{ display: "grid", gridTemplateColumns: "minmax(150px, .65fr) minmax(170px, .85fr) 2fr", gap: 16, alignItems: "center", padding: "15px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-elev)" }}>
              <div>
                <strong style={{ display: "block", fontSize: 13 }}>{check.label}</strong>
                <span style={{ color: STATUS_COLOR[check.status], fontSize: 10, fontWeight: 800 }}>
                  {STATUS_LABEL[check.status]}
                </span>
              </div>
              <span style={{ color: "var(--fg-muted)", fontSize: 11 }}>{check.scope}</span>
              <div style={{ minWidth: 0 }}>
                <span style={{ display: "block", color: "var(--fg-muted)", fontSize: 11, lineHeight: 1.55 }}>
                  {check.message}
                </span>
                {check.environmentVariables && check.environmentVariables.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", marginTop: 6 }}>
                    {check.environmentVariables.map((variable) => (
                      <code key={variable} style={{ color: "var(--fg-faint)", fontSize: 9.5 }}>
                        {variable}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>

        <footer style={{ marginTop: 18, padding: 14, borderRadius: 9, background: "var(--bg-soft)", color: "var(--fg-muted)", fontSize: 11, lineHeight: 1.65 }}>
          실행 모드: <strong>{readiness.mode}</strong> · API 확인:{" "}
          <code>GET /api/system/readiness</code> · 생성 시각:{" "}
          {readiness.generatedAt}
        </footer>
      </div>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: 16, textAlign: "center", borderRight: "1px solid var(--border)" }}>
      <strong style={{ display: "block", fontSize: 23 }}>{value}</strong>
      <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{label}</span>
    </div>
  );
}
