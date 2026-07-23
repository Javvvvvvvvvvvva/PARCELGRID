import type { FinancialSourceRecord } from "./source-data-gate";

export const SQM_PER_PYEONG = 3.305785;

export type PriceVerificationTarget = "acquisition" | "sale";
export type PriceVerificationStatus =
  | "draft"
  | "review-requested"
  | "verified"
  | "rejected";

export interface PriceComparableSnapshot {
  id: string;
  address: string;
  date: string;
  type: string;
  lotAreaSqm: number;
  pricePerPyeongManwon: number;
}

export interface PriceVerificationRecord {
  projectId: string;
  target: PriceVerificationTarget;
  status: PriceVerificationStatus;
  selectedComps: PriceComparableSnapshot[];
  medianPricePerPyeongManwon: number;
  adjustmentPct: number;
  verifiedPricePerPyeongManwon: number;
  verifiedTotalManwon: number;
  verifiedPricePerSqmWon: number;
  reviewer: string;
  organization: string;
  rationale: string;
  sourceModelVersion?: string | null;
  verifiedAt: string;
  updatedAt: string;
}

export interface PriceVerificationCalculation {
  medianPricePerPyeongManwon: number;
  verifiedPricePerPyeongManwon: number;
  verifiedTotalManwon: number;
  verifiedPricePerSqmWon: number;
}

export interface PriceVerificationValidation {
  valid: boolean;
  errors: string[];
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function calculatePriceVerification(
  lotAreaSqm: number,
  comps: PriceComparableSnapshot[],
  adjustmentPct: number
): PriceVerificationCalculation {
  if (!Number.isFinite(lotAreaSqm) || lotAreaSqm <= 0) {
    throw new Error("대지면적이 올바르지 않습니다.");
  }
  if (comps.length === 0) {
    throw new Error("선택된 비교 사례가 없습니다.");
  }
  if (!Number.isFinite(adjustmentPct) || Math.abs(adjustmentPct) > 30) {
    throw new Error("입지·상품 보정은 -30%~30% 범위여야 합니다.");
  }
  const prices = comps.map((comp) => comp.pricePerPyeongManwon);
  if (prices.some((price) => !Number.isFinite(price) || price <= 0)) {
    throw new Error("비교 사례의 평당가가 올바르지 않습니다.");
  }

  const medianPricePerPyeongManwon = median(prices);
  const verifiedPricePerPyeongManwon =
    medianPricePerPyeongManwon * (1 + adjustmentPct / 100);
  const lotAreaPyeong = lotAreaSqm / SQM_PER_PYEONG;

  return {
    medianPricePerPyeongManwon: round(medianPricePerPyeongManwon, 1),
    verifiedPricePerPyeongManwon: round(verifiedPricePerPyeongManwon, 1),
    verifiedTotalManwon: round(verifiedPricePerPyeongManwon * lotAreaPyeong),
    verifiedPricePerSqmWon: round(
      (verifiedPricePerPyeongManwon * 10_000) / SQM_PER_PYEONG
    ),
  };
}

export function validatePriceVerification(
  record: PriceVerificationRecord
): PriceVerificationValidation {
  const errors: string[] = [];
  if (record.selectedComps.length < 3) {
    errors.push("가격 확정에는 비교 사례를 최소 3건 선택해야 합니다.");
  }
  if (Math.abs(record.adjustmentPct) > 30) {
    errors.push("입지·상품 보정은 -30%~30% 범위여야 합니다.");
  }
  if (!record.reviewer.trim()) errors.push("검토자 이름이 필요합니다.");
  if (!record.organization.trim()) errors.push("소속 또는 역할이 필요합니다.");
  if (!record.rationale.trim()) errors.push("사례 채택과 보정 사유가 필요합니다.");
  if (!isIsoDate(record.verifiedAt)) errors.push("검토 기준일이 올바르지 않습니다.");
  if (
    !Number.isFinite(record.verifiedPricePerPyeongManwon) ||
    record.verifiedPricePerPyeongManwon <= 0
  ) {
    errors.push("확정 평당가가 올바르지 않습니다.");
  }
  return { valid: errors.length === 0, errors };
}

export function buildFinancialSourceFromPriceVerification(
  record: PriceVerificationRecord
): FinancialSourceRecord | null {
  const validation = validatePriceVerification(record);
  if (record.status !== "verified" || !validation.valid) return null;

  return {
    field: record.target === "acquisition" ? "acquisitionPrice" : "salePricePerSqM",
    value:
      record.target === "acquisition"
        ? record.verifiedTotalManwon
        : record.verifiedPricePerSqmWon,
    sourceKind: "official-api",
    sourceName: "국토교통부 실거래 비교 검증",
    documentRef: record.selectedComps
      .map((comp) => `${comp.id}:${comp.date}`)
      .join(", "),
    asOf: record.verifiedAt,
    verifiedBy: `${record.reviewer} · ${record.organization}`,
    recordedAt: record.updatedAt.slice(0, 10),
  };
}
