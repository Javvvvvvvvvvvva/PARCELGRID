import type { HandoffDiscipline } from "./evidence-gate";

export type ExpertReviewStatus =
  | "not-requested"
  | "requested"
  | "in-review"
  | "approved"
  | "changes-requested";

export type ExpertReviewerRole =
  | "architect"
  | "developer"
  | "cost-manager"
  | "project-manager"
  | "finance-specialist"
  | "accountant"
  | "tax-advisor"
  | "insurance-underwriter"
  | "risk-engineer"
  | "sales-marketing"
  | "licensed-broker";

export interface ExpertReviewAttestations {
  snapshotReviewed: boolean;
  evidenceReviewed: boolean;
  preliminaryLimitAcknowledged: boolean;
}

export interface ExpertReviewEvent {
  status: Exclude<ExpertReviewStatus, "not-requested">;
  actor: string;
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  reviewerRole?: ExpertReviewerRole;
  occurredAt: string;
  snapshotKey: string;
  eventId?: string;
  ledgerHash?: string;
}

export interface ExpertReviewRecord {
  discipline: HandoffDiscipline;
  status: ExpertReviewStatus;
  reviewer: string;
  organization: string;
  reviewerRole?: ExpertReviewerRole;
  requestedBy?: string;
  requestedAt?: string;
  evidenceRef: string;
  notes: string;
  reviewedAt: string;
  updatedAt: string;
  /**
   * 검토자가 실제로 확인한 Stage 3 계산·Geometry·원문 묶음.
   * 예전 저장 기록에는 없을 수 있으며 그런 기록은 재승인이 필요하다.
   */
  snapshotKey?: string;
  attestations?: ExpertReviewAttestations;
  /** 같은 Snapshot Key 안에서 요청·검토·결정 순서를 보존하는 감사 이력. */
  history?: ExpertReviewEvent[];
}

export type ExpertReviewMap = Partial<
  Record<HandoffDiscipline, ExpertReviewRecord>
>;

export interface ExpertReviewValidation {
  valid: boolean;
  errors: string[];
  stale: boolean;
}

export interface ExpertReviewSummary {
  requiredDisciplines: HandoffDiscipline[];
  approvedCount: number;
  requestedCount: number;
  inReviewCount: number;
  changesRequestedCount: number;
  missingDisciplines: HandoffDiscipline[];
  staleDisciplines: HandoffDiscipline[];
  invalidDisciplines: Array<{
    discipline: HandoffDiscipline;
    errors: string[];
  }>;
  ready: boolean;
}

export const REQUIRED_HANDOFF_DISCIPLINES: HandoffDiscipline[] = [
  "architect",
  "developer",
  "finance-tax",
  "insurance-risk",
  "sales-marketing",
];

export const EXPERT_REVIEWER_ROLE_META: Record<
  ExpertReviewerRole,
  { label: string; disciplines: HandoffDiscipline[] }
> = {
  architect: { label: "건축사", disciplines: ["architect"] },
  developer: { label: "시행 담당", disciplines: ["developer"] },
  "cost-manager": { label: "원가·QS", disciplines: ["developer"] },
  "project-manager": { label: "프로젝트 관리", disciplines: ["developer"] },
  "finance-specialist": {
    label: "금융 심사",
    disciplines: ["finance-tax"],
  },
  accountant: { label: "회계사", disciplines: ["finance-tax"] },
  "tax-advisor": { label: "세무사", disciplines: ["finance-tax"] },
  "insurance-underwriter": {
    label: "보험 인수심사",
    disciplines: ["insurance-risk"],
  },
  "risk-engineer": {
    label: "보험 위험관리",
    disciplines: ["insurance-risk"],
  },
  "sales-marketing": {
    label: "분양·마케팅",
    disciplines: ["sales-marketing"],
  },
  "licensed-broker": {
    label: "공인중개사",
    disciplines: ["sales-marketing"],
  },
};

