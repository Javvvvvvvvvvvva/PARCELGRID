"use client";

import type { FinancialSourceMap } from "@/lib/finance/source-data-gate";
import type {
  PriceVerificationRecord,
  PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import type { ExpertReviewMap } from "@/lib/handoff/review-workflow";
import {
  buildReviewSnapshotKey,
  validateReviewSnapshotAlignment,
} from "@/lib/handoff/review-snapshot";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningScenario } from "@/lib/planning/types";
import type { ProjectComputed } from "@/lib/services/compute-project";
import type {
  EnvelopePlan,
  Stage3FeasibilitySnapshot,
} from "@/lib/stores/project-store";
import type { AssumptionSet } from "@/lib/finance/types";

export const PROJECT_TRANSFER_FORMAT = "parcelgrid-project-transfer" as const;
export const PROJECT_TRANSFER_VERSION = 1 as const;

export interface ProjectTransferPayload {
  projectData: ProjectComputed | null;
  envelopePlan: EnvelopePlan | null;
  planningScenarios: PlanningScenario[];
  selectedScenarioId: string | null;
  representativeScenarioId: string | null;
  representativeGeometry: PlanningGeometrySnapshot | null;
  draftAssumptions: Record<string, Partial<AssumptionSet>>;
  draftAcquisitionPrice: number | null;
  financialSources: FinancialSourceMap;
  stage3Snapshot: Stage3FeasibilitySnapshot | null;
  priceVerifications: Partial<
    Record<PriceVerificationTarget, PriceVerificationRecord>
  >;
  expertReviews: ExpertReviewMap;
}

export interface ProjectTransferBundle {
  format: typeof PROJECT_TRANSFER_FORMAT;
  version: typeof PROJECT_TRANSFER_VERSION;
  projectId: string;
  exportedAt: string;
  payload: ProjectTransferPayload;
  checksum: string;
}

