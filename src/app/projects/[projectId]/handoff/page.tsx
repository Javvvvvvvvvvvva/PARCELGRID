"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { ProjectTransferPanel } from "@/components/handoff/ProjectTransferPanel";
import { IntegratedVerificationPanel } from "@/components/handoff/IntegratedVerificationPanel";
import { verificationApprovalBlockers } from "@/lib/handoff/integrated-verification";
import { useReviewVerification } from "@/lib/hooks/use-review-verification";
import type { ReviewVerificationRequest } from "@/lib/handoff/review-verification-task";
import { ReviewVerificationStatus } from "@/components/handoff/ReviewVerificationStatus";
import { PROJECT_LEDGER_MODEL_VERSION } from "@/lib/finance/project-ledger";
import {
  buildAfterTaxLedger,
  buildExpertTaxContractKey,
} from "@/lib/finance/after-tax-ledger";
import {
  buildSourceDataGate,
  validateFinancialSourceEvidence,
  type FinancialSourceMap,
} from "@/lib/finance/source-data-gate";
import type {
  PriceVerificationRecord,
  PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import { coreRegulatoryConstraintsVerified } from "@/lib/regulatory/constraints";
import {
  buildEvidenceGate,
  buildHandoffBrief,
  type EvidenceItem,
  type EvidenceStatus,
  type HandoffDiscipline,
} from "@/lib/handoff/evidence-gate";
import {
  EXPERT_REVIEWER_ROLE_META,
  buildExpertReviewSummary,
  validateExpertReviewTransition,
  type ExpertReviewAttestations,
  type ExpertReviewMap,
  type ExpertReviewRecord,
  type ExpertReviewerRole,
  type ExpertReviewStatus,
} from "@/lib/handoff/review-workflow";
import {
  validateReviewSnapshotAlignment,
} from "@/lib/handoff/review-snapshot";
import {
  principalHasCapability,
  useAccessSession,
  type PublicAccessPrincipal,
} from "@/lib/hooks/use-access-session";
import {
  useProjectReviewLedger,
  type ProjectReviewTransitionRequest,
} from "@/lib/hooks/use-project-review-ledger";
import { useProjectReviewSnapshot } from "@/lib/hooks/use-project-review-snapshot";
import {
  ORGANIZATION_ROLE_LABEL,
  reviewerRolesForPrincipalDiscipline,
} from "@/lib/auth/roles";

const STATUS_LABEL: Record<EvidenceStatus, string> = {
  "system-confirmed": "시스템 재현 가능",
  "expert-review": "전문가 확인 필요",
  missing: "근거 필요",
};

const STATUS_COLOR: Record<EvidenceStatus, string> = {
  "system-confirmed": "var(--pos-fg, #28643c)",
  "expert-review": "var(--warn-fg, #8a6300)",
  missing: "var(--neg-fg, #a13c32)",
};

const REVIEW_STATUS_LABEL: Record<ExpertReviewStatus, string> = {
  "not-requested": "미요청",
  requested: "검토 요청",
  "in-review": "검토 중",
  approved: "승인",
  "changes-requested": "수정 요청",
};

const EMPTY_FINANCIAL_SOURCES: FinancialSourceMap = Object.freeze({});
const EMPTY_PRICE_VERIFICATIONS: Partial<
  Record<PriceVerificationTarget, PriceVerificationRecord>
> = Object.freeze({});
const EMPTY_EXPERT_REVIEWS: ExpertReviewMap = Object.freeze({});

export default function HandoffPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const liveData = useProjectStore((state) => state.data);
  const geometry = useProjectStore(
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
  const financialSourceProjects = useProjectStore(
    (state) => state.financialSources
  );
  const allExpertTaxContracts = useProjectStore(
    (state) => state.expertTaxContracts
  );
  const priceVerificationProjects = useReviewStore(
    (state) => state.priceVerifications
  );
  const expertReviewProjects = useReviewStore(
    (state) => state.expertReviews
  );
  const accessSession = useAccessSession();
  const reviewLedger = useProjectReviewLedger(projectId);
  const financialSources =
    financialSourceProjects[projectId] ?? EMPTY_FINANCIAL_SOURCES;
  const priceVerifications =
    priceVerificationProjects[projectId] ?? EMPTY_PRICE_VERIFICATIONS;
  const expertReviews =
    reviewLedger.query.data?.reviews ??
    expertReviewProjects[projectId] ??
    EMPTY_EXPERT_REVIEWS;
  const stage3Snapshot = stage3Snapshots[projectId] ?? null;
  const currentScenario =
    planningScenarios.find(
      (scenario) =>
        scenario.id === representativePlanningScenarioId &&
        (!scenario.projectId || scenario.projectId === projectId)
    ) ?? null;
  const currentGeometry =
    geometry?.projectId === projectId ? geometry : null;
  const snapshotAlignment = useMemo(
    () =>
      validateReviewSnapshotAlignment({
        snapshot: stage3Snapshot,
        geometry: currentGeometry,
        currentScenario,
      }),
    [currentGeometry, currentScenario, stage3Snapshot]
  );
  const data = snapshotAlignment.valid && stage3Snapshot ? stage3Snapshot.data : liveData;
  const representativeFinance =
    data?.scenarios.find((scenario) => scenario.recommended) ??
    data?.scenarios[0] ??
    null;
  const projectTaxContracts = useMemo(
    () =>
      Object.values(allExpertTaxContracts).filter(
        (contract) =>
          contract.projectId === projectId &&
          stage3Snapshot?.data.scenarios.some((scenario) => scenario.id === contract.scenarioId)
      ),
    [allExpertTaxContracts, projectId, stage3Snapshot?.data.scenarios]
  );
  const verificationRequest = useMemo<ReviewVerificationRequest | null>(
    () =>
      snapshotAlignment.valid && stage3Snapshot
        ? { kind: "saved", input: {
            snapshot: stage3Snapshot,
            financialSources,
            priceVerifications,
            expertTaxContracts: projectTaxContracts,
            planningScenario: currentScenario,
            geometry: currentGeometry,
          } }
        : data ? { kind: "preview", input: {
            projectId, representativeScenarioId: currentScenario?.id ?? "unselected",
            representativeScenarioVersion: currentScenario?.version ?? 0,
            geometryHash: currentGeometry?.geometryHash ?? "", data,
            planningScenario: currentScenario, geometry: currentGeometry,
          } } : null,
    [
      financialSources,
      priceVerifications,
      projectTaxContracts,
      snapshotAlignment.valid,
      stage3Snapshot,
      currentScenario,
      currentGeometry,
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
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );

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
  const taxInputComplete = useMemo(() => {
    if (!snapshotAlignment.valid || !representativeFinance) return false;
    const base = buildAfterTaxLedger({
      projectId,
      scenarioId: representativeFinance.id,
      strategy: "stabilized-sale",
      preTaxEquityCashFlowsManwon:
        representativeFinance.equityCashFlowsManwon,
      preTaxAcquisitionTaxManwon: representativeFinance.acquisitionTax,
      equityHurdleRatePct: representativeFinance._raw.assumptions.equityIRR,
      contract:
        allExpertTaxContracts[
          buildExpertTaxContractKey(
            projectId,
            representativeFinance.id,
            "stabilized-sale"
          )
        ],
    });
    const required = [base];
    if ((representativeFinance.hold?.combinedEquityCashFlowsManwon?.length ?? 0) > 0) {
      required.push(
        buildAfterTaxLedger({
          projectId,
          scenarioId: representativeFinance.id,
          strategy: "long-term-hold",
          preTaxEquityCashFlowsManwon:
            representativeFinance.hold.combinedEquityCashFlowsManwon,
          preTaxAcquisitionTaxManwon: representativeFinance.acquisitionTax,
          equityHurdleRatePct:
            representativeFinance._raw.assumptions.equityIRR,
          contract:
            allExpertTaxContracts[
              buildExpertTaxContractKey(
                projectId,
                representativeFinance.id,
                "long-term-hold"
              )
            ],
        })
      );
    }
    return required.every((ledger) => ledger.decisionGrade);
  }, [allExpertTaxContracts, projectId, representativeFinance, snapshotAlignment.valid]);

  const gate = useMemo(() => {
    if (!data) return null;
    return buildEvidenceGate({
      projectId,
      address: data.parcel.address,
      geometryHash: currentGeometry?.geometryHash ?? null,
      roadReferenceCount: data.parcel.roads?.length ?? 0,
      regulatorySourceBacked: coreRegulatoryConstraintsVerified(
        data.parcel.regulatoryConstraints
      ),
      saleCompCount: data.comps?.length ?? 0,
      transactionEvidence: data.transactionEvidence,
      saleEstimateVersion: data.saleEstimate?.modelVersion ?? null,
      acquisitionEstimateVersion:
        data.parcel.acquisitionEstimate?.modelVersion ?? null,
      financeModelVersion: PROJECT_LEDGER_MODEL_VERSION,
      taxComplete: taxInputComplete,
      hasConstructionQuote: validConstructionQuote,
      hasTermSheet: validTermSheet,
      hasExternalPriceOpinion:
        priceVerifications.acquisition?.status === "verified",
    });
  }, [
    data,
    currentGeometry,
    priceVerifications.acquisition?.status,
    projectId,
    taxInputComplete,
    validConstructionQuote,
    validTermSheet,
  ]);

  const reviewSummary = useMemo(
    () =>
      buildExpertReviewSummary(
        expertReviews,
        reviewSnapshotKey ?? "__missing-current-stage3-snapshot__"
      ),
    [expertReviews, reviewSnapshotKey]
  );

  if (!data || !gate) {
    return <div style={{ padding: 40 }}>전문가 인계 정보를 준비하는 중입니다.</div>;
  }

  const sourceGate = representativeFinance
    ? buildSourceDataGate(representativeFinance._raw, financialSources)
    : null;
  const fundingStatus =
    representativeFinance?.funding?.status ?? "unverified";
  const reviewLedgerVerified = Boolean(
    reviewLedger.query.data?.ledger.integrity.valid,
  );
  const canSealSnapshot = principalHasCapability(
    accessSession.data,
    "review.request",
  );

  const finalReady =
    integratedVerification?.status === "preliminary" &&
    reviewLedgerVerified &&
    snapshotAlignment.valid &&
    Boolean(reviewSnapshotKey) &&
    gate.criticalBlockerCount === 0 &&
    reviewSummary.ready &&
    sourceGate?.status === "source-backed" &&
    fundingStatus === "funded";

  const copyBrief = async () => {
    const reviewLines = gate.lanes.map((lane) => {
      const review = expertReviews[lane.discipline];
      return `${lane.title}: ${review ? REVIEW_STATUS_LABEL[review.status] : "미요청"}${
        review?.reviewer ? ` · ${review.reviewer} (${review.organization})` : ""
      }`;
    });
    try {
      await navigator.clipboard.writeText(
        `${buildHandoffBrief(gate)}\n\n검토 스냅샷: ${reviewSnapshotKey ?? "미생성"}\n\n[통합 검증]\n${integratedVerification?.checks.map((check) => `${check.label} [${check.status}]: ${check.detail}`).join("\n") ?? "미확정"}\n공식 경계·허가·전문 자격 확인: 미확정\n\n[분야별 검토 상태]\n${reviewLines.join("\n")}`
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const statusTitle = finalReady
    ? "현재 저장본의 필수 근거와 분야별 검토 기록이 완료됐습니다"
    : reviewLedger.query.isError
      ? "서버 검토 감사 원장을 확인할 수 없습니다"
      : !reviewLedgerVerified
        ? "서버 검토 감사 원장을 확인하는 중입니다"
    : !snapshotAlignment.valid
      ? "현재 대표안과 일치하는 Stage 3 저장본이 필요합니다"
      : serverSnapshot.query.isError
        ? "서버 검토 Snapshot을 확인할 수 없습니다"
        : !serverSnapshot.currentKey || serverSnapshot.query.isLoading
          ? "현재 계산의 SHA-256을 확인하는 중입니다"
          : !serverSnapshot.sealed
            ? "현재 검토 Snapshot을 서버에 봉인해야 합니다"
      : reviewSummary.staleDisciplines.length > 0
        ? "계획·사업성 또는 근거 변경으로 재승인이 필요합니다"
        : integratedVerification?.status !== "preliminary"
          ? "통합 검증의 누락·충돌을 보완해야 합니다"
        : fundingStatus === "shortfall"
          ? "확인된 자기자본 한도가 필요 금액보다 부족합니다"
          : fundingStatus === "unverified"
            ? "자기자본 확약 한도를 확인해야 합니다"
            : sourceGate?.status !== "source-backed"
              ? "사업성 원장의 필수 비용·금융 근거가 부족합니다"
        : gate.status === "blocked"
          ? "전문가 승인 전에 보완할 필수 근거가 있습니다"
          : "근거는 준비됐고 분야별 전문가 승인이 필요합니다";

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 30px 48px" }}>
      <nav style={{ display: "flex", gap: 8, marginBottom: 20, fontSize: 11, color: "var(--fg-muted)" }}>
        <Link href={`/projects/${projectId}`} style={{ color: "inherit" }}>Stage 3 사업성 검토</Link>
        <span>→</span>
        <Link href={`/projects/${projectId}/price-review`} style={{ color: "inherit" }}>가격 검증</Link>
        <span>→</span><strong style={{ color: "var(--fg)" }}>Stage 4 전문가 검증·인계</strong>
        <span>→</span><Link href={`/projects/${projectId}/report`} style={{ color: "inherit" }}>Stage 5 보고서</Link>
      </nav>

      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "start", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.2em", color: "var(--fg-muted)" }}>STAGE 4 · PROFESSIONAL HANDOFF</div>
          <h1 style={{ margin: "8px 0 6px", fontSize: 27 }}>근거를 분야별 담당자에게 넘기고 승인을 기록합니다</h1>
          <p style={{ margin: 0, maxWidth: 780, color: "var(--fg-muted)", fontSize: 12, lineHeight: 1.65 }}>
            일반 사용자가 검토를 요청하고 분야별 담당자가 같은 스냅샷의 근거와 한계를 확인합니다. 건축·시행·금융세무·보험·분양 다섯 분야가 모두 승인돼야 최종 보고서 단계가 열립니다.
          </p>
        </div>
        <button type="button" onClick={copyBrief} style={buttonStyle}>
          {copyState === "copied" ? "검토 요청서 복사됨" : copyState === "failed" ? "복사 실패" : "검토 요청서 복사"}
        </button>
      </header>

      <section role="status" style={{ padding: "14px 16px", border: `1px solid ${finalReady ? "var(--pos-fg)" : "var(--neg-fg)"}`, borderRadius: 10, background: finalReady ? "var(--pos-soft)" : "rgba(161,60,50,.06)", marginBottom: 16 }}>
        {currentGeometry?.analysisReference && <p style={{ margin: "0 0 8px", fontSize: 12 }}>예비 분석 기준안 · 공식 경계·허가·전문가 승인 미확정 · 채택 시 미확정 항목 {currentGeometry.analysisReference.unresolved.length}건</p>}
        <strong style={{ display: "block", fontSize: 13 }}>{statusTitle}</strong>
        <span style={{ display: "block", marginTop: 4, fontSize: 10.5, color: "var(--fg-muted)" }}>
          필수 근거 미확인 {gate.criticalBlockerCount}건 · 전문가 승인 {reviewSummary.approvedCount}/{reviewSummary.requiredDisciplines.length}개 분야 · 검토 중 {reviewSummary.inReviewCount}건 · 재검토 {reviewSummary.staleDisciplines.length}건 · 수정 요청 {reviewSummary.changesRequestedCount}건
          {reviewLedger.query.data && (
            <><br />감사 원장 {reviewLedger.query.data.ledger.backend === "postgresql" ? "PostgreSQL 불변 저장" : "로컬 append-only"} · 이벤트 {reviewLedger.query.data.ledger.reviewEventCount}건 · 체인 {reviewLedger.query.data.ledger.integrity.lastHash.slice(0, 12)}</>
          )}
          {reviewLedger.query.error && (
            <><br />{reviewLedger.query.error.message}</>
          )}
          {!snapshotAlignment.valid && (
            <><br />{snapshotAlignment.errors.join(" ")}</>
          )}
          {serverSnapshot.query.error && (
            <><br />{serverSnapshot.query.error.message}</>
          )}
        </span>
      </section>

      {snapshotAlignment.valid && (
        <section style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16, background: "var(--bg-elev)" }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", fontSize: 11 }}>
              {serverSnapshot.sealed ? "서버 봉인 완료" : "서버 봉인 대기"}
            </strong>
            <span style={{ display: "block", marginTop: 4, overflowWrap: "anywhere", color: "var(--fg-muted)", fontFamily: "var(--font-mono)", fontSize: 8.5 }}>
              {serverSnapshot.currentKey ?? "SHA-256 계산 중"}
            </span>
            {serverSnapshot.metadata && (
              <span style={{ display: "block", marginTop: 3, color: "var(--fg-muted)", fontSize: 8.5 }}>
                {serverSnapshot.metadata.sealedBy} · {new Date(serverSnapshot.metadata.sealedAt).toLocaleString("ko-KR")} · 감사 {serverSnapshot.metadata.auditHash.slice(0, 12)}
              </span>
            )}
            {serverSnapshot.seal.error && (
              <span role="alert" style={{ display: "block", marginTop: 4, color: "var(--neg-fg)", fontSize: 9 }}>
                {serverSnapshot.seal.error.message}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={
              serverSnapshot.sealed ||
              serverSnapshot.seal.isPending ||
              !serverSnapshot.currentKey ||
              !canSealSnapshot
            }
            onClick={() => serverSnapshot.seal.mutate()}
            style={buttonStyle}
          >
            {serverSnapshot.seal.isPending
              ? "봉인 중"
              : serverSnapshot.sealed
                ? "봉인됨"
                : "현재본 봉인"}
          </button>
        </section>
      )}

      <section className="handoff-summary-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
        <Summary label="시스템 재현 가능" value={gate.confirmedCount} note="자동 재현 가능한 근거" />
        <Summary label="필수 근거 차단" value={gate.criticalBlockerCount} note="승인 전 보완" danger />
        <Summary label="재검토 필요" value={reviewSummary.staleDisciplines.length} note="저장본 변경 또는 구형 승인" danger />
        <Summary label="전문가 승인" value={reviewSummary.approvedCount} note="5개 분야 필요" positive />
      </section>

      <ProjectTransferPanel projectId={projectId} />
      <ReviewVerificationStatus work={verificationWork} />
      <IntegratedVerificationPanel projectId={projectId} report={integratedVerification} packet={reviewSnapshotPayload} snapshotKey={serverSnapshot.currentKey} sealed={serverSnapshot.sealed} />

      <section className="handoff-lanes-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {gate.lanes.map((lane) => {
          const unresolvedBlockers = lane.items.filter(
            (item) =>
              item.critical &&
              item.status === "missing"
          );
          const integratedBlockers = integratedVerification ? verificationApprovalBlockers(integratedVerification, lane.discipline) : [];
          return (
            <article key={lane.discipline} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-elev)", overflow: "hidden" }}>
              <div style={{ padding: "15px 16px 13px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 16 }}>{lane.title}</h2>
                  <span style={{ fontSize: 9, fontWeight: 700, color: reviewSummary.staleDisciplines.includes(lane.discipline) ? "var(--neg-fg)" : expertReviews[lane.discipline]?.status === "approved" ? "var(--pos-fg)" : "var(--fg-muted)" }}>
                    {reviewSummary.staleDisciplines.includes(lane.discipline)
                      ? "재검토 필요"
                      : expertReviews[lane.discipline]
                        ? REVIEW_STATUS_LABEL[expertReviews[lane.discipline]!.status]
                        : "미요청"}
                  </span>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 10.5, lineHeight: 1.55, color: "var(--fg-muted)" }}>{lane.description}</p>
              </div>
              {lane.items.map((item) => <EvidenceRow key={item.id} item={item} />)}
              <ExpertReviewEditor
                discipline={lane.discipline}
                current={expertReviews[lane.discipline]}
                snapshotKey={reviewSnapshotKey}
                approvalBlocked={
                  unresolvedBlockers.length > 0 || integratedBlockers.length > 0 || !snapshotAlignment.valid || !integratedVerification
                }
                blockerMessage={[
                  ...snapshotAlignment.errors,
                  ...unresolvedBlockers.map((item) => item.label),
                  ...integratedBlockers.map((item) => `${item.label}: ${item.detail}`),
                ].join(" ")}
                principal={accessSession.data}
                saving={reviewLedger.transition.isPending}
                onSave={(request) =>
                  reviewLedger.transition.mutateAsync(request).then(() => undefined)
                }
              />
            </article>
          );
        })}
      </section>

      <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
        <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>
          대상: {gate.address} · 금융 원장 {PROJECT_LEDGER_MODEL_VERSION}<br />
          {!finalReady && "필수 근거와 다섯 분야 승인이 완료될 때까지 최종 보고서 확정을 차단합니다."}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <NavButton href={`/projects/${projectId}`} label="사업성으로 돌아가기" />
          {finalReady ? (
            <NavButton href={`/projects/${projectId}/report`} label="Stage 5 보고서" primary />
          ) : (
            <span aria-disabled="true" style={disabledNavStyle}>보고서 잠김</span>
          )}
        </div>
      </footer>
    </div>
  );
}

function ExpertReviewEditor({
  discipline,
  current,
  snapshotKey,
  approvalBlocked,
  blockerMessage,
  principal,
  saving,
  onSave,
}: {
  discipline: HandoffDiscipline;
  current?: ExpertReviewRecord;
  snapshotKey: string | null;
  approvalBlocked: boolean;
  blockerMessage: string;
  principal?: PublicAccessPrincipal;
  saving: boolean;
  onSave: (request: ProjectReviewTransitionRequest) => Promise<void>;
}) {
  const staleReview = Boolean(current && current.snapshotKey !== snapshotKey);
  const currentStatus = staleReview ? "not-requested" : current?.status ?? "not-requested";
  const roleOptions = useMemo(
    () =>
      principal
        ? reviewerRolesForPrincipalDiscipline(principal, discipline)
        : [],
    [discipline, principal],
  );
  const [reviewerRole, setReviewerRole] = useState<
    ExpertReviewerRole | undefined
  >(current?.reviewerRole);
  const [evidenceRef, setEvidenceRef] = useState(current?.evidenceRef ?? "");
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [attestations, setAttestations] = useState<ExpertReviewAttestations>(
    current?.attestations ?? {
      snapshotReviewed: false,
      evidenceReviewed: false,
      preliminaryLimitAcknowledged: false,
    }
  );
  const [error, setError] = useState<string | null>(null);
  const canRequest = principalHasCapability(principal, "review.request");
  const canPerform =
    principalHasCapability(principal, "review.perform") &&
    roleOptions.length > 0;
  const requestActorId = current?.history
    ?.filter(
      (event) =>
        event.snapshotKey === snapshotKey && event.status === "requested",
    )
    .at(-1)?.actorId;
  const assignedReviewerId = current?.history
    ?.filter(
      (event) =>
        event.snapshotKey === snapshotKey && event.status === "in-review",
    )
    .at(-1)?.actorId;
  const selfRequested = Boolean(
    principal && requestActorId && requestActorId === principal.userId,
  );
  const assignedElsewhere = Boolean(
    principal &&
      assignedReviewerId &&
      assignedReviewerId !== principal.userId,
  );

  useEffect(() => {
    const nextRole =
      current?.reviewerRole && roleOptions.includes(current.reviewerRole)
        ? current.reviewerRole
        : roleOptions[0];
    setReviewerRole(nextRole);
  }, [current?.reviewerRole, roleOptions]);

  useEffect(() => {
    setEvidenceRef(current?.evidenceRef ?? "");
    setNotes(current?.notes ?? "");
    setAttestations(
      current?.attestations ?? {
        snapshotReviewed: false,
        evidenceReviewed: false,
        preliminaryLimitAcknowledged: false,
      },
    );
  }, [
    current?.attestations,
    current?.evidenceRef,
    current?.notes,
    current?.updatedAt,
  ]);

  const save = async (
    status: Exclude<ExpertReviewStatus, "not-requested">,
  ) => {
    if (!principal) {
      setError("로그인 사용자 정보를 확인한 뒤 다시 시도하세요.");
      return;
    }
    if (!snapshotKey) {
      setError("현재 대표안과 일치하는 Stage 3 저장본을 먼저 생성하세요.");
      return;
    }
    const transition = validateExpertReviewTransition(currentStatus, status);
    if (!transition.valid) {
      setError(transition.error ?? "검토 상태를 변경할 수 없습니다.");
      return;
    }
    if (status === "approved" && approvalBlocked) {
      setError(`먼저 필수 근거를 보완하세요: ${blockerMessage}`);
      return;
    }
    if (status === "requested" && !canRequest) {
      setError("현재 조직 역할은 검토를 요청할 수 없습니다.");
      return;
    }
    if (status !== "requested" && !canPerform) {
      setError("로그인 계정에 이 분야의 전문 검토 역할이 없습니다.");
      return;
    }
    if (status !== "requested" && selfRequested) {
      setError("검토 요청자는 같은 Snapshot을 직접 검토하거나 승인할 수 없습니다.");
      return;
    }
    if (
      (status === "approved" || status === "changes-requested") &&
      assignedElsewhere
    ) {
      setError("검토를 시작한 담당자만 이 검토를 결정할 수 있습니다.");
      return;
    }
    const nextAttestations =
      status === "requested" && currentStatus !== "requested"
        ? {
            snapshotReviewed: false,
            evidenceReviewed: false,
            preliminaryLimitAcknowledged: false,
          }
        : attestations;
    try {
      await onSave({
        discipline,
        status,
        snapshotKey,
        reviewerRole: status === "requested" ? undefined : reviewerRole,
        evidenceRef,
        notes,
        attestations: nextAttestations,
      });
      setAttestations(nextAttestations);
      setError(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "검토 이벤트를 기록하지 못했습니다.",
      );
    }
  };

  return (
    <div style={{ padding: 15, background: "var(--bg-soft)", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 9 }}>
        <strong style={{ fontSize: 11 }}>서버 검토 기록</strong>
        <span style={{ fontSize: 8.5, color: "var(--fg-muted)" }}>
          {REVIEW_STATUS_LABEL[currentStatus]}
        </span>
      </div>
      <div style={{ marginBottom: 9, padding: "8px 9px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-elev)", fontSize: 8.8, lineHeight: 1.5 }}>
        {principal ? (
          <>
            <strong>{principal.name}</strong> · {principal.organization}<br />
            <span style={{ color: "var(--fg-muted)" }}>
              {ORGANIZATION_ROLE_LABEL[principal.role]} · {principal.email}
            </span>
          </>
        ) : (
          <span style={{ color: "var(--fg-muted)" }}>로그인 주체 확인 중</span>
        )}
      </div>
      {current?.requestedBy && (
        <div style={{ marginBottom: 8, fontSize: 8.5, color: "var(--fg-muted)" }}>
          요청 {current.requestedBy} · {current.requestedAt}
          {current.reviewer && (
            <> · 검토 {current.reviewer} ({current.organization})</>
          )}
        </div>
      )}
      {currentStatus !== "not-requested" && currentStatus !== "approved" && currentStatus !== "changes-requested" && roleOptions.length > 0 && (
        <label style={labelStyle}>
          로그인 계정의 전문가 역할
          <select
            value={reviewerRole ?? ""}
            onChange={(event) =>
              setReviewerRole(event.target.value as ExpertReviewerRole)
            }
            style={inputStyle}
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {EXPERT_REVIEWER_ROLE_META[role].label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label style={labelStyle}>근거 문서 참조<input value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="도면·검토서·견적서·Term Sheet·세무 메모" style={inputStyle} /></label>
      <label style={labelStyle}>검토 의견<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="승인 범위 또는 수정 요청 내용을 기록" style={{ ...inputStyle, minHeight: 64, padding: 8, resize: "vertical" }} /></label>
      {currentStatus === "in-review" && (
        <div style={{ display: "grid", gap: 6, margin: "2px 0 9px", padding: 9, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-elev)" }}>
          <AttestationCheck
            checked={attestations.snapshotReviewed}
            label="현재 계산·Geometry Snapshot Key를 확인했습니다"
            onChange={(checked) =>
              setAttestations((currentValue) => ({
                ...currentValue,
                snapshotReviewed: checked,
              }))
            }
          />
          <AttestationCheck
            checked={attestations.evidenceReviewed}
            label="이 분야의 원문과 검토 근거를 확인했습니다"
            onChange={(checked) =>
              setAttestations((currentValue) => ({
                ...currentValue,
                evidenceReviewed: checked,
              }))
            }
          />
          <AttestationCheck
            checked={attestations.preliminaryLimitAcknowledged}
            label="본 결과가 인허가·대출·보험·세무 확약이 아닌 예비 타당성임을 확인했습니다"
            onChange={(checked) =>
              setAttestations((currentValue) => ({
                ...currentValue,
                preliminaryLimitAcknowledged: checked,
              }))
            }
          />
        </div>
      )}
      {error && <div role="alert" style={{ marginBottom: 8, padding: 8, borderRadius: 7, background: "var(--neg-soft)", color: "var(--neg-fg)", fontSize: 9 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: currentStatus === "in-review" ? "1fr 1fr" : "1fr", gap: 6 }}>
        {(currentStatus === "not-requested" ||
          currentStatus === "changes-requested" ||
          currentStatus === "approved") && (
          <button type="button" disabled={saving || !canRequest} onClick={() => void save("requested")} style={smallButtonStyle}>
            {currentStatus === "changes-requested"
              ? "보완 후 재검토 요청"
              : currentStatus === "approved"
                ? "새 검토 요청"
                : "검토 요청"}
          </button>
        )}
        {currentStatus === "requested" && (
          <button type="button" disabled={saving || !canPerform || selfRequested} onClick={() => void save("in-review")} style={smallButtonStyle}>검토 시작</button>
        )}
        {currentStatus === "in-review" && (
          <>
            <button type="button" disabled={saving || !canPerform || selfRequested || assignedElsewhere} onClick={() => void save("changes-requested")} style={smallButtonStyle}>수정 요청</button>
            <button type="button" disabled={saving || !canPerform || selfRequested || assignedElsewhere} onClick={() => void save("approved")} style={{ ...smallButtonStyle, background: "var(--fg)", color: "var(--bg)" }}>승인 기록</button>
          </>
        )}
      </div>
    </div>
  );
}

function AttestationCheck({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", gap: 7, alignItems: "flex-start", color: "var(--fg-muted)", fontSize: 8.5, lineHeight: 1.45 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ margin: "1px 0 0", flex: "0 0 auto" }}
      />
      <span>{label}</span>
    </label>
  );
}

const buttonStyle: React.CSSProperties = { minWidth: 142, height: 36, padding: "0 14px", border: "1px solid var(--fg)", borderRadius: 8, background: "var(--fg)", color: "var(--bg)", fontSize: 11, fontWeight: 700, cursor: "pointer" };
const labelStyle: React.CSSProperties = { display: "grid", gap: 4, marginBottom: 7, color: "var(--fg-muted)", fontSize: 8.5, fontWeight: 700 };
const inputStyle: React.CSSProperties = { width: "100%", minHeight: 32, boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-elev)", color: "var(--fg)", padding: "0 8px", font: "inherit", fontSize: 9.5 };
const smallButtonStyle: React.CSSProperties = { minHeight: 32, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-elev)", color: "var(--fg)", fontSize: 8.5, fontWeight: 700, cursor: "pointer" };
const disabledNavStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", height: 34, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-soft)", color: "var(--fg-faint)", fontSize: 10.5, fontWeight: 700 };

function Summary({ label, value, note, danger = false, positive = false }: { label: string; value: number; note: string; danger?: boolean; positive?: boolean }) {
  return <div style={{ padding: "14px 15px", borderRight: "1px solid var(--border)" }}><span style={{ display: "block", fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 5, fontSize: 20, color: danger && value > 0 ? "var(--neg-fg)" : positive && value > 0 ? "var(--pos-fg)" : "var(--fg)" }}>{value}건</strong><small style={{ color: "var(--fg-faint)", fontSize: 8.5 }}>{note}</small></div>;
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--border-faint)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><strong style={{ fontSize: 11.5 }}>{item.label}</strong><span style={{ color: STATUS_COLOR[item.status], fontSize: 8.5, fontWeight: 700 }}>{STATUS_LABEL[item.status]}</span></div><div style={{ marginTop: 5, fontSize: 9.5, color: "var(--fg-muted)" }}>{item.source}{item.critical && <span style={{ marginLeft: 6, color: "var(--neg-fg)" }}>필수</span>}</div><div style={{ marginTop: 5, padding: "7px 8px", borderRadius: 6, background: "var(--bg-soft)", fontSize: 9, lineHeight: 1.5 }}>다음 확인 · {item.nextAction}</div></div>;
}

function NavButton({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  return <Link href={href} style={{ display: "inline-flex", alignItems: "center", height: 34, padding: "0 12px", border: "1px solid var(--fg)", borderRadius: 8, background: primary ? "var(--fg)" : "transparent", color: primary ? "var(--bg)" : "var(--fg)", textDecoration: "none", fontSize: 10.5, fontWeight: 700 }}>{label}</Link>;
}
