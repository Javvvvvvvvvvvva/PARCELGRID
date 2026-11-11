import type { AssumptionSet } from "@/lib/finance/types";
import {
  leaseRollDraftSchema,
  type LeaseRollDraft,
} from "@/lib/finance/lease-roll-contract";
import {
  operatingBudgetDraftSchema,
  type OperatingBudgetDraft,
} from "@/lib/finance/operating-budget-contract";
import { validateParcelBoundaryInput } from "@/lib/geo/manual-parcel-boundary";
import { interiorDraftSchema } from "@/lib/planning/interior-layout";
import { interiorLayoutSchema } from "@/lib/planning/interior/types";
import { planningMaterialSelectionSchema } from "@/lib/planning/material-contract";
import { layoutFinanceHistorySchema } from "@/lib/planning/layout-finance-state";
import { quantityCostPlanSchema } from "@/lib/planning/quantity-cost-contract";
import { constructionQuoteSchema } from "@/lib/planning/construction-quote";
import { validateFullQuoteCostContract } from "@/lib/planning/full-quote-cost-contract";
import { egressPlanSchema } from "@/lib/planning/egress-core";
import { analysisReferenceIsCurrent } from "@/lib/planning/analysis-reference-contract";
import type { Parcel } from "@/lib/finance/types";
import { vehicleProfileSchema } from "@/lib/planning/vehicle-circulation";
import type { ExpertTaxInputContract } from "@/lib/finance/after-tax-ledger";
import type { FinancialSourceMap } from "@/lib/finance/source-data-gate";
import type {
  PriceVerificationRecord,
  PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningScenario } from "@/lib/planning/types";
import type { ProjectComputed } from "@/lib/services/compute-project";
import {
  FINANCIAL_REVENUE_POOL_KEYS,
  REVENUE_PRICE_ADJUSTMENT_DIMENSIONS,
  REVENUE_PRICING_INPUT_VERSION,
  type RevenuePricingDraftContract,
} from "@/lib/finance/revenue-contract";
import type {
  EnvelopePlan,
  PendingOverride,
  Stage3FeasibilitySnapshot,
} from "@/lib/stores/project-store";

export const PROJECT_WORKSPACE_VERSION = "project-workspace-2026.1" as const;
export const PROJECT_WORKSPACE_INDEX_VERSION =
  "project-workspace-index-2026.1" as const;
export const MAX_PROJECT_WORKSPACE_BYTES = 10_000_000;

export interface ProjectWorkspacePayload {
  version: typeof PROJECT_WORKSPACE_VERSION;
  projectId: string;
  projectData: ProjectComputed;
  envelopePlan: EnvelopePlan | null;
  planningScenarios: PlanningScenario[];
  selectedScenarioId: string | null;
  representativeScenarioId: string | null;
  representativeGeometry: PlanningGeometrySnapshot | null;
  representativeParcelBasisHash: string | null;
  pendingOverrides: PendingOverride[];
  draftAssumptions: Record<string, Partial<AssumptionSet>>;
  draftAcquisitionPrice: number | null;
  financialSources: FinancialSourceMap;
  revenuePricingDrafts: RevenuePricingDraftContract[];
  leaseRollDrafts?: LeaseRollDraft[];
  operatingBudgetDrafts?: OperatingBudgetDraft[];
  expertTaxContracts: ExpertTaxInputContract[];
  stage3Snapshot: Stage3FeasibilitySnapshot | null;
  priceVerifications: Partial<
    Record<PriceVerificationTarget, PriceVerificationRecord>
  >;
}

export interface ProjectWorkspaceRecord {
  version: typeof PROJECT_WORKSPACE_VERSION;
  projectId: string;
  revision: number;
  payloadHash: string;
  payload: ProjectWorkspacePayload;
  savedAt: string;
  savedBy: string;
  auditHash: string;
  backend: "postgresql" | "local-versioned";
}

export interface ProjectWorkspaceSummary {
  projectId: string;
  revision: number;
  payloadHash: string;
  address: string;
  zoning: string;
  lotAreaSqm: number;
  scenarioCount: number;
  planningScenarioCount: number;
  representativeScenarioId: string | null;
  stage3SavedAt: string | null;
  savedAt: string;
  savedBy: string;
  backend: ProjectWorkspaceRecord["backend"];
}

