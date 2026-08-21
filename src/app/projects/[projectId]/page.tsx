"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  calculateScenario,
  ASSUMPTION_META,
} from "@/lib/finance/scenario";
import { generatePFSchedule } from "@/lib/finance/cashflow";
import { calculateTaxes, TAX_MODEL_AS_OF } from "@/lib/finance/tax";
import { PROJECT_LEDGER_MODEL_VERSION } from "@/lib/finance/project-ledger";
import {
  buildFinancialReconciliationAudit,
  type FinancialReconciliationAudit,
} from "@/lib/finance/reconciliation-audit";
import { findMaxAcquisitionForScenario } from "@/lib/finance/max-acquisition";
import {
  acquisitionPricePerPyeong,
  acquisitionPriceTotal,
  assessAcquisitionPrice,
  type AcquisitionPriceMode,
} from "@/lib/finance/acquisition-price";
import {
  findDealRescuePaths,
  type DealRescueChange,
  type DealRescueResult,
} from "@/lib/finance/deal-rescue";
import {
  buildDealStressTest,
  type DealStressResult,
  type DealStressThreshold,
} from "@/lib/finance/deal-stress-test";
import {
  applyFinancialSources,
  buildSourceDataGate,
  FINANCIAL_SOURCE_FIELD_META,
  FINANCIAL_SOURCE_GUIDANCE,
  sourceKindRequiresDocument,
  validateFinancialSource,
  validateFinancialSourceEvidence,
  type FinancialSourceField,
  type FinancialSourceKind,
  type FinancialSourceMap,
  type FinancialSourceRecord,
  type SourceDataGateResult,
} from "@/lib/finance/source-data-gate";
import {
  SOURCE_DOCUMENT_ACCEPT,
  type SourceDocumentMetadata,
} from "@/lib/finance/source-document";
import type { AssumptionSet } from "@/lib/finance/types";
import {
  ASSUMPTION_VALUE_RULES,
  validateAssumptionValue,
} from "@/lib/finance/assumption-validation";
import { toCashflowVM, type ScenarioVM } from "@/lib/adapters/view-model";
import { resolveStage3DashboardContext } from "@/lib/stage3/dashboard-model";
import { commitStage3FeasibilitySnapshot } from "@/lib/services/commit-stage3-feasibility";
import {
  buildStage3Sensitivity,
  findStage3BreakEvenRevenuePrice,
  type Stage3Sensitivity,
} from "@/lib/stage3/feasibility-analysis";
import { useProjectStore } from "@/lib/stores/project-store";
import { won } from "@/lib/utils/format";

const SQM_PER_PYEONG = 3.305785;
const EMPTY_FINANCIAL_SOURCES: FinancialSourceMap = {};

type Tone = "positive" | "review" | "negative" | "neutral";

interface AssumptionField {
  field: keyof AssumptionSet;
  label: string;
  divisor: number;
  suffix: string;
  step: number;
  decimals?: number;
}