export interface ProjectTransferValidation {
  valid: boolean;
  errors: string[];
  bundle: ProjectTransferBundle | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        if (value[key] !== undefined) result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function checksum(value: unknown): string {
  const input = JSON.stringify(canonicalize(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function unsignedBundle(bundle: Omit<ProjectTransferBundle, "checksum">) {
  return {
    format: bundle.format,
    version: bundle.version,
    projectId: bundle.projectId,
    exportedAt: bundle.exportedAt,
    payload: bundle.payload,
  };
}

export function createProjectTransferBundle(input: {
  projectId: string;
  payload: ProjectTransferPayload;
  exportedAt?: string;
}): ProjectTransferBundle {
  const planningScenarios = input.payload.planningScenarios.map((scenario) => ({
    ...scenario,
    projectId: input.projectId,
  }));
  const unsigned: Omit<ProjectTransferBundle, "checksum"> = {
    format: PROJECT_TRANSFER_FORMAT,
    version: PROJECT_TRANSFER_VERSION,
    projectId: input.projectId,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    payload: {
      ...input.payload,
      planningScenarios,
    },
  };
  return { ...unsigned, checksum: checksum(unsignedBundle(unsigned)) };
}

export function parseProjectTransferBundle(
  serialized: string,
  expectedProjectId?: string
): ProjectTransferValidation {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return {
      valid: false,
      errors: ["JSON 파일을 읽을 수 없습니다."],
      bundle: null,
    };
  }

  if (!isRecord(parsed)) {
    return {
      valid: false,
      errors: ["ParcelGrid 인계 패키지 형식이 아닙니다."],
      bundle: null,
    };
  }
  if (parsed.format !== PROJECT_TRANSFER_FORMAT) {
    errors.push("ParcelGrid 인계 패키지 식별자가 다릅니다.");
  }
  if (parsed.version !== PROJECT_TRANSFER_VERSION) {
    errors.push("지원하지 않는 인계 패키지 버전입니다.");
  }
  if (typeof parsed.projectId !== "string" || !parsed.projectId.trim()) {
    errors.push("프로젝트 ID가 없습니다.");
  }
  if (expectedProjectId && parsed.projectId !== expectedProjectId) {
    errors.push("현재 열어 둔 프로젝트와 패키지의 프로젝트 ID가 다릅니다.");
  }
  if (typeof parsed.exportedAt !== "string") {
    errors.push("내보낸 시각이 없습니다.");
  }
  if (!isRecord(parsed.payload)) {
    errors.push("프로젝트 데이터 묶음이 없습니다.");
  }
  if (typeof parsed.checksum !== "string") {
    errors.push("무결성 체크섬이 없습니다.");
  }
  if (errors.length > 0) return { valid: false, errors, bundle: null };

  const bundle = parsed as unknown as ProjectTransferBundle;
  const expectedChecksum = checksum(
    unsignedBundle({
      format: bundle.format,
      version: bundle.version,
      projectId: bundle.projectId,
      exportedAt: bundle.exportedAt,
      payload: bundle.payload,
    })
  );
  if (bundle.checksum !== expectedChecksum) {
    return {
      valid: false,
      errors: ["파일 내용이 변경됐거나 손상되어 체크섬이 일치하지 않습니다."],
      bundle: null,
    };
  }

  const planningScenarios = Array.isArray(bundle.payload.planningScenarios)
    ? bundle.payload.planningScenarios
    : [];
  if (!Array.isArray(bundle.payload.planningScenarios)) {
    errors.push("계획안 목록 형식이 올바르지 않습니다.");
  } else {
    const foreignScenario = planningScenarios.find(
      (scenario) =>
        !isRecord(scenario) ||
        (typeof scenario.projectId === "string" &&
          scenario.projectId !== bundle.projectId)
    );
    if (foreignScenario) {
      errors.push("다른 프로젝트의 계획안이 패키지에 섞여 있습니다.");
    }
  }

  const scenarioIds = new Set(
    planningScenarios.map((scenario) => scenario.id)
  );
  if (
    bundle.payload.representativeScenarioId &&
    !scenarioIds.has(bundle.payload.representativeScenarioId)
  ) {
    errors.push("대표 계획안이 패키지의 계획안 목록에 없습니다.");
  }
  if (
    bundle.payload.selectedScenarioId &&
    !scenarioIds.has(bundle.payload.selectedScenarioId)
  ) {
    errors.push("선택 계획안이 패키지의 계획안 목록에 없습니다.");
  }
  if (
    bundle.payload.projectData &&
    bundle.payload.projectData.parcel.id !== bundle.projectId
  ) {
    errors.push("현황 데이터의 프로젝트 ID가 다릅니다.");
  }

  const geometry = bundle.payload.representativeGeometry;
  const representative = planningScenarios.find(
    (scenario) => scenario.id === bundle.payload.representativeScenarioId
  );
  if (geometry) {
    if (geometry.projectId !== bundle.projectId) {
      errors.push("대표 Geometry의 프로젝트 ID가 다릅니다.");
    }
    if (
      !representative ||
      geometry.scenarioId !== representative.id ||
      geometry.scenarioVersion !== representative.version
    ) {
      errors.push("대표 Geometry와 대표 계획안 버전이 일치하지 않습니다.");
    }
    if (
      geometry.validation.status !== "pass" ||
      !geometry.validation.representativeEligible ||
      !geometry.validation.exportable
    ) {
      errors.push("대표 Geometry가 확정·내보내기 가능한 검증 상태가 아닙니다.");
    }
  } else if (bundle.payload.representativeScenarioId) {
    errors.push("대표 계획안에 대응하는 Geometry가 없습니다.");
  }

  const stage3Snapshot = bundle.payload.stage3Snapshot;
  if (stage3Snapshot) {
    const alignment = validateReviewSnapshotAlignment({
      snapshot: stage3Snapshot,
      geometry,
      currentScenario: representative
        ? { id: representative.id, version: representative.version }
        : null,
    });
    errors.push(...alignment.errors);
    if (stage3Snapshot.projectId !== bundle.projectId) {
      errors.push("Stage 3 저장본의 프로젝트 ID가 다릅니다.");
    }

    if (alignment.valid) {
      const reviewKey = buildReviewSnapshotKey({
        snapshot: stage3Snapshot,
        financialSources: bundle.payload.financialSources ?? {},
        priceVerifications: bundle.payload.priceVerifications ?? {},
      });
      const staleApproval = Object.values(
        bundle.payload.expertReviews ?? {}
      ).find(
        (review) =>
          review?.status === "approved" && review.snapshotKey !== reviewKey
      );
      if (staleApproval) {
        errors.push("현재 저장본과 일치하지 않는 전문가 승인이 포함돼 있습니다.");
      }
    }
  } else if (Object.keys(bundle.payload.expertReviews ?? {}).length > 0) {
    errors.push("전문가 검토 기록의 기준이 되는 Stage 3 저장본이 없습니다.");
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    bundle: errors.length === 0 ? bundle : null,
  };
}

/**
 * 인계 JSON에는 감사용 원문 메타데이터가 남지만 파일 바이트는 포함되지 않는다.
 * 다른 컴퓨터에서 존재하지 않는 경로를 검증 완료 원문으로 오인하지 않도록
 * 가져오기 시 파일 연결만 해제한다. 이 변경은 Snapshot Key를 바꿔 기존 승인을
 * 자동으로 재검토 상태로 만든다.
 */
export function detachTransferredSourceDocuments(
  sources: FinancialSourceMap
): FinancialSourceMap {
  return Object.fromEntries(
    Object.entries(sources).map(([field, record]) => [
      field,
      record
        ? Object.fromEntries(
            Object.entries(record).filter(([key]) => key !== "document")
          )
        : record,
    ])
  ) as FinancialSourceMap;
}

export function serializeProjectTransferBundle(
  bundle: ProjectTransferBundle
): string {
  return JSON.stringify(bundle, null, 2);
}
