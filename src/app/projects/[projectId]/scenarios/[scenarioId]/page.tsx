"use client";

import Link from "next/link";
import { use, useState, useMemo } from "react";
import { calculateScenario } from "@/lib/finance/scenario";
import { RiskMatrix } from "@/components/ui/RiskMatrix";
import { calculateTaxes } from "@/lib/finance/tax";
import dynamic from "next/dynamic";
import { useProjectStore } from "@/lib/stores/project-store";
import { KPI } from "@/components/ui/KPI";
import { Tag } from "@/components/ui/Tag";
import { Icons } from "@/components/ui/Icons";
import { PFChart } from "@/components/ui/PFChart";
import { won, num, pct } from "@/lib/utils/format";

type Tab = "pf" | "risk" | "massing";

const MassingView = dynamic(
  () => import("@/components/ui/MassingView").then((m) => m.MassingView),
  { ssr: false, loading: () => <div style={{ height: 280, display: "grid", placeItems: "center", color: "var(--fg-subtle)", fontSize: 12, background: "var(--bg-sunken)", borderRadius: 8 }}>3D 로딩 중…</div> }
);

export default function ScenarioDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; scenarioId: string }>;
}) {
  const { projectId, scenarioId } = use(params);
  const data = useProjectStore((s) => s.data);
  const [tab, setTab] = useState<Tab>("pf");

  if (!data) return null;
  const scenario = data.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) {
    return (
      <div style={{ padding: 40, color: "var(--neg-fg)" }}>
        시나리오 {scenarioId}를 찾을 수 없습니다
      </div>
    );
  }

  // Cashflow data: when viewing the recommended scenario we have the full
  // schedule cached in projectStore; otherwise call the per-scenario API.
  // For now we render the recommended-cached one and note non-recommended
  // shows aggregate fields only (the API endpoint exists to fill this in).
  const pfRows = scenario.recommended ? data.pfSchedule : [];
  const maxExposure = pfRows.reduce(
    (acc, r) => (r.cumulative < acc ? r.cumulative : acc),
    0
  );
  const breakEven = pfRows.find(
    (r, i) => r.cumulative >= 0 && i > 0
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--bg-elev)",
        }}
      >
        <Link
          href={`/projects/${projectId}/comparison`}
          className="ui-btn ui-btn--ghost ui-btn--sm"
          style={{ textDecoration: "none" }}
        >
          ← 비교
        </Link>
        <span className="mono" style={{ fontSize: 13, color: "var(--fg-muted)" }}>
          {scenario.id}
        </span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{scenario.name}</span>
        {scenario.recommended && <Tag kind="solid">비교 우선</Tag>}
        <span style={{ marginLeft: 12, fontSize: 11.5, color: "var(--fg-muted)" }}>
          저장 시점 예비값
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Link
            href={`/projects/${projectId}/overrides`}
            className="ui-btn ui-btn--sm"
            style={{ textDecoration: "none" }}
          >
            {Icons.edit()} 가정 편집
          </Link>
          <button className="ui-btn ui-btn--sm">{Icons.share()} 공유</button>
          <Link
            href={`/projects/${projectId}/report`}
            className="ui-btn ui-btn--sm ui-btn--primary"
            style={{ textDecoration: "none" }}
          >
            {Icons.doc()} 예비 보고서
          </Link>
        </div>
      </div>

      <div
        role="status"
        style={{
          margin: "12px 20px 0",
          padding: "10px 12px",
          border: "1px solid #d8a92e",
          borderRadius: 8,
          background: "#fff8dc",
          color: "#5f4600",
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        예비 사업성 모델 · 전문가 검토 전. 저장된 비교값이며 매입·대출·세무 의사결정용 확정값이 아닙니다.
      </div>

      {/* Tabs */}
      <div className="ui-tabs">
        {(["pf", "risk", "massing"] as Tab[]).map((t) => (
          <div
            key={t}
            className={"ui-tab" + (tab === t ? " ui-tab--active" : "")}
            onClick={() => setTab(t)}
          >
            {tabLabel(t)}
          </div>
        ))}
      </div>

      <div style={{ padding: 20, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 16, alignItems: "start" }}>
        {/* 좌: 메인 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          <KPI label="저장된 세전 손익" value={won(scenario.profit)} sub="세금·미산정 항목 별도" />
          <KPI label="세전 IRR" value={scenario.irrStatus === "calculated" ? scenario.irr.toFixed(1) : "N/A"} unit={scenario.irrStatus === "calculated" ? "%" : undefined} sub="유일한 해가 있을 때만 표시" />
          <KPI label="Equity Multiple" value={`${scenario.equityMultiple.toFixed(2)}x`} sub={`예비 자본 ${won(scenario.equity)}`} />
          <KPI label="DSCR" value={scenario.dscr > 0 ? scenario.dscr.toFixed(2) : "N/A"} sub={scenario.dscr > 0 ? "임대 NOI 기준 예비값" : "분양형 비적용"} />
          <KPI label="최대 노출" value={won(maxExposure)} sub={pfRows.find((r) => r.cumulative === maxExposure)?.quarter ?? "—"} />
          <KPI label="회수기간" value={`${scenario.timeline}`} unit="개월" sub="준공 ~ 매각완" />
        </div>

        {tab === "pf" && (
          scenario.recommended ? (
            <PFView pfRows={pfRows} scenario={scenario} maxExposure={maxExposure} breakEven={breakEven?.quarter} />
          ) : (
            <div style={{ padding: 24, border: "1px solid var(--border)", borderRadius: 8, color: "var(--fg-muted)" }}>
              이 비교안의 개별 현금흐름은 저장되어 있지 않습니다. 다른 계획안의 PF 표를 대신 표시하지 않습니다.
            </div>
          )
        )}
        {tab === "risk" && <RiskView risks={data.parcelRisks} />}
        {tab === "massing" && (
          <div>
            <MassingView
              boundary={data.parcel.boundary}
              zoning={data.parcel.zoning ?? ""}
              floors={scenario.floors.above}
              units={scenario.units.residential}
              roads={data.parcel.roads}
              setback={data.parcel.setback}
              height={560}
            />
            <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 8, display: "flex", gap: 16 }}>
              <span>정북일조 계단식 매스 · 층 클릭 시 세대 정보 · 마우스로 회전·줌</span>
              <span style={{ color: scenario.profit >= 0 ? "var(--pos-fg, #3f6b4d)" : "var(--neg-fg)" }}>
                {scenario.profit >= 0 ? "● 현재 가정상 세전 흑자" : "● 현재 가정상 세전 손실"}
              </span>
            </div>
          </div>
        )}
        </div>

        {/* 우: 사이드바 (PDF p3) */}
        <ScenarioSidebar scenario={scenario} />
      </div>
    </div>
  );
}

