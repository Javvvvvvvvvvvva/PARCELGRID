"use client";
import { FacadeCostSummary } from "@/components/planning/FacadeCostSummary";

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
import { won, num } from "@/lib/utils/format";
import type { HoldPeriodLedgerResult } from "@/lib/finance/hold-period-ledger";
import {
  buildAfterTaxLedger,
  buildExpertTaxContractKey,
} from "@/lib/finance/after-tax-ledger";
import type { ScenarioVM } from "@/lib/adapters/view-model";

type Tab =
  | "pf"
  | "tax"
  | "risk"
  | "sensitivity"
  | "assumptions"
  | "massing";

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

  // The project snapshot caches the schedule for its current comparison
  // focus. Other candidates keep aggregate metrics only in this legacy view.
  const pfRows = scenario.recommended ? data.pfSchedule : [];
  const maxExposure = pfRows.reduce(
    (acc, r) => (r.cumulative < acc ? r.cumulative : acc),
    0
  );
  const breakEven = pfRows.find(
    (r, i) => r.cumulative >= 0 && i > 0
  );

  return (
    <div className="scenario-detail-page">
      {/* Header */}
      <div className="scenario-detail-header">
        <div className="scenario-detail-identity">
          <Link
            href={`/projects/${projectId}/comparison`}
            className="ui-btn ui-btn--ghost ui-btn--sm"
            style={{ textDecoration: "none" }}
          >
            ← 비교
          </Link>
          <span className="mono scenario-detail-id">{scenario.id}</span>
          <strong className="scenario-detail-name">{scenario.name}</strong>
          {scenario.recommended && <Tag kind="solid">현재 비교 기준</Tag>}
          <span className="scenario-detail-state">저장 시점 예비값</span>
        </div>
        <div className="scenario-detail-actions">
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

      <div style={{ margin: 20 }}><FacadeCostSummary cost={scenario._raw?.program.areaContract?.facadeCost} /></div>
      <div
        className="scenario-detail-notice"
        role="status"
      >
        예비 사업성 모델 · 전문가 검토 전. 저장된 비교값이며 매입·대출·세무 의사결정용 확정값이 아닙니다.
      </div>

      {/* Tabs */}
      <div className="ui-tabs scenario-detail-tabs">
        {(["pf", "tax", "risk", "sensitivity", "assumptions", "massing"] as Tab[]).map((t) => (
          <div
            key={t}
            className={"ui-tab" + (tab === t ? " ui-tab--active" : "")}
            onClick={() => setTab(t)}
          >
            {tabLabel(t)}
          </div>
        ))}
      </div>

      <div className="scenario-detail-layout">
        {/* 좌: 메인 */}
        <div className="scenario-detail-main">
        {/* KPI strip */}
        <div className="scenario-detail-kpis">
          <KPI label="저장된 세전 손익" value={won(scenario.profit)} sub="세금·미산정 항목 별도" />
          <KPI label="세전 IRR" value={scenario.irrStatus === "calculated" ? scenario.irr.toFixed(1) : "N/A"} unit={scenario.irrStatus === "calculated" ? "%" : undefined} sub="유일한 해가 있을 때만 표시" />
          <KPI label="Equity Multiple" value={`${scenario.equityMultiple.toFixed(2)}x`} sub={`예비 자본 ${won(scenario.equity)}`} />
          <KPI
            label="장기대출 DSCR"
            value={
              scenario.dscrStatus === "takeout-amortizing"
                ? scenario.dscr.toFixed(2)
                : scenario.dscrStatus === "terms-missing"
                  ? "조건 미입력"
                  : scenario.dscrStatus === "terms-invalid"
                    ? "입력 오류"
                    : "N/A"
            }
            sub={
              scenario.dscrStatus === "takeout-amortizing"
                ? "안정화 NOI ÷ 최대 연 정기 원리금 · balloon 제외"
                : scenario.dscrStatus === "terms-missing"
                  ? "LTV·금리·상환기간·계약 만기·최소 DSCR 미입력"
                  : scenario.dscrStatus === "terms-invalid"
                    ? scenario.takeout.invalidTerms[0] ?? "장기대출 입력값 확인 필요"
                    : "임대형 비적용"
            }
          />
          <KPI label="최대 노출" value={won(maxExposure)} sub={pfRows.find((r) => r.cumulative === maxExposure)?.quarter ?? "—"} />
          <KPI label="전체 사업기간" value={`${scenario.timeline}`} unit="개월" sub="설계·공사·회수 가정" />
        </div>

        {tab === "pf" && (
          <>
            {scenario.recommended ? (
              <PFView pfRows={pfRows} scenario={scenario} maxExposure={maxExposure} breakEven={breakEven?.quarter} />
            ) : (
              <div style={{ padding: 24, border: "1px solid var(--border)", borderRadius: 8, color: "var(--fg-muted)" }}>
                이 비교안의 개별 현금흐름은 저장되어 있지 않습니다. 다른 계획안의 PF 표를 대신 표시하지 않습니다.
              </div>
            )}
            {scenario.hold && (
              <HoldPeriodView
                hold={scenario.hold}
                developmentMonths={scenario.timeline}
              />
            )}
          </>
        )}
        {tab === "risk" && <RiskView risks={data.parcelRisks} />}
        {tab === "tax" && (
          <TaxView
            projectId={projectId}
            scenario={scenario}
            parcel={data.parcel}
          />
        )}
        {tab === "sensitivity" && (
          <SensitivityView scenario={scenario} parcel={data.parcel} />
        )}
        {tab === "assumptions" && (
          <AssumptionsView scenario={scenario} projectId={projectId} />
        )}
        {tab === "massing" && (
          <div>
            <MassingView
              boundary={data.parcel.boundary}
              boundaryPolygons={data.parcel.boundaryPolygons}
              zoning={data.parcel.zoning ?? ""}
              floors={scenario.floors.above}
              units={scenario.units.residential}
              roads={data.parcel.roads}
              setback={data.parcel.setback}
              height={560}
            />
            <div className="scenario-detail-massing-note">
              <span>정북일조 개념 영역 · 동별 배치·세대 배분 미확인 · 재무값 변경 없음</span>
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

      <style jsx global>{`
        .scenario-detail-page{display:flex;flex-direction:column;min-height:0;min-width:0}
        .scenario-detail-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--bg-elev)}
        .scenario-detail-identity{display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:wrap}
        .scenario-detail-id{font-size:13px;color:var(--fg-muted);flex:0 0 auto}
        .scenario-detail-name{font-size:16px;font-weight:600;min-width:0;overflow-wrap:anywhere}
        .scenario-detail-state{font-size:11.5px;color:var(--fg-muted);white-space:nowrap}
        .scenario-detail-actions{display:flex;gap:6px;flex:0 0 auto}
        .scenario-detail-notice{margin:12px 20px 0;padding:10px 12px;border:1px solid #d8a92e;border-radius:8px;background:#fff8dc;color:#5f4600;font-size:11px;line-height:1.5}
        .scenario-detail-tabs{overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
        .scenario-detail-tabs .ui-tab{flex:0 0 auto}
        .scenario-detail-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:16px;align-items:start;padding:20px;min-width:0}
        .scenario-detail-main{display:flex;flex-direction:column;gap:16px;min-width:0}
        .scenario-detail-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;min-width:0}
        .scenario-detail-kpis .ui-kpi__label,.scenario-detail-kpis .ui-kpi__delta{overflow-wrap:anywhere}
        .scenario-detail-kpis .ui-kpi__val{min-width:0;overflow-wrap:anywhere}
        .scenario-detail-sidebar{display:flex;flex-direction:column;gap:14px;position:sticky;top:16px;min-width:0}
        .scenario-detail-massing-note{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--fg-muted)}
        .scenario-detail-page .ui-panel{max-width:100%;overflow-x:auto}
        .scenario-detail-page .ui-table{min-width:680px}
        @media(max-width:1180px){
          .scenario-detail-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
        }
        @media(max-width:760px){
          .scenario-detail-header{display:grid;gap:10px;padding:12px 14px}
          .scenario-detail-identity{display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:7px 9px;align-items:center}
          .scenario-detail-name{font-size:14px;line-height:1.35}
          .scenario-detail-identity>.ui-tag{justify-self:start}
          .scenario-detail-state{grid-column:2/-1;white-space:normal}
          .scenario-detail-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%}
          .scenario-detail-actions .ui-btn{justify-content:center;min-width:0;padding-left:7px;padding-right:7px;white-space:nowrap}
          .scenario-detail-notice{margin:10px 14px 0}
          .scenario-detail-tabs{padding:0 8px}
          .scenario-detail-tabs .ui-tab{padding:10px 11px;font-size:11px}
          .scenario-detail-layout{grid-template-columns:minmax(0,1fr);padding:14px;gap:14px}
          .scenario-detail-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
          .scenario-detail-sidebar{position:static;display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
        }
        @media(max-width:360px){
          .scenario-detail-kpis{grid-template-columns:minmax(0,1fr)}
          .scenario-detail-actions{grid-template-columns:minmax(0,1fr)}
        }
      `}</style>
    </div>
  );
}

/* ─── 우측 사이드바 ─────────────────────────────── */
function ScenarioSidebar({ scenario }: { scenario: ScenarioSidebarVM }) {
  return (
    <aside className="scenario-detail-sidebar">
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
            최대 노출 {won(maxExposure)} · 손익분기 {breakEven ?? "미도달"} · EM {scenario.equityMultiple.toFixed(2)}x
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

function HoldPeriodView({
  hold,
  developmentMonths,
}: {
  hold: HoldPeriodLedgerResult;
  developmentMonths: number;
}) {
  const calculated = [
    "modeled-unverified",
    "refinance-shortfall",
    "commitment-feasible",
  ].includes(hold.status);
  const title =
    hold.status === "not-configured"
      ? "장기 보유안 미설정"
      : hold.status === "not-applicable"
        ? "임대 보유안 비적용"
        : hold.status === "terms-missing"
          ? "장기 보유 조건 미입력"
          : hold.status === "terms-invalid"
            ? "장기 보유 입력값 오류"
            : hold.status === "refinance-shortfall"
              ? "재융자 부족 포함 장기 보유안"
              : hold.status === "commitment-feasible"
                ? "확약액 기준 장기 보유안"
                : "계산상 장기 보유안";

  return (
    <section className="ui-panel">
      <div className="ui-panel__head">
        <span className="ui-panel__title">{title}</span>
        <span className="ui-panel__sub">
          안정화 매각 기본 지표와 분리된 대안 원장
        </span>
      </div>
      {!calculated ? (
        <p style={{ margin: 0, padding: 16, color: "var(--fg-muted)", fontSize: 12, lineHeight: 1.6 }}>
          {hold.warnings.join(" ")}
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 1, background: "var(--border-faint)" }}>
            <HoldSummary label="개발+보유 세전손익" value={won(hold.profitManwon ?? 0)} />
            <HoldSummary label="세전 IRR" value={hold.irrStatus === "calculated" && hold.irrPct != null ? `${hold.irrPct.toFixed(1)}%` : "N/A"} />
            <HoldSummary label="NPV" value={won(hold.npvManwon ?? 0)} />
            <HoldSummary label="Equity Multiple" value={`${(hold.equityMultiple ?? 0).toFixed(2)}x`} />
            <HoldSummary label="최종 매각가" value={won(hold.exitSaleGrossManwon ?? 0)} />
            <HoldSummary label="최저 연 DSCR" value={hold.minimumAnnualDscr == null ? "N/A" : hold.minimumAnnualDscr.toFixed(2)} />
            <HoldSummary label="최초 DSRA" value={won(hold.initialDsraManwon ?? 0)} />
            <HoldSummary label="계약 balloon" value={won(hold.totalTakeoutBalloonManwon ?? 0)} />
            <HoldSummary label="보유 전략" value={hold.strategyMode === "mixed-sale-lease" ? "매각+임대보유" : "전부 임대보유"} />
            <HoldSummary label="임대차 만기" value={`${hold.tenantRolloverEvents?.length ?? 0}회`} />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="ui-table">
              <thead>
                <tr>
                  <th>보유연차</th>
                  <th className="num">유효총수입</th>
                  <th className="num">운영비</th>
                  <th className="num">NOI</th>
                  <th className="num">공실·무상임대</th>
                  <th className="num">교체 TI·중개</th>
                  <th className="num">적용금리</th>
                  <th className="num">준비금·대수선</th>
                  <th className="num">정기 원리금</th>
                  <th className="num">자본화 이자</th>
                  <th className="num">만기상환</th>
                  <th className="num">DSRA 순적립</th>
                  <th className="num">DSCR</th>
                  <th className="num">매각 전 지분현금</th>
                </tr>
              </thead>
              <tbody>
                {hold.annualSummaries.map((row) => (
                  <tr key={row.year}>
                    <td>{row.year}년차</td>
                    <td className="num">{won(row.effectiveGrossIncome)}</td>
                    <td className="num">{won(row.operatingExpense)}</td>
                    <td className="num">{won(row.noi)}</td>
                    <td className="num">{won((row.rolloverDowntimeLoss ?? 0) + (row.rentFreeConcession ?? 0))}</td>
                    <td className="num">{won((row.tenantImprovement ?? 0) + (row.leasingCommission ?? 0))}</td>
                    <td className="num">
                      {row.minimumDebtRatePct == null || row.maximumDebtRatePct == null
                        ? "N/A"
                        : Math.abs(row.minimumDebtRatePct - row.maximumDebtRatePct) < 0.000001
                          ? `${row.minimumDebtRatePct.toFixed(2)}%`
                          : `${row.minimumDebtRatePct.toFixed(2)}~${row.maximumDebtRatePct.toFixed(2)}%`}
                    </td>
                    <td className="num">{won(row.replacementReserve + row.majorRepair)}</td>
                    <td className="num">{won(row.debtService)}</td>
                    <td className="num">{won(row.debtCapitalizedInterest)}</td>
                    <td className="num">{won(row.debtBalloon)}</td>
                    <td className="num">{won(row.dsraFunding - row.dsraDraw - row.dsraRelease)}</td>
                    <td className="num">{row.dscr == null ? "N/A" : row.dscr.toFixed(2)}</td>
                    <td className="num">{won(row.equityCashFlowBeforeSale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0, padding: "11px 14px", borderTop: "1px solid var(--border)", color: "var(--fg-muted)", fontSize: 10.5, lineHeight: 1.55 }}>
            전체 {developmentMonths + hold.holdMonths}개월 · {hold.strategyMode === "mixed-sale-lease" ? `개발 매각대금 ${won(hold.developmentSaleRevenueManwon ?? 0)} 유지 · ` : ""}초기 TI {won(hold.initialTenantImprovementManwon ?? 0)} · 최초 임대 중개 {won(hold.initialLeasingCommissionManwon ?? 0)} · 교체 공실 {won(hold.totalRolloverDowntimeLossManwon ?? 0)} · 교체 TI {won(hold.totalReplacementTenantImprovementManwon ?? 0)} · 교체 중개 {won(hold.totalReplacementLeasingCommissionManwon ?? 0)} · 최대 제한 보증금 {won(hold.maximumSecurityDepositManwon ?? 0)} · 자본화 이자 {won(hold.totalTakeoutCapitalizedInterestManwon ?? 0)} · 계약 balloon {won(hold.totalTakeoutBalloonManwon ?? 0)}{hold.balloonPaymentMonth == null ? "" : ` (${hold.balloonPaymentMonth}개월차)`} · 종료시 잔존대출 상환 {won(hold.exitLoanPayoffManwon ?? 0)}. DSRA 순적립은 적립을 양수, 사용·회수를 음수로 표시합니다. 연 DSCR은 balloon을 제외하며, 보유안은 공통 Pareto 순위에 포함되지 않습니다. 임차인별 비동기 만기·중도해지·대손과 재산세·반복 보험료는 미반영입니다.
          </p>
        </>
      )}
    </section>
  );
}

function HoldSummary({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0, padding: "11px 12px", background: "var(--bg-elev)" }}>
      <span style={{ display: "block", fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span>
      <strong style={{ display: "block", marginTop: 5, fontSize: 13, fontFamily: "var(--font-mono, monospace)", overflowWrap: "anywhere" }}>{value}</strong>
    </div>
  );
}

function TaxView({
  projectId,
  scenario,
  parcel,
}: {
  projectId: string;
  scenario: ScenarioVM;
  parcel: import("@/lib/finance/types").Parcel;
}) {
  const raw = scenario._raw;
  const expertTaxContracts = useProjectStore(
    (state) => state.expertTaxContracts
  );
  const calculation = useMemo(() => {
    if (!raw || !parcel) return null;
    try {
      const result = calculateScenario({ parcel, scenario: raw });
      const share = raw.program?.mix?.residentialSale ?? 0.7;
      const breakdown = calculateTaxes({
        parcel,
        result,
        residentialSaleShare: share,
      });
      const base = buildAfterTaxLedger({
        projectId,
        scenarioId: scenario.id,
        strategy: "stabilized-sale",
        preTaxEquityCashFlowsManwon: result.equityCashFlowsManwon,
        preTaxAcquisitionTaxManwon: result.acquisitionTax,
        equityHurdleRatePct: raw.assumptions.equityIRR,
        contract:
          expertTaxContracts[
            buildExpertTaxContractKey(
              projectId,
              scenario.id,
              "stabilized-sale"
            )
          ],
      });
      const hold =
        result.hold.combinedEquityCashFlowsManwon.length > 0
          ? buildAfterTaxLedger({
              projectId,
              scenarioId: scenario.id,
              strategy: "long-term-hold",
              preTaxEquityCashFlowsManwon:
                result.hold.combinedEquityCashFlowsManwon,
              preTaxAcquisitionTaxManwon: result.acquisitionTax,
              equityHurdleRatePct: raw.assumptions.equityIRR,
              contract:
                expertTaxContracts[
                  buildExpertTaxContractKey(
                    projectId,
                    scenario.id,
                    "long-term-hold"
                  )
                ],
            })
          : null;
      return { breakdown, base, hold };
    } catch {
      return null;
    }
  }, [expertTaxContracts, parcel, projectId, raw, scenario.id]);

  if (!calculation) {
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)", textAlign: "center" }}>
        세무 계산에 필요한 데이터가 없습니다. 부지를 다시 분석해 주세요.
      </div>
    );
  }
  const { breakdown, base, hold } = calculation;

  return (
    <section className="ui-panel">
      <div className="ui-panel__head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="ui-panel__title">세무 경계와 세후 원장</span>
        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
          세전 원장 포함 {won(breakdown.includedInPretaxTotal)}
        </span>
      </div>
      <div style={{ padding: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: hold ? "1fr 1fr" : "1fr",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <ScenarioAfterTaxSummary label="안정화 매각" result={base} />
          {hold && <ScenarioAfterTaxSummary label="장기 보유" result={hold} />}
        </div>
        <table className="ui-table">
          <thead>
            <tr>
              <th>세목</th>
              <th>과세 대상</th>
              <th className="num">세율</th>
              <th className="num">세액</th>
              <th>처리</th>
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
                  <td>
                    {l.status === "included-in-pretax"
                      ? "세전 포함"
                      : l.status === "reference-only"
                        ? "법정 참고"
                        : "미산정"}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--fg-subtle)" }}>{l.note}</td>
                </tr>
              );
            })}
            <tr className="ui-table__total">
              <td colSpan={3}>세전 원장 포함 세금</td>
              <td className="num">{won(breakdown.total)}</td>
              <td colSpan={2}>세후 추가 차감액 아님</td>
            </tr>
          </tbody>
        </table>
        <p style={{ margin: "10px 0 0", fontSize: 10, lineHeight: 1.55, color: "var(--fg-muted)" }}>
          법정 참고세율은 자동 세액으로 사용하지 않습니다. 세후 지표는 Stage 3에 저장된 세무 전문가 납부·환급 일정만 반영합니다.
        </p>
      </div>
    </section>
  );
}

