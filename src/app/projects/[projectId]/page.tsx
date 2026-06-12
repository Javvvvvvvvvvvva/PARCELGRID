"use client";

/**
 * 대시보드 (PDF p1 디자인 풀 복원).
 *
 * 3-column 레이아웃:
 *   - 좌: ParcelRail (살아있는 컴포넌트, 별도 layout.tsx에서 렌더)
 *   - 중: 메인 (DecisionBanner + KPI 5 + InvestmentSummary + ScenarioTable +
 *           PFChart 미니 + CompsTable + RiskMatrix)
 *   - 우: RightSidebar (핵심 가정 + 데이터 출처 + 다음 작업)
 *
 * 본인 도구 데이터 (ProjectComputed):
 *   parcel, scenarios, pfSchedule, parcelRisks, comps, meta
 */

import Link from "next/link";
import { use } from "react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/lib/stores/project-store";
import { DecisionBanner, KPI } from "@/components/ui/KPI";
import { InvestmentSummary } from "@/components/ui/InvestmentSummary";
import { ScenarioTable } from "@/components/ui/ScenarioTable";
import { RiskMatrix } from "@/components/ui/RiskMatrix";
import { CompsTable } from "@/components/ui/CompsTable";
import { PFChart } from "@/components/ui/PFChart";
import { MaxAcquisitionPanel } from "@/components/ui/MaxAcquisitionPanel";
import { won, pct, num, koreanDate } from "@/lib/utils/format";

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
  const baseScenario =
    data.scenarios.find((s) => !s.recommended) ?? data.scenarios[1];

  const profitDelta = baseScenario
    ? ((rec.profit - baseScenario.profit) / Math.abs(baseScenario.profit || 1)) *
      100
    : 0;
  const marginDelta = baseScenario
    ? rec.profitMargin - baseScenario.profitMargin
    : 0;

  const maxExposure = data.pfSchedule.reduce(
    (acc, r) => (r.cumulative < acc ? r.cumulative : acc),
    0
  );
  const breakEven = data.pfSchedule.find(
    (r) => r.cumulative >= 0 && data.pfSchedule.indexOf(r) > 0
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 240px",
        gap: 16,
        padding: 20,
        alignItems: "start",
      }}
    >
      {/* ─── 메인 영역 ─────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Decision banner */}
        <DecisionBanner
          scenario={rec}
          onCompare={() => router.push(`/projects/${projectId}/comparison`)}
          onDetail={() =>
            router.push(`/projects/${projectId}/scenarios/${rec.id}`)
          }
        />

        {/* KPI strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
          }}
        >
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
          <KPI label="필요 자본" value={won(rec.equity)} sub={`PF ${won(rec.pf)}`} />
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
            delta={data.parcelRisks.find((r) => r.level === "high")?.code ?? ""}
            deltaKind="neg"
          />
        </div>

        {/* 투자 요약 박스 (살아있는 InvestmentSummary) */}
        <InvestmentSummary scenarios={data.scenarios} defaultScenarioId={rec.id} />

        {/* 최대 시행 가능 인수가 — 본인 도구의 진짜 차별화 */}
        {data.maxAcquisition && data.maxAcquisition.length > 0 && (
          <MaxAcquisitionPanel
            analyses={data.maxAcquisition}
            marketPrice={data.parcel.acquiredPrice}
          />
        )}

        {/* 시나리오 테이블 + PF 미니 차트 (가로 분할) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.55fr 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          <ScenarioTable
            scenarios={data.scenarios}
            projectId={projectId}
            selectedId={rec.id}
            onSelect={(id) =>
              router.push(`/projects/${projectId}/scenarios/${id}`)
            }
          />

          {/* PF 미니 패널 */}
          <section
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 7,
            }}
          >
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
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--fg-muted)",
                }}
              >
                PF 현금흐름
              </span>
              <span style={{ fontSize: 11.5, color: "var(--fg-subtle)" }}>
                {rec.shortName} · {data.pfSchedule.length}개 분기
              </span>
              <Link
                href={`/projects/${projectId}/scenarios/${rec.id}`}
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  height: 22,
                  padding: "0 7px",
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: "var(--fg)",
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  textDecoration: "none",
                }}
              >
                전체 →
              </Link>
            </div>
            <div style={{ padding: "14px 14px 8px" }}>
              <PFChart rows={data.pfSchedule} height={160} variant="mini" />
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
              <MiniKV
                label="최대 노출"
                value={won(maxExposure)}
                color="var(--neg-fg)"
              />
              <MiniKV label="손익분기" value={breakEven?.quarter ?? "—"} />
              <MiniKV label="PF 한도" value={won(rec.pf)} />
              <MiniKV label="사업 기간" value={`${rec.timeline}개월`} />
            </div>
          </section>
        </div>

        {/* 실거래 + 규제 매트릭스 (가로 분할) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.55fr 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          <CompsTable
            comps={data.comps}
            radiusKm={1.2}
            rangeMonths={12}
            projectId={projectId}
            showViewMore
          />
          <RiskMatrix risks={data.parcelRisks} showSummary />
        </div>
      </div>

      {/* ─── 우측 사이드바 ─────────────────────────── */}
      <RightSidebar
        scenario={rec}
        lastSyncedAt={data.meta.lastSyncedAt}
      />
    </div>
  );
}