/* ─── 우측 사이드바 ─────────────────────────────── */
function ScenarioSidebar({ scenario }: { scenario: ScenarioSidebarVM }) {
  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 16 }}>
      {/* 건축 프로그램 */}
      <SideBlock title="건축 프로그램">
        <SideKV k="용적률" v={`${scenario.far.toFixed(0)}%`} sub={`상한 ${scenario.maxFar ?? 250}%`} />
        <SideKV k="건폐율" v={`${scenario.bcr.toFixed(0)}%`} sub={`상한 ${scenario.maxBcr ?? 60}%`} />
        <SideKV k="연면적" v={`${num(scenario.gfa)} m²`} />
        <SideKV k="층수" v={`${scenario.floors.above}F / B${scenario.floors.below}`} />
      </SideBlock>

      {/* 호실 구성 */}
      <SideBlock title="호실 구성">
        <SideKV k="주거" v={`${scenario.units.residential}호`} />
        <SideKV k="근린생활" v={`${scenario.units.retail}실`} />
      </SideBlock>

      {/* 핵심 가정 (잠금) */}
      <SideBlock title="핵심 가정">
        <SideKV k="임대료" v={`${num(scenario.assumptions.rent / 10000)}만/m²/월`} />
        <SideKV k="매각 단가" v={`${num(scenario.assumptions.sale / 10000)}만/m²`} />
        <SideKV k="Cap Rate" v={`${scenario.assumptions.capRate.toFixed(1)}%`} />
        <SideKV k="PF 금리" v={`${scenario.assumptions.intRate.toFixed(2)}%`} />
      </SideBlock>
    </aside>
  );
}