const ASSUMPTION_GROUPS: Array<{
  title: string;
  fields: AssumptionField[];
}> = [
  {
    title: "매출 가격",
    fields: [
      { field: "salePricePerSqM", label: "매각·분양 단가", divisor: 10_000, suffix: "만원/㎡", step: 10 },
      { field: "rentPerSqMMonth", label: "월 임대료", divisor: 10_000, suffix: "만원/㎡·월", step: 0.1, decimals: 1 },
      { field: "vacancyRate", label: "공실률", divisor: 1, suffix: "%", step: 0.5, decimals: 1 },
      { field: "capRate", label: "Exit cap rate", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
    ],
  },
  {
    title: "원가",
    fields: [
      { field: "constCostPerSqM", label: "직접 공사비", divisor: 10_000, suffix: "만원/㎡", step: 10 },
      { field: "basementCostMultiplier", label: "지하 공사비 가중치", divisor: 1, suffix: "배", step: 0.05, decimals: 2 },
      { field: "softCostRate", label: "설계·감리·인허가", divisor: 1, suffix: "%", step: 0.5, decimals: 1 },
      { field: "contingencyRate", label: "예비비", divisor: 1, suffix: "%", step: 0.5, decimals: 1 },
    ],
  },
  {
    title: "금융·목표",
    fields: [
      { field: "ltcTarget", label: "PF 적격 공사비 조달비율", divisor: 1, suffix: "%", step: 1 },
      { field: "interestRate", label: "PF 금리", divisor: 1, suffix: "%", step: 0.1, decimals: 2 },
      { field: "equityIRR", label: "요구 IRR", divisor: 1, suffix: "%", step: 0.5, decimals: 1 },
    ],
  },
  {
    title: "사업 기간",
    fields: [
      { field: "designMonths", label: "설계·인허가", divisor: 1, suffix: "개월", step: 1 },
      { field: "constructionMonths", label: "공사", divisor: 1, suffix: "개월", step: 1 },
      { field: "saleOutMonths", label: "분양·매각", divisor: 1, suffix: "개월", step: 1 },
      { field: "salesPaceMonthlyPct", label: "월 분양 속도", divisor: 1, suffix: "%/월", step: 0.5, decimals: 1 },
      { field: "leaseUpMonths", label: "임대 안정화", divisor: 1, suffix: "개월", step: 1 },
    ],
  },
];

export default function DashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const data = useProjectStore((state) => state.data);
  const saveStage3FeasibilitySnapshot = useProjectStore(
    (state) => state.saveStage3FeasibilitySnapshot
  );
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const representativeScenarioId = useProjectStore((state) => state.representativePlanningScenarioId);
  const representativeGeometry = useProjectStore((state) => state.representativeGeometrySnapshot);
  const geometryValidationError = useProjectStore((state) => state.geometryValidationError);
  const draftAssumptions = useProjectStore((state) => state.draftAssumptions);
  const setDraftAssumption = useProjectStore((state) => state.setDraftAssumption);
  const resetDraftAssumptions = useProjectStore((state) => state.resetDraftAssumptions);
  const draftAcquisitionPrices = useProjectStore((state) => state.draftAcquisitionPrices);
  const setDraftAcquisitionPrice = useProjectStore((state) => state.setDraftAcquisitionPrice);
  const resetDraftAcquisitionPrice = useProjectStore((state) => state.resetDraftAcquisitionPrice);
  const financialSources = useProjectStore((state) => state.financialSources);
  const setFinancialSource = useProjectStore((state) => state.setFinancialSource);
  const removeFinancialSource = useProjectStore((state) => state.removeFinancialSource);
  const [rescueRun, setRescueRun] = useState<{
    key: string;
    result: DealRescueResult;
  } | null>(null);
  const [rescueRunning, setRescueRunning] = useState(false);
  const [stressRun, setStressRun] = useState<{
    key: string;
    result: DealStressResult;
  } | null>(null);
  const [stressRunning, setStressRunning] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const projectPlanningScenarios = useMemo(
    () => planningScenarios.filter(
      (scenario) => scenario.projectId === projectId || scenario.id === representativeScenarioId
    ),
    [planningScenarios, projectId, representativeScenarioId]
  );

  const context = useMemo(
    () => resolveStage3DashboardContext({
      projectId,
      representativeScenarioId,
      representativeGeometrySnapshot: representativeGeometry,
      planningScenarios: projectPlanningScenarios,
      financeScenarios: data?.scenarios ?? [],
    }),
    [data?.scenarios, projectId, projectPlanningScenarios, representativeGeometry, representativeScenarioId]
  );

  const activeScenarioId = context.ready ? context.financeScenario.id : representativeScenarioId;
  const draft = activeScenarioId ? draftAssumptions[activeScenarioId] : undefined;
  const draftAcquisitionPrice = draftAcquisitionPrices[projectId];
  const projectFinancialSources =
    financialSources[projectId] ?? EMPTY_FINANCIAL_SOURCES;

  const calculation = useMemo(() => {
    if (!context.ready || !data?.parcel) return null;
    const draftScenario = {
      ...context.financeScenario._raw,
      assumptions: {
      ...context.financeScenario._raw.assumptions,
      ...(draft ?? {}),
      } as AssumptionSet,
    };
    const draftParcel = {
      ...data.parcel,
      acquiredPrice: draftAcquisitionPrice ?? data.parcel.acquiredPrice,
    };
    const sourced = applyFinancialSources(
      draftParcel,
      draftScenario,
      projectFinancialSources
    );
    const parcel = sourced.parcel;
    const scenario = sourced.scenario;
    const assumptions = scenario.assumptions;
    const acquisitionPrice = parcel.acquiredPrice;
    const sourceGate = buildSourceDataGate(scenario, projectFinancialSources);
    const result = calculateScenario({ parcel, scenario });
    const reconciliation = buildFinancialReconciliationAudit({
      result,
      scenario,
    });
    const taxes = calculateTaxes({
      parcel,
      result,
      residentialSaleShare: scenario.program.mix.residentialSale,
    });
    const cashflow = toCashflowVM(generatePFSchedule({
      parcel,
      scenario,
      result,
      startDate: parcel.acquired,
    }));
    const maxAcquisition = findMaxAcquisitionForScenario(
      parcel,
      scenario,
      [assumptions.equityIRR]
    ).results[0];
    const sensitivity = buildStage3Sensitivity(parcel, scenario);
    const breakEven = findStage3BreakEvenRevenuePrice(parcel, scenario);
    return {
      assumptions,
      acquisitionPrice,
      parcel,
      scenario,
      result,
      taxes,
      cashflow,
      maxAcquisition,
      sensitivity,
      breakEven,
      sourceGate,
      reconciliation,
    };
  }, [context, data?.parcel, draft, draftAcquisitionPrice, projectFinancialSources]);

  if (!data) return null;
  if (!context.ready || !calculation) {
    const blocked = context.ready
      ? { title: "사업성 계산이 준비되지 않았습니다", message: "대표 계획안 계산을 다시 실행하세요.", code: "missing-finance-scenario" }
      : context;
    return (
      <Stage3Blocked
        title={blocked.title}
        message={
          geometryValidationError && blocked.code !== "missing-finance-scenario"
            ? geometryValidationError
            : blocked.message
        }
        projectId={projectId}
      />
    );
  }

  const { planningScenario, geometry, financeScenario } = context;
  const {
    assumptions,
    acquisitionPrice,
    scenario,
    result,
    taxes,
    cashflow,
    maxAcquisition,
    sensitivity,
    breakEven,
    sourceGate,
    reconciliation,
  } = calculation;
  const hasSaleRevenue = scenario.program.mix.residentialSale > 0;
  const hasLeaseRevenue =
    scenario.program.mix.residentialLease > 0 || scenario.program.mix.retail > 0;
  const usesPresalePace =
    hasSaleRevenue &&
    scenario.program.type !== "single-house" &&
    scenario.program.type !== "multi-family";
  const saleSourceFields: FinancialSourceField[] = usesPresalePace
    ? ["salePricePerSqM", "salesPaceMonthlyPct"]
    : ["salePricePerSqM"];
  const leaseSourceFields: FinancialSourceField[] = [
    "rentPerSqMMonth",
    "vacancyRate",
    "capRate",
    "leaseUpMonths",
  ];
  const hasBasementCost =
    (scenario.program.areaContract?.basementAreaSqm ?? 0) > 0 ||
    scenario.program.floorsBelow > 0;
  const activeAssumptionGroups = ASSUMPTION_GROUPS.map((group) => ({
    ...group,
    fields: group.fields.filter(({ field }) => {
      if (field === "basementCostMultiplier") return hasBasementCost;
      if (field === "salePricePerSqM") return hasSaleRevenue;
      if (field === "salesPaceMonthlyPct") return usesPresalePace;
      if (
        field === "rentPerSqMMonth" ||
        field === "vacancyRate" ||
        field === "capRate" ||
        field === "leaseUpMonths"
      ) {
        return hasLeaseRevenue;
      }
      return true;
    }),
  })).filter((group) => group.fields.length > 0);
  const acquisitionEdited =
    projectFinancialSources.acquisitionPrice != null ||
    (draftAcquisitionPrice != null &&
      draftAcquisitionPrice !== data.parcel.acquiredPrice);
  const editedCount = Object.keys(draft ?? {}).length + (acquisitionEdited ? 1 : 0);
  const marketEstimate = data.parcel.acquisitionEstimate?.estimatedPriceManwon
    ?? (data.parcel.estMarketPrice
      ? Math.round((data.parcel.estMarketPrice * data.parcel.lotArea) / 10_000)
      : Math.round((data.parcel.landPrice * data.parcel.lotArea) / 10_000));
  const marketMedianTotal = data.parcel.acquisitionEstimate?.marketMedianManwon ?? 0;
  const houseProxy = data.parcel.acquisitionEstimate?.houseProxy;
  const acquisitionPerPyeong = acquisitionPricePerPyeong(
    acquisitionPrice,
    data.parcel.lotArea
  );
  const publicValueTotal = Math.round((data.parcel.landPrice * data.parcel.lotArea) / 10_000);
  const bidGap = maxAcquisition.maxLandCost - acquisitionPrice;
  const dscrApplicable = result.revenueLease + result.revenueRetail > 0;
  const profitTone: Tone = result.profit > 0 ? "positive" : result.profit < 0 ? "negative" : "review";
  const irrAvailable = result.irrStatus === "calculated";
  const irrTone: Tone = !irrAvailable
    ? "review"
    : result.irr >= assumptions.equityIRR
      ? "positive"
      : "negative";
  const marketConfidence = data.parcel.acquisitionEstimate?.confidence ?? "low";
  const saleConfidence = data.saleEstimate?.confidence ?? "low";
  const aboveFloors = geometry.building.aboveGroundFloors.length;
  const basementFloors = geometry.building.basementFloors.length;
  const currentSourceValues = {
    acquisitionPrice,
    ...assumptions,
  } as Record<FinancialSourceField, number>;
  const pendingSourceFields = Array.from(
    new Set([
      ...sourceGate.missingFields,
      ...sourceGate.invalidFields.map((item) => item.field),
    ])
  );
  const pendingSourceLabels = pendingSourceFields
    .slice(0, 4)
    .map((field) => FINANCIAL_SOURCE_FIELD_META[field].label)
    .join(" · ");
  const rescueKey = JSON.stringify({
    projectId,
    geometryHash: geometry.geometryHash,
    scenarioId: scenario.id,
    acquisitionPrice,
    assumptions,
  });
  const visibleRescue =
    rescueRun?.key === rescueKey ? rescueRun.result : null;
  const visibleStress =
    stressRun?.key === rescueKey ? stressRun.result : null;

  const resetAll = () => {
    resetDraftAssumptions(financeScenario.id);
    resetDraftAcquisitionPrice(projectId);
  };

  const commitCurrentSnapshot = () => {
    const nextData = commitStage3FeasibilitySnapshot(
      data,
      calculation.parcel,
      scenario
    );
    const savedAtIso = new Date().toISOString();
    saveStage3FeasibilitySnapshot({
      projectId,
      representativeScenarioId: planningScenario.id,
      representativeScenarioVersion: planningScenario.version,
      geometryHash: geometry.geometryHash,
      savedAt: savedAtIso,
      data: nextData,
    });
    setSavedAt(
      new Date(savedAtIso).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  };

  const openHandoff = () => {
    commitCurrentSnapshot();
    router.push(`/projects/${projectId}/handoff`);
  };

  const runDealRescue = () => {
    setRescueRunning(true);
    window.setTimeout(() => {
      const rescue = findDealRescuePaths(calculation.parcel, scenario);
      setRescueRun({ key: rescueKey, result: rescue });
      setRescueRunning(false);
    }, 0);
  };

  const runDealStress = () => {
    setStressRunning(true);
    window.setTimeout(() => {
      const stress = buildDealStressTest(calculation.parcel, scenario);
      setStressRun({ key: rescueKey, result: stress });
      setStressRunning(false);
    }, 0);
  };

  return (
    <div className="stage3-page">
      <header className="stage3-header">
        <div>
          <div className="eyebrow">STAGE 3 · FEASIBILITY</div>
          <h1>대표 계획안의 가격과 사업성을 검토합니다</h1>
          <p>Stage 2 대표 매스에 관측자료와 검토 가정을 연결한 예비 사업성 모델입니다. 금융기관 약정·시공사 견적·세무 검토 전에는 투자 확정값으로 사용할 수 없습니다.</p>
        </div>
        <div className="header-actions">
          <StatusBadge tone={geometry.validation.status === "pass" ? "positive" : "review"}>
            Geometry {geometry.validation.status === "pass" ? "확인" : "검토"}
          </StatusBadge>
          <button className="secondary-button" onClick={() => router.push(`/projects/${projectId}/envelope`)}>계획 스튜디오</button>
        </div>
      </header>

      <section className="audit-banner" role="status" style={sourceGate.status === "source-backed" ? { borderColor: "var(--pos-fg)", background: "var(--pos-soft)", color: "var(--pos-fg)" } : undefined}>
        <div className="audit-copy">
          <strong>{sourceGate.status === "source-backed" ? "소스 데이터 게이트 통과" : "소스 데이터 미완료 · 확정 판단 차단"}</strong>
          <span>
            {sourceGate.status === "source-backed"
              ? `필수 입력 ${sourceGate.validRecords.length}건이 원문·발급기관·기준일·확인자와 함께 등록되어 계산에 반영됐습니다.`
              : `필수 입력 ${sourceGate.requiredFields.length}건 중 ${sourceGate.validRecords.length}건 검증 · 다음 필요: ${pendingSourceLabels || "등록값 원문 확인"}${pendingSourceFields.length > 4 ? ` 외 ${pendingSourceFields.length - 4}건` : ""}`}
          </span>
        </div>
        {sourceGate.status !== "source-backed" && (
          <a className="audit-link" href="#source-data-room">근거자료 입력</a>
        )}
      </section>

      <section className="source-lock">
        <div className="source-main">
          <span className="section-kicker">LOCKED REPRESENTATIVE</span>
          <strong>{planningScenario.name}</strong>
          <span>v{planningScenario.version} · 지상 {aboveFloors}층{basementFloors ? ` / 지하 ${basementFloors}층` : ""} · 프로그램 {geometry.building.totalProgramAreaSqm.toFixed(1)}㎡</span>
        </div>
        <Fact label="실현 용적률" value={`${geometry.building.preliminaryFarPct.toFixed(1)}%`} />
        <Fact label="Geometry hash" value={geometry.geometryHash} mono />
        <Fact label="금융 원장" value={`${PROJECT_LEDGER_MODEL_VERSION} · ${data.meta.version}`} mono />
      </section>

      <section className="decision-grid">
        <DecisionSignal
          label="사업 손익"
          title={result.profit > 0 ? "현재 가정상 흑자" : "현재 가정상 손실"}
          value={won(result.profit)}
          tone={profitTone}
          note={`세전 매출 대비 ${result.profitMargin.toFixed(1)}% · 미산정 세금 있음`}
        />
        <DecisionSignal
          label="요구수익률"
          title={
            !irrAvailable
              ? result.irrStatus === "ambiguous"
                ? "IRR 복수해 가능"
                : "IRR 산정 불가"
              : result.irr >= assumptions.equityIRR
                ? "현재 가정상 목표 충족"
                : "현재 가정상 목표 미달"
          }
          value={irrAvailable ? `IRR ${result.irr.toFixed(1)}%` : "IRR N/A"}
          tone={irrTone}
          note={
            irrAvailable
              ? `요구 IRR ${assumptions.equityIRR.toFixed(1)}% · NPV ${won(result.npv)}`
              : `IRR 대신 NPV ${won(result.npv)} 확인 · 현금흐름 부호 패턴 검토 필요`
          }
        />
        <DecisionSignal
          label="부동산 취득대금 여력"
          title={bidGap >= 0 ? "예비 모델 범위 이내" : "예비 모델 범위 초과"}
          value={bidGap >= 0 ? `여유 ${won(bidGap)}` : `초과 ${won(Math.abs(bidGap))}`}
          tone={bidGap >= 0 ? "positive" : "negative"}
          note={`현재 가정·세전 IRR 기준 역산 ${won(maxAcquisition.maxLandCost)}`}
        />
        <DecisionSignal
          label="부채 지표"
          title={dscrApplicable ? (result.dscr >= 1.3 ? "예비 안정권" : "조건 검토") : "분양형 N/A"}
          value={dscrApplicable ? `DSCR ${result.dscr.toFixed(2)}` : "임대 NOI 없음"}
          tone={dscrApplicable ? (result.dscr >= 1.3 ? "positive" : "review") : "neutral"}
          note={dscrApplicable ? "안정화 NOI ÷ 연간 PF 이자" : "임의의 DSCR 값을 투자판단에 사용하지 않습니다"}
        />
      </section>

      <section className="dashboard-section land-section" id="land-price">
        <SectionHeader
          eyebrow="LAND PRICE LADDER"
          title="토지 가격의 원본·입력·알고리즘 결과를 분리합니다"
          description="시장 참고 추정가는 실거래·공시지가에 자체 보정 규칙을 적용한 값입니다. 감정평가액이 아니며, 예비 취득대금 한도는 현재 세전 금융모델을 역산한 값입니다."
        />
        <div className="price-ladder">
          <PricePoint label="공시지가 총액" value={publicValueTotal} note="공시지가 × 필지면적" />
          {marketMedianTotal > 0 && (
            <PricePoint
              label="토지 실거래 중앙값"
              value={marketMedianTotal}
              note={`${Math.round(data.parcel.acquisitionEstimate?.marketMedianPerPyeong ?? 0).toLocaleString()}만원/평 · 토지 분포 참고`}
            />
          )}
          <PricePoint
            label="알고리즘 참고 추정가"
            value={marketEstimate}
            note={`${acquisitionMethodLabel(data.parcel.acquisitionEstimate?.method)}${houseProxy ? ` ${houseProxy.sampleSize}건` : ""} · ${confidenceLabel(marketConfidence)}`}
            tone="market"
          />
          <PricePoint
            label="현재 부동산 총 취득대금"
            value={acquisitionPrice}
            note={`${Math.round(acquisitionPerPyeong).toLocaleString()}만원/평 · ${acquisitionEdited ? "사용자 수정값" : "부지 등록 입력값"}`}
            tone="active"
          />
          <PricePoint
            label="예비 모델상 취득대금 한도"
            value={maxAcquisition.maxLandCost}
            note={`요구 IRR ${assumptions.equityIRR.toFixed(1)}% 역산`}
            tone={bidGap >= 0 ? "safe" : "risk"}
          />
        </div>
        <div className="method-strip">
          <span>
            활성 추정 표본 <b>
              {data.parcel.acquisitionEstimate?.method === "house-comps"
                ? houseProxy
                  ? `구축 주택 ${houseProxy.sampleSize}건`
                  : "구축 주택 · 구버전 표본 미보존"
                : `${data.parcel.acquisitionEstimate?.details?.sampleSize ?? "미보존"}건`}
            </b>
          </span>
          <span>토지 분포 표본 <b>{data.parcel.acquisitionEstimate?.transactionCount ?? "미보존"}건</b></span>
          <span>동일 지목 표본 <b>{data.parcel.acquisitionEstimate?.details?.sampleSize ?? "미보존"}</b></span>
          <span>입지 티어 <b>{data.parcel.acquisitionEstimate?.details?.locationTier ?? "이전 프로젝트"}</b></span>
          <button className="text-button" onClick={() => router.push(`/projects/${projectId}/comps`)}>실거래 근거 열기</button>
        </div>
      </section>

      <div className="workspace-grid">
        <main className="stage3-main">
          <section className="dashboard-section">
            <SectionHeader eyebrow="PRELIMINARY PRO FORMA" title="예비 사업수지" description="공사비·금융·매출 가정을 한 원장에서 계산한 세전 결과입니다. 세금은 계산 가능한 항목만 별도 표시하며 미산정 항목이 있습니다." />
            <FinancialReconciliationPanel audit={reconciliation} />
            <div className="metric-grid">
              <MetricCard label="세전 총사업비" value={won(result.totalCost)} note="세금·미확정 부대비 일부 별도" />
              <MetricCard label="가정상 매출·가치" value={won(result.totalRevenue)} />
              <MetricCard label="세전 예상손익" value={won(result.profit)} tone={profitTone} />
              <MetricCard label="이익률" value={`${result.profitMargin.toFixed(1)}%`} tone={profitTone} />
              <MetricCard label="필요 자기자본" value={won(result.equity)} />
              <MetricCard label="예비 PF 최고잔액" value={won(result.pfLoan)} note={`실제 LTC ${result.ltc.toFixed(1)}%`} />
              <MetricCard label="세전 IRR" value={irrAvailable ? `${result.irr.toFixed(1)}%` : "N/A"} note={irrAvailable ? undefined : "유일한 IRR을 산정할 수 없음"} tone={irrTone} />
              <MetricCard label="세전 NPV" value={won(result.npv)} note={`할인율 ${assumptions.equityIRR.toFixed(1)}%`} tone={result.npv >= 0 ? "positive" : "negative"} />
            </div>
            <div className="return-strip">
              <ReturnMetric label="Equity Multiple" value={`${result.equityMultiple.toFixed(2)}x`} />
              <ReturnMetric label="최대 자금노출" value={won(Math.abs(result.maxExposure))} />
              <ReturnMetric label="회수 예상" value={result.paybackMonths == null ? "N/A" : `${result.paybackMonths}개월`} note={result.paybackMonths == null ? "사업기간 내 미회수" : undefined} />
              <ReturnMetric label="전체 기간" value={`${result.totalMonths}개월`} />
              <ReturnMetric label="세금 부분 추정액" value={won(taxes.total)} note={taxes.complete ? "계산 완료" : "재산세·부가세 등 미산정"} />
            </div>
          </section>

          <section className="dashboard-section" id="deal-rescue">
            <DealRescuePanel
              rescue={visibleRescue}
              baseline={result}
              targetIRR={assumptions.equityIRR}
              running={rescueRunning}
              onRun={runDealRescue}
            />
          </section>

          <section className="dashboard-section" id="deal-stress-lab">
            <DealStressLabPanel
              stress={visibleStress}
              baseline={result}
              targetIRR={assumptions.equityIRR}
              running={stressRunning}
              onRun={runDealStress}
            />
          </section>

          <section className="dashboard-section split-section">
            <BreakdownPanel
              title="사업비 구성"
              total={result.totalCost}
              items={[
                ["부동산 취득대금", result.landCost], ["철거비", result.demolitionCost], ["직접 공사비", result.hardCost],
                ["설계·인허가·간접비", result.softCost], ["금융비", result.financingCost], ["예비비", result.contingency],
              ]}
            />
            <BreakdownPanel
              title="매출·가치 구성"
              total={result.totalRevenue}
              items={[["분양·통매각", result.revenueSale], ["임대 가치", result.revenueLease], ["근생 가치", result.revenueRetail]]}
            />
          </section>

          <section className="dashboard-section" id="sensitivity">
            <SectionHeader
              eyebrow="TWO-WAY SENSITIVITY"
              title={`${sensitivity.revenueLabel} × 공사비 민감도`}
              description="각 셀은 현재 토지 검토가와 금융조건을 고정하고 두 핵심 변수만 바꾼 예상 손익입니다."
            />
            <SensitivityMatrix sensitivity={sensitivity} />
            <div className="break-even-strip">
              <div>
                <span>현재 {breakEven.label}</span>
                <strong>{formatRevenuePrice(breakEven.current, breakEven.kind)}</strong>
              </div>
              <div>
                <span>손익분기 {breakEven.label}</span>
                <strong>{breakEven.value == null ? "계산 범위 밖" : formatRevenuePrice(breakEven.value, breakEven.kind)}</strong>
              </div>
              <div>
                <span>가격 안전마진</span>
                <strong>{breakEven.marginPct == null ? "—" : `${breakEven.marginPct >= 0 ? "+" : ""}${breakEven.marginPct.toFixed(1)}%`}</strong>
              </div>
            </div>
          </section>

          <section className="dashboard-section" id="cashflow">
            <SectionHeader eyebrow="UNIFIED CASH FLOW" title="분기 자금흐름" description="IRR·NPV·PF 이자와 동일한 월별 원장을 분기로 합산합니다. 설계·공사·회수 기간 입력과 공사비 100%가 반영됩니다." />
            <CashflowTable rows={cashflow} />
          </section>

          <section className="dashboard-section" id="price-evidence">
            <SectionHeader eyebrow="EXIT PRICE EVIDENCE" title="매각·분양 가격 근거" description="가격 추정치와 사용자가 수정한 계산 가정을 구분합니다. 사례가 부족하면 숫자를 확정값으로 표시하지 않습니다." />
            <div className="evidence-summary">
              <EvidenceMetric label="현재 적용 단가" value={`${Math.round((assumptions.salePricePerSqM * SQM_PER_PYEONG) / 10_000).toLocaleString()}만원/평`} />
              <EvidenceMetric label="채택 사례 중앙값" value={data.saleEstimate ? `${data.saleEstimate.medianPPP.toLocaleString()}만원/평` : "근거 부족"} />
              <EvidenceMetric label="전체 거래 중앙값" value={data.saleEstimate ? `${data.saleEstimate.conservativePPP.toLocaleString()}만원/평` : "근거 부족"} />
              <EvidenceMetric label="표본 근거 수준" value={confidenceLabel(saleConfidence)} />
            </div>
            <div className="case-list">
              {(data.saleEstimate?.cases ?? []).slice(0, 5).map((item) => (
                <div className="case-row" key={`${item.address}-${item.date}-${item.pricePerPyeong}`}>
                  <span><b>{item.address}</b><small>{item.date} · {item.buildYear ? `${item.buildYear}년 준공` : "준공연도 미확인"}</small></span>
                  <strong>{item.pricePerPyeong.toLocaleString()}만원/평</strong>
                  <em>{item.sameDong ? "같은 동" : "같은 구"}</em>
                </div>
              ))}
              {!data.saleEstimate && <div className="empty-evidence">채택 가능한 단독·다가구 유사 사례가 3건 미만입니다. 현재 가격은 시장 확정값이 아니라 기본 가정입니다.</div>}
            </div>
            <button className="secondary-button" onClick={() => router.push(`/projects/${projectId}/comps`)}>전체 실거래 비교</button>
          </section>

          {data.scenarios.length > 1 && (
            <section className="dashboard-section" id="plan-comparison">
              <SectionHeader eyebrow="SAVED PLAN COMPARISON" title="저장 계획안 사업성 비교" description="Stage 2에서 저장한 계획안만 비교하며, 현재 대표안과 동일한 기본 시장 가정을 사용합니다." />
              <ScenarioTable scenarios={data.scenarios} representativeId={financeScenario.id} onOpen={(id) => router.push(`/projects/${projectId}/scenarios/${id}`)} />
            </section>
          )}
        </main>

        <aside className="stage3-sidebar">
          <section className="assumption-panel" id="inputs">
            <div className="assumption-heading">
              <div><span className="section-kicker">LIVE INPUTS</span><h2>계산 조정</h2></div>
              {editedCount > 0 && <button className="text-button" onClick={resetAll}>{editedCount}건 초기화</button>}
            </div>
            <AcquisitionPriceEditor
              totalManwon={acquisitionPrice}
              lotAreaSqm={data.parcel.lotArea}
              referenceManwon={marketEstimate}
              edited={acquisitionEdited}
              source={projectFinancialSources.acquisitionPrice ? `${projectFinancialSources.acquisitionPrice.sourceName} · ${projectFinancialSources.acquisitionPrice.asOf} · 소스 값 적용` : "부지 등록 입력값 · 시장 추정가와 분리"}
              onChange={(value) => setDraftAcquisitionPrice(projectId, value)}
            />
            {activeAssumptionGroups.map((group) => (
              <details key={group.title} open className="assumption-group">
                <summary>{group.title}</summary>
                {group.fields.map((field) => (
                  <NumericEditor
                    key={field.field}
                    {...field}
                    value={assumptions[field.field]}
                    edited={projectFinancialSources[field.field] != null || draft?.[field.field] != null}
                    source={projectFinancialSources[field.field] ? `${projectFinancialSources[field.field]!.sourceName} · ${projectFinancialSources[field.field]!.asOf} · 소스 값 적용` : ASSUMPTION_META[field.field]?.basis ?? "사용자 확인 필요"}
                    onChange={(value) => setDraftAssumption(financeScenario.id, field.field, value)}
                  />
                ))}
              </details>
            ))}
          </section>

          <section className="evidence-panel" id="source-data-room">
            <SourceDataPanel
              key={`${scenario.id}:${sourceGate.requiredFields.join(",")}`}
              projectId={projectId}
              records={projectFinancialSources}
              gate={sourceGate}
              currentValues={currentSourceValues}
              onSave={(record) => setFinancialSource(projectId, record)}
              onRemove={(field) => removeFinancialSource(projectId, field)}
            />
          </section>

          <section className="evidence-panel">
            <span className="section-kicker">MODEL COVERAGE</span>
            <h2>계산 반영 범위</h2>
            <EvidenceRow label="대표 계획 매스" value={geometry.geometryHash} state="확정" />
            <SourceCoverageRow
              label="부동산 취득대금"
              fields={["acquisitionPrice"]}
              records={projectFinancialSources}
              fallback={`${acquisitionEdited ? "사용자 수정 입력" : "부지 등록 입력"} · ${won(acquisitionPrice)} 총액 · 계약서·감정평가 원문 필요`}
            />
            <EvidenceRow label="토지 참고 추정" value={`${data.parcel.acquisitionEstimate?.modelVersion ?? "legacy-unversioned"} · 자체 보정·외부 검증 전`} state="미확정" />
            {hasSaleRevenue && (
              <SourceCoverageRow
                label="매각 단가"
                fields={saleSourceFields}
                records={projectFinancialSources}
                fallback={data.saleEstimate ? `${data.saleEstimate.modelVersion} · ${data.saleEstimate.basis} · 외부 검증 전` : "내부 초기 가정 · 실거래 또는 감정평가 근거 필요"}
              />
            )}
            {hasLeaseRevenue && (
              <SourceCoverageRow
                label="임대 수입"
                fields={leaseSourceFields}
                records={projectFinancialSources}
                fallback="임대료·공실률·Exit cap rate 원문 필요"
              />
            )}
            <SourceCoverageRow
              label="공사비"
              fields={hasBasementCost
                ? ["constCostPerSqM", "basementCostMultiplier", "softCostRate", "contingencyRate"]
                : ["constCostPerSqM", "softCostRate", "contingencyRate"]}
              records={projectFinancialSources}
              fallback="시공사·건축사 견적 또는 승인 예산 기준 필요"
            />
            <SourceCoverageRow
              label="PF 조건"
              fields={["ltcTarget", "interestRate"]}
              records={projectFinancialSources}
              fallback="금융기관 Term Sheet 필요"
            />
            <SourceCoverageRow
              label="투자 기준"
              fields={["equityIRR"]}
              records={projectFinancialSources}
              fallback="대표자 승인 요구수익률 기준 필요"
            />
            <SourceCoverageRow
              label="사업 일정"
              fields={["designMonths", "constructionMonths", "saleOutMonths"]}
              records={projectFinancialSources}
              fallback="설계·공정·매각 일정 근거 필요"
            />
            <EvidenceRow label="세금" value={`${TAX_MODEL_AS_OF} 기본세율 · 미산정 항목 있음`} state="미확정" />
            <p className="coverage-note">등록된 원문이 실제 계산에 반영된 상태를 표시합니다. 월 분양 속도는 최소 분양 회수기간을, 임대 안정화 기간은 임대·근생 출구가치 회수시점과 금융비를 조정합니다.</p>
          </section>

          <section className="next-actions">
            <button className="secondary-button" onClick={() => router.push(`/projects/${projectId}/comps`)}>가격 근거</button>
            <button className="secondary-button" onClick={commitCurrentSnapshot}>현재안 저장</button>
            <button className="primary-button" disabled={sourceGate.status !== "source-backed"} title={sourceGate.status === "source-backed" ? "현재안을 저장하고 전문가 검증·인계로 이동합니다." : "필수 소스 데이터를 모두 등록해야 합니다."} onClick={openHandoff}>저장 후 전문가 인계</button>
            {savedAt && <span className="save-status" role="status">{savedAt} 보고서 스냅샷 저장</span>}
          </section>
        </aside>
      </div>

      <style jsx>{`
        .stage3-page{max-width:1540px;margin:0 auto;padding:26px 28px 54px;color:var(--fg)}
        .audit-banner{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;margin-bottom:12px;padding:12px 14px;border:1px solid #d8a92e;border-radius:10px;background:#fff8dc;color:#5f4600}.audit-copy{display:grid;gap:4px}.audit-banner strong{font-size:11.5px}.audit-banner span{font-size:10.5px;line-height:1.5}.audit-link{display:inline-flex;align-items:center;min-height:30px;padding:0 10px;border:1px solid currentColor;border-radius:7px;color:inherit;text-decoration:none;font-size:9.5px;font-weight:800;white-space:nowrap}\n        .stage3-header{display:flex;justify-content:space-between;gap:28px;align-items:flex-start;margin-bottom:18px}.eyebrow,.section-kicker{font-size:9px;letter-spacing:.18em;font-weight:800;color:var(--fg-muted)}
        h1{font-size:28px;letter-spacing:-.04em;margin:7px 0 7px}.stage3-header p{max-width:780px;margin:0;color:var(--fg-muted);font-size:12px;line-height:1.6}.header-actions{display:flex;gap:8px;align-items:center}
        button{font:inherit;cursor:pointer}.secondary-button,.primary-button{min-height:36px;border-radius:8px;padding:0 12px;border:1px solid var(--border);background:var(--bg-elev);color:var(--fg);font-size:11px;font-weight:700}.primary-button{background:var(--fg);color:var(--bg);border-color:var(--fg)}.text-button{border:0;background:transparent;color:var(--accent);font-size:10.5px;padding:0;font-weight:700}
        .source-lock{display:grid;grid-template-columns:minmax(260px,1.5fr) repeat(3,minmax(120px,.65fr));border:1px solid var(--border);border-radius:11px;background:var(--bg-elev);margin-bottom:12px}.source-main,.source-lock>:global(.fact){padding:13px 15px}.source-main{display:grid;gap:4px;border-right:1px solid var(--border-faint)}.source-main strong{font-size:14px}.source-main>span:last-child{font-size:10.5px;color:var(--fg-muted)}
        .decision-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
        .dashboard-section,.assumption-panel,.evidence-panel{border:1px solid var(--border);border-radius:11px;background:var(--bg-elev);padding:17px}.dashboard-section{margin-bottom:12px}.land-section{padding:18px 19px}
        .price-ladder{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-top:15px}.method-strip{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:11px;padding-top:10px;border-top:1px solid var(--border-faint);font-size:10px;color:var(--fg-muted)}.method-strip b{color:var(--fg)}.method-strip button{margin-left:auto}
        .workspace-grid{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:12px;align-items:start}.stage3-main{min-width:0}.stage3-sidebar{display:grid;gap:12px;position:sticky;top:16px}.assumption-heading{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--border-faint);padding-bottom:10px}.assumption-heading h2,.evidence-panel h2{font-size:16px;margin:5px 0 0}
        .metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px}.return-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-top:9px;border:1px solid var(--border-faint);border-radius:9px;overflow:hidden}.return-strip>:global(div)+:global(div){border-left:1px solid var(--border-faint)}
        .split-section{display:grid;grid-template-columns:1fr 1fr;gap:28px}.break-even-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.break-even-strip>div{padding:11px 12px;border-radius:8px;background:var(--bg-soft);display:grid;gap:4px}.break-even-strip span{font-size:9.5px;color:var(--fg-muted)}.break-even-strip strong{font-size:13px;font-family:var(--font-mono)}
        .evidence-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}.case-list{display:grid;margin:12px 0}.case-row{display:grid;grid-template-columns:1fr 130px 65px;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--border-faint);font-size:10.5px}.case-row span{display:grid;gap:2px}.case-row small{color:var(--fg-muted)}.case-row strong{text-align:right;font-family:var(--font-mono)}.case-row em{font-style:normal;text-align:center;border-radius:999px;background:var(--bg-soft);padding:4px 6px;color:var(--fg-muted)}.empty-evidence{padding:13px;background:var(--warn-soft);color:var(--warn-fg);border-radius:8px;font-size:10.5px;line-height:1.55}
        .assumption-group{border-bottom:1px solid var(--border-faint)}.assumption-group summary{padding:11px 0 7px;font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--fg-muted);cursor:pointer}.coverage-note{padding:10px;margin:11px 0 0;border-radius:8px;background:var(--bg-soft);font-size:9.5px;color:var(--fg-muted);line-height:1.55}.next-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.next-actions .primary-button,.save-status{grid-column:1/-1}.save-status{text-align:center;color:var(--pos-fg);font-size:9.5px}
        @media(max-width:1180px){.workspace-grid{grid-template-columns:1fr}.stage3-sidebar{position:static;grid-template-columns:1fr 1fr}.next-actions{grid-column:1/-1}.decision-grid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:760px){.stage3-page{padding:18px 14px}.stage3-header{display:block}.header-actions{margin-top:14px}.source-lock,.price-ladder,.metric-grid,.split-section,.evidence-summary,.stage3-sidebar{grid-template-columns:1fr}.source-main{border-right:0}.decision-grid{grid-template-columns:1fr}.return-strip{grid-template-columns:repeat(2,1fr)}.case-row{grid-template-columns:1fr}.case-row strong,.case-row em{text-align:left}.method-strip button{margin-left:0}}
      `}</style>
    </div>
  );
}

function DealStressLabPanel({
  stress,
  baseline,
  targetIRR,
  running,
  onRun,
}: {
  stress: DealStressResult | null;
  baseline: DealStressResult["baseline"];
  targetIRR: number;
  running: boolean;
  onRun: () => void;
}) {
  const baselinePasses =
    baseline.viable &&
    baseline.profit >= 0 &&
    baseline.npv >= 0 &&
    baseline.irrStatus === "calculated" &&
    baseline.irr >= targetIRR;
  const passCount =
    stress?.stressCases.filter((row) => row.passesTarget).length ?? 0;
  const maxCostShare = stress
    ? Math.max(...stress.costDna.map((row) => row.shareOfTotalCost), 1)
    : 1;

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 18,
          alignItems: "flex-start",
        }}
      >
        <SectionHeader
          eyebrow="DEAL STRESS LAB"
          title="손실 원인과 사업 생존선을 한 번에 검증합니다"
          description={`동일 금융 원장에서 비용 구성, 현재값 대비 통과 경계, 다섯 가지 하방 상황을 다시 계산합니다. 손익·NPV·IRR ${targetIRR.toFixed(1)}%를 동시에 만족해야 통과입니다.`}
        />
        <div
          style={{
            display: "grid",
            justifyItems: "end",
            gap: 8,
            flex: "0 0 auto",
          }}
        >
          <span
            style={{
              padding: "6px 9px",
              borderRadius: 999,
              background: baselinePasses
                ? "var(--pos-soft)"
                : "var(--neg-soft)",
              color: baselinePasses ? "var(--pos-fg)" : "var(--neg-fg)",
              fontSize: 9.5,
              fontWeight: 800,
            }}
          >
            {stress
              ? `하방 ${passCount}/5 통과`
              : baselinePasses
                ? "현재안 통과 · 하방 미검증"
                : "현재안 미달 · 원인 미검증"}
          </span>
          <button
            disabled={running}
            onClick={onRun}
            style={{
              minHeight: 36,
              padding: "0 12px",
              border: "1px solid var(--fg)",
              borderRadius: 8,
              background: "var(--fg)",
              color: "var(--bg)",
              font: "inherit",
              fontSize: 11,
              fontWeight: 700,
              cursor: running ? "wait" : "pointer",
              opacity: running ? 0.65 : 1,
            }}
          >
            {running
              ? "경계값 재계산 중…"
              : stress
                ? "현재 입력으로 다시 검증"
                : "사업성 검증 실행"}
          </button>
        </div>
      </div>

      {!stress && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
            marginTop: 15,
          }}
        >
          <RescueGate
            label="손익"
            value={won(baseline.profit)}
            pass={baseline.profit >= 0}
          />
          <RescueGate
            label="NPV"
            value={won(baseline.npv)}
            pass={baseline.npv >= 0}
          />
          <RescueGate
            label="IRR"
            value={
              baseline.irrStatus === "calculated"
                ? `${baseline.irr.toFixed(1)}%`
                : "N/A"
            }
            pass={
              baseline.irrStatus === "calculated" && baseline.irr >= targetIRR
            }
          />
        </div>
      )}

      {stress && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, .9fr) minmax(0, 1.35fr)",
              gap: 12,
              marginTop: 15,
            }}
          >
            <article
              style={{
                padding: 13,
                border: "1px solid var(--border-faint)",
                borderRadius: 9,
                background: "var(--bg-soft)",
              }}
            >
              <div style={{ display: "grid", gap: 3, marginBottom: 12 }}>
                <span className="section-kicker">LOSS DNA · LEDGER</span>
                <strong style={{ fontSize: 13 }}>비용 원장 구성</strong>
                <small style={{ color: "var(--fg-muted)", lineHeight: 1.45 }}>
                  비용 항목의 정확한 구성비입니다. 항목별 인과효과를 임의
                  추정하지 않습니다.
                </small>
              </div>
              <div style={{ display: "grid", gap: 9 }}>
                {stress.costDna.map((row) => (
                  <div key={row.id} style={{ display: "grid", gap: 4 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: 9.5,
                      }}
                    >
                      <span>{row.label}</span>
                      <strong style={{ fontFamily: "var(--font-mono)" }}>
                        {won(row.amount)} · {row.shareOfTotalCost.toFixed(1)}%
                      </strong>
                    </div>
                    <div
                      style={{
                        height: 5,
                        borderRadius: 999,
                        background: "var(--border-faint)",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          width: `${Math.max(1, (Math.abs(row.shareOfTotalCost) / maxCostShare) * 100)}%`,
                          height: "100%",
                          borderRadius: 999,
                          background: "var(--fg-muted)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 6,
                  marginTop: 13,
                  paddingTop: 10,
                  borderTop: "1px solid var(--border-faint)",
                }}
              >
                <StressGap
                  label="손익 부족"
                  value={
                    stress.gateGap.profit ? won(stress.gateGap.profit) : "없음"
                  }
                />
                <StressGap
                  label="NPV 부족"
                  value={stress.gateGap.npv ? won(stress.gateGap.npv) : "없음"}
                />
                <StressGap
                  label="IRR 부족"
                  value={
                    stress.gateGap.irrPctPoint == null
                      ? "산정 불가"
                      : `${stress.gateGap.irrPctPoint.toFixed(1)}%p`
                  }
                />
              </div>
            </article>

            <article
              style={{
                padding: 13,
                border: "1px solid var(--border-faint)",
                borderRadius: 9,
              }}
            >
              <div style={{ display: "grid", gap: 3, marginBottom: 11 }}>
                <span className="section-kicker">SURVIVAL LINES</span>
                <strong style={{ fontSize: 13 }}>
                  현재값 대비 사업 생존선
                </strong>
                <small style={{ color: "var(--fg-muted)", lineHeight: 1.45 }}>
                  각 행은 다른 조건을 고정한 단일 변수 경계입니다.
                  시장가격·견적·대출 약정이 아닙니다.
                </small>
              </div>
              <div style={{ display: "grid", gap: 7 }}>
                {stress.thresholds.map((row) => (
                  <StressThresholdRow
                    key={row.id}
                    row={row}
                    baselinePasses={stress.baselinePasses}
                  />
                ))}
              </div>
            </article>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ display: "grid", gap: 3, marginBottom: 9 }}>
              <span className="section-kicker">DOWNSIDE CASES</span>
              <strong style={{ fontSize: 13 }}>표준 하방 시나리오</strong>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                gap: 8,
              }}
            >
              {stress.stressCases.map((row) => (
                <article
                  key={row.id}
                  style={{
                    display: "grid",
                    gap: 8,
                    padding: 11,
                    border: `1px solid ${row.passesTarget ? "var(--pos-fg)" : "var(--neg-fg)"}`,
                    borderRadius: 8,
                    background: row.passesTarget
                      ? "var(--pos-soft)"
                      : "var(--neg-soft)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <strong style={{ fontSize: 10.5 }}>{row.label}</strong>
                    <b
                      style={{
                        fontSize: 8.5,
                        color: row.passesTarget
                          ? "var(--pos-fg)"
                          : "var(--neg-fg)",
                      }}
                    >
                      {row.passesTarget ? "통과" : "붕괴"}
                    </b>
                  </div>
                  <small
                    style={{
                      minHeight: 28,
                      color: "var(--fg-muted)",
                      lineHeight: 1.45,
                    }}
                  >
                    {row.changes.join(" · ")}
                  </small>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 4,
                      fontSize: 8.5,
                    }}
                  >
                    <span>
                      손익
                      <b style={{ display: "block", marginTop: 2 }}>
                        {won(row.result.profit)}
                      </b>
                    </span>
                    <span>
                      NPV
                      <b style={{ display: "block", marginTop: 2 }}>
                        {won(row.result.npv)}
                      </b>
                    </span>
                    <span>
                      IRR
                      <b style={{ display: "block", marginTop: 2 }}>
                        {row.result.irrStatus === "calculated"
                          ? `${row.result.irr.toFixed(1)}%`
                          : "N/A"}
                      </b>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <p
            style={{
              margin: "12px 0 0",
              paddingTop: 10,
              borderTop: "1px solid var(--border-faint)",
              color: "var(--fg-muted)",
              fontSize: 9,
              lineHeight: 1.55,
            }}
          >
            {stress.modelVersion} · 원장 대사 오차{" "}
            {Math.abs(stress.reconciliationError).toExponential(1)}만원 ·{" "}
            {stress.geometryPolicy} 탐색 한계: {stress.bounds.join(" / ")}.
          </p>
        </>
      )}
    </>
  );
}

