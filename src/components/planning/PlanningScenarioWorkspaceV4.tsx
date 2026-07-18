"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloorProgramEditor } from "@/components/planning/FloorProgramEditor";
import { PlanningMassingView } from "@/components/planning/PlanningMassingView";
import { Panel, SectionTitle } from "@/components/ui/primitives";
import { defaultAssumptions } from "@/lib/finance/scenario";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import {
  createBlankScenarioForParcel,
  createStarterPlanningScenario,
  type PlanningScenarioParcelSeed,
} from "@/lib/planning/scenario-factory";
import {
  applySpatialValidationToCalculation,
  calculatePlanningSpatialValidation,
} from "@/lib/planning/scenario-spatial-validation";
import type {
  PlanningCheckStatus,
  PlanningScenario,
  PlanningScenarioCalculation,
  PlanningScenarioOrigin,
} from "@/lib/planning/types";
import { useProjectStore } from "@/lib/stores/project-store";
import { num, pyeong, won } from "@/lib/utils/format";

const ORIGIN_LABEL: Record<PlanningScenarioOrigin, string> = {
  "algorithm-safe": "안정형",
  "algorithm-balanced": "균형형",
  "algorithm-max": "최대개발형",
  custom: "직접 설계",
  legacy: "기존 입력",
};

const CHECK_TONE: Record<
  PlanningCheckStatus,
  { label: string; bg: string; fg: string }
> = {
  pass: { label: "통과", bg: "var(--pos-soft)", fg: "var(--pos-fg)" },
  review: {
    label: "검토",
    bg: "var(--warn-soft)",
    fg: "var(--warn-fg)",
  },
  fail: { label: "미충족", bg: "var(--neg-soft)", fg: "var(--neg-fg)" },
  unknown: {
    label: "미확인",
    bg: "var(--bg-sunken)",
    fg: "var(--fg-muted)",
  },
};

type NewPlanMode = "blank" | "clone";

function scenarioSeed(parcel: {
  lotArea: number;
  maxFAR: number;
  maxBCR: number;
  acquiredPrice: number;
  demolitionCost?: number;
}): PlanningScenarioParcelSeed {
  return {
    lotAreaSqm: parcel.lotArea,
    maxFARPct: parcel.maxFAR,
    maxBCRPct: parcel.maxBCR,
    acquisitionCostManwon: parcel.acquiredPrice,
    demolitionCostManwon: parcel.demolitionCost ?? 0,
  };
}

function planHealth(calculation: PlanningScenarioCalculation): {
  fail: number;
  review: number;
} {
  return calculation.checks.reduce(
    (result, check) => {
      if (check.status === "fail") result.fail += 1;
      if (check.status === "review" || check.status === "unknown") {
        result.review += 1;
      }
      return result;
    },
    { fail: 0, review: 0 }
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: PlanningCheckStatus;
}) {
  const style = CHECK_TONE[tone];
  return (
    <span
      style={{
        padding: "3px 7px",
        borderRadius: 999,
        background: style.bg,
        color: style.fg,
        fontSize: 10.5,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 10.5, color: "var(--fg-subtle)" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 17,
          fontWeight: 750,
          letterSpacing: "-0.025em",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{ marginTop: 3, fontSize: 10.5, color: "var(--fg-faint)" }}
        >
          {sub}
        </div>
      )}
    </div>
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
        background: "var(--bg-sunken)",
        borderRadius: 7,
      }}
    >
      <div style={{ fontSize: 9, color: "var(--fg-faint)" }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 10.5, fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}