function ScenarioAfterTaxSummary({
  label,
  result,
}: {
  label: string;
  result: ReturnType<typeof buildAfterTaxLedger>;
}) {
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${result.decisionGrade ? "var(--pos-fg)" : "var(--warn-fg)"}`,
        borderRadius: 8,
        background: "var(--bg-soft)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: 11 }}>{label}</strong>
        <span style={{ fontSize: 9.5, color: result.decisionGrade ? "var(--pos-fg)" : "var(--warn-fg)" }}>
          {result.decisionGrade
            ? "전문가 확인"
            : result.status === "stale"
              ? "기준 변경 · 재확인"
              : "미완료"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
        <HoldSummary
          label="세후 손익"
          value={result.afterTaxProfitManwon == null ? "N/A" : won(result.afterTaxProfitManwon)}
        />
        <HoldSummary
          label="세후 IRR"
          value={result.irrStatus === "calculated" && result.irrPct != null ? `${result.irrPct.toFixed(1)}%` : "N/A"}
        />
        <HoldSummary
          label="세후 NPV"
          value={result.npvManwon == null ? "N/A" : won(result.npvManwon)}
        />
        <HoldSummary
          label="순 증분 세금"
          value={result.netIncrementalTaxManwon == null ? "N/A" : won(result.netIncrementalTaxManwon)}
        />
      </div>
      {result.errors.length > 0 && (
        <p style={{ margin: "9px 0 0", color: "var(--neg-fg)", fontSize: 9.5, lineHeight: 1.5 }}>
          {result.errors.join(" ")}
        </p>
      )}
    </div>
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
          {risks.length}개 항목 · {warn > 0 ? `${warn}건 요주의` : "표시 경고 없음"}
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
