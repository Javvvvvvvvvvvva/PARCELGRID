import { buildIntegratedVerification, type IntegratedVerificationInput, type IntegratedVerificationReport } from "./integrated-verification";
import { buildReviewSnapshotPayload, buildServerReviewSnapshotKey, type ReviewSnapshotBuildInput, type ReviewSnapshotPayload } from "./review-snapshot";

export type ReviewVerificationRequest =
  | { kind: "saved"; input: ReviewSnapshotBuildInput }
  | { kind: "preview"; input: IntegratedVerificationInput };
export type ReviewVerificationResult =
  | { kind: "saved"; payload: ReviewSnapshotPayload; snapshotKey: string }
  | { kind: "preview"; report: IntegratedVerificationReport };

export async function prepareReviewVerification(request: ReviewVerificationRequest): Promise<ReviewVerificationResult> {
  if (request.kind === "preview") return { kind: "preview", report: buildIntegratedVerification(request.input) };
  const payload = buildReviewSnapshotPayload(request.input);
  return { kind: "saved", payload, snapshotKey: await buildServerReviewSnapshotKey(payload) };
}
