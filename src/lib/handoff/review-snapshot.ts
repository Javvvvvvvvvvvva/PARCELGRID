import type { FinancialSourceMap } from "@/lib/finance/source-data-gate";
import type {
  PriceVerificationRecord,
  PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { ProjectComputed } from "@/lib/services/compute-project";

export const REVIEW_SNAPSHOT_VERSION = "review-snapshot-2026.1" as const;

export interface ReviewableStage3Snapshot {
  projectId: string;
  representativeScenarioId: string;
  representativeScenarioVersion: number;
  geometryHash: string;
  savedAt: string;
  data: ProjectComputed;
}

export type ReviewPriceVerificationMap = Partial<
  Record<PriceVerificationTarget, PriceVerificationRecord>
>;

export interface ReviewSnapshotAlignmentInput {
  snapshot?: ReviewableStage3Snapshot | null;
  geometry?: PlanningGeometrySnapshot | null;
  currentScenario?: { id: string; version: number } | null;
}

export interface ReviewSnapshotAlignment {
  valid: boolean;
  errors: string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        if (record[key] !== undefined) result[key] = canonicalize(record[key]);
        return result;
      }, {});
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function stableHash(value: unknown): string {
  const input = JSON.stringify(canonicalize(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function stripFinancialRecordTimestamps(sources: FinancialSourceMap) {
  return Object.fromEntries(
    Object.entries(sources).map(([field, record]) => {
      if (!record) return [field, record];
      const evidence = { ...record };
      delete evidence.recordedAt;
      return [field, evidence];
    })
  );
}

function stripPriceRecordTimestamps(
  records: ReviewPriceVerificationMap
): ReviewPriceVerificationMap {
  return Object.fromEntries(
    Object.entries(records).map(([target, record]) => {
      if (!record) return [target, record];
      const evidence = { ...record };
      delete evidence.updatedAt;
      return [target, evidence];
    })
  ) as ReviewPriceVerificationMap;
}

/**
 * 전문가 승인 대상의 불변 식별자.
 *
 * 저장 시각처럼 내용과 무관한 값은 제외하고, Stage 3 계산 결과·대표 형상·
 * 계산 원문·가격 검증 기록이 하나라도 달라지면 새로운 키가 생성된다.
 */
export function buildReviewSnapshotKey(input: {
  snapshot: ReviewableStage3Snapshot;
  financialSources: FinancialSourceMap;
  priceVerifications: ReviewPriceVerificationMap;
}): string {
  const stableData = {
    ...input.snapshot.data,
    meta: { version: input.snapshot.data.meta.version },
  };
  const fingerprint = stableHash({
    version: REVIEW_SNAPSHOT_VERSION,
    projectId: input.snapshot.projectId,
    representativeScenarioId: input.snapshot.representativeScenarioId,
    representativeScenarioVersion:
      input.snapshot.representativeScenarioVersion,
    geometryHash: input.snapshot.geometryHash,
    data: stableData,
    financialSources: stripFinancialRecordTimestamps(input.financialSources),
    priceVerifications: stripPriceRecordTimestamps(input.priceVerifications),
  });
  return `PG-REVIEW-${fingerprint}`;
}

/**
 * 현재 대표 계획과 저장된 Stage 3 스냅샷이 정확히 같은지 확인한다.
 * 계획안 편집, 대표안 교체, Geometry 재생성 중 하나라도 발생하면 승인을 막는다.
 */
export function validateReviewSnapshotAlignment(
  input: ReviewSnapshotAlignmentInput
): ReviewSnapshotAlignment {
  const errors: string[] = [];
  const { snapshot, geometry, currentScenario } = input;

  if (!snapshot) {
    return {
      valid: false,
      errors: ["Stage 3에서 현재 사업성 계산을 먼저 저장해야 합니다."],
    };
  }
  if (!geometry) {
    return {
      valid: false,
      errors: ["현재 대표 계획의 검증된 Geometry 스냅샷이 없습니다."],
    };
  }

  if (snapshot.projectId !== geometry.projectId) {
    errors.push("사업성 스냅샷과 대표 Geometry의 프로젝트가 다릅니다.");
  }
  if (
    snapshot.representativeScenarioId !== geometry.scenarioId ||
    snapshot.representativeScenarioVersion !== geometry.scenarioVersion
  ) {
    errors.push("사업성 스냅샷과 대표 Geometry의 계획안 버전이 다릅니다.");
  }
  if (snapshot.geometryHash !== geometry.geometryHash) {
    errors.push("사업성 스냅샷과 대표 Geometry의 형상 해시가 다릅니다.");
  }
  if (
    geometry.validation.status !== "pass" ||
    !geometry.validation.representativeEligible ||
    !geometry.validation.exportable
  ) {
    errors.push("현재 대표 Geometry가 법규·면적·형상 검증을 모두 통과하지 않았습니다.");
  }
  if (!currentScenario) {
    errors.push("현재 대표 계획안을 찾을 수 없습니다.");
  } else if (
    snapshot.representativeScenarioId !== currentScenario.id ||
    snapshot.representativeScenarioVersion !== currentScenario.version
  ) {
    errors.push(
      "Stage 3 저장 후 대표 계획안이 변경됐습니다. 사업성을 다시 저장해야 합니다."
    );
  }

  return { valid: errors.length === 0, errors };
}
