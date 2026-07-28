"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel, SectionTitle } from "@/components/ui/primitives";
import { defaultAssumptions } from "@/lib/finance/scenario";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import {
  diffPlanningScenarios,
  type ScenarioDiffCategory,
  type ScenarioDiffImpact,
  type ScenarioDiffItem,
  type ScenarioDiffUnit,
} from "@/lib/planning/scenario-diff";
import type {
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";
import { useProjectStore } from "@/lib/stores/project-store";
import { num, won } from "@/lib/utils/format";

const CATEGORY_LABEL: Record<ScenarioDiffCategory, string> = {
  program: "층별 프로그램",
  massing: "규모·배치",
  parking: "주차",
  economics: "개략 사업성",
  risk: "법규·검토 위험",
};

const TEXT_LABEL: Record<string, string> = {
  "single-house": "단독주택",
  "multi-family": "다가구·공동주거",
  retail: "근린생활시설",
  mixed: "복합용도",
  office: "업무시설",
  none: "계획 없음",
  surface: "지상 주차",
  piloti: "필로티 주차",
  basement: "지하 주차",
  mechanical: "기계식 주차",
};

const IMPACT_STYLE: Record<ScenarioDiffImpact, { color: string; background: string }> = {
  positive: { color: "var(--pos-fg)", background: "var(--pos-soft)" },
  negative: { color: "var(--neg-fg)", background: "var(--neg-soft)" },
  review: { color: "var(--warn-fg)", background: "var(--warn-soft)" },
  neutral: { color: "var(--fg-muted)", background: "var(--bg-sunken)" },
};

function signed(value: number, digits = 0): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
}

function formatValue(value: number | string, unit: ScenarioDiffUnit): string {
  if (typeof value === "string") return TEXT_LABEL[value] ?? value;
  switch (unit) {
    case "count":
      return num(value, 0);
    case "sqm":
      return `${num(value, 1)}㎡`;
    case "pct":
      return `${value.toFixed(1)}%`;
    case "pct-point":
      return `${value.toFixed(1)}%`;
    case "manwon":
      return won(value, { full: true });
    case "meters":
      return `${value.toFixed(1)}m`;
    case "degrees":
      return `${value.toFixed(0)}°`;
    default:
      return String(value);
  }
}

function formatDelta(item: ScenarioDiffItem): string | null {
  if (item.deltaValue == null) return null;
  const value = item.deltaValue;
  switch (item.unit) {
    case "count":
      return signed(value, 0);
    case "sqm":
      return `${signed(value, 1)}㎡`;
    case "pct":
    case "pct-point":
      return `${signed(value, 1)}%p`;
    case "manwon":
      return won(value, { full: true, sign: true });
    case "meters":
      return `${signed(value, 1)}m`;
    case "degrees":
      return `${signed(value, 0)}°`;
    default:
      return null;
  }
}

function DiffMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: ScenarioDiffImpact;
}) {
  const style = IMPACT_STYLE[tone];
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "11px 12px",
        background: "var(--bg-elev)",
      }}
    >
      <div style={{ fontSize: 10.5, color: "var(--fg-subtle)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 16, fontWeight: 750, color: style.color }}>
        {value}
      </div>
    </div>
  );
}

function ChangeRow({ item }: { item: ScenarioDiffItem }) {
  const impact = IMPACT_STYLE[item.impact];
  const delta = formatDelta(item);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(130px, 0.8fr) minmax(0, 1.8fr) auto",
        gap: 10,
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px dashed var(--border-faint, var(--border))",
      }}
    >
      <div style={{ fontSize: 11.5, fontWeight: 700 }}>{item.label}</div>
      <div style={{ minWidth: 0, fontSize: 10.5, color: "var(--fg-muted)", lineHeight: 1.45 }}>
        <span>{formatValue(item.beforeValue, item.unit)}</span>
        <span style={{ margin: "0 7px", color: "var(--fg-faint)" }}>→</span>
        <span style={{ color: "var(--fg)", fontWeight: 650 }}>
          {formatValue(item.afterValue, item.unit)}
        </span>
        {item.detail && (
          <div style={{ marginTop: 2, color: "var(--fg-faint)" }}>{item.detail}</div>
        )}
      </div>
      {delta ? (
        <span
          style={{
            padding: "4px 7px",
            borderRadius: 999,
            background: impact.background,
            color: impact.color,
            fontSize: 10.5,
            fontWeight: 750,
            whiteSpace: "nowrap",
          }}
        >
          {delta}
        </span>
      ) : (
        <span
          style={{
            padding: "4px 7px",
            borderRadius: 999,
            background: impact.background,
            color: impact.color,
            fontSize: 10,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          구성 변경
        </span>
      )}
    </div>
  );
}

