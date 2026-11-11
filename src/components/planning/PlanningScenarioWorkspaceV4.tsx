"use client";

import Link from "next/link";
import { constraintStatusLabel } from "@/lib/regulatory/constraints";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloorProgramEditor } from "@/components/planning/FloorProgramEditor";
import { DwellingAssumptionsEditor } from "@/components/planning/DwellingAssumptionsEditor";
import { PlanningGuidedEditor } from "@/components/planning/PlanningGuidedEditor";
import { PlanningGeometrySourcePanel } from "@/components/planning/PlanningGeometrySourcePanel";
import { PlanningParkingSequencePanel } from "@/components/planning/PlanningParkingSequencePanel";
import { PlanningMassingView } from "@/components/planning/PlanningMassingView";
import { PlanningMaterialEditor } from "@/components/planning/PlanningMaterialEditor";
import { Panel, SectionTitle } from "@/components/ui/primitives";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { hasParcelBoundary } from "@/lib/geo/parcel-topology";
import type {
  FinancialRevenueAreaPools,
  FinancialRevenuePoolKey,
  FinancialRevenueProjectionSnapshot,
  RevenuePoolPricingSnapshot,
} from "@/lib/finance/types";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { buildParkingAlternativePatch } from "@/lib/planning/parking-sequence-advisor";
import { buildPlanningParkingGeometry } from "@/lib/planning/planning-parking-geometry";
import { PlanningLayoutVerification } from "./PlanningLayoutVerification";
import { InteriorDrawingExport } from "./InteriorDrawingExport";
import { isPlanningGeometryLocked } from "@/lib/planning/geometry-source";
import { findProjectPlanningScenario } from "@/lib/planning/project-scope";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import { assessPlanningAnalysisReference } from "@/lib/planning/analysis-reference";
import { ANALYSIS_REFERENCE_NOTICE } from "@/lib/planning/analysis-reference-contract";
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

const InteriorPlanWorkspace = dynamic(() => import("./interior/InteriorPlanWorkspace"), { ssr: false });
const PlanningSolarPanel = dynamic(() => import("./interior/PlanningSolarPanel"), { ssr: false });

const ORIGIN_LABEL: Record<PlanningScenarioOrigin, string> = {
  "algorithm-safe": "안정형",
  "algorithm-balanced": "균형형",
  "algorithm-max": "최대개발형",
  custom: "직접 설계",
  legacy: "기존 입력",
};

const REVENUE_POOL_ROWS: Array<{
  key: FinancialRevenuePoolKey;
  areaKey: keyof FinancialRevenueAreaPools;
  label: string;
}> = [
  { key: "residentialSale", areaKey: "residentialSaleSqm", label: "주거 매각" },
  { key: "retailSale", areaKey: "retailSaleSqm", label: "상가 매각" },
  { key: "officeSale", areaKey: "officeSaleSqm", label: "업무 매각" },
  {
    key: "residentialLease",
    areaKey: "residentialLeaseSqm",
    label: "주거 임대",
  },
  { key: "retailLease", areaKey: "retailLeaseSqm", label: "상가 임대" },
  { key: "officeLease", areaKey: "officeLeaseSqm", label: "업무 임대" },
];

const REVENUE_ADJUSTMENT_LABELS = {
  use: "용도",
  location: "입지",
  floor: "층",
  area: "면적",
  newBuild: "신축",
} as const;

function revenueSourceStatusLabel(
  status: RevenuePoolPricingSnapshot["sourceStatus"],
): string {
  if (status === "source-backed") return "원문 근거";
  if (status === "user-input") return "사용자 입력";
  return "내부 가정";
}

