"use client";

import { use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { calculateScenario } from "@/lib/finance/scenario";
import type { AssumptionSet, ScenarioResult } from "@/lib/finance/types";
import { resolveStage3DashboardContext } from "@/lib/stage3/dashboard-model";
import { useProjectStore } from "@/lib/stores/project-store";
import { won } from "@/lib/utils/format";
import type { ScenarioVM } from "@/lib/adapters/view-model";
import { MaxAcquisitionPanel } from "@/components/ui/MaxAcquisitionPanel";

interface DashboardFinancials {
  cost: number;
  revenue: number;
  profit: number;
  profitMargin: number;
  equity: number;
  pf: number;
  ltc: number;
  dscr: number;
  irr: number;
  equityMultiple: number;
  timeline: number;
  landCost: number;
  demolitionCost: number;
  hardCost: number;
  softCost: number;
  financingCost: number;
  contingency: number;
  revenueSale: number;
  revenueLease: number;
  revenueRetail: number;
  profitAtLowCost?: number;
  profitAtHighCost?: number;
}

export default function DashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore(
    (state) => state.planningScenarios
  );
  const representativeScenarioId = useProjectStore(
    (state) => state.representativePlanningScenarioId
  );
  const representativeGeometry = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );
  const geometryValidationError = useProjectStore(
    (state) => state.geometryValidationError
  );
  const draftAssumptions = useProjectStore(
    (state) => state.draftAssumptions
  );
  const setDraftAssumption = useProjectStore(
    (state) => state.setDraftAssumption
  );
  const resetDraftAssumptions = useProjectStore(
    (state) => state.resetDraftAssumptions
  );

  const projectPlanningScenarios = useMemo(
    () =>
      planningScenarios.filter(
        (scenario) =>
          scenario.projectId === projectId ||
          scenario.id === representativeScenarioId
      ),
    [planningScenarios, projectId, representativeScenarioId]
  );

  const context = useMemo(
    () =>
      resolveStage3DashboardContext({
        projectId,
        representativeScenarioId,
        representativeGeometrySnapshot: representativeGeometry,
        planningScenarios: projectPlanningScenarios,
        financeScenarios: data?.scenarios ?? [],
      }),
    [
      data?.scenarios,
      projectId,
      projectPlanningScenarios,
      representativeGeometry,
      representativeScenarioId,
    ]
  );

  const activeScenarioId = context.ready
    ? context.financeScenario.id
    : representativeScenarioId;
  const draft = activeScenarioId
    ? draftAssumptions[activeScenarioId]
    : undefined;

  const editedResult = useMemo(() => {
    if (!context.ready || !data?.parcel || !draft) return null;
    if (Object.keys(draft).length === 0) return null;
    try {
      return calculateScenario({
        parcel: data.parcel,
        scenario: {
          ...context.financeScenario._raw,
          assumptions: {
            ...context.financeScenario._raw.assumptions,
            ...draft,
          },
        },
      });
    } catch {
      return null;
    }
  }, [context, data?.parcel, draft]);

  if (!data) return null;

  if (!context.ready) {
    return (
      <Stage3Blocked
        title={context.title}
        message={
          geometryValidationError && context.code !== "missing-finance-scenario"
            ? geometryValidationError
            : context.message
        }
        projectId={projectId}
        recalculating={context.code === "missing-finance-scenario"}
      />
    );
  }

  const { planningScenario, geometry, financeScenario } = context;
  const financial = financials(financeScenario, editedResult);
  const assumptionValues: AssumptionSet = {
    ...financeScenario._raw.assumptions,
    ...(draft ?? {}),
  };
  const editedCount = Object.keys(draft ?? {}).length;
  const confidence = data.saleEstimate?.confidence ?? "low";
  const costItems = [
    { label: "토지비", value: financial.landCost },
    { label: "철거비", value: financial.demolitionCost },
    { label: "직접 공사비", value: financial.hardCost },
    { label: "설계·인허가·간접비", value: financial.softCost },
    { label: "금융비", value: financial.financingCost },
    { label: "예비비", value: financial.contingency },
  ];
  const revenueItems = [
    { label: "분양 매출", value: financial.revenueSale },
    { label: "임대 가치", value: financial.revenueLease },
    { label: "근생 가치", value: financial.revenueRetail },
  ];
  const aboveFloors = geometry.building.aboveGroundFloors.length;
  const basementFloors = geometry.building.basementFloors.length;
  const unitCount = planningScenario.floorPrograms.reduce(
    (sum, floor) =>
      sum +
      floor.zones.reduce(
        (floorSum, zone) => floorSum + Math.max(0, zone.unitCount),
        0
      ),
    0
  );

  const profitTone =
    financial.profit > 0 ? "positive" : financial.profit === 0 ? "review" : "negative";
  const debtTone =
    financial.dscr >= 1.3
      ? "positive"
      : financial.dscr >= 1
        ? "review"
        : "negative";

  return (
    <div className="stage3-page">
      <header className="stage3-header">
        <div>
          <div className="eyebrow">STAGE 3 · FEASIBILITY</div>
          <h1>대표 계획안의 사업성을 검토합니다</h1>
          <p>
            Stage 2에서 잠근 실제 매스만 사용합니다. 건축 타당성과 투자성은
            하나의 점수로 합치지 않고 각각의 근거와 상태로 보여줍니다.
          </p>
        </div>
        <div className="header-actions">
          <StatusBadge
            tone={geometry.validation.status === "pass" ? "positive" : "review"}
          >
            Geometry {geometry.validation.status === "pass" ? "확인" : "검토"}
          </StatusBadge>
          <button
            type="button"
            className="secondary-button"
            onClick={() => router.push(`/projects/${projectId}/envelope`)}
          >
            계획 스튜디오
          </button>
        </div>
      </header>

      <section className="plan-lock-card">
        <div className="plan-lock-main">
          <span className="section-kicker">LOCKED REPRESENTATIVE</span>
          <strong>{planningScenario.name}</strong>
          <span>
            v{planningScenario.version} · {aboveFloors}층
            {basementFloors > 0 ? ` / 지하 ${basementFloors}층` : ""} ·
            프로그램 {geometry.building.totalProgramAreaSqm.toFixed(1)}㎡
          </span>
        </div>
        <PlanFact
          label="실현 용적률"
          value={`${geometry.building.preliminaryFarPct.toFixed(1)}%`}
        />
        <PlanFact
          label="계획 세대·호"
          value={unitCount > 0 ? `${unitCount}호` : "비주거 계획"}
        />
        <PlanFact
          label="Geometry Hash"
          value={geometry.geometryHash}
          mono
        />
      </section>

      <section className="signal-grid" aria-label="예비 사업성 판단">
        <DecisionSignal
          label="손익"
          title={
            financial.profit > 0
              ? "예상 이익"
              : financial.profit === 0
                ? "손익분기"
                : "예상 손실"
          }
          value={won(financial.profit)}
          tone={profitTone}
          note="현재 입력 가정 기준 · 확정 수익 아님"
        />
        <DecisionSignal
          label="금융 안정성"
          title={
            financial.dscr >= 1.3
              ? "예비 안정권"
              : financial.dscr >= 1
                ? "조건 검토"
                : "상환여력 부족"
          }
          value={`DSCR ${financial.dscr.toFixed(2)}`}
          tone={debtTone}
          note="대주 조건·상환 구조 입력 전 예비값"
        />
        <DecisionSignal
          label="가정 신뢰도"
          title={
            editedCount > 0
              ? `사용자 수정 ${editedCount}건`
              : confidence === "high"
                ? "매각 근거 양호"
                : confidence === "medium"
                  ? "매각 근거 검토"
                  : "핵심 가정 확인 필요"
          }
          value={
            data.saleEstimate
              ? `유사 사례 ${data.saleEstimate.count}건`
              : "실거래 근거 부족"
          }
          tone={
            editedCount > 0 || confidence !== "high" ? "review" : "positive"
          }
          note="공사비·임대료·금융조건은 사용자 확인 필요"
        />
      </section>

      <div className="stage3-layout">
        <main className="stage3-main">
          <section className="dashboard-section">
            <SectionHeader
              eyebrow="FINANCIAL SUMMARY"
              title="핵심 사업성"
              description="모든 금액은 만원 기준이며, 편집한 가정은 즉시 동일 금융 엔진으로 재계산됩니다."
            />
            <div className="metric-grid">
              <MetricCard label="총 사업비" value={won(financial.cost)} />
              <MetricCard label="예상 매출·가치" value={won(financial.revenue)} />
              <MetricCard
                label="예상 손익"
                value={won(financial.profit)}
                tone={profitTone}
              />
              <MetricCard
                label="이익률"
                value={`${financial.profitMargin.toFixed(1)}%`}
                tone={profitTone}
              />
              <MetricCard label="필요 자기자본" value={won(financial.equity)} />
              <MetricCard
                label="예상 PF"
                value={won(financial.pf)}
                sub={`LTC ${financial.ltc.toFixed(1)}%`}
              />
            </div>
            <div className="return-strip">
              <ReturnMetric
                label="IRR"
                value={`${financial.irr.toFixed(1)}%`}
                note="자본수익률"
              />
              <ReturnMetric
                label="DSCR"
                value={financial.dscr.toFixed(2)}
                note="원리금 상환여력"
              />
              <ReturnMetric
                label="Equity Multiple"
                value={`${financial.equityMultiple.toFixed(2)}x`}
                note="자기자본 회수배수"
              />
              <ReturnMetric
                label="사업기간"
                value={`${Math.round(financial.timeline)}개월`}
                note="설계·공사·회수"
              />
            </div>
          </section>

          <section className="dashboard-section split-section">
            <BreakdownPanel
              title="사업비 구성"
              total={financial.cost}
              items={costItems}
            />
            <BreakdownPanel
              title="매출·가치 구성"
              total={financial.revenue}
              items={revenueItems}
            />
          </section>

          <section className="dashboard-section">
            <SectionHeader
              eyebrow="SENSITIVITY"
              title="공사비 민감도"
              description="금융비의 2차 변화는 반영하지 않은 개략 범위입니다. 견적 입력 전 의사결정 참고용으로만 사용합니다."
            />
            <div className="sensitivity-grid">
              <SensitivityCard
                label="공사비 -15%"
                value={financial.profitAtLowCost}
                current={financial.profit}
              />
              <SensitivityCard
                label="현재 가정"
                value={financial.profit}
                current={financial.profit}
                active
              />
              <SensitivityCard
                label="공사비 +20%"
                value={financial.profitAtHighCost}
                current={financial.profit}
              />
            </div>
          </section>

          {data.maxAcquisition.length > 0 && (
            <section className="dashboard-section">
              <SectionHeader
                eyebrow="LAND BID"
                title="최대 시행 가능 인수가"
                description="목표 IRR별로 역산한 토지 매입 상한입니다. 대표 계획안과 현재 가정만 기준으로 확인하세요."
              />
              <MaxAcquisitionPanel
                analyses={data.maxAcquisition.filter(
                  (analysis) => analysis.scenarioId === financeScenario.id
                )}
                marketPrice={data.parcel.acquiredPrice}
                marketProxyPrice={
                  data.parcel.estMarketPrice && data.parcel.lotArea
                    ? Math.round(
                        (data.parcel.estMarketPrice * data.parcel.lotArea) /
                          10_000
                      )
                    : undefined
                }
              />
            </section>
          )}

          {data.scenarios.length > 1 && (
            <section className="dashboard-section">
              <SectionHeader
                eyebrow="SAVED PLAN COMPARISON"
                title="저장 계획안 사업성 비교"
                description="Stage 2에서 저장한 계획안만 비교합니다. 대표 계획안은 별도로 표시합니다."
              />
              <ScenarioFinanceTable
                scenarios={data.scenarios}
                representativeId={financeScenario.id}
                onOpen={(id) =>
                  router.push(`/projects/${projectId}/scenarios/${id}`)
                }
              />
            </section>
          )}
        </main>

        <aside className="stage3-sidebar">
          <section className="assumption-panel">
            <div className="assumption-heading">
              <div>
                <span className="section-kicker">EDITABLE INPUTS</span>
                <h2>핵심 가정</h2>
              </div>
              {editedCount > 0 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => resetDraftAssumptions(financeScenario.id)}
                >
                  {editedCount}건 초기화
                </button>
              )}
            </div>

            <AssumptionEditor
              label="분양가"
              value={assumptionValues.salePricePerSqM}
              divisor={10_000}
              suffix="만원/㎡"
              step={10}
              edited={draft?.salePricePerSqM != null}
              source={
                data.saleEstimate
                  ? `실거래 ${data.saleEstimate.count}건 · ${confidenceLabel(confidence)}`
                  : "비교사례 부족"
              }
              onChange={(value) =>
                setDraftAssumption(
                  financeScenario.id,
                  "salePricePerSqM",
                  value
                )
              }
            />
            <AssumptionEditor
              label="임대료"
              value={assumptionValues.rentPerSqMMonth}
              divisor={10_000}
              suffix="만원/㎡·월"
              step={0.1}
              decimals={1}
              edited={draft?.rentPerSqMMonth != null}
              source="시장 임대사례 확인 필요"
              onChange={(value) =>
                setDraftAssumption(
                  financeScenario.id,
                  "rentPerSqMMonth",
                  value
                )
              }
            />
            <AssumptionEditor
              label="공사비"
              value={assumptionValues.constCostPerSqM}
              divisor={10_000}
              suffix="만원/㎡"
              step={10}
              edited={draft?.constCostPerSqM != null}
              source="개략 기본값 · 견적 확인 필요"
              onChange={(value) =>
                setDraftAssumption(
                  financeScenario.id,
                  "constCostPerSqM",
                  value
                )
              }
            />
            <AssumptionEditor
              label="공실률"
              value={assumptionValues.vacancyRate}
              divisor={1}
              suffix="%"
              step={0.5}
              decimals={1}
              edited={draft?.vacancyRate != null}
              source="운영 가정"
              onChange={(value) =>
                setDraftAssumption(financeScenario.id, "vacancyRate", value)
              }
            />
            <AssumptionEditor
              label="PF 금리"
              value={assumptionValues.interestRate}
              divisor={1}
              suffix="%"
              step={0.1}
              decimals={2}
              edited={draft?.interestRate != null}
              source="금융기관 확인 필요"
              onChange={(value) =>
                setDraftAssumption(financeScenario.id, "interestRate", value)
              }
            />
            <AssumptionEditor
              label="목표 LTC"
              value={assumptionValues.ltcTarget}
              divisor={1}
              suffix="%"
              step={1}
              decimals={0}
              edited={draft?.ltcTarget != null}
              source="대주 조건 확인 필요"
              onChange={(value) =>
                setDraftAssumption(financeScenario.id, "ltcTarget", value)
              }
            />

            <button
              type="button"
              className="primary-button"
              onClick={() => router.push(`/projects/${projectId}/overrides`)}
            >
              모든 가정과 근거 편집
            </button>
          </section>

          <section className="evidence-panel">
            <span className="section-kicker">SOURCE CONTRACT</span>
            <h2>분석 기준</h2>
            <EvidenceRow
              label="계획 매스"
              value={geometry.geometryHash}
              state="확정"
            />
            <EvidenceRow
              label="좌표·단위"
              value={`${geometry.coordinateSystem.unit} · ${geometry.coordinateSystem.horizontalCrs}`}
              state="확정"
            />
            <EvidenceRow
              label="분양가"
              value={
                data.saleEstimate
                  ? data.saleEstimate.basis
                  : "유사 실거래 부족"
              }
              state={data.saleEstimate ? "검토" : "미확정"}
            />
            <EvidenceRow
              label="공사비"
              value="개략 단가"
              state="미확정"
            />
            <EvidenceRow
              label="PF 조건"
              value="사용자 입력 가정"
              state="미확정"
            />
            <div className="evidence-note">
              구조 안전·최종 법규·측량·금융 인디케이션은 이 화면에서 확정하지
              않습니다. 보고서에는 현재 상태와 출처가 그대로 기록됩니다.
            </div>
          </section>

          <nav className="next-actions" aria-label="사업성 검토 다음 작업">
            <button
              type="button"
              onClick={() => router.push(`/projects/${projectId}/comparison`)}
            >
              저장안 상세 비교
            </button>
            <button
              type="button"
              onClick={() => router.push(`/projects/${projectId}/report`)}
            >
              투자 보고서 준비
            </button>
          </nav>
        </aside>
      </div>

      <style jsx>{`
        .stage3-page {
          max-width: 1500px;
          margin: 0 auto;
          padding: 28px;
          color: var(--fg);
        }
        .stage3-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
          margin-bottom: 22px;
        }
        .eyebrow,
        .section-kicker {
          display: block;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.16em;
          color: var(--fg-muted);
        }
        .stage3-header h1 {
          margin: 8px 0 7px;
          font-size: clamp(27px, 3vw, 38px);
          letter-spacing: -0.045em;
          line-height: 1.08;
        }
        .stage3-header p {
          max-width: 730px;
          margin: 0;
          color: var(--fg-muted);
          font-size: 13px;
          line-height: 1.65;
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .secondary-button,
        .primary-button,
        .next-actions button {
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-elev);
          color: var(--fg);
          font: inherit;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
        }
        .secondary-button {
          height: 34px;
          padding: 0 12px;
        }
        .plan-lock-card {
          display: grid;
          grid-template-columns: minmax(260px, 1.6fr) repeat(3, minmax(130px, 0.65fr));
          gap: 1px;
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--border-faint);
          margin-bottom: 14px;
        }
        .plan-lock-main,
        .plan-fact {
          background: var(--bg-elev);
          padding: 15px 16px;
        }
        .plan-lock-main strong {
          display: block;
          margin: 6px 0 4px;
          font-size: 17px;
        }
        .plan-lock-main > span:last-child {
          font-size: 11.5px;
          color: var(--fg-muted);
        }
        .signal-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 18px;
        }
        .stage3-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 16px;
          align-items: start;
        }
        .stage3-main {
          display: grid;
          gap: 14px;
          min-width: 0;
        }
        .dashboard-section,
        .assumption-panel,
        .evidence-panel {
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--bg-elev);
          padding: 18px;
        }
        .metric-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 9px;
          margin-top: 15px;
        }
        .return-strip {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1px;
          margin-top: 10px;
          overflow: hidden;
          border: 1px solid var(--border-faint);
          border-radius: 9px;
          background: var(--border-faint);
        }
        .split-section {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 24px;
        }
        .sensitivity-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 9px;
          margin-top: 14px;
        }
        .stage3-sidebar {
          display: grid;
          gap: 12px;
          position: sticky;
          top: 18px;
        }
        .assumption-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border-faint);
        }
        .assumption-heading h2,
        .evidence-panel h2 {
          margin: 5px 0 0;
          font-size: 16px;
        }
        .text-button {
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--accent);
          font: inherit;
          font-size: 11px;
          cursor: pointer;
        }
        .primary-button {
          width: 100%;
          height: 36px;
          margin-top: 12px;
          background: var(--fg);
          color: var(--bg);
          border-color: var(--fg);
        }
        .evidence-note {
          margin-top: 12px;
          padding: 10px;
          border-radius: 8px;
          background: var(--bg-soft);
          color: var(--fg-muted);
          font-size: 10.5px;
          line-height: 1.55;
        }
        .next-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .next-actions button {
          min-height: 38px;
          padding: 7px 8px;
        }
        @media (max-width: 1180px) {
          .stage3-layout {
            grid-template-columns: 1fr;
          }
          .stage3-sidebar {
            position: static;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .next-actions {
            grid-column: 1 / -1;
          }
          .plan-lock-card {
            grid-template-columns: repeat(3, 1fr);
          }
          .plan-lock-main {
            grid-column: 1 / -1;
          }
        }
        @media (max-width: 760px) {
          .stage3-page {
            padding: 18px 14px;
          }
          .stage3-header {
            display: block;
          }
          .header-actions {
            margin-top: 14px;
          }
          .signal-grid,
          .metric-grid,
          .sensitivity-grid,
          .split-section,
          .stage3-sidebar {
            grid-template-columns: 1fr;
          }
          .return-strip {
            grid-template-columns: repeat(2, 1fr);
          }
          .plan-lock-card {
            grid-template-columns: 1fr;
          }
          .plan-lock-main {
            grid-column: auto;
          }
        }
      `}</style>
    </div>
  );
}

