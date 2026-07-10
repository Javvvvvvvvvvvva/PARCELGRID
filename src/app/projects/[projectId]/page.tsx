"use client";

/**
 * 대시보드 (PDF p1 디자인 풀 복원).
 *
 * 3-column 레이아웃:
 *   - 좌: ParcelRail (살아있는 컴포넌트, 별도 layout.tsx에서 렌더)
 *   - 중: 메인 (DecisionBanner + KPI + InvestmentSummary + ScenarioTable)
 *   - 우: RightSidebar (핵심 가정 + 데이터 출처 + 규제 매트릭스 + 다음 작업)
 *
 * 본인 도구 데이터 (ProjectComputed):
 *   parcel, scenarios, pfSchedule, parcelRisks, comps, meta
 */

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/lib/stores/project-store";
import { calculateScenario } from "@/lib/finance/scenario";
import {
  applyEnvelopePlan,
  applyRecommendedPlan,
  recommendedMatchesInput,
} from "@/lib/services/apply-envelope-plan";
import type { EnvelopePlan } from "@/lib/stores/project-store";
import { DecisionBanner, KPI } from "@/components/ui/KPI";
import { ScenarioComparisonCard } from "@/components/ui/ScenarioComparisonCard";
import { ScenarioComparisonTable } from "@/components/ui/ScenarioComparisonTable";
import { WhyRecommendPanel } from "@/components/ui/WhyRecommendPanel";
import { InvestmentSummary } from "@/components/ui/InvestmentSummary";
import { SaleBasisNote } from "@/components/ui/SaleBasisNote";
import { ScenarioTable } from "@/components/ui/ScenarioTable";
import { RiskMatrix } from "@/components/ui/RiskMatrix";
import { MaxAcquisitionPanel } from "@/components/ui/MaxAcquisitionPanel";
import { won, pct, koreanDate } from "@/lib/utils/format";
import type { RiskVM } from "@/lib/adapters/view-model";