function revenueAdjustmentSummary(
  pricing: RevenuePoolPricingSnapshot,
): string {
  const active = pricing.adjustments
    ? Object.entries(pricing.adjustments).filter(
        ([, adjustment]) => Math.abs(adjustment.factor - 1) > 0.000001,
      )
    : [];
  if (active.length === 0) {
    return Math.abs(pricing.adjustmentFactor - 1) > 0.000001
      ? `통합 ${((pricing.adjustmentFactor - 1) * 100).toFixed(1)}%`
      : "없음";
  }
  return active
    .map(
      ([dimension, adjustment]) =>
        `${REVENUE_ADJUSTMENT_LABELS[dimension as keyof typeof REVENUE_ADJUSTMENT_LABELS]} ${((adjustment.factor - 1) * 100).toFixed(1)}%`,
    )
    .join(" · ");
}

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
type PlanningEditorMode = "guided" | "expert";

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
          letterSpacing: 0,
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

function RevenuePoolTable({
  projection,
}: {
  projection: FinancialRevenueProjectionSnapshot;
}) {
  const activeRows = REVENUE_POOL_ROWS.filter(
    (row) => Number(projection.areas[row.areaKey] ?? 0) > 0
  );
  return (
    <div style={{ marginTop: 14, overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          minWidth: 900,
          borderCollapse: "collapse",
          fontSize: 10,
        }}
      >
        <thead>
          <tr style={{ color: "var(--fg-muted)", textAlign: "right" }}>
            <th style={{ padding: "7px 8px", textAlign: "left" }}>수익 풀</th>
            <th style={{ padding: "7px 8px" }}>면적</th>
            <th style={{ padding: "7px 8px" }}>기준단가</th>
            <th style={{ padding: "7px 8px" }}>보정</th>
            <th style={{ padding: "7px 8px" }}>적용 단가</th>
            <th style={{ padding: "7px 8px" }}>근거 상태</th>
            <th style={{ padding: "7px 8px" }}>연 NOI</th>
            <th style={{ padding: "7px 8px" }}>매출·가치</th>
          </tr>
        </thead>
        <tbody>
          {activeRows.map((row) => {
            const pricing = projection.pricing.pools[row.key];
            return (
              <tr key={row.key} style={{ borderTop: "1px solid var(--border-faint)" }}>
                <td style={{ padding: "8px", textAlign: "left", fontWeight: 700 }}>
                  {row.label}
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  {num(Number(projection.areas[row.areaKey] ?? 0), 1)}㎡
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  {Math.round(
                    pricing.baseUnitPriceWon ??
                      pricing.unitPriceWon /
                        Math.max(pricing.adjustmentFactor, 0.000001),
                  ).toLocaleString()}
                  원
                </td>
                <td
                  style={{
                    padding: "8px",
                    maxWidth: 180,
                    color: "var(--fg-muted)",
                    textAlign: "right",
                  }}
                  title={revenueAdjustmentSummary(pricing)}
                >
                  {revenueAdjustmentSummary(pricing)}
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  {Math.round(pricing.unitPriceWon).toLocaleString()}원/
                  {pricing.unit === "won-per-sqm" ? "㎡" : "㎡·월"}
                </td>
                <td
                  style={{ padding: "8px", textAlign: "right" }}
                  title={pricing.sourceName}
                >
                  {revenueSourceStatusLabel(pricing.sourceStatus)}
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  {pricing.unit === "won-per-sqm-month"
                    ? won(projection.annualNoiByPoolManwon[row.key], {
                        full: true,
                      })
                    : "-"}
                </td>
                <td style={{ padding: "8px", textAlign: "right", fontWeight: 700 }}>
                  {won(projection.valueByPoolManwon[row.key], { full: true })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ margin: "8px 0 0", color: "var(--fg-faint)", fontSize: 9.5 }}>
        임대 출구가치는 잠재 임대료에서 공실 {projection.pricing.vacancyRatePct.toFixed(1)}%와
        유효총수입 대비 운영비 {projection.pricing.operatingExpenseRatePct.toFixed(1)}%를 차감한
        NOI ÷ Cap rate × 안정화 계수 {projection.pricing.stabilizationFactorPct.toFixed(0)}%로 계산합니다.
      </p>
    </div>
  );
}

function PlanCard({
  scenario,
  calculation,
  active,
  representative,
  analysisReference = false,
  onSelect,
  onDuplicate,
}: {
  scenario: PlanningScenario;
  calculation: PlanningScenarioCalculation;
  active: boolean;
  representative: boolean;
  analysisReference?: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
}) {
  const readiness = assessRepresentativeCheckReadiness(calculation.checks);
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
            {representative && <span className="ui-tag">{analysisReference ? "예비 기준안" : "대표안"}</span>}
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
          value={calculation.economicsPreview.status === "stale" ? "원가 재검토" : won(profit, { sign: true })}
          tone={calculation.economicsPreview.status === "stale" ? "neutral" : profit >= 0 ? "positive" : "negative"}
        />
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
        {readiness.blockingFailureCount > 0 ? (
          <StatusPill
            label={`대표안 미충족 ${readiness.blockingFailureCount}`}
            tone="fail"
          />
        ) : readiness.blockingVerificationCount > 0 ? (
          <StatusPill
            label={`확정 전 핵심 검증 ${readiness.blockingVerificationCount}`}
            tone="review"
          />
        ) : (
          <StatusPill label="대표안 확정 가능" tone="pass" />
        )}
        {readiness.advisoryCount > 0 && (
          <StatusPill
            label={`참고 확인 ${readiness.advisoryCount}`}
            tone="review"
          />
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
  geometryEligible,
  analysisReference = false,
}: {
  calculation: PlanningScenarioCalculation;
  representative: boolean;
  geometryEligible: boolean;
  analysisReference?: boolean;
}) {
  const readiness = assessRepresentativeCheckReadiness(calculation.checks);
  const tone: PlanningCheckStatus =
    !geometryEligible || readiness.blockingFailureCount > 0
      ? "fail"
      : readiness.blockingVerificationCount > 0 || readiness.advisoryCount > 0
        ? "review"
        : "pass";
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
        {analysisReference ? ANALYSIS_REFERENCE_NOTICE : !geometryEligible
          ? "대표안 확정 불가 · 기하 검증 미통과"
          : readiness.blockingFailureCount > 0
            ? `대표안 확정 불가 · 미충족 ${readiness.blockingFailureCount}건`
            : readiness.blockingVerificationCount > 0
              ? `대표안 확정 전 핵심 검증 ${readiness.blockingVerificationCount}건`
              : readiness.advisoryCount > 0
                ? `대표안 확정 가능 · 참고 확인 ${readiness.advisoryCount}건`
                : "대표안 확정 가능 · 핵심 검증 통과"}
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
  const representativeGeometry = useProjectStore(state => state.representativeGeometrySnapshot);
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
  const [editorMode, setEditorMode] = useState<PlanningEditorMode>("guided");
  const initializedRef = useRef<string | null>(null);

  const parcel = data?.parcel;
  const projectScenarios = useMemo(
    () =>
      planningScenarios.filter((scenario) => scenario.projectId === projectId),
    [planningScenarios, projectId]
  );

  useEffect(() => {
    if (!parcel || parcel.id !== projectId || initializedRef.current === projectId || projectScenarios.length > 0) return;
    addPlanningScenario(
      createStarterPlanningScenario(
        scenarioSeed(parcel),
        envelopePlan,
        projectId
      )
    );
    initializedRef.current = projectId;
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
        address: parcel.address,
        zoning: parcel.zoning,
        zoningStatus:
          parcel.inputProvenance?.zoning === "vworld-land-use"
            ? ("public-observation" as const)
            : ("user-entered" as const),
        sunlightRuleAsOf: data?.meta.lastSyncedAt?.slice(0, 10),
        lotAreaSqm: parcel.lotArea,
        boundary: parcel.boundary,
        boundaryPolygons: parcel.boundaryPolygons,
        roads: parcel.roads,
        setback: parcel.setback,
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
          parcel.setback,
          base.sunlight,
          base.metrics.roofAllowanceM,
          parcel.boundaryPolygons
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
  const selectedGeometry = useMemo(() => {
    if (
      !selectedScenario ||
      !parcel ||
      !hasParcelBoundary(parcel)
    ) {
      return null;
    }
    return buildPlanningGeometry({
      projectId: selectedScenario.projectId ?? parcel.id,
      scenario: selectedScenario,
      boundary: parcel.boundary,
      boundaryPolygons: parcel.boundaryPolygons,
      lotAreaSqm: parcel.lotArea,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
      sunlight: selectedCalculation?.sunlight,
      roofAllowanceM: selectedCalculation?.metrics.roofAllowanceM,
    }).snapshot;
  }, [selectedScenario, selectedCalculation, parcel]);
  const selectedParkingGeometry = useMemo(() => {
    if (
      !selectedScenario ||
      !selectedCalculation ||
      !selectedGeometry ||
      !parcel ||
      !hasParcelBoundary(parcel)
    ) {
      return null;
    }
    return buildPlanningParkingGeometry({
      scenario: selectedScenario,
      planning: selectedGeometry,
      requiredCars: selectedCalculation.parking.requiredCars,
      boundary: parcel.boundary,
      boundaryPolygons: parcel.boundaryPolygons,
      roads: parcel.roads,
    });
  }, [selectedScenario, selectedCalculation, selectedGeometry, parcel]);
  const geometryLocked = selectedScenario
    ? isPlanningGeometryLocked(selectedScenario)
    : false;
  const analysisReadiness = useMemo(() => selectedScenario && parcel && selectedCalculation
    ? assessPlanningAnalysisReference({ scenario: selectedScenario, parcel, calculation: selectedCalculation,
      geometry: selectedGeometry, parking: selectedParkingGeometry }) : null,
  [selectedScenario, parcel, selectedCalculation, selectedGeometry, selectedParkingGeometry]);

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

  const createParkingAlternative = (
    strategy: "surface" | "piloti",
    capacityCars: number
  ) => {
    if (!selectedScenario) return;
    const copyName = `${selectedScenario.name} · ${
      strategy === "piloti" ? "필로티 대안" : "지상주차 대안"
    }`;
    const copyId = duplicatePlanningScenario(selectedScenario.id, copyName);
    if (!copyId) return;
    const copy = findProjectPlanningScenario(useProjectStore.getState().planningScenarios, copyId, projectId);
    if (!copy) return;
    const alternative = buildParkingAlternativePatch(
      copy,
      strategy,
      capacityCars
    );
    if (!alternative) {
      window.alert(
        "기준 이미지형 계획안에는 원본에 없는 주차 또는 필로티를 추가할 수 없습니다."
      );
      return;
    }
    editPlanningScenarioDraft(copyId, alternative.patch);
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
    if (!selectedGeometry?.validation.representativeEligible) {
      const failure = selectedGeometry?.validation.issues.find(
        (issue) => issue.severity === "fail"
      );
      window.alert(
        failure?.message ??
          "Geometry 검증을 통과하지 못해 대표 계획안으로 확정할 수 없습니다."
      );
      return;
    }
    const readiness = assessRepresentativeCheckReadiness(
      selectedCalculation.checks
    );
    if (!readiness.ready) {
      const firstBlocker = readiness.blockers[0];
      window.alert(
        `${
          readiness.blockingFailureCount > 0
            ? `미충족 ${readiness.blockingFailureCount}건`
            : `핵심 검증 ${readiness.blockingVerificationCount}건`
        }이 남아 대표 계획안으로 확정할 수 없습니다.\n\n${
          firstBlocker?.message ?? "법규·주차 핵심 항목을 확인하세요."
        }`
      );
      return;
    }
    if (
      readiness.advisoryCount > 0 &&
      !window.confirm(
        `대표안 확정을 막지 않는 참고 확인 항목이 ${readiness.advisoryCount}건 있습니다. 검토 책임을 확인하고 대표 계획안으로 확정할까요?`
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
    const confirmed = setRepresentativePlanningScenarioId(
      selectedScenario.id
    );
    if (confirmed) setActiveScenarioId(selectedScenario.id);
  };

  const deleteSelected = () => {
    if (!selectedScenario) return;
    if (window.confirm(`“${selectedScenario.name}” 계획안을 삭제할까요?`)) {
      removePlanningScenario(selectedScenario.id);
    }
  };

  const selectAnalysisReference = () => {
    if (!selectedScenario || !analysisReadiness?.ready) return;
    if (!window.confirm("예비 분석 기준안으로 채택할까요? 현재 계획의 면적·주차대수는 그대로 사용해 사업성을 재계산합니다. 공식 경계·허가·전문가 승인은 미확정이며, 확정 수익이나 법정 적합 판정이 아닙니다.")) return;
    if (setRepresentativePlanningScenarioId(selectedScenario.id, "preliminary-analysis")) setActiveScenarioId(selectedScenario.id);
    else window.alert(useProjectStore.getState().geometryValidationError ?? "예비 분석 기준안을 채택하지 못했습니다.");
  };

  const selectedReadiness = selectedCalculation
    ? assessRepresentativeCheckReadiness(selectedCalculation.checks)
    : null;
  const isRepresentative =
    selectedScenario?.id === representativePlanningScenarioId;
  const isAnalysisReference = isRepresentative && Boolean(representativeGeometry?.analysisReference);

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
        <Metric label="건폐율 검토값" value={`${parcel.maxBCR}%`} sub={constraintStatusLabel(parcel.regulatoryConstraints?.bcr.status ?? "unknown")} />
        <Metric label="용적률 검토값" value={`${parcel.maxFAR}%`} sub={constraintStatusLabel(parcel.regulatoryConstraints?.far.status ?? "unknown")} />
        <Metric
          label="인수가"
          value={won(parcel.acquiredPrice, { full: true })}
        />
        <Metric
          label={representativeGeometry?.analysisReference ? "예비 분석 기준안" : "대표 계획안"}
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
                  analysisReference={scenario.id === representativePlanningScenarioId && Boolean(representativeGeometry?.analysisReference)}
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
                      {isRepresentative && <span className="ui-tag">{isAnalysisReference ? "예비 기준안" : "대표안"}</span>}
                      {selectedScenario.status === "draft" && (
                        <span className="ui-tag">편집 초안</span>
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
                        opacity:
                          !selectedReadiness?.ready ||
                          !selectedGeometry?.validation.representativeEligible
                            ? 0.55
                            : 1,
                      }}
                      aria-disabled={
                        !selectedReadiness?.ready ||
                        !selectedGeometry?.validation.representativeEligible
                      }
                      title={
                        !selectedGeometry?.validation.representativeEligible
                          ? "기하 검증을 통과해야 대표안으로 확정할 수 있습니다."
                          : selectedReadiness && !selectedReadiness.ready
                            ? selectedReadiness.blockers[0]?.message
                            : "현재 계획안을 Stage 3 입력으로 확정합니다."
                      }
                      onClick={confirmRepresentative}
                    >
                      {isRepresentative && !isAnalysisReference ? "대표안 확정됨" : "대표안 확정"}
                    </button>
                    <button type="button" style={primaryButtonStyle}
                      disabled={!analysisReadiness?.ready || isAnalysisReference}
                      title={analysisReadiness?.blockers[0]?.message ?? ANALYSIS_REFERENCE_NOTICE}
                      onClick={selectAnalysisReference}>
                      {isAnalysisReference ? "예비 분석 기준안 채택됨" : "예비 분석 기준안 채택"}
                    </button>
                  </div>
                </div>

                <UnifiedStatusBanner
                  calculation={selectedCalculation}
                  representative={isRepresentative && !isAnalysisReference}
                  analysisReference={isAnalysisReference}
                  geometryEligible={
                    selectedGeometry?.validation.representativeEligible === true
                  }
                />
                {analysisReadiness && <details style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6, overflowWrap: "anywhere" }}>
                  <summary>{analysisReadiness.ready ? `예비 분석 채택 가능 · 미확정 ${analysisReadiness.unresolved.length}건` : `예비 분석 채택 보류 · 해결 필요 ${analysisReadiness.blockers.length}건`}</summary>
                  <ul>{analysisReadiness.blockers.map((item, index) => <li key={`block-${index}`}>{item.message}</li>)}</ul>
                  <ul>{analysisReadiness.unresolved.map((item, index) => <li key={`unresolved-${index}`}>{item.message}</li>)}</ul>
                </details>}

                <PlanningGeometrySourcePanel
                  scenario={selectedScenario}
                  geometry={selectedGeometry}
                  onChange={(geometrySource) =>
                    editPlanningScenarioDraft(selectedScenario.id, {
                      geometrySource,
                    })
                  }
                />

                {selectedGeometry && (
                  <PlanningParkingSequencePanel
                    scenario={selectedScenario}
                    calculation={selectedCalculation}
                    geometry={selectedGeometry}
                    boundary={parcel.boundary}
                    boundaryPolygons={parcel.boundaryPolygons}
                    roads={parcel.roads}
                    onCreateAlternative={createParkingAlternative}
                    onEditProgram={() => setEditorMode("expert")}
                  />
                )}

                <section className="editor-mode-switch" aria-label="계획 편집 방식">
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                      편집 방식
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 10.5,
                        color: "var(--fg-muted)",
                      }}
                    >
                      같은 계획 데이터를 빠른 조작 또는 정밀 숫자로 편집합니다.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <ModeButton
                      active={editorMode === "guided"}
                      onClick={() => setEditorMode("guided")}
                      label="초보자 · 빠른 계획"
                    />
                    <ModeButton
                      active={editorMode === "expert"}
                      onClick={() => setEditorMode("expert")}
                      label="전문가 · 정밀 편집"
                    />
                  </div>
                </section>

                <PlanningMassingView
                  boundary={parcel.boundary}
                  boundaryPolygons={parcel.boundaryPolygons}
                  lotAreaSqm={parcel.lotArea}
                  sunlight={selectedCalculation?.sunlight}
                  roofAllowanceM={selectedCalculation?.metrics.roofAllowanceM}
                  zoning={parcel.zoning ?? ""}
                  scenario={selectedScenario}
                  roads={parcel.roads}
                  setback={parcel.setback}
                  parkingGeometry={selectedParkingGeometry}
                  height={430}
                />

                {selectedGeometry && <>
                  <InteriorPlanWorkspace scenario={selectedScenario} planning={selectedGeometry} disabled={geometryLocked}
                    onChange={(floorPrograms) => editPlanningScenarioDraft(selectedScenario.id, { floorPrograms })} />
                  <PlanningSolarPanel planning={selectedGeometry} />
                </>}

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
                        : selectedCalculation.parking.decisionGrade
                          ? "확인 기준 충족"
                          : "예비값 · 원문/전용면적 확인 필요"
                    }
                  />
                </div>
                <PlanningLayoutVerification
                  scenario={selectedScenario}
                  geometry={selectedGeometry}
                  parking={selectedParkingGeometry}
                  calculationContext={calculationContext}
                  getCurrentScenario={() => findProjectPlanningScenario(useProjectStore.getState().planningScenarios, selectedScenario.id, projectId)}
                  onChange={patch => editPlanningScenarioDraft(selectedScenario.id, patch)}
                />
                <InteriorDrawingExport projectId={projectId} scenarioId={selectedScenario.id} />
              </Panel>

              <Panel
                title="개략 사업성"
                source="Stage 2 비교용 · Stage 3에서 정밀 계산"
                bodyStyle={{ padding: "var(--s5)" }}
              >
                {selectedCalculation.economicsPreview.status === "stale" ? <p role="alert">
                  원가 또는 전체 견적 채택의 기준이 달라 사업비·이익은 미확정입니다. 수량·원가와 견적 대사에서 현재 기준을 다시 검토해야 합니다.
                </p> : <>
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
                    label="외장재 증감"
                    value={
                      selectedCalculation.economicsPreview.materialCostStatus ===
                      "unpriced"
                        ? "미산정"
                        : won(
                            selectedCalculation.economicsPreview
                              .materialAdjustmentCostManwon ?? 0,
                            { full: true, sign: true }
                          )
                    }
                    sub={
                      selectedCalculation.economicsPreview.materialCostSource ??
                      "재료 단가 입력 필요"
                    }
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
                <RevenuePoolTable
                  projection={selectedCalculation.revenueProjection}
                />
                </>}
              </Panel>

              <Panel
                title="외장재·Plan DNA"
                source="3D 표현 · 사용자 단가 근거 · 이미지 생성 준비"
                bodyStyle={{ padding: "var(--s5)" }}
              >
                <PlanningMaterialEditor
                  scenario={selectedScenario}
                  calculation={selectedCalculation}
                  parcel={{
                    projectId,
                    address: parcel.address,
                    parcelAreaSqm: parcel.lotArea,
                    maxBuildingCoveragePct: parcel.maxBCR,
                    maxFloorAreaRatioPct: parcel.maxFAR,
                  }}
                  onChange={(materials) =>
                    editPlanningScenarioDraft(selectedScenario.id, {
                      materials,
                    })
                  }
                />
              </Panel>

              <div className="lower-grid">
                <Panel
                  title={
                    editorMode === "guided"
                      ? "빠른 층·배치 편집"
                      : "층별 프로그램 정밀 편집"
                  }
                  source={
                    editorMode === "guided"
                      ? "초보자 가이드 · 실시간 재계산"
                      : "전문가 숫자 입력 · 실시간 재계산"
                  }
                  bodyStyle={{ padding: "var(--s4)" }}
                >
                  {geometryLocked ? (
                    <div
                      role="status"
                      style={{
                        padding: "18px",
                        borderRadius: 10,
                        background: "var(--pos-soft)",
                        color: "var(--pos-fg)",
                        fontSize: 11.5,
                        lineHeight: 1.65,
                      }}
                    >
                      <strong style={{ display: "block", marginBottom: 4 }}>
                        현재 계획 형상이 Geometry Hash로 잠겨 있습니다.
                      </strong>
                      층수·층별 외곽선·배치·회전·주차·주용도 편집은
                      차단됩니다. 외장 재료는 계속 바꿀 수 있으며, 형상을
                      수정하려면 위의 ‘잠금 해제’를 먼저 선택하세요.
                    </div>
                  ) : editorMode === "guided" ? (
                    <PlanningGuidedEditor
                      scenario={selectedScenario}
                      calculation={selectedCalculation}
                      parcel={{
                        lotAreaSqm: parcel.lotArea,
                        regulatoryConstraints: parcel.regulatoryConstraints,
                      }}
                      onChange={(patch) =>
                        editPlanningScenarioDraft(selectedScenario.id, patch)
                      }
                    />
                  ) : (
                    <FloorProgramEditor
                      scenario={selectedScenario}
                      onChange={(patch) =>
                        editPlanningScenarioDraft(selectedScenario.id, patch)
                      }
                    />
                  )}
                  {!geometryLocked && <DwellingAssumptionsEditor scenario={selectedScenario} calculation={selectedCalculation}
                    onChange={(dwellingProgram) => editPlanningScenarioDraft(selectedScenario.id, { dwellingProgram })} />}
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
                          {check.source && (
                            <div
                              style={{
                                marginTop: 3,
                                fontSize: 9.5,
                                lineHeight: 1.4,
                                color: "var(--fg-faint)",
                                overflowWrap: "anywhere",
                              }}
                            >
                              근거: {check.source}
                              {check.code === "parking" &&
                                selectedCalculation.parking.rule.sources[0] && (
                                  <>
                                    {" · "}
                                    <a
                                      href={
                                        selectedCalculation.parking.rule.sources[0]
                                          .sourceUrl
                                      }
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ color: "var(--accent)" }}
                                    >
                                      원문
                                    </a>
                                  </>
                                )}
                            </div>
                          )}
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
        .editor-mode-switch {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          margin: 12px 0;
          padding: 11px 12px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--bg-sunken);
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
