import type { PlanningCheck } from "@/lib/planning/types";

const DECISION_GRADE_CODES = [
  "bcr",
  "far",
  "height",
  "parking",
] as const;

// New area-only dwelling programs cannot acquire a final geometry approval from rectangle packing.
const CONDITIONAL_DECISION_CODES = new Set(["dwelling-layout-verification", "vehicle-circulation", "egress-core", "layout-finance-adoption"]);

export interface RepresentativeCheckBlocker {
  code: string;
  message: string;
  status: PlanningCheck["status"] | "missing";
}

export interface RepresentativeCheckReadiness {
  ready: boolean;
  blockers: RepresentativeCheckBlocker[];
  advisories: RepresentativeCheckBlocker[];
  blockingFailureCount: number;
  blockingVerificationCount: number;
  advisoryCount: number;
}

const BLOCKER_PRIORITY: Record<RepresentativeCheckBlocker["status"], number> = {
  pass: 0,
  review: 1,
  unknown: 2,
  missing: 3,
  fail: 4,
};

function keepHighestPriority(
  target: Map<string, RepresentativeCheckBlocker>,
  item: RepresentativeCheckBlocker,
): void {
  const current = target.get(item.code);
  if (!current || BLOCKER_PRIORITY[item.status] > BLOCKER_PRIORITY[current.status]) {
    target.set(item.code, item);
  }
}

/**
 * 대표안은 단순한 화면 선택이 아니라 Stage 3 계산과 보고서의 입력 계약이다.
 * 모든 실패 항목을 차단하고, 핵심 법규·주차 항목은 review/unknown도 통과로
 * 승격하지 않는다. 사용자는 원문·전문가 확인으로 각 항목을 pass로 만든 뒤
 * 대표안을 잠가야 한다.
 */
export function assessRepresentativeCheckReadiness(
  checks: PlanningCheck[] | null | undefined,
): RepresentativeCheckReadiness {
  const normalizedChecks = checks ?? [];
  const blockers = new Map<string, RepresentativeCheckBlocker>();
  const advisories = new Map<string, RepresentativeCheckBlocker>();
  const seen = new Set(normalizedChecks.map((check) => check.code));

  for (const check of normalizedChecks) {
    if (check.status === "fail") {
      keepHighestPriority(blockers, {
        code: check.code,
        message: check.message,
        status: check.status,
      });
      continue;
    }
    if (
      (check.code.startsWith("interior-layout:") || check.code.startsWith("room-layout:") || CONDITIONAL_DECISION_CODES.has(check.code) || DECISION_GRADE_CODES.includes(
        check.code as (typeof DECISION_GRADE_CODES)[number],
      )) &&
      check.status !== "pass"
    ) {
      keepHighestPriority(blockers, {
        code: check.code,
        message: check.message,
        status: check.status,
      });
      continue;
    }
    if (check.status === "review" || check.status === "unknown") {
      keepHighestPriority(advisories, {
        code: check.code,
        message: check.message,
        status: check.status,
      });
    }
  }

  for (const code of DECISION_GRADE_CODES) {
    if (!seen.has(code)) {
      keepHighestPriority(blockers, {
        code,
        message: `${code} 검증 결과가 생성되지 않았습니다.`,
        status: "missing",
      });
    }
  }

  for (const code of blockers.keys()) {
    advisories.delete(code);
  }
  const blockerList = [...blockers.values()];
  const advisoryList = [...advisories.values()];
  return {
    ready: blockerList.length === 0,
    blockers: blockerList,
    advisories: advisoryList,
    blockingFailureCount: blockerList.filter((item) => item.status === "fail")
      .length,
    blockingVerificationCount: blockerList.filter(
      (item) => item.status !== "fail",
    ).length,
    advisoryCount: advisoryList.length,
  };
}
