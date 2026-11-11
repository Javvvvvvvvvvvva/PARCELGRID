import { applyInteriorAutomation, generateInteriorAutomation } from "./interior-automation";
import type { InteriorAutomationWorkerRequest, InteriorAutomationWorkerResponse } from "./interior-automation-worker";

self.onmessage = (event: MessageEvent<InteriorAutomationWorkerRequest>) => {
  const send = (response: InteriorAutomationWorkerResponse) => self.postMessage(response);
  try {
    const request = event.data;
    if (request.type === "apply") send({ type: "applied", patch: applyInteriorAutomation(request.input, request.result) });
    else if (request.type === "generate") send({ type: "result", result: generateInteriorAutomation(request.input, progress => send({ type: "progress", progress })) });
    else send({ type: "error", error: "일괄 구획 요청 형식이 올바르지 않습니다." });
  } catch (error) { send({ type: "error", error: error instanceof Error ? error.message : "일괄 구획 계산을 완료하지 못했습니다." }); }
};