export interface ProjectWorkspaceIndex {
  version: typeof PROJECT_WORKSPACE_INDEX_VERSION;
  projects: ProjectWorkspaceSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function hasText(value: unknown, maxLength = 2_000): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function canonicalProjectWorkspaceJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashProjectWorkspacePayload(
  payload: ProjectWorkspacePayload,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalProjectWorkspaceJson(payload)),
  );
  return hex(new Uint8Array(digest));
}

export function validateProjectWorkspacePayload(
  value: unknown,
  expectedProjectId?: string,
): { valid: boolean; errors: string[]; payload: ProjectWorkspacePayload | null } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["프로젝트 Workspace 본문이 객체가 아닙니다."],
      payload: null,
    };
  }
  if (value.version !== PROJECT_WORKSPACE_VERSION) {
    errors.push("지원하지 않는 프로젝트 Workspace 버전입니다.");
  }
  if (
    typeof value.projectId !== "string" ||
    !value.projectId.trim() ||
    value.projectId.length > 200
  ) {
    errors.push("프로젝트 ID가 올바르지 않습니다.");
  } else if (expectedProjectId && value.projectId !== expectedProjectId) {
    errors.push("Workspace 프로젝트 ID가 요청 경로와 다릅니다.");
  }
  if (!isRecord(value.projectData)) {
    errors.push("프로젝트 계산 본문이 없습니다.");
  } else {
    const parcel = value.projectData.parcel;
    const meta = value.projectData.meta;
    if (!isRecord(parcel) || parcel.id !== value.projectId) {
      errors.push("프로젝트 계산 본문과 Workspace 프로젝트가 다릅니다.");
    }
    if (!isRecord(meta) || typeof meta.version !== "string" || !meta.version) {
      errors.push("프로젝트 계산 모델 버전이 없습니다.");
    }
    if (
      !isRecord(parcel) ||
      !hasText(parcel.address) ||
      !isFiniteNumber(parcel.lotArea) ||
      parcel.lotArea <= 0 ||
      typeof parcel.zoning !== "string"
    ) {
      errors.push("프로젝트 부지의 주소·면적·용도지역이 올바르지 않습니다.");
    }
    if (isRecord(parcel)) {
      try {
        validateParcelBoundaryInput(parcel);
      } catch {
        errors.push("프로젝트 부지 경계가 잘못되었거나 경계 검증 한도를 초과했습니다.");
      }
    }
    for (const field of [
      "scenarios",
      "pfSchedule",
      "parcelRisks",
      "comps",
      "maxAcquisition",
    ]) {
      if (!Array.isArray(value.projectData[field])) {
        errors.push(`프로젝트 계산 본문의 ${field} 목록이 올바르지 않습니다.`);
      }
    }
    if (
      Array.isArray(value.projectData.scenarios) &&
      value.projectData.scenarios.length === 0 &&
      !(isRecord(meta) && meta.mode === "site-only")
    ) {
      errors.push("프로젝트 계산 시나리오가 없습니다.");
    }
    if (!isRecord(value.projectData.decisionSupport)) {
      errors.push("프로젝트 다목적 추천 결과가 없습니다.");
    }
    if (isRecord(meta) && meta.mode === "site-only") {
      const intake = value.projectData.siteIntake;
      if (!isRecord(intake) || intake.id !== value.projectId || intake.acquiredPrice !== null ||
          !isRecord(parcel) || parcel.acquiredPrice !== 0 || intake.lotArea !== parcel.lotArea ||
          !Array.isArray(value.projectData.scenarios) || value.projectData.scenarios.length !== 0 ||
          value.representativeScenarioId != null || value.representativeGeometry != null || value.stage3Snapshot != null) {
        errors.push("현황 전용 입력과 재무 결과를 혼합할 수 없습니다.");
      }
    }
    const dwellingMarket = value.projectData.dwellingMarket;
    if (dwellingMarket != null && (!isRecord(dwellingMarket) ||
        !Array.isArray(dwellingMarket.comps) || !Array.isArray(dwellingMarket.evidence))) {
      errors.push("평형별 실거래 자료와 조회 근거 목록이 올바르지 않습니다.");
    }
  }
  if (!Array.isArray(value.planningScenarios)) {
    errors.push("계획안 목록이 올바르지 않습니다.");
  } else {
    const ids = new Set<string>();
    for (const scenario of value.planningScenarios) {
      if (
        !isRecord(scenario) ||
        scenario.projectId !== value.projectId ||
        !hasText(scenario.id, 300) ||
        !hasText(scenario.name) ||
        !Number.isSafeInteger(scenario.version) ||
        Number(scenario.version) < 1 ||
        !isTimestamp(scenario.createdAt) ||
        !isTimestamp(scenario.updatedAt) ||
        !Array.isArray(scenario.floorPrograms) ||
        !isRecord(scenario.placement) ||
        !isRecord(scenario.parking) ||
        !Array.isArray(scenario.checks) ||
        !isRecord(scenario.economicsPreview)
      ) {
        errors.push("계획안 필수 필드 또는 프로젝트 소유권이 올바르지 않습니다.");
        break;
      }
      if (ids.has(scenario.id)) {
        errors.push("중복된 계획안 ID가 포함됐습니다.");
        break;
      }
      ids.add(scenario.id);
      if (scenario.layoutFinanceHistory != null && !layoutFinanceHistorySchema.safeParse(scenario.layoutFinanceHistory).success) {
        errors.push("평면 기반 면적 반영 이력이 올바르지 않습니다.");
      }
      if (scenario.quantityCost != null && !quantityCostPlanSchema.safeParse(scenario.quantityCost).success) {
        errors.push("상세 수량 원가의 단가·포함액·근거 형식이 올바르지 않습니다.");
      }
      if (scenario.constructionQuote !== undefined && !constructionQuoteSchema.safeParse(scenario.constructionQuote).success) {
        errors.push("공종 견적의 항목·범위·원문 참조 형식이 올바르지 않습니다.");
      }
      if (scenario.fullQuoteAdoption !== undefined) {
        try { validateFullQuoteCostContract(scenario.fullQuoteAdoption); }
        catch { errors.push("전체 견적 채택의 금액·범위·유효일이 올바르지 않습니다."); }
      }
      if (scenario.egressPlan != null && !egressPlanSchema.safeParse(scenario.egressPlan).success) {
        errors.push("피난·층간 코어 설정 또는 지상 출구 데이터가 올바르지 않습니다.");
      }
      if (scenario.floorPrograms.some(floor => !isRecord(floor) ||
          (floor.interiorLayout != null && !interiorDraftSchema.safeParse(floor.interiorLayout).success) ||
          (floor.interior !== undefined && !interiorLayoutSchema.safeParse(floor.interior).success))) {
        errors.push("실내 구획의 좌표·설정·문 데이터가 올바르지 않습니다.");
      }
      if (scenario.materials !== undefined && !planningMaterialSelectionSchema.safeParse(scenario.materials).success) {
        errors.push("외벽 면별 설정·수량·단가 형식이 올바르지 않습니다.");
      }
      if (scenario.parking.vehicleProfile != null && !vehicleProfileSchema.safeParse(scenario.parking.vehicleProfile).success) {
        errors.push("차량 제원·회전반경 입력이 올바르지 않습니다.");
      }
      if (scenario.parking.entryOffsetRatio != null && (typeof scenario.parking.entryOffsetRatio !== "number" ||
          !Number.isFinite(scenario.parking.entryOffsetRatio) || scenario.parking.entryOffsetRatio < 0 || scenario.parking.entryOffsetRatio > 1)) {
        errors.push("차량 진입 위치 입력이 올바르지 않습니다.");
      }
    }
  }
  const planningScenarioIds = new Set(
    Array.isArray(value.planningScenarios)
      ? value.planningScenarios
          .filter(isRecord)
          .map((scenario) => scenario.id)
          .filter((id): id is string => typeof id === "string")
      : [],
  );
  const financeScenarioIds = new Set(
    isRecord(value.projectData) && Array.isArray(value.projectData.scenarios)
      ? value.projectData.scenarios
          .filter(isRecord)
          .map((scenario) => scenario.id)
          .filter((id): id is string => typeof id === "string")
      : [],
  );
  const allScenarioIds = new Set([
    ...planningScenarioIds,
    ...financeScenarioIds,
  ]);
  for (const [label, id] of [
    ["선택 계획안", value.selectedScenarioId],
    ["대표 계획안", value.representativeScenarioId],
  ] as const) {
    if (
      id != null &&
      (typeof id !== "string" || !planningScenarioIds.has(id))
    ) {
      errors.push(`${label}이 Workspace 계획안 목록에 없습니다.`);
    }
  }
  if (value.representativeGeometry != null) {
    if (
      !isRecord(value.representativeGeometry) ||
      value.representativeGeometry.projectId !== value.projectId ||
      value.representativeGeometry.scenarioId !== value.representativeScenarioId ||
      !hasText(value.representativeGeometry.geometryHash, 300) ||
      !Number.isSafeInteger(value.representativeGeometry.scenarioVersion) ||
      !isTimestamp(value.representativeGeometry.generatedAt) ||
      !isRecord(value.representativeGeometry.validation)
    ) {
      errors.push("대표 Geometry가 Workspace 대표 계획과 일치하지 않습니다.");
    } else {
      const representative = (
        Array.isArray(value.planningScenarios)
          ? value.planningScenarios
          : []
      ).find(
        (scenario: unknown) =>
          isRecord(scenario) &&
          scenario.id === value.representativeScenarioId,
      ) as Record<string, unknown> | undefined;
      if (
        !representative ||
        representative.version !== value.representativeGeometry.scenarioVersion
      ) {
        errors.push("대표 Geometry와 계획안 버전이 일치하지 않습니다.");
      }
      if (value.representativeGeometry.analysisReference !== undefined &&
          (!representative || !analysisReferenceIsCurrent(representative as unknown as PlanningScenario,
            isRecord(value.projectData) ? value.projectData.parcel as Parcel : undefined,
            value.representativeGeometry as unknown as PlanningGeometrySnapshot))) {
        errors.push("예비 분석 기준안의 형식 또는 대지·계획 입력 연결값이 일치하지 않습니다.");
      }
    }
  } else if (value.representativeScenarioId != null) {
    errors.push("대표 계획에 대응하는 Geometry가 없습니다.");
  }
  if (value.representativeGeometry != null) {
    if (
      typeof value.representativeParcelBasisHash !== "string" ||
      !/^PG-BASIS-[0-9A-F]{8}$/.test(value.representativeParcelBasisHash)
    ) {
      errors.push("대표 계획의 부지 기준 해시가 올바르지 않습니다.");
    }
  } else if (value.representativeParcelBasisHash != null) {
    errors.push("대표 Geometry 없이 부지 기준 해시만 저장할 수 없습니다.");
  }
  if (value.envelopePlan != null) {
    const plan = value.envelopePlan;
    if (
      !isRecord(plan) ||
      ![
        null,
        "single-house",
        "multi-family",
        "retail",
      ].includes(plan.scenarioType as string | null) ||
      [
        plan.farPct,
        plan.floors,
        plan.units,
        plan.unitAreaSqm,
        plan.avgUnitAreaSqm,
        plan.requiredCars,
      ].some((item) => !isFiniteNumber(item) || item < 0)
    ) {
      errors.push("구형 Envelope 계획 필드가 올바르지 않습니다.");
    }
  }
  if (!Array.isArray(value.pendingOverrides)) {
    errors.push("가정 변경 대기 목록이 올바르지 않습니다.");
  } else if (
    value.pendingOverrides.some(
      (override) =>
        !isRecord(override) ||
        !hasText(override.scenarioId, 300) ||
        !allScenarioIds.has(override.scenarioId) ||
        !hasText(override.field, 200) ||
        !isFiniteNumber(override.baseValue) ||
        !isFiniteNumber(override.overrideValue) ||
        (override.reason != null && typeof override.reason !== "string") ||
        (override.evidenceUrl != null &&
          typeof override.evidenceUrl !== "string"),
    )
  ) {
    errors.push("가정 변경 대기 항목이 올바르지 않습니다.");
  }
  if (!isRecord(value.draftAssumptions)) {
    errors.push("계획안 가정 초안이 올바르지 않습니다.");
  } else if (
    Object.entries(value.draftAssumptions).some(
      ([scenarioId, draft]) =>
        !allScenarioIds.has(scenarioId) ||
        !isRecord(draft) ||
        Object.values(draft).some((item) => !isFiniteNumber(item)),
    )
  ) {
    errors.push("가정 초안에 다른 계획 또는 유한하지 않은 값이 포함됐습니다.");
  }
  if (
    value.draftAcquisitionPrice != null &&
    (!isFiniteNumber(value.draftAcquisitionPrice) ||
      value.draftAcquisitionPrice < 0)
  ) {
    errors.push("검토 중인 토지 매입가가 올바르지 않습니다.");
  }
  if (!isRecord(value.financialSources)) {
    errors.push("재무 원문 근거 묶음이 올바르지 않습니다.");
  } else if (
    Object.entries(value.financialSources).some(
      ([field, source]) =>
        !isRecord(source) ||
        source.field !== field ||
        !isFiniteNumber(source.value) ||
        !hasText(source.sourceKind, 100) ||
        !hasText(source.sourceName) ||
        !hasText(source.documentRef) ||
        !hasText(source.verifiedBy) ||
        !isTimestamp(source.asOf) ||
        !isTimestamp(source.recordedAt),
    )
  ) {
    errors.push("재무 원문 근거 항목의 필드 또는 값이 올바르지 않습니다.");
  }
  if (!Array.isArray(value.revenuePricingDrafts)) {
    errors.push("수익 풀 단가 초안 목록이 올바르지 않습니다.");
  } else if (
    value.revenuePricingDrafts.some((draft) => {
      if (
        !isRecord(draft) ||
        draft.version !== REVENUE_PRICING_INPUT_VERSION ||
        draft.projectId !== value.projectId ||
        !financeScenarioIds.has(String(draft.scenarioId)) ||
        !isRecord(draft.pools) ||
        !isTimestamp(draft.updatedAt)
      ) {
        return true;
      }
      return Object.entries(draft.pools).some(([pool, poolDraft]) => {
        if (
          !FINANCIAL_REVENUE_POOL_KEYS.includes(
            pool as (typeof FINANCIAL_REVENUE_POOL_KEYS)[number],
          ) ||
          !isRecord(poolDraft)
        ) {
          return true;
        }
        if (
          poolDraft.baseUnitPriceWon != null &&
          (!isFiniteNumber(poolDraft.baseUnitPriceWon) ||
            poolDraft.baseUnitPriceWon < 0)
        ) {
          return true;
        }
        return (
          poolDraft.adjustments != null &&
          (!isRecord(poolDraft.adjustments) ||
            Object.entries(poolDraft.adjustments).some(
              ([dimension, factor]) =>
                !REVENUE_PRICE_ADJUSTMENT_DIMENSIONS.includes(
                  dimension as (typeof REVENUE_PRICE_ADJUSTMENT_DIMENSIONS)[number],
                ) ||
                !isFiniteNumber(factor) ||
                factor <= 0 ||
                factor > 10,
            ))
        );
      });
    })
  ) {
    errors.push("수익 풀 단가 초안의 프로젝트·계획안 또는 값이 올바르지 않습니다.");
  }
  if (value.leaseRollDrafts !== undefined) {
    if (!Array.isArray(value.leaseRollDrafts) || value.leaseRollDrafts.length > 256) {
      errors.push("임대차 초안 목록은 256개 이하여야 합니다.");
    } else {
      const scenarioIds = new Set<string>();
      for (const draft of value.leaseRollDrafts) {
        if (
          !isRecord(draft) ||
          !leaseRollDraftSchema.safeParse(draft).success ||
          draft.projectId !== value.projectId ||
          typeof draft.scenarioId !== "string" ||
          !allScenarioIds.has(draft.scenarioId)
        ) {
          errors.push("임대차 초안 형식 또는 프로젝트·계획안 연결이 올바르지 않습니다.");
          break;
        }
        if (scenarioIds.has(draft.scenarioId)) {
          errors.push("동일 계획안의 임대차 초안이 중복됩니다.");
          break;
        }
        scenarioIds.add(draft.scenarioId);
      }
    }
  }
  if (value.operatingBudgetDrafts !== undefined) {
    if (!Array.isArray(value.operatingBudgetDrafts) || value.operatingBudgetDrafts.length > 256) {
      errors.push("운영비 예산 초안 목록은 256개 이하여야 합니다.");
    } else {
      const scenarioIds = new Set<string>();
      for (const draft of value.operatingBudgetDrafts) {
        if (
          !isRecord(draft) ||
          !operatingBudgetDraftSchema.safeParse(draft).success ||
          draft.projectId !== value.projectId ||
          typeof draft.scenarioId !== "string" ||
          !allScenarioIds.has(draft.scenarioId)
        ) {
          errors.push("운영비 예산 초안 형식 또는 프로젝트·계획안 연결이 올바르지 않습니다.");
          break;
        }
        if (scenarioIds.has(draft.scenarioId)) {
          errors.push("동일 계획안의 운영비 예산 초안이 중복됩니다.");
          break;
        }
        scenarioIds.add(draft.scenarioId);
      }
    }
  }
  if (!Array.isArray(value.expertTaxContracts)) {
    errors.push("세무 계약 목록이 올바르지 않습니다.");
  } else if (
    value.expertTaxContracts.some(
      (contract) =>
        !isRecord(contract) ||
        contract.projectId !== value.projectId ||
        !financeScenarioIds.has(String(contract.scenarioId)) ||
        !hasText(contract.schemaVersion, 100) ||
        !["stabilized-sale", "long-term-hold"].includes(
          String(contract.strategy),
        ) ||
        !["draft", "expert-confirmed"].includes(
          String(contract.reviewStatus),
        ) ||
        !Array.isArray(contract.assessments) ||
        !isTimestamp(contract.updatedAt),
    )
  ) {
    errors.push("세무 계약의 프로젝트·계획안 또는 필수 필드가 올바르지 않습니다.");
  }
  if (
    value.stage3Snapshot != null &&
    (!isRecord(value.stage3Snapshot) ||
      value.stage3Snapshot.projectId !== value.projectId ||
      !planningScenarioIds.has(String(value.stage3Snapshot.representativeScenarioId)) ||
      !Number.isSafeInteger(value.stage3Snapshot.representativeScenarioVersion) ||
      !hasText(value.stage3Snapshot.geometryHash, 300) ||
      !isTimestamp(value.stage3Snapshot.savedAt) ||
      !isRecord(value.stage3Snapshot.data))
  ) {
    errors.push("Stage 3 저장본의 프로젝트가 다릅니다.");
  }
  if (!isRecord(value.priceVerifications)) {
    errors.push("가격 검증 묶음이 올바르지 않습니다.");
  } else if (
    Object.entries(value.priceVerifications).some(
      ([target, verification]) =>
        !["acquisition", "sale"].includes(target) ||
        !isRecord(verification) ||
        verification.projectId !== value.projectId ||
        verification.target !== target ||
        !["draft", "review-requested", "verified", "rejected"].includes(
          String(verification.status),
        ) ||
        !Array.isArray(verification.selectedComps) ||
        !isTimestamp(verification.updatedAt),
    )
  ) {
    errors.push("가격 검증 항목의 프로젝트·대상 또는 필수 필드가 올바르지 않습니다.");
  }

  const byteLength = new TextEncoder().encode(
    canonicalProjectWorkspaceJson(value),
  ).byteLength;
  if (byteLength > MAX_PROJECT_WORKSPACE_BYTES) {
    errors.push(
      `프로젝트 Workspace가 ${MAX_PROJECT_WORKSPACE_BYTES.toLocaleString()}바이트 제한을 초과했습니다.`,
    );
  }
  return {
    valid: errors.length === 0,
    errors,
    payload: errors.length === 0 ? (value as unknown as ProjectWorkspacePayload) : null,
  };
}