export default function DashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const data = useProjectStore((s) => s.data);
  const setData = useProjectStore((s) => s.setData);
  const envelopePlan = useProjectStore((s) => s.envelopePlan);
  const setEnvelopePlan = useProjectStore((s) => s.setEnvelopePlan);
  const draftAssumptions = useProjectStore((s) => s.draftAssumptions);
  const resetDraftAssumptions = useProjectStore((s) => s.resetDraftAssumptions);
  const router = useRouter();
  const [whyOpen, setWhyOpen] = useState(false);
  const [appliedRecommendedMsg, setAppliedRecommendedMsg] = useState<string | null>(
    null
  );
  const [recommendedApplied, setRecommendedApplied] = useState(false);
  const [planBeforeRecommended, setPlanBeforeRecommended] =
    useState<EnvelopePlan | null>(null);

  useEffect(() => {
    if (whyOpen) {
      document
        .getElementById("ai-why-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [whyOpen]);

  // 권장(메인) 시나리오 — KPI live 재계산 대상.
  const recForCalc = data
    ? data.scenarios.find((s) => s.recommended) ?? data.scenarios[0]
    : null;
  const recDraft = recForCalc ? draftAssumptions[recForCalc.id] : undefined;

  // 사이드바에서 가정을 바꾸면(draft) 즉시 재계산 — what-if 반영.
  const editedResult = useMemo(() => {
    if (!recForCalc?._raw || !data?.parcel) return null;
    if (!recDraft || Object.keys(recDraft).length === 0) return null;
    try {
      return calculateScenario({
        parcel: data.parcel,
        scenario: {
          ...recForCalc._raw,
          assumptions: { ...recForCalc._raw.assumptions, ...recDraft },
        },
      });
    } catch {
      return null;
    }
  }, [recForCalc, data?.parcel, recDraft]);

  if (!data) return null;

  const rec = recForCalc!;
  const baseScenario =
    data.scenarios.find((s) => !s.recommended) ?? data.scenarios[1];

  // 편집 반영값 (없으면 원본 VM 값)
  const edited = editedResult != null;
  const kpiProfit = editedResult ? editedResult.profit : rec.profit;
  const kpiMargin = editedResult ? editedResult.profitMargin : rec.profitMargin;
  const kpiEquity = editedResult ? editedResult.equity : rec.equity;
  const kpiPf = editedResult ? editedResult.pfLoan : rec.pf;
  const kpiDscr = editedResult ? editedResult.dscr : rec.dscr;

  const profitDelta = baseScenario
    ? ((kpiProfit - baseScenario.profit) / Math.abs(baseScenario.profit || 1)) *
      100
    : 0;
  const marginDelta = baseScenario
    ? kpiMargin - baseScenario.profitMargin
    : 0;

  const sc = data.scenarioComparison;
  const canApplyRecommended =
    !!sc &&
    !!envelopePlan?.scenarioType &&
    !!sc.input &&
    !recommendedMatchesInput(sc.input, sc.recommended);

  const applyButtonEnabled =
    recommendedApplied || canApplyRecommended;

  const applyRecommendedLabel = recommendedApplied
    ? "다시 누르면 적용 전 내 계획으로 되돌립니다"
    : !envelopePlan?.scenarioType
      ? "먼저 Envelope에서 계획을 설정하세요"
      : sc && sc.input && recommendedMatchesInput(sc.input, sc.recommended)
        ? "이미 권장안과 동일합니다"
        : undefined;

  const handleToggleRecommended = () => {
    if (!data.parcel || !sc || !envelopePlan?.scenarioType) return;

    if (recommendedApplied && planBeforeRecommended) {
      const ok = applyEnvelopePlan(
        data.parcel,
        planBeforeRecommended,
        data,
        setEnvelopePlan,
        setData
      );
      if (ok) {
        setRecommendedApplied(false);
        const prev = planBeforeRecommended;
        setAppliedRecommendedMsg(
          `이전 내 계획으로 되돌렸습니다 — ${prev.floors}층 · ${prev.units > 0 ? `${prev.units}세대` : `${prev.farPct}%`}`
        );
      }
      return;
    }

    if (!canApplyRecommended) return;

    setPlanBeforeRecommended({ ...envelopePlan });
    const ok = applyRecommendedPlan(
      data.parcel,
      sc,
      envelopePlan,
      data,
      setEnvelopePlan,
      setData
    );
    if (ok) {
      setRecommendedApplied(true);
      const rec = sc.recommended;
      setAppliedRecommendedMsg(
        `권장안이 반영되었습니다 — ${rec.floors}층 · ${rec.units > 0 ? `${rec.units}세대` : `${rec.farUsedPct}%`}`
      );
    }
  };

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

        {/* 권장 vs 법적 최대 — 의사결정 도구 */}
        {sc && (
          <>
            {appliedRecommendedMsg && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "var(--pos-fg)",
                  background: "var(--pos-soft)",
                  border: "1px solid var(--pos)",
                  borderRadius: 8,
                  marginBottom: -8,
                }}
              >
                <span style={{ fontWeight: 600 }}>{appliedRecommendedMsg}</span>
                <span style={{ color: "var(--fg-subtle)" }}>
                  {recommendedApplied
                    ? "Envelope·분석에 반영됨 (직접 선택)"
                    : "Envelope·분석에 복원됨"}
                </span>
                <button
                  type="button"
                  onClick={() => setAppliedRecommendedMsg(null)}
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "var(--fg-muted)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  닫기
                </button>
              </div>
            )}
            <ScenarioComparisonCard
              comparison={sc}
              whyOpen={whyOpen}
              onWhyClick={() => setWhyOpen((v) => !v)}
              onApplyRecommended={handleToggleRecommended}
              applyButtonEnabled={applyButtonEnabled}
              recommendedApplied={recommendedApplied}
              applyRecommendedLabel={applyRecommendedLabel}
            />
          </>
        )}

        {/* 상세 비교표 */}
        {data.scenarioComparison && (
          <ScenarioComparisonTable comparison={data.scenarioComparison} />
        )}

        {/* 왜 권장? — 버튼 클릭 시에만 펼침 (규칙 기반 계산 근거) */}
        {data.scenarioComparison && whyOpen && (
          <WhyRecommendPanel comparison={data.scenarioComparison} />
        )}

        {/* 가정 편집 반영 표시 */}
        {edited && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              fontSize: 12,
              color: "var(--accent)",
              background: "var(--accent-soft)",
              border: "1px solid var(--accent)",
              borderRadius: 8,
            }}
          >
            <span style={{ fontWeight: 600 }}>가정 편집 반영됨</span>
            <span style={{ color: "var(--fg-subtle)" }}>
              사이드바에서 수정한 값으로 실시간 재계산 중
            </span>
            <button
              onClick={() => resetDraftAssumptions(rec.id)}
              style={{
                marginLeft: "auto",
                fontSize: 11.5,
                color: "var(--fg)",
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                padding: "3px 8px",
                cursor: "pointer",
              }}
            >
              기본값 복원
            </button>
          </div>
        )}

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
            value={won(kpiProfit)}
            delta={baseScenario ? pct(profitDelta) : undefined}
            deltaKind={profitDelta > 0 ? "pos" : "neg"}
            sub="기준안 대비"
          />
          <KPI
            label="이익률"
            value={kpiMargin.toFixed(1)}
            unit="%"
            delta={baseScenario ? pct(marginDelta) : undefined}
            deltaKind={marginDelta > 0 ? "pos" : "neg"}
            sub="역삼 평균 28.4%"
          />
          <KPI label="필요 자본" value={won(kpiEquity)} sub={`PF ${won(kpiPf)}`} />
          <KPI
            label="DSCR"
            value={kpiDscr.toFixed(2)}
            sub="안정권 ≥ 1.30"
            delta={kpiDscr >= 1.3 ? "안정" : "주의"}
            deltaKind={kpiDscr >= 1.3 ? "pos" : "warn"}
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
        <SaleBasisNote saleEstimate={data.saleEstimate} />

        {/* 최대 시행 가능 인수가 — 본인 도구의 진짜 차별화 */}
        {data.maxAcquisition && data.maxAcquisition.length > 0 && (
          <MaxAcquisitionPanel
            analyses={data.maxAcquisition}
            marketPrice={data.parcel.acquiredPrice}
            marketProxyPrice={
              data.parcel.estMarketPrice && data.parcel.lotArea
                ? Math.round(
                    (data.parcel.estMarketPrice * data.parcel.lotArea) / 10_000
                  )
                : undefined
            }
          />
        )}

        {/* 시나리오 테이블 */}
        <ScenarioTable
          scenarios={data.scenarios}
          projectId={projectId}
          selectedId={rec.id}
          onSelect={(id) =>
            router.push(`/projects/${projectId}/scenarios/${id}`)
          }
        />
      </div>

      {/* ─── 우측 사이드바 ─────────────────────────── */}
      <RightSidebar
        scenario={rec}
        projectId={projectId}
        lastSyncedAt={data.meta.lastSyncedAt}
        risks={data.parcelRisks}
      />
    </div>
  );
}