function financials(
  scenario: ScenarioVM,
  result: ScenarioResult | null
): DashboardFinancials {
  if (!result) {
    return {
      cost: scenario.cost,
      revenue: scenario.revenue,
      profit: scenario.profit,
      profitMargin: scenario.profitMargin,
      equity: scenario.equity,
      pf: scenario.pf,
      ltc: scenario.ltc,
      dscr: scenario.dscr,
      irr: scenario.irr,
      equityMultiple: scenario.equityMultiple,
      timeline: scenario.timeline,
      landCost: scenario.landCost,
      demolitionCost: scenario.demolitionCost,
      hardCost: scenario.hardCost,
      softCost: scenario.softCost,
      financingCost: scenario.financingCost,
      contingency: scenario.contingency,
      revenueSale: scenario.revenueSale,
      revenueLease: scenario.revenueLease,
      revenueRetail: scenario.revenueRetail,
      profitAtLowCost: scenario.profitAtLowCost,
      profitAtHighCost: scenario.profitAtHighCost,
    };
  }
  return {
    cost: result.totalCost,
    revenue: result.totalRevenue,
    profit: result.profit,
    profitMargin: result.profitMargin,
    equity: result.equity,
    pf: result.pfLoan,
    ltc: result.ltc,
    dscr: result.dscr,
    irr: result.irr,
    equityMultiple: result.equityMultiple,
    timeline: result.totalMonths,
    landCost: result.landCost,
    demolitionCost: result.demolitionCost,
    hardCost: result.hardCost,
    softCost: result.softCost,
    financingCost: result.financingCost,
    contingency: result.contingency,
    revenueSale: result.revenueSale,
    revenueLease: result.revenueLease,
    revenueRetail: result.revenueRetail,
    profitAtLowCost: result.profitAtLowCost,
    profitAtHighCost: result.profitAtHighCost,
  };
}

