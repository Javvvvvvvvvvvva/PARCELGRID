import { FACADE_COST_VERSION, FACADE_QUANTITY_VERSION } from "@/lib/planning/facade-quantities";
import type { FinancialSourceMap } from "@/lib/finance/source-data-gate";
import type { ExpertTaxInputContract } from "@/lib/finance/after-tax-ledger";
import type {
  PriceVerificationRecord,
  PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import { planningGeometryInputBasis, type PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningScenario } from "@/lib/planning/types";
import { fullQuoteCostContractsMatch } from "@/lib/planning/full-quote-cost-contract";
import { PROJECT_CALCULATION_VERSION, type ProjectComputed } from "@/lib/services/compute-project";
import { buildIntegratedVerification, type IntegratedVerificationReport } from "@/lib/handoff/integrated-verification";

export const REVIEW_SNAPSHOT_VERSION = "review-snapshot-2026.6" as const;
export const SERVER_REVIEW_SNAPSHOT_KEY_PREFIX = "PG-REVIEW-SHA256-" as const;

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
  currentScenario?: (Pick<PlanningScenario, "id" | "version"> & Partial<PlanningScenario>) | null;
}

export interface ReviewSnapshotAlignment {
  valid: boolean;
  errors: string[];
}

export interface ReviewSnapshotPayload {
  version: typeof REVIEW_SNAPSHOT_VERSION;
  projectId: string;
  representativeScenarioId: string;
  representativeScenarioVersion: number;
  geometryHash: string;
  data: ProjectComputed;
  financialSources: unknown;
  priceVerifications: ReviewPriceVerificationMap;
  expertTaxContracts: unknown[];
  planningScenario: PlanningScenario | null;
  geometry: PlanningGeometrySnapshot | null;
  verification: IntegratedVerificationReport;
}

export interface ReviewSnapshotBuildInput {
  snapshot: ReviewableStage3Snapshot;
  financialSources: FinancialSourceMap;
  priceVerifications: ReviewPriceVerificationMap;
  expertTaxContracts?: ExpertTaxInputContract[];
  planningScenario?: PlanningScenario | null;
  geometry?: PlanningGeometrySnapshot | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function stableHash(value: unknown): string {
  const input = canonicalReviewSnapshotJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function canonicalReviewSnapshotJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function stripFinancialRecordTimestamps(sources: FinancialSourceMap) {
  return Object.fromEntries(
    Object.entries(sources).map(([field, record]) => {
      if (!record) return [field, record];
      const evidence = Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== "recordedAt")
      );
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
      const evidence = Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== "updatedAt")
      );
      return [target, evidence];
    })
  ) as ReviewPriceVerificationMap;
}

function stripTaxContractTimestamps(contracts: ExpertTaxInputContract[]) {
  return contracts
    .map((contract) =>
      Object.fromEntries(
        Object.entries(contract).filter(([key]) => key !== "updatedAt")
      )
    )
    .sort((left, right) => {
      const leftKey = `${left.projectId}:${left.scenarioId}:${left.strategy}`;
      const rightKey = `${right.projectId}:${right.scenarioId}:${right.strategy}`;
      return leftKey.localeCompare(rightKey);
    });
}

/**
 * 전문가 승인 대상의 불변 식별자.
 *
 * 저장 시각처럼 내용과 무관한 값은 제외하고, Stage 3 계산 결과·대표 형상·
 * 계산 원문·가격 검증 기록이 하나라도 달라지면 새로운 키가 생성된다.
 */
export function buildReviewSnapshotKey(input: ReviewSnapshotBuildInput): string {
  return `PG-REVIEW-${stableHash(buildReviewSnapshotPayload(input))}`;
}

