"use client";

import { z } from "zod";
import type { FinancialSourceMap } from "@/lib/finance/source-data-gate";
import type { ExpertTaxInputContract } from "@/lib/finance/after-tax-ledger";
import { ASSUMPTION_VALUE_RULES, validateAssumptionValue } from "@/lib/finance/assumption-validation";
import { leaseRollDraftSchema, type LeaseRollDraft } from "@/lib/finance/lease-roll-contract";
import { operatingBudgetDraftSchema, type OperatingBudgetDraft } from "@/lib/finance/operating-budget-contract";
import {
  FINANCIAL_REVENUE_POOL_KEYS,
  REVENUE_PRICE_ADJUSTMENT_DIMENSIONS,
  REVENUE_PRICING_INPUT_VERSION,
  type RevenuePricingDraftContract,
} from "@/lib/finance/revenue-contract";
import type {
  PriceVerificationRecord,
  PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import {
  validateExpertReview,
  type ExpertReviewMap,
} from "@/lib/handoff/review-workflow";
import {
  buildReviewSnapshotKey,
  validateReviewSnapshotAlignment,
} from "@/lib/handoff/review-snapshot";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningScenario } from "@/lib/planning/types";
import type { ProjectComputed } from "@/lib/services/compute-project";
import type {
  EnvelopePlan,
  PendingOverride,
  Stage3FeasibilitySnapshot,
} from "@/lib/stores/project-store";
import type { AssumptionSet } from "@/lib/finance/types";
import { validateParcelBoundaryInput } from "@/lib/geo/manual-parcel-boundary";
import { validateJsonStructure } from "@/lib/http/bounded-json";
import { buildRepresentativeParcelBasisHash } from "@/lib/planning/representative-basis";
import {
  PROJECT_WORKSPACE_VERSION,
  validateProjectWorkspacePayload,
  type ProjectWorkspacePayload,
} from "@/lib/workspace/project-workspace";

export const PROJECT_TRANSFER_FORMAT = "parcelgrid-project-transfer" as const;
export const PROJECT_TRANSFER_VERSION = 2 as const;
export const MAX_PROJECT_TRANSFER_BYTES = 20 * 1024 * 1024;
export const PROJECT_TRANSFER_READ_LIMITS = {
  maxBytes: MAX_PROJECT_TRANSFER_BYTES,
  maxDepth: 48,
  maxNodes: 250_000,
  timeoutMs: 5_000,
} as const;

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
  expertTaxContracts: ExpertTaxInputContract[];
  stage3Snapshot: Stage3FeasibilitySnapshot | null;
  priceVerifications: Partial<
    Record<PriceVerificationTarget, PriceVerificationRecord>
  >;
  expertReviews: ExpertReviewMap;
  leaseRollDrafts?: LeaseRollDraft[];
  operatingBudgetDrafts?: OperatingBudgetDraft[];
  revenuePricingDrafts?: RevenuePricingDraftContract[];
  pendingOverrides?: PendingOverride[];
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

export interface ProjectTransferWorkspaceValidation {
  valid: boolean;
  errors: string[];
  payload: ProjectWorkspacePayload | null;
}

