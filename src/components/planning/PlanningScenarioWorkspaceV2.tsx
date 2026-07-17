"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloorProgramEditor } from "@/components/planning/FloorProgramEditor";
import { MassingView } from "@/components/ui/MassingView";
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
  { label: string; background: string; color: string }
> = {
  pass: { label: "통과", background: "var(--pos-soft)", color: "var(--pos-fg)" },
  review: { label: "검토", background: "var(--warn-soft)", color: "var(--warn-fg)" },
  fail: { label: "미충족", background: "var(--neg-soft)", color: "var(--neg-fg)" },
  unknown: { label: "미확인", background: "var(--bg-sunken)", color: "var(--fg-muted)" },
};

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

function health(calculation: PlanningScenarioCalculation): { fail: number; review: number } {
  return calculation.checks.reduce(
    (result, check) => {
      if (check.status === "fail") result.fail += 1;
      if (check.status === "review" || check.status === "unknown") result.review += 1;
      return result;
    },
    { fail: 0, review: 0 }
  );
}

export function PlanningScenarioWorkspaceV2({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const envelopePlan = useProjectStore((state) => state.envelopePlan);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const addPlanningScenario = useProjectStore((state) => state.addPlanningScenario);
  const editPlanningScenarioDraft = useProjectStore(
    (state) => state.editPlanningScenarioDraft
  );
  const updatePlanningScenario = useProjectStore((state) => state.updatePlanningScenario);
  const removePlanningScenario = useProjectStore((state) => state.removePlanningScenario);
  const duplicatePlanningScenario = useProjectStore(
    (state) => state.duplicatePlanningScenario
  );
  const selectPlanningScenario = useProjectStore((state) => state.selectPlanningScenario);

  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanName, setNewPlanName] = useState("새 계획안");
  const [cloneSelected, setCloneSelected] = useState(false);
  const initializedRef = useRef(false);

  const parcel = data?.parcel;
  const projectScenarios = useMemo(
    () => planningScenarios.filter((scenario) => scenario.projectId === projectId),
    [planningScenarios, projectId]
  );

  useEffect(() => {
    if (!parcel || initializedRef.current || projectScenarios.length > 0) return;
    initializedRef.current = true;
    addPlanningScenario(
      createStarterPlanningScenario(scenarioSeed(parcel), envelopePlan, projectId)
    );
  }, [parcel, projectScenarios.length, envelopePlan, projectId, addPlanningScenario]);

  useEffect(() => {
    if (projectScenarios.length === 0) return;
    if (!projectScenarios.some((scenario) => scenario.id === selectedPlanningScenarioId)) {
      selectPlanningScenario(projectScenarios[0].id);
    }
  }, [projectScenarios, selectedPlanningScenarioId, selectPlanningScenario]);

  const assumptions = useMemo(() => {
    const legacy =
      data?.scenarios.find((scenario) => scenario.recommended)?._raw.assumptions ??
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
    if (!calculationContext) return new Map<string, PlanningScenarioCalculation>();
    return new Map(
      projectScenarios.map((scenario) => [
        scenario.id,
        calculatePlanningScenario(scenario, calculationContext),
      ])
    );
  }, [projectScenarios, calculationContext]);

  const selectedScenario =
    projectScenarios.find((scenario) => scenario.id === selectedPlanningScenarioId) ??
    projectScenarios[0] ??
    null;
  const selectedCalculation = selectedScenario
    ? calculations.get(selectedScenario.id) ?? null
    : null;

  if (!data || !parcel) return null;

  const addPlan = () => {
    const name = newPlanName.trim() || `계획안 ${projectScenarios.length + 1}`;
    if (cloneSelected && selectedScenario) {
      duplicatePlanningScenario(selectedScenario.id, name);
    } else {
      addPlanningScenario(
        createBlankScenarioForParcel(scenarioSeed(parcel), name, projectId)
      );
    }
    setNewPlanOpen(false);
    setCloneSelected(false);
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

  const deleteSelected = () => {
    if (!selectedScenario) return;
    if (window.confirm(`“${selectedScenario.name}” 계획안을 삭제할까요?`)) {
      removePlanningScenario(selectedScenario.id);
    }
  };

  return (
    <div style={{ maxWidth: 1360, margin: "0 auto", padding: "var(--s6) var(--s5) 80px" }}>
      <div className="stage-path">
        <Link href={`/projects/${projectId}/status`}>Stage 1 현황 분석</Link>
        <span>→</span>
        <strong>Stage 2</strong>
        <span>계획안 작성</span>
      </div>

      <div className="page-heading">
        <SectionTitle
          size="lg"
          title="계획 스튜디오"
          desc={`${parcel.address} · 층별 프로그램을 작성하면서 법규와 개략 사업성을 함께 검토합니다.`}
        />
        <button type="button" style={primaryButtonStyle} onClick={() => setNewPlanOpen(true)}>
          ＋ 새 안 추가
        </button>
      </div>

      <div className="parcel-overview">
        <Metric label="대지면적" value={pyeong(parcel.lotArea)} sub={`${num(parcel.lotArea, 1)}㎡`} />
        <Metric label="법정 건폐율" value={`${parcel.maxBCR}%`} />
        <Metric label="법정 용적률" value={`${parcel.maxFAR}%`} />
        <Metric label="인수가" value={won(parcel.acquiredPrice, { full: true })} />
        <Metric label="계획안" value={`${projectScenarios.length}개`} sub="프로젝트별 저장" />
      </div>

      {newPlanOpen && (
        <Panel style={{ marginBottom: "var(--s5)" }} bodyStyle={{ padding: "var(--s5)" }}>
          <div className="new-plan-row">
            <label>
              <span>계획안 이름</span>
              <input
                autoFocus
                value={newPlanName}
                onChange={(event) => setNewPlanName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && addPlan()}
                style={inputStyle}
              />
            </label>
            <label>
              <span>시작 방식</span>
              <select
                value={cloneSelected ? "clone" : "blank"}
                onChange={(event) => setCloneSelected(event.target.value === "clone")}
                style={inputStyle}
              >
                <option value="blank">빈 계획에서 시작</option>
                <option value="clone" disabled={!selectedScenario}>
                  현재 선택안 복제
                </option>
              </select>
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "end" }}>
              <button type="button" style={secondaryButtonStyle} onClick={() => setNewPlanOpen(false)}>
                취소
              </button>
              <button type="button" style={primaryButtonStyle} onClick={addPlan}>
                만들기
              </button>
            </div>
          </div>
        </Panel>
      )}

      <div className="workspace-grid">
        <aside>
          <div className="list-heading">
            <strong>계획안 목록</strong>
            <span>클릭 즉시 전환</span>
          </div>
          <div style={{ display: "grid", gap: 9 }}>
            {projectScenarios.map((scenario) => {
              const calculation = calculations.get(scenario.id);
              if (!calculation) return null;
              return (
                <PlanCard
                  key={scenario.id}
                  scenario={scenario}
                  calculation={calculation}
                  active={scenario.id === selectedScenario?.id}
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
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        aria-label="계획안 이름"
                        value={selectedScenario.name}
                        onChange={(event) =>
                          editPlanningScenarioDraft(selectedScenario.id, {
                            name: event.target.value,
                          })
                        }
                        style={{ ...titleInputStyle, maxWidth: 430 }}
                      />
                      <span className="ui-tag">{ORIGIN_LABEL[selectedScenario.origin]}</span>
                      <span className="ui-tag">v{selectedScenario.version}</span>
                      {selectedScenario.status === "draft" && (
                        <span className="ui-tag">미저장 변경</span>
                      )}
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 10.5, color: "var(--fg-faint)" }}>
                      편집은 즉시 계산되며, 저장 버튼을 누를 때만 버전이 증가합니다.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={() => duplicatePlanningScenario(selectedScenario.id)}
                    >
                      복제
                    </button>
                    <button
                      type="button"
                      style={{ ...secondaryButtonStyle, color: "var(--neg-fg)" }}
                      onClick={deleteSelected}
                    >
                      삭제
                    </button>
                    <button type="button" style={primaryButtonStyle} onClick={saveSelected}>
                      계획안 저장
                    </button>
                  </div>
                </div>

                <div className="selected-overview">
                  <div>
                    <MassingView
                      boundary={parcel.boundary}
                      zoning={parcel.zoning ?? ""}
                      floors={Math.max(1, selectedCalculation.metrics.aboveGroundFloors)}
                      units={Math.max(1, selectedCalculation.metrics.residentialUnitCount)}
                      roads={parcel.roads}
                      setback={parcel.setback}
                      height={390}
                    />
                    <p style={{ margin: "8px 0 0", fontSize: 10.5, color: "var(--fg-faint)" }}>
                      현재 3D는 층수 기반 매스입니다. 층별 외곽선·후퇴 형상은 다음 3D 업데이트에서 연결합니다.
                    </p>
                  </div>
                  <div className="selected-metrics">
                    <Metric label="지상 / 지하" value={`${selectedCalculation.metrics.aboveGroundFloors}F / B${selectedCalculation.metrics.undergroundFloors}`} />
                    <Metric label="주거 세대" value={`${selectedCalculation.metrics.residentialUnitCount}세대`} />
                    <Metric label="상가·업무" value={`${selectedCalculation.metrics.commercialUnitCount}실`} />
                    <Metric label="예비 건폐율" value={`${selectedCalculation.metrics.preliminaryBcrPct.toFixed(1)}%`} sub={`상한 ${parcel.maxBCR}%`} />
                    <Metric label="예비 용적률" value={`${selectedCalculation.metrics.preliminaryFarPct.toFixed(1)}%`} sub={`상한 ${parcel.maxFAR}%`} />
                    <Metric label="주차" value={`${selectedCalculation.metrics.providedCars}/${selectedCalculation.metrics.requiredCars}대`} sub={selectedCalculation.metrics.parkingShortfallCars > 0 ? `${selectedCalculation.metrics.parkingShortfallCars}대 부족` : "예비 기준 충족"} />
                  </div>
                </div>
              </Panel>

              <div className="editor-grid">
                <Panel title="층별 프로그램" source="편집 즉시 재계산" bodyStyle={{ padding: "var(--s4)" }}>
                  <FloorProgramEditor
                    scenario={selectedScenario}
                    onChange={(patch) =>
                      editPlanningScenarioDraft(selectedScenario.id, patch)
                    }
                  />
                </Panel>

                <div style={{ display: "grid", gap: "var(--s5)", alignContent: "start" }}>
                  <Panel title="개략 사업성" source="Stage 2 계획 비교용" bodyStyle={{ padding: "var(--s4)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <Metric label="예상 매출·가치" value={won(selectedCalculation.economicsPreview.expectedRevenueManwon, { full: true })} />
                      <Metric label="총사업비" value={won(selectedCalculation.economicsPreview.totalCostManwon, { full: true })} />
                      <Metric label="공사비" value={won(selectedCalculation.economicsPreview.constructionCostManwon, { full: true })} />
                      <Metric label="예상 이익" value={won(selectedCalculation.economicsPreview.profitManwon, { full: true, sign: true })} sub={`이익률 ${selectedCalculation.economicsPreview.profitMarginPct.toFixed(1)}%`} />
                      <Metric label="연간 NOI" value={won(selectedCalculation.economicsPreview.expectedAnnualNoiManwon, { full: true })} sub="임대 구역 기준" />
                    </div>
                    <p className="fine-print">
                      인수가·층별 공사면적·매각/임대 면적을 반영한 개략값입니다. 세금·PF·IRR·민감도는 Stage 3에서 계산합니다.
                    </p>
                  </Panel>

                  <Panel title="법규·데이터 점검" source="예비 판정" bodyStyle={{ padding: "var(--s4)" }}>
                    <div style={{ display: "grid", gap: 8 }}>
                      {selectedCalculation.checks.map((check) => (
                        <div key={check.code} className="check-row">
                          <StatusPill status={check.status} />
                          <div>
                            <strong>{check.label}</strong>
                            <p>{check.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              </div>
            </div>
          ) : (
            <Panel bodyStyle={{ padding: 40 }}>
              <div style={{ textAlign: "center", color: "var(--fg-muted)" }}>
                계획안을 추가하면 편집 화면이 표시됩니다.
              </div>
            </Panel>
          )}
        </main>
      </div>

      <style jsx>{`
        .stage-path {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: var(--s5);
          font-size: 11.5px;
          color: var(--fg-muted);
        }
        .stage-path a { color: var(--fg-muted); text-decoration: none; }
        .stage-path strong { color: var(--fg); }
        .page-heading,
        .selected-heading,
        .list-heading {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
        }
        .parcel-overview {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 9px;
          margin: var(--s5) 0;
        }
        .new-plan-row {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) minmax(220px, 1fr) auto;
          gap: 14px;
          align-items: end;
        }
        .new-plan-row label { display: grid; gap: 5px; font-size: 11px; font-weight: 700; }
        .workspace-grid {
          display: grid;
          grid-template-columns: minmax(250px, 0.72fr) minmax(0, 2fr);
          gap: var(--s5);
          align-items: start;
        }
        .list-heading { align-items: baseline; margin-bottom: 10px; }
        .list-heading strong { font-size: 14px; }
        .list-heading span { font-size: 10.5px; color: var(--fg-faint); }
        .selected-overview {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(260px, 0.8fr);
          gap: var(--s4);
          margin-top: var(--s4);
          align-items: start;
        }
        .selected-metrics {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          align-content: start;
        }
        .editor-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(330px, 0.72fr);
          gap: var(--s5);
          align-items: start;
        }
        .fine-print {
          margin: 11px 0 0;
          font-size: 10px;
          line-height: 1.5;
          color: var(--fg-faint);
        }
        .check-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 8px;
          align-items: start;
        }
        .check-row strong { font-size: 11.5px; }
        .check-row p { margin: 2px 0 0; font-size: 10.5px; line-height: 1.45; color: var(--fg-muted); }
        @media (max-width: 1040px) {
          .workspace-grid,
          .selected-overview,
          .editor-grid,
          .new-plan-row { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .page-heading,
          .selected-heading { flex-direction: column; }
          .selected-metrics { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function PlanCard({
  scenario,
  calculation,
  active,
  onSelect,
  onDuplicate,
}: {
  scenario: PlanningScenario;
  calculation: PlanningScenarioCalculation;
  active: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
}) {
  const state = health(calculation);
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
        border: active ? "1.5px solid var(--fg)" : "1px solid var(--border)",
        background: active ? "var(--bg-sunken)" : "var(--bg-elev)",
        cursor: "pointer",
        outline: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13.5 }}>{scenario.name || "이름 없는 계획안"}</strong>
            <span className="ui-tag">{ORIGIN_LABEL[scenario.origin]}</span>
            {scenario.status === "draft" && <span className="ui-tag">미저장</span>}
          </div>
          <div style={{ marginTop: 5, fontSize: 10.5, color: "var(--fg-subtle)" }}>
            {calculation.metrics.aboveGroundFloors}층 · 주거 {calculation.metrics.residentialUnitCount}세대
            {calculation.metrics.commercialUnitCount > 0
              ? ` · 상가·업무 ${calculation.metrics.commercialUnitCount}실`
              : ""}
          </div>
        </div>
        <button
          type="button"
          style={tinyButtonStyle}
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate();
          }}
        >
          복제
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 10 }}>
        <MiniMetric label="용적률" value={`${calculation.metrics.preliminaryFarPct.toFixed(1)}%`} />
        <MiniMetric label="주차" value={`${calculation.metrics.providedCars}/${calculation.metrics.requiredCars}대`} />
        <MiniMetric label="이익" value={won(calculation.economicsPreview.profitManwon, { sign: true })} />
      </div>
      <div style={{ display: "flex", gap: 5, marginTop: 9, alignItems: "center" }}>
        {state.fail > 0 ? (
          <StatusPill status="fail" label={`미충족 ${state.fail}`} />
        ) : (
          <StatusPill status="pass" label="필수항목 통과" />
        )}
        {state.review > 0 && <StatusPill status="review" label={`확인 ${state.review}`} />}
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--fg-faint)" }}>
          v{scenario.version}
        </span>
      </div>
    </article>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 9 }}>
      <div style={{ fontSize: 10, color: "var(--fg-subtle)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 17, fontWeight: 750, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 3, fontSize: 10, color: "var(--fg-faint)" }}>{sub}</div>}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "7px 8px", background: "var(--bg-sunken)", borderRadius: 7 }}>
      <div style={{ fontSize: 9, color: "var(--fg-faint)" }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 10.5, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function StatusPill({
  status,
  label,
}: {
  status: PlanningCheckStatus;
  label?: string;
}) {
  const tone = CHECK_TONE[status];
  return (
    <span
      style={{
        padding: "3px 7px",
        borderRadius: 999,
        background: tone.background,
        color: tone.color,
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {label ?? tone.label}
    </span>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  background: "var(--bg-elev)",
  color: "var(--fg)",
  fontFamily: "inherit",
  fontSize: 11.5,
} as const;

const titleInputStyle = {
  ...inputStyle,
  border: "1px solid transparent",
  padding: "4px 6px",
  fontSize: 20,
  fontWeight: 750,
  letterSpacing: "-0.03em",
} as const;

const primaryButtonStyle = {
  border: "1px solid var(--fg)",
  borderRadius: 8,
  padding: "8px 11px",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
} as const;

const secondaryButtonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  background: "var(--bg-elev)",
  color: "var(--fg-muted)",
  fontSize: 11,
  cursor: "pointer",
} as const;

const tinyButtonStyle = {
  ...secondaryButtonStyle,
  padding: "4px 7px",
  fontSize: 10,
  alignSelf: "start",
} as const;
