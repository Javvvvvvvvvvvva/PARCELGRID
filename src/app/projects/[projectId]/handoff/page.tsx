"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useProjectStore } from "@/lib/stores/project-store";
import { PROJECT_LEDGER_MODEL_VERSION } from "@/lib/finance/project-ledger";
import {
  buildEvidenceGate,
  buildHandoffBrief,
  type EvidenceItem,
  type EvidenceStatus,
} from "@/lib/handoff/evidence-gate";

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
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );

  const gate = useMemo(() => {
    if (!data) return null;
    const projectGeometry = geometry?.projectId === projectId ? geometry : null;
    return buildEvidenceGate({
      projectId,
      address: data.parcel.address,
      geometryHash: projectGeometry?.geometryHash ?? null,
      roadReferenceCount: data.parcel.roads?.length ?? 0,
      saleCompCount: data.comps?.length ?? 0,
      saleEstimateVersion: data.saleEstimate?.modelVersion ?? null,
      acquisitionEstimateVersion:
        data.parcel.acquisitionEstimate?.modelVersion ?? null,
      financeModelVersion: PROJECT_LEDGER_MODEL_VERSION,
      taxComplete: false,
    });
  }, [data, geometry, projectId]);

  if (!data || !gate) {
    return <div style={{ padding: 40 }}>전문가 인계 정보를 준비하는 중입니다.</div>;
  }

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(buildHandoffBrief(gate));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const statusTitle =
    gate.status === "blocked"
      ? "전문가 인계 전 필수 근거가 남아 있습니다"
      : gate.status === "expert-review"
        ? "근거는 모였고 전문가 확인이 필요합니다"
        : "인계 기준을 충족했습니다";

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 30px 48px" }}>
      <nav style={{ display: "flex", gap: 8, marginBottom: 20, fontSize: 11, color: "var(--fg-muted)" }}>
        <Link href={`/projects/${projectId}`} style={{ color: "inherit" }}>Stage 3 사업성 검토</Link>
        <span>→</span><strong style={{ color: "var(--fg)" }}>Stage 4 전문가 검증·인계</strong>
        <span>→</span><Link href={`/projects/${projectId}/report`} style={{ color: "inherit" }}>Stage 5 예비 보고서</Link>
      </nav>

      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "start", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.2em", color: "var(--fg-muted)" }}>STAGE 4 · EVIDENCE GATE</div>
          <h1 style={{ margin: "8px 0 6px", fontSize: 27 }}>전문가에게 넘길 근거와 책임을 분리합니다</h1>
          <p style={{ margin: 0, maxWidth: 760, color: "var(--fg-muted)", fontSize: 12, lineHeight: 1.65 }}>
            시스템이 재현할 수 있는 사실과 건축가·시행사·금융·세무·분양 전문가가 확인할 판단을 섞지 않습니다. 빠진 근거는 보고서 확정 전 차단 항목으로 남습니다.
          </p>
        </div>
        <button type="button" onClick={copyBrief} style={buttonStyle}>
          {copyState === "copied" ? "검토 요청서 복사됨" : copyState === "failed" ? "복사 실패" : "검토 요청서 복사"}
        </button>
      </header>

      <section role="status" style={{ padding: "14px 16px", border: "1px solid var(--neg-fg)", borderRadius: 10, background: "rgba(161,60,50,.06)", marginBottom: 16 }}>
        <strong style={{ display: "block", fontSize: 13 }}>{statusTitle}</strong>
        <span style={{ display: "block", marginTop: 4, fontSize: 10.5, color: "var(--fg-muted)" }}>
          시스템 확인은 외부 전문가 승인이 아닙니다. 필수 미확인 {gate.criticalBlockerCount}건은 예비 보고서에서 계속 경고로 표시해야 합니다.
        </span>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
        <Summary label="시스템 재현 가능" value={gate.confirmedCount} note="전문가 승인 아님" />
        <Summary label="전문가 확인 필요" value={gate.reviewCount} note="관측·추정 근거 있음" />
        <Summary label="근거 필요" value={gate.missingCount} note="자료 첨부 전" />
        <Summary label="필수 차단" value={gate.criticalBlockerCount} note="보고서 확정 금지" danger />
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {gate.lanes.map((lane) => (
          <article key={lane.discipline} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-elev)", overflow: "hidden" }}>
            <div style={{ padding: "15px 16px 13px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><h2 style={{ margin: 0, fontSize: 16 }}>{lane.title}</h2><span style={{ fontSize: 9, fontWeight: 700, color: "var(--fg-muted)" }}>{lane.owner}</span></div>
              <p style={{ margin: "6px 0 0", fontSize: 10.5, lineHeight: 1.55, color: "var(--fg-muted)" }}>{lane.description}</p>
            </div>
            {lane.items.map((item) => <EvidenceRow key={item.id} item={item} />)}
          </article>
        ))}
      </section>

      <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
        <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>대상: {gate.address} · 금융 원장 {PROJECT_LEDGER_MODEL_VERSION}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <NavButton href={`/projects/${projectId}`} label="사업성으로 돌아가기" />
          <NavButton href={`/projects/${projectId}/report`} label="Stage 5 예비 보고서" primary />
        </div>
      </footer>
    </div>
  );
}

const buttonStyle: React.CSSProperties = { minWidth: 142, height: 36, padding: "0 14px", border: "1px solid var(--fg)", borderRadius: 8, background: "var(--fg)", color: "var(--bg)", fontSize: 11, fontWeight: 700, cursor: "pointer" };

function Summary({ label, value, note, danger = false }: { label: string; value: number; note: string; danger?: boolean }) {
  return <div style={{ padding: "14px 15px", borderRight: "1px solid var(--border)" }}><span style={{ display: "block", fontSize: 9.5, color: "var(--fg-muted)" }}>{label}</span><strong style={{ display: "block", marginTop: 5, fontSize: 20, color: danger && value > 0 ? "var(--neg-fg)" : "var(--fg)" }}>{value}건</strong><small style={{ color: "var(--fg-faint)", fontSize: 8.5 }}>{note}</small></div>;
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--border-faint)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><strong style={{ fontSize: 11.5 }}>{item.label}</strong><span style={{ color: STATUS_COLOR[item.status], fontSize: 8.5, fontWeight: 700 }}>{STATUS_LABEL[item.status]}</span></div><div style={{ marginTop: 5, fontSize: 9.5, color: "var(--fg-muted)" }}>{item.source}{item.critical && <span style={{ marginLeft: 6, color: "var(--neg-fg)" }}>필수</span>}</div><div style={{ marginTop: 5, padding: "7px 8px", borderRadius: 6, background: "var(--bg-soft)", fontSize: 9, lineHeight: 1.5 }}>다음 확인 · {item.nextAction}</div></div>;
}

function NavButton({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  return <Link href={href} style={{ display: "inline-flex", alignItems: "center", height: 34, padding: "0 12px", border: "1px solid var(--fg)", borderRadius: 8, background: primary ? "var(--fg)" : "transparent", color: primary ? "var(--bg)" : "var(--fg)", textDecoration: "none", fontSize: 10.5, fontWeight: 700 }}>{label}</Link>;
}
