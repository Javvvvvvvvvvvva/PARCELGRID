import type { HandoffDiscipline } from "./evidence-gate";

export type ExpertReviewStatus =
  | "not-requested"
  | "requested"
  | "approved"
  | "changes-requested";

export interface ExpertReviewRecord {
  discipline: HandoffDiscipline;
  status: ExpertReviewStatus;
  reviewer: string;
  organization: string;
  evidenceRef: string;
  notes: string;
  reviewedAt: string;
  updatedAt: string;
}

export type ExpertReviewMap = Partial<
  Record<HandoffDiscipline, ExpertReviewRecord>
>;

export interface ExpertReviewValidation {
  valid: boolean;
  errors: string[];
}

export interface ExpertReviewSummary {
  requiredDisciplines: HandoffDiscipline[];
  approvedCount: number;
  requestedCount: number;
  changesRequestedCount: number;
  missingDisciplines: HandoffDiscipline[];
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
  "sales-marketing",
];

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateExpertReview(
  record: ExpertReviewRecord
): ExpertReviewValidation {
  const errors: string[] = [];
  if (record.status === "not-requested") {
    return { valid: true, errors };
  }
  if (!record.reviewer.trim()) errors.push("담당자 이름이 필요합니다.");
  if (!record.organization.trim()) errors.push("소속 또는 역할이 필요합니다.");
  if (!isIsoDate(record.reviewedAt)) errors.push("검토일이 올바르지 않습니다.");
  if (
    (record.status === "approved" || record.status === "changes-requested") &&
    !record.evidenceRef.trim()
  ) {
    errors.push("승인 또는 수정 요청에는 근거 문서 참조가 필요합니다.");
  }
  if (record.status === "changes-requested" && !record.notes.trim()) {
    errors.push("수정 요청 내용을 입력해야 합니다.");
  }
  return { valid: errors.length === 0, errors };
}

export function buildExpertReviewSummary(
  records: ExpertReviewMap
): ExpertReviewSummary {
  const missingDisciplines: HandoffDiscipline[] = [];
  const invalidDisciplines: ExpertReviewSummary["invalidDisciplines"] = [];
  let approvedCount = 0;
  let requestedCount = 0;
  let changesRequestedCount = 0;

  for (const discipline of REQUIRED_HANDOFF_DISCIPLINES) {
    const record = records[discipline];
    if (!record || record.status === "not-requested") {
      missingDisciplines.push(discipline);
      continue;
    }
    const validation = validateExpertReview(record);
    if (!validation.valid) {
      invalidDisciplines.push({ discipline, errors: validation.errors });
      continue;
    }
    if (record.status === "approved") approvedCount += 1;
    if (record.status === "requested") requestedCount += 1;
    if (record.status === "changes-requested") changesRequestedCount += 1;
  }

  return {
    requiredDisciplines: REQUIRED_HANDOFF_DISCIPLINES,
    approvedCount,
    requestedCount,
    changesRequestedCount,
    missingDisciplines,
    invalidDisciplines,
    ready:
      approvedCount === REQUIRED_HANDOFF_DISCIPLINES.length &&
      invalidDisciplines.length === 0,
  };
}