/* ─────────────────────────── 우측 사이드바 ─────────────────────────── */

function RightSidebar({
  scenario,
  lastSyncedAt,
}: {
  scenario: import("@/lib/adapters/view-model").ScenarioVM;
  lastSyncedAt: string;
}) {
  // 본인 도구의 진짜 데이터 출처 (백엔드에서 호출하는 API들)
  const dataSources = [
    { name: "국토교통부 실거래가", date: koreanDate(lastSyncedAt) },
    { name: "V월드 (지적/용도지역)", date: koreanDate(lastSyncedAt) },
    { name: "MOLIT 건축물 대장", date: koreanDate(lastSyncedAt) },
    { name: "Kakao 지오코딩", date: koreanDate(lastSyncedAt) },
  ];

  // 다음 작업 — 본인 도구에선 시나리오 기반 자동 제안 가능. 일단 정적 placeholder.
  const nextActions = [
    "건축심의 설계 검토",
    "PF 인디케이션 요청 (시중은행)",
    "주변 임대시세 추가 조사",
    "투자위원회 보고서 준비",
  ];

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        position: "sticky",
        top: 20,
      }}
    >
      {/* 핵심 가정 */}
      <SidebarPanel title="핵심 가정">
        <SidebarKV
          k="임대료"
          v={`${num(scenario.assumptions.rent / 10000, 1)}만/m²/월`}
        />
        <SidebarKV
          k="분양가"
          v={`${num(scenario.assumptions.sale / 10000, 0)}만/m²`}
        />
        <SidebarKV
          k="공실률"
          v={`${scenario.assumptions.vacancy.toFixed(1)}%`}
        />
        <SidebarKV
          k="Cap Rate"
          v={`${scenario.assumptions.capRate.toFixed(1)}%`}
        />
        <SidebarKV
          k="PF 금리"
          v={`${scenario.assumptions.intRate.toFixed(2)}%`}
        />
        <div style={{ padding: "8px 0 0", borderTop: "1px solid var(--border-faint)", marginTop: 8 }}>
          <button
            style={{
              width: "100%",
              height: 26,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--fg)",
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            ✎ 모든 가정 편집
          </button>
        </div>
      </SidebarPanel>

      {/* 데이터 출처 */}
      <SidebarPanel title="데이터 출처">
        {dataSources.map((src, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 0",
              fontSize: 12,
            }}
          >
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "var(--pos)",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "var(--fg)", fontWeight: 500 }}>{src.name}</div>
              <div
                className="mono"
                style={{ fontSize: 10.5, color: "var(--fg-muted)", marginTop: 1 }}
              >
                {src.date}
              </div>
            </div>
          </div>
        ))}
      </SidebarPanel>

      {/* 다음 작업 */}
      <SidebarPanel title="다음 작업">
        {nextActions.map((task, i) => (
          <label
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 7,
              padding: "5px 0",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              style={{
                marginTop: 2,
                width: 14,
                height: 14,
                accentColor: "var(--fg)",
                flexShrink: 0,
              }}
            />
            <span style={{ color: "var(--fg)", lineHeight: 1.4 }}>{task}</span>
          </label>
        ))}
      </SidebarPanel>
    </aside>
  );
}

/* ─────────────────────────── 헬퍼 ─────────────────────────── */

function SidebarPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--fg-muted)",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div>{children}</div>
    </section>
  );
}

function SidebarKV({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "5px 0",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--fg-muted)" }}>{k}</span>
      <span
        className="mono"
        style={{ color: "var(--fg)", fontWeight: 500, fontSize: 12 }}
      >
        {v}
      </span>
    </div>
  );
}

function MiniKV({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "3px 0",
      }}
    >
      <span style={{ color: "var(--fg-muted)", fontSize: 11.5 }}>{label}</span>
      <span
        className="mono"
        style={{
          color: color ?? "var(--fg)",
          fontWeight: 500,
          fontSize: 11.5,
        }}
      >
        {value}
      </span>
    </div>
  );
}
