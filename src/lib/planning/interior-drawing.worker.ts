import { buildInteriorDrawingExport } from "./interior-drawing-export";
import type { IntegratedVerificationInput } from "@/lib/handoff/integrated-verification";
import type { InteriorDrawingWorkerResponse } from "./interior-drawing-worker";

self.onmessage = (event: MessageEvent<IntegratedVerificationInput>) => {
  try {
    const result = buildInteriorDrawingExport(event.data);
    const response: InteriorDrawingWorkerResponse = { type: "result", result: {
      filename: result.filename, zipBytes: result.zipBytes,
      inputKey: result.metadata.inputKey, entityCount: result.metadata.entities.length,
    } };
    self.postMessage(response, { transfer: [result.zipBytes.buffer] });
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : "도면 생성에 실패했습니다." } satisfies InteriorDrawingWorkerResponse);
  }
};