function PlanCard({
  scenario,
  calculation,
  active,
  representative,
  onSelect,
  onDuplicate,
}: {
  scenario: PlanningScenario;
  calculation: PlanningScenarioCalculation;
  active: boolean;
  representative: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
}) {
  const health = planHealth(calculation);
  const profit = calculation.economicsPreview.profitManwon;
  const firstFailure = calculation.checks.find(
    (check) => check.status === "fail"
  );

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      style={{
        padding: 13,
        borderRadius: 11,
        border: active
          ? "1.5px solid var(--fg)"
          : representative
            ? "1.5px solid var(--pos-fg)"
            : "1px solid var(--border)",
        background: active ? "var(--bg-sunken)" : "var(--bg-elev)",
        cursor: "pointer",
        outline: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 9 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <strong style={{ fontSize: 13.5 }}>{scenario.name}</strong>
            <span className="ui-tag">{ORIGIN_LABEL[scenario.origin]}</span>
            {representative && <span className="ui-tag">대표안</span>}
            {scenario.status === "draft" && <span className="ui-tag">미저장</span>}
          </div>
          <div
            style={{ marginTop: 5, fontSize: 10.5, color: "var(--fg-muted)" }}
          >
            {calculation.metrics.aboveGroundFloors}층
            {calculation.metrics.undergroundFloors > 0
              ? ` · B${calculation.metrics.undergroundFloors}`
              : ""}
            {` · 주거 ${calculation.metrics.residentialUnitCount}세대`}
            {calculation.metrics.commercialUnitCount > 0
              ? ` · 상가·업무 ${calculation.metrics.commercialUnitCount}실`
              : ""}
          </div>
        </div>
        <button
          type="button"
          style={smallButtonStyle}
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate();
          }}
        >
          복제
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          marginTop: 10,
        }}
      >
        <MiniMetric
          label="용적률"
          value={`${calculation.metrics.preliminaryFarPct.toFixed(1)}%`}
        />
        <MiniMetric
          label="주차"
          value={`${calculation.metrics.providedCars}/${calculation.metrics.requiredCars}대`}
        />
        <MiniMetric
          label="개략 이익"
          value={won(profit, { sign: true })}
          tone={profit >= 0 ? "positive" : "negative"}
        />
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
        {health.fail > 0 ? (
          <StatusPill label={`미충족 ${health.fail}`} tone="fail" />
        ) : (
          <StatusPill label="필수항목 통과" tone="pass" />
        )}
        {health.review > 0 && (
          <StatusPill label={`확인 ${health.review}`} tone="review" />
        )}
        <span
          style={{ marginLeft: "auto", fontSize: 10, color: "var(--fg-faint)" }}
        >
          v{scenario.version}
        </span>
      </div>

      {firstFailure && (
        <div
          style={{
            marginTop: 8,
            fontSize: 9.5,
            lineHeight: 1.4,
            color: "var(--neg-fg)",
          }}
        >
          {firstFailure.label}: {firstFailure.message}
        </div>
      )}
    </article>
  );
}

function UnifiedStatusBanner({
  calculation,
  representative,
}: {
  calculation: PlanningScenarioCalculation;
  representative: boolean;
}) {
  const health = planHealth(calculation);
  const tone: PlanningCheckStatus =
    health.fail > 0 ? "fail" : health.review > 0 ? "review" : "pass";
  const style = CHECK_TONE[tone];
  return (
    <div
      style={{
        marginTop: 12,
        padding: "10px 12px",
        borderRadius: 9,
        background: style.bg,
        color: style.fg,
        border: `1px solid ${style.fg}`,
        fontSize: 10.5,
        lineHeight: 1.5,
      }}
    >
      <strong>
        {health.fail > 0
          ? `통합 판정 미충족 ${health.fail}건`
          : health.review > 0
            ? `필수항목 통과 · 확인 ${health.review}건`
            : "통합 판정 통과"}
      </strong>
      <span style={{ marginLeft: 7 }}>
        건폐율·용적률·높이·주차·층별 법규 외곽선·이동·회전을 같은 기준으로 판정합니다.
      </span>
      {representative && <span style={{ marginLeft: 7 }}>현재 대표 계획안입니다.</span>}
    </div>
  );
}

