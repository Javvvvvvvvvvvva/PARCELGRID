import { generatePlanningRecommendationsV2 } from "./recommendation-analysis";
import type { PlanningRecommendationEngineInput } from "./recommendation-engine";
import type { RecommendationWorkerResponse } from "./recommendation-worker";

self.onmessage = (event: MessageEvent<PlanningRecommendationEngineInput>) => {
  let response: RecommendationWorkerResponse;
  try { response = { ok: true, result: generatePlanningRecommendationsV2(event.data) }; }
  catch (error) { response = { ok: false, error: error instanceof Error ? error.message : "추천 계획안 계산 중 오류가 발생했습니다." }; }
  self.postMessage(response);
};