function StressGap({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>
      {label}
      <b
        style={{
          display: "block",
          marginTop: 3,
          color: "var(--fg)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {value}
      </b>
    </span>
  );
}

function StressThresholdRow({
  row,
  baselinePasses,
}: {
  row: DealStressThreshold;
  baselinePasses: boolean;
}) {
  const available = row.threshold != null;
  const delta = row.deltaFromCurrentPct;
  let status = "범위 내 해 없음";
  if (available && row.status === "at-bound") status = "탐색 한계까지 통과";
  else if (available && baselinePasses && row.direction === "maximum") {
    status = `상승 여유 ${Math.abs(delta ?? 0).toFixed(1)}%`;
  } else if (available && baselinePasses) {
    status = `하락 여유 ${Math.abs(delta ?? 0).toFixed(1)}%`;
  } else if (available) {
    status = `필요 조정 ${delta != null && delta > 0 ? "+" : ""}${(delta ?? 0).toFixed(1)}%`;
  }
  const positive = available && baselinePasses;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "minmax(110px, 1fr) minmax(95px, .8fr) 18px minmax(95px, .8fr)",
        gap: 8,
        alignItems: "center",
        padding: "9px 10px",
        borderRadius: 8,
        background: available ? "var(--bg-soft)" : "var(--neg-soft)",
      }}
    >
      <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
        <b style={{ fontSize: 10 }}>{row.label}</b>
        <small
          style={{
            color: positive
              ? "var(--pos-fg)"
              : available
                ? "var(--warn-fg)"
                : "var(--neg-fg)",
            fontWeight: 700,
          }}
        >
          {status}
        </small>
      </span>
      <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>
        현재
        <b
          style={{
            display: "block",
            marginTop: 2,
            color: "var(--fg)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {formatStressThreshold(row.current, row.unit)}
        </b>
      </span>
      <b style={{ color: "var(--fg-muted)" }}>→</b>
      <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>
        {row.direction === "maximum" ? "최대" : "최소"}
        <b
          style={{
            display: "block",
            marginTop: 2,
            color: "var(--fg)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {available ? formatStressThreshold(row.threshold!, row.unit) : "N/A"}
        </b>
      </span>
    </div>
  );
}

function formatStressThreshold(
  value: number,
  unit: DealStressThreshold["unit"],
) {
  if (unit === "만원") return won(value);
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (unit === "원/㎡·월")
    return `${Math.round(value).toLocaleString()}원/㎡·월`;
  return `${Math.round(value).toLocaleString()}원/㎡`;
}

function DealRescuePanel({
  rescue,
  baseline,
  targetIRR,
  running,
  onRun,
}: {
  rescue: DealRescueResult | null;
  baseline: DealRescueResult["baseline"];
  targetIRR: number;
  running: boolean;
  onRun: () => void;
}) {
  const baselinePasses =
    baseline.viable &&
    baseline.profit >= 0 &&
    baseline.npv >= 0 &&
    baseline.irrStatus === "calculated" &&
    baseline.irr >= targetIRR;
  const statusLabel =
    rescue?.status === "already-viable"
      ? "현재안 목표 통과"
      : rescue?.status === "rescue-found"
        ? "검증 경로 발견"
        : rescue?.status === "geometry-blocked"
          ? "매스 재검토 필요"
          : rescue?.status === "no-bounded-solution"
            ? "탐색 범위 내 해결안 없음"
            : baselinePasses
              ? "현재안 목표 통과"
              : "분석 전";
  const statusTone: Tone =
    rescue?.status === "rescue-found" || baselinePasses
      ? "positive"
      : rescue
        ? "negative"
        : "review";
  const statusColors = toneColors(statusTone);

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 18,
          alignItems: "flex-start",
        }}
      >
        <SectionHeader
          eyebrow="DEAL RESCUE"
          title="이 사업을 살리는 최소 변경점을 역산합니다"
          description={`현재 계획 매스를 고정하고 토지가·매출 단가·직접 공사비·PF 금리를 다시 계산합니다. 흑자, NPV 0 이상, IRR ${targetIRR.toFixed(1)}% 이상을 모두 통과한 경로만 해결안으로 표시합니다.`}
        />
        <div
          style={{
            display: "grid",
            justifyItems: "end",
            gap: 8,
            flex: "0 0 auto",
          }}
        >
          <span
            style={{
              padding: "6px 9px",
              borderRadius: 999,
              background: statusColors.bg,
              color: statusColors.fg,
              fontSize: 9.5,
              fontWeight: 800,
            }}
          >
            {statusLabel}
          </span>
          <button
            disabled={running}
            onClick={onRun}
            style={{
              minHeight: 36,
              padding: "0 12px",
              border: "1px solid var(--fg)",
              borderRadius: 8,
              background: "var(--fg)",
              color: "var(--bg)",
              font: "inherit",
              fontSize: 11,
              fontWeight: 700,
              cursor: running ? "wait" : "pointer",
              opacity: running ? 0.65 : 1,
            }}
          >
            {running
              ? "목표 통과 여부 계산 중…"
              : rescue
                ? "현재 입력으로 다시 계산"
                : "최소 변경 찾기"}
          </button>
        </div>
      </div>

      {!rescue && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
            marginTop: 15,
          }}
        >
          <RescueGate
            label="손익"
            value={won(baseline.profit)}
            pass={baseline.profit >= 0}
          />
          <RescueGate
            label="NPV"
            value={won(baseline.npv)}
            pass={baseline.npv >= 0}
          />
          <RescueGate
            label="IRR"
            value={
              baseline.irrStatus === "calculated"
                ? `${baseline.irr.toFixed(1)}%`
                : "N/A"
            }
            pass={
              baseline.irrStatus === "calculated" &&
              baseline.irr >= targetIRR
            }
          />
        </div>
      )}

      {rescue?.status === "already-viable" && (
        <p
          style={{
            margin: "15px 0 0",
            padding: 12,
            borderRadius: 8,
            background: "var(--pos-soft)",
            color: "var(--pos-fg)",
            fontSize: 10.5,
            lineHeight: 1.55,
          }}
        >
          현재 입력이 네 가지 게이트를 모두 통과합니다. 불필요한 낙관 가정을
          추가하지 않았습니다.
        </p>
      )}

      {rescue && rescue.paths.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 9,
            marginTop: 15,
          }}
        >
          {rescue.paths.map((path) => {
            const reachable = path.status === "reachable";
            return (
              <article
                key={path.id}
                style={{
                  display: "grid",
                  alignContent: "start",
                  gap: 9,
                  minHeight: 178,
                  padding: 13,
                  border: `1px solid ${
                    reachable ? "var(--pos-fg)" : "var(--border-faint)"
                  }`,
                  borderRadius: 9,
                  background: reachable
                    ? "var(--pos-soft)"
                    : "var(--bg-soft)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <strong style={{ fontSize: 12 }}>{path.title}</strong>
                  <small
                    style={{
                      color: reachable
                        ? "var(--pos-fg)"
                        : "var(--fg-muted)",
                      fontWeight: 800,
                    }}
                  >
                    {reachable
                      ? "목표 통과"
                      : path.status === "not-applicable"
                        ? "해당 없음"
                        : "범위 내 불가"}
                  </small>
                </div>
                {reachable &&
                  path.changes.map((item) => (
                    <div
                      key={item.field}
                      style={{
                        paddingBottom: 7,
                        borderBottom: "1px solid var(--border-faint)",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          fontSize: 8.5,
                          color: "var(--fg-muted)",
                        }}
                      >
                        {item.label}
                      </span>
                      <strong
                        style={{
                          display: "block",
                          marginTop: 4,
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {formatRescueValue(item, item.from)} →{" "}
                        {formatRescueValue(item, item.to)}
                      </strong>
                      <small
                        style={{
                          display: "block",
                          marginTop: 2,
                          color: "var(--pos-fg)",
                        }}
                      >
                        {item.pctChange == null
                          ? "변화율 N/A"
                          : `${item.pctChange > 0 ? "+" : ""}${item.pctChange.toFixed(1)}%`}
                      </small>
                    </div>
                  ))}
                {reachable && path.result && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 6,
                      fontSize: 8.5,
                    }}
                  >
                    <span>
                      손익
                      <b style={{ display: "block", marginTop: 2 }}>
                        {won(path.result.profit)}
                      </b>
                    </span>
                    <span>
                      NPV
                      <b style={{ display: "block", marginTop: 2 }}>
                        {won(path.result.npv)}
                      </b>
                    </span>
                    <span>
                      IRR
                      <b style={{ display: "block", marginTop: 2 }}>
                        {path.result.irr.toFixed(1)}%
                      </b>
                    </span>
                  </div>
                )}
                <p
                  style={{
                    margin: 0,
                    color: "var(--fg-muted)",
                    fontSize: 8.5,
                    lineHeight: 1.5,
                  }}
                >
                  {path.reason}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {rescue && (
        <p
          style={{
            margin: "12px 0 0",
            paddingTop: 10,
            borderTop: "1px solid var(--border-faint)",
            color: "var(--fg-muted)",
            fontSize: 9,
            lineHeight: 1.55,
          }}
        >
          {rescue.modelVersion} · 엔진 재계산 결과이며 시세 예측이나 견적 확정이
          아닙니다. 기존 계획과 입력값은 자동 변경하지 않습니다. 도달 경로는
          실거래·시공사 견적·금융기관 조건으로 외부 검증한 뒤 별도 버전으로
          확정해야 합니다.
        </p>
      )}
    </>
  );
}

function RescueGate({
  label,
  value,
  pass,
}: {
  label: string;
  value: string;
  pass: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 11px",
        borderRadius: 8,
        background: pass ? "var(--pos-soft)" : "var(--neg-soft)",
      }}
    >
      <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>{label}</span>
      <strong
        style={{
          display: "block",
          marginTop: 4,
          color: pass ? "var(--pos-fg)" : "var(--neg-fg)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        {value} · {pass ? "통과" : "미달"}
      </strong>
    </div>
  );
}

function formatRescueValue(change: DealRescueChange, value: number) {
  if (change.unit === "만원") return won(value);
  if (change.unit === "%") return `${value.toFixed(2)}%`;
  if (change.unit === "원/㎡·월") {
    return `${Math.round(value).toLocaleString()}원/㎡·월`;
  }
  return `${Math.round(value).toLocaleString()}원/㎡`;
}

function formatRevenuePrice(value: number, kind: "sale" | "rent") {
  if (kind === "sale") return `${Math.round((value * SQM_PER_PYEONG) / 10_000).toLocaleString()}만원/평`;
  return `${(value / 10_000).toFixed(1)}만원/㎡·월`;
}

function Stage3Blocked({ title, message, projectId }: { title: string; message: string; projectId: string }) {
  const router = useRouter();
  return <div style={{ maxWidth: 840, margin: "0 auto", padding: "72px 28px" }}><div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg-elev)", padding: 28 }}><span className="ui-tag">STAGE 3</span><h1 style={{ margin: "14px 0 8px", fontSize: 28 }}>{title}</h1><p style={{ margin: 0, color: "var(--fg-muted)", lineHeight: 1.65, fontSize: 13 }}>{message}</p><p style={{ marginTop: 16, padding: 11, borderRadius: 8, background: "var(--bg-soft)", color: "var(--fg-muted)", fontSize: 11 }}>구형 권장안이나 다른 계획안의 숫자로 대체하지 않았습니다. 대표안·Geometry Snapshot·금융 시나리오가 정확히 일치할 때만 표시합니다.</p><button onClick={() => router.push(`/projects/${projectId}/envelope`)} style={{ marginTop: 10, height: 38, border: 0, borderRadius: 8, padding: "0 14px", background: "var(--fg)", color: "var(--bg)", font: "inherit", fontWeight: 700 }}>계획 스튜디오에서 대표안 확인</button></div></div>;
}

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  const colors = toneColors(tone);
  return <span style={{ display: "inline-flex", alignItems: "center", minHeight: 34, padding: "0 10px", borderRadius: 8, background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 700 }}>{children}</span>;
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="fact" style={{ display: "grid", alignContent: "center", gap: 5, borderLeft: "1px solid var(--border-faint)" }}><span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ fontSize: mono ? 10 : 13, fontFamily: mono ? "var(--font-mono)" : "inherit", overflowWrap: "anywhere" }}>{value}</strong></div>;
}

