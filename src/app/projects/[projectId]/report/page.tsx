"use client";
import { FacadeCostSummary } from "@/components/planning/FacadeCostSummary";

import { matchesProjectIntake } from "@/lib/services/project-intake";

/**
 * 예비 사업성 검토서 — 전문가 검토 전 한 장 요약.
 *
 * 저장된 분석 결과를 비교용으로 묶는다. 금융기관 약정, 시공사 견적,
 * 세무조정과 외부 가격검증 전에는 투자 타당성 확정 보고서로 사용하지 않는다.
 */

import { TransactionEvidence } from "@/components/ui/TransactionEvidence";
import { hasParcelBoundary } from "@/lib/geo/parcel-topology";
import { IntegratedVerificationPanel } from "@/components/handoff/IntegratedVerificationPanel";
import { useReviewVerification } from "@/lib/hooks/use-review-verification";
import type { ReviewVerificationRequest } from "@/lib/handoff/review-verification-task";
import { ReviewVerificationStatus } from "@/components/handoff/ReviewVerificationStatus";
import { buildingRegistryLabel } from "@/lib/building-registry/evidence";
import { BuildingRegistryEvidencePanel } from "@/components/ui/BuildingRegistryEvidence";
import { use, useMemo } from "react";
import Link from "next/link";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { won, num, scenarioViable } from "@/lib/utils/format";
import { PROJECT_LEDGER_MODEL_VERSION } from "@/lib/finance/project-ledger";
import { verifiedConstructionCostSensitivity } from "@/lib/finance/construction-cost-sensitivity";
import { revenuePricingForScenario } from "@/lib/finance/revenue-contract";
import {
  buildAfterTaxLedger,
  buildExpertTaxContractKey,
} from "@/lib/finance/after-tax-ledger";
import {
  buildAfterTaxDecisionSupport,
  type AfterTaxDecisionObjective,
} from "@/lib/finance/after-tax-decision-support";
import type { ScenarioDecisionObjective } from "@/lib/finance/scenario-decision-support";
import { calcProgramParking } from "@/lib/finance/parking";
import type {
  BuildingProgram,
  RevenuePoolPricingSnapshot,
} from "@/lib/finance/types";
import { buildEvidenceGate } from "@/lib/handoff/evidence-gate";
import {
  EXPERT_REVIEWER_ROLE_META,
  buildExpertReviewSummary,
  type ExpertReviewMap,
} from "@/lib/handoff/review-workflow";
import {
  validateReviewSnapshotAlignment,
} from "@/lib/handoff/review-snapshot";
import {
  buildSourceDataGate,
  FINANCIAL_SOURCE_FIELD_META,
  validateFinancialSourceEvidence,
  type FinancialSourceMap,
} from "@/lib/finance/source-data-gate";
import type {
  PriceVerificationRecord,
  PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import { buildPlanningDesignIntent } from "@/lib/planning/design-intent";
import {
  PLANNING_FACADE_LABELS,
  resolvePlanningMaterials,
} from "@/lib/planning/materials";
import ConceptRenderStudio from "@/components/report/ConceptRenderStudio";
import ConstructionCostSensitivityTable from "@/components/report/ConstructionCostSensitivityTable";
import {
  constraintStatusLabel,
  coreRegulatoryConstraintsVerified,
  type RegulatoryConstraintEvidence,
} from "@/lib/regulatory/constraints";
import {
  evaluateSunlightRegulation,
  type SunlightLegalUse,
} from "@/lib/regulatory/sunlight-rules";
import { useProjectReviewLedger } from "@/lib/hooks/use-project-review-ledger";
import { useProjectReviewSnapshot } from "@/lib/hooks/use-project-review-snapshot";

const SQM_PER_PYEONG = 3.305785;

const DISCIPLINE_LABEL = {
  architect: "건축가",
  developer: "시행·원가",
  "finance-tax": "금융·회계·세무",
  "insurance-risk": "보험·리스크",
  "sales-marketing": "분양·홍보",
} as const;

const REVIEW_STATUS_LABEL = {
  "not-requested": "미요청",
  requested: "검토 요청",
  "in-review": "검토 중",
  approved: "승인",
  "changes-requested": "수정 요청",
} as const;

const EVIDENCE_STATUS_LABEL = {
  "system-confirmed": "시스템 재현",
  "expert-review": "전문가 검토",
  missing: "미확인",
} as const;

const EMPTY_FINANCIAL_SOURCES: FinancialSourceMap = Object.freeze({});
const EMPTY_PRICE_VERIFICATIONS: Partial<
  Record<PriceVerificationTarget, PriceVerificationRecord>
> = Object.freeze({});
const EMPTY_EXPERT_REVIEWS: ExpertReviewMap = Object.freeze({});

const REVENUE_ADJUSTMENT_LABELS = {
  use: "용도",
  location: "입지",
  floor: "층",
  area: "면적",
  newBuild: "신축",
} as const;

function reportRevenueAdjustmentSummary(
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

function reportRevenueSourceLabel(
  pricing: RevenuePoolPricingSnapshot,
): string {
  if (pricing.sourceStatus === "source-backed") return pricing.sourceName;
  if (pricing.sourceStatus === "user-input") {
    return `사용자 입력 · ${pricing.sourceName}`;
  }
  return `내부 가정 · ${pricing.sourceName}`;
}

function reportSunlightLegalUse(type: BuildingProgram["type"]): SunlightLegalUse {
  switch (type) {
    case "single-house":
      return "detached-house";
    case "multi-family":
      return "multi-family-house";
    case "urban-housing":
      return "urban-housing";
    case "officetel":
      return "officetel";
    case "coliving":
    case "mixed":
      return "unknown-residential";
    default:
      return "general-building";
  }
}

export default function ReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const reviewLedger = useProjectReviewLedger(projectId);
  const liveData = useProjectStore((state) => state.data);
  const representativeGeometry = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );
  const planningScenarios = useProjectStore(
    (state) => state.planningScenarios
  );
  const representativePlanningScenarioId = useProjectStore(
    (state) => state.representativePlanningScenarioId
  );
  const stage3Snapshots = useProjectStore(
    (state) => state.stage3FeasibilitySnapshots
  );
  const financialSources = useProjectStore(
    (state) =>
      state.financialSources[projectId] ?? EMPTY_FINANCIAL_SOURCES
  );
  const allExpertTaxContracts = useProjectStore(
    (state) => state.expertTaxContracts
  );
  const priceVerifications = useReviewStore(
    (state) =>
      state.priceVerifications[projectId] ?? EMPTY_PRICE_VERIFICATIONS
  );
  const storedExpertReviews = useReviewStore(
    (state) => state.expertReviews[projectId] ?? EMPTY_EXPERT_REVIEWS
  );
  const expertReviews =
    reviewLedger.query.data?.reviews ?? storedExpertReviews;

  const savedSnapshot = stage3Snapshots[projectId];
  const stage3Snapshot = savedSnapshot && matchesProjectIntake(savedSnapshot.data, liveData) ? savedSnapshot : null;
  const geometry =
    representativeGeometry?.projectId === projectId
      ? representativeGeometry
      : null;
  const planningScenario =
    planningScenarios.find(
      (scenario) =>
        scenario.id === representativePlanningScenarioId &&
        (!scenario.projectId || scenario.projectId === projectId)
    ) ?? null;
  const snapshotAlignment = useMemo(
    () =>
      validateReviewSnapshotAlignment({
        snapshot: stage3Snapshot,
        geometry,
        currentScenario: planningScenario,
      }),
    [geometry, planningScenario, stage3Snapshot]
  );
  const projectTaxContracts = useMemo(
    () => {
      return Object.values(allExpertTaxContracts).filter(
        (contract) =>
          contract.projectId === projectId &&
          stage3Snapshot?.data.scenarios.some((scenario) => scenario.id === contract.scenarioId),
      );
    },
    [allExpertTaxContracts, projectId, stage3Snapshot?.data.scenarios],
  );
  const data = snapshotAlignment.valid && stage3Snapshot ? stage3Snapshot.data : liveData;
  const verificationRequest = useMemo<ReviewVerificationRequest | null>(
    () =>
      snapshotAlignment.valid && stage3Snapshot
        ? { kind: "saved", input: {
            snapshot: stage3Snapshot,
            financialSources,
            priceVerifications,
            expertTaxContracts: projectTaxContracts,
            planningScenario,
            geometry,
          } }
        : data ? { kind: "preview", input: {
            projectId, representativeScenarioId: planningScenario?.id ?? "unselected",
            representativeScenarioVersion: planningScenario?.version ?? 0,
            geometryHash: geometry?.geometryHash ?? "", data, planningScenario, geometry,
          } } : null,
    [
      financialSources,
      priceVerifications,
      projectTaxContracts,
      snapshotAlignment.valid,
      stage3Snapshot,
      planningScenario,
      geometry,
      data,
      projectId,
    ]
  );
  const verificationWork = useReviewVerification(verificationRequest);
  const reviewSnapshotPayload = verificationWork.payload;
  const integratedVerification = verificationWork.report;
  const serverSnapshot = useProjectReviewSnapshot(
    projectId,
    verificationWork.result,
  );
  const reviewSnapshotKey = serverSnapshot.sealed
    ? serverSnapshot.currentKey
    : null;
  const scenarios = useMemo(() => data?.scenarios ?? [], [data?.scenarios]);
  const recommended = useMemo(
    () => scenarios.find((s) => s.recommended) ?? scenarios[0],
    [scenarios]
  );
  const constructionCostSensitivity = useMemo(
    () =>
      data && recommended
        ? verifiedConstructionCostSensitivity(
            { parcel: data.parcel, scenario: recommended._raw },
            recommended.constructionCostSensitivity,
          )
        : null,
    [data, recommended],
  );
  const decisionSupport = data?.decisionSupport;
  const afterTaxDecisionSupport = useMemo(() => {
    if (!decisionSupport) return null;
    return buildAfterTaxDecisionSupport({
      strategy: "stabilized-sale",
      preTaxDecisionSupport: decisionSupport,
      candidates: scenarios.map((scenario) => ({
        scenarioId: scenario.id,
        ledger: buildAfterTaxLedger({
          projectId,
          scenarioId: scenario.id,
          strategy: "stabilized-sale",
          preTaxEquityCashFlowsManwon: scenario.equityCashFlowsManwon,
          preTaxAcquisitionTaxManwon: scenario.acquisitionTax,
          equityHurdleRatePct: scenario._raw.assumptions.equityIRR,
          contract:
            allExpertTaxContracts[
              buildExpertTaxContractKey(
                projectId,
                scenario.id,
                "stabilized-sale",
              )
            ],
        }),
        requiredEquityManwon: scenario.funding.requiredEquityManwon,
        maxExposureManwon: Math.abs(scenario.maxExposure),
        durationMonths: scenario.timeline,
        regulatoryScore: scenario.regulatory,
      })),
    });
  }, [allExpertTaxContracts, decisionSupport, projectId, scenarios]);
  const parcel = data?.parcel;
  const comps = useMemo(() => data?.comps ?? [], [data?.comps]);
  const constructionSource = financialSources.constCostPerSqM;
  const ltcSource = financialSources.ltcTarget;
  const interestSource = financialSources.interestRate;
  const pfFeeSource = financialSources.pfUpfrontFeeRate;
  const validConstructionQuote = Boolean(
    constructionSource &&
      constructionSource.sourceKind === "professional-quote" &&
      validateFinancialSourceEvidence(constructionSource).valid
  );
  const validTermSheet = Boolean(
    ltcSource &&
    interestSource &&
    pfFeeSource &&
    ltcSource.sourceKind === "lender-term-sheet" &&
    interestSource.sourceKind === "lender-term-sheet" &&
    pfFeeSource.sourceKind === "lender-term-sheet" &&
    validateFinancialSourceEvidence(ltcSource).valid &&
    validateFinancialSourceEvidence(interestSource).valid &&
    validateFinancialSourceEvidence(pfFeeSource).valid
  );
  const afterTax = useMemo(() => {
    if (!recommended) return null;
    const base = buildAfterTaxLedger({
      projectId,
      scenarioId: recommended.id,
      strategy: "stabilized-sale",
      preTaxEquityCashFlowsManwon: recommended.equityCashFlowsManwon,
      preTaxAcquisitionTaxManwon: recommended.acquisitionTax,
      equityHurdleRatePct: recommended._raw.assumptions.equityIRR,
      contract:
        allExpertTaxContracts[
          buildExpertTaxContractKey(
            projectId,
            recommended.id,
            "stabilized-sale"
          )
        ],
    });
    const hold =
      (recommended.hold?.combinedEquityCashFlowsManwon?.length ?? 0) > 0
        ? buildAfterTaxLedger({
            projectId,
            scenarioId: recommended.id,
            strategy: "long-term-hold",
            preTaxEquityCashFlowsManwon:
              recommended.hold.combinedEquityCashFlowsManwon,
            preTaxAcquisitionTaxManwon: recommended.acquisitionTax,
            equityHurdleRatePct: recommended._raw.assumptions.equityIRR,
            contract:
              allExpertTaxContracts[
                buildExpertTaxContractKey(
                  projectId,
                  recommended.id,
                  "long-term-hold"
                )
              ],
          })
        : null;
    return { base, hold };
  }, [allExpertTaxContracts, projectId, recommended]);
  const taxComplete = Boolean(
    afterTax?.base.decisionGrade &&
      (!afterTax.hold || afterTax.hold.decisionGrade)
  );
  const reviewSummary = useMemo(
    () =>
      buildExpertReviewSummary(
        expertReviews,
        reviewSnapshotKey ?? "__missing-current-stage3-snapshot__"
      ),
    [expertReviews, reviewSnapshotKey]
  );

  const evidenceGate = useMemo(() => {
    if (!data) return null;
    return buildEvidenceGate({
      projectId,
      address: data.parcel.address,
      geometryHash: geometry?.geometryHash ?? null,
      roadReferenceCount: data.parcel.roads?.length ?? 0,
      regulatorySourceBacked: coreRegulatoryConstraintsVerified(
        data.parcel.regulatoryConstraints
      ),
      saleCompCount: comps.length,
      transactionEvidence: data.transactionEvidence,
      saleEstimateVersion: data.saleEstimate?.modelVersion ?? null,
      acquisitionEstimateVersion:
        data.parcel.acquisitionEstimate?.modelVersion ?? null,
      financeModelVersion: PROJECT_LEDGER_MODEL_VERSION,
      taxComplete,
      hasConstructionQuote: validConstructionQuote,
      hasTermSheet: validTermSheet,
      hasExternalPriceOpinion:
        priceVerifications.acquisition?.status === "verified",
    });
  }, [
    comps.length,
    data,
    geometry,
    priceVerifications.acquisition?.status,
    projectId,
    taxComplete,
    validConstructionQuote,
    validTermSheet,
  ]);

  const compsMedian = useMemo(() => {
    if (comps.length === 0) return null;
    const sorted = [...comps.map((c) => c.pricePerPyeong)].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }, [comps]);

  const sourceGate = useMemo(
    () =>
      recommended
        ? buildSourceDataGate(recommended._raw, financialSources)
        : null,
    [financialSources, recommended]
  );

  const designPrompt = useMemo(() => {
    if (!planningScenario || !parcel) {
      return "첨부한 PARCELGRID 3D 기준 이미지의 층수, 전체 실루엣, 층별 외곽선과 후퇴, 대지 내 위치, 회전 방향, 도로 관계, 카메라와 원근을 변경하지 않는다. 외장 마감과 합리적인 저층 주거 창호만 표현한다.";
    }
    return buildPlanningDesignIntent(planningScenario, {
      projectId,
      address: parcel.address,
      parcelAreaSqm: parcel.lotArea,
      maxBuildingCoveragePct: parcel.maxBCR,
      maxFloorAreaRatioPct: parcel.maxFAR,
    }).generationInstruction.promptKo;
  }, [parcel, planningScenario, projectId]);

  const planningMaterials = useMemo(
    () => (planningScenario ? resolvePlanningMaterials(planningScenario.materials) : null),
    [planningScenario]
  );

  if (
    !data ||
    !parcel ||
    !recommended ||
    !evidenceGate ||
    !sourceGate ||
    !afterTax
  ) {
    return <div style={{ padding: 40, color: "var(--fg-muted)" }}>보고서를 생성할 데이터가 없습니다.</div>;
  }

  const pyeong = parcel.lotArea / SQM_PER_PYEONG;
  const analysisDate = data.meta?.lastSyncedAt
    ? new Date(data.meta.lastSyncedAt).toLocaleDateString("ko-KR")
    : new Date().toLocaleDateString("ko-KR");
  const areaContract = recommended._raw.program.areaContract;
  const lockedRevenueProjection = areaContract?.revenueProjection;
  const currentRevenuePricing = revenuePricingForScenario(recommended._raw);
  const revenueByPool = recommended.revenueByPool ?? {
    residentialSale: recommended.revenueSale,
    retailSale: 0,
    officeSale: 0,
    residentialLease: recommended.revenueLease,
    retailLease: recommended.revenueRetail,
    officeLease: 0,
  };
  const acquisitionTax = recommended.acquisitionTax ?? 0;
  const baseAfterTax = afterTax.base;
  const holdAfterTax = afterTax.hold;
  const acquisitionOtherCost = recommended.acquisitionOtherCost ?? 0;
  const tenantRelocationCost = recommended.tenantRelocationCost ?? 0;
  const interestCost =
    recommended.interestCost ?? recommended.financingCost;
  const pfFee = recommended.pfFee ?? 0;
  const trustFee = recommended.trustFee ?? 0;
  const funding = recommended.funding ?? {
    status: "unverified" as const,
    equityCommitmentManwon: null,
    requiredEquityManwon: recommended.equity,
    shortfallManwon: 0,
    firstShortfallMonth: null,
    pfCommitmentManwon: recommended.pf ?? 0,
    maxPfBalanceManwon: recommended.pf ?? 0,
  };
  const takeout = recommended.takeout;
  const hold = recommended.hold;
  const holdConfigured = Boolean(
    hold &&
      hold.status !== "not-applicable" &&
      hold.status !== "not-configured",
  );
  const holdCalculated = Boolean(
    hold &&
      [
        "modeled-unverified",
        "refinance-shortfall",
        "commitment-feasible",
      ].includes(hold.status),
  );
  const finalReady =
    integratedVerification?.status === "preliminary" &&
    reviewLedger.query.data?.ledger.integrity.valid === true &&
    snapshotAlignment.valid &&
    Boolean(reviewSnapshotKey) &&
    evidenceGate.criticalBlockerCount === 0 &&
    reviewSummary.ready &&
    sourceGate.status === "source-backed" &&
    funding.status === "funded";
  const parkingRequirementContract = areaContract?.parkingRequirement;
  const derivedParkingRequirement = parkingRequirementContract
    ? null
    : calcProgramParking(parcel, recommended._raw.program);
  const parkingRule =
    parkingRequirementContract?.rule ?? derivedParkingRequirement?.rule;
  const parkingWarnings =
    parkingRequirementContract?.warnings ??
    derivedParkingRequirement?.warnings ??
    [];
  const parkingSource = parkingRule?.sources[0];
  const sunlightAssessment =
    areaContract?.sunlightAssessment ??
    evaluateSunlightRegulation({
      context: { address: parcel.address },
      zoning: parcel.zoning,
      zoningStatus:
        parcel.inputProvenance?.zoning === "vworld-land-use"
          ? "public-observation"
          : "user-entered",
      buildingHeightM: recommended._raw.program.floorsAbove * 3 + 1.4,
      floorsAbove: recommended._raw.program.floorsAbove,
      legalUse: reportSunlightLegalUse(recommended._raw.program.type),
      legalUseStatus: "source-backed",
      daylight: {
        sameLotBuildingCount: 1,
        sameLotBuildingCountStatus: "source-backed",
      },
    });
  const sunlightSource = sunlightAssessment.rule.sources[0];
  const currentBuilding = parcel.currentBuilding;
  const accountingGap = Math.abs(
    recommended.revenue - recommended.cost - recommended.profit
  );

  return (
    <div className="rpt-wrap">
      <div className="rpt-page">
          <TransactionEvidence evidence={data.transactionEvidence} />
          <BuildingRegistryEvidencePanel info={currentBuilding} printMode />
        {/* 표지 헤더 */}
        <div className="rpt-head">
          <div className="rpt-brand">
            <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden>
              <path d="M3.5 23 L14 4 L14 23 Z" fill="var(--accent)" />
              <path d="M24.5 23 L14 4 L14 23 Z" fill="var(--edge-gold)" />
            </svg>
            <div>
              <span className="rpt-co"><b>Double</b> Edge</span>
              <span className="rpt-pr">ParcelGrid</span>
            </div>
          </div>
          <div className="rpt-meta">
            예비 사업성 검토서<br />분석 기준일 {analysisDate}
          </div>
        </div>

        <div className="rpt-title">{parcel.address}</div>
        <div className="rpt-sub">
          {parcel.zoning} · 대지 {num(Math.round(parcel.lotArea * 100) / 100)}㎡ ({pyeong.toFixed(1)}평) · 검토 인수가 {won(parcel.acquiredPrice)}
        </div>

        <div
          role="status"
          style={{
            margin: "12px 0",
            padding: "10px 12px",
            border: "1px solid #d8a92e",
            borderRadius: 8,
            background: "#fff8dc",
            color: "#5f4600",
            fontSize: 11,
            lineHeight: 1.55,
          }}
        >
          <strong>{finalReady ? "Stage 5 · 현재 저장본의 분야별 검토 기록 완료" : "Stage 5 예비 모델 · 전문가 검토 진행 중"}</strong><br />
          {geometry?.analysisReference && <><strong>예비 분석 기준안</strong> · 공식 경계·허가·전문가 승인 미확정 · 채택 시 미확정 항목 {geometry.analysisReference.unresolved.length}건<br /></>}
          {snapshotAlignment.valid && stage3Snapshot ? "아래 값은 Stage 3 저장본의 세전 비교값입니다." : "유효한 Stage 3 저장본이 없어 현재 계산값을 예비 표시합니다."} 계산 입력 근거 {sourceGate.validRecords.length}/{sourceGate.requiredFields.length}건 · 자금조달 {funding.status === "funded" ? "한도 내" : funding.status === "shortfall" ? `${won(funding.shortfallManwon)} 부족` : "한도 미확인"} · Stage 4 필수 미확인 {evidenceGate.criticalBlockerCount}건 · 전문가 승인 {reviewSummary.approvedCount}/{reviewSummary.requiredDisciplines.length}개 분야 · 재검토 {reviewSummary.staleDisciplines.length}개 분야 · 서버 Snapshot {serverSnapshot.sealed ? "SHA-256 봉인" : "미봉인"} · 감사 체인 {reviewLedger.query.data?.ledger.integrity.valid ? "검증" : "미확인"}입니다.
          {!snapshotAlignment.valid && <> 현재 저장본 문제: {snapshotAlignment.errors.join(" ")}</>}  금융기관 약정·시공사 견적·감정평가·세무 원문을 별도로 대조하기 전에는 매입 결정, 대출 심사 또는 세무신고에 사용할 수 없습니다.{" "}
          <Link href={`/projects/${projectId}/handoff`} style={{ color: "inherit", fontWeight: 700 }}>
            검증·인계 보드 확인
          </Link>
        </div>

        <ReviewVerificationStatus work={verificationWork} />
        <IntegratedVerificationPanel projectId={projectId} report={integratedVerification} packet={reviewSnapshotPayload} snapshotKey={serverSnapshot.currentKey} sealed={serverSnapshot.sealed} />

        {/* 대표 비교 시나리오 */}
        <div className="rpt-reco">
          <div className="rpt-reco-top">
            <span className="rpt-reco-name">대표 비교안 — {recommended.shortName} {recommended.name}</span>
            <span className="rpt-reco-badge">예비 비교안</span>
          </div>
          <div className="rpt-reco-kpis">
            <div className="rpt-reco-kpi">
              <div className="l">기본 공사단가 -15% 손익</div>
              <div className="v">
                {constructionCostSensitivity?.low.status === "calculated"
                  ? won(constructionCostSensitivity.low.result.profit)
                  : constructionCostSensitivity?.low.status === "unavailable"
                    ? "산출 불가"
                    : "재계산 필요"}
              </div>
            </div>
            <div className="rpt-reco-kpi"><div className="l">{snapshotAlignment.valid && stage3Snapshot ? "Base 저장 손익" : "Base 예비 손익"}</div><div className="v">{won(recommended.profit)}</div></div>
            <div className="rpt-reco-kpi">
              <div className="l">기본 공사단가 +20% 손익</div>
              <div className="v">
                {constructionCostSensitivity?.high.status === "calculated"
                  ? won(constructionCostSensitivity.high.result.profit)
                  : constructionCostSensitivity?.high.status === "unavailable"
                    ? "산출 불가"
                    : "재계산 필요"}
              </div>
            </div>
            <div className="rpt-reco-kpi"><div className="l">{snapshotAlignment.valid && stage3Snapshot ? "저장된 세전 IRR" : "예비 세전 IRR"}</div><div className="v">{recommended.irrStatus === "calculated" ? `${recommended.irr.toFixed(1)}%` : "N/A"}</div></div>
          </div>
        </div>

        {/* 부지 개요 */}
        <div className="rpt-sec">
          <div className="rpt-sec-h">부지 개요</div>
          <div className="rpt-ov">
            <OvItem l="대지면적" v={`${num(Math.round(parcel.lotArea * 100) / 100)}㎡ / ${pyeong.toFixed(1)}평`} />
            <OvItem l="용도지역" v={parcel.zoning} />
            <OvItem
              l="용적률"
              v={`${parcel.maxFAR}% · ${constraintStatusLabel(parcel.regulatoryConstraints?.far.status ?? "unknown")}`}
            />
            <OvItem
              l="건폐율"
              v={`${parcel.maxBCR}% · ${constraintStatusLabel(parcel.regulatoryConstraints?.bcr.status ?? "unknown")}`}
            />
            <OvItem l="검토 인수가" v={won(parcel.acquiredPrice)} />
            <OvItem l="평당 검토 인수가" v={`${num(Math.round(parcel.acquiredPrice / pyeong))}만`} />
          </div>
        </div>

        {geometry && (
          <div className="rpt-sec">
            <div className="rpt-sec-h">대표 계획 매스 · Geometry Snapshot</div>
            <div className="rpt-ov">
              <OvItem l="층수" v={`지상 ${geometry.building.aboveGroundFloors.length}층 · 지하 ${geometry.building.basementFloors.length}층`} />
              <OvItem l="프로그램 면적" v={`${num(Math.round(geometry.building.totalProgramAreaSqm * 10) / 10)}㎡`} />
              <OvItem l="실현 용적률" v={`${geometry.building.preliminaryFarPct.toFixed(1)}%`} />
              <OvItem l="기하 검증" v={geometry.analysisReference ? "예비 분석 기준안 · 고정" : geometry.validation.status === "pass" ? "대표안 적격 · 고정" : "추가 검토"} />
              <OvItem l="Geometry hash" v={geometry.geometryHash} />
            </div>
          </div>
        )}


        <div className="rpt-sec">
          <div className="rpt-sec-h">기존 건축물 · 건축HUB 건축물대장</div>
          {currentBuilding ? (
            <>
              <div className="rpt-ov">
                <OvItem l="존재 여부" v={buildingRegistryLabel(currentBuilding)} />
                <OvItem l="수신 건물 연면적 합" v={currentBuilding.buildings.length ? `${num(Math.round(currentBuilding.totalBuildingArea * 10) / 10)}㎡ · 누락 여부 확인` : "미확인"} />
                <OvItem l="가장 오래된 사용승인" v={currentBuilding.oldestApprovalDate || "미확인"} />
                <OvItem l="최대 노후도" v={currentBuilding.maxAgeYears > 0 ? `${currentBuilding.maxAgeYears}년` : "미확인"} />
                <OvItem l="검토 시그널" v={currentBuilding.hasBuilding ? currentBuilding.signalLabel : buildingRegistryLabel(currentBuilding)} />
                <OvItem l="건물 동수" v={`${currentBuilding.buildings.length}동`} />
              </div>
              <p style={{ margin: "10px 0 0", color: "var(--fg-muted)", fontSize: 10.5, lineHeight: 1.55 }}>
                {currentBuilding.hasBuilding ? currentBuilding.signalReasoning : "표제부 조회 0건이나 조회 실패만으로 실제 빈 토지를 확정하지 않습니다."} 건축물대장 관측값이며 철거 가능성·위반건축물·임차권·현황 일치는 별도 원문과 현장조사가 필요합니다.
              </p>
              {currentBuilding.buildings.length > 0 && (
                <table className="rpt-table" style={{ marginTop: 10 }}>
                  <thead><tr><th>동·용도</th><th>구조</th><th className="num">층수</th><th className="num">연면적</th><th className="num">건폐/용적</th><th>사용승인</th></tr></thead>
                  <tbody>
                    {currentBuilding.buildings.map((building, index) => (
                      <tr key={`${building.name}-${index}`}>
                        <td>{building.name || `${index + 1}동`} · {building.detailPurpose || building.mainPurpose || "용도 미확인"}</td>
                        <td>{building.structure || "미확인"}</td>
                        <td className="num">지상 {building.groundFloors} / 지하 {building.undergroundFloors}</td>
                        <td className="num">{building.missingFields?.includes("totArea") ? "미제공" : `${num(Math.round(building.totalArea * 10) / 10)}㎡`}</td>
                        <td className="num">{building.buildingCoverage.toFixed(1)}% / {building.floorAreaRatio.toFixed(1)}%</td>
                        <td>{building.approvalDate || "미확인"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p style={{ color: "var(--neg-fg)", fontSize: 11 }}>
              건축HUB 건축물대장 조회 결과가 저장되지 않았습니다. 주소 분석을 다시 실행하거나 MOLIT_SERVICE_KEY와 해당 API 활용 승인을 확인하세요.
            </p>
          )}
          <BuildingRegistryEvidencePanel info={currentBuilding} printMode />
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">대표 계획 프로그램 · Stage 2→3 면적 계약</div>
          <div className="rpt-ov">
            <OvItem l="계획 용도" v={recommended.typeKr} />
            <OvItem l="층수" v={`지상 ${recommended.floors.above}층 · 지하 ${recommended.floors.below}층`} />
            <OvItem l="공사 기준 연면적" v={`${num(Math.round((areaContract?.constructionAreaSqm ?? recommended.gfa) * 10) / 10)}㎡`} />
            <OvItem l="용적률 산입면적" v={areaContract ? `${num(Math.round(areaContract.farAreaSqm * 10) / 10)}㎡` : "Legacy FAR/BCR 계산"} />
            <OvItem l="매각 가능면적" v={areaContract ? `${num(Math.round(areaContract.saleableAreaSqm * 10) / 10)}㎡` : "미분리"} />
            <OvItem l="임대 가능면적" v={areaContract ? `${num(Math.round(areaContract.rentableAreaSqm * 10) / 10)}㎡` : "미분리"} />
            <OvItem l="주차" v={areaContract ? `계획 ${areaContract.providedParkingSpaces}대 / 필요 ${areaContract.requiredParkingSpaces}대` : `${recommended._raw.program.units.residential}세대 기준 재검토`} />
            <OvItem l="면적 계약" v={areaContract ? areaContract.schemaVersion : "구버전 호환 계산"} />
            <OvItem l="형상 출처" v={areaContract?.geometrySource?.mode ?? planningScenario?.geometrySource?.mode ?? "미확인"} />
          </div>
          {planningMaterials && (
            <p style={{ margin: "10px 0 0", color: "var(--fg-muted)", fontSize: 10.5 }}>
              외장: {PLANNING_FACADE_LABELS[planningMaterials.primaryFacadeMaterial]} {planningMaterials.primaryFacadeSharePct}% · {PLANNING_FACADE_LABELS[planningMaterials.secondaryFacadeMaterial]} {100 - planningMaterials.primaryFacadeSharePct}% · 창호비 {planningMaterials.windowRatioPct}%
            </p>
          )}
          {lockedRevenueProjection && (
            <div className="rpt-table-scroll" style={{ marginTop: 12 }}>
              <table className="rpt-table rpt-regulatory-table">
                <thead>
                  <tr>
                    <th>수익 풀</th>
                    <th className="num">면적</th>
                    <th className="num">기준단가</th>
                    <th>보정</th>
                    <th className="num">Stage 2 잠금</th>
                    <th className="num">Stage 3 현재</th>
                    <th>단가 근거</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["주거 매각", "residentialSale", "residentialSaleSqm"],
                    ["상가 매각", "retailSale", "retailSaleSqm"],
                    ["업무 매각", "officeSale", "officeSaleSqm"],
                    ["주거 임대", "residentialLease", "residentialLeaseSqm"],
                    ["상가 임대", "retailLease", "retailLeaseSqm"],
                    ["업무 임대", "officeLease", "officeLeaseSqm"],
                  ] as const)
                    .filter(
                      ([, , areaKey]) =>
                        Number(lockedRevenueProjection.areas[areaKey] ?? 0) > 0
                    )
                    .map(([label, pool, areaKey]) => {
                      const lockedPricing =
                        lockedRevenueProjection.pricing.pools[pool];
                      const currentPricing = currentRevenuePricing.pools[pool];
                      const baseUnitPrice =
                        currentPricing.baseUnitPriceWon ??
                        currentPricing.unitPriceWon /
                          Math.max(currentPricing.adjustmentFactor, 0.000001);
                      const unitLabel =
                        currentPricing.unit === "won-per-sqm" ? "㎡" : "㎡·월";
                      const changed =
                        Math.abs(
                          currentPricing.unitPriceWon - lockedPricing.unitPriceWon,
                        ) > 0.01;
                      return (
                        <tr key={pool}>
                          <td>{label}</td>
                          <td className="num">
                            {num(lockedRevenueProjection.areas[areaKey], 1)}㎡
                          </td>
                          <td className="num">
                            {Math.round(baseUnitPrice).toLocaleString()}원/{unitLabel}
                          </td>
                          <td>{reportRevenueAdjustmentSummary(currentPricing)}</td>
                          <td className="num">
                            {Math.round(lockedPricing.unitPriceWon).toLocaleString()}원/
                            {unitLabel}
                          </td>
                          <td
                            className="num"
                            style={changed ? { color: "var(--warn-fg)", fontWeight: 700 } : undefined}
                          >
                            {Math.round(currentPricing.unitPriceWon).toLocaleString()}원/
                            {unitLabel}
                            {changed ? " · 변경" : ""}
                          </td>
                          <td>{reportRevenueSourceLabel(currentPricing)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              <p style={{ margin: "7px 0 0", color: "var(--fg-muted)", fontSize: 9.5, lineHeight: 1.5 }}>
                단가 계약 {currentRevenuePricing.modelVersion}. 임대 풀: 잠재 임대료 - 공실 {currentRevenuePricing.vacancyRatePct.toFixed(1)}% - 유효총수입 대비 운영비 {Number(currentRevenuePricing.operatingExpenseRatePct ?? 0).toFixed(1)}% = NOI. 출구가치는 NOI ÷ Cap rate {currentRevenuePricing.capRatePct.toFixed(2)}% × 안정화 {currentRevenuePricing.stabilizationFactorPct.toFixed(0)}%입니다.
              </p>
            </div>
          )}
        </div>

        <div className="rpt-sec"><div className="rpt-sec-h">외벽 수량·재료비</div><FacadeCostSummary cost={areaContract?.facadeCost} /></div>

        <ConceptRenderStudio
          projectId={projectId}
          geometryHash={geometry?.geometryHash}
          defaultPrompt={designPrompt}
        />

        <div className="rpt-sec">
          <div className="rpt-sec-h">사업수지 원장 · 매출과 비용</div>
          <div className="rpt-two-col">
            <table className="rpt-table">
              <thead><tr><th>매출</th><th className="num">금액</th></tr></thead>
              <tbody>
                <MoneyRow label="주거 매각" value={revenueByPool.residentialSale} />
                <MoneyRow label="상가 매각" value={revenueByPool.retailSale} />
                <MoneyRow label="업무 매각" value={revenueByPool.officeSale} />
                <MoneyRow label="주거 임대 출구가치" value={revenueByPool.residentialLease} />
                <MoneyRow label="상가 임대 출구가치" value={revenueByPool.retailLease} />
                <MoneyRow label="업무 임대 출구가치" value={revenueByPool.officeLease} />
                <MoneyRow label="총매출" value={recommended.revenue} strong />
              </tbody>
            </table>
            <table className="rpt-table">
              <thead><tr><th>비용</th><th className="num">금액</th></tr></thead>
              <tbody>
                <MoneyRow label="부동산 취득대금" value={recommended.landCost} />
                <MoneyRow label="취득세 반영액" value={acquisitionTax} />
                <MoneyRow label="기타 취득 부대비" value={acquisitionOtherCost} />
                <MoneyRow label="철거비" value={recommended.demolitionCost} />
                <MoneyRow label="명도·임차인 정리비" value={tenantRelocationCost} />
                <MoneyRow label="직접 공사비" value={recommended.hardCost} />
                <MoneyRow label="설계·감리·인허가" value={recommended.softCost} />
                <MoneyRow label="예비비" value={recommended.contingency} />
                <MoneyRow label="PF 이자" value={interestCost} />
                <MoneyRow label="PF 약정·취급 수수료" value={pfFee} />
                <MoneyRow label="신탁·자금관리비" value={trustFee} />
                <MoneyRow label="총사업비" value={recommended.cost} strong />
              </tbody>
            </table>
          </div>
          <div className="rpt-reconciliation">
            <span>매출 = 비용 + 세전손익</span>
            <strong>{accountingGap <= 1 ? "정합" : `차이 ${won(accountingGap)}`}</strong>
            <span>누적 자기자본 + PF 최고잔액</span>
            <strong style={{ color: "var(--warn-fg)" }}>
              월별 원장 확인 · 합계 항등식 아님
            </strong>
          </div>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">자본구조 · 수익지표 · 세금 경계</div>
          <div className="rpt-ov">
            <OvItem l="자기자본" v={won(recommended.equity)} />
            <OvItem
              l="확인 자기자본 한도"
              v={
                funding.equityCommitmentManwon == null
                  ? "미확인"
                  : won(funding.equityCommitmentManwon)
              }
            />
            <OvItem
              l="자금조달 상태"
              v={
                funding.status === "funded"
                  ? "한도 내"
                  : funding.status === "shortfall"
                    ? `${won(funding.shortfallManwon)} 부족`
                    : "미확인"
              }
            />
            <OvItem l="PF" v={won(recommended.pf)} />
            <OvItem l="계획 PF 한도" v={won(funding.pfCommitmentManwon)} />
            <OvItem l="LTC" v={`${recommended.ltc.toFixed(1)}%`} />
            <OvItem l="세전 손익" v={won(recommended.profit)} />
            <OvItem l="이익률" v={`${recommended.profitMargin.toFixed(1)}%`} />
            <OvItem l="세전 IRR" v={recommended.irrStatus === "calculated" ? `${recommended.irr.toFixed(1)}%` : "N/A"} />
            <OvItem l="NPV" v={won(recommended.npv)} />
            <OvItem l="Equity Multiple" v={recommended.equityMultiple > 0 ? `${recommended.equityMultiple.toFixed(2)}×` : "N/A"} />
            <OvItem
              l="장기대출 DSCR"
              v={recommended.dscrStatus === "takeout-amortizing" ? recommended.dscr.toFixed(2) : "N/A"}
            />
            {takeout?.modeledLoanManwon != null && (
              <>
                <OvItem l="장기대출 계산액" v={won(takeout.modeledLoanManwon)} />
                <OvItem
                  l="수수료·DSRA 차감 종결 현금흐름"
                  v={won(takeout.netTakeoutCashFlowManwon ?? takeout.netTakeoutProceedsManwon ?? 0)}
                />
                <OvItem l="최초 DSRA 제한현금" v={won(takeout.dsraRequiredBalanceManwon ?? 0)} />
                <OvItem
                  l="장기대출 금리 경로"
                  v={
                    takeout.rateMode === "projected-variable"
                      ? `${(takeout.minimumProjectedRatePct ?? 0).toFixed(2)}~${(takeout.maximumProjectedRatePct ?? 0).toFixed(2)}% 예상 변동`
                      : `${(takeout.maximumProjectedRatePct ?? 0).toFixed(2)}% 고정`
                  }
                />
                <OvItem
                  l="상환기간 / 계약 만기"
                  v={`${takeout.terms.amortizationYears}년 / ${takeout.terms.loanTermYears}년`}
                />
                <OvItem
                  l="납부유예 / 이자만 납부"
                  v={`${takeout.terms.paymentDeferralMonths}개월 / ${takeout.terms.interestOnlyMonths}개월`}
                />
                <OvItem
                  l="최대 연 정기상환"
                  v={won(takeout.maximumAnnualDebtServiceManwon ?? 0)}
                />
                <OvItem l="계약 만기 balloon" v={won(takeout.maturityBalloonManwon ?? 0)} />
                <OvItem l="보유 전환시 잔존 PF" v={won(takeout.pfBalanceToRefinanceManwon)} />
                <OvItem
                  l="재융자 차이"
                  v={
                    (takeout.refinanceShortfallManwon ?? 0) > 0
                      ? `${won(takeout.refinanceShortfallManwon ?? 0)} 부족`
                      : `${won(takeout.refinanceSurplusManwon ?? 0)} 여유`
                  }
                />
              </>
            )}
            <OvItem l="최대 자금노출" v={won(Math.abs(recommended.maxExposure))} />
            <OvItem l="회수기간" v={recommended.paybackMonths != null ? `${recommended.paybackMonths}개월` : "사업기간 내 미회수"} />
            <OvItem l="세전 원장 포함 취득세" v={won(acquisitionTax)} />
          </div>
          <p style={{ margin: "10px 0 0", color: "var(--neg-fg)", fontSize: 10, lineHeight: 1.5 }}>
            취득세 반영액은 세전 사업비에 이미 포함되어 세후 원장에서 다시 차감하지 않습니다. 0원인 취득세·부대비·명도비·PF 수수료·신탁비는 면제 확인이 아니라면 총사업비 누락입니다.
          </p>
          {takeout && takeout.status !== "not-applicable" && (
            <p style={{ margin: "7px 0 0", color: "var(--warn-fg)", fontSize: 10, lineHeight: 1.5 }}>
              장기대출 DSCR은 안정화 NOI를 계약기간 중 최대 연간 정기 원리금으로 나눈 심사값이며 만기 balloon은 제외합니다. DSRA는 PF 상환이나 배당에 쓸 수 없는 제한현금입니다. 위 손익·IRR은 임대 안정화 후 자산 매각을 가정하며, 장기 보유를 설정한 경우 아래 별도 원장에만 대출 실행과 보유기간 현금흐름을 반영합니다.
            </p>
          )}
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">
            전문가 세후 원장 · {baseAfterTax.modelVersion}
          </div>
          <div className="rpt-ov">
            <OvItem
              l="안정화 매각 세무 상태"
              v={
                baseAfterTax.status === "expert-confirmed"
                  ? "전문가 확인"
                  : baseAfterTax.status === "draft"
                    ? "초안"
                    : baseAfterTax.status === "stale"
                      ? "기준 변경 · 재확인"
                    : baseAfterTax.status === "invalid"
                      ? "계약 오류"
                      : "미완료"
              }
            />
            <OvItem
              l="세후 손익"
              v={
                baseAfterTax.afterTaxProfitManwon == null
                  ? "N/A"
                  : won(baseAfterTax.afterTaxProfitManwon)
              }
            />
            <OvItem
              l="세후 IRR"
              v={
                baseAfterTax.irrStatus === "calculated" &&
                baseAfterTax.irrPct != null
                  ? `${baseAfterTax.irrPct.toFixed(1)}%`
                  : "N/A"
              }
            />
            <OvItem
              l="세후 NPV"
              v={
                baseAfterTax.npvManwon == null
                  ? "N/A"
                  : won(baseAfterTax.npvManwon)
              }
            />
            <OvItem
              l="증분 세금 납부"
              v={
                baseAfterTax.grossIncrementalTaxPaymentsManwon == null
                  ? "N/A"
                  : won(baseAfterTax.grossIncrementalTaxPaymentsManwon)
              }
            />
            <OvItem
              l="세금 환급"
              v={
                baseAfterTax.grossIncrementalTaxRefundsManwon == null
                  ? "N/A"
                  : won(baseAfterTax.grossIncrementalTaxRefundsManwon)
              }
            />
          </div>
          <p
            style={{
              margin: "10px 0 0",
              color: baseAfterTax.decisionGrade
                ? "var(--pos-fg)"
                : "var(--neg-fg)",
              fontSize: 10,
              lineHeight: 1.5,
            }}
          >
            {baseAfterTax.decisionGrade
              ? "세목별 납부·환급 일정, 작성자와 원문이 연결된 전문가 확인 값입니다."
              : "세무 전문가 계약이 완결되지 않아 표시된 세후 값은 투자 확정 판단에 사용할 수 없습니다."}
            {baseAfterTax.errors.length > 0
              ? ` ${baseAfterTax.errors.join(" ")}`
              : ""}
          </p>
          {baseAfterTax.rows.some(
            (row) => row.taxPayment > 0 || row.taxRefund > 0
          ) && (
            <table className="rpt-table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>납부·환급 월</th>
                  <th className="num">납부</th>
                  <th className="num">환급</th>
                  <th className="num">세후 자기자본 CF</th>
                  <th className="num">세후 누적</th>
                </tr>
              </thead>
              <tbody>
                {baseAfterTax.rows
                  .filter((row) => row.taxPayment > 0 || row.taxRefund > 0)
                  .map((row) => (
                    <tr key={row.month}>
                      <td>{row.month}개월차</td>
                      <td className="num">{won(row.taxPayment)}</td>
                      <td className="num">{won(row.taxRefund)}</td>
                      <td className="num">{won(row.afterTaxEquityCashFlow)}</td>
                      <td className="num">
                        {won(row.cumulativeAfterTaxEquityCashFlow)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>

        {holdConfigured && hold && (
          <div className="rpt-sec">
            <div className="rpt-sec-h">장기 보유 대안 원장 · {hold.modelVersion}</div>
            {!holdCalculated ? (
              <p style={{ margin: 0, color: "var(--neg-fg)", fontSize: 10.5, lineHeight: 1.55 }}>
                {hold.warnings.join(" ")}
              </p>
            ) : (
              <>
                <div className="rpt-ov">
                  <OvItem l="보유 전략" v={hold.strategyMode === "mixed-sale-lease" ? "매각+임대보유" : "전부 임대보유"} />
                  <OvItem l="개발단계 유지 매각대금" v={won(hold.developmentSaleRevenueManwon ?? 0)} />
                  <OvItem l="보유 전환 임대자산" v={won(hold.retainedLeaseValueManwon ?? 0)} />
                  <OvItem l="개발+보유 기간" v={`${recommended.timeline + hold.holdMonths}개월`} />
                  <OvItem l="개발+보유 세전손익" v={won(hold.profitManwon ?? 0)} />
                  <OvItem l="보유안 세전 IRR" v={hold.irrStatus === "calculated" && hold.irrPct != null ? `${hold.irrPct.toFixed(1)}%` : "N/A"} />
                  <OvItem l="보유안 NPV" v={won(hold.npvManwon ?? 0)} />
                  <OvItem l="Equity Multiple" v={`${(hold.equityMultiple ?? 0).toFixed(2)}×`} />
                  <OvItem l="최저 연 DSCR" v={hold.minimumAnnualDscr == null ? "N/A" : hold.minimumAnnualDscr.toFixed(2)} />
                  <OvItem l="최종 매각가" v={won(hold.exitSaleGrossManwon ?? 0)} />
                  <OvItem l="종료 대출상환" v={won(hold.exitLoanPayoffManwon ?? 0)} />
                  <OvItem l="초기 TI" v={won(hold.initialTenantImprovementManwon ?? 0)} />
                  <OvItem l="임대 중개수수료" v={won(hold.initialLeasingCommissionManwon ?? 0)} />
                  <OvItem l="제한 보증금" v={won(hold.securityDepositManwon ?? 0)} />
                  <OvItem l="최대 제한 보증금" v={won(hold.maximumSecurityDepositManwon ?? 0)} />
                  <OvItem l="임대차 만기 이벤트" v={`${hold.tenantRolloverEvents?.length ?? 0}회`} />
                  <OvItem l="교체 공실 손실" v={won(hold.totalRolloverDowntimeLossManwon ?? 0)} />
                  <OvItem l="교체 TI" v={won(hold.totalReplacementTenantImprovementManwon ?? 0)} />
                  <OvItem l="교체 중개수수료" v={won(hold.totalReplacementLeasingCommissionManwon ?? 0)} />
                  <OvItem l="최초 DSRA" v={won(hold.initialDsraManwon ?? 0)} />
                  <OvItem l="DSRA 사용" v={won(hold.totalDsraDrawManwon ?? 0)} />
                  <OvItem l="자본화 이자" v={won(hold.totalTakeoutCapitalizedInterestManwon ?? 0)} />
                  <OvItem
                    l="계약 balloon"
                    v={`${won(hold.totalTakeoutBalloonManwon ?? 0)}${hold.balloonPaymentMonth == null ? "" : ` · ${hold.balloonPaymentMonth}개월차`}`}
                  />
                  <OvItem l="누적 교체 준비금" v={won(hold.totalReplacementReserveManwon ?? 0)} />
                  {holdAfterTax && (
                    <>
                      <OvItem
                        l="보유안 세무 상태"
                        v={
                          holdAfterTax.decisionGrade
                            ? "전문가 확인"
                            : "미완료"
                        }
                      />
                      <OvItem
                        l="보유안 세후손익"
                        v={
                          holdAfterTax.afterTaxProfitManwon == null
                            ? "N/A"
                            : won(holdAfterTax.afterTaxProfitManwon)
                        }
                      />
                      <OvItem
                        l="보유안 세후 IRR"
                        v={
                          holdAfterTax.irrStatus === "calculated" &&
                          holdAfterTax.irrPct != null
                            ? `${holdAfterTax.irrPct.toFixed(1)}%`
                            : "N/A"
                        }
                      />
                      <OvItem
                        l="보유안 순 증분 세금"
                        v={
                          holdAfterTax.netIncrementalTaxManwon == null
                            ? "N/A"
                            : won(holdAfterTax.netIncrementalTaxManwon)
                        }
                      />
                    </>
                  )}
                </div>
                <div className="rpt-table-scroll" style={{ marginTop: 10 }}>
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>연차</th>
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
                <p style={{ margin: "8px 0 0", color: "var(--warn-fg)", fontSize: 9.5, lineHeight: 1.55 }}>
                  이 원장은 안정화 매각 기본 지표와 분리된 임대자산 보유 대안이며 공통 Pareto 비교에 포함하지 않습니다. 혼합안의 매각대금은 개발 원장에 유지하고 남은 임대자산만 보유합니다. 임차 교체는 가중 평균 만기마다 전체 면적이 동시에 만기되는 기대값입니다. 보증금과 DSRA는 제한현금으로 기록하고 투자자 배당에 사용하지 않습니다. DSRA 순적립은 적립을 양수, 사용·회수를 음수로 표시하며 정기 원리금 부족에만 사용합니다. 만기 balloon은 연 DSCR에서 제외하고 발생월 자기자본 현금흐름에서 별도 상환합니다. 임차인별 비동기 만기·중도해지·대손과 재산세·반복 보험료는 미반영입니다.
                </p>
              </>
            )}
          </div>
        )}

        <ConstructionCostSensitivityTable sensitivity={constructionCostSensitivity} />

        <div className="rpt-sec">
          <div className="rpt-sec-h">분기별 현금흐름 · {PROJECT_LEDGER_MODEL_VERSION}</div>
          <table className="rpt-table">
            <thead><tr><th>분기</th><th>단계</th><th className="num">유출</th><th className="num">유입</th><th className="num">순현금</th><th className="num">누적</th></tr></thead>
            <tbody>
              {data.pfSchedule.map((row) => (
                <tr key={row.quarter}>
                  <td>{row.quarter}</td><td>{row.phase}</td>
                  <td className="num">{won(row.outflow)}</td><td className="num">{won(row.inflow)}</td>
                  <td className="num">{won(row.net)}</td><td className="num">{won(row.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: "8px 0 0", color: "var(--fg-muted)", fontSize: 9.5 }}>
            주거 분양만 10/60/30 예비 회수 일정을 사용합니다. 단독·다가구 통매각과 상가·업무 매각은 종료 시 회수하고, 임대 자산가치는 안정화 기간 이후 회수합니다. 실제 계약금·중도금·잔금과 PF 상환순서로 교체해야 합니다.
          </p>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">법규 수치 근거</div>
          <div style={{ marginBottom: 10, fontSize: 10.5, lineHeight: 1.55, color: "var(--fg-muted)" }}>
            VWorld는 용도지역·중첩 규제 명칭의 관측 출처입니다. 건폐율·용적률·높이 숫자는 아래 원문 상태가
            <strong> 원문 확인</strong> 또는 <strong>전문가 승인</strong>일 때만 법규 판정에 사용합니다.
          </div>
          <div className="rpt-table-scroll">
          <table className="rpt-table rpt-regulatory-table">
            <thead>
              <tr>
                <th>항목</th><th>값</th><th>근거 상태</th><th>원문·확인 정보</th>
              </tr>
            </thead>
            <tbody>
              <RegulatoryEvidenceRow label="건폐율" evidence={parcel.regulatoryConstraints?.bcr} />
              <RegulatoryEvidenceRow label="용적률" evidence={parcel.regulatoryConstraints?.far} />
              <RegulatoryEvidenceRow label="최고높이" evidence={parcel.regulatoryConstraints?.height} />
              <RegulatoryEvidenceRow label="층수 제한" evidence={parcel.regulatoryConstraints?.floors} />
              <tr>
                <td>주차</td>
                <td>
                  {parkingRequirementContract
                    ? parkingRequirementContract.basis.join(" · ")
                    : derivedParkingRequirement
                      ? `${derivedParkingRequirement.requiredCars}대 필요 · ${derivedParkingRequirement.basis}`
                      : "계획안 주차 산정 결과 없음"}
                </td>
                <td>
                  {parkingRequirementContract
                    ? parkingRequirementContract.decisionGrade
                      ? "원문·입력 확인"
                      : "예비값"
                    : derivedParkingRequirement?.decisionGrade
                      ? "원문·입력 확인"
                      : derivedParkingRequirement
                        ? "예비값"
                        : "미확인"}
                </td>
                <td>
                  {parkingRule
                    ? `${parkingRule.jurisdictionName} · ${parkingRule.id} · 시행 ${parkingRule.effectiveFrom}`
                    : "관할 조례·적용일 확인 필요"}
                  {parkingWarnings.length > 0
                    ? ` · ${parkingWarnings.join(" · ")}`
                    : null}
                  {parkingSource && (
                    <>
                      {" · "}
                      <a
                        href={parkingSource.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        원문
                      </a>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <td>정북일조</td>
                <td>
                  {sunlightAssessment.north.applicability === "not-applicable"
                    ? sunlightAssessment.north.basis.join(" · ")
                    : sunlightAssessment.north.effectiveDistanceM != null
                      ? sunlightAssessment.north.effectiveDistanceM.toFixed(1) +
                        "m 필요" +
                        (sunlightAssessment.north.actualDistanceM != null
                          ? " · 계획 " +
                            sunlightAssessment.north.actualDistanceM.toFixed(1) +
                            "m"
                          : "")
                      : "적용 조건 확인 필요"}
                </td>
                <td>
                  {sunlightAssessment.north.applicability === "not-applicable"
                    ? sunlightAssessment.north.requirementDecisionGrade
                      ? "원문·조건 확인"
                      : "예비 미적용"
                    : sunlightAssessment.north.complianceDecisionGrade
                      ? sunlightAssessment.north.compliant
                        ? "배치 충족"
                        : "배치 부족"
                      : "배치거리 미확인"}
                </td>
                <td>
                  {sunlightAssessment.rule.jurisdictionName +
                    " · " +
                    sunlightAssessment.rule.id +
                    " · 시행 " +
                    sunlightAssessment.rule.effectiveFrom}
                  {sunlightAssessment.north.warnings[0]
                    ? " · " + sunlightAssessment.north.warnings[0]
                    : null}
                  {sunlightSource && (
                    <>
                      {" · "}
                      <a
                        href={sunlightSource.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        원문
                      </a>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <td>채광·동간거리</td>
                <td>
                  {sunlightAssessment.daylight.applicability === "not-applicable"
                    ? sunlightAssessment.daylight.basis.join(" · ")
                    : sunlightAssessment.daylight.basis.join(" · ") ||
                      "세부 용도·창 방향 확인 필요"}
                </td>
                <td>
                  {sunlightAssessment.daylight.applicability === "not-applicable"
                    ? sunlightAssessment.daylight.decisionGrade
                      ? "미적용 확인"
                      : "예비 미적용"
                    : sunlightAssessment.daylight.decisionGrade
                      ? "법정식 확인·배치 미확인"
                      : "세부용도·배치 확인 필요"}
                </td>
                <td>
                  {"건축법 제61조·시행령 제86조 · " +
                    sunlightAssessment.rule.id}
                  {sunlightAssessment.daylight.warnings[0]
                    ? " · " + sunlightAssessment.daylight.warnings[0]
                    : null}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        {/* 시나리오 비교 */}
        <div className="rpt-sec">
          <div className="rpt-sec-h">시나리오 다목적 비교</div>
          <p style={{ color: "var(--fg-muted)", fontSize: 10.5, lineHeight: 1.5 }}>
            {decisionSupport
              ? `가중 합산 없이 ${decisionSupport.paretoScenarioIds.length}개 파레토 후보를 보존합니다. 세전손익·고원가 손익·NPV·IRR·필요 자기자본·최대 자금노출·기간·법규를 각각 비교하며, 임대형에만 적용되는 장기대출 DSCR은 공통 순위에서 제외합니다.`
              : "이전 저장본에는 다목적 비교 계약이 없습니다. 현재 대표안과 개별 지표만 표시합니다."}
          </p>
          {decisionSupport?.warnings
            .filter((warning) => warning.includes("용도지역 스크리닝"))
            .map((warning) => (
              <p key={warning} style={{ color: "var(--warn-fg)", fontSize: 10.5, lineHeight: 1.5 }}>
                {warning}
              </p>
            ))}
          <div className="rpt-table-scroll">
            <table className="rpt-table rpt-scenario-table">
              <thead>
                <tr>
                  <th>시나리오</th>
                  <th className="num">세전 손익</th>
                  <th className="num">이익률</th>
                  <th className="num">세전 IRR</th>
                  <th className="num">장기대출 DSCR</th>
                  <th>판정</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => {
                  const unfit = !scenarioViable(s).ok;
                  const decisionEntry = decisionSupport?.entries.find(
                    (entry) => entry.scenarioId === s.id,
                  );
                  const decisionRole = decisionEntry
                    ? decisionEntry.status === "pareto"
                      ? "파레토 후보"
                      : decisionEntry.status === "dominated"
                        ? "비교 열위"
                        : "비교 제외"
                    : s.recommended
                      ? "비교 기준"
                      : "비교";
                  const leaderLabels = decisionEntry?.leaderObjectives
                    .map(reportDecisionObjectiveLabel)
                    .join(" · ");
                  return (
                    <tr key={s.id} className={s.recommended ? "rpt-reco-row" : ""}>
                      <td>{s.shortName} {s.name}{s.recommended ? " ★" : ""}</td>
                      {unfit ? (
                        <td className="rpt-unfit" colSpan={4}>{scenarioViable(s).label} — {s.viabilityNote ?? "이 규모로는 수익이 비용을 밑돕니다"}</td>
                      ) : (
                        <>
                          <td className="num">{won(s.profit)}</td>
                          <td className="num">{s.profitMargin.toFixed(1)}%</td>
                          <td className="num">{s.irrStatus === "calculated" ? `${s.irr.toFixed(1)}%` : "N/A"}</td>
                          <td className="num">{s.dscrStatus === "takeout-amortizing" ? s.dscr.toFixed(2) : "N/A"}</td>
                        </>
                      )}
                      <td style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                        {unfit ? "비교 제외" : decisionRole}
                        {s.recommended ? " · 대표안" : ""}
                        {leaderLabels ? ` · ${leaderLabels}` : ""}
                        {decisionEntry?.exclusionReasons[0]
                          ? ` · ${decisionEntry.exclusionReasons[0]}`
                          : ""}
                        {decisionEntry?.advisoryReasons?.[0]
                          ? ` · 확인 필요: ${decisionEntry.advisoryReasons[0]}`
                          : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {afterTaxDecisionSupport && (
            <>
              <div className="rpt-sec-h" style={{ marginTop: 18 }}>
                전문가 확인 세후 비교 · 안정화 매각
              </div>
              <p style={{ color: "var(--fg-muted)", fontSize: 10.5, lineHeight: 1.5 }}>
                전체 {scenarios.length}개 중 전문가 확인 후 비교 적격 {afterTaxDecisionSupport.confirmedEligibleScenarioCount}개를 확정 집합으로 비교해 Pareto 후보 {afterTaxDecisionSupport.confirmedParetoScenarioIds.length}개를 보존합니다. 비교 적격 완결 초안 {afterTaxDecisionSupport.preliminaryEligibleScenarioCount}개는 별도 예비 집합이며 확정 후보와 섞지 않습니다. 세전 현금흐름 기준이 달라진 세무 확인은 자동 제외됩니다.
              </p>
              <div className="rpt-table-scroll">
                <table className="rpt-table rpt-scenario-table">
                  <thead>
                    <tr>
                      <th>시나리오</th>
                      <th>세무 근거</th>
                      <th className="num">세후 손익</th>
                      <th className="num">세후 NPV</th>
                      <th className="num">세후 IRR</th>
                      <th>세후 판정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map((scenario) => {
                      const entry = afterTaxDecisionSupport.entries.find(
                        (candidate) => candidate.scenarioId === scenario.id,
                      );
                      const showMetrics =
                        entry?.tier === "confirmed" ||
                        entry?.tier === "preliminary";
                      const role = !entry
                        ? "미산정"
                        : entry.tier === "confirmed"
                          ? entry.status === "pareto"
                            ? "확정 Pareto"
                            : entry.status === "dominated"
                              ? "확정 비교 열위"
                              : "확정 비교 제외"
                          : entry.tier === "preliminary"
                            ? entry.status === "pareto"
                              ? "초안 Pareto"
                              : entry.status === "dominated"
                                ? "초안 비교 열위"
                                : "초안 비교 제외"
                            : "세후 미산정";
                      const leaders = entry?.leaderObjectives
                        .map(reportAfterTaxObjectiveLabel)
                        .join(" · ");
                      return (
                        <tr key={`after-tax-${scenario.id}`}>
                          <td>{scenario.shortName} {scenario.name}</td>
                          <td>
                            {entry?.tier === "confirmed"
                              ? "전문가 확인"
                              : entry?.tier === "preliminary"
                                ? "완결 초안"
                                : "미확정"}
                          </td>
                          <td className="num">
                            {showMetrics && entry?.metrics.afterTaxProfitManwon != null
                              ? won(entry.metrics.afterTaxProfitManwon)
                              : "—"}
                          </td>
                          <td className="num">
                            {showMetrics && entry?.metrics.npvManwon != null
                              ? won(entry.metrics.npvManwon)
                              : "—"}
                          </td>
                          <td className="num">
                            {showMetrics && entry?.metrics.irrPct != null
                              ? `${entry.metrics.irrPct.toFixed(1)}%`
                              : "—"}
                          </td>
                          <td style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                            {role}
                            {leaders ? ` · ${leaders}` : ""}
                            {entry?.reasons[0] ? ` · ${entry.reasons[0]}` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">실거래 비교 근거</div>
          {comps.length > 0 ? (
            <>
              <p style={{ color: "var(--fg-muted)", fontSize: 10.5 }}>
                국토교통부 실거래 {comps.length}건 · 중앙값 평당 {compsMedian != null ? num(compsMedian) : "—"}만원. 아래는 최근 비교자료 최대 12건이며 감정평가나 매각 확정가가 아닙니다.
              </p>
              <table className="rpt-table">
                <thead><tr><th>계약일</th><th>소재지·유형</th><th className="num">면적</th><th className="num">거래금액</th><th className="num">평당</th><th className="num">거리</th></tr></thead>
                <tbody>
                  {comps.slice(0, 12).map((comp) => (
                    <tr key={comp.id}>
                      <td>{comp.date}</td>
                      <td>{comp.address} · {comp.type}</td>
                      <td className="num">{num(Math.round(comp.lotArea * 10) / 10)}㎡</td>
                      <td className="num">{won(Math.round(comp.priceWon / 10_000))}</td>
                      <td className="num">{num(comp.pricePerPyeong)}만/평</td>
                      <td className="num">{comp.distanceKm != null ? `${comp.distanceKm.toFixed(1)}km` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p style={{ color: "var(--neg-fg)", fontSize: 11 }}>채택 가능한 실거래 비교자료가 없습니다. MOLIT 키·법정동·조회기간을 확인하세요.</p>
          )}
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">계산 입력 근거자료 · {sourceGate.validRecords.length}/{sourceGate.requiredFields.length}건 확정</div>
          <table className="rpt-table">
            <thead><tr><th>입력 항목</th><th className="num">적용값</th><th>상태</th><th>발급기관·원문·기준일·확인자</th></tr></thead>
            <tbody>
              {sourceGate.requiredFields.map((field) => {
                const record = financialSources[field];
                const invalid = sourceGate.invalidFields.find((item) => item.field === field);
                const status = sourceGate.validRecords.some((item) => item.field === field)
                  ? "확정"
                  : record
                    ? "원문 확인"
                    : "미등록";
                return (
                  <tr key={field}>
                    <td>{FINANCIAL_SOURCE_FIELD_META[field].label}</td>
                    <td className="num">
                      {record ? `${num(record.value)} ${FINANCIAL_SOURCE_FIELD_META[field].unit}` : "—"}
                    </td>
                    <td>{status}</td>
                    <td style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                      {record
                        ? [record.sourceName, record.documentRef, record.asOf, record.verifiedBy, invalid?.errors.join(" / ")].filter(Boolean).join(" · ")
                        : "실제 계약서·견적서·Term Sheet·감정평가 또는 승인 원문 필요"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">리스크·미확인 사항</div>
          <table className="rpt-table">
            <thead><tr><th>항목</th><th>수준</th><th>판정·다음 확인</th><th>참고</th></tr></thead>
            <tbody>
              {data.parcelRisks.map((risk) => (
                <tr key={risk.code}>
                  <td>{risk.label}</td><td>{risk.levelLabel}</td>
                  <td style={{ whiteSpace: "normal", lineHeight: 1.45 }}>{risk.note}</td>
                  <td>{risk.reference ?? "—"}</td>
                </tr>
              ))}
              {evidenceGate.lanes.flatMap((lane) =>
                lane.items.filter((item) => item.status === "missing").map((item) => (
                  <tr key={item.id}>
                    <td>{item.label}</td><td>미확인{item.critical ? " · 필수" : ""}</td>
                    <td style={{ whiteSpace: "normal", lineHeight: 1.45 }}>{item.nextAction}</td>
                    <td>{lane.title}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">전문가 인계·승인 기록</div>
          <table className="rpt-table">
            <thead><tr><th>분야</th><th>상태</th><th>담당자·소속</th><th>근거·검토일</th><th>메모</th></tr></thead>
            <tbody>
              {reviewSummary.requiredDisciplines.map((discipline) => {
                const review = expertReviews[discipline];
                return (
                  <tr key={discipline}>
                    <td>{DISCIPLINE_LABEL[discipline]}</td>
                    <td>{reviewSummary.staleDisciplines.includes(discipline) ? "재검토 필요" : REVIEW_STATUS_LABEL[review?.status ?? "not-requested"]}</td>
                    <td>
                      {review
                        ? [
                            review.reviewer,
                            review.organization,
                            review.reviewerRole
                              ? EXPERT_REVIEWER_ROLE_META[review.reviewerRole]
                                  ?.label
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "미배정"
                        : "미배정"}
                    </td>
                    <td>
                      {review
                        ? [
                            review.requestedBy
                              ? `요청 ${review.requestedBy} ${review.requestedAt ?? ""}`
                              : null,
                            review.evidenceRef,
                            review.reviewedAt,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "—"}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{review?.notes || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="rpt-stage-grid">
            {evidenceGate.lanes.map((lane) => (
              <div key={lane.discipline}>
                <strong>{lane.title}</strong>
                {lane.items.map((item) => (
                  <span key={item.id}>{EVIDENCE_STATUS_LABEL[item.status]} · {item.label}</span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">공공데이터·모델 출처와 연결 상태</div>
          <table className="rpt-table">
            <thead><tr><th>출처</th><th>이 보고서에서 사용</th><th>상태</th><th>한계</th></tr></thead>
            <tbody>
              <tr><td>V월드</td><td>필지 경계·공시지가·용도지역·도로 참고선</td><td>{parcel.inputProvenance?.geometry === "vworld-cadastral" ? "VWorld 경계" : parcel.inputProvenance?.geometry === "user-geojson" ? "사용자 GeoJSON" : hasParcelBoundary(parcel) ? "경계 보유 · 출처 미확인" : "미확보"}</td><td>도로 중심선은 도로 폭·현황측량이 아님</td></tr>
              <tr><td>국토교통부 실거래가</td><td>비교거래·가격 참고</td><td>{comps.length > 0 ? `${comps.length}건` : "미조회"}</td><td>지번 비식별·상품 차이·신고 지연 가능</td></tr>
              <tr><td>건축HUB 건축물대장</td><td>기존 건물·층수·면적·사용승인</td><td>{buildingRegistryLabel(currentBuilding)}</td><td>현장 상태·위반건축물·권리관계 별도 확인</td></tr>
              <tr><td>Kakao Local</td><td>주소 정규화·좌표·주변 거리</td><td>{parcel.lat && parcel.lng ? "좌표 보유 · 원문 확인 필요" : "미확보"}</td><td>법적 경계나 측량성과가 아님</td></tr>
              <tr><td>ParcelGrid 금융 원장</td><td>손익·PF·IRR·분기 현금흐름</td><td>{PROJECT_LEDGER_MODEL_VERSION}</td><td>금융기관 약정과 세무조정 전 예비 모델</td></tr>
              <tr><td>OpenAI Image API</td><td>기준 이미지 기반 외장 콘셉트</td><td>선택 기능</td><td>형상 보존은 생성 후 원본과 육안 대조 필요</td></tr>
            </tbody>
          </table>
        </div>

        <div className="rpt-foot">
          <span>Double Edge · ParcelGrid v2.4</span>
          <span>예비 비교용 — 매입·대출·세무 의사결정 전 전문가 검토 필수</span>
        </div>
      </div>

      <style jsx>{`
        .rpt-reco-kpi{min-width:0;overflow-wrap:anywhere}.rpt-reco-kpi .l,.rpt-reco-kpi .v{letter-spacing:0}
        .rpt-two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px}
        .rpt-reconciliation{display:grid;grid-template-columns:1fr auto 1fr auto;gap:10px;align-items:center;margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-soft);font-size:10px}.rpt-reconciliation strong{color:var(--pos-fg)}
        .rpt-stage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.rpt-stage-grid>div{display:grid;gap:4px;padding:10px;border:1px solid var(--border-faint);border-radius:7px}.rpt-stage-grid strong{font-size:10px}.rpt-stage-grid span{font-size:9px;color:var(--fg-muted)}
        .rpt-table-scroll{width:100%;overflow-x:auto}.rpt-regulatory-table{min-width:720px}.rpt-regulatory-table th:first-child,.rpt-regulatory-table td:first-child{width:84px;white-space:nowrap}.rpt-regulatory-table th:nth-child(2),.rpt-regulatory-table td:nth-child(2){min-width:150px}.rpt-regulatory-table th:nth-child(3),.rpt-regulatory-table td:nth-child(3){width:110px;white-space:nowrap}.rpt-regulatory-table th:nth-child(4),.rpt-regulatory-table td:nth-child(4){min-width:310px}
        .rpt-scenario-table{min-width:760px}.rpt-scenario-table th:first-child,.rpt-scenario-table td:first-child{min-width:145px}.rpt-scenario-table th:nth-child(n+2):nth-child(-n+5),.rpt-scenario-table td.num{min-width:68px;white-space:nowrap}.rpt-scenario-table th:last-child,.rpt-scenario-table td:last-child{min-width:260px}
        @media(max-width:760px){.rpt-two-col,.rpt-stage-grid{grid-template-columns:1fr}.rpt-reconciliation{grid-template-columns:1fr auto}}
        @media print{.rpt-two-col{grid-template-columns:1fr 1fr}.rpt-stage-grid{grid-template-columns:1fr 1fr}.rpt-sec{break-inside:auto}.rpt-table{break-inside:auto}.rpt-table-scroll{overflow:visible}.rpt-regulatory-table,.rpt-scenario-table{min-width:0}}
      `}</style>

      {/* 인쇄 버튼 (화면에만, 인쇄 시 숨김) */}
      <div className="rpt-actions">
        <button className="ui-btn ui-btn--primary" disabled={verificationWork.status !== "ready"} onClick={() => window.print()}>
          PDF로 저장 / 인쇄
        </button>
      </div>
    </div>
  );
}

function reportDecisionObjectiveLabel(
  objective: ScenarioDecisionObjective,
): string {
  switch (objective) {
    case "profit":
      return "손익 선두";
    case "downside-profit":
      return "고원가 방어 선두";
    case "npv":
      return "NPV 선두";
    case "irr":
      return "IRR 선두";
    case "required-equity":
      return "자기자본 최소";
    case "max-exposure":
      return "노출 최소";
    case "duration":
      return "기간 최소";
    case "regulatory":
      return "법규 점수 선두";
  }
}

function reportAfterTaxObjectiveLabel(
  objective: AfterTaxDecisionObjective,
): string {
  switch (objective) {
    case "after-tax-profit":
      return "세후 손익 선두";
    case "after-tax-npv":
      return "세후 NPV 선두";
    case "after-tax-irr":
      return "세후 IRR 선두";
    case "required-equity":
      return "자기자본 최소";
    case "max-exposure":
      return "노출 최소";
    case "duration":
      return "기간 최소";
    case "regulatory":
      return "법규 점수 선두";
  }
}

function RegulatoryEvidenceRow({
  label,
  evidence,
}: {
  label: string;
  evidence?: RegulatoryConstraintEvidence;
}) {
  const value =
    evidence?.value != null ? `${num(evidence.value)}${evidence.unit}` : "미확인";
  const source = evidence
    ? [
        evidence.sourceName,
        evidence.sourceRef,
        evidence.asOf ? `기준일 ${evidence.asOf}` : null,
        evidence.checkedBy
          ? `확인 ${evidence.checkedBy}${evidence.checkedRole ? `(${evidence.checkedRole})` : ""}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "원문 미등록";
  return (
    <tr>
      <td>{label}</td>
      <td>{value}</td>
      <td>{constraintStatusLabel(evidence?.status ?? "unknown")}</td>
      <td style={{ maxWidth: 380, whiteSpace: "normal", lineHeight: 1.45 }}>{source}</td>
    </tr>
  );
}

function MoneyRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <tr style={strong ? { fontWeight: 800 } : undefined}>
      <td>{label}</td>
      <td className="num">{won(value)}</td>
    </tr>
  );
}

function OvItem({ l, v }: { l: string; v: string }) {
  return (
    <div className="rpt-ov-item">
      <span className="rpt-ov-l">{l}</span>
      <span className="rpt-ov-v">{v}</span>
    </div>
  );
}