function Stage3Blocked({
  title,
  message,
  projectId,
  recalculating,
}: {
  title: string;
  message: string;
  projectId: string;
  recalculating: boolean;
}) {
  const router = useRouter();
  return (
    <div
      style={{
        maxWidth: 840,
        margin: "0 auto",
        padding: "72px 28px",
      }}
    >
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 14,
          background: "var(--bg-elev)",
          padding: 28,
        }}
      >
        <span className="ui-tag">STAGE 3</span>
        <h1 style={{ margin: "14px 0 8px", fontSize: 28 }}>{title}</h1>
        <p
          style={{
            margin: 0,
            color: "var(--fg-muted)",
            lineHeight: 1.65,
            fontSize: 13,
          }}
        >
          {message}
        </p>
        <div
          style={{
            marginTop: 18,
            padding: "11px 12px",
            borderRadius: 8,
            background: "var(--bg-soft)",
            fontSize: 11.5,
            lineHeight: 1.55,
            color: "var(--fg-muted)",
          }}
        >
          {recalculating
            ? "대표 계획안의 금융 시나리오를 재계산하고 있습니다. 잠시 후에도 계속되면 계획 스튜디오에서 대표안을 다시 확정하세요."
            : "구형 권장안이나 다른 계획안의 숫자로 대체하지 않았습니다. 대표안·Geometry Snapshot·금융 시나리오가 정확히 일치할 때만 사업성 정보를 표시합니다."}
        </div>
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}/envelope`)}
          style={{
            marginTop: 18,
            height: 38,
            padding: "0 15px",
            border: 0,
            borderRadius: 8,
            background: "var(--fg)",
            color: "var(--bg)",
            font: "inherit",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          계획 스튜디오에서 대표안 확인
        </button>
      </div>
    </div>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "positive" | "review" | "negative";
}) {
  const colors =
    tone === "positive"
      ? ["var(--pos-soft)", "var(--pos-fg)"]
      : tone === "negative"
        ? ["var(--neg-soft)", "var(--neg-fg)"]
        : ["var(--warn-soft)", "var(--warn-fg)"];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 34,
        padding: "0 10px",
        borderRadius: 8,
        background: colors[0],
        color: colors[1],
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}

function PlanFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="plan-fact">
      <span
        style={{
          display: "block",
          marginBottom: 6,
          color: "var(--fg-muted)",
          fontSize: 10.5,
        }}
      >
        {label}
      </span>
      <strong
        className={mono ? "mono" : undefined}
        style={{ fontSize: mono ? 11 : 15, overflowWrap: "anywhere" }}
      >
        {value}
      </strong>
    </div>
  );
}

function DecisionSignal({
  label,
  title,
  value,
  tone,
  note,
}: {
  label: string;
  title: string;
  value: string;
  tone: "positive" | "review" | "negative";
  note: string;
}) {
  const border =
    tone === "positive"
      ? "var(--pos)"
      : tone === "negative"
        ? "var(--neg-fg)"
        : "var(--warn-fg)";
  return (
    <article
      style={{
        border: "1px solid var(--border)",
        borderTop: `3px solid ${border}`,
        borderRadius: 10,
        background: "var(--bg-elev)",
        padding: "13px 14px",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "var(--fg-muted)",
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 10,
          marginTop: 8,
        }}
      >
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <strong className="mono" style={{ fontSize: 13 }}>
          {value}
        </strong>
      </div>
      <p
        style={{
          margin: "7px 0 0",
          color: "var(--fg-muted)",
          fontSize: 10.5,
        }}
      >
        {note}
      </p>
    </article>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <span className="section-kicker">{eyebrow}</span>
      <h2 style={{ margin: "6px 0 4px", fontSize: 17 }}>{title}</h2>
      <p
        style={{
          margin: 0,
          color: "var(--fg-muted)",
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "review" | "negative";
}) {
  const color =
    tone === "positive"
      ? "var(--pos-fg)"
      : tone === "negative"
        ? "var(--neg-fg)"
        : tone === "review"
          ? "var(--warn-fg)"
          : "var(--fg)";
  return (
    <div
      style={{
        padding: "13px 14px",
        borderRadius: 9,
        border: "1px solid var(--border-faint)",
        background: "var(--bg-soft)",
      }}
    >
      <span style={{ display: "block", color: "var(--fg-muted)", fontSize: 10.5 }}>
        {label}
      </span>
      <strong
        className="mono"
        style={{ display: "block", marginTop: 7, fontSize: 18, color }}
      >
        {value}
      </strong>
      {sub && (
        <span style={{ display: "block", marginTop: 4, fontSize: 10, color: "var(--fg-muted)" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function ReturnMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div style={{ background: "var(--bg-elev)", padding: "11px 12px" }}>
      <span style={{ display: "block", color: "var(--fg-muted)", fontSize: 10 }}>
        {label}
      </span>
      <strong className="mono" style={{ display: "block", marginTop: 5, fontSize: 15 }}>
        {value}
      </strong>
      <span style={{ display: "block", marginTop: 2, color: "var(--fg-faint)", fontSize: 9.5 }}>
        {note}
      </span>
    </div>
  );
}

function BreakdownPanel({
  title,
  total,
  items,
}: {
  title: string;
  total: number;
  items: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <strong className="mono" style={{ fontSize: 12 }}>{won(total)}</strong>
      </div>
      <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
        {items.map((item) => (
          <div key={item.label}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5 }}>
              <span style={{ color: "var(--fg-muted)" }}>{item.label}</span>
              <span className="mono">{won(item.value)}</span>
            </div>
            <div style={{ height: 4, marginTop: 4, borderRadius: 999, background: "var(--bg-soft)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.max(0, (item.value / max) * 100)}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: "var(--fg-subtle)",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SensitivityCard({
  label,
  value,
  current,
  active = false,
}: {
  label: string;
  value?: number;
  current: number;
  active?: boolean;
}) {
  const available = value != null && Number.isFinite(value);
  const delta = available ? value - current : 0;
  const tone = available && value < 0 ? "var(--neg-fg)" : "var(--fg)";
  return (
    <div
      style={{
        padding: "13px 14px",
        borderRadius: 9,
        border: `1px solid ${active ? "var(--fg)" : "var(--border-faint)"}`,
        background: active ? "var(--bg-soft)" : "var(--bg-elev)",
      }}
    >
      <span style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>{label}</span>
      <strong className="mono" style={{ display: "block", marginTop: 7, color: tone, fontSize: 16 }}>
        {available ? won(value) : "계산 없음"}
      </strong>
      {!active && available && (
        <span style={{ display: "block", marginTop: 3, fontSize: 10, color: delta >= 0 ? "var(--pos-fg)" : "var(--neg-fg)" }}>
          기준 대비 {delta >= 0 ? "+" : ""}{won(delta)}
        </span>
      )}
    </div>
  );
}

function AssumptionEditor({
  label,
  value,
  divisor,
  suffix,
  step,
  decimals = 0,
  edited,
  source,
  onChange,
}: {
  label: string;
  value: number;
  divisor: number;
  suffix: string;
  step: number;
  decimals?: number;
  edited: boolean;
  source: string;
  onChange: (value: number) => void;
}) {
  return (
    <label
      style={{
        display: "block",
        padding: "10px 0",
        borderBottom: "1px solid var(--border-faint)",
      }}
    >
      <span style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>{label}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input
            type="number"
            value={(value / divisor).toFixed(decimals)}
            min={0}
            step={step}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 0) onChange(next * divisor);
            }}
            style={{
              width: 82,
              height: 28,
              border: `1px solid ${edited ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 6,
              background: "var(--bg)",
              color: edited ? "var(--accent)" : "var(--fg)",
              textAlign: "right",
              padding: "0 6px",
              font: "inherit",
              fontSize: 11.5,
              fontWeight: 650,
            }}
          />
          <span style={{ color: "var(--fg-faint)", fontSize: 9.5 }}>{suffix}</span>
        </span>
      </span>
      <span
        style={{
          display: "block",
          marginTop: 4,
          color: edited ? "var(--accent)" : "var(--fg-faint)",
          fontSize: 9.5,
        }}
      >
        {edited ? "사용자 수정 · 실시간 재계산" : source}
      </span>
    </label>
  );
}

