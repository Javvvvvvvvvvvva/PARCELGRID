"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/primitives";
import { defaultAssumptions } from "@/lib/finance/scenario";
import {
  generatePlanningRecommendationsV2,
  type PlanningRecommendationAnalysis,
  type RecommendationProfitMode,
  type RecommendationRejectionSummary,
} from "@/lib/planning/recommendation-analysis";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
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

  const summary = summarizePlanningScenario(scenario);
  const metadata = scenario.recommendation;
  const profit = calculation.economicsPreview.profitManwon;
  const failCount = calculation.checks.filter((check) => check.status === "fail").length;
  const reviewCount = calculation.checks.filter(
    (check) => check.status === "review" || check.status === "unknown"
  ).length;
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
              <span className="ui-tag">실행 가능 후보</span>
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
            failCount > 0
              ? `미충족 ${failCount}`
              : reviewCount > 0
                ? `통과 · 확인 ${reviewCount}`
                : "필수항목 통과"
          }
          tone={failCount > 0 ? "negative" : "positive"}
        />
      </div>

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
  const [message, setMessage] = useState<string | null>(null);

  const parcel = data?.parcel;
  const projectScenarios = planningScenarios.filter(
    (scenario) => scenario.projectId === projectId
  );
  const recommendations = projectScenarios.filter((scenario) =>
    Boolean(scenario.recommendation)
  );
  const safe =
    recommendations.find(
      (scenario) =>
        scenario.recommendation?.objective === "architectural-feasibility"
    ) ?? null;
  const combined = Boolean(
    safe?.recommendation?.alsoSelectedFor?.includes("profit")
  );
  const profit = combined
    ? null
    : recommendations.find(
        (scenario) => scenario.recommendation?.objective === "profit"
      ) ?? null;
  const max =
    recommendations.find(
      (scenario) => scenario.recommendation?.objective === "legal-ceiling"
    ) ?? null;

  const assumptions = useMemo(() => {
    const legacy =
      data?.scenarios.find((scenario) => scenario.recommended)?._raw.assumptions ??
      data?.scenarios[0]?._raw.assumptions ??
      defaultAssumptions();
    return planningEconomicsAssumptionsFromLegacy(
      legacy,
      `stage2-recommend-${data?.meta.version ?? "local"}`
    );
  }, [data]);

  const calculations = useMemo(() => {
    const result = new Map<string, PlanningScenarioCalculation>();
    if (!parcel) return result;
    for (const scenario of [safe, profit, max]) {
      if (!scenario) continue;
      const base = calculatePlanningScenario(scenario, {
        parcel: {
          lotAreaSqm: parcel.lotArea,
          maxFARPct: parcel.maxFAR,
          maxBCRPct: parcel.maxBCR,
          heightLimitM: parcel.heightLimit ?? 0,
          acquisitionCostManwon: parcel.acquiredPrice,
          demolitionCostManwon: parcel.demolitionCost ?? 0,
        },
        assumptions,
        calculatedAt: data?.meta.lastSyncedAt,
      });
      const spatial = calculatePlanningSpatialValidation(
        parcel.boundary,
        parcel.zoning ?? "",
        scenario,
        parcel.roads,
        parcel.setback
      );
      result.set(scenario.id, applySpatialValidationToCalculation(base, spatial));
    }
    return result;
  }, [assumptions, data?.meta.lastSyncedAt, max, parcel, profit, safe]);

  const persistedMetadata = safe?.recommendation ?? profit?.recommendation ?? max?.recommendation;
  const persistedRejectionSummary: RecommendationRejectionSummary | null =
    persistedMetadata?.rejectedCandidates != null
      ? {
          rejectedCandidates: persistedMetadata.rejectedCandidates,
          reasons: persistedMetadata.rejectionReasons ?? [],
          multipleReasonsPossible: true,
        }
      : null;
  const rejectionSummary = lastResult?.rejectionSummary ?? persistedRejectionSummary;

  if (!data || !parcel) return null;

  const generate = () => {
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
    window.setTimeout(() => {
      try {
        const result = generatePlanningRecommendationsV2({
          projectId,
          parcel: {
            lotAreaSqm: parcel.lotArea,
            maxFARPct: parcel.maxFAR,
            maxBCRPct: parcel.maxBCR,
            heightLimitM: parcel.heightLimit ?? 0,
            acquisitionCostManwon: parcel.acquiredPrice,
            demolitionCostManwon: parcel.demolitionCost ?? 0,
            boundary: parcel.boundary,
            zoning: parcel.zoning ?? "",
            roads: parcel.roads,
            setback: parcel.setback,
          },
          assumptions,
          generatedAt: new Date().toISOString(),
        });
        const manualPlans = planningScenarios.filter(
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
        selectPlanningScenario(firstEditable?.id ?? validGenerated[0]?.id ?? null);
        setLastResult(result);

        if (result.eligibleCandidates <= 0) {
          setMessage(
            `후보 ${result.evaluatedCandidates}개를 검토했지만 실행 가능한 후보를 찾지 못했습니다.`
          );
        } else if (result.sharedPrimaryCandidate) {
          setMessage(
            result.profitMode === "loss-minimization"
              ? `후보 ${result.evaluatedCandidates}개 중 실행 가능 ${result.eligibleCandidates}개를 찾았습니다. 동일 계획안이 건축 타당성 1위이자 예상 손실 최소안입니다.`
              : `후보 ${result.evaluatedCandidates}개 중 실행 가능 ${result.eligibleCandidates}개를 찾았습니다. 동일 계획안이 건축 타당성과 개략 수익 두 기준 모두 1위입니다.`
          );
        } else {
          setMessage(
            result.profitMode === "loss-minimization"
              ? `후보 ${result.evaluatedCandidates}개 중 실행 가능 ${result.eligibleCandidates}개를 찾았습니다. 모든 실행 가능 후보가 적자여서 손실 최소안을 표시합니다.`
              : `후보 ${result.evaluatedCandidates}개 중 실행 가능 ${result.eligibleCandidates}개를 찾았습니다.`
          );
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "추천 계획안 계산 중 오류가 발생했습니다."
        );
      } finally {
        setRunning(false);
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
              : recommendations.length > 0
                ? "추천안 다시 계산"
                : "추천안 계산"}
          </button>
        </div>

        {(message || lastResult?.warnings.length) && (
          <div style={messageStyle}>
            {message}
            {lastResult?.warnings.map((warning) => (
              <div key={warning}>· {warning}</div>
            ))}
          </div>
        )}

        <RejectionSummary summary={rejectionSummary} />

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
            scenario={safe}
            calculation={safe ? calculations.get(safe.id) ?? null : null}
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

        <style jsx>{`
          @media (max-width: 980px) {
            .recommendation-card-grid-v2,
            .rejection-reason-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
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
