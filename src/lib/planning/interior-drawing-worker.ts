import type { IntegratedVerificationInput } from "@/lib/handoff/integrated-verification";

export const INTERIOR_DRAWING_WORKER_TIMEOUT_MS = 20_000;
export interface InteriorDrawingDownload {
  filename: string;
  zipBytes: Uint8Array;
  inputKey: string;
  entityCount: number;
}
export type InteriorDrawingWorkerResponse =
  | { type: "result"; result: InteriorDrawingDownload }
  | { type: "error"; error: string };

export function runInteriorDrawingWorker(input: IntegratedVerificationInput, signal: AbortSignal): Promise<InteriorDrawingDownload> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("도면 생성이 취소되었습니다.", "AbortError")); return; }
    if (typeof Worker === "undefined") { reject(new Error("백그라운드 도면 생성을 사용할 수 없습니다.")); return; }
    let worker: Worker;
    try { worker = new Worker(new URL("./interior-drawing.worker.ts", import.meta.url)); }
    catch { reject(new Error("도면 생성 작업을 시작하지 못했습니다.")); return; }
    let settled = false;
    const deadline = performance.now() + INTERIOR_DRAWING_WORKER_TIMEOUT_MS;
    const finish = (error?: Error, result?: InteriorDrawingDownload) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException("도면 생성이 취소되었습니다.", "AbortError"));
    const timer = setTimeout(() => finish(new Error("도면 생성 제한 시간을 초과했습니다. 파일을 생성하지 않았습니다.")), INTERIOR_DRAWING_WORKER_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<InteriorDrawingWorkerResponse>) => {
      if (settled) return;
      if (performance.now() > deadline) {
        finish(new Error("도면 생성 제한 시간을 초과했습니다. 파일을 생성하지 않았습니다.")); return;
      }
      const response = event.data;
      if (response?.type === "error") { finish(new Error(response.error)); return; }
      const result = response?.type === "result" ? response.result : null;
      if (!result || !(result.zipBytes instanceof Uint8Array) || !result.zipBytes.byteLength || result.zipBytes.byteLength > 20_100_000 ||
          !Number.isInteger(result.entityCount) || result.entityCount < 1 || result.entityCount > 5000 ||
          !/^PG-ANALYSIS-[a-f0-9]{64}$/.test(result.inputKey) ||
          result.filename !== `PARCELGRID-interior-${result.inputKey.slice(-16)}.zip`) {
        finish(new Error("도면 패키지 결과를 읽지 못했습니다.")); return;
      }
      finish(undefined, result);
    };
    worker.onerror = worker.onmessageerror = () => finish(new Error("도면 생성 작업이 중단됐습니다."));
    try { worker.postMessage(input); }
    catch { finish(new Error("도면 원본을 전달하지 못했습니다.")); }
  });
}
