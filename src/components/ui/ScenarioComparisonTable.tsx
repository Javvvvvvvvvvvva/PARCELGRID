/**
 * 입력 vs 권장 vs 최대 비교표 — 항목별 3열 상세 비교 (의사결정 도구).
 * 내 계획(입력) + 권장 + 최대를 나란히. input 없으면 2열.
 */

import type {
  ScenarioComparison,
  ScenarioOption,
} from "@/lib/finance/scenario-verdict";

function markColor(mark: string): string {
  return mark === "ok"
    ? "var(--pos-fg)"
    : mark === "warn"
    ? "var(--warn)"
    : "var(--neg-fg)";
}
function markIcon(mark: string): string {
  return mark === "ok" ? "✓" : mark === "warn" ? "⚠" : "✕";
}
function gradeColor(grade: string): string {
  if (grade === "높음" || grade === "낮음") return "var(--pos-fg)";
  if (grade === "보통") return "var(--warn)";
  return "var(--neg-fg)";
}

function Stars({ n }: { n: number }) {
  return (
    <span style={{ letterSpacing: 1 }}>
      <span style={{ color: "var(--warn)" }}>{"★".repeat(n)}</span>
      <span style={{ color: "var(--border-strong)" }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

type ColKind = "input" | "recommended" | "max";

function Cell({
  children,
  kind,
}: {
  children: React.ReactNode;
  kind: ColKind;
}) {
  const bg =
    kind === "recommended"
      ? "var(--pos-soft)"
      : kind === "input"
      ? "var(--accent-soft)"
      : "transparent";
  return (
    <td
      style={{
        padding: "10px 14px",
        textAlign: "center",
        borderBottom: "1px solid var(--border-faint)",
        background: bg,
        fontSize: 14,
        color: "var(--fg)",
      }}
    >
      {children}
    </td>
  );
}

function SunCell({ opt, kind }: { opt: ScenarioOption; kind: ColKind }) {
  return (
    <Cell kind={kind}>
      <span style={{ color: markColor(opt.sun.mark), fontWeight: 600 }}>
        {markIcon(opt.sun.mark)} {opt.sun.label}
      </span>
      {opt.sun.remainDepthM !== null && (
        <span style={{ color: "var(--fg-faint)", fontSize: 12, display: "block" }}>
          배치 {opt.sun.remainDepthM.toFixed(1)}m
        </span>
      )}
    </Cell>
  );
}

export function ScenarioComparisonTable({
  comparison,
}: {
  comparison: ScenarioComparison;
}) {
  const { input, recommended: rec, max } = comparison;

  const th: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--fg-muted)",
    borderBottom: "1px solid var(--border)",
    textAlign: "center",
  };
  const label: React.CSSProperties = {
    padding: "10px 14px",
    textAlign: "left",
    fontSize: 13,
    color: "var(--fg-muted)",
    borderBottom: "1px solid var(--border-faint)",
    fontWeight: 500,
  };

  // 행 정의 — 각 옵션에서 값 추출
  const rows: {
    label: string;
    render: (o: ScenarioOption, kind: ColKind) => React.ReactNode;
  }[] = [
    { label: "층수", render: (o, k) => <Cell kind={k}>{o.floors}층</Cell> },
    { label: "연면적", render: (o, k) => <Cell kind={k}>{o.gfaPyeong}평</Cell> },
    { label: "용적률", render: (o, k) => <Cell kind={k}>{o.farUsedPct}%</Cell> },
    {
      label: "세대수",
      render: (o, k) => <Cell kind={k}>{o.units > 0 ? `${o.units}세대` : "—"}</Cell>,
    },
    { label: "정북일조", render: (o, k) => <SunCell opt={o} kind={k} /> },
    {
      label: "주차",
      render: (o, k) => <Cell kind={k}>{o.parking.requiredCars}대</Cell>,
    },
    {
      label: "시공성",
      render: (o, k) => (
        <Cell kind={k}>
          <span style={{ color: gradeColor(o.buildability.grade), fontWeight: 600 }}>
            {o.buildability.grade}
          </span>
        </Cell>
      ),
    },
    {
      label: "법적 리스크",
      render: (o, k) => (
        <Cell kind={k}>
          <span style={{ color: gradeColor(o.legalRisk.grade), fontWeight: 600 }}>
            {o.legalRisk.grade}
          </span>
        </Cell>
      ),
    },
    {
      label: "추천도",
      render: (o, k) => (
        <Cell kind={k}>
          <Stars n={o.stars} />
        </Cell>
      ),
    },
  ];

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        background: "var(--bg-elev)",
        padding: 18,
        overflowX: "auto",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg)", marginBottom: 4 }}>
        상세 비교 — {input ? "내 계획 vs 권장 vs 법적 최대" : "권장 vs 법적 최대"}
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-subtle)", marginBottom: 12 }}>
        세대당 기준면적 {comparison.unitAreaSqm}㎡ · 시나리오 산정 기본값
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>항목</th>
            {input && (
              <th style={{ ...th, color: "var(--accent-fg)" }}>내 계획</th>
            )}
            <th style={{ ...th, color: "var(--pos-fg)" }}>★ 권장안</th>
            <th style={th}>법적 최대</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={label}>{row.label}</td>
              {input && row.render(input, "input")}
              {row.render(rec, "recommended")}
              {row.render(max, "max")}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 12, fontSize: 12, color: "var(--fg-subtle)", lineHeight: 1.5 }}>
        {rec.buildability.note} · {rec.legalRisk.note}
      </div>
    </div>
  );
}
