"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { sortFloorPrograms } from "@/lib/planning/scenario-utils";
import type {
  FloorUseType,
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

const USE_LABEL: Record<FloorUseType, string> = {
  residential: "주거",
  retail: "상가",
  office: "업무",
  parking: "주차",
  piloti: "필로티",
  common: "공용",
  mechanical: "기계",
  storage: "창고",
  other: "기타",
};

const CHECK_TONE: Record<PlanningCheckStatus, { label: string; bg: string; fg: string }> = {
  pass: { label: "통과", bg: "var(--pos-soft)", fg: "var(--pos-fg)" },
  review: { label: "검토", bg: "var(--warn-soft)", fg: "var(--warn-fg)" },
  fail: { label: "미충족", bg: "var(--neg-soft)", fg: "var(--neg-fg)" },
  unknown: { label: "미확인", bg: "var(--bg-sunken)", fg: "var(--fg-muted)" },
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
      if (check.status === "review" || check.status === "unknown") result.review += 1;
      return result;
    },
    { fail: 0, review: 0 }
  );
}

function PlanningScenarioCard({
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
  const { metrics, economicsPreview } = calculation;
  const health = planHealth(calculation);
  const profitPositive = economicsPreview.profitManwon >= 0;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      style={{
        padding: 14,
        borderRadius: 12,
        border: active ? "1.5px solid var(--fg)" : "1px solid var(--border)",
        background: active ? "var(--bg-sunken)" : "var(--bg-elev)",
        cursor: "pointer",
        boxShadow: active ? "0 5px 18px rgba(15,23,42,0.07)" : "none",
        outline: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>
              {scenario.name}
            </strong>
            <span className="ui-tag">{ORIGIN_LABEL[scenario.origin]}</span>
          </div>
          <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--fg-subtle)" }}>
            {metrics.aboveGroundFloors}층
            {metrics.undergroundFloors > 0 ? ` · 지하 ${metrics.undergroundFloors}층` : ""}
            {` · 주거 ${metrics.residentialUnitCount}세대`}
            {metrics.commercialUnitCount > 0 ? ` · 상가·업무 ${metrics.commercialUnitCount}실` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate();
          }}
          style={smallButtonStyle}
        >
          복제
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 7,
          marginTop: 12,
        }}
      >
        <MiniMetric label="용적률" value={`${metrics.preliminaryFarPct.toFixed(1)}%`} />
        <MiniMetric label="주차" value={`${metrics.providedCars}/${metrics.requiredCars}대`} />
        <MiniMetric
          label="개략 이익"
          value={won(economicsPreview.profitManwon, { sign: true })}
          tone={profitPositive ? "positive" : "negative"}
        />
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {health.fail > 0 ? (
          <StatusPill label={`미충족 ${health.fail}`} tone="fail" />
        ) : (
          <StatusPill label="필수항목 통과" tone="pass" />
        )}
        {health.review > 0 && <StatusPill label={`확인 ${health.review}`} tone="review" />}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--fg-faint)" }}>
          v{scenario.version}
        </span>
      </div>
    </article>
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
    tone === "positive" ? "var(--pos-fg)" : tone === "negative" ? "var(--neg-fg)" : "var(--fg)";
  return (
    <div style={{ padding: "8px 9px", background: "var(--bg-sunken)", borderRadius: 8 }}>
      <div style={{ fontSize: 9.5, color: "var(--fg-faint)" }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: PlanningCheckStatus }) {
  const style = CHECK_TONE[tone];
  return (
    <span
      style={{
        padding: "3px 7px",
        borderRadius: 999,
        background: style.bg,
        color: style.fg,
        fontSize: 10.5,
        fontWeight: 650,
      }}
    >
      {label}
    </span>
  );
}

function OverviewMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: 13, border: "1px solid var(--border)", borderRadius: 10 }}>
      <div style={{ fontSize: 10.5, color: "var(--fg-subtle)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 750, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--fg-faint)" }}>{sub}</div>}
    </div>
  );
}

const smallButtonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: "5px 8px",
  background: "var(--bg-elev)",
  color: "var(--fg-muted)",
  fontSize: 11,
  cursor: "pointer",
} as const;

const primaryButtonStyle = {
  border: "1px solid var(--fg)",
  borderRadius: 9,
  padding: "9px 13px",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
} as const;