const transferId = z.string().min(1).max(300).refine(value => value === value.trim());
const priceComparableSchema = z.object({
  id: z.string(),
  address: z.string(),
  date: z.string(),
  type: z.string(),
  lotAreaSqm: z.number().finite(),
  pricePerPyeongManwon: z.number().finite(),
});
// Validate consumer-safe shape, not approval readiness; incomplete drafts remain transferable.
const priceVerificationSchema = z.object({
  projectId: z.string(),
  target: z.enum(["acquisition", "sale"]),
  status: z.enum(["draft", "review-requested", "verified", "rejected"]),
  selectedComps: z.array(priceComparableSchema).max(10_000),
  medianPricePerPyeongManwon: z.number().finite(),
  adjustmentPct: z.number().finite(),
  verifiedPricePerPyeongManwon: z.number().finite(),
  verifiedTotalManwon: z.number().finite(),
  verifiedPricePerSqmWon: z.number().finite(),
  reviewer: z.string(),
  organization: z.string(),
  rationale: z.string(),
  sourceModelVersion: z.string().nullable().optional(),
  verifiedAt: z.string(),
  updatedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
});
const pricingDraftSchema = z.object({
  version: z.literal(REVENUE_PRICING_INPUT_VERSION),
  projectId: transferId,
  scenarioId: transferId,
  pools: z.partialRecord(z.enum(FINANCIAL_REVENUE_POOL_KEYS), z.object({
    baseUnitPriceWon: z.number().finite().nonnegative().optional(),
    adjustments: z.partialRecord(z.enum(REVENUE_PRICE_ADJUSTMENT_DIMENSIONS),
      z.number().finite().positive().max(10)).optional(),
  }).strict()),
  updatedAt: z.iso.datetime(),
}).strict();
const pendingOverrideSchema = z.object({
  scenarioId: transferId,
  field: z.string().refine(value => Object.hasOwn(ASSUMPTION_VALUE_RULES, value)),
  baseValue: z.number().finite(),
  overrideValue: z.number().finite(),
  reason: z.string().max(2_000).optional(),
  evidenceUrl: z.string().max(2_000).optional(),
}).strict().superRefine((override, context) => {
  if (!Object.hasOwn(ASSUMPTION_VALUE_RULES, override.field)) return;
  // The proposed value uses current field rules; the finite baseline is historical evidence.
  for (const message of validateAssumptionValue(override.field as keyof AssumptionSet, override.overrideValue)) {
    context.addIssue({ code: "custom", path: ["overrideValue"], message });
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter(key => value[key] !== undefined)
      .map(key => [key, canonicalize(value[key])]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function assertTransferStructure(value: unknown): void {
  const result = validateJsonStructure(value, PROJECT_TRANSFER_READ_LIMITS);
  if (!result.ok) throw new Error(result.error);
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (item === null || item === undefined) continue;
    if (typeof item !== "object") {
      if (!["string", "number", "boolean"].includes(typeof item)) {
        throw new Error("인계 패키지에 JSON으로 저장할 수 없는 값이 있습니다.");
      }
      continue;
    }
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new Error("인계 패키지 객체 형식이 올바르지 않습니다.");
    }
    if (Array.isArray(item) && (item.length > PROJECT_TRANSFER_READ_LIMITS.maxNodes ||
        Object.keys(item).length !== item.length)) {
      throw new Error("인계 패키지 배열이 너무 크거나 비어 있는 인덱스가 있습니다.");
    }
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw new Error("인계 패키지에 지원하지 않는 객체 키가 있습니다.");
      }
      stack.push(child);
    }
  }
}

function assertTransferBytes(serialized: string): void {
  if (serialized.length > MAX_PROJECT_TRANSFER_BYTES ||
      new TextEncoder().encode(serialized).byteLength > MAX_PROJECT_TRANSFER_BYTES) {
    throw new Error("인계 패키지는 20 MiB 이하여야 합니다.");
  }
}

function invalidTransfer(message: string): ProjectTransferValidation {
  return { valid: false, errors: [message], bundle: null };
}