export function buildReviewSnapshotPayload(input: ReviewSnapshotBuildInput): ReviewSnapshotPayload {
  const stableData = {
    ...input.snapshot.data,
    meta: { version: input.snapshot.data.meta.version, calculationStartDate: input.snapshot.data.meta.calculationStartDate },
  };
  const packet = {
    version: REVIEW_SNAPSHOT_VERSION,
    projectId: input.snapshot.projectId,
    representativeScenarioId: input.snapshot.representativeScenarioId,
    representativeScenarioVersion:
      input.snapshot.representativeScenarioVersion,
    geometryHash: input.snapshot.geometryHash,
    data: stableData,
    financialSources: stripFinancialRecordTimestamps(input.financialSources),
    priceVerifications: stripPriceRecordTimestamps(input.priceVerifications),
    expertTaxContracts: stripTaxContractTimestamps(
      (input.expertTaxContracts ?? []).filter((contract) =>
        contract.projectId === input.snapshot.projectId &&
        input.snapshot.data.scenarios.some((scenario) => scenario.id === contract.scenarioId)
      )
    ),
    planningScenario: input.planningScenario ?? null,
    geometry: input.geometry ?? null,
  };
  return { ...packet, verification: buildIntegratedVerification({ ...packet, data: input.snapshot.data }) } as ReviewSnapshotPayload;
}

function digestHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function buildServerReviewSnapshotKey(
  payload: ReviewSnapshotPayload,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalReviewSnapshotJson(payload)),
  );
  return `${SERVER_REVIEW_SNAPSHOT_KEY_PREFIX}${digestHex(new Uint8Array(digest))}`;
}