function DecisionSignal({ label, title, value, tone, note }: { label: string; title: string; value: string; tone: Tone; note: string }) {
  const colors = toneColors(tone);
  return <article style={{ border: "1px solid var(--border)", borderTop: `3px solid ${colors.edge}`, borderRadius: 10, padding: "12px 13px", background: "var(--bg-elev)" }}><span style={{ fontSize: 9, color: "var(--fg-muted)", fontWeight: 800, letterSpacing: ".08em" }}>{label}</span><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 8 }}><strong style={{ fontSize: 13 }}>{title}</strong><strong style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: colors.fg }}>{value}</strong></div><p style={{ margin: "7px 0 0", fontSize: 9.5, color: "var(--fg-muted)", lineHeight: 1.4 }}>{note}</p></article>;
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><span className="section-kicker">{eyebrow}</span><h2 style={{ fontSize: 17, margin: "6px 0 4px" }}>{title}</h2><p style={{ margin: 0, color: "var(--fg-muted)", fontSize: 10.5, lineHeight: 1.5 }}>{description}</p></div>;
}

function PricePoint({ label, value, note, tone = "default" }: { label: string; value: number; note: string; tone?: "default" | "market" | "active" | "safe" | "risk" }) {
  const edge = tone === "active" ? "var(--accent)" : tone === "safe" ? "var(--pos-fg)" : tone === "risk" ? "var(--neg-fg)" : "var(--border-faint)";
  return <div style={{ padding: "12px 13px", border: `1px solid ${edge}`, borderRadius: 9, background: tone === "active" ? "var(--accent-soft)" : "var(--bg-soft)" }}><span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 16 }}>{won(value)}</strong><small style={{ display: "block", marginTop: 4, color: "var(--fg-faint)", fontSize: 9 }}>{note}</small></div>;
}