interface ScenarioSidebarVM {
  far: number; bcr: number; gfa: number;
  maxFar?: number; maxBcr?: number;
  floors: { above: number; below: number };
  units: { residential: number; retail: number };
  assumptions: { rent: number; sale: number; capRate: number; intRate: number };
}

function SideBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-elev)" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.04em", color: "var(--fg-muted)" }}>
        {title}
      </div>
      <div style={{ padding: "4px 12px 8px" }}>{children}</div>
    </section>
  );
}

function SideKV({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle, rgba(0,0,0,0.04))", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{k}</span>
      <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono, monospace)", textAlign: "right" }}>
        {v}{sub && <span style={{ fontSize: 11, fontWeight: 400, color: "var(--fg-subtle, #aaa)", marginLeft: 4 }}>/ {sub}</span>}
      </span>
    </div>
  );
}

function tabLabel(t: Tab): string {
  return (
    {
      pf: "PF / 현금흐름",
      tax: "세무",
      risk: "규제 / 리스크",
      sensitivity: "민감도",
      assumptions: "가정",
      massing: "3D 매싱",
    } as const
  )[t];
}

function PFView({
  pfRows,
  scenario,
  maxExposure,
  breakEven,
}: {
  pfRows: ReturnType<typeof useProjectStore.getState>["data"] extends infer T
    ? T extends null ? never : T extends { pfSchedule: infer U } ? U : never
    : never;
  scenario: { id: string; equityMultiple: number };
  maxExposure: number;
  breakEven?: string;
}) {
  return (
    <>
      <section className="ui-panel">
        <div className="ui-panel__head">
          <span className="ui-panel__title">분기별 현금흐름</span>
          <span className="ui-panel__sub">
            {pfRows[0]?.quarter} ~ {pfRows[pfRows.length - 1]?.quarter} ·{" "}
            {pfRows.length} 분기
          </span>
          <div className="ui-panel__actions">
            <button className="ui-btn ui-btn--sm ui-btn--ghost">{Icons.download()}</button>
          </div>
        </div>
        <div style={{ padding: "20px 16px" }}>
          <PFChart rows={pfRows} height={280} variant="full" />
        </div>
        <table className="ui-table">
          <thead>
            <tr>
              <th>분기</th>
              <th>단계</th>
              <th className="num">유출</th>
              <th className="num">유입</th>
              <th className="num">분기 순</th>
              <th className="num">누적</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {pfRows.map((r) => (
              <tr key={r.quarter}>
                <td className="mono">{r.quarter}</td>
                <td>{r.phase}</td>
                <td className="num" style={{ color: r.outflow > 0 ? "var(--neg-fg)" : "var(--fg-faint)" }}>
                  {r.outflow > 0 ? won(r.outflow) : "—"}
                </td>
                <td className="num" style={{ color: r.inflow > 0 ? "var(--pos-fg)" : "var(--fg-faint)" }}>
                  {r.inflow > 0 ? won(r.inflow) : "—"}
                </td>
                <td className="num" style={{ color: r.net >= 0 ? "var(--pos-fg)" : "var(--neg-fg)" }}>
                  {r.net >= 0 ? "+" : ""}{won(r.net)}
                </td>
                <td className="num" style={{ fontWeight: 500, color: r.cumulative >= 0 ? "var(--pos-fg)" : "var(--fg)" }}>
                  {won(r.cumulative)}
                </td>
                <td style={{ fontSize: 12, color: "var(--fg-muted)" }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function TaxView({
  scenario,
  parcel,
}: {
  scenario: { _raw?: import("@/lib/finance/types").Scenario };
  parcel: import("@/lib/finance/types").Parcel;
}) {
  const raw = scenario._raw;
  const breakdown = useMemo(() => {
    if (!raw || !parcel) return null;
    try {
      const result = calculateScenario({ parcel, scenario: raw });
      const share = raw.program?.mix?.residentialSale ?? 0.7;
      return calculateTaxes({ parcel, result, residentialSaleShare: share });
    } catch {
      return null;
    }
  }, [raw, parcel]);

  if (!breakdown) {
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)", textAlign: "center" }}>
        세무 계산에 필요한 데이터가 없습니다. 부지를 다시 분석해 주세요.
      </div>
    );
  }

  return (
    <section className="ui-panel">
      <div className="ui-panel__head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="ui-panel__title">세무 분개</span>
        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
          총 세부담 {won(breakdown.total)}
        </span>
      </div>
      <div style={{ padding: 16 }}>
        <table className="ui-table">
          <thead>
            <tr>
              <th>세목</th>
              <th>과세 대상</th>
              <th className="num">세율</th>
              <th className="num">세액</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.lines.map((l: import("@/lib/finance/types").TaxLine, i: number) => {
              const firstOfTax =
                i === 0 || breakdown.lines[i - 1].tax !== l.tax;
              return (
                <tr key={i}>
                  <td>{firstOfTax ? l.tax : ""}</td>
                  <td>{l.base}</td>
                  <td className="num">{l.rate}</td>
                  <td className="num">{won(l.amount)}</td>
                  <td style={{ fontSize: 11, color: "var(--fg-subtle)" }}>{l.note}</td>
                </tr>
              );
            })}
            <tr className="ui-table__total">
              <td colSpan={3}>총 세부담</td>
              <td className="num">{won(breakdown.total)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RiskView({ risks }: { risks: import("@/lib/adapters/view-model").RiskVM[] }) {
  if (!risks || risks.length === 0) {
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)", textAlign: "center" }}>
        규제 검토 항목이 없습니다.
      </div>
    );
  }
  const warn = risks.filter((r) => r.level === "med" || r.level === "high").length;
  return (
    <section className="ui-panel">
      <div className="ui-panel__head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="ui-panel__title">규제 / 리스크 검토</span>
        <span style={{ fontSize: 11, color: warn > 0 ? "var(--warn-fg, var(--warn))" : "var(--pos-fg, var(--pos))" }}>
          {risks.length}개 항목 · {warn > 0 ? `${warn}건 요주의` : "전체 정상"}
        </span>
      </div>
      <div style={{ padding: 16 }}>
        <RiskMatrix risks={risks} showSummary={false} />
      </div>
    </section>
  );
}

function SensitivityView({
  scenario,
  parcel,
}: {
  scenario: { _raw?: import("@/lib/finance/types").Scenario };
  parcel: import("@/lib/finance/types").Parcel;
}) {
  const raw = scenario._raw;
  if (!raw || !parcel) {
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)", textAlign: "center" }}>
        민감도 분석에 필요한 데이터가 없습니다. 부지를 다시 분석해 주세요.
      </div>
    );
  }

  const SALE_STEPS = [-10, -5, 0, 5, 10]; // 분양가 %
  const RATE_STEPS = [-2, -1, 0, 1, 2]; // 금리 %p

  // 25칸 재계산
  const grid = RATE_STEPS.map((dr) =>
    SALE_STEPS.map((ds) => {
      const a = {
        ...raw.assumptions,
        salePricePerSqM: Math.round(raw.assumptions.salePricePerSqM * (1 + ds / 100)),
        interestRate: raw.assumptions.interestRate + dr,
      };
      try {
        const r = calculateScenario({ parcel, scenario: { ...raw, assumptions: a } });
        return r.profit; // 만원
      } catch {
        return null;
      }
    })
  );

  const flat = grid.flat().filter((v): v is number => v != null);
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const baseVal = grid[2]?.[2] ?? null;

  // 순이익 → 색 (낮음 연한 / 높음 진한 녹색, 손실은 빨강)
  const colorOf = (v: number | null) => {
    if (v == null) return "var(--bg-sunken)";
    if (v < 0) {
      const t = max > 0 ? Math.min(1, Math.abs(v) / Math.abs(min || 1)) : 1;
      return `rgba(192, 57, 43, ${0.12 + t * 0.4})`;
    }
    const t = max > min ? (v - Math.max(0, min)) / (max - Math.max(0, min)) : 0.5;
    return `rgba(46, 139, 87, ${0.12 + t * 0.5})`;
  };

  const fmtEok = (v: number | null) =>
    v == null ? "—" : `${(v / 10000).toFixed(1)}억`;

  return (
    <section className="ui-panel">
      <div className="ui-panel__head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="ui-panel__title">민감도 분석 — 순이익</span>
        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
          기준 {fmtEok(baseVal)} · 매각가 × PF금리
        </span>
      </div>
      <div style={{ padding: 20, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", margin: "0 auto" }}>
          <tbody>
            <tr>
              <td colSpan={2} />
              <td colSpan={5} style={{ textAlign: "center", fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, paddingBottom: 8 }}>
                매각가 변동 →
              </td>
            </tr>
            <tr>
              <td />
              <td />
              {SALE_STEPS.map((s) => (
                <td key={s} style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-mono, monospace)", padding: "6px 10px", textAlign: "center" }}>
                  {s === 0 ? "기준" : `${s > 0 ? "+" : ""}${s}%`}
                </td>
              ))}
            </tr>
            {grid.map((row, ri) => (
              <tr key={ri}>
                {ri === 0 && (
                  <td rowSpan={5} style={{ fontSize: 11, color: "var(--fg-muted)", fontWeight: 600, writingMode: "vertical-rl", transform: "rotate(180deg)", paddingRight: 8, textAlign: "center" }}>
                    ← PF 금리 변동
                  </td>
                )}
                <td style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-mono, monospace)", padding: "6px 10px", whiteSpace: "nowrap" }}>
                  {RATE_STEPS[ri] === 0 ? "기준" : `${RATE_STEPS[ri] > 0 ? "+" : ""}${RATE_STEPS[ri]}%p`}
                </td>
                {row.map((v, ci) => {
                  const isBase = ri === 2 && ci === 2;
                  return (
                    <td
                      key={ci}
                      style={{
                        width: 76,
                        height: 48,
                        textAlign: "center",
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: 13,
                        fontWeight: 600,
                        border: "1px solid #fff",
                        background: colorOf(v),
                        outline: isBase ? "2px solid var(--accent)" : undefined,
                        outlineOffset: isBase ? "-2px" : undefined,
                        color: v != null && v < 0 ? "var(--neg-fg, #9b2d22)" : "var(--fg)",
                      }}
                    >
                      {fmtEok(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "center", marginTop: 16, fontSize: 11, color: "var(--fg-muted)" }}>
          <span><span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3, background: "rgba(46,139,87,0.18)", verticalAlign: "middle", marginRight: 4 }} />낮음</span>
          <span><span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3, background: "rgba(46,139,87,0.55)", verticalAlign: "middle", marginRight: 4 }} />높음</span>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>□ 현재 가정</span>
        </div>
      </div>
    </section>
  );
}

function AssumptionsView({ scenario, projectId }: { scenario: { assumptions: { rent: number; sale: number; capRate: number; intRate: number } }; projectId: string }) {
  const a = scenario.assumptions;
  return (
    <section className="ui-panel">
      <div className="ui-panel__head">
        <span className="ui-panel__title">핵심 가정</span>
        <div className="ui-panel__actions">
          <Link href={`/projects/${projectId}/overrides`} className="ui-btn ui-btn--sm" style={{ textDecoration: "none" }}>
            {Icons.edit()} 편집
          </Link>
        </div>
      </div>
      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        <div className="ui-kv"><span className="ui-kv__k">임대료 (원/m²/월)</span><span className="ui-kv__v">{num(a.rent / 10000)}만</span></div>
        <div className="ui-kv"><span className="ui-kv__k">매각 단가 (원/m²)</span><span className="ui-kv__v">{num(a.sale / 10000)}만</span></div>
        <div className="ui-kv"><span className="ui-kv__k">Cap Rate</span><span className="ui-kv__v">{a.capRate.toFixed(2)}%</span></div>
        <div className="ui-kv"><span className="ui-kv__k">PF 금리</span><span className="ui-kv__v">{a.intRate.toFixed(2)}%</span></div>
      </div>
    </section>
  );
}
