"use client";

import { useEffect, useRef, useState } from "react";
import { clientSession } from "@/lib/auth/client-session";
import { runReviewVerificationWorker } from "@/lib/handoff/review-verification-worker";
import type { ReviewVerificationRequest, ReviewVerificationResult } from "@/lib/handoff/review-verification-task";

type VerificationState = {
  request: ReviewVerificationRequest;
  result: ReviewVerificationResult | null;
  error: string | null;
  status: "pending" | "ready" | "error";
};

export function useReviewVerification(request: ReviewVerificationRequest | null) {
  const [state, setState] = useState<VerificationState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const currentRequest = useRef(request);
  currentRequest.current = request;

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    pending.current = controller;
    let active = true;
    const fail = (message: string) => {
      if (active && currentRequest.current === request) setState({ request, status: "error", result: null, error: message });
    };
    const unsubscribe = clientSession.subscribe(() => {
      controller.abort();
      fail("사용자 세션이 변경되어 통합 재검사가 해제됐습니다.");
    });
    setState({ request, result: null, error: null, status: "pending" });
    const run = async () => {
      try {
        clientSession.assertActive();
        const result = await runReviewVerificationWorker(request, controller.signal);
        clientSession.assertActive();
        if (active && !controller.signal.aborted && currentRequest.current === request) {
          setState({ request, result, error: null, status: "ready" });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          fail(error instanceof Error ? error.message : "통합 재검사 결과를 확인하지 못했습니다.");
        }
      } finally {
        if (pending.current === controller) pending.current = null;
      }
    };
    void run();
    return () => { active = false; controller.abort(); unsubscribe(); if (pending.current === controller) pending.current = null; };
  }, [request, attempt]);

  const current = state?.request === request ? state : null;
  const result = current?.status === "ready" && clientSession.active ? current.result : null;
  return {
    result,
    report: result?.kind === "saved" ? result.payload.verification : result?.report ?? null,
    payload: result?.kind === "saved" ? result.payload : null,
    status: request ? current?.status ?? "pending" : "idle",
    error: current?.error ?? null,
    cancel: () => {
      if (request && pending.current) {
        setState({ request, result: null, error: "통합 재검사를 취소했습니다. 현재 검증은 미완료입니다.", status: "error" });
        pending.current.abort();
      }
    },
    retry: () => { setState(null); setAttempt(value => value + 1); },
  };
}
