/// <reference lib="webworker" />
import { prepareReviewVerification, type ReviewVerificationRequest } from "./review-verification-task";

self.onmessage = (event: MessageEvent<ReviewVerificationRequest>) => {
  void prepareReviewVerification(event.data).then(
    result => self.postMessage({ type: "result", result }),
    () => self.postMessage({ type: "error", error: "통합 재검사에 실패했습니다. 입력과 지원 범위를 확인해 주세요." }),
  );
};