function FinancialReconciliationPanel({
  audit,
}: {
  audit: FinancialReconciliationAudit;
}) {
  const tone: Tone =
    audit.status === "pass"
      ? "positive"
      : audit.status === "fail"
        ? "negative"
        : "review";
  const colors = toneColors(tone);
  const statusLabel =
    audit.status === "pass"
      ? "숫자 대사 통과"
      : audit.status === "fail"
        ? "숫자 대사 실패"
        : "자금조달 원장 확인";

  return (
    <div
      role="status"
      style={{
        marginTop: 14,
        padding: 12,
        border: `1px solid ${colors.edge}`,
        borderRadius: 9,
        background: colors.bg,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 11.5 }}>사업수지 자동 대사</strong>
        <span style={{ color: colors.fg, fontSize: 9.5, fontWeight: 800 }}>
          {statusLabel}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 7,
          marginTop: 9,
        }}
      >
        {audit.checks.map((check) => {
          const checkTone: Tone =
            check.status === "pass"
              ? "positive"
              : check.status === "fail"
                ? "negative"
                : "review";
          const checkColors = toneColors(checkTone);
          return (
            <div
              key={check.id}
              title={check.message}
              style={{
                padding: "9px 10px",
                borderRadius: 7,
                background: "var(--bg-elev)",
                border: "1px solid var(--border-faint)",
              }}
            >
              <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>
                {check.label}
              </span>
              <strong
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 9.5,
                  color: checkColors.fg,
                }}
              >
                {check.status === "pass"
                  ? "일치"
                  : check.status === "fail"
                    ? `불일치 ${Math.abs(check.differenceManwon).toFixed(2)}만원`
                    : "월별 원장 확인"}
              </strong>
            </div>
          );
        })}
      </div>
      <p
        style={{
          margin: "8px 0 0",
          color: "var(--fg-muted)",
          fontSize: 8.5,
          lineHeight: 1.5,
        }}
      >
        매출·사업비·손익은 각 금액의 1만원 단위 독립 반올림에서 생길 수 있는
        최대오차 이내로 자동 대사합니다. 자기자본은 누적 투입액, PF는 최고잔액이므로
        둘의 합은 총사업비 항등식이 아닙니다. 조달과 상환은 분기 자금흐름에서
        확인합니다.
      </p>
    </div>
  );
}