/* ─────────────────────────── 우측 사이드바 ─────────────────────────── */

function RightSidebar({
  scenario,
  projectId,
  lastSyncedAt,
  risks,
}: {
  scenario: import("@/lib/adapters/view-model").ScenarioVM;
  projectId: string;
  lastSyncedAt: string;
  risks: RiskVM[];
}) {
  const router = useRouter();
  const draft = useProjectStore((s) => s.draftAssumptions[scenario.id]);
  const setDraftAssumption = useProjectStore((s) => s.setDraftAssumption);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [risksOpen, setRisksOpen] = useState(false);

  const effSale = draft?.salePricePerSqM ?? scenario.assumptions.sale;
  const effRent = draft?.rentPerSqMMonth ?? scenario.assumptions.rent;
  const warnCount = risks.filter((r) => r.level === "med" || r.level === "high").length;
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
        <SidebarEditKV
          k="분양가"
          value={effSale}
          unitDivisor={10000}
          unitLabel="만/m²"
          decimals={0}
          source="주변 실거래 기반"
          edited={draft?.salePricePerSqM != null}
          onChange={(v) =>
            setDraftAssumption(scenario.id, "salePricePerSqM", v)
          }
        />
        <SidebarEditKV
          k="임대료"
          value={effRent}
          unitDivisor={10000}
          unitLabel="만/m²/월"
          decimals={1}
          source="기본 가정값 · 수정 필요"
          edited={draft?.rentPerSqMMonth != null}
          onChange={(v) =>
            setDraftAssumption(scenario.id, "rentPerSqMMonth", v)
          }
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
            onClick={() => router.push(`/projects/${projectId}/overrides`)}
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

      {/* 데이터 출처 — 접기/펼치기 */}
      <CollapsibleSidebarPanel
        title="데이터 출처"
        open={sourcesOpen}
        onToggle={() => setSourcesOpen((v) => !v)}
      >
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
      </CollapsibleSidebarPanel>

      {/* 규제 매트릭스 — 접기/펼치기 */}
      <CollapsibleSidebarPanel
        title="규제 매트릭스"
        open={risksOpen}
        onToggle={() => setRisksOpen((v) => !v)}
        badge={
          warnCount > 0 ? (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "var(--warn-fg)",
                background: "var(--warn-soft)",
                borderRadius: 3,
                padding: "1px 6px",
              }}
            >
              {warnCount} 요주의
            </span>
          ) : undefined
        }
      >
        <RiskMatrix risks={risks} showSummary={false} compact />
      </CollapsibleSidebarPanel>

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

