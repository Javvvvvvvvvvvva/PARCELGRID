import type { InteriorAutomationInput, InteriorAutomationProgress, InteriorAutomationResult } from "./interior-automation";
import type { PlanningScenario } from "./types";

export const INTERIOR_AUTOMATION_WORKER_TIMEOUT_MS = 12_000;
export type InteriorAutomationWorkerResponse =
  | { type: "progress"; progress: InteriorAutomationProgress }
  | { type: "result"; result: InteriorAutomationResult }
  | { type: "applied"; patch: Partial<PlanningScenario> }
  | { type: "error"; error: string };
export type InteriorAutomationWorkerRequest = { type: "generate"; input: InteriorAutomationInput }
  | { type: "apply"; input: InteriorAutomationInput; result: InteriorAutomationResult };

function runWorker(request: InteriorAutomationWorkerRequest, signal: AbortSignal,
  progress?: (value: InteriorAutomationProgress) => void): Promise<Extract<InteriorAutomationWorkerResponse, { type: "result" | "applied" }>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("일괄 구획 생성이 취소되었습니다.", "AbortError")); return; }
    if (typeof Worker === "undefined") { reject(new Error("백그라운드 계산을 사용할 수 없습니다. 기존 계획은 유지됩니다.")); return; }
    let worker: Worker;
    try { worker = new Worker(new URL("./interior-automation.worker.ts", import.meta.url)); }
    catch { reject(new Error("구획 계산 작업을 시작하지 못했습니다.")); return; }
    let settled = false;
    const finish = (error?: Error, result?: Extract<InteriorAutomationWorkerResponse, { type: "result" | "applied" }>) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException("일괄 구획 생성이 취소되었습니다.", "AbortError"));
    const timer = setTimeout(() => finish(new Error("일괄 구획 생성 제한 시간을 초과했습니다. 기존 계획은 유지됩니다.")), INTERIOR_AUTOMATION_WORKER_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<InteriorAutomationWorkerResponse>) => {
      if (settled) return;
      const response = event.data;
      if (response?.type === "progress") { progress?.(response.progress); return; }
      if ((request.type === "generate" && response?.type === "result" && response.result) ||
          (request.type === "apply" && response?.type === "applied" && response.patch)) finish(undefined, response);
      else finish(new Error(response?.type === "error" ? response.error : "일괄 구획 결과를 읽지 못했습니다."));
    };
    worker.onerror = worker.onmessageerror = () => finish(new Error("일괄 구획 계산이 중단됐습니다. 기존 계획은 유지됩니다."));
    try { worker.postMessage(request); }
    catch { finish(new Error("일괄 구획 입력을 전달하지 못했습니다.")); }
  });
}

export async function runInteriorAutomationWorker(input: InteriorAutomationInput, signal: AbortSignal,
  progress?: (value: InteriorAutomationProgress) => void): Promise<InteriorAutomationResult> {
  const response = await runWorker({ type: "generate", input }, signal, progress);
  if (response.type !== "result") throw new Error("구획 생성 결과 형식이 올바르지 않습니다.");
  return response.result;
}

export async function runInteriorAutomationApplyWorker(input: InteriorAutomationInput, result: InteriorAutomationResult,
  signal: AbortSignal): Promise<Partial<PlanningScenario>> {
  const response = await runWorker({ type: "apply", input, result }, signal);
  if (response.type !== "applied") throw new Error("구획 재검사 결과 형식이 올바르지 않습니다.");
  return response.patch;
}