function MetricCard({ label, value, note, tone = "neutral" }: { label: string; value: string; note?: string; tone?: Tone }) {
  const colors = toneColors(tone);
  return <div style={{ padding: "12px 13px", border: "1px solid var(--border-faint)", borderRadius: 9, background: "var(--bg-soft)" }}><span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 6, fontSize: 16, fontFamily: "var(--font-mono)", color: colors.fg }}>{value}</strong>{note && <small style={{ display: "block", marginTop: 3, fontSize: 8.5, color: "var(--fg-faint)" }}>{note}</small>}</div>;
}

function ReturnMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div style={{ padding: "10px 11px", background: "var(--bg-elev)" }}><span style={{ display: "block", fontSize: 8.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 4, fontSize: 12, fontFamily: "var(--font-mono)" }}>{value}</strong>{note && <small style={{ fontSize: 8, color: "var(--fg-faint)" }}>{note}</small>}</div>;
}

function BreakdownPanel({ title, total, items }: { title: string; total: number; items: Array<[string, number]> }) {
  const max = Math.max(1, ...items.map(([, value]) => value));
  return <div><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong style={{ fontSize: 13 }}>{title}</strong><strong style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{won(total)}</strong></div><div style={{ display: "grid", gap: 9, marginTop: 13 }}>{items.map(([label, value]) => <div key={label}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 9.5 }}><span style={{ color: "var(--fg-muted)" }}>{label}</span><span style={{ fontFamily: "var(--font-mono)" }}>{won(value)}</span></div><div style={{ height: 4, marginTop: 4, borderRadius: 999, background: "var(--bg-soft)", overflow: "hidden" }}><div style={{ width: `${Math.max(0, value / max * 100)}%`, height: "100%", background: "var(--fg-subtle)" }} /></div></div>)}</div></div>;
}

function SensitivityMatrix({ sensitivity }: { sensitivity: Stage3Sensitivity }) {
  return <div style={{ overflowX: "auto", marginTop: 14 }}><table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 4, fontSize: 9.5 }}><thead><tr><th style={{ textAlign: "left", color: "var(--fg-muted)" }}>공사비 \ 가격</th>{sensitivity.revenueSteps.map((step) => <th key={step} style={{ minWidth: 84, color: "var(--fg-muted)" }}>{step > 0 ? "+" : ""}{step}%</th>)}</tr></thead><tbody>{sensitivity.rows.map((row, ri) => <tr key={sensitivity.costSteps[ri]}><th style={{ textAlign: "left", color: "var(--fg-muted)" }}>{sensitivity.costSteps[ri] > 0 ? "+" : ""}{sensitivity.costSteps[ri]}%</th>{row.map((cell, ci) => { const base = sensitivity.costSteps[ri] === 0 && sensitivity.revenueSteps[ci] === 0; const tone: Tone = cell.profit >= 0 ? "positive" : "negative"; const colors = toneColors(tone); return <td key={sensitivity.revenueSteps[ci]} style={{ padding: "9px 7px", textAlign: "center", borderRadius: 7, outline: base ? "2px solid var(--fg)" : "none", background: colors.bg, color: colors.fg }}><strong style={{ display: "block", fontFamily: "var(--font-mono)" }}>{won(cell.profit)}</strong><small>IRR {cell.irrStatus === "calculated" ? `${cell.irr.toFixed(1)}%` : "N/A"}</small></td>; })}</tr>)}</tbody></table></div>;
}

function CashflowTable({ rows }: { rows: ReturnType<typeof toCashflowVM> }) {
  const visible = rows.slice(0, 12);
  return <div style={{ overflowX: "auto", marginTop: 13 }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9.5 }}><thead><tr style={{ color: "var(--fg-muted)" }}><th style={{ textAlign: "left", padding: 8 }}>분기</th><th style={{ textAlign: "left", padding: 8 }}>단계</th><th style={{ textAlign: "right", padding: 8 }}>유입</th><th style={{ textAlign: "right", padding: 8 }}>유출</th><th style={{ textAlign: "right", padding: 8 }}>누적</th></tr></thead><tbody>{visible.map((row) => <tr key={row.quarter} style={{ borderTop: "1px solid var(--border-faint)" }}><td style={{ padding: 8 }}>{row.quarter}</td><td style={{ padding: 8 }}>{row.phase}</td><td style={{ padding: 8, textAlign: "right", fontFamily: "var(--font-mono)" }}>{won(row.inflow)}</td><td style={{ padding: 8, textAlign: "right", fontFamily: "var(--font-mono)" }}>{won(row.outflow)}</td><td style={{ padding: 8, textAlign: "right", fontFamily: "var(--font-mono)", color: row.cumulative < 0 ? "var(--neg-fg)" : "var(--pos-fg)" }}>{won(row.cumulative)}</td></tr>)}</tbody></table>{rows.length > visible.length && <p style={{ margin: "8px 0 0", fontSize: 9, color: "var(--fg-muted)" }}>전체 {rows.length}개 분기 중 초기 12개 분기 표시</p>}</div>;
}

function EvidenceMetric({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: "11px 12px", borderRadius: 8, background: "var(--bg-soft)" }}><span style={{ display: "block", fontSize: 9, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 5, fontSize: 12 }}>{value}</strong></div>;
}

