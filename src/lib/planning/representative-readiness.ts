import type { PlanningCheck } from "@/lib/planning/types";

const DECISION_GRADE_CODES = [
  "bcr",
  "far",
  "height",
  "parking",
] as const;

export interface RepresentativeCheckBlocker {
  code: string;
  message: string;
  status: PlanningCheck["status"] | "missing";
}

export interface RepresentativeCheckReadiness {
  ready: boolean;
  blockers: RepresentativeCheckBlocker[];
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
  const blockers: RepresentativeCheckBlocker[] = [];
  const seen = new Set(normalizedChecks.map((check) => check.code));

  for (const check of normalizedChecks) {
    if (check.status === "fail") {
      blockers.push({
        code: check.code,
        message: check.message,
        status: check.status,
      });
      continue;
    }
    if (
      DECISION_GRADE_CODES.includes(
        check.code as (typeof DECISION_GRADE_CODES)[number],
      ) &&
      check.status !== "pass"
    ) {
      blockers.push({
        code: check.code,
        message: check.message,
        status: check.status,
      });
    }
  }

  for (const code of DECISION_GRADE_CODES) {
    if (!seen.has(code)) {
      blockers.push({
        code,
        message: `${code} 검증 결과가 생성되지 않았습니다.`,
        status: "missing",
      });
    }
  }

  const unique = new Map<string, RepresentativeCheckBlocker>();
  for (const blocker of blockers) {
    unique.set(blocker.code, blocker);
  }
  return {
    ready: unique.size === 0,
    blockers: [...unique.values()],
  };
}
