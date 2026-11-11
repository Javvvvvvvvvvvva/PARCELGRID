import type { PlanningRecommendationAnalysis } from "./recommendation-analysis";
import type { PlanningRecommendationEngineInput } from "./recommendation-engine";

export const RECOMMENDATION_WORKER_TIMEOUT_MS = 25_000;
export type RecommendationWorkerResponse =
  | { ok: true; result: PlanningRecommendationAnalysis }
  | { ok: false; error: string };

export function runPlanningRecommendationWorker(
  input: PlanningRecommendationEngineInput,
  signal: AbortSignal,
): Promise<PlanningRecommendationAnalysis> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("추천 계산이 취소되었습니다.", "AbortError")); return; }
    if (typeof Worker === "undefined") {
      reject(new Error("이 브라우저에서 백그라운드 계산을 시작할 수 없습니다. 기존 계획은 유지됩니다."));
      return;
    }
    let worker: Worker;
    try { worker = new Worker(new URL("./recommendation.worker.ts", import.meta.url)); }
    catch { reject(new Error("추천 계산 작업을 시작하지 못했습니다. 기존 계획은 유지됩니다.")); return; }
    let settled = false;
    const finish = (error?: Error, result?: PlanningRecommendationAnalysis) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DOMException("추천 계산이 취소되었습니다.", "AbortError"));
    const timer = setTimeout(() => finish(new Error(
      "추천 계산 제한 시간을 초과했습니다. 최적안은 확정하지 않았으며 기존 계획은 유지됩니다.",
    )), RECOMMENDATION_WORKER_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<RecommendationWorkerResponse>) => {
      const response = event.data;
      if (response?.ok && response.result) finish(undefined, response.result);
      else finish(new Error(response && !response.ok ? response.error : "추천 계산 결과를 읽지 못했습니다."));
    };
    worker.onerror = () => finish(new Error("추천 계산 중 오류가 발생했습니다. 기존 계획은 유지됩니다."));
    worker.onmessageerror = () => finish(new Error("추천 계산 결과를 읽지 못했습니다. 기존 계획은 유지됩니다."));
    try { worker.postMessage(input); }
    catch { finish(new Error("추천 계산 입력을 전달하지 못했습니다. 기존 계획은 유지됩니다.")); }
  });
}