function AcquisitionPriceEditor({
  totalManwon,
  lotAreaSqm,
  referenceManwon,
  edited,
  source,
  onChange,
}: {
  totalManwon: number;
  lotAreaSqm: number;
  referenceManwon: number;
  edited: boolean;
  source: string;
  onChange: (value: number) => void;
}) {
  const [mode, setMode] = useState<AcquisitionPriceMode>("total");
  const perPyeong = acquisitionPricePerPyeong(totalManwon, lotAreaSqm);
  const assessment = assessAcquisitionPrice(totalManwon, referenceManwon);
  const displayedValue = mode === "total" ? totalManwon : perPyeong;
  const warning =
    assessment.status === "extreme-low"
      ? `알고리즘 참고 추정의 ${assessment.ratioPct.toFixed(1)}%입니다. 총액과 평당가 단위를 다시 확인하세요.`
      : assessment.status === "extreme-high"
        ? `알고리즘 참고 추정의 ${assessment.ratioPct.toFixed(0)}%입니다. 총액과 평당가 단위를 다시 확인하세요.`
        : null;

  return (
    <div style={{ padding: "10px 0 12px", borderBottom: "1px solid var(--border-faint)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>부동산 총 취득대금</span>
        <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          {(["total", "per-pyeong"] as AcquisitionPriceMode[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              style={{
                minHeight: 25,
                padding: "0 7px",
                border: 0,
                background: mode === item ? "var(--fg)" : "var(--bg)",
                color: mode === item ? "var(--bg)" : "var(--fg-muted)",
                fontSize: 8.5,
                fontWeight: 700,
              }}
            >
              {item === "total" ? "총액" : "평당가"}
            </button>
          ))}
        </span>
      </div>
      <label style={{ display: "flex", justifyContent: "flex-end", gap: 5, alignItems: "center", marginTop: 7 }}>
        <input
          aria-label={mode === "total" ? "부동산 총 취득대금 총액" : "부동산 총 취득대금 평당가"}
          type="number"
          min={0}
          step={mode === "total" ? 1000 : 50}
          value={Number(displayedValue.toFixed(0))}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next) || next < 0) return;
            onChange(
              mode === "total"
                ? next
                : acquisitionPriceTotal(next, lotAreaSqm)
            );
          }}
          style={{
            width: 110,
            height: 29,
            padding: "0 7px",
            borderRadius: 6,
            border: `1px solid ${edited ? "var(--accent)" : "var(--border)"}`,
            background: "var(--bg)",
            color: edited ? "var(--accent)" : "var(--fg)",
            textAlign: "right",
            font: "inherit",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        />
        <small style={{ minWidth: 54, color: "var(--fg-faint)", fontSize: 8.5 }}>
          {mode === "total" ? "만원 총액" : "만원/평"}
        </small>
      </label>
      <div style={{ marginTop: 6, padding: "7px 8px", borderRadius: 6, background: "var(--bg-soft)", fontSize: 9, lineHeight: 1.5 }}>
        <strong>{won(totalManwon)} 총액</strong>
        <span style={{ marginLeft: 6, color: "var(--fg-muted)" }}>
          {Math.round(perPyeong).toLocaleString()}만원/평
        </span>
      </div>
      {warning && (
        <div role="alert" style={{ marginTop: 6, padding: "7px 8px", borderRadius: 6, background: "var(--neg-soft)", color: "var(--neg-fg)", fontSize: 8.8, lineHeight: 1.5 }}>
          {warning}
        </div>
      )}
      <small title={source} style={{ display: "block", marginTop: 4, color: edited ? "var(--accent)" : "var(--fg-faint)", fontSize: 8.5 }}>
        {edited ? "사용자 수정 · 실시간 재계산" : source}
      </small>
    </div>
  );
}

const SOURCE_KIND_LABELS: Record<FinancialSourceKind, string> = {
  "official-api": "공식 API 원문",
  "signed-contract": "서명 계약서",
  "professional-quote": "전문가·시공사 견적",
  "lender-term-sheet": "금융기관 Term Sheet",
  appraisal: "감정평가·시장보고서",
  "approved-policy": "승인된 내부 기준",
};

