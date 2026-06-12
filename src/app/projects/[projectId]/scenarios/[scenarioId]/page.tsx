"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useProjectStore } from "@/lib/stores/project-store";
import { KPI } from "@/components/ui/KPI";
import { Tag } from "@/components/ui/Tag";
import { Icons } from "@/components/ui/Icons";
import { PFChart } from "@/components/ui/PFChart";
import { won, num, pct } from "@/lib/utils/format";

type Tab = "pf" | "tax" | "risk" | "sensitivity" | "assumptions";

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
  const pfRows = data.pfSchedule;
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
        {scenario.recommended && <Tag kind="solid">권장</Tag>}
        <span style={{ marginLeft: 12, fontSize: 11.5, color: "var(--fg-muted)" }}>
          마지막 계산 14분 전
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
            {Icons.doc()} 보고서
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="ui-tabs">
        {(["pf", "tax", "risk", "sensitivity", "assumptions"] as Tab[]).map((t) => (
          <div
            key={t}
            className={"ui-tab" + (tab === t ? " ui-tab--active" : "")}
            onClick={() => setTab(t)}
          >
            {tabLabel(t)}
          </div>
        ))}
      </div>

      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          <KPI label="순이익" value={won(scenario.profit)} delta="+8.2%" deltaKind="pos" sub="기준안 대비" />
          <KPI label="IRR" value={scenario.irr.toFixed(1)} unit="%" sub="달성 목표 15%" />
          <KPI label="Equity Multiple" value={`${scenario.equityMultiple.toFixed(2)}x`} sub={`자본 ${won(scenario.equity)}`} />
          <KPI label="DSCR" value={scenario.dscr.toFixed(2)} delta={scenario.dscr >= 1.3 ? "안정" : "주의"} deltaKind={scenario.dscr >= 1.3 ? "pos" : "warn"} sub="최소 1.20" />
          <KPI label="최대 노출" value={won(maxExposure)} sub={pfRows.find((r) => r.cumulative === maxExposure)?.quarter ?? "—"} />
          <KPI label="회수기간" value={`${scenario.timeline}`} unit="개월" sub="준공 ~ 분양완" />
        </div>

        {tab === "pf" && (
          <PFView pfRows={pfRows} scenario={scenario} maxExposure={maxExposure} breakEven={breakEven?.quarter} />
        )}
        {tab === "tax" && <TaxView />}
        {tab === "risk" && <RiskView />}
        {tab === "sensitivity" && <SensitivityView />}
        {tab === "assumptions" && <AssumptionsView scenario={scenario} projectId={projectId} />}
      </div>
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

function TaxView() {
  return (
    <div style={{ padding: 40, color: "var(--fg-muted)", textAlign: "center" }}>
      세무 상세 — 취득세/재산세/법인세/부가세 분개표.
      <br /> /api/scenarios/calculate 응답의 taxes 필드를 표시 (구현 완료, 화면 연결 예정).
    </div>
  );
}

function RiskView() {
  return (
    <div style={{ padding: 40, color: "var(--fg-muted)", textAlign: "center" }}>
      규제/리스크 매트릭스 — 대시보드의 매트릭스를 풀 사이즈로 표시.
    </div>
  );
}

function SensitivityView() {
  return (
    <div style={{ padding: 40, color: "var(--fg-muted)", textAlign: "center" }}>
      민감도 2D 그리드 — 가정 X, Y 선택 후 5×5 격자 표시.
    </div>
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
        <div className="ui-kv"><span className="ui-kv__k">분양가 (원/m²)</span><span className="ui-kv__v">{num(a.sale / 10000)}만</span></div>
        <div className="ui-kv"><span className="ui-kv__k">Cap Rate</span><span className="ui-kv__v">{a.capRate.toFixed(2)}%</span></div>
        <div className="ui-kv"><span className="ui-kv__k">PF 금리</span><span className="ui-kv__v">{a.intRate.toFixed(2)}%</span></div>
      </div>
    </section>
  );
}