export function projectWorkspaceSummary(
  record: ProjectWorkspaceRecord,
): ProjectWorkspaceSummary {
  return {
    projectId: record.projectId,
    revision: record.revision,
    payloadHash: record.payloadHash,
    address: record.payload.projectData.parcel.address,
    zoning: record.payload.projectData.parcel.zoning,
    lotAreaSqm: record.payload.projectData.parcel.lotArea,
    scenarioCount: record.payload.projectData.scenarios.length,
    planningScenarioCount: record.payload.planningScenarios.length,
    representativeScenarioId: record.payload.representativeScenarioId,
    stage3SavedAt: record.payload.stage3Snapshot?.savedAt ?? null,
    savedAt: record.savedAt,
    savedBy: record.savedBy,
    backend: record.backend,
  };
}

export function validateProjectWorkspaceIndex(value: unknown): {
  valid: boolean;
  errors: string[];
  index: ProjectWorkspaceIndex | null;
} {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["프로젝트 Workspace 목록 응답이 객체가 아닙니다."],
      index: null,
    };
  }
  if (value.version !== PROJECT_WORKSPACE_INDEX_VERSION) {
    errors.push("지원하지 않는 프로젝트 목록 버전입니다.");
  }
  if (!Array.isArray(value.projects)) {
    errors.push("프로젝트 목록이 올바르지 않습니다.");
  } else {
    const ids = new Set<string>();
    for (const summary of value.projects) {
      if (
        !isRecord(summary) ||
        !hasText(summary.projectId, 200) ||
        !Number.isSafeInteger(summary.revision) ||
        Number(summary.revision) < 1 ||
        typeof summary.payloadHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(summary.payloadHash) ||
        !hasText(summary.address) ||
        typeof summary.zoning !== "string" ||
        !isFiniteNumber(summary.lotAreaSqm) ||
        summary.lotAreaSqm <= 0 ||
        !Number.isSafeInteger(summary.scenarioCount) ||
        Number(summary.scenarioCount) < 1 ||
        !Number.isSafeInteger(summary.planningScenarioCount) ||
        Number(summary.planningScenarioCount) < 0 ||
        (summary.representativeScenarioId != null &&
          typeof summary.representativeScenarioId !== "string") ||
        (summary.stage3SavedAt != null && !isTimestamp(summary.stage3SavedAt)) ||
        !isTimestamp(summary.savedAt) ||
        !hasText(summary.savedBy) ||
        (summary.backend !== "postgresql" &&
          summary.backend !== "local-versioned")
      ) {
        errors.push("프로젝트 목록 항목의 필수 필드가 올바르지 않습니다.");
        break;
      }
      if (ids.has(summary.projectId)) {
        errors.push("프로젝트 목록에 중복된 프로젝트가 있습니다.");
        break;
      }
      ids.add(summary.projectId);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    index: errors.length === 0 ? (value as unknown as ProjectWorkspaceIndex) : null,
  };
}