export function PlanningScenarioWorkspace({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const envelopePlan = useProjectStore((state) => state.envelopePlan);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const addPlanningScenario = useProjectStore((state) => state.addPlanningScenario);
  const updatePlanningScenario = useProjectStore((state) => state.updatePlanningScenario);
  const removePlanningScenario = useProjectStore((state) => state.removePlanningScenario);
  const duplicatePlanningScenario = useProjectStore(
    (state) => state.duplicatePlanningScenario
  );
  const selectPlanningScenario = useProjectStore((state) => state.selectPlanningScenario);

  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanName, setNewPlanName] = useState("새 계획안");
  const [newPlanMode, setNewPlanMode] = useState<NewPlanMode>("blank");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
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
    const selectedBelongsToProject = projectScenarios.some(
      (scenario) => scenario.id === selectedPlanningScenarioId
    );
    if (!selectedBelongsToProject) selectPlanningScenario(projectScenarios[0].id);
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

  useEffect(() => {
    if (!selectedScenario) return;
    setNameDraft(selectedScenario.name);
    setEditingName(false);
  }, [selectedScenario]);

  if (!data || !parcel) return null;

  const addPlan = () => {
    const name = newPlanName.trim() || `계획안 ${projectScenarios.length + 1}`;
    if (newPlanMode === "clone" && selectedScenario) {
      duplicatePlanningScenario(selectedScenario.id, name);
    } else {
      addPlanningScenario(createBlankScenarioForParcel(scenarioSeed(parcel), name, projectId));
    }
    setNewPlanOpen(false);
    setNewPlanName(`계획안 ${projectScenarios.length + 2}`);
  };

  const saveName = () => {
    if (!selectedScenario) return;
    const name = nameDraft.trim();
    if (name && name !== selectedScenario.name) {
      updatePlanningScenario(selectedScenario.id, { name });
    }
    setEditingName(false);
  };

  const deleteSelected = () => {
    if (!selectedScenario) return;
    const ok = window.confirm(`“${selectedScenario.name}” 계획안을 삭제할까요?`);
    if (ok) removePlanningScenario(selectedScenario.id);
  };

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "var(--s6) var(--s5) 80px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: "var(--s5)",
          fontSize: 11.5,
          color: "var(--fg-muted)",
        }}
      >
        <Link
          href={`/projects/${projectId}/status`}
          style={{ color: "var(--fg-muted)", textDecoration: "none" }}
        >
          Stage 1 현황 분석
        </Link>
        <span style={{ color: "var(--fg-faint)" }}>→</span>
        <span style={{ fontWeight: 700, color: "var(--fg)" }}>Stage 2</span>
        <span>계획안 작성</span>
      </div>

      <div className="scenario-page-heading">
        <SectionTitle
          size="lg"
          title="계획 스튜디오"
          desc={`${parcel.address} · ${parcel.zoning} · 계획안을 작성한 뒤 사업성을 비교합니다.`}
        />
        <button type="button" style={primaryButtonStyle} onClick={() => setNewPlanOpen(true)}>
          ＋ 새 안 추가
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 10,
          margin: "var(--s5) 0",
        }}
      >
        <OverviewMetric label="대지면적" value={pyeong(parcel.lotArea)} sub={`${num(parcel.lotArea, 1)}㎡`} />
        <OverviewMetric label="법정 건폐율" value={`${parcel.maxBCR}%`} />
        <OverviewMetric label="법정 용적률" value={`${parcel.maxFAR}%`} />
        <OverviewMetric label="인수가" value={won(parcel.acquiredPrice, { full: true })} />
        <OverviewMetric label="저장된 계획안" value={`${projectScenarios.length}개`} sub="프로젝트별 저장" />
      </div>

      {newPlanOpen && (
        <Panel style={{ marginBottom: "var(--s5)" }} bodyStyle={{ padding: "var(--s5)" }}>
          <div className="new-plan-grid">
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 7 }}>계획안 이름</div>
              <input
                autoFocus
                value={newPlanName}
                onChange={(event) => setNewPlanName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addPlan();
                }}
                style={inputStyle}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 7 }}>시작 방식</div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <ModeButton
                  active={newPlanMode === "blank"}
                  onClick={() => setNewPlanMode("blank")}
                  label="빈 계획에서 시작"
                />
                <ModeButton
                  active={newPlanMode === "clone"}
                  disabled={!selectedScenario}
                  onClick={() => setNewPlanMode("clone")}
                  label="현재 선택안 복제"
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "end" }}>
              <button type="button" style={smallButtonStyle} onClick={() => setNewPlanOpen(false)}>
                취소
              </button>
              <button type="button" style={primaryButtonStyle} onClick={addPlan}>
                계획안 만들기
              </button>
            </div>
          </div>
        </Panel>
      )}

      <div className="scenario-workspace-grid">
        <aside>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 10,
            }}
          >
            <strong style={{ fontSize: 14 }}>계획안 목록</strong>
            <span style={{ fontSize: 10.5, color: "var(--fg-faint)" }}>클릭하여 즉시 전환</span>
          </div>
          <div style={{ display: "grid", gap: 9 }}>
            {projectScenarios.map((scenario) => {
              const calculation = calculations.get(scenario.id);
              if (!calculation) return null;
              return (
                <PlanningScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  calculation={calculation}
                  active={scenario.id === selectedScenario?.id}
                  onSelect={() => selectPlanningScenario(scenario.id)}
                  onDuplicate={() => duplicatePlanningScenario(scenario.id)}
                />
              );
            })}
            {projectScenarios.length === 0 && (
              <div
                style={{
                  padding: 24,
                  border: "1px dashed var(--border)",
                  borderRadius: 12,
                  textAlign: "center",
                  color: "var(--fg-muted)",
                  fontSize: 12,
                }}
              >
                아직 계획안이 없습니다.
              </div>
            )}
          </div>
        </aside>

        <main>
          {selectedScenario && selectedCalculation ? (
            <div style={{ display: "grid", gap: "var(--s5)" }}>
              <Panel bodyStyle={{ padding: "var(--s5)" }}>
                <div className="selected-plan-heading">
                  <div>
                    <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                      {editingName ? (
                        <input
                          value={nameDraft}
                          onChange={(event) => setNameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") saveName();
                            if (event.key === "Escape") setEditingName(false);
                          }}
                          style={{ ...inputStyle, maxWidth: 340, fontSize: 18, fontWeight: 750 }}
                        />
                      ) : (
                        <h2 style={{ margin: 0, fontSize: 21, letterSpacing: "-0.03em" }}>
                          {selectedScenario.name}
                        </h2>
                      )}
                      <span className="ui-tag">{ORIGIN_LABEL[selectedScenario.origin]}</span>
                      <span className="ui-tag">v{selectedScenario.version}</span>
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--fg-subtle)" }}>
                      계획안 선택 즉시 3D·법규·사업성 요약이 갱신됩니다.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {editingName ? (
                      <>
                        <button type="button" style={smallButtonStyle} onClick={() => setEditingName(false)}>
                          취소
                        </button>
                        <button type="button" style={primaryButtonStyle} onClick={saveName}>
                          이름 저장
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" style={smallButtonStyle} onClick={() => setEditingName(true)}>
                          이름 변경
                        </button>
                        <button
                          type="button"
                          style={smallButtonStyle}
                          onClick={() => duplicatePlanningScenario(selectedScenario.id)}
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
                      </>
                    )}
                  </div>
                </div>

                <div className="selected-plan-overview">
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
                      현재 3D는 총 층수 기반 개략 매스입니다. 층별 용도·후퇴 형상 연결은 다음 단계에서 적용합니다.
                    </p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, alignContent: "start" }}>
                    <OverviewMetric label="지상 / 지하" value={`${selectedCalculation.metrics.aboveGroundFloors}F / B${selectedCalculation.metrics.undergroundFloors}`} />
                    <OverviewMetric label="주거 세대" value={`${selectedCalculation.metrics.residentialUnitCount}세대`} />
                    <OverviewMetric label="상가·업무" value={`${selectedCalculation.metrics.commercialUnitCount}실`} />
                    <OverviewMetric label="예비 건폐율" value={`${selectedCalculation.metrics.preliminaryBcrPct.toFixed(1)}%`} sub={`상한 ${parcel.maxBCR}%`} />
                    <OverviewMetric label="예비 용적률" value={`${selectedCalculation.metrics.preliminaryFarPct.toFixed(1)}%`} sub={`상한 ${parcel.maxFAR}%`} />
                    <OverviewMetric label="주차" value={`${selectedCalculation.metrics.providedCars}/${selectedCalculation.metrics.requiredCars}대`} sub={selectedCalculation.metrics.parkingShortfallCars > 0 ? `${selectedCalculation.metrics.parkingShortfallCars}대 부족` : "예비 기준 충족"} />
                  </div>
                </div>
              </Panel>

              <Panel title="개략 사업성" source="Stage 2 계획 비교용 · Stage 3에서 정밀 계산" bodyStyle={{ padding: "var(--s5)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9 }}>
                  <OverviewMetric label="예상 매출·가치" value={won(selectedCalculation.economicsPreview.expectedRevenueManwon, { full: true })} />
                  <OverviewMetric label="총사업비" value={won(selectedCalculation.economicsPreview.totalCostManwon, { full: true })} />
                  <OverviewMetric label="공사비" value={won(selectedCalculation.economicsPreview.constructionCostManwon, { full: true })} />
                  <OverviewMetric label="예상 이익" value={won(selectedCalculation.economicsPreview.profitManwon, { full: true, sign: true })} sub={`이익률 ${selectedCalculation.economicsPreview.profitMarginPct.toFixed(1)}%`} />
                  <OverviewMetric label="연간 NOI" value={won(selectedCalculation.economicsPreview.expectedAnnualNoiManwon, { full: true })} sub="임대 구역 기준" />
                </div>
                <p style={{ margin: "12px 0 0", fontSize: 10.5, color: "var(--fg-faint)", lineHeight: 1.5 }}>
                  인수가·층별 공사면적·매각/임대 면적을 반영한 개략값입니다. 세금, 상세 PF 스케줄, 공정, IRR과 민감도는 계획안 확정 후 Stage 3에서 계산합니다.
                </p>
              </Panel>

              <div className="detail-lower-grid">
                <Panel title="층별 프로그램" source="현재는 읽기 전용 요약" bodyStyle={{ padding: "var(--s4)" }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    {sortFloorPrograms(selectedScenario.floorPrograms).map((floor) => (
                      <div
                        key={floor.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "58px minmax(0, 1fr) auto",
                          gap: 10,
                          alignItems: "center",
                          padding: "10px 11px",
                          background: "var(--bg-sunken)",
                          borderRadius: 9,
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>{floor.label}</strong>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {floor.zones.map((zone) => (
                            <span key={zone.id} className="ui-tag">
                              {USE_LABEL[zone.useType]} {num(zone.areaSqm, 0)}㎡
                              {zone.unitCount > 0 ? ` · ${zone.unitCount}${zone.useType === "residential" ? "세대" : "실"}` : ""}
                            </span>
                          ))}
                        </div>
                        <span style={{ fontSize: 10.5, color: "var(--fg-faint)" }}>
                          층고 {floor.floorHeightM.toFixed(1)}m
                        </span>
                      </div>
                    ))}
                  </div>
                  <button type="button" disabled style={{ ...smallButtonStyle, width: "100%", marginTop: 10, opacity: 0.55, cursor: "not-allowed" }}>
                    층별 프로그램 편집 — 다음 단계에서 연결
                  </button>
                </Panel>

                <Panel title="법규·데이터 점검" source="예비 판정" bodyStyle={{ padding: "var(--s4)" }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    {selectedCalculation.checks.map((check) => (
                      <div key={check.code} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "start" }}>
                        <StatusPill label={CHECK_TONE[check.status].label} tone={check.status} />
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 700 }}>{check.label}</div>
                          <div style={{ marginTop: 2, fontSize: 10.5, lineHeight: 1.45, color: "var(--fg-muted)" }}>
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
                계획안을 추가하면 상세 화면이 표시됩니다.
              </div>
            </Panel>
          )}
        </main>
      </div>

      <style jsx>{`
        .scenario-page-heading {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }
        .scenario-workspace-grid {
          display: grid;
          grid-template-columns: minmax(250px, 0.72fr) minmax(0, 2fr);
          gap: var(--s5);
          align-items: start;
        }
        .new-plan-grid {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) minmax(260px, 1.2fr) auto;
          gap: 18px;
          align-items: end;
        }
        .selected-plan-heading {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          margin-bottom: var(--s4);
        }
        .selected-plan-overview {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(260px, 0.8fr);
          gap: var(--s4);
          align-items: start;
        }
        .detail-lower-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
          gap: var(--s5);
          align-items: start;
        }
        @media (max-width: 980px) {
          .scenario-workspace-grid,
          .selected-plan-overview,
          .detail-lower-grid,
          .new-plan-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 620px) {
          .scenario-page-heading,
          .selected-plan-heading {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: 9,
  padding: "9px 11px",
  background: "var(--bg-elev)",
  color: "var(--fg)",
  fontFamily: "inherit",
  fontSize: 12,
  boxSizing: "border-box",
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
        border: active ? "1.5px solid var(--fg)" : "1px solid var(--border)",
        borderRadius: 9,
        padding: "9px 11px",
        background: active ? "var(--bg-sunken)" : "var(--bg-elev)",
        color: disabled ? "var(--fg-faint)" : "var(--fg)",
        fontSize: 11.5,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