function EvidenceRow({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "확정" | "검토" | "미확정";
}) {
  const color =
    state === "확정"
      ? "var(--pos-fg)"
      : state === "검토"
        ? "var(--warn-fg)"
        : "var(--neg-fg)";
  return (
    <div style={{ padding: "9px 0", borderBottom: "1px solid var(--border-faint)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>{label}</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color }}>{state}</span>
      </div>
      <div style={{ marginTop: 3, fontSize: 10.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>
        {value}
      </div>
    </div>
  );
}

function ScenarioFinanceTable({
  scenarios,
  representativeId,
  onOpen,
}: {
  scenarios: ScenarioVM[];
  representativeId: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto", marginTop: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ color: "var(--fg-muted)", textAlign: "right" }}>
            <th style={{ textAlign: "left", padding: "8px 9px" }}>계획안</th>
            <th style={{ padding: "8px 9px" }}>총 사업비</th>
            <th style={{ padding: "8px 9px" }}>매출·가치</th>
            <th style={{ padding: "8px 9px" }}>손익</th>
            <th style={{ padding: "8px 9px" }}>IRR</th>
            <th style={{ padding: "8px 9px" }}>DSCR</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((scenario) => {
            const representative = scenario.id === representativeId;
            return (
              <tr
                key={scenario.id}
                onClick={() => onOpen(scenario.id)}
                style={{
                  borderTop: "1px solid var(--border-faint)",
                  background: representative ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                  textAlign: "right",
                }}
              >
                <td style={{ textAlign: "left", padding: "10px 9px" }}>
                  <strong>{scenario.name}</strong>
                  {representative && (
                    <span style={{ marginLeft: 6, color: "var(--accent)", fontSize: 9.5 }}>
                      대표안
                    </span>
                  )}
                </td>
                <td className="mono" style={{ padding: "10px 9px" }}>{won(scenario.cost)}</td>
                <td className="mono" style={{ padding: "10px 9px" }}>{won(scenario.revenue)}</td>
                <td className="mono" style={{ padding: "10px 9px", color: scenario.profit >= 0 ? "var(--pos-fg)" : "var(--neg-fg)" }}>{won(scenario.profit)}</td>
                <td className="mono" style={{ padding: "10px 9px" }}>{scenario.irr.toFixed(1)}%</td>
                <td className="mono" style={{ padding: "10px 9px" }}>{scenario.dscr.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function confidenceLabel(confidence: "high" | "medium" | "low"): string {
  return confidence === "high"
    ? "신뢰도 높음"
    : confidence === "medium"
      ? "신뢰도 보통"
      : "신뢰도 낮음";
}
