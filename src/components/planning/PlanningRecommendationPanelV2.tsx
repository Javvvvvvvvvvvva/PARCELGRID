"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { Panel } from "@/components/ui/primitives";
import { DwellingComparisonTable } from "@/components/planning/DwellingComparisonTable";
import { clonePlanningScenario } from "@/lib/planning/scenario-utils";
import {
  calculateAcquisitionCapacity,
  recommendationsSharePhysicalPlan,
  selectCurrentPlanningRecommendations,
  type PlanningRecommendationAnalysis,
  type RecommendationProfitMode,
  type RecommendationRejectionSummary,
} from "@/lib/planning/recommendation-analysis";
import { runPlanningRecommendationWorker } from "@/lib/planning/recommendation-worker";
import {
  calculatePlanningScenario,
} from "@/lib/planning/scenario-calculator";
import { planningRecommendationInput, planningRecommendationInputBasis } from "@/lib/planning/recommendation-basis";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import {
  applySpatialValidationToCalculation,
  calculatePlanningSpatialValidation,
} from "@/lib/planning/scenario-spatial-validation";
import { summarizePlanningScenario } from "@/lib/planning/scenario-utils";
import type {
  PlanningRecommendationObjective,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";
import { useProjectStore } from "@/lib/stores/project-store";
import { clientSession } from "@/lib/auth/client-session";
import { num, won } from "@/lib/utils/format";

const ALGORITHM_ORIGINS = new Set<PlanningScenario["origin"]>([
  "algorithm-safe",
  "algorithm-balanced",
  "algorithm-max",
]);

const OBJECTIVE_LABEL: Record<PlanningRecommendationObjective, string> = {
  "architectural-feasibility": "건축 타당성 1위",
  profit: "개략 수익 1위",
  "legal-ceiling": "법적 상한 참고",
};

function uniqueRecommendationScenario(
  scenario: PlanningScenario,
  slot: "safe" | "profit" | "max"
): PlanningScenario {
  const suffix = `-${slot}`;
  return {
    ...scenario,
    id: `${scenario.id}${suffix}`,
    floorPrograms: scenario.floorPrograms.map((floor) => ({
      ...floor,
      id: `${floor.id}${suffix}`,
      zones: floor.zones.map((zone) => ({
        ...zone,
        id: `${zone.id}${suffix}`,
      })),
    })),
  };
}

function profitLabel(mode: RecommendationProfitMode | undefined): string {
  if (mode === "loss-minimization") return "손실 최소 1위";
  if (mode === "break-even") return "손익분기 1위";
  return "개략 수익 1위";
}

function RecommendationCard({
  scenario,
  calculation,
  selected,
  combined = false,
  onOpen,
  onClone,
}: {
  scenario: PlanningScenario | null;
  calculation: PlanningScenarioCalculation | null;
  selected: boolean;
  combined?: boolean;
  onOpen: () => void;
  onClone: () => void;
}) {
  if (!scenario || !calculation || !scenario.recommendation) {
    return (
      <article style={emptyCardStyle}>
        법규·배치·주차를 모두 검증한 뒤 추천안이 생성됩니다.
      </article>
    );
  }
  if (calculation.economicsPreview.status === "stale") {
    return <article style={emptyCardStyle}>
      <strong>{scenario.name} · 원가 재검토 필요</strong>
      <p>상세 수량 원가 기준이 달라 개략 이익과 추천을 보류합니다.</p>
      <button type="button" onClick={onOpen}><ArrowRight size={14} aria-hidden="true" />계획안 열기</button>
    </article>;
  }

  const summary = summarizePlanningScenario(scenario);
  const metadata = scenario.recommendation;
  const profit = calculation.economicsPreview.profitManwon;
  const acquisitionCapacity = calculateAcquisitionCapacity(
    calculation.economicsPreview
  );
  const readiness = assessRepresentativeCheckReadiness(calculation.checks);
  const reference = metadata.objective === "legal-ceiling";
  const lossMode = metadata.profitSelectionMode === "loss-minimization";
  const displayName =
    combined
      ? "통합 추천안"
      : metadata.objective === "profit" && lossMode
        ? "손실 최소안"
        : scenario.name;
  const displayDescription =
    metadata.objective === "profit" && lossMode
      ? "현재 실행 가능한 모든 후보가 적자입니다. 이 안은 이익안이 아니라 예상 손실이 가장 작은 후보입니다."
      : scenario.description;

  return (
    <article
      style={{
        padding: 14,
        border: selected
          ? "1.5px solid var(--fg)"
          : reference
            ? "1px solid var(--warn-fg)"
            : "1px solid var(--border)",
        borderRadius: 11,
        background: "var(--bg-elev)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 14 }}>{displayName}</strong>
            <span className="ui-tag">{OBJECTIVE_LABEL[metadata.objective]}</span>
            {combined && (
              <span className="ui-tag">{profitLabel(metadata.profitSelectionMode)}</span>
            )}
            {!combined && metadata.objective === "profit" && lossMode && (
              <span className="ui-tag">손실 최소</span>
            )}
            {metadata.eligible ? (
              <span className="ui-tag">예비 실행 후보</span>
            ) : (
              <span className="ui-tag">참고 전용</span>
            )}
          </div>
          <p
            style={{
              margin: "6px 0 0",
              color: "var(--fg-muted)",
              fontSize: 10.5,
              lineHeight: 1.5,
            }}
          >
            {displayDescription}
          </p>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 9.5, color: "var(--fg-faint)" }}>건축 타당성</div>
          <strong style={{ fontSize: 18 }}>{metadata.architectureScore.toFixed(1)}</strong>
          <span style={{ fontSize: 10, color: "var(--fg-muted)" }}> / 100</span>
        </div>
      </div>

      {lossMode && metadata.objective !== "legal-ceiling" && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--warn-soft)",
            color: "var(--warn-fg)",
            fontSize: 10,
            lineHeight: 1.45,
          }}
        >
          모든 실행 가능 후보의 개략 손익이 음수입니다. 수익성 확보 여부는 Stage 3에서
          단가·공사비·금융조건을 조정해 다시 검토해야 합니다.
        </div>
      )}

      <div style={fourMetricGridStyle}>
        <MiniMetric label="층수" value={`${calculation.metrics.aboveGroundFloors}F`} />
        <MiniMetric label="세대" value={`${summary.residentialUnitCount}세대`} />
        <MiniMetric
          label="용적률"
          value={`${num(calculation.metrics.preliminaryFarPct, 1)}%`}
        />
        <MiniMetric
          label="주차"
          value={`${calculation.parking.providedCars}/${calculation.parking.requiredCars}대`}
        />
      </div>

      <div style={twoMetricGridStyle}>
        <MiniMetric
          label="개략 손익"
          value={won(profit, { sign: true })}
          tone={profit >= 0 ? "positive" : "negative"}
        />
        <MiniMetric
          label="판정"
          value={
            readiness.blockingFailureCount > 0
              ? `미충족 ${readiness.blockingFailureCount}`
              : readiness.blockingVerificationCount > 0
                ? `확정 전 검증 ${readiness.blockingVerificationCount}`
                : readiness.advisoryCount > 0
                  ? `적격 · 참고 ${readiness.advisoryCount}`
                  : "대표안 적격"
          }
          tone={
            readiness.blockingFailureCount > 0
              ? "negative"
              : readiness.ready && readiness.advisoryCount === 0
                ? "positive"
                : "neutral"
          }
        />
      </div>

      {!reference && (
        <div style={twoMetricGridStyle}>
          <MiniMetric
            label="손익분기 토지가"
            value={won(acquisitionCapacity.breakEvenAcquisitionCostManwon)}
          />
          <MiniMetric
            label={
              acquisitionCapacity.acquisitionHeadroomManwon >= 0
                ? "현재가 대비 매입 여유"
                : "현재가 대비 초과"
            }
            value={won(Math.abs(acquisitionCapacity.acquisitionHeadroomManwon))}
            tone={
              acquisitionCapacity.acquisitionHeadroomManwon >= 0
                ? "positive"
                : "negative"
            }
          />
        </div>
      )}
      {!reference && (
        <p
          style={{
            margin: "6px 0 0",
            color: "var(--fg-faint)",
            fontSize: 9,
            lineHeight: 1.45,
          }}
        >
          토지비만 변동한 Stage 2 개략값입니다. 세금·PF·공정 반영 최종 매입 한도는
          Stage 3에서 확인합니다.
        </p>
      )}

      <div style={{ marginTop: 11, display: "grid", gap: 4 }}>
        {metadata.reasons.slice(0, combined ? 6 : 4).map((reason) => (
          <div key={reason} style={{ fontSize: 10, color: "var(--fg-muted)" }}>
            · {reason}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
        <button type="button" style={secondaryButton} onClick={onOpen}>
          계획안 열기
        </button>
        {!reference && (
          <button type="button" style={secondaryButton} onClick={onClone}>
            복제해서 편집
          </button>
        )}
      </div>
    </article>
  );
}

function RejectionSummary({ summary }: { summary: RecommendationRejectionSummary | null }) {
  if (!summary || summary.rejectedCandidates <= 0) return null;
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-sunken)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <strong style={{ fontSize: 11.5 }}>자동 후보 탈락 원인</strong>
        <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>
          탈락 {summary.rejectedCandidates}개 · 후보별 복수 원인 포함
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 7,
          marginTop: 9,
        }}
        className="rejection-reason-grid"
      >
        {summary.reasons.slice(0, 8).map((reason) => (
          <div
            key={reason.code}
            style={{
              padding: "8px 9px",
              borderRadius: 8,
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{reason.label}</div>
            <strong style={{ display: "block", marginTop: 3, fontSize: 14 }}>
              {reason.count}개
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlanningRecommendationPanelV2({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedId = useProjectStore((state) => state.selectedPlanningScenarioId);
  const representativeId = useProjectStore(
    (state) => state.representativePlanningScenarioId
  );
  const setPlanningScenarios = useProjectStore(
    (state) => state.setPlanningScenarios
  );
  const selectPlanningScenario = useProjectStore(
    (state) => state.selectPlanningScenario
  );
  const duplicatePlanningScenario = useProjectStore(
    (state) => state.duplicatePlanningScenario
  );
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] =
    useState<PlanningRecommendationAnalysis | null>(null);
  const [message, setMessage] = useState<{ basis: string; text: string } | null>(null);
  const calculationJob = useRef<AbortController | null>(null);

  const parcel = data?.parcel;
  const projectScenarios = planningScenarios.filter(
    (scenario) => scenario.projectId === projectId
  );
  const input = useMemo(() => data?.parcel.id === projectId
    ? planningRecommendationInput(data, projectId) : null, [data, projectId]);
  const inputBasis = input ? planningRecommendationInputBasis(input) : null;
  useEffect(() => {
    setRunning(false);
    const unsubscribe = clientSession.subscribe(() => {
      calculationJob.current?.abort();
      calculationJob.current = null;
      setRunning(false);
    });
    return () => {
      unsubscribe();
      calculationJob.current?.abort();
      calculationJob.current = null;
    };
  }, [projectId, inputBasis]);
  const { current: recommendations, stale: staleRecommendations } =
    selectCurrentPlanningRecommendations(projectScenarios, projectId, inputBasis);
  const currentLastResult = lastResult?.inputBasis === inputBasis && staleRecommendations.length === 0
    ? lastResult : null;
  const currentMessage = message?.basis === inputBasis && staleRecommendations.length === 0
    ? message.text : null;
  const safe =
    recommendations.find(
      (scenario) =>
        scenario.recommendation?.objective === "architectural-feasibility"
    ) ?? null;
  const storedProfit =
    recommendations.find(
        (scenario) => scenario.recommendation?.objective === "profit"
      ) ?? null;
  const combined = Boolean(
    safe?.recommendation?.alsoSelectedFor?.includes("profit") ||
      recommendationsSharePhysicalPlan(safe, storedProfit)
  );
  const profit = combined ? null : storedProfit;
  const displayedSafe = useMemo(() => {
    if (!combined || !safe?.recommendation) return safe;
    const profitMetadata = storedProfit?.recommendation;
    return {
      ...safe,
      recommendation: {
        ...safe.recommendation,
        alsoSelectedFor: ["profit" as const],
        profitSelectionMode:
          profitMetadata?.profitSelectionMode ??
          safe.recommendation.profitSelectionMode,
        reasons: [
          ...safe.recommendation.reasons,
          ...(profitMetadata?.reasons ?? []),
        ].filter((reason, index, all) => all.indexOf(reason) === index),
      },
    };
  }, [combined, safe, storedProfit]);
  const max =
    recommendations.find(
      (scenario) => scenario.recommendation?.objective === "legal-ceiling"
    ) ?? null;

  const calculations = useMemo(() => {
    const result = new Map<string, PlanningScenarioCalculation>();
    if (!parcel || !input) return result;
    for (const scenario of [displayedSafe, profit, max]) {
      if (!scenario) continue;
      const base = calculatePlanningScenario(scenario, {
        parcel: input.parcel,
        assumptions: input.assumptions,
        calculatedAt: data?.meta.lastSyncedAt,
      });
      const spatial = calculatePlanningSpatialValidation(
        parcel.boundary,
        parcel.zoning ?? "",
        scenario,
        parcel.roads,
        parcel.setback,
        base.sunlight,
        base.metrics.roofAllowanceM,
        parcel.boundaryPolygons
      );
      result.set(scenario.id, applySpatialValidationToCalculation(base, spatial));
    }
    return result;
  }, [input, data?.meta.lastSyncedAt, displayedSafe, max, parcel, profit]);

  const persistedMetadata =
    displayedSafe?.recommendation ?? profit?.recommendation ?? max?.recommendation;
  const persistedRejectionSummary: RecommendationRejectionSummary | null =
    persistedMetadata?.rejectedCandidates != null
      ? {
          rejectedCandidates: persistedMetadata.rejectedCandidates,
          reasons: persistedMetadata.rejectionReasons ?? [],
          multipleReasonsPossible: true,
        }
      : null;
  const rejectionSummary = currentLastResult?.rejectionSummary ?? persistedRejectionSummary;

  if (!data || !parcel || !input || !inputBasis) return null;

  const generate = () => {
    if (!clientSession.active) return;
    const representative = projectScenarios.find(
      (scenario) => scenario.id === representativeId
    );
    if (
      representative &&
      ALGORITHM_ORIGINS.has(representative.origin) &&
      !window.confirm(
        "현재 대표 계획안이 기존 알고리즘 추천안입니다. 추천안을 다시 계산하면 대표안 확정이 해제될 수 있습니다. 계속할까요?"
      )
    ) {
      return;
    }

    setRunning(true);
    setMessage(null);
    setLastResult(null);
    calculationJob.current?.abort();
    const job = new AbortController();
    calculationJob.current = job;
    const startedState = useProjectStore.getState();
    const replacementBasis = (scenarios: PlanningScenario[]) => JSON.stringify(scenarios
      .filter(scenario => scenario.projectId === projectId && ALGORITHM_ORIGINS.has(scenario.origin)));
    const startedReplacementBasis = replacementBasis(startedState.planningScenarios);
    const startedRepresentativeId = startedState.representativePlanningScenarioId;
    const startedSelectionId = startedState.selectedPlanningScenarioId;
    const isCurrentInput = () => {
      const latestData = useProjectStore.getState().data;
      return clientSession.active && !job.signal.aborted && calculationJob.current === job && latestData?.parcel.id === projectId
        && planningRecommendationInputBasis(planningRecommendationInput(latestData, projectId)) === inputBasis;
    };
    const setInputMessage = (text: string) => setMessage({ basis: inputBasis, text });
    window.setTimeout(async () => {
      try {
        if (!isCurrentInput()) return;
        const result = await runPlanningRecommendationWorker({
          ...input,
          generatedAt: new Date().toISOString(),
        }, job.signal);
        if (!isCurrentInput() || result.inputBasis !== inputBasis) return;
        setLastResult(result);
        if (result.searchStatus !== "complete") {
          setInputMessage(`후보 ${result.evaluatedCandidates}개까지 검토했지만 전체 탐색을 완료하지 못했습니다. 추천 순위는 보류하고 기존 계획을 유지합니다.`);
          return;
        }
        const latestState = useProjectStore.getState();
        if (replacementBasis(latestState.planningScenarios) !== startedReplacementBasis
          || latestState.representativePlanningScenarioId !== startedRepresentativeId) {
          setInputMessage("계산 중 기존 추천안 또는 대표안이 변경되었습니다. 편집 내용을 유지하고 새 추천안 적용을 보류했습니다.");
          return;
        }
        const manualPlans = useProjectStore.getState().planningScenarios.filter(
          (scenario) =>
            scenario.projectId !== projectId ||
            !ALGORITHM_ORIGINS.has(scenario.origin)
        );
        const generated = result.sharedPrimaryCandidate
          ? [
              result.combinedPrimary
                ? uniqueRecommendationScenario(result.combinedPrimary, "safe")
                : null,
              result.legalCeilingReference
                ? uniqueRecommendationScenario(result.legalCeilingReference, "max")
                : null,
            ]
          : [
              result.architecturalFeasibility
                ? uniqueRecommendationScenario(
                    result.architecturalFeasibility,
                    "safe"
                  )
                : null,
              result.profitOptimal
                ? uniqueRecommendationScenario(result.profitOptimal, "profit")
                : null,
              result.legalCeilingReference
                ? uniqueRecommendationScenario(result.legalCeilingReference, "max")
                : null,
            ];
        const validGenerated = generated.filter(
          (scenario): scenario is PlanningScenario => Boolean(scenario)
        );
        setPlanningScenarios([...manualPlans, ...validGenerated]);
        const firstEditable = validGenerated.find(
          (scenario) =>
            scenario.recommendation?.objective !== "legal-ceiling"
        );
        if (latestState.selectedPlanningScenarioId === startedSelectionId) {
          selectPlanningScenario(firstEditable?.id ?? validGenerated[0]?.id ?? null);
        }
        setLastResult(result);

        if (result.eligibleCandidates <= 0) {
          setInputMessage(
            `후보 ${result.evaluatedCandidates}개를 검토했지만 실행 가능한 후보를 찾지 못했습니다.`
          );
        } else if (result.sharedPrimaryCandidate) {
          setInputMessage(
            result.profitMode === "loss-minimization"
              ? `후보 ${result.evaluatedCandidates}개 중 실행 가능 ${result.eligibleCandidates}개를 찾았습니다. 동일 계획안이 건축 타당성 1위이자 예상 손실 최소안입니다.`
              : `후보 ${result.evaluatedCandidates}개 중 실행 가능 ${result.eligibleCandidates}개를 찾았습니다. 동일 계획안이 건축 타당성과 개략 수익 두 기준 모두 1위입니다.`
          );
        } else {
          setInputMessage(
            result.profitMode === "loss-minimization"
              ? `후보 ${result.evaluatedCandidates}개 중 실행 가능 ${result.eligibleCandidates}개를 찾았습니다. 모든 실행 가능 후보가 적자여서 손실 최소안을 표시합니다.`
              : `후보 ${result.evaluatedCandidates}개 중 실행 가능 ${result.eligibleCandidates}개를 찾았습니다.`
          );
        }
      } catch (error) {
        if (!isCurrentInput()) return;
        setInputMessage(
          error instanceof Error
            ? error.message
            : "추천 계획안 계산 중 오류가 발생했습니다."
        );
      } finally {
        if (calculationJob.current === job) {
          calculationJob.current = null;
          setRunning(false);
        }
      }
    }, 20);
  };

  const openScenario = (scenario: PlanningScenario | null) => {
    if (scenario) selectPlanningScenario(scenario.id);
  };

  const cloneScenario = (scenario: PlanningScenario | null) => {
    if (!scenario) return;
    duplicatePlanningScenario(scenario.id, `${scenario.name} 기반 내 계획안`);
  };

  return (
    <section
      style={{
        maxWidth: 1380,
        margin: "0 auto",
        padding: "var(--s6) var(--s5) 0",
      }}
    >
      <Panel
        title="추천 계획안"
        source="동일 후보군 · 건축 타당성/개략 손익 별도 순위 · 자동 적용 없음"
        bodyStyle={{ padding: "var(--s5)" }}
      >
        <div style={headingRowStyle}>
          <div style={{ maxWidth: 780 }}>
            <strong style={{ fontSize: 14 }}>
              계획안을 선택하기 전에 건축성과 손익을 서로 다른 기준으로 비교합니다.
            </strong>
            <p style={descriptionStyle}>
              두 기준의 1위가 같은 후보면 통합 추천안 한 개로 표시합니다. 모든 실행 가능
              후보가 적자인 경우에는 수익 최적안이 아니라 손실 최소안으로 명확히 표시합니다.
            </p>
          </div>
          <button
            type="button"
            style={primaryButton}
            onClick={generate}
            disabled={running}
          >
            {running
              ? "후보 계산 중…"
              : recommendations.length + staleRecommendations.length > 0
                ? "추천안 다시 계산"
                : "추천안 계산"}
          </button>
          {running && <button type="button" aria-label="추천 계산 취소" title="추천 계산 취소"
            onClick={() => {
              calculationJob.current?.abort();
              calculationJob.current = null;
              setRunning(false);
              setMessage({ basis: inputBasis, text: "추천 계산을 취소했습니다. 기존 계획은 유지됩니다." });
            }} style={{ ...primaryButton, padding: 8, display: "inline-flex" }}><X size={18} aria-hidden="true" /></button>}
        </div>

        {staleRecommendations.length > 0 && (
          <div role="status" style={messageStyle}>
            이전 추천 {staleRecommendations.length}개는 입력 기준이 없거나 현재 입력·계획과 달라
            추천 순위와 근거를 표시하지 않습니다. 저장된 계획은 유지됩니다. 현재 입력으로 추천안을 다시 계산하세요.
          </div>
        )}

        {(currentMessage || currentLastResult?.warnings.length) && (
          <div style={messageStyle}>
            {currentMessage}
            {currentLastResult?.warnings.map((warning) => (
              <div key={warning}>· {warning}</div>
            ))}
          </div>
        )}

        <RejectionSummary summary={rejectionSummary} />

        {currentLastResult && <DwellingComparisonTable evaluations={currentLastResult.evaluations} input={input} onCopy={(scenario) => {
          const copy = clonePlanningScenario(scenario, `${scenario.name} 비교 편집안`);
          setPlanningScenarios([...useProjectStore.getState().planningScenarios, copy]);
          selectPlanningScenario(copy.id);
        }} />}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: combined
              ? "minmax(0, 1.35fr) minmax(0, 1fr)"
              : "repeat(3, minmax(0, 1fr))",
            gap: 10,
            marginTop: 14,
          }}
          className="recommendation-card-grid-v2"
        >
          <RecommendationCard
            scenario={displayedSafe}
            calculation={
              displayedSafe ? calculations.get(displayedSafe.id) ?? null : null
            }
            selected={safe?.id === selectedId}
            combined={combined}
            onOpen={() => openScenario(safe)}
            onClone={() => cloneScenario(safe)}
          />
          {!combined && (
            <RecommendationCard
              scenario={profit}
              calculation={profit ? calculations.get(profit.id) ?? null : null}
              selected={profit?.id === selectedId}
              onOpen={() => openScenario(profit)}
              onClone={() => cloneScenario(profit)}
            />
          )}
          <RecommendationCard
            scenario={max}
            calculation={max ? calculations.get(max.id) ?? null : null}
            selected={max?.id === selectedId}
            onOpen={() => openScenario(max)}
            onClone={() => undefined}
          />
        </div>

      </Panel>
    </section>
  );
}

function MiniMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? "var(--pos-fg)"
      : tone === "negative"
        ? "var(--neg-fg)"
        : "var(--fg)";
  return (
    <div
      style={{
        padding: "7px 8px",
        borderRadius: 7,
        background: "var(--bg-sunken)",
      }}
    >
      <div style={{ fontSize: 9, color: "var(--fg-faint)" }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 10.5, fontWeight: 720, color }}>
        {value}
      </div>
    </div>
  );
}

const emptyCardStyle = {
  minHeight: 210,
  padding: 14,
  border: "1px dashed var(--border)",
  borderRadius: 11,
  background: "var(--bg-sunken)",
  display: "grid",
  placeItems: "center",
  color: "var(--fg-muted)",
  fontSize: 11,
  textAlign: "center",
} as const;

const fourMetricGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 6,
  marginTop: 12,
} as const;

const twoMetricGridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
  marginTop: 6,
} as const;

const headingRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 14,
  flexWrap: "wrap",
} as const;

const descriptionStyle = {
  margin: "6px 0 0",
  fontSize: 11,
  lineHeight: 1.6,
  color: "var(--fg-muted)",
} as const;

const messageStyle = {
  marginTop: 12,
  padding: "9px 11px",
  borderRadius: 8,
  background: "var(--bg-sunken)",
  color: "var(--fg-muted)",
  fontSize: 10.5,
  lineHeight: 1.55,
} as const;

const primaryButton = {
  border: "1px solid var(--fg)",
  borderRadius: 8,
  padding: "9px 13px",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 11,
  fontWeight: 720,
  cursor: "pointer",
} as const;

const secondaryButton = {
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: "7px 9px",
  background: "var(--bg-elev)",
  color: "var(--fg)",
  fontSize: 10.5,
  cursor: "pointer",
} as const;