function validateOptionalDrafts(
  payload: ProjectTransferPayload,
  projectId: string,
  planningIds: Set<string>,
  financeIds: Set<string>,
): string[] {
  const errors: string[] = [];
  const allIds = new Set([...planningIds, ...financeIds]);
  const collections = [
    ["leaseRollDrafts", leaseRollDraftSchema, allIds],
    ["operatingBudgetDrafts", operatingBudgetDraftSchema, allIds],
    ["revenuePricingDrafts", pricingDraftSchema, financeIds],
  ] as const;
  for (const [field, schema, ids] of collections) {
    const drafts = payload[field];
    if (drafts === undefined) continue;
    if (!Array.isArray(drafts) || drafts.length > 256) {
      errors.push(`${field} 목록은 256개 이하 배열이어야 합니다.`);
      continue;
    }
    const seen = new Set<string>();
    for (const draft of drafts) {
      if (!isRecord(draft) || !schema.safeParse(draft).success ||
          draft.projectId !== projectId || typeof draft.scenarioId !== "string" ||
          draft.scenarioId !== draft.scenarioId.trim() ||
          (payload.projectData !== null && !ids.has(draft.scenarioId)) || seen.has(draft.scenarioId)) {
        errors.push(`${field} 형식·소유권·계획안 연결 또는 중복 항목을 확인하세요.`);
        break;
      }
      seen.add(draft.scenarioId);
    }
  }
  if (payload.pendingOverrides !== undefined) {
    if (!Array.isArray(payload.pendingOverrides) || payload.pendingOverrides.length > 10_000) {
      errors.push("가정 변경 대기 목록은 10,000개 이하 배열이어야 합니다.");
    } else {
      const seen = new Set<string>();
      for (const override of payload.pendingOverrides) {
        if (!isRecord(override) || !pendingOverrideSchema.safeParse(override).success ||
            (payload.projectData !== null && !allIds.has(override.scenarioId))) {
          errors.push("가정 변경 대기 항목의 형식 또는 계획안 연결이 올바르지 않습니다.");
          break;
        }
        const key = JSON.stringify([override.scenarioId, override.field]);
        if (seen.has(key)) {
          errors.push("동일 계획안·필드의 가정 변경 대기 항목이 중복됩니다.");
          break;
        }
        seen.add(key);
      }
    }
  }
  return errors;
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
  assertTransferStructure(input);
  if (!isRecord(input) || !isRecord(input.payload) || !Array.isArray(input.payload.planningScenarios)) {
    throw new Error("인계 패키지 생성 입력이 올바르지 않습니다.");
  }
  const planningScenarios = input.payload.planningScenarios.map((scenario) => {
    if (isRecord(scenario) && scenario.projectId !== undefined && scenario.projectId !== input.projectId) {
      throw new Error("다른 프로젝트의 계획안을 인계 패키지에 포함할 수 없습니다.");
    }
    return { ...scenario, projectId: input.projectId };
  });
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
  assertTransferBytes(JSON.stringify(unsigned));
  const bundle = { ...unsigned, checksum: checksum(unsignedBundle(unsigned)) };
  serializeProjectTransferBundle(bundle);
  return bundle;
}

export function parseProjectTransferBundle(
  serialized: string,
  expectedProjectId?: string
): ProjectTransferValidation {
  try {
    if (typeof serialized !== "string") return invalidTransfer("JSON 파일을 읽을 수 없습니다.");
    assertTransferBytes(serialized);
    return validateProjectTransferBundle(JSON.parse(serialized), expectedProjectId);
  } catch {
    return invalidTransfer("인계 JSON을 읽을 수 없거나 20 MiB 제한을 초과했습니다.");
  }
}

/** Validates the original wire object without inserting defaults or normalizing signatures. */
export function validateProjectTransferBundle(
  value: unknown,
  expectedProjectId?: string,
): ProjectTransferValidation {
  try {
    assertTransferStructure(value);
    assertTransferBytes(JSON.stringify(value));
    return validateTransferBundle(value, expectedProjectId);
  } catch {
    return invalidTransfer("인계 패키지 형식이 올바르지 않거나 검증 한도를 초과했습니다.");
  }
}

