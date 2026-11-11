"use client";

import { LoaderCircle, RefreshCw, X } from "lucide-react";
import type { useReviewVerification } from "@/lib/hooks/use-review-verification";
import "./integrated-verification.css";

export function ReviewVerificationStatus({ work }: { work: ReturnType<typeof useReviewVerification> }) {
  if (work.status === "ready" || work.status === "idle") return null;
  return <section className="iv-work" aria-label="통합 재검사 상태" aria-busy={work.status === "pending"}>
    <p role={work.status === "error" ? "alert" : "status"}>
      {work.status === "pending" ? <><LoaderCircle size={16} aria-hidden="true" /> 통합 재검사 중 · 현재 검증 미완료</> : work.error}
    </p>
    {work.status === "pending"
      ? <button type="button" className="iv-download" title="통합 재검사 취소" aria-label="통합 재검사 취소" onClick={work.cancel}><X size={16} aria-hidden="true" /></button>
      : <button type="button" className="iv-download" title="통합 재검사 다시 실행" aria-label="통합 재검사 다시 실행" onClick={work.retry}><RefreshCw size={16} aria-hidden="true" /></button>}
  </section>;
}