export function PlanningScenarioWorkspaceV4({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const data = useProjectStore((state) => state.data);
  const envelopePlan = useProjectStore((state) => state.envelopePlan);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const representativePlanningScenarioId = useProjectStore(
    (state) => state.representativePlanningScenarioId
  );
  const addPlanningScenario = useProjectStore(
    (state) => state.addPlanningScenario
  );
  const editPlanningScenarioDraft = useProjectStore(
    (state) => state.editPlanningScenarioDraft
  );
  const updatePlanningScenario = useProjectStore(
    (state) => state.updatePlanningScenario
  );
  const removePlanningScenario = useProjectStore(
    (state) => state.removePlanningScenario
  );
  const duplicatePlanningScenario = useProjectStore(
    (state) => state.duplicatePlanningScenario
  );
  const selectPlanningScenario = useProjectStore(
    (state) => state.selectPlanningScenario
  );
  const setRepresentativePlanningScenarioId = useProjectStore(
    (state) => state.setRepresentativePlanningScenarioId
  );
  const setActiveScenarioId = useProjectStore(
    (state) => state.setActiveScenarioId
  );

  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanName, setNewPlanName] = useState("새 계획안");
  const [newPlanMode, setNewPlanMode] = useState<NewPlanMode>("blank");
  const initializedRef = useRef(false);

  const parcel = data?.parcel;
  const projectScenarios = useMemo(
    () =>
      planningScenarios.filter((scenario) => scenario.projectId === projectId),
    [planningScenarios, projectId]
  );

  useEffect(() => {
    if (!parcel || initializedRef.current || projectScenarios.length > 0) return;
    initializedRef.current = true;
    addPlanningScenario(
      createStarterPlanningScenario(
        scenarioSeed(parcel),
        envelopePlan,
        projectId
      )
    );
  }, [
    parcel,
    projectScenarios.length,
    envelopePlan,
    projectId,
    addPlanningScenario,
  ]);

  useEffect(() => {
    if (projectScenarios.length === 0) return;
    if (
      !projectScenarios.some(
        (scenario) => scenario.id === selectedPlanningScenarioId
      )
    ) {
      selectPlanningScenario(projectScenarios[0].id);
    }
  }, [projectScenarios, selectedPlanningScenarioId, selectPlanningScenario]);

  const assumptions = useMemo(() => {
    const legacy =
      data?.scenarios.find((scenario) => scenario.recommended)?._raw
        .assumptions ??
      data?.scenarios[0]?._raw.assumptions ??
      defaultAssumptions();
    return planningEconomicsAssumptionsFromLegacy(
      legacy,
      `stage2-${data?.meta.version ?? "local"}`
    );
  }, [data]);

  const calculationContext = useMemo(() => {
    if (!parcel) return null;
    return {
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
    };
  }, [parcel, assumptions, data?.meta.lastSyncedAt]);

  const calculations = useMemo(() => {
    if (!calculationContext || !parcel) {
      return new Map<string, PlanningScenarioCalculation>();
    }
    return new Map(
      projectScenarios.map((scenario) => {
        const base = calculatePlanningScenario(scenario, calculationContext);
        const spatial = calculatePlanningSpatialValidation(
          parcel.boundary,
          parcel.zoning ?? "",
          scenario,
          parcel.roads,
          parcel.setback
        );
        return [
          scenario.id,
          applySpatialValidationToCalculation(base, spatial),
        ];
      })
    );
  }, [projectScenarios, calculationContext, parcel]);

  const selectedScenario =
    projectScenarios.find(
      (scenario) => scenario.id === selectedPlanningScenarioId
    ) ??
    projectScenarios[0] ??
    null;
  const selectedCalculation = selectedScenario
    ? calculations.get(selectedScenario.id) ?? null
    : null;
  const representativeScenario = projectScenarios.find(
    (scenario) => scenario.id === representativePlanningScenarioId
  );

  if (!data || !parcel) return null;

  const addPlan = () => {
    const name =
      newPlanName.trim() || `계획안 ${projectScenarios.length + 1}`;
    if (newPlanMode === "clone" && selectedScenario) {
      duplicatePlanningScenario(selectedScenario.id, name);
    } else {
      addPlanningScenario(
        createBlankScenarioForParcel(scenarioSeed(parcel), name, projectId)
      );
    }
    setNewPlanOpen(false);
    setNewPlanName(`계획안 ${projectScenarios.length + 2}`);
  };

  const saveSelected = () => {
    if (!selectedScenario || !selectedCalculation) return;
    updatePlanningScenario(selectedScenario.id, {
      status: "saved",
      checks: selectedCalculation.checks,
      economicsPreview: selectedCalculation.economicsPreview,
    });
  };

  const confirmRepresentative = () => {
    if (!selectedScenario || !selectedCalculation) return;
    const health = planHealth(selectedCalculation);
    if (health.fail > 0) {
      window.alert(
        `필수 미충족 ${health.fail}건이 있어 대표 계획안으로 확정할 수 없습니다. 법규·데이터 점검에서 내용을 확인하세요.`
      );
      return;
    }
    if (
      health.review > 0 &&
      !window.confirm(
        `확인 필요 항목이 ${health.review}건 있습니다. 검토 책임을 확인하고 대표 계획안으로 확정할까요?`
      )
    ) {
      return;
    }
    if (selectedScenario.status === "draft") {
      updatePlanningScenario(selectedScenario.id, {
        status: "saved",
        checks: selectedCalculation.checks,
        economicsPreview: selectedCalculation.economicsPreview,
      });
    }
    setRepresentativePlanningScenarioId(selectedScenario.id);
    setActiveScenarioId(selectedScenario.id);
  };

  const deleteSelected = () => {
    if (!selectedScenario) return;
    if (window.confirm(`“${selectedScenario.name}” 계획안을 삭제할까요?`)) {
      removePlanningScenario(selectedScenario.id);
    }
  };

  const selectedHealth = selectedCalculation
    ? planHealth(selectedCalculation)
    : { fail: 0, review: 0 };
  const isRepresentative =
    selectedScenario?.id === representativePlanningScenarioId;

  return (
    <div
      style={{
        maxWidth: 1380,
        margin: "0 auto",
        padding: embedded
          ? "var(--s5) var(--s5) var(--s6)"
          : "var(--s6) var(--s5) 80px",
      }}
    >
      {!embedded && (
        <>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: "var(--s5)",
              fontSize: 11.5,
              color: "var(--fg-muted)",
            }}
          >
            <Link
              href={`/projects/${projectId}/status`}
              style={{ color: "inherit", textDecoration: "none" }}
            >
              Stage 1 현황 분석
            </Link>
            <span>→</span>
            <strong style={{ color: "var(--fg)" }}>Stage 2</strong>
            <span>계획안 작성</span>
          </div>

          <div className="page-heading">
            <SectionTitle
              size="lg"
              title="계획 스튜디오"
              desc={`${parcel.address} · ${parcel.zoning} · 층별 계획과 개략 사업성을 함께 검토합니다.`}
            />
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() => setNewPlanOpen(true)}
            >
              ＋ 새 안 추가
            </button>
          </div>
        </>
      )}

      {embedded && (
        <div className="page-heading compact-heading">
          <div>
            <strong style={{ fontSize: 15 }}>내 계획안</strong>
            <p style={{ margin: "4px 0 0", fontSize: 10.5, color: "var(--fg-muted)" }}>
              {parcel.address} · {parcel.zoning}
            </p>
          </div>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => setNewPlanOpen(true)}
          >
            ＋ 새 안 추가
          </button>
        </div>
      )}

      <div className="parcel-metrics">
        <Metric
          label="대지면적"
          value={pyeong(parcel.lotArea)}
          sub={`${num(parcel.lotArea, 1)}㎡`}
        />
        <Metric label="법정 건폐율" value={`${parcel.maxBCR}%`} />
        <Metric label="법정 용적률" value={`${parcel.maxFAR}%`} />
        <Metric
          label="인수가"
          value={won(parcel.acquiredPrice, { full: true })}
        />
        <Metric
          label="대표 계획안"
          value={representativeScenario?.name ?? "미확정"}
          sub={representativeScenario ? `v${representativeScenario.version}` : "Stage 3 전달 전"}
        />
      </div>

      {newPlanOpen && (
        <Panel
          style={{ marginBottom: "var(--s5)" }}
          bodyStyle={{ padding: "var(--s5)" }}
        >
          <div className="new-plan-grid">
            <label>
              <span style={fieldLabelStyle}>계획안 이름</span>
              <input
                autoFocus
                value={newPlanName}
                onChange={(event) => setNewPlanName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addPlan();
                }}
                style={inputStyle}
              />
            </label>
            <div>
              <span style={fieldLabelStyle}>시작 방식</span>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <ModeButton
                  active={newPlanMode === "blank"}
                  onClick={() => setNewPlanMode("blank")}
                  label="빈 계획"
                />
                <ModeButton
                  active={newPlanMode === "clone"}
                  disabled={!selectedScenario}
                  onClick={() => setNewPlanMode("clone")}
                  label="선택안 복제"
                />
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "end",
                justifyContent: "flex-end",
                gap: 7,
              }}
            >
              <button
                type="button"
                style={smallButtonStyle}
                onClick={() => setNewPlanOpen(false)}
              >
                취소
              </button>
              <button type="button" style={primaryButtonStyle} onClick={addPlan}>
                계획안 만들기
              </button>
            </div>
          </div>
        </Panel>
      )}

      <div className="workspace-grid">
        <aside>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 9,
            }}
          >
            <strong style={{ fontSize: 13.5 }}>계획안 목록</strong>
            <span style={{ fontSize: 10, color: "var(--fg-faint)" }}>
              통합 판정
            </span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {projectScenarios.map((scenario) => {
              const calculation = calculations.get(scenario.id);
              if (!calculation) return null;
              return (
                <PlanCard
                  key={scenario.id}
                  scenario={scenario}
                  calculation={calculation}
                  active={scenario.id === selectedScenario?.id}
                  representative={
                    scenario.id === representativePlanningScenarioId
                  }
                  onSelect={() => selectPlanningScenario(scenario.id)}
                  onDuplicate={() => duplicatePlanningScenario(scenario.id)}
                />
              );
            })}
          </div>
        </aside>

        <main>
          {selectedScenario && selectedCalculation ? (
            <div style={{ display: "grid", gap: "var(--s5)" }}>
              <Panel bodyStyle={{ padding: "var(--s5)" }}>
                <div className="selected-heading">
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 7,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <input
                        value={selectedScenario.name}
                        onChange={(event) =>
                          editPlanningScenarioDraft(selectedScenario.id, {
                            name: event.target.value,
                          })
                        }
                        aria-label="계획안 이름"
                        style={{
                          ...inputStyle,
                          maxWidth: 360,
                          fontSize: 18,
                          fontWeight: 750,
                        }}
                      />
                      <span className="ui-tag">
                        {ORIGIN_LABEL[selectedScenario.origin]}
                      </span>
                      <span className="ui-tag">v{selectedScenario.version}</span>
                      {isRepresentative && <span className="ui-tag">대표안</span>}
                      {selectedScenario.status === "draft" && (
                        <span className="ui-tag">미저장 변경</span>
                      )}
                    </div>
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontSize: 10.5,
                        color: "var(--fg-muted)",
                      }}
                    >
                      층별 편집과 배치 결과가 3D·법규·사업성 통합 판정에 실시간 반영됩니다.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={smallButtonStyle}
                      onClick={() =>
                        duplicatePlanningScenario(selectedScenario.id)
                      }
                    >
                      복제
                    </button>
                    <button
                      type="button"
                      style={{ ...smallButtonStyle, color: "var(--neg-fg)" }}
                      onClick={deleteSelected}
                    >
                      삭제
                    </button>
                    <button
                      type="button"
                      style={primaryButtonStyle}
                      onClick={saveSelected}
                    >
                      계획안 저장
                    </button>
                    <button
                      type="button"
                      style={{
                        ...confirmButtonStyle,
                        opacity: selectedHealth.fail > 0 ? 0.55 : 1,
                      }}
                      onClick={confirmRepresentative}
                    >
                      {isRepresentative ? "대표안 확정됨" : "대표안 확정"}
                    </button>
                  </div>
                </div>

                <UnifiedStatusBanner
                  calculation={selectedCalculation}
                  representative={isRepresentative}
                />

                <PlanningMassingView
                  boundary={parcel.boundary}
                  zoning={parcel.zoning ?? ""}
                  scenario={selectedScenario}
                  roads={parcel.roads}
                  setback={parcel.setback}
                  height={430}
                />

                <div className="selected-metrics">
                  <Metric
                    label="지상 / 지하"
                    value={`${selectedCalculation.metrics.aboveGroundFloors}F / B${selectedCalculation.metrics.undergroundFloors}`}
                  />
                  <Metric
                    label="주거 세대"
                    value={`${selectedCalculation.metrics.residentialUnitCount}세대`}
                  />
                  <Metric
                    label="상가·업무"
                    value={`${selectedCalculation.metrics.commercialUnitCount}실`}
                  />
                  <Metric
                    label="예비 건폐율"
                    value={`${selectedCalculation.metrics.preliminaryBcrPct.toFixed(1)}%`}
                    sub={`상한 ${parcel.maxBCR}%`}
                  />
                  <Metric
                    label="예비 용적률"
                    value={`${selectedCalculation.metrics.preliminaryFarPct.toFixed(1)}%`}
                    sub={`상한 ${parcel.maxFAR}%`}
                  />
                  <Metric
                    label="주차"
                    value={`${selectedCalculation.metrics.providedCars}/${selectedCalculation.metrics.requiredCars}대`}
                    sub={
                      selectedCalculation.metrics.parkingShortfallCars > 0
                        ? `${selectedCalculation.metrics.parkingShortfallCars}대 부족`
                        : "예비 기준 충족"
                    }
                  />
                </div>
              </Panel>

              <Panel
                title="개략 사업성"
                source="Stage 2 비교용 · Stage 3에서 정밀 계산"
                bodyStyle={{ padding: "var(--s5)" }}
              >
                <div className="economics-grid">
                  <Metric
                    label="예상 매출·가치"
                    value={won(
                      selectedCalculation.economicsPreview
                        .expectedRevenueManwon,
                      { full: true }
                    )}
                  />
                  <Metric
                    label="총사업비"
                    value={won(
                      selectedCalculation.economicsPreview.totalCostManwon,
                      { full: true }
                    )}
                  />
                  <Metric
                    label="공사비"
                    value={won(
                      selectedCalculation.economicsPreview
                        .constructionCostManwon,
                      { full: true }
                    )}
                  />
                  <Metric
                    label="예상 이익"
                    value={won(
                      selectedCalculation.economicsPreview.profitManwon,
                      { full: true, sign: true }
                    )}
                    sub={`이익률 ${selectedCalculation.economicsPreview.profitMarginPct.toFixed(1)}%`}
                  />
                  <Metric
                    label="연간 NOI"
                    value={won(
                      selectedCalculation.economicsPreview
                        .expectedAnnualNoiManwon,
                      { full: true }
                    )}
                  />
                </div>
              </Panel>

              <div className="lower-grid">
                <Panel
                  title="층별 프로그램 편집"
                  source="실시간 재계산"
                  bodyStyle={{ padding: "var(--s4)" }}
                >
                  <FloorProgramEditor
                    scenario={selectedScenario}
                    onChange={(patch) =>
                      editPlanningScenarioDraft(selectedScenario.id, patch)
                    }
                  />
                </Panel>

                <Panel
                  title="법규·데이터 점검"
                  source="통합 판정 · 3D 배치 포함"
                  bodyStyle={{ padding: "var(--s4)" }}
                >
                  <div style={{ display: "grid", gap: 9 }}>
                    {selectedCalculation.checks.map((check) => (
                      <div
                        key={check.code}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr",
                          gap: 8,
                        }}
                      >
                        <StatusPill
                          label={CHECK_TONE[check.status].label}
                          tone={check.status}
                        />
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                            {check.label}
                          </div>
                          <div
                            style={{
                              marginTop: 2,
                              fontSize: 10.5,
                              lineHeight: 1.45,
                              color: "var(--fg-muted)",
                            }}
                          >
                            {check.message}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </div>
          ) : (
            <Panel bodyStyle={{ padding: 40 }}>
              <div style={{ textAlign: "center", color: "var(--fg-muted)" }}>
                계획안을 추가하세요.
              </div>
            </Panel>
          )}
        </main>
      </div>

      <style jsx>{`
        .page-heading,
        .selected-heading {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
        }
        .parcel-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 9px;
          margin: var(--s5) 0;
        }
        .workspace-grid {
          display: grid;
          grid-template-columns: minmax(250px, 0.7fr) minmax(0, 2.3fr);
          gap: var(--s5);
          align-items: start;
        }
        .new-plan-grid {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) minmax(240px, 1fr) auto;
          gap: 16px;
          align-items: end;
        }
        .selected-metrics,
        .economics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
          gap: 8px;
          margin-top: 12px;
        }
        .lower-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.75fr);
          gap: var(--s5);
          align-items: start;
        }
        @media (max-width: 1050px) {
          .workspace-grid,
          .lower-grid,
          .new-plan-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 650px) {
          .page-heading,
          .selected-heading {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}

const fieldLabelStyle = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 700,
  marginBottom: 6,
} as const;

const inputStyle = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  background: "var(--bg-elev)",
  color: "var(--fg)",
  fontFamily: "inherit",
  fontSize: 12,
  boxSizing: "border-box",
} as const;

const smallButtonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: "6px 9px",
  background: "var(--bg-elev)",
  color: "var(--fg-muted)",
  fontSize: 10.5,
  cursor: "pointer",
} as const;

const primaryButtonStyle = {
  border: "1px solid var(--fg)",
  borderRadius: 8,
  padding: "8px 11px",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 11.5,
  fontWeight: 700,
  cursor: "pointer",
} as const;

const confirmButtonStyle = {
  border: "1px solid var(--pos-fg)",
  borderRadius: 8,
  padding: "8px 11px",
  background: "var(--pos-soft)",
  color: "var(--pos-fg)",
  fontSize: 11.5,
  fontWeight: 750,
  cursor: "pointer",
} as const;

function ModeButton({
  active,
  disabled = false,
  onClick,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        border: active
          ? "1.5px solid var(--fg)"
          : "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px",
        background: active ? "var(--bg-sunken)" : "var(--bg-elev)",
        color: disabled ? "var(--fg-faint)" : "var(--fg)",
        fontSize: 11,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
