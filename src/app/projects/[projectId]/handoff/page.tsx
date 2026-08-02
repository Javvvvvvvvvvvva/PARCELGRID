"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { PROJECT_LEDGER_MODEL_VERSION } from "@/lib/finance/project-ledger";
import { validateFinancialSourceEvidence } from "@/lib/finance/source-data-gate";
import { coreRegulatoryConstraintsVerified } from "@/lib/regulatory/constraints";
import {
  buildEvidenceGate,
  buildHandoffBrief,
  type EvidenceItem,
  type EvidenceStatus,
  type HandoffDiscipline,
} from "@/lib/handoff/evidence-gate";
import {
  buildExpertReviewSummary,
  validateExpertReview,
  type ExpertReviewRecord,
  type ExpertReviewStatus,
} from "@/lib/handoff/review-workflow";

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
  approved: "승인",
  "changes-requested": "수정 요청",
};

export default function HandoffPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const data = useProjectStore((state) => state.data);
  const geometry = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );
  const financialSources = useProjectStore(
    (state) => state.financialSources[projectId] ?? {}
  );
  const priceVerifications = useReviewStore(
    (state) => state.priceVerifications[projectId] ?? {}
  );
  const expertReviews = useReviewStore(
    (state) => state.expertReviews[projectId] ?? {}
  );
  const setExpertReview = useReviewStore((state) => state.setExpertReview);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );

  const constructionSource = financialSources.constCostPerSqM;
  const ltcSource = financialSources.ltcTarget;
  const interestSource = financialSources.interestRate;
  const validConstructionQuote = Boolean(
    constructionSource &&
      constructionSource.sourceKind === "professional-quote" &&
      validateFinancialSourceEvidence(constructionSource).valid
  );
  const validTermSheet = Boolean(
    ltcSource &&
      interestSource &&
      ltcSource.sourceKind === "lender-term-sheet" &&
      interestSource.sourceKind === "lender-term-sheet" &&
      validateFinancialSourceEvidence(ltcSource).valid &&
      validateFinancialSourceEvidence(interestSource).valid
  );
  const financeTaxReview = expertReviews["finance-tax"];
  const taxReviewComplete = Boolean(
    financeTaxReview?.status === "approved" &&
      validateExpertReview(financeTaxReview).valid
  );

  const gate = useMemo(() => {
    if (!data) return null;
    const projectGeometry = geometry?.projectId === projectId ? geometry : null;
    return buildEvidenceGate({
      projectId,
      address: data.parcel.address,
      geometryHash: projectGeometry?.geometryHash ?? null,
      roadReferenceCount: data.parcel.roads?.length ?? 0,
      regulatorySourceBacked: coreRegulatoryConstraintsVerified(
        data.parcel.regulatoryConstraints
      ),
      saleCompCount: data.comps?.length ?? 0,
      saleEstimateVersion: data.saleEstimate?.modelVersion ?? null,
      acquisitionEstimateVersion:
        data.parcel.acquisitionEstimate?.modelVersion ?? null,
      financeModelVersion: PROJECT_LEDGER_MODEL_VERSION,
      taxComplete: taxReviewComplete,
      hasConstructionQuote: validConstructionQuote,
      hasTermSheet: validTermSheet,
      hasExternalPriceOpinion:
        priceVerifications.acquisition?.status === "verified",
    });
  }, [
    data,
    geometry,
    priceVerifications.acquisition?.status,
    projectId,
    taxReviewComplete,
    validConstructionQuote,
    validTermSheet,
  ]);

  const reviewSummary = useMemo(
    () => buildExpertReviewSummary(expertReviews),
    [expertReviews]
  );

  if (!data || !gate) {
    return <div style={{ padding: 40 }}>전문가 인계 정보를 준비하는 중입니다.</div>;
  }

  const finalReady =
    gate.criticalBlockerCount === 0 && reviewSummary.ready;

  const copyBrief = async () => {
    const reviewLines = gate.lanes.map((lane) => {
      const review = expertReviews[lane.discipline];
      return `${lane.title}: ${review ? REVIEW_STATUS_LABEL[review.status] : "미요청"}${
        review?.reviewer ? ` · ${review.reviewer} (${review.organization})` : ""
      }`;
    });
    try {
      await navigator.clipboard.writeText(
        `${buildHandoffBrief(gate)}\n\n[분야별 검토 상태]\n${reviewLines.join("\n")}`
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const statusTitle = finalReady
    ? "모든 필수 근거와 전문가 승인이 완료됐습니다"
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
            시스템 확인과 전문가 승인을 구분합니다. 담당자·소속·근거 문서·검토일·의견을 저장하고, 네 분야가 모두 승인돼야 최종 보고서 단계가 열립니다.
          </p>
        </div>
        <button type="button" onClick={copyBrief} style={buttonStyle}>
          {copyState === "copied" ? "검토 요청서 복사됨" : copyState === "failed" ? "복사 실패" : "검토 요청서 복사"}
        </button>
      </header>

      <section role="status" style={{ padding: "14px 16px", border: `1px solid ${finalReady ? "var(--pos-fg)" : "var(--neg-fg)"}`, borderRadius: 10, background: finalReady ? "var(--pos-soft)" : "rgba(161,60,50,.06)", marginBottom: 16 }}>
        <strong style={{ display: "block", fontSize: 13 }}>{statusTitle}</strong>
        <span style={{ display: "block", marginTop: 4, fontSize: 10.5, color: "var(--fg-muted)" }}>
          필수 근거 미확인 {gate.criticalBlockerCount}건 · 전문가 승인 {reviewSummary.approvedCount}/{reviewSummary.requiredDisciplines.length}개 분야 · 수정 요청 {reviewSummary.changesRequestedCount}건
        </span>
      </section>

      <section className="handoff-summary-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
        <Summary label="시스템 재현 가능" value={gate.confirmedCount} note="자동 재현 가능한 근거" />
        <Summary label="필수 근거 차단" value={gate.criticalBlockerCount} note="승인 전 보완" danger />
        <Summary label="검토 요청 중" value={reviewSummary.requestedCount} note="답변 대기" />
        <Summary label="전문가 승인" value={reviewSummary.approvedCount} note="4개 분야 필요" positive />
      </section>

      <section className="handoff-lanes-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {gate.lanes.map((lane) => {
          const unresolvedBlockers = lane.items.filter(
            (item) =>
              item.critical &&
              item.status === "missing" &&
              item.id !== "tax-memo"
          );
          return (
            <article key={lane.discipline} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-elev)", overflow: "hidden" }}>
              <div style={{ padding: "15px 16px 13px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 16 }}>{lane.title}</h2>
                  <span style={{ fontSize: 9, fontWeight: 700, color: expertReviews[lane.discipline]?.status === "approved" ? "var(--pos-fg)" : "var(--fg-muted)" }}>
                    {expertReviews[lane.discipline] ? REVIEW_STATUS_LABEL[expertReviews[lane.discipline]!.status] : "미요청"}
                  </span>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 10.5, lineHeight: 1.55, color: "var(--fg-muted)" }}>{lane.description}</p>
              </div>
              {lane.items.map((item) => <EvidenceRow key={item.id} item={item} />)}
              <ExpertReviewEditor
                discipline={lane.discipline}
                current={expertReviews[lane.discipline]}
                approvalBlocked={unresolvedBlockers.length > 0}
                blockerMessage={unresolvedBlockers.map((item) => item.label).join(", ")}
                onSave={(record) => setExpertReview(projectId, record)}
              />
            </article>
          );
        })}
      </section>

      <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
        <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>
          대상: {gate.address} · 금융 원장 {PROJECT_LEDGER_MODEL_VERSION}<br />
          {!finalReady && "필수 근거와 네 분야 승인이 완료될 때까지 최종 보고서 확정을 차단합니다."}
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
  approvalBlocked,
  blockerMessage,
  onSave,
}: {
  discipline: HandoffDiscipline;
  current?: ExpertReviewRecord;
  approvalBlocked: boolean;
  blockerMessage: string;
  onSave: (record: ExpertReviewRecord) => void;
}) {
  const [reviewer, setReviewer] = useState(current?.reviewer ?? "");
  const [organization, setOrganization] = useState(current?.organization ?? "");
  const [evidenceRef, setEvidenceRef] = useState(current?.evidenceRef ?? "");
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [reviewedAt, setReviewedAt] = useState(
    current?.reviewedAt ?? new Date().toISOString().slice(0, 10)
  );
  const [error, setError] = useState<string | null>(null);

  const save = (status: ExpertReviewStatus) => {
    if (status === "approved" && approvalBlocked) {
      setError(`먼저 필수 근거를 보완하세요: ${blockerMessage}`);
      return;
    }
    const record: ExpertReviewRecord = {
      discipline,
      status,
      reviewer: reviewer.trim(),
      organization: organization.trim(),
      evidenceRef: evidenceRef.trim(),
      notes: notes.trim(),
      reviewedAt,
      updatedAt: new Date().toISOString(),
    };
    const validation = validateExpertReview(record);
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }
    onSave(record);
    setError(null);
  };

  return (
    <div style={{ padding: 15, background: "var(--bg-soft)", borderTop: "1px solid var(--border)" }}>
      <strong style={{ display: "block", marginBottom: 9, fontSize: 11 }}>전문가 검토 기록</strong>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        <label style={labelStyle}>담당자<input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="이름" style={inputStyle} /></label>
        <label style={labelStyle}>소속·역할<input value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="회사·자격" style={inputStyle} /></label>
      </div>
      <label style={labelStyle}>근거 문서 참조<input value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="도면·검토서·견적서·Term Sheet·세무 메모" style={inputStyle} /></label>
      <label style={labelStyle}>검토일<input type="date" value={reviewedAt} onChange={(event) => setReviewedAt(event.target.value)} style={inputStyle} /></label>
      <label style={labelStyle}>검토 의견<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="승인 범위 또는 수정 요청 내용을 기록" style={{ ...inputStyle, minHeight: 64, padding: 8, resize: "vertical" }} /></label>
      {error && <div role="alert" style={{ marginBottom: 8, padding: 8, borderRadius: 7, background: "var(--neg-soft)", color: "var(--neg-fg)", fontSize: 9 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        <button type="button" onClick={() => save("requested")} style={smallButtonStyle}>검토 요청</button>
        <button type="button" onClick={() => save("changes-requested")} style={smallButtonStyle}>수정 요청</button>
        <button type="button" onClick={() => save("approved")} style={{ ...smallButtonStyle, background: "var(--fg)", color: "var(--bg)" }}>승인 기록</button>
      </div>
    </div>
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
