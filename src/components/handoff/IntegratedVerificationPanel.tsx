"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import type { IntegratedVerificationReport } from "@/lib/handoff/integrated-verification";
import type { ReviewSnapshotPayload } from "@/lib/handoff/review-snapshot";
import { QuantityCostSummary } from "./QuantityCostSummary";
import { ConstructionQuoteSummary } from "./ConstructionQuoteSummary";
import "./integrated-verification.css";
import { clientSession } from "@/lib/auth/client-session";

const STATUS_LABEL = {
  checked: "모델 검사 통과",
  review: "추가 검토",
  missing: "자료 누락",
  fail: "충돌",
  "not-applicable": "해당 없음",
} as const;
const DISCIPLINE_LABEL = {
  architect: "건축", developer: "시행·원가", "finance-tax": "재무·세무",
  "insurance-risk": "보험·위험", "sales-marketing": "분양·홍보",
} as const;

export function IntegratedVerificationPanel({
  projectId, report, packet, snapshotKey, sealed,
}: {
  projectId: string;
  report: IntegratedVerificationReport | null;
  packet: ReviewSnapshotPayload | null;
  snapshotKey: string | null;
  sealed: boolean;
}) {
  if (!report) return null;
  const blockers = report.checks.filter((check) => check.status === "fail" || check.status === "missing");
  const priority = { fail: 0, missing: 1, review: 2, checked: 3, "not-applicable": 4 };
  const orderedChecks = [...report.checks].sort((left, right) => priority[left.status] - priority[right.status]);
  const limits = <>
    <ul>{report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
    <dl>{Object.entries(report.modelVersions).map(([model, version]) => <div key={model}><dt>{model}</dt><dd>{version}</dd></div>)}</dl>
  </>;
  const download = () => {
    if (!clientSession.active || !packet || !snapshotKey) return;
    const blob = new Blob([JSON.stringify({
      version: "integrated-review-export-2026.1",
      snapshotKey, serverSealConfirmed: sealed,
      officialBoundaryStatus: "unverified", permitStatus: "unverified",
      professionalCredentialStatus: "unverified", snapshot: packet,
    }, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `PARCELGRID-review-${encodeURIComponent(projectId)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="integrated-verification" aria-label="통합 검증 자료">
      <header className="iv-heading">
        <div>
          <h2>통합 검증 자료</h2>
          <p>{packet ? "대표안 저장본" : "미봉인 예비 점검"} · 충돌·누락 {blockers.length}건 · {sealed ? "서버 봉인 확인" : "서버 봉인 미확인"}</p>
        </div>
        <button className="iv-download" type="button" title="원본 계획·형상·계산·검증 JSON 다운로드" disabled={!packet || !snapshotKey} onClick={download}>
          <Download size={16} aria-hidden="true" /> 검토 자료 다운로드
        </button>
      </header>
      <p className="iv-scope">공식 경계·허가·전문 자격 확인은 미확정입니다. 모델 검사와 앱의 분야별 검토 기록은 법정 적합 판정이나 관할 승인이 아닙니다.</p>
      <p className="iv-key">{snapshotKey ?? "현재 대표안과 사업성 저장본의 결속 미확정"}</p>
      <p className="iv-key" aria-label="저장 계산 모델">저장 계산 모델: {packet?.data.meta.version || "미확정"}</p>
      <QuantityCostSummary packet={packet} />
      <ConstructionQuoteSummary packet={packet} />
      <dl className="iv-checks">
        {orderedChecks.map((check) => (
          <div key={check.id} className="iv-check" data-status={check.status}>
            <dt>{check.label}<span className="iv-status">{DISCIPLINE_LABEL[check.discipline]} · {STATUS_LABEL[check.status]}</span></dt>
            <dd>{check.detail}</dd>
          </div>
        ))}
      </dl>
      <details className="iv-limits">
        <summary>검사 범위와 모델 버전</summary>
        {limits}
      </details>
      <section className="iv-limits iv-limits-print">
        <h3>검사 범위와 모델 버전</h3>
        {limits}
      </section>
      <nav className="iv-nav" aria-label="검증 보완 위치">
        <Link href={`/projects/${projectId}/envelope`}>계획·실내·피난·차량</Link>
        <Link href={`/projects/${projectId}`}>사업성·원가 근거</Link>
      </nav>
    </section>
  );
}
