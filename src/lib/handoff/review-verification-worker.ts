import type { ReviewVerificationRequest, ReviewVerificationResult } from "./review-verification-task";

export const REVIEW_VERIFICATION_TIMEOUT_MS = 20_000;

function matchesRequest(result: ReviewVerificationResult, request: ReviewVerificationRequest): boolean {
  if (!result || result.kind !== request.kind) return false;
  const report = result.kind === "saved" ? result.payload?.verification : result.report;
  if (!report || typeof report.version !== "string" || report.approvalStatus !== "unverified" || !Array.isArray(report.checks) ||
      !Array.isArray(report.limitations) || !report.modelVersions ||
      !["incomplete", "conflict", "preliminary"].includes(report.status)) return false;
  if (result.kind !== "saved" || request.kind !== "saved") return true;
  const expected = request.input.snapshot, packet = result.payload;
  return /^PG-REVIEW-SHA256-[A-F0-9]{64}$/.test(result.snapshotKey) &&
    packet.projectId === expected.projectId && packet.representativeScenarioId === expected.representativeScenarioId &&
    packet.representativeScenarioVersion === expected.representativeScenarioVersion && packet.geometryHash === expected.geometryHash;
}

export function runReviewVerificationWorker(request: ReviewVerificationRequest, signal: AbortSignal): Promise<ReviewVerificationResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("통합 재검사를 취소했습니다.", "AbortError")); return; }
    if (typeof Worker === "undefined") { reject(new Error("백그라운드 검증을 사용할 수 없습니다.")); return; }
    let worker: Worker;
    try { worker = new Worker(new URL("./review-verification.worker.ts", import.meta.url)); }
    catch { reject(new Error("통합 재검사 작업을 시작하지 못했습니다.")); return; }
    const started = performance.now();
    let settled = false;
    const finish = (error?: Error, result?: ReviewVerificationResult) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const timeout = () => finish(new Error("통합 재검사 제한 시간을 초과했습니다. 현재 검증은 미완료입니다."));
    const abort = () => finish(new DOMException("통합 재검사를 취소했습니다.", "AbortError"));
    const timer = setTimeout(timeout, REVIEW_VERIFICATION_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: string; result?: ReviewVerificationResult }>) => {
      if (settled) return;
      if (signal.aborted) { abort(); return; }
      if (performance.now() - started >= REVIEW_VERIFICATION_TIMEOUT_MS) { timeout(); return; }
      if (event.data?.type === "result" && event.data.result && matchesRequest(event.data.result, request)) {
        finish(undefined, event.data.result);
      } else finish(new Error("현재 입력에 연결된 통합 재검사 결과를 확인하지 못했습니다."));
    };
    worker.onerror = worker.onmessageerror = () => finish(new Error("통합 재검사가 중단됐습니다. 현재 검증은 미완료입니다."));
    try { worker.postMessage(request); }
    catch { finish(new Error("통합 재검사 입력을 전달하지 못했습니다.")); }
  });
}
