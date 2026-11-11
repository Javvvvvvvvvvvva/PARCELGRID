export type MolitIssue = "not-configured" | "access-denied" | "rate-limit" | "timeout" | "network" | "http-error" | "provider-error" | "invalid-response" | "page-limit" | "capacity-limit" | "range-limit" | "size-limit";

export interface MolitRangeEvidence {
  source: "MOLIT";
  type: string;
  lawdCd: string;
  startYearMonth: string;
  endYearMonth: string;
  /** Range aggregation time; sourceRetrievals retains original fetch times across cache hits. */
  retrievedAt: string;
  sourceRetrievals?: Array<{ month: string; oldestFetchedAt: string; newestFetchedAt: string }>;
  status: "complete" | "partial" | "unavailable";
  completedMonths: string[];
  failedMonths: Array<{ month: string; issue: MolitIssue }>;
  transactionCount: number;
}

export const MOLIT_ISSUE_LABELS: Record<MolitIssue, string> = {
  "not-configured": "키 미설정", "access-denied": "접근 거절", "rate-limit": "요청 한도",
  timeout: "시간 초과", network: "연결 실패", "http-error": "HTTP 오류",
  "provider-error": "제공자 오류", "invalid-response": "응답 검증 실패", "page-limit": "페이지 상한",
  "capacity-limit": "조회 처리 용량 초과 · 재시도 필요", "range-limit": "지원 조회 기간 초과",
  "size-limit": "조회 결과 용량 초과 · 범위 분할 필요",
};

export function transactionEvidenceComplete(evidence: MolitRangeEvidence[] | undefined): boolean {
  return Boolean(evidence?.length && evidence.every(item => item.status === "complete" && item.completedMonths.length > 0 && item.failedMonths.length === 0));
}

export function transactionEvidenceMessage(evidence: MolitRangeEvidence[] | undefined): string {
  if (!evidence?.length) return "실거래 조회 근거 미확보 · 시드·기존 저장값 또는 미조회입니다. 거래 0건으로 확정하지 않습니다.";
  const complete = evidence.reduce((sum, item) => sum + item.completedMonths.length, 0);
  const failed = evidence.reduce((sum, item) => sum + item.failedMonths.length, 0);
  const count = evidence.reduce((sum, item) => sum + item.transactionCount, 0);
  return failed
    ? `실거래 ${complete ? "부분 조회" : "조회 실패"} · 유형별 월 조회 ${complete}건 완료 / ${failed}건 실패 · 확보 거래 ${count}건. 실패한 범위는 거래 0건이 아니며 자동 단가 보정에 사용하지 않습니다.`
    : `요청한 실거래 범위 조회 완료 · 유형별 월 조회 ${complete}건 · ${count}건 수신. 원문·거래 취소·대상 부지 적합성은 별도 확인이 필요합니다.`;
}