export function reviewerRolesForDiscipline(
  discipline: HandoffDiscipline
): ExpertReviewerRole[] {
  return (Object.keys(EXPERT_REVIEWER_ROLE_META) as ExpertReviewerRole[]).filter(
    (role) => EXPERT_REVIEWER_ROLE_META[role].disciplines.includes(discipline)
  );
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isIsoDateTime(value: string): boolean {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

function validateReviewHistory(record: ExpertReviewRecord): string[] {
  const errors: string[] = [];
  const history = record.history ?? [];
  if (history.length === 0) {
    return ["검토 요청부터 현재 상태까지의 감사 이력이 필요합니다."];
  }
  const currentSnapshotHistory = history.filter(
    (event) => event.snapshotKey === record.snapshotKey
  );
  if (currentSnapshotHistory.length === 0) {
    return ["현재 Snapshot Key에 연결된 검토 상태 이력이 없습니다."];
  }
  let previous: ExpertReviewStatus = "not-requested";
  for (const event of currentSnapshotHistory) {
    const previousEvent = history[history.indexOf(event) - 1];
    if (event.status === "requested" && previousEvent && previousEvent.snapshotKey !== event.snapshotKey) {
      previous = "not-requested";
    }
    if (!event.actor.trim()) errors.push("검토 이력의 수행자 이름이 필요합니다.");
    if (!isIsoDateTime(event.occurredAt)) {
      errors.push("검토 이력 시각이 올바르지 않습니다.");
    }
    const transition = validateExpertReviewTransition(previous, event.status);
    if (!transition.valid) {
      errors.push(transition.error ?? "검토 이력의 상태 순서가 올바르지 않습니다.");
      break;
    }
    previous = event.status;
  }
  if (previous !== record.status) {
    errors.push("검토 이력의 마지막 상태와 현재 상태가 일치하지 않습니다.");
  }
  return [...new Set(errors)];
}

export function validateExpertReview(
  record: ExpertReviewRecord,
  expectedSnapshotKey?: string
): ExpertReviewValidation {
  const errors: string[] = [];
  let stale = false;
  if (record.status === "not-requested") {
    return { valid: true, errors, stale };
  }
  if (!record.requestedBy?.trim()) errors.push("검토 요청자 이름이 필요합니다.");
  if (!record.requestedAt || !isIsoDate(record.requestedAt)) {
    errors.push("검토 요청일이 올바르지 않습니다.");
  }
  if (record.status !== "requested") {
    if (!record.reviewer.trim()) errors.push("담당자 이름이 필요합니다.");
    if (!record.organization.trim()) errors.push("소속 또는 역할이 필요합니다.");
    if (!record.reviewerRole) {
      errors.push("전문가 역할을 선택해야 합니다.");
    } else if (
      !EXPERT_REVIEWER_ROLE_META[record.reviewerRole] ||
      !EXPERT_REVIEWER_ROLE_META[record.reviewerRole].disciplines.includes(
        record.discipline
      )
    ) {
      errors.push(
        `${EXPERT_REVIEWER_ROLE_META[record.reviewerRole]?.label ?? "선택한 전문가"} 역할은 ${disciplineLabel(record.discipline)} 분야를 승인할 수 없습니다.`
      );
    }
    if (!isIsoDate(record.reviewedAt)) errors.push("검토일이 올바르지 않습니다.");
  }
  if (!record.snapshotKey?.trim()) {
    errors.push("검토 대상 Stage 3 스냅샷이 기록되지 않았습니다. 다시 검토해야 합니다.");
    stale = true;
  } else if (
    expectedSnapshotKey &&
    record.snapshotKey !== expectedSnapshotKey
  ) {
    errors.push("승인 후 계획·사업성 또는 근거자료가 변경됐습니다. 다시 검토해야 합니다.");
    stale = true;
  }
  if (record.snapshotKey?.trim()) {
    errors.push(...validateReviewHistory(record));
  }
  if (
    (record.status === "approved" || record.status === "changes-requested") &&
    !record.evidenceRef.trim()
  ) {
    errors.push("승인 또는 수정 요청에는 근거 문서 참조가 필요합니다.");
  }
  if (record.status === "changes-requested" && !record.notes.trim()) {
    errors.push("수정 요청 내용을 입력해야 합니다.");
  }
  if (record.status === "approved" && !record.notes.trim()) {
    errors.push("승인 범위와 잔여 조건을 검토 의견에 기록해야 합니다.");
  }
  if (record.status === "approved") {
    if (!record.attestations?.snapshotReviewed) {
      errors.push("현재 계산·Geometry 스냅샷 확인이 필요합니다.");
    }
    if (!record.attestations?.evidenceReviewed) {
      errors.push("분야별 근거자료 확인이 필요합니다.");
    }
    if (!record.attestations?.preliminaryLimitAcknowledged) {
      errors.push("예비 타당성 모델의 사용 한계 확인이 필요합니다.");
    }
  }
  return { valid: errors.length === 0, errors, stale };
}

function disciplineLabel(discipline: HandoffDiscipline): string {
  if (discipline === "architect") return "건축";
  if (discipline === "developer") return "시행·원가";
  if (discipline === "finance-tax") return "금융·회계·세무";
  if (discipline === "insurance-risk") return "보험·리스크";
  return "분양·마케팅";
}

export interface ExpertReviewTransitionValidation {
  valid: boolean;
  error?: string;
}

const ALLOWED_REVIEW_TRANSITIONS: Record<
  ExpertReviewStatus,
  ExpertReviewStatus[]
> = {
  "not-requested": ["requested"],
  requested: ["requested", "in-review"],
  "in-review": ["in-review", "approved", "changes-requested"],
  "changes-requested": ["changes-requested", "requested"],
  approved: ["approved", "requested"],
};

export function validateExpertReviewTransition(
  from: ExpertReviewStatus,
  to: ExpertReviewStatus
): ExpertReviewTransitionValidation {
  if (ALLOWED_REVIEW_TRANSITIONS[from].includes(to)) return { valid: true };
  return {
    valid: false,
    error:
      "검토 요청, 검토 시작, 승인·수정 요청 순서로 상태를 변경해야 합니다.",
  };
}

export function buildExpertReviewSummary(
  records: ExpertReviewMap,
  expectedSnapshotKey?: string
): ExpertReviewSummary {
  const missingDisciplines: HandoffDiscipline[] = [];
  const staleDisciplines: HandoffDiscipline[] = [];
  const invalidDisciplines: ExpertReviewSummary["invalidDisciplines"] = [];
  let approvedCount = 0;
  let requestedCount = 0;
  let inReviewCount = 0;
  let changesRequestedCount = 0;

  for (const discipline of REQUIRED_HANDOFF_DISCIPLINES) {
    const record = records[discipline];
    if (!record || record.status === "not-requested") {
      missingDisciplines.push(discipline);
      continue;
    }
    const validation = validateExpertReview(record, expectedSnapshotKey);
    if (!validation.valid) {
      invalidDisciplines.push({ discipline, errors: validation.errors });
      if (validation.stale) staleDisciplines.push(discipline);
      continue;
    }
    if (record.status === "approved") approvedCount += 1;
    if (record.status === "requested") requestedCount += 1;
    if (record.status === "in-review") inReviewCount += 1;
    if (record.status === "changes-requested") changesRequestedCount += 1;
  }

  return {
    requiredDisciplines: REQUIRED_HANDOFF_DISCIPLINES,
    approvedCount,
    requestedCount,
    inReviewCount,
    changesRequestedCount,
    missingDisciplines,
    staleDisciplines,
    invalidDisciplines,
    ready:
      approvedCount === REQUIRED_HANDOFF_DISCIPLINES.length &&
      invalidDisciplines.length === 0,
  };
}