function validateTransferBundle(parsed: unknown, expectedProjectId?: string): ProjectTransferValidation {
  const errors: string[] = [];

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
  if (typeof parsed.projectId !== "string" || !parsed.projectId.trim() || parsed.projectId.length > 200) {
    errors.push("프로젝트 ID가 없습니다.");
  }
  if (expectedProjectId !== undefined && (typeof expectedProjectId !== "string" ||
      !expectedProjectId.trim() || parsed.projectId !== expectedProjectId)) {
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

  for (const field of ["projectData", "envelopePlan", "representativeGeometry", "stage3Snapshot"] as const) {
    if (bundle.payload[field] !== null && !isRecord(bundle.payload[field])) {
      errors.push(`${field} 형식이 올바르지 않습니다.`);
    }
  }
  for (const field of ["draftAssumptions", "financialSources", "priceVerifications", "expertReviews"] as const) {
    const records = bundle.payload[field];
    if (!isRecord(records) || Object.values(records).some(record => !isRecord(record))) {
      errors.push(`${field} 묶음 형식이 올바르지 않습니다.`);
    }
  }
  for (const field of ["selectedScenarioId", "representativeScenarioId"] as const) {
    if (bundle.payload[field] !== null && !transferId.safeParse(bundle.payload[field]).success) {
      errors.push(`${field} 형식이 올바르지 않습니다.`);
    }
  }
  if (errors.length) return { valid: false, errors, bundle: null };

  for (const [target, verification] of Object.entries(bundle.payload.priceVerifications)) {
    if (!priceVerificationSchema.safeParse(verification).success ||
        verification.projectId !== bundle.projectId || verification.target !== target) {
      errors.push("가격 검증 항목의 형식·소유권·대상 또는 비교 사례가 올바르지 않습니다.");
      break;
    }
  }
  if (errors.length) return { valid: false, errors, bundle: null };

  const planningScenarios = Array.isArray(bundle.payload.planningScenarios)
    ? bundle.payload.planningScenarios
    : [];
  if (!Array.isArray(bundle.payload.planningScenarios)) {
    errors.push("계획안 목록 형식이 올바르지 않습니다.");
  } else {
    const foreignScenario = planningScenarios.some(
      (scenario) =>
        !isRecord(scenario) ||
        !transferId.safeParse(scenario.id).success ||
        (scenario.projectId !== undefined &&
          scenario.projectId !== bundle.projectId)
    );
    if (foreignScenario) {
      errors.push("다른 프로젝트의 계획안이 패키지에 섞여 있습니다.");
    }
  }
  if (errors.length) return { valid: false, errors, bundle: null };

  const scenarioIds = new Set(
    planningScenarios.map((scenario) => scenario.id)
  );
  if (scenarioIds.size !== planningScenarios.length) errors.push("계획안 ID가 중복됩니다.");
  const financeIds = new Set<string>();
  if (bundle.payload.projectData !== null) {
    const scenarios = bundle.payload.projectData.scenarios;
    if (!Array.isArray(scenarios) || scenarios.some(scenario =>
      !isRecord(scenario) || !transferId.safeParse(scenario.id).success)) {
      errors.push("계산 계획안 목록 형식이 올바르지 않습니다.");
    } else {
      for (const scenario of scenarios) financeIds.add(scenario.id);
      if (financeIds.size !== scenarios.length) errors.push("계산 계획안 ID가 중복됩니다.");
    }
  }
  errors.push(...validateOptionalDrafts(bundle.payload, bundle.projectId, scenarioIds, financeIds));
  if (!Array.isArray(bundle.payload.expertTaxContracts)) {
    errors.push("세무 전문가 입력 계약 형식이 올바르지 않습니다.");
  } else {
    const invalidTaxContract = bundle.payload.expertTaxContracts.some(
      (contract) =>
        !isRecord(contract) ||
        contract.projectId !== bundle.projectId ||
        typeof contract.scenarioId !== "string" ||
        (!scenarioIds.has(contract.scenarioId) && !financeIds.has(contract.scenarioId)) ||
        (contract.strategy !== "stabilized-sale" &&
          contract.strategy !== "long-term-hold")
    );
    if (invalidTaxContract) {
      errors.push("다른 프로젝트·계획안의 세무 입력 계약이 포함돼 있습니다.");
    }
  }
  if (errors.length) return { valid: false, errors, bundle: null };
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
  if (bundle.payload.projectData != null) {
    const parcel = isRecord(bundle.payload.projectData) ? bundle.payload.projectData.parcel : null;
    if (!isRecord(parcel) || parcel.id !== bundle.projectId) {
      errors.push("현황 데이터의 프로젝트 ID가 다릅니다.");
    }
    if (isRecord(parcel)) {
      try {
        validateParcelBoundaryInput(parcel);
      } catch {
        errors.push("인계 부지 경계가 잘못되었거나 경계 검증 한도를 초과했습니다.");
      }
    }
  }
  if (
    bundle.payload.representativeScenarioId &&
    !bundle.payload.projectData
  ) {
    errors.push("대표 계획안의 부지·법규 기준 데이터가 없습니다.");
  }

  const geometry = bundle.payload.representativeGeometry;
  const representative = planningScenarios.find(
    (scenario) => scenario.id === bundle.payload.representativeScenarioId
  );
  if (geometry !== null) {
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
      !isRecord(geometry.validation) ||
      geometry.validation.status !== "pass" ||
      geometry.validation.representativeEligible !== true ||
      geometry.validation.exportable !== true
    ) {
      errors.push("대표 Geometry가 확정·내보내기 가능한 검증 상태가 아닙니다.");
    }
  } else if (bundle.payload.representativeScenarioId) {
    errors.push("대표 계획안에 대응하는 Geometry가 없습니다.");
  }
  if (errors.length) return { valid: false, errors, bundle: null };

  const stage3Snapshot = bundle.payload.stage3Snapshot;
  if (stage3Snapshot) {
    const alignment = validateReviewSnapshotAlignment({
      snapshot: stage3Snapshot,
      geometry,
      currentScenario: representative ?? null,
    });
    errors.push(...alignment.errors);
    if (stage3Snapshot.projectId !== bundle.projectId) {
      errors.push("Stage 3 저장본의 프로젝트 ID가 다릅니다.");
    }

    if (alignment.valid && Object.keys(bundle.payload.expertReviews).length > 0) {
      const reviewKey = buildReviewSnapshotKey({
        snapshot: stage3Snapshot,
        financialSources: bundle.payload.financialSources ?? {},
        priceVerifications: bundle.payload.priceVerifications ?? {},
        expertTaxContracts: bundle.payload.expertTaxContracts ?? [],
        planningScenario: representative ?? null,
        geometry,
      });
      const invalidReview = Object.values(
        bundle.payload.expertReviews ?? {}
      ).find((review) => {
        if (!review) return false;
        return !validateExpertReview(review, reviewKey).valid;
      });
      if (invalidReview) {
        errors.push(
          "현재 저장본·역할·상태 이력과 일치하지 않는 전문가 검토 기록이 포함돼 있습니다."
        );
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

export function detachTransferredTaxDocuments(
  contracts: ExpertTaxInputContract[]
): ExpertTaxInputContract[] {
  return contracts.map((contract) => {
    const detached = { ...contract };
    delete detached.document;
    return {
      ...detached,
      reviewStatus: "draft",
      updatedAt: new Date().toISOString(),
    };
  });
}

export function serializeProjectTransferBundle(
  bundle: ProjectTransferBundle
): string {
  assertTransferStructure(bundle);
  if (!isRecord(bundle) || !isRecord(bundle.payload)) throw new Error("인계 패키지 객체가 필요합니다.");
  const serialized = JSON.stringify(bundle, null, 2);
  if (typeof serialized !== "string") throw new Error("인계 패키지를 JSON으로 저장할 수 없습니다.");
  assertTransferBytes(serialized);
  return serialized;
}

/** Preparation is pure; the caller must still guard the live project/session before applying. */
export function prepareProjectTransferWorkspace(
  bundle: unknown,
  currentData: ProjectComputed | null,
): ProjectTransferWorkspaceValidation {
  try {
    const validation = validateProjectTransferBundle(bundle);
    if (!validation.valid || !validation.bundle) {
      return { valid: false, errors: validation.errors, payload: null };
    }
    const { projectId, payload } = validation.bundle;
    const projectData = payload.projectData ?? currentData;
    if (!isRecord(projectData) || !isRecord(projectData.parcel) || projectData.parcel.id !== projectId) {
      return { valid: false, errors: ["현재 프로젝트와 일치하는 계산 데이터가 필요합니다."], payload: null };
    }
    const candidate: ProjectWorkspacePayload = {
      version: PROJECT_WORKSPACE_VERSION,
      projectId,
      projectData,
      envelopePlan: payload.envelopePlan,
      planningScenarios: payload.planningScenarios.map(scenario => ({ ...scenario, projectId })),
      selectedScenarioId: payload.selectedScenarioId,
      representativeScenarioId: payload.representativeScenarioId,
      representativeGeometry: payload.representativeGeometry,
      representativeParcelBasisHash: null,
      pendingOverrides: payload.pendingOverrides ?? [],
      draftAssumptions: payload.draftAssumptions,
      draftAcquisitionPrice: payload.draftAcquisitionPrice,
      financialSources: payload.financialSources,
      expertTaxContracts: payload.expertTaxContracts,
      leaseRollDrafts: payload.leaseRollDrafts ?? [],
      operatingBudgetDrafts: payload.operatingBudgetDrafts ?? [],
      revenuePricingDrafts: payload.revenuePricingDrafts ?? [],
      stage3Snapshot: payload.stage3Snapshot,
      priceVerifications: payload.priceVerifications,
    };
    assertTransferStructure(candidate);
    const prepared = structuredClone(candidate);
    if (prepared.representativeGeometry) {
      prepared.representativeParcelBasisHash = buildRepresentativeParcelBasisHash(prepared.projectData.parcel);
    }
    prepared.financialSources = detachTransferredSourceDocuments(prepared.financialSources);
    prepared.expertTaxContracts = detachTransferredTaxDocuments(prepared.expertTaxContracts);
    return validateProjectWorkspacePayload(prepared, projectId);
  } catch {
    return { valid: false, errors: ["인계 패키지를 안전한 프로젝트 Workspace로 준비할 수 없습니다."], payload: null };
  }
}
