"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildFinancialSourceFromPriceVerification,
  calculatePriceVerification,
  validatePriceVerification,
  type PriceComparableSnapshot,
  type PriceVerificationRecord,
  type PriceVerificationStatus,
  type PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { num } from "@/lib/utils/format";

const TARGET_LABEL: Record<PriceVerificationTarget, string> = {
  acquisition: "토지 매입가",
  sale: "매각·분양 단가",
};

export default function PriceReviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const data = useProjectStore((state) => state.data);
  const setFinancialSource = useProjectStore((state) => state.setFinancialSource);
  const removeFinancialSource = useProjectStore((state) => state.removeFinancialSource);
  const projectReviews = useReviewStore(
    (state) => state.priceVerifications[projectId] ?? {}
  );
  const setPriceVerification = useReviewStore(
    (state) => state.setPriceVerification
  );
  const removePriceVerification = useReviewStore(
    (state) => state.removePriceVerification
  );
  const [target, setTarget] = useState<PriceVerificationTarget>("acquisition");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [adjustmentPct, setAdjustmentPct] = useState(0);
  const [reviewer, setReviewer] = useState("");
  const [organization, setOrganization] = useState("");
  const [rationale, setRationale] = useState("");
  const [verifiedAt, setVerifiedAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [message, setMessage] = useState<{
    tone: "positive" | "negative";
    text: string;
  } | null>(null);

  const candidates = useMemo(
    () =>
      (data?.comps ?? []).map((comp, index) => ({
        ...comp,
        _key: `${comp.id}-${index}`,
      })),
    [data?.comps]
  );
  const selectedComps = useMemo<PriceComparableSnapshot[]>(
    () =>
      candidates
        .filter((comp) => selectedIds.includes(comp._key))
        .map((comp) => ({
          id: comp._key,
          address: comp.address,
          date: comp.date,
          type: comp.type,
          lotAreaSqm: comp.lotArea,
          pricePerPyeongManwon: comp.pricePerPyeong,
        })),
    [candidates, selectedIds]
  );

  const calculation = useMemo(() => {
    if (!data?.parcel || selectedComps.length === 0) return null;
    try {
      return calculatePriceVerification(
        data.parcel.lotArea,
        selectedComps,
        adjustmentPct
      );
    } catch {
      return null;
    }
  }, [adjustmentPct, data?.parcel, selectedComps]);

  useEffect(() => {
    const saved = projectReviews[target];
    setSelectedIds(saved?.selectedComps.map((comp) => comp.id) ?? []);
    setAdjustmentPct(saved?.adjustmentPct ?? 0);
    setReviewer(saved?.reviewer ?? "");
    setOrganization(saved?.organization ?? "");
    setRationale(saved?.rationale ?? "");
    setVerifiedAt(saved?.verifiedAt ?? new Date().toISOString().slice(0, 10));
    setMessage(null);
  }, [projectReviews, target]);

  if (!data?.parcel) {
    return <div style={{ padding: 40 }}>가격 검증 데이터를 준비하는 중입니다.</div>;
  }

  const toggleComparable = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
    setMessage(null);
  };

  const buildRecord = (
    status: PriceVerificationStatus
  ): PriceVerificationRecord | null => {
    if (!calculation) {
      setMessage({ tone: "negative", text: "비교 사례를 선택해 가격을 계산하세요." });
      return null;
    }
    const now = new Date().toISOString();
    const record: PriceVerificationRecord = {
      projectId,
      target,
      status,
      selectedComps,
      ...calculation,
      adjustmentPct,
      reviewer: reviewer.trim(),
      organization: organization.trim(),
      rationale: rationale.trim(),
      sourceModelVersion:
        target === "acquisition"
          ? data.parcel.acquisitionEstimate?.modelVersion
          : data.saleEstimate?.modelVersion,
      verifiedAt,
      updatedAt: now,
    };
    const validation = validatePriceVerification(record);
    if (!validation.valid) {
      setMessage({ tone: "negative", text: validation.errors.join(" ") });
      return null;
    }
    return record;
  };

  const saveReview = (status: PriceVerificationStatus) => {
    const record = buildRecord(status);
    if (!record) return;
    setPriceVerification(projectId, record);
    if (status === "verified") {
      const source = buildFinancialSourceFromPriceVerification(record);
      if (source) setFinancialSource(projectId, source);
    }
    setMessage({
      tone: "positive",
      text:
        status === "verified"
          ? `${TARGET_LABEL[target]} 검증값을 Stage 3 계산에 반영했습니다.`
          : "가격 검토 요청 상태를 저장했습니다.",
    });
  };

  const resetReview = () => {
    removePriceVerification(projectId, target);
    removeFinancialSource(
      projectId,
      target === "acquisition" ? "acquisitionPrice" : "salePricePerSqM"
    );
    setSelectedIds([]);
    setAdjustmentPct(0);
    setReviewer("");
    setOrganization("");
    setRationale("");
    setMessage(null);
  };

  const current = projectReviews[target];
  const sameDongCount = selectedComps.filter((comp) =>
    candidates.find((candidate) => candidate._key === comp.id)?.sameDong
  ).length;

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "28px 30px 52px" }}>
      <nav style={navStyle}>
        <Link href={`/projects/${projectId}`} style={navLinkStyle}>Stage 3 사업성</Link>
        <span>→</span>
        <Link href={`/projects/${projectId}/comps`} style={navLinkStyle}>전체 실거래</Link>
        <span>→</span>
        <strong style={{ color: "var(--fg)" }}>가격 검증</strong>
        <span>→</span>
        <Link href={`/projects/${projectId}/handoff`} style={navLinkStyle}>전문가 인계</Link>
      </nav>

      <header style={{ marginBottom: 18 }}>
        <div style={eyebrowStyle}>PRICE VERIFICATION</div>
        <h1 style={{ margin: "7px 0 6px", fontSize: 28 }}>실거래를 선택하고 검토 가격을 확정합니다</h1>
        <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: 12, lineHeight: 1.65 }}>
          알고리즘 중앙값을 그대로 확정하지 않습니다. 채택 사례·보정률·검토자·사유를 함께 저장하고, 검증된 값만 Stage 3 원장에 반영합니다.
        </p>
      </header>

      <section style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["acquisition", "sale"] as PriceVerificationTarget[]).map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => setTarget(item)}
            style={{
              ...tabStyle,
              background: target === item ? "var(--fg)" : "var(--bg-elev)",
              color: target === item ? "var(--bg)" : "var(--fg)",
            }}
          >
            {TARGET_LABEL[item]}
            {projectReviews[item]?.status === "verified" ? " · 검증됨" : ""}
          </button>
        ))}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 16, alignItems: "start" }}>
        <section style={panelStyle}>
          <div style={{ padding: "15px 16px", borderBottom: "1px solid var(--border)" }}>
            <strong>비교 사례 선택</strong>
            <span style={{ marginLeft: 8, color: selectedComps.length >= 3 ? "var(--pos-fg)" : "var(--neg-fg)", fontSize: 10 }}>
              {selectedComps.length}건 선택 · 최소 3건
            </span>
          </div>
          <div style={{ maxHeight: 650, overflow: "auto" }}>
            {candidates.map((comp) => {
              const checked = selectedIds.includes(comp._key);
              return (
                <label key={comp._key} style={{ display: "grid", gridTemplateColumns: "24px 1fr auto", gap: 10, alignItems: "center", padding: "12px 15px", borderBottom: "1px solid var(--border-faint)", background: checked ? "var(--bg-active)" : "transparent", cursor: "pointer" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleComparable(comp._key)} />
                  <span style={{ minWidth: 0 }}>
                    <b style={{ display: "block", fontSize: 11 }}>{comp.address}</b>
                    <small style={{ color: "var(--fg-muted)" }}>{comp.date} · {comp.type} · 대지 {num(comp.lotArea)}㎡{comp.sameDong ? " · 같은 동" : ""}</small>
                  </span>
                  <strong style={{ fontSize: 12 }}>{num(comp.pricePerPyeong)}만원/평</strong>
                </label>
              );
            })}
            {candidates.length === 0 && <div style={{ padding: 28, textAlign: "center", color: "var(--fg-muted)" }}>검증할 실거래 사례가 없습니다.</div>}
          </div>
        </section>

        <aside style={{ ...panelStyle, position: "sticky", top: 16, padding: 16 }}>
          <div style={eyebrowStyle}>REVIEW LEDGER</div>
          <h2 style={{ margin: "6px 0 12px", fontSize: 18 }}>{TARGET_LABEL[target]} 검토</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            <Metric label="선택 사례" value={`${selectedComps.length}건`} />
            <Metric label="같은 동" value={`${sameDongCount}건`} />
            <Metric label="선택 중앙값" value={calculation ? `${num(calculation.medianPricePerPyeongManwon)}만/평` : "—"} />
            <Metric label="검토 가격" value={calculation ? `${num(calculation.verifiedPricePerPyeongManwon)}만/평` : "—"} />
          </div>

          <label style={labelStyle}>입지·상품 보정률 (-30%~30%)
            <input type="number" min={-30} max={30} step={0.5} value={adjustmentPct} onChange={(event) => setAdjustmentPct(Number(event.target.value))} style={inputStyle} />
          </label>
          <label style={labelStyle}>검토자
            <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="이름" style={inputStyle} />
          </label>
          <label style={labelStyle}>소속·역할
            <input value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="예: ○○부동산 / 감정평가사" style={inputStyle} />
          </label>
          <label style={labelStyle}>검토 기준일
            <input type="date" value={verifiedAt} onChange={(event) => setVerifiedAt(event.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>사례 채택·보정 사유
            <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="준공연도·입지·면적·도로조건 차이를 어떻게 반영했는지 기록" style={{ ...inputStyle, minHeight: 82, padding: 9, resize: "vertical" }} />
          </label>

          {calculation && (
            <div style={{ padding: 11, borderRadius: 8, background: "var(--bg-soft)", fontSize: 10, lineHeight: 1.6, marginBottom: 10 }}>
              대상 대지 기준 총액 <b>{num(calculation.verifiedTotalManwon)}만원</b><br />
              ㎡ 단가 <b>{num(calculation.verifiedPricePerSqmWon)}원/㎡</b>
            </div>
          )}
          {message && <div role="status" style={{ padding: 9, borderRadius: 8, marginBottom: 9, background: message.tone === "positive" ? "var(--pos-soft)" : "var(--neg-soft)", color: message.tone === "positive" ? "var(--pos-fg)" : "var(--neg-fg)", fontSize: 10, lineHeight: 1.5 }}>{message.text}</div>}

          <div style={{ display: "grid", gap: 7 }}>
            <button type="button" onClick={() => saveReview("review-requested")} style={secondaryButtonStyle}>검토 요청 상태 저장</button>
            <button type="button" onClick={() => saveReview("verified")} style={primaryButtonStyle}>가격 확정 · Stage 3 반영</button>
            {current && <button type="button" onClick={resetReview} style={textButtonStyle}>검증 기록 초기화</button>}
          </div>
          <p style={{ margin: "11px 0 0", color: "var(--fg-faint)", fontSize: 9, lineHeight: 1.5 }}>
            검증 상태는 외부 감정평가를 대체하지 않습니다. 선택 사례와 검토자 책임을 기록해 예비 계산의 출처를 재현하기 위한 절차입니다.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: 9, border: "1px solid var(--border-faint)", borderRadius: 8 }}><small style={{ display: "block", color: "var(--fg-muted)", fontSize: 8.5 }}>{label}</small><strong style={{ display: "block", marginTop: 4, fontSize: 12 }}>{value}</strong></div>;
}

const panelStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-elev)", overflow: "hidden" };
const navStyle: React.CSSProperties = { display: "flex", gap: 8, marginBottom: 20, fontSize: 11, color: "var(--fg-muted)" };
const navLinkStyle: React.CSSProperties = { color: "inherit", textDecoration: "none" };
const eyebrowStyle: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: "0.2em", color: "var(--fg-muted)" };
const tabStyle: React.CSSProperties = { minHeight: 34, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 10.5, fontWeight: 700, cursor: "pointer" };
const labelStyle: React.CSSProperties = { display: "grid", gap: 5, marginBottom: 10, color: "var(--fg-muted)", fontSize: 9.5, fontWeight: 700 };
const inputStyle: React.CSSProperties = { width: "100%", minHeight: 36, boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--fg)", padding: "0 9px", font: "inherit", fontSize: 10.5 };
const primaryButtonStyle: React.CSSProperties = { minHeight: 38, border: "1px solid var(--fg)", borderRadius: 8, background: "var(--fg)", color: "var(--bg)", fontSize: 10.5, fontWeight: 800, cursor: "pointer" };
const secondaryButtonStyle: React.CSSProperties = { ...primaryButtonStyle, background: "transparent", color: "var(--fg)" };
const textButtonStyle: React.CSSProperties = { border: 0, background: "transparent", color: "var(--fg-muted)", fontSize: 9.5, cursor: "pointer", padding: 6 };