export function isServerReviewSnapshotKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    new RegExp(`^${SERVER_REVIEW_SNAPSHOT_KEY_PREFIX}[A-F0-9]{64}$`).test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateReviewSnapshotPayload(
  value: unknown,
  expectedProjectId?: string,
): { valid: boolean; errors: string[]; payload: ReviewSnapshotPayload | null } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["검토 Snapshot 본문이 객체가 아닙니다."],
      payload: null,
    };
  }
  if (value.version !== REVIEW_SNAPSHOT_VERSION) {
    errors.push("지원하지 않는 검토 Snapshot 버전입니다.");
  }
  if (
    typeof value.projectId !== "string" ||
    !value.projectId.trim() ||
    value.projectId.length > 200
  ) {
    errors.push("검토 Snapshot의 프로젝트 ID가 올바르지 않습니다.");
  } else if (expectedProjectId && value.projectId !== expectedProjectId) {
    errors.push("검토 Snapshot의 프로젝트 ID가 요청 경로와 다릅니다.");
  }
  if (
    typeof value.representativeScenarioId !== "string" ||
    !value.representativeScenarioId.trim() ||
    value.representativeScenarioId.length > 200
  ) {
    errors.push("대표 계획안 ID가 올바르지 않습니다.");
  }
  if (
    !Number.isSafeInteger(value.representativeScenarioVersion) ||
    Number(value.representativeScenarioVersion) < 1
  ) {
    errors.push("대표 계획안 버전이 올바르지 않습니다.");
  }
  if (
    typeof value.geometryHash !== "string" ||
    !value.geometryHash.trim() ||
    value.geometryHash.length > 200
  ) {
    errors.push("Geometry Hash가 올바르지 않습니다.");
  }
  if (!isRecord(value.data)) {
    errors.push("Stage 3 계산 본문이 없습니다.");
  } else {
    const parcel = value.data.parcel;
    const scenarios = value.data.scenarios;
    const meta = value.data.meta;
    if (!isRecord(parcel) || parcel.id !== value.projectId) {
      errors.push("Stage 3 부지와 Snapshot 프로젝트가 일치하지 않습니다.");
    }
    if (
      !Array.isArray(scenarios) ||
      !scenarios.some(
        (scenario) =>
          isRecord(scenario) && scenario.id === value.representativeScenarioId,
      )
    ) {
      errors.push("Stage 3 계산에 대표 계획안이 없습니다.");
    }
    if (!isRecord(meta) || typeof meta.version !== "string" || !meta.version) {
      errors.push("Stage 3 계산 모델 버전이 없습니다.");
    }
  }
  if (!isRecord(value.financialSources)) {
    errors.push("재무 원문 근거 묶음이 올바르지 않습니다.");
  }
  if (!isRecord(value.priceVerifications)) {
    errors.push("가격 검증 묶음이 올바르지 않습니다.");
  }
  if (!Array.isArray(value.expertTaxContracts)) {
    errors.push("세무 계약 묶음이 올바르지 않습니다.");
  } else if (
    value.expertTaxContracts.some(
      (contract) =>
        !isRecord(contract) ||
        contract.projectId !== value.projectId ||
        !Array.isArray(isRecord(value.data) ? value.data.scenarios : null) ||
        !(value.data as { scenarios: unknown[] }).scenarios.some((scenario) =>
          isRecord(scenario) && scenario.id === contract.scenarioId
        ),
    )
  ) {
    errors.push("다른 프로젝트 또는 계획안의 세무 계약이 포함됐습니다.");
  }
  if (value.planningScenario !== null && !isRecord(value.planningScenario)) {
    errors.push("원본 계획안은 객체 또는 미확정(null)이어야 합니다.");
  }
  if (value.geometry !== null && !isRecord(value.geometry)) {
    errors.push("원본 형상은 객체 또는 미확정(null)이어야 합니다.");
  }
  // A client cannot turn missing/conflicting checks into an approvable packet.
  if (errors.length === 0) {
    try {
      const recomputed = buildIntegratedVerification(value as unknown as ReviewSnapshotPayload);
      if (canonicalReviewSnapshotJson(value.verification) !== canonicalReviewSnapshotJson(recomputed)) {
        const receivedChecks = isRecord(value.verification) && Array.isArray(value.verification.checks) ? value.verification.checks : [];
        const differences = recomputed.checks.filter((check) =>
          canonicalReviewSnapshotJson(check) !== canonicalReviewSnapshotJson(receivedChecks.find((item) => isRecord(item) && item.id === check.id))
        ).slice(0, 8).map((check) => check.id);
        errors.push(`통합 검증 결과가 원본 계획·형상·사업성의 재계산 결과와 다릅니다. ${differences.length ? `불일치: ${differences.join(", ")}` : "검증 버전·상태·검사 목록을 확인하세요."}`);
      }
    } catch {
      errors.push("통합 검증 원본의 형식 또는 계산 범위를 확인할 수 없습니다.");
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    payload: errors.length === 0 ? (value as unknown as ReviewSnapshotPayload) : null,
  };
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
  if (snapshot.data?.meta?.version !== PROJECT_CALCULATION_VERSION) {
    errors.push("저장본의 계산 모델이 구버전이거나 확인되지 않습니다. 현재 모델로 사업성을 다시 저장해야 합니다.");
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
  const contract = snapshot.data.scenarios.find(s => s.id === snapshot.representativeScenarioId)?._raw.program.areaContract;
  if (!fullQuoteCostContractsMatch(currentScenario?.fullQuoteAdoption, contract?.fullQuoteCost)) {
    errors.push("전체 견적 채택·해제 또는 포함 범위가 저장된 사업비와 다릅니다. 사업성을 다시 계산하고 저장하세요.");
  }
  const facade = contract?.facadeCost;
  if (facade && (facade.version !== FACADE_COST_VERSION || facade.quantities.version !== FACADE_QUANTITY_VERSION ||
    (facade.quantities.geometryHash && facade.quantities.geometryHash !== geometry.geometryHash) ||
    Math.abs(facade.adjustmentManwon - (contract?.materialAdjustmentCostManwon ?? 0)) > 0.000001)) {
    errors.push("외벽 수량·재료비 계약이 현재 형상 또는 재무 금액과 다릅니다. 다시 저장해야 합니다.");
  }
  if (!facade && (contract?.materialAdjustmentCostManwon ?? 0) !== 0) errors.push("기존 외장재 비용의 수량 계약이 없습니다. 사업성을 다시 계산하고 저장하세요.");
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
  if (currentScenario?.floorPrograms) {
    try {
      if (geometry.scenarioInputBasis !== planningGeometryInputBasis(currentScenario as PlanningScenario)) {
        errors.push("대표 형상의 원본 계획이 변경됐습니다. 형상과 사업성을 다시 저장해야 합니다.");
      }
    } catch {
      errors.push("대표 계획의 형상 입력을 확인할 수 없습니다.");
    }
  }

  return { valid: errors.length === 0, errors };
}