/** 접기/펼치기 가능한 사이드바 패널 */
function CollapsibleSidebarPanel({
  title,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--fg-muted)",
            flex: 1,
          }}
        >
          {title}
        </span>
        {badge}
        <span
          style={{
            fontSize: 10,
            color: "var(--fg-faint)",
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          ▼
        </span>
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 0.25s ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              padding: open ? "0 14px 12px" : "0 14px",
              borderTop: open ? "1px solid var(--border-faint)" : "none",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

/** 인라인 편집 가능한 가정값 (분양가·임대료) — 출처 라벨 포함 */
function SidebarEditKV({
  k,
  value,
  unitDivisor,
  unitLabel,
  decimals,
  source,
  edited,
  onChange,
}: {
  k: string;
  value: number;
  unitDivisor: number;
  unitLabel: string;
  decimals: number;
  source: string;
  edited: boolean;
  onChange: (rawValue: number) => void;
}) {
  const display = value / unitDivisor;
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(display.toFixed(decimals));

  useEffect(() => {
    if (!focused) setDraft(display.toFixed(decimals));
  }, [display, decimals, focused]);

  const commit = (raw: string) => {
    const n = parseFloat(raw.replace(/,/g, ""));
    if (!isNaN(n) && n >= 0) onChange(Math.round(n * unitDivisor));
  };

  return (
    <div style={{ padding: "5px 0" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span style={{ color: "var(--fg-muted)", fontSize: 12 }}>{k}</span>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
          <input
            className="mono"
            value={focused ? draft : display.toFixed(decimals)}
            inputMode="decimal"
            onFocus={() => {
              setFocused(true);
              setDraft(display.toFixed(decimals));
            }}
            onChange={(e) => {
              setDraft(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => setFocused(false)}
            style={{
              width: 58,
              textAlign: "right",
              fontSize: 12,
              fontWeight: 600,
              color: edited ? "var(--accent)" : "var(--fg)",
              background: "transparent",
              border: "1px solid var(--border-faint)",
              borderRadius: 4,
              padding: "2px 5px",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--fg-subtle)" }}>
            {unitLabel}
          </span>
        </span>
      </div>
      <div
        style={{
          fontSize: 10.5,
          color: edited ? "var(--accent)" : "var(--fg-faint)",
          marginTop: 1,
        }}
      >
        {edited ? "사용자 수정됨" : source}
      </div>
    </div>
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
