"use client";

import Link from "next/link";
import { useProjectStore } from "@/lib/stores/project-store";
import { DecisionBanner, KPI } from "@/components/ui/KPI";
import { InvestmentSummary } from "@/components/ui/InvestmentSummary";
import { Tag, MiniBar } from "@/components/ui/Tag";
import { Icons } from "@/components/ui/Icons";
import { PFChart } from "@/components/ui/PFChart";
import { won, pct, num, koreanDate } from "@/lib/utils/format";
import { useRouter } from "next/navigation";
import { use } from "react";

export default function DashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const data = useProjectStore((s) => s.data);
  const router = useRouter();

  if (!data) return null;

  const rec = data.scenarios.find((s) => s.recommended) ?? data.scenarios[0];
  const baseScenario = data.scenarios.find((s) => !s.recommended) ?? data.scenarios[1];

  const profitDelta = baseScenario
    ? ((rec.profit - baseScenario.profit) / baseScenario.profit) * 100
    : 0;
  const marginDelta = baseScenario ? rec.profitMargin - baseScenario.profitMargin : 0;

  const maxExposure = data.pfSchedule.reduce(
    (acc, r) => (r.cumulative < acc ? r.cumulative : acc),
    0
  );
  const breakEven = data.pfSchedule.find((r) => r.cumulative >= 0 && data.pfSchedule.indexOf(r) > 0);

  return (
    <div
      style={{
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Decision banner */}
      <DecisionBanner
        scenario={rec}
        onCompare={() => router.push(`/projects/${projectId}/comparison`)}
        onDetail={() => router.push(`/projects/${projectId}/scenarios/${rec.id}`)}
      />

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <KPI
          label="예상 이익"
          value={won(rec.profit)}
          delta={baseScenario ? pct(profitDelta) : undefined}
          deltaKind={profitDelta > 0 ? "pos" : "neg"}
          sub="기준안 대비"
        />
        <KPI
          label="이익률"
          value={rec.profitMargin.toFixed(1)}
          unit="%"
          delta={baseScenario ? pct(marginDelta) : undefined}
          deltaKind={marginDelta > 0 ? "pos" : "neg"}
          sub="역삼 평균 28.4%"
        />
        <KPI
          label="필요 자본"
          value={won(rec.equity)}
          sub={`PF ${won(rec.pf)}`}
        />
        <KPI
          label="DSCR"
          value={rec.dscr.toFixed(2)}
          sub="안정권 ≥ 1.30"
          delta={rec.dscr >= 1.3 ? "안정" : "주의"}
          deltaKind={rec.dscr >= 1.3 ? "pos" : "warn"}
        />
        <KPI
          label="규제 위험"
          value={data.parcel.risk}
          sub={`${data.parcelRisks.length}개 중 ${data.parcelRisks.filter((r) => r.level !== "ok").length}개 협의`}
          delta={
            data.parcelRisks.find((r) => r.level === "high")?.code ?? ""
          }
          deltaKind="neg"
        />
      </div>

      {/* 투자 요약 박스 */}
      <InvestmentSummary scenarios={data.scenarios} defaultScenarioId={rec.id} />

      {/* Scenarios + PF preview */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.55fr 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Scenarios table */}
        <section className="ui-panel">
          <div className="ui-panel__head">
            <span className="ui-panel__title">시나리오</span>
            <span className="ui-panel__sub">
              {data.scenarios.length}개 안 · 최종 갱신 {koreanDate(data.meta.lastSyncedAt)}
            </span>
            <div className="ui-panel__actions">
              <Link
                href={`/projects/${projectId}/comparison`}
                className="ui-btn ui-btn--sm"
                style={{ textDecoration: "none" }}
              >
                {Icons.diff()} 비교
              </Link>
              <button className="ui-btn ui-btn--sm">{Icons.plus()} 새 안</button>
            </div>
          </div>
          <table className="ui-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>안</th>
                <th>유형</th>
                <th className="num">용적률</th>
                <th className="num">연면적</th>
                <th className="num">이익</th>
                <th className="num">DSCR</th>
                <th className="num">IRR</th>
                <th>규제</th>
              </tr>
            </thead>
            <tbody>
              {data.scenarios.map((s) => (
                <tr
                  key={s.id}
                  className={s.recommended ? "selected" : ""}
                  onClick={() =>
                    router.push(`/projects/${projectId}/scenarios/${s.id}`)
                  }
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    {s.recommended ? (
                      <Tag kind="solid">권장</Tag>
                    ) : (
                      <span className="mono" style={{ color: "var(--fg-faint)" }}>
                        {s.id}
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>{s.tag}</div>
                  </td>
                  <td>{s.typeKr}</td>
                  <td className="num">{s.far}%</td>
                  <td className="num">{num(s.gfa)} m²</td>
                  <td className="num" style={{ fontWeight: 500 }}>
                    {won(s.profit)}
                  </td>
                  <td className="num">{s.dscr.toFixed(2)}</td>
                  <td className="num">{s.irr.toFixed(1)}%</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <MiniBar
                        value={s.regulatory}
                        max={100}
                        kind={
                          s.regulatory >= 85
                            ? "pos"
                            : s.regulatory >= 75
                              ? "warn"
                              : "neg"
                        }
                      />
                      <span className="mono" style={{ fontSize: 11 }}>
                        {s.regulatory}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* PF preview */}
        <section className="ui-panel">
          <div className="ui-panel__head">
            <span className="ui-panel__title">PF 현금흐름</span>
            <span className="ui-panel__sub">
              {rec.id} · {data.pfSchedule.length}개 분기
            </span>
            <div className="ui-panel__actions">
              <Link
                href={`/projects/${projectId}/scenarios/${rec.id}`}
                className="ui-btn ui-btn--sm ui-btn--ghost"
                style={{ textDecoration: "none" }}
              >
                전체 →
              </Link>
            </div>
          </div>
          <div style={{ padding: "14px 14px 8px" }}>
            <PFChart rows={data.pfSchedule} height={160} />
          </div>
          <div
            style={{
              padding: "0 14px 12px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              fontSize: 12,
            }}
          >
            <div className="ui-kv">
              <span className="ui-kv__k">최대 노출</span>
              <span className="ui-kv__v" style={{ color: "var(--neg-fg)" }}>
                {won(maxExposure)}
              </span>
            </div>
            <div className="ui-kv">
              <span className="ui-kv__k">손익분기</span>
              <span className="ui-kv__v">{breakEven?.quarter ?? "—"}</span>
            </div>
            <div className="ui-kv">
              <span className="ui-kv__k">PF 한도</span>
              <span className="ui-kv__v">{won(rec.pf)}</span>
            </div>
            <div className="ui-kv">
              <span className="ui-kv__k">사업 기간</span>
              <span className="ui-kv__v">{rec.timeline}개월</span>
            </div>
          </div>
        </section>
      </div>

      {/* Regulatory matrix */}
      <section className="ui-panel">
        <div className="ui-panel__head">
          <span className="ui-panel__title">규제 위험 매트릭스</span>
          <div className="ui-panel__actions">
            <Tag
              kind={
                data.parcelRisks.some((r) => r.level === "high")
                  ? "neg"
                  : data.parcelRisks.some((r) => r.level === "med")
                    ? "warn"
                    : "pos"
              }
            >
              {data.parcelRisks.filter((r) => r.level !== "ok" && r.level !== "low").length} 요주의
            </Tag>
          </div>
        </div>
        <div
          style={{
            padding: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 8,
          }}
        >
          {data.parcelRisks.map((r) => (
            <div
              key={r.code}
              style={{
                display: "grid",
                gridTemplateColumns: "60px 1fr auto",
                gap: 10,
                alignItems: "center",
                padding: "8px 10px",
                background: "var(--bg-sunken)",
                borderRadius: 6,
              }}
            >
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--fg-muted)" }}
              >
                {r.code}
              </span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.label}</div>
                <div style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
                  {r.note}
                </div>
              </div>
              <Tag
                kind={
                  r.level === "high" ? "neg" : r.level === "med" ? "warn" : "pos"
                }
              >
                {r.levelLabel}
              </Tag>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