function SourceDataPanel({
  projectId,
  records,
  gate,
  currentValues,
  onSave,
  onRemove,
}: {
  projectId: string;
  records: FinancialSourceMap;
  gate: SourceDataGateResult;
  currentValues: Record<FinancialSourceField, number>;
  onSave: (record: FinancialSourceRecord) => void;
  onRemove: (field: FinancialSourceField) => void;
}) {
  const initialField =
    gate.missingFields[0] ?? gate.requiredFields[0] ?? "acquisitionPrice";
  const initialRecord = records[initialField];
  const [field, setField] = useState<FinancialSourceField>(initialField);
  const [value, setValue] = useState(
    String(initialRecord?.value ?? currentValues[initialField] ?? "")
  );
  const [sourceKind, setSourceKind] = useState<FinancialSourceKind>(
    initialRecord?.sourceKind ??
      FINANCIAL_SOURCE_FIELD_META[initialField].allowedKinds[0]
  );
  const [sourceName, setSourceName] = useState(
    initialRecord?.sourceName ?? ""
  );
  const [documentRef, setDocumentRef] = useState(
    initialRecord?.documentRef ?? ""
  );
  const [asOf, setAsOf] = useState(initialRecord?.asOf ?? "");
  const [verifiedBy, setVerifiedBy] = useState(
    initialRecord?.verifiedBy ?? ""
  );
  const [sourceDocument, setSourceDocument] =
    useState<SourceDocumentMetadata | null>(initialRecord?.document ?? null);
  const [uploadKey, setUploadKey] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const meta = FINANCIAL_SOURCE_FIELD_META[field];
  const guidance = FINANCIAL_SOURCE_GUIDANCE[field];
  const reusableSourceRecords = Array.from(
    new Map(
      Object.values(records)
        .filter(
          (record): record is FinancialSourceRecord & {
            document: SourceDocumentMetadata;
          } => Boolean(record?.document),
        )
        .map((record) => [record.document.pathname, record]),
    ).values(),
  );

  const selectField = (nextField: FinancialSourceField) => {
    const existing = records[nextField];
    const nextMeta = FINANCIAL_SOURCE_FIELD_META[nextField];
    setField(nextField);
    setValue(String(existing?.value ?? currentValues[nextField] ?? ""));
    setSourceKind(existing?.sourceKind ?? nextMeta.allowedKinds[0]);
    setSourceName(existing?.sourceName ?? "");
    setDocumentRef(existing?.documentRef ?? "");
    setAsOf(existing?.asOf ?? "");
    setVerifiedBy(existing?.verifiedBy ?? "");
    setSourceDocument(existing?.document ?? null);
    setSelectedFile(null);
    setFileInputKey((current) => current + 1);
    setError(null);
    setNotice(null);
  };

  const uploadSourceDocument = async () => {
    if (!selectedFile) {
      setError("업로드할 PDF·Excel·CSV 원문을 선택하세요.");
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("field", field);
      form.set("file", selectedFile);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/source-documents`,
        {
          method: "POST",
          headers: uploadKey.trim()
            ? { "x-parcelgrid-upload-key": uploadKey }
            : undefined,
          body: form,
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { document?: SourceDocumentMetadata; error?: string }
        | null;
      if (!response.ok || !payload?.document) {
        throw new Error(payload?.error ?? "원문 업로드에 실패했습니다.");
      }
      setSourceDocument(payload.document);
      setDocumentRef((current) => current.trim() || payload.document!.fileName);
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
      setNotice(
        `비공개 원문을 연결했습니다. SHA-256 ${payload.document.sha256.slice(0, 12)}…`,
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "원문 업로드에 실패했습니다.",
      );
    } finally {
      setUploading(false);
    }
  };

  const openSourceDocument = async (document: SourceDocumentMetadata) => {
    setError(null);
    try {
      const query = new URLSearchParams({
        pathname: document.pathname,
        fileName: document.fileName,
      });
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/source-documents?${query}`,
        {
          headers: uploadKey.trim()
            ? { "x-parcelgrid-upload-key": uploadKey }
            : undefined,
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "원문을 불러올 수 없습니다.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = document.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "원문을 불러올 수 없습니다.",
      );
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const record: FinancialSourceRecord = {
      field,
      value: Number(value),
      sourceKind,
      sourceName: sourceName.trim(),
      documentRef: documentRef.trim(),
      asOf,
      verifiedBy: verifiedBy.trim(),
      recordedAt: new Date().toISOString().slice(0, 10),
      document: sourceDocument ?? undefined,
    };
    const validation = validateFinancialSource(record);
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }
    onSave(record);
    setError(null);
    setNotice(
      sourceKindRequiresDocument(sourceKind) && !sourceDocument
        ? "값은 계산에 반영됐지만 원문 파일이 없어 전문가 인계는 계속 차단됩니다."
        : "원문 값과 증빙 메타데이터를 계산에 반영했습니다.",
    );
  };

  return (
    <>
      <span className="section-kicker">SOURCE DATA ROOM</span>
      <h2 style={{ fontSize: 16, margin: "5px 0 4px" }}>
        원문 기반 계산 입력
      </h2>
      <p
        style={{
          margin: "0 0 10px",
          color: "var(--fg-muted)",
          fontSize: 9.5,
          lineHeight: 1.5,
        }}
      >
        등록 즉시 해당 값이 예비 가정을 덮어쓰고 전체 사업성 원장을 다시
        계산합니다.
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "center",
          padding: "9px 10px",
          borderRadius: 8,
          background:
            gate.status === "source-backed"
              ? "var(--pos-soft)"
              : "var(--neg-soft)",
          color:
            gate.status === "source-backed"
              ? "var(--pos-fg)"
              : "var(--neg-fg)",
          fontSize: 9.5,
          fontWeight: 800,
        }}
      >
        <span>
          {gate.validRecords.length}/{gate.requiredFields.length}건 검증
        </span>
        <span>{gate.coveragePct.toFixed(0)}%</span>
      </div>

      <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
        {gate.requiredFields.map((item) => {
          const record = records[item];
          const validation = record
            ? validateFinancialSourceEvidence(record)
            : null;
          const status = validation?.valid
            ? "확정"
            : record
              ? "원문 확인"
              : "필요";
          return (
            <button
              key={item}
              type="button"
              onClick={() => selectField(item)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                width: "100%",
                padding: "7px 8px",
                border: `1px solid ${item === field ? "var(--accent)" : "var(--border-faint)"}`,
                borderRadius: 7,
                background: item === field ? "var(--accent-soft)" : "var(--bg-soft)",
                color: "var(--fg)",
                textAlign: "left",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 9.5, fontWeight: 700 }}>
                {FINANCIAL_SOURCE_FIELD_META[item].label}
              </span>
              <small
                style={{
                  color: validation?.valid
                    ? "var(--pos-fg)"
                    : record
                      ? "var(--warn-fg)"
                      : "var(--neg-fg)",
                  fontWeight: 800,
                }}
              >
                {status}
              </small>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gap: 4,
          marginTop: 10,
          padding: 9,
          borderRadius: 8,
          background: "var(--warn-soft)",
          color: "var(--warn-fg)",
          fontSize: 9,
          lineHeight: 1.5,
        }}
      >
        <b>{guidance.group} · 왜 필요한가</b>
        <span>{guidance.why}</span>
        <small>권장 근거: {guidance.recommendedEvidence}</small>
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 8, marginTop: 11 }}>
        <label style={sourceLabelStyle}>
          계산 항목
          <select
            value={field}
            onChange={(event) =>
              selectField(event.target.value as FinancialSourceField)
            }
            style={sourceInputStyle}
          >
            {gate.requiredFields.map((item) => (
              <option key={item} value={item}>
                {FINANCIAL_SOURCE_FIELD_META[item].label}
                {records[item] ? " · 등록됨" : " · 필요"}
              </option>
            ))}
          </select>
        </label>
        <label style={sourceLabelStyle}>
          원문 값 ({meta.unit})
          <input
            type="number"
            min="0"
            step="any"
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            style={sourceInputStyle}
          />
          <small style={{ color: "var(--fg-faint)", lineHeight: 1.45 }}>
            현재 예비 계산값을 자동 입력했습니다. 원문과 일치하는지 확인한 뒤 저장하세요.
          </small>
        </label>
        <label style={sourceLabelStyle}>
          출처 유형
          <select
            value={sourceKind}
            onChange={(event) =>
              setSourceKind(event.target.value as FinancialSourceKind)
            }
            style={sourceInputStyle}
          >
            {meta.allowedKinds.map((kind) => (
              <option key={kind} value={kind}>
                {SOURCE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <label style={sourceLabelStyle}>
          발급기관·출처명
          <input
            required
            value={sourceName}
            placeholder="예: ○○건설 / ○○은행"
            onChange={(event) => setSourceName(event.target.value)}
            style={sourceInputStyle}
          />
        </label>
        <label style={sourceLabelStyle}>
          문서번호·URL·파일 참조
          <input
            required
            value={documentRef}
            placeholder="예: 견적서 2026-07-A / 원문 URL"
            onChange={(event) => setDocumentRef(event.target.value)}
            style={sourceInputStyle}
          />
        </label>
        <fieldset
          style={{
            display: "grid",
            gap: 7,
            margin: 0,
            padding: 9,
            border: "1px solid var(--border-faint)",
            borderRadius: 8,
          }}
        >
          <legend style={{ padding: "0 4px", fontSize: 8.5, fontWeight: 800 }}>
            비공개 원문 보관함
          </legend>
          <label style={sourceLabelStyle}>
            접근 키 · 로컬 개발은 선택, 공유 서버는 필수
            <input
              type="password"
              autoComplete="off"
              value={uploadKey}
              placeholder="로컬에서는 비워도 됩니다"
              onChange={(event) => setUploadKey(event.target.value)}
              style={sourceInputStyle}
            />
          </label>
          {reusableSourceRecords.length > 0 && (
            <label style={sourceLabelStyle}>
              이미 등록한 원문과 발급정보 재사용
              <select
                value={sourceDocument?.pathname ?? ""}
                onChange={(event) => {
                  const reused = reusableSourceRecords.find(
                    (record) =>
                      record.document.pathname === event.target.value,
                  );
                  setSourceDocument(reused?.document ?? null);
                  if (reused) {
                    if (meta.allowedKinds.includes(reused.sourceKind)) {
                      setSourceKind(reused.sourceKind);
                    }
                    setSourceName(reused.sourceName);
                    setDocumentRef(reused.documentRef || reused.document.fileName);
                    setAsOf(reused.asOf);
                    setVerifiedBy(reused.verifiedBy);
                    setNotice("기존 원문·발급기관·기준일·확인자 정보를 재사용했습니다.");
                  }
                }}
                style={sourceInputStyle}
              >
                <option value="">새 원문 업로드 또는 연결 안 함</option>
                {reusableSourceRecords.map((record) => (
                  <option
                    key={record.document.pathname}
                    value={record.document.pathname}
                  >
                    {record.sourceName} · {record.document.fileName} ·{" "}
                    {record.document.sha256.slice(0, 10)}…
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={sourceLabelStyle}>
            PDF·XLSX·XLS·CSV · 최대 4MB
            <input
              key={fileInputKey}
              type="file"
              accept={SOURCE_DOCUMENT_ACCEPT}
              onChange={(event) =>
                setSelectedFile(event.target.files?.[0] ?? null)
              }
              style={{ ...sourceInputStyle, padding: 6 }}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={uploading || !selectedFile}
            onClick={uploadSourceDocument}
          >
            {uploading ? "해시 확인·업로드 중…" : "원문 비공개 업로드"}
          </button>
          {sourceDocument && (
            <div
              style={{
                display: "grid",
                gap: 3,
                padding: 8,
                borderRadius: 7,
                background: "var(--pos-soft)",
                color: "var(--pos-fg)",
                fontSize: 8.5,
                overflowWrap: "anywhere",
              }}
            >
              <b>{sourceDocument.fileName}</b>
              <span>
                {(sourceDocument.size / 1024).toFixed(1)}KB · SHA-256{" "}
                {sourceDocument.sha256.slice(0, 16)}…
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => openSourceDocument(sourceDocument)}
                style={{ justifySelf: "start" }}
              >
                원문 내려받기
              </button>
            </div>
          )}
          {sourceKindRequiresDocument(sourceKind) && !sourceDocument && (
            <small style={{ color: "var(--neg-fg)", lineHeight: 1.5 }}>
              이 출처 유형은 값을 저장할 수 있지만 원문 업로드 전까지 전문가
              인계 게이트를 통과하지 못합니다.
            </small>
          )}
        </fieldset>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          <label style={sourceLabelStyle}>
            기준일
            <input
              type="date"
              required
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              style={sourceInputStyle}
            />
          </label>
          <label style={sourceLabelStyle}>
            확인자
            <input
              required
              value={verifiedBy}
              placeholder="이름"
              onChange={(event) => setVerifiedBy(event.target.value)}
              style={sourceInputStyle}
            />
          </label>
        </div>
        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: 8,
              borderRadius: 7,
              background: "var(--neg-soft)",
              color: "var(--neg-fg)",
              fontSize: 9,
              lineHeight: 1.45,
            }}
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            style={{
              margin: 0,
              padding: 8,
              borderRadius: 7,
              background: "var(--pos-soft)",
              color: "var(--pos-fg)",
              fontSize: 9,
              lineHeight: 1.45,
            }}
          >
            {notice}
          </p>
        )}
        <button className="primary-button" type="submit">
          {records[field] ? "소스 값 갱신" : "소스 값 적용"}
        </button>
      </form>

      <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
        {gate.requiredFields.map((item) => {
          const record = records[item];
          if (!record) return null;
          const validation = validateFinancialSourceEvidence(record);
          return (
            <div
              key={item}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                padding: "8px 0",
                borderTop: "1px solid var(--border-faint)",
              }}
            >
              <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <b style={{ fontSize: 9.5 }}>
                  {FINANCIAL_SOURCE_FIELD_META[item].label} ·{" "}
                  {formatSourceValue(record)}
                </b>
                <small
                  style={{
                    color: validation.valid
                      ? "var(--pos-fg)"
                      : "var(--neg-fg)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {record.sourceName} · {record.asOf} · {record.documentRef}
                </small>
                {record.document && (
                  <small style={{ color: "var(--fg-muted)", overflowWrap: "anywhere" }}>
                    비공개 원문 {record.document.fileName} · SHA-256{" "}
                    {record.document.sha256.slice(0, 12)}…
                  </small>
                )}
                {!validation.valid && (
                  <small style={{ color: "var(--neg-fg)", lineHeight: 1.4 }}>
                    {validation.errors.join(" ")}
                  </small>
                )}
              </span>
              <span style={{ display: "grid", gap: 5, alignContent: "start" }}>
                {record.document && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => openSourceDocument(record.document!)}
                  >
                    원문
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onRemove(item)}
                >
                  제거
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

const sourceLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  color: "var(--fg-muted)",
  fontSize: 8.5,
  fontWeight: 700,
};

const sourceInputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--bg-elev)",
  color: "var(--fg)",
  padding: "0 8px",
  font: "inherit",
  fontSize: 10,
};

function formatSourceValue(record: FinancialSourceRecord) {
  const unit = FINANCIAL_SOURCE_FIELD_META[record.field].unit;
  if (unit === "만원") return won(record.value);
  if (unit === "%" || unit === "%/월") {
    return `${record.value.toLocaleString()}${unit}`;
  }
  return `${record.value.toLocaleString()}${unit}`;
}

function NumericEditor({ field, label, value, divisor, suffix, step, decimals = 0, edited, source, onChange }: Omit<AssumptionField, "field"> & { field?: keyof AssumptionSet; value: number; edited: boolean; source: string; onChange: (value: number) => void }) {
  const rule = field ? ASSUMPTION_VALUE_RULES[field] : null;
  const min = rule ? rule.min / divisor : 0;
  const max = rule ? rule.max / divisor : undefined;
  return <label style={{ display: "block", padding: "8px 0" }}><span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><span style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>{label}</span><span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="number" min={min} max={max} step={step} value={(value / divisor).toFixed(decimals)} onChange={(event) => { const next = Number(event.target.value); const rawValue = next * divisor; if (Number.isFinite(next) && (!field || validateAssumptionValue(field, rawValue).length === 0)) onChange(rawValue); }} style={{ width: 88, height: 27, padding: "0 6px", borderRadius: 6, border: `1px solid ${edited ? "var(--accent)" : "var(--border)"}`, background: "var(--bg)", color: edited ? "var(--accent)" : "var(--fg)", textAlign: "right", font: "inherit", fontSize: 10.5, fontWeight: 700 }} /><small style={{ color: "var(--fg-faint)", fontSize: 8.5 }}>{suffix}</small></span></span><small title={source} style={{ display: "block", marginTop: 3, maxWidth: 300, color: edited ? "var(--accent)" : "var(--fg-faint)", fontSize: 8.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{edited ? "사용자 수정 · 실시간 재계산" : source}</small></label>;
}

function SourceCoverageRow({
  label,
  fields,
  records,
  fallback,
}: {
  label: string;
  fields: FinancialSourceField[];
  records: FinancialSourceMap;
  fallback: string;
}) {
  const registered = fields
    .map((field) => records[field])
    .filter((record): record is FinancialSourceRecord => Boolean(record));
  const valid = registered.filter(
    (record) => validateFinancialSourceEvidence(record).valid
  );
  const state: "확정" | "검토" | "미확정" =
    valid.length === fields.length
      ? "확정"
      : registered.length > 0
        ? "검토"
        : "미확정";
  const value =
    registered.length > 0
      ? registered
          .map((record) => {
            const validation = validateFinancialSourceEvidence(record);
            return `${FINANCIAL_SOURCE_FIELD_META[record.field].label}: ${record.sourceName} · ${record.asOf}${validation.valid ? "" : " · 원문 확인 필요"}`;
          })
          .join(" / ")
      : fallback;

  return <EvidenceRow label={label} value={value} state={state} />;
}

function EvidenceRow({ label, value, state }: { label: string; value: string; state: "확정" | "검토" | "미확정" }) {
  const tone: Tone = state === "확정" ? "positive" : state === "검토" ? "review" : "negative";
  return <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border-faint)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ fontSize: 8.5, color: toneColors(tone).fg }}>{state}</strong></div><div style={{ marginTop: 3, fontSize: 9.5, lineHeight: 1.4, overflowWrap: "anywhere" }}>{value}</div></div>;
}

function ScenarioTable({ scenarios, representativeId, onOpen }: { scenarios: ScenarioVM[]; representativeId: string; onOpen: (id: string) => void }) {
  return <div style={{ overflowX: "auto", marginTop: 13 }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}><thead><tr style={{ color: "var(--fg-muted)", textAlign: "right" }}><th style={{ textAlign: "left", padding: 8 }}>계획안</th><th style={{ padding: 8 }}>총사업비</th><th style={{ padding: 8 }}>손익</th><th style={{ padding: 8 }}>IRR</th><th style={{ padding: 8 }}>NPV</th></tr></thead><tbody>{scenarios.map((scenario) => { const representative = scenario.id === representativeId; return <tr key={scenario.id} onClick={() => onOpen(scenario.id)} style={{ borderTop: "1px solid var(--border-faint)", background: representative ? "var(--accent-soft)" : "transparent", cursor: "pointer", textAlign: "right" }}><td style={{ textAlign: "left", padding: 9 }}><strong>{scenario.name}</strong>{representative && <small style={{ marginLeft: 6, color: "var(--accent)" }}>대표안</small>}</td><td style={{ padding: 9, fontFamily: "var(--font-mono)" }}>{won(scenario.cost)}</td><td style={{ padding: 9, fontFamily: "var(--font-mono)", color: scenario.profit >= 0 ? "var(--pos-fg)" : "var(--neg-fg)" }}>{won(scenario.profit)}</td><td style={{ padding: 9, fontFamily: "var(--font-mono)" }}>{scenario.irrStatus === "calculated" ? `${scenario.irr.toFixed(1)}%` : "N/A"}</td><td style={{ padding: 9, fontFamily: "var(--font-mono)" }}>{won(scenario.npv)}</td></tr>; })}</tbody></table></div>;
}

function acquisitionMethodLabel(method?: "house-comps" | "by-comps" | "by-publicvalue" | "hybrid") {
  if (method === "house-comps") return "구축 단독·다가구 토지 proxy";
  if (method === "by-comps") return "토지 실거래";
  if (method === "hybrid") return "실거래·공시지가 혼합";
  if (method === "by-publicvalue") return "공시지가 배율";
  return "이전 프로젝트 추정";
}

function confidenceLabel(confidence: "high" | "medium" | "low") {
  return confidence === "high" ? "표본 근거 충분" : confidence === "medium" ? "표본 근거 보통" : "표본 근거 부족";
}

function toneColors(tone: Tone) {
  if (tone === "positive") return { bg: "var(--pos-soft)", fg: "var(--pos-fg)", edge: "var(--pos)" };
  if (tone === "negative") return { bg: "var(--neg-soft)", fg: "var(--neg-fg)", edge: "var(--neg-fg)" };
  if (tone === "review") return { bg: "var(--warn-soft)", fg: "var(--warn-fg)", edge: "var(--warn-fg)" };
  return { bg: "var(--bg-soft)", fg: "var(--fg)", edge: "var(--border)" };
}