export function ScenarioChangeWorkspace({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const [baseScenarioId, setBaseScenarioId] = useState("");

  const projectScenarios = useMemo(
    () => planningScenarios.filter((scenario) => scenario.projectId === projectId),
    [planningScenarios, projectId]
  );
  const selectedScenario =
    projectScenarios.find((scenario) => scenario.id === selectedPlanningScenarioId) ??
    projectScenarios[0] ??
    null;
  const comparisonCandidates = useMemo(
    () => projectScenarios.filter((scenario) => scenario.id !== selectedScenario?.id),
    [projectScenarios, selectedScenario?.id]
  );
  const preferredBaseScenarioId = useMemo(() => {
    if (!selectedScenario) return "";
    if (
      selectedScenario.baseScenarioId &&
      comparisonCandidates.some(
        (scenario) => scenario.id === selectedScenario.baseScenarioId
      )
    ) {
      return selectedScenario.baseScenarioId;
    }
    return comparisonCandidates[0]?.id ?? "";
  }, [selectedScenario, comparisonCandidates]);

  useEffect(() => {
    setBaseScenarioId(preferredBaseScenarioId);
  }, [selectedScenario?.id, preferredBaseScenarioId]);

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
    const parcel = data?.parcel;
    if (!parcel) return null;
    return {
      parcel: {
        lotAreaSqm: parcel.lotArea,
        maxFARPct: parcel.maxFAR,
        maxBCRPct: parcel.maxBCR,
        heightLimitM: parcel.heightLimit ?? 0,
        regulatoryConstraints: parcel.regulatoryConstraints,
        roofAllowanceM: 1.4,
        acquisitionCostManwon: parcel.acquiredPrice,
        demolitionCostManwon: parcel.demolitionCost ?? 0,
      },
      assumptions,
      calculatedAt: data?.meta.lastSyncedAt,
    };
  }, [data, assumptions]);

  const calculations = useMemo(() => {
    if (!calculationContext) return new Map<string, PlanningScenarioCalculation>();
    return new Map(
      projectScenarios.map((scenario) => [
        scenario.id,
        calculatePlanningScenario(scenario, calculationContext),
      ])
    );
  }, [projectScenarios, calculationContext]);

  const baseScenario =
    comparisonCandidates.find((scenario) => scenario.id === baseScenarioId) ?? null;
  const selectedCalculation = selectedScenario
    ? calculations.get(selectedScenario.id) ?? null
    : null;
  const baseCalculation = baseScenario
    ? calculations.get(baseScenario.id) ?? null
    : null;
  const comparison = useMemo(() => {
    if (!selectedScenario || !baseScenario || !selectedCalculation || !baseCalculation) {
      return null;
    }
    return diffPlanningScenarios(
      baseScenario,
      selectedScenario,
      baseCalculation,
      selectedCalculation
    );
  }, [selectedScenario, baseScenario, selectedCalculation, baseCalculation]);

  if (!data || !selectedScenario) return null;

  return (
    <div
      style={{
        maxWidth: 1380,
        margin: "-52px auto 80px",
        padding: "0 var(--s5)",
      }}
    >
      <Panel bodyStyle={{ padding: "var(--s5)" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <SectionTitle
            badge="CHANGE"
            title="변경정보 목록"
            desc="선택한 계획안이 기준안에서 어떻게 달라졌고, 사업성과 법규 위험이 어떻게 변했는지 확인합니다."
            style={{ marginBottom: 0 }}
          />
          {comparisonCandidates.length > 0 && (
            <label style={{ minWidth: 230 }}>
              <span
                style={{
                  display: "block",
                  marginBottom: 5,
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "var(--fg-muted)",
                }}
              >
                비교 기준안
              </span>
              <select
                value={baseScenario?.id ?? ""}
                onChange={(event) => setBaseScenarioId(event.target.value)}
                style={{
                  width: "100%",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  background: "var(--bg-elev)",
                  color: "var(--fg)",
                  fontFamily: "inherit",
                  fontSize: 11.5,
                }}
              >
                {comparisonCandidates.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name} · v{scenario.version}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {comparisonCandidates.length === 0 ? (
          <div
            style={{
              marginTop: 18,
              padding: 24,
              border: "1px dashed var(--border)",
              borderRadius: 10,
              color: "var(--fg-muted)",
              textAlign: "center",
              fontSize: 12,
            }}
          >
            계획안을 하나 더 만들거나 현재 안을 복제하면 변경정보 비교가 표시됩니다.
          </div>
        ) : comparison && baseScenario ? (
          <>
            <div
              style={{
                marginTop: 18,
                padding: "10px 12px",
                borderRadius: 9,
                background: "var(--bg-sunken)",
                fontSize: 11,
                color: "var(--fg-muted)",
              }}
            >
              <strong style={{ color: "var(--fg)" }}>{baseScenario.name}</strong>
              <span style={{ margin: "0 7px" }}>→</span>
              <strong style={{ color: "var(--fg)" }}>{selectedScenario.name}</strong>
              <span style={{ marginLeft: 8, color: "var(--fg-faint)" }}>
                총 {comparison.items.length}개 변경
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
                gap: 8,
                marginTop: 12,
              }}
            >
              <DiffMetric
                label="주거 세대 변화"
                value={`${signed(comparison.summary.residentialUnitDelta, 0)}세대`}
              />
              <DiffMetric
                label="용적률 변화"
                value={`${signed(comparison.summary.farPctPointDelta, 1)}%p`}
              />
              <DiffMetric
                label="주차 부족 변화"
                value={`${signed(comparison.summary.parkingShortfallDelta, 0)}대`}
                tone={comparison.summary.parkingShortfallDelta > 0 ? "negative" : comparison.summary.parkingShortfallDelta < 0 ? "positive" : "neutral"}
              />
              <DiffMetric
                label="총사업비 변화"
                value={won(comparison.summary.totalCostDeltaManwon, { full: true, sign: true })}
                tone={comparison.summary.totalCostDeltaManwon > 0 ? "negative" : comparison.summary.totalCostDeltaManwon < 0 ? "positive" : "neutral"}
              />
              <DiffMetric
                label="예상 이익 변화"
                value={won(comparison.summary.profitDeltaManwon, { full: true, sign: true })}
                tone={comparison.summary.profitDeltaManwon > 0 ? "positive" : comparison.summary.profitDeltaManwon < 0 ? "negative" : "neutral"}
              />
              <DiffMetric
                label="미충족 변화"
                value={`${signed(comparison.summary.failCheckDelta, 0)}건`}
                tone={comparison.summary.failCheckDelta > 0 ? "negative" : comparison.summary.failCheckDelta < 0 ? "positive" : "neutral"}
              />
            </div>

            {comparison.items.length === 0 ? (
              <div
                style={{
                  marginTop: 16,
                  padding: 20,
                  border: "1px dashed var(--border)",
                  borderRadius: 10,
                  textAlign: "center",
                  color: "var(--fg-muted)",
                  fontSize: 12,
                }}
              >
                두 계획안의 프로그램·배치·주차·사업성 계산 결과가 같습니다.
              </div>
            ) : (
              <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
                {(Object.keys(CATEGORY_LABEL) as ScenarioDiffCategory[]).map(
                  (category) => {
                    const categoryItems = comparison.items.filter(
                      (item) => item.category === category
                    );
                    if (categoryItems.length === 0) return null;
                    return (
                      <section key={category}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            marginBottom: 2,
                          }}
                        >
                          <strong style={{ fontSize: 12.5 }}>
                            {CATEGORY_LABEL[category]}
                          </strong>
                          <span className="ui-tag">{categoryItems.length}</span>
                        </div>
                        <div>
                          {categoryItems.map((item) => (
                            <ChangeRow key={item.code} item={item} />
                          ))}
                        </div>
                      </section>
                    );
                  }
                )}
              </div>
            )}
          </>
        ) : null}
      </Panel>

      <style jsx>{`
        @media (max-width: 680px) {
          :global(.scenario-change-row) {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
