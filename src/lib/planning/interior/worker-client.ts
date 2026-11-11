import { wrap, type Remote } from "comlink";
import type { InteriorGenerationInput, InteriorGenerationResult } from "./types";
import type { SolarAccessInput, SolarAccessResult } from "../solar-access";

type WorkerApi = {
  generateInteriorCandidates: (input: InteriorGenerationInput) => InteriorGenerationResult;
  calculateSolarAccess: (input: SolarAccessInput) => SolarAccessResult;
};
export function createPlanningWorker() {
  const worker = new Worker(new URL("../../../workers/interior.worker.ts", import.meta.url));
  const api = wrap<WorkerApi>(worker);
  let reject: ((reason: Error) => void) | undefined;
  const interrupted = new Promise<never>((_, fail) => { reject = fail; });
  worker.addEventListener("error", () => reject?.(new Error("계산 작업을 실행하지 못했습니다. 새로고침 후 다시 시도하세요.")));
  return {
    run: async <T>(task: (remote: Remote<WorkerApi>) => Promise<T>): Promise<T> => {
      const timer = setTimeout(() => { worker.terminate(); reject?.(new Error("계산 시간이 초과됐습니다. 입력 범위를 줄여 다시 시도하세요.")); }, 30000);
      try { return await Promise.race([task(api), interrupted]); }
      finally { clearTimeout(timer); worker.terminate(); }
    },
    terminate: () => { worker.terminate(); reject?.(new Error("계산이 취소됐습니다.")); },
  };
}
