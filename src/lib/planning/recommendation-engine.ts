import {
  buildSteppedEnvelopeProfile as buildSteppedEnvelopeProfileV2,
  generatePlanningRecommendations as generatePlanningRecommendationsV2,
  type PlanningRecommendationEngineInput,
  type RecommendationEngineParcel,
} from "@/lib/planning/recommendation-engine-v2";

export * from "@/lib/planning/recommendation-engine-v2";

/**
 * 추천 후보의 법규 외곽선은 대표안/3D/Export와 동일한 법적 검토 기준을 쓴다.
 * `parcel.setback`은 사용자 설계 여유거리이므로 후보 생성 용량을 바꾸지 않는다.
 *
 * v2 내부의 호환 파라미터를 유지하면서 법적 검토 기본값(도로측 0m,
 * 인접대지측 0.5m)을 주입한다. 최종 공간 검증은
 * `legalEdgeSetbacksFromFrontage()`를 다시 사용하므로 같은 계약으로 대사된다.
 */
function withLegalEnvelopeSetback<T extends RecommendationEngineParcel>(parcel: T): T {
  return {
    ...parcel,
    setback: {
      road: 0,
      side: 0.5,
      rear: 0.5,
    },
  };
}

export function buildSteppedEnvelopeProfile(
  parcel: RecommendationEngineParcel,
  floors: number
) {
  return buildSteppedEnvelopeProfileV2(withLegalEnvelopeSetback(parcel), floors);
}

export function generatePlanningRecommendations(
  input: PlanningRecommendationEngineInput
) {
  return generatePlanningRecommendationsV2({
    ...input,
    parcel: withLegalEnvelopeSetback(input.parcel),
  });
}
