export type VworldContextSource = "LT_L_SPRD" | "LP_PA_CBND_BUBUN" | "LT_C_UPISUQ151" | "dt_d010";

export type VworldSourceEvidence = {
  source: VworldContextSource;
} & (
  | { status: "available" | "empty"; resultCount: number; issue: null }
  | {
      status: "unavailable";
      resultCount: null;
      issue: "disabled" | "not-configured" | "request-failed" | "not-recorded";
    }
);

export function vworldResultEvidence(
  source: VworldContextSource,
  resultCount: number,
): VworldSourceEvidence {
  return { source, status: resultCount > 0 ? "available" : "empty", resultCount, issue: null };
}

export function vworldUnavailableEvidence(
  source: VworldContextSource,
  issue: Extract<VworldSourceEvidence, { status: "unavailable" }>["issue"],
): VworldSourceEvidence {
  return { source, status: "unavailable", resultCount: null, issue };
}

const SOURCE_LABELS: Record<VworldContextSource, string> = {
  LT_L_SPRD: "도로 중심선",
  LP_PA_CBND_BUBUN: "주변 지적 필지",
  LT_C_UPISUQ151: "도시계획 도로 경계",
  dt_d010: "건물 외곽선",
};

export function vworldEvidenceWarnings(evidence: VworldSourceEvidence[]): string[] {
  return evidence.flatMap((item) => {
    if (item.status === "available") return [];
    const outcome = item.status === "empty"
      ? "조회 결과가 0건입니다."
      : "데이터를 확인하지 못했습니다.";
    return [`VWorld ${SOURCE_LABELS[item.source]} ${outcome} 도로·건물의 실제 유무는 별도 확인이 필요합니다.`];
  });
}