export function validateProjectWorkspaceRecord(
  value: unknown,
  expectedProjectId?: string,
): {
  valid: boolean;
  errors: string[];
  record: ProjectWorkspaceRecord | null;
} {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["프로젝트 Workspace 응답이 객체가 아닙니다."],
      record: null,
    };
  }
  if (value.version !== PROJECT_WORKSPACE_VERSION) {
    errors.push("지원하지 않는 프로젝트 Workspace 응답 버전입니다.");
  }
  if (
    typeof value.projectId !== "string" ||
    (expectedProjectId && value.projectId !== expectedProjectId)
  ) {
    errors.push("Workspace 응답의 프로젝트 ID가 일치하지 않습니다.");
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) {
    errors.push("Workspace revision이 올바르지 않습니다.");
  }
  if (typeof value.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(value.payloadHash)) {
    errors.push("Workspace SHA-256이 올바르지 않습니다.");
  }
  if (typeof value.auditHash !== "string" || !/^[a-f0-9]{64}$/.test(value.auditHash)) {
    errors.push("Workspace 감사 해시가 올바르지 않습니다.");
  }
  if (typeof value.savedAt !== "string" || Number.isNaN(Date.parse(value.savedAt))) {
    errors.push("Workspace 저장 시각이 올바르지 않습니다.");
  }
  if (typeof value.savedBy !== "string" || !value.savedBy.trim()) {
    errors.push("Workspace 저장 주체가 없습니다.");
  }
  if (value.backend !== "postgresql" && value.backend !== "local-versioned") {
    errors.push("Workspace 저장 backend가 올바르지 않습니다.");
  }
  const payloadValidation = validateProjectWorkspacePayload(
    value.payload,
    expectedProjectId,
  );
  errors.push(...payloadValidation.errors);
  return {
    valid: errors.length === 0,
    errors,
    record:
      errors.length === 0 ? (value as unknown as ProjectWorkspaceRecord) : null,
  };
}
