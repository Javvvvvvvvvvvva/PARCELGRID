/**
 * Active project store.
 *
 * Stage 1 stores the computed parcel and existing-condition data.
 * Stage 2 stores multiple planning scenarios and the currently selected plan.
 * Stage 3 consumes a saved representative planning scenario for detailed feasibility analysis.
 */

"use client";

import { create } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { sessionLocalStorage } from "@/lib/auth/client-session";
import type { AssumptionSet } from "@/lib/finance/types";
import type { FinancialRevenuePoolKey } from "@/lib/finance/types";
import {
  buildLeaseRollDraftKey,
  leaseRollDraftSchema,
  type LeaseRollDraft,
} from "@/lib/finance/lease-roll-contract";
import {
  buildRevenuePricingDraftKey,
  REVENUE_PRICING_INPUT_VERSION,
  type RevenuePoolPricingDraft,
  type RevenuePricingDraftContract,
} from "@/lib/finance/revenue-contract";
import {
  buildExpertTaxContractKey,
  type ExpertTaxInputContract,
} from "@/lib/finance/after-tax-ledger";
import type {
  FinancialSourceMap,
  FinancialSourceRecord,
} from "@/lib/finance/source-data-gate";
import type { ProjectComputed } from "@/lib/services/compute-project";
import { recomputeFromPlanningScenarios } from "@/lib/services/recompute-from-planning-scenarios";
import { findProjectPlanningScenario, planningScenarioBelongsToProject } from "@/lib/planning/project-scope";
import type { PlanningScenario } from "@/lib/planning/types";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { hasParcelBoundary } from "@/lib/geo/parcel-topology";
import { protectLockedPlanningGeometryPatch } from "@/lib/planning/geometry-source";
import { defaultAssumptions } from "@/lib/finance/scenario";
import {
  applyPlanningScenarioCalculation,
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import { applySpatialValidationToCalculation, calculatePlanningSpatialValidation } from "@/lib/planning/scenario-spatial-validation";
import { buildPlanningParkingGeometry } from "@/lib/planning/planning-parking-geometry";
import { assessPlanningAnalysisReference, createAnalysisReferenceSelection } from "@/lib/planning/analysis-reference";
import {
  buildRepresentativeParcelBasisHash,
  representativeParcelBasisInvalidationReason,
} from "@/lib/planning/representative-basis";
import {
  clonePlanningScenario,
  touchPlanningScenario,
} from "@/lib/planning/scenario-utils";

/**
 * Legacy aggregate plan used by older Stage 2 and downstream screens.
 * It remains temporarily while the UI is migrated to PlanningScenario[].
 */
export interface EnvelopePlan {
  farPct: number;
  scenarioType: "single-house" | "multi-family" | "retail" | null;
  floors: number;
  units: number;
  /** 선택한 신축 상품 유형 기준 세대당 면적 (㎡) — 세대수 산정 기준 */
  unitAreaSqm: number;
  /** 실제 평균 세대당 면적 (연면적 ÷ 세대수) — 결과값 */
  avgUnitAreaSqm: number;
  requiredCars: number;
}

export interface PendingOverride {
  scenarioId: string;
  field: keyof AssumptionSet;
  baseValue: number;
  overrideValue: number;
  reason?: string;
  evidenceUrl?: string;
}

export interface Stage3FeasibilitySnapshot {
  projectId: string;
  representativeScenarioId: string;
  representativeScenarioVersion: number;
  geometryHash: string;
  savedAt: string;
  data: ProjectComputed;
}

interface ProjectStore {
  data: ProjectComputed | null;
  setData: (data: ProjectComputed) => void;

  pendingOverrides: PendingOverride[];
  setOverride: (override: PendingOverride) => void;
  clearOverride: (scenarioId: string, field: keyof AssumptionSet) => void;
  clearAllOverrides: () => void;

  draftAssumptions: Record<string, Partial<AssumptionSet>>;
  setDraftAssumption: (
    scenarioId: string,
    field: keyof AssumptionSet,
    value: number
  ) => void;
  resetDraftAssumptions: (scenarioId: string) => void;

  /** 프로젝트별 사용자가 검토 중인 토지 매입가(만원). 기본 인수가와 분리한다. */
  draftAcquisitionPrices: Record<string, number>;
  setDraftAcquisitionPrice: (projectId: string, value: number) => void;
  resetDraftAcquisitionPrice: (projectId: string) => void;

  /** 프로젝트별 전문가·공식 원문 기반 금융 입력. 유효한 기록은 Stage 3 계산을 덮어쓴다. */
  financialSources: Record<string, FinancialSourceMap>;
  setFinancialSource: (
    projectId: string,
    record: FinancialSourceRecord
  ) => void;
  removeFinancialSource: (
    projectId: string,
    field: FinancialSourceRecord["field"]
  ) => void;

  /** 계획안별 용도×처분 기준단가와 명시적 보정 입력. */
  revenuePricingDrafts: Record<string, RevenuePricingDraftContract>;
  setRevenuePoolPricingDraft: (
    projectId: string,
    scenarioId: string,
    pool: FinancialRevenuePoolKey,
    patch: RevenuePoolPricingDraft,
  ) => void;
  resetRevenuePricingDraft: (projectId: string, scenarioId: string) => void;

  /** Draft-only lease inputs; saving never updates calculated project data. */
  leaseRollDrafts: Record<string, LeaseRollDraft>;
  /** Requires revision 1 on first save, then current + 1; rejects by throwing. */
  saveLeaseRollDraft: (draft: LeaseRollDraft) => void;
  removeLeaseRollDraft: (projectId: string, scenarioId: string) => void;

  /** 계획안·처분전략별 세무 전문가 입력과 납부·환급 일정. */
  expertTaxContracts: Record<string, ExpertTaxInputContract>;
  setExpertTaxContract: (contract: ExpertTaxInputContract) => void;
  removeExpertTaxContract: (
    projectId: string,
    scenarioId: string,
    strategy: ExpertTaxInputContract["strategy"]
  ) => void;

  /** Stage 3에서 명시적으로 저장한 보고서용 계산 스냅샷. */
  stage3FeasibilitySnapshots: Record<string, Stage3FeasibilitySnapshot>;
  saveStage3FeasibilitySnapshot: (
    snapshot: Stage3FeasibilitySnapshot
  ) => void;
  clearStage3FeasibilitySnapshot: (projectId: string) => void;

  envelopePlan: EnvelopePlan | null;
  setEnvelopePlan: (plan: EnvelopePlan) => void;
  clearEnvelopePlan: () => void;

  planningScenarios: PlanningScenario[];
  selectedPlanningScenarioId: string | null;
  /** Stage 3로 넘길 대표 계획안. 저장 계획안과 별도로 명시적으로 확정한다. */
  representativePlanningScenarioId: string | null;
  /** 대표안 확정 시 잠긴 실제 계획 매스. 3D·계산·SketchUp export의 기준이다. */
  representativeGeometrySnapshot: PlanningGeometrySnapshot | null;
  /** 대표안 확정 당시 법규·경계·도로 입력의 불변 식별자. */
  representativeParcelBasisHash: string | null;
  /** 대표안 확정이 거부된 최근 기하 검증 사유. */
  geometryValidationError: string | null;
  setPlanningScenarios: (scenarios: PlanningScenario[]) => void;
  addPlanningScenario: (scenario: PlanningScenario) => string;
  /** 편집 중 즉시 재계산용. 버전은 올리지 않고 draft 상태로만 갱신한다. */
  editPlanningScenarioDraft: (
    id: string,
    patch: Partial<Omit<PlanningScenario, "id" | "createdAt" | "version">>
  ) => void;
  /** 명시적 저장용. 버전과 updatedAt을 한 번 올린다. */
  updatePlanningScenario: (
    id: string,
    patch: Partial<Omit<PlanningScenario, "id" | "createdAt">>
  ) => void;
  removePlanningScenario: (id: string) => void;
  duplicatePlanningScenario: (id: string, name?: string) => string | null;
  selectPlanningScenario: (id: string | null) => void;
  /** 기하 검증 통과 시에만 대표안과 geometry snapshot을 함께 확정한다. */
  setRepresentativePlanningScenarioId: (id: string | null, purpose?: "verified-reference" | "preliminary-analysis") => boolean;
  clearPlanningScenarios: () => void;

  activeScenarioId: string | null;
  setActiveScenarioId: (id: string | null) => void;
}

function representativeInvalidation(message: string) {
  return {
    representativePlanningScenarioId: null,
    representativeGeometrySnapshot: null,
    representativeParcelBasisHash: null,
    geometryValidationError: message,
  };
}

export const useProjectStore = create<ProjectStore>()(
  devtools(
    persist(
      (set, get) => ({
        data: null,
        setData: (data) =>
          set((state) => {
            const snapshot = state.representativeGeometrySnapshot;
            const invalidationReason =
              representativeParcelBasisInvalidationReason({
                snapshotProjectId: snapshot?.projectId,
                storedBasisHash: state.representativeParcelBasisHash,
                nextParcel: data.parcel,
              });
            if (invalidationReason) {
              return {
                data,
                ...representativeInvalidation(invalidationReason),
              };
            }
            return { data };
          }),

        pendingOverrides: [],
        setOverride: (override) =>
          set((state) => {
            const without = state.pendingOverrides.filter(
              (item) =>
                !(
                  item.scenarioId === override.scenarioId &&
                  item.field === override.field
                )
            );
            if (override.overrideValue === override.baseValue) {
              return { pendingOverrides: without };
            }
            return { pendingOverrides: [...without, override] };
          }),
        clearOverride: (scenarioId, field) =>
          set((state) => ({
            pendingOverrides: state.pendingOverrides.filter(
              (item) =>
                !(item.scenarioId === scenarioId && item.field === field)
            ),
          })),
        clearAllOverrides: () => set({ pendingOverrides: [] }),

        draftAssumptions: {},
        setDraftAssumption: (scenarioId, field, value) =>
          set((state) => ({
            draftAssumptions: {
              ...state.draftAssumptions,
              [scenarioId]: {
                ...(state.draftAssumptions[scenarioId] ?? {}),
                [field]: value,
              },
            },
          })),
        resetDraftAssumptions: (scenarioId) =>
          set((state) => {
            const next = { ...state.draftAssumptions };
            delete next[scenarioId];
            return { draftAssumptions: next };
          }),

        draftAcquisitionPrices: {},
        setDraftAcquisitionPrice: (projectId, value) =>
          set((state) => ({
            draftAcquisitionPrices: {
              ...state.draftAcquisitionPrices,
              [projectId]: value,
            },
          })),
        resetDraftAcquisitionPrice: (projectId) =>
          set((state) => {
            const next = { ...state.draftAcquisitionPrices };
            delete next[projectId];
            return { draftAcquisitionPrices: next };
          }),

        financialSources: {},
        setFinancialSource: (projectId, record) =>
          set((state) => ({
            financialSources: {
              ...state.financialSources,
              [projectId]: {
                ...(state.financialSources[projectId] ?? {}),
                [record.field]: record,
              },
            },
          })),
        removeFinancialSource: (projectId, field) =>
          set((state) => {
            const projectRecords = {
              ...(state.financialSources[projectId] ?? {}),
            };
            delete projectRecords[field];
            return {
              financialSources: {
                ...state.financialSources,
                [projectId]: projectRecords,
              },
            };
          }),

        revenuePricingDrafts: {},
        setRevenuePoolPricingDraft: (
          projectId,
          scenarioId,
          pool,
          patch,
        ) =>
          set((state) => {
            const key = buildRevenuePricingDraftKey(projectId, scenarioId);
            const current = state.revenuePricingDrafts[key];
            const currentPool = current?.pools[pool] ?? {};
            return {
              revenuePricingDrafts: {
                ...state.revenuePricingDrafts,
                [key]: {
                  version: REVENUE_PRICING_INPUT_VERSION,
                  projectId,
                  scenarioId,
                  pools: {
                    ...(current?.pools ?? {}),
                    [pool]: {
                      ...currentPool,
                      ...patch,
                      adjustments: {
                        ...(currentPool.adjustments ?? {}),
                        ...(patch.adjustments ?? {}),
                      },
                    },
                  },
                  updatedAt: new Date().toISOString(),
                },
              },
            };
          }),
        resetRevenuePricingDraft: (projectId, scenarioId) =>
          set((state) => {
            const next = { ...state.revenuePricingDrafts };
            delete next[buildRevenuePricingDraftKey(projectId, scenarioId)];
            return { revenuePricingDrafts: next };
          }),

        leaseRollDrafts: {},
        saveLeaseRollDraft: (draft) => {
          const parsed = leaseRollDraftSchema.parse(draft);
          set((state) => {
            if (
              state.data?.parcel.id !== parsed.projectId ||
              !state.data.scenarios.some((scenario) => scenario.id === parsed.scenarioId)
            ) {
              throw new Error("임대차 초안은 현재 프로젝트의 계산 계획안에 속해야 합니다.");
            }
            const key = buildLeaseRollDraftKey(parsed.projectId, parsed.scenarioId);
            const expectedRevision = (state.leaseRollDrafts[key]?.revision ?? 0) + 1;
            if (parsed.revision !== expectedRevision) {
              throw new Error(`임대차 초안 revision 충돌: 다음 저장 버전은 ${expectedRevision}입니다.`);
            }
            return {
              leaseRollDrafts: { ...state.leaseRollDrafts, [key]: parsed },
            };
          });
        },
        removeLeaseRollDraft: (projectId, scenarioId) =>
          set((state) => {
            const next = { ...state.leaseRollDrafts };
            delete next[buildLeaseRollDraftKey(projectId, scenarioId)];
            return { leaseRollDrafts: next };
          }),

        expertTaxContracts: {},
        setExpertTaxContract: (contract) =>
          set((state) => ({
            expertTaxContracts: {
              ...state.expertTaxContracts,
              [buildExpertTaxContractKey(
                contract.projectId,
                contract.scenarioId,
                contract.strategy
              )]: contract,
            },
          })),
        removeExpertTaxContract: (projectId, scenarioId, strategy) =>
          set((state) => {
            const next = { ...state.expertTaxContracts };
            delete next[
              buildExpertTaxContractKey(projectId, scenarioId, strategy)
            ];
            return { expertTaxContracts: next };
          }),

        stage3FeasibilitySnapshots: {},
        saveStage3FeasibilitySnapshot: (snapshot) =>
          set((state) => ({
            data: snapshot.data,
            stage3FeasibilitySnapshots: {
              ...state.stage3FeasibilitySnapshots,
              [snapshot.projectId]: snapshot,
            },
          })),
        clearStage3FeasibilitySnapshot: (projectId) =>
          set((state) => {
            const next = { ...state.stage3FeasibilitySnapshots };
            delete next[projectId];
            return { stage3FeasibilitySnapshots: next };
          }),

        envelopePlan: null,
        setEnvelopePlan: (envelopePlan) => set({ envelopePlan }),
        clearEnvelopePlan: () => set({ envelopePlan: null }),

        planningScenarios: [],
        selectedPlanningScenarioId: null,
        representativePlanningScenarioId: null,
        representativeGeometrySnapshot: null,
        representativeParcelBasisHash: null,
        geometryValidationError: null,
        setPlanningScenarios: (planningScenarios) =>
          set((state) => {
            const projectId = state.data?.parcel.id;
            if (!projectId) return state;
            const current = planningScenarios.filter(scenario => planningScenarioBelongsToProject(scenario, projectId))
              .map(scenario => scenario.projectId ? scenario : { ...scenario, projectId });
            const retained = new Set(current.map(scenario => scenario.id));
            if (retained.size !== current.length) throw new Error("현재 프로젝트의 계획안 ID가 중복됩니다.");
            const removed = new Set(state.planningScenarios.filter(scenario =>
              planningScenarioBelongsToProject(scenario, projectId) && !retained.has(scenario.id)).map(scenario => scenario.id));
            const representativeStillExists = current.some(
              (scenario) =>
                scenario.id === state.representativePlanningScenarioId
            );
            return {
              planningScenarios: [...state.planningScenarios.filter(scenario => !planningScenarioBelongsToProject(scenario, projectId)), ...current],
              leaseRollDrafts: Object.fromEntries(Object.entries(state.leaseRollDrafts).filter(([, draft]) =>
                draft.projectId !== projectId || !removed.has(draft.scenarioId))),
              selectedPlanningScenarioId: current.some(
                (scenario) => scenario.id === state.selectedPlanningScenarioId
              )
                ? state.selectedPlanningScenarioId
                : current[0]?.id ?? null,
              representativePlanningScenarioId: representativeStillExists
                ? state.representativePlanningScenarioId
                : null,
              representativeGeometrySnapshot: representativeStillExists
                ? state.representativeGeometrySnapshot
                : null,
              representativeParcelBasisHash: representativeStillExists
                ? state.representativeParcelBasisHash
                : null,
              geometryValidationError: representativeStillExists
                ? state.geometryValidationError
                : null,
            };
          }),
        addPlanningScenario: (scenario) => {
          set((state) => {
            const projectId = state.data?.parcel.id;
            if (!projectId || !planningScenarioBelongsToProject(scenario, projectId)) throw new Error("현재 프로젝트에 속한 계획안만 추가할 수 있습니다.");
            if (state.planningScenarios.some(value => value.id === scenario.id && planningScenarioBelongsToProject(value, projectId))) {
              throw new Error("현재 프로젝트에 같은 ID의 계획안이 있습니다.");
            }
            return { planningScenarios: [...state.planningScenarios, { ...scenario, projectId }], selectedPlanningScenarioId: scenario.id };
          });
          return scenario.id;
        },
        editPlanningScenarioDraft: (id, patch) =>
          set((state) => {
            const projectId = state.data?.parcel.id;
            const target = findProjectPlanningScenario(state.planningScenarios, id, projectId);
            if (!target) return state;
            if (patch.projectId !== undefined && patch.projectId !== projectId) throw new Error("계획안의 프로젝트를 편집으로 변경할 수 없습니다.");
            const invalidatesRepresentative =
              state.representativePlanningScenarioId === id;
            return {
              planningScenarios: state.planningScenarios.map((scenario) => {
                if (scenario !== target) return scenario;
                const protectedPatch = protectLockedPlanningGeometryPatch(
                  scenario,
                  patch
                );
                const patchedEconomics: PlanningScenario["economicsPreview"] =
                  protectedPatch.economicsPreview ?? {
                    ...scenario.economicsPreview,
                    status:
                      scenario.economicsPreview.status === "not-calculated"
                        ? "not-calculated"
                        : "stale",
                  };
                return {
                  ...scenario,
                  ...protectedPatch,
                  id: scenario.id,
                  projectId,
                  createdAt: scenario.createdAt,
                  version: scenario.version,
                  status: "draft",
                  updatedAt: new Date().toISOString(),
                  economicsPreview: patchedEconomics,
                };
              }),
              ...(invalidatesRepresentative
                ? representativeInvalidation(
                    "대표 계획안이 수정되어 Geometry Snapshot 재확정이 필요합니다."
                  )
                : {}),
              activeScenarioId:
                state.activeScenarioId === id ? null : state.activeScenarioId,
            };
          }),
        updatePlanningScenario: (id, patch) =>
          set((state) => {
            const projectId = state.data?.parcel.id;
            const target = findProjectPlanningScenario(state.planningScenarios, id, projectId);
            if (!target) return state;
            if (patch.projectId !== undefined && patch.projectId !== projectId) throw new Error("계획안의 프로젝트를 편집으로 변경할 수 없습니다.");
            const invalidatesRepresentative =
              state.representativePlanningScenarioId === id;
            return {
              planningScenarios: state.planningScenarios.map((scenario) =>
                scenario === target
                  ? touchPlanningScenario(
                      scenario,
                      { ...protectLockedPlanningGeometryPatch(scenario, patch), projectId }
                    )
                  : scenario
              ),
              ...(invalidatesRepresentative
                ? representativeInvalidation(
                    "대표 계획안 버전이 변경되어 Geometry Snapshot 재확정이 필요합니다."
                  )
                : {}),
            };
          }),
        removePlanningScenario: (id) =>
          set((state) => {
            const projectId = state.data?.parcel.id;
            const target = findProjectPlanningScenario(state.planningScenarios, id, projectId);
            if (!target) return state;
            const planningScenarios = state.planningScenarios.filter(
              (scenario) => scenario !== target
            );
            const removedRepresentative =
              state.representativePlanningScenarioId === id;
            return {
              planningScenarios,
              leaseRollDrafts: Object.fromEntries(Object.entries(state.leaseRollDrafts).filter(([, draft]) =>
                draft.scenarioId !== id || draft.projectId !== projectId)),
              selectedPlanningScenarioId:
                state.selectedPlanningScenarioId === id
                  ? planningScenarios.find(scenario => planningScenarioBelongsToProject(scenario, projectId))?.id ?? null
                  : state.selectedPlanningScenarioId,
              representativePlanningScenarioId: removedRepresentative
                ? null
                : state.representativePlanningScenarioId,
              representativeGeometrySnapshot: removedRepresentative
                ? null
                : state.representativeGeometrySnapshot,
              representativeParcelBasisHash: removedRepresentative
                ? null
                : state.representativeParcelBasisHash,
              geometryValidationError: removedRepresentative
                ? null
                : state.geometryValidationError,
              activeScenarioId:
                state.activeScenarioId === id ? null : state.activeScenarioId,
            };
          }),
        duplicatePlanningScenario: (id, name) => {
          const current = get(), projectId = current.data?.parcel.id;
          const source = findProjectPlanningScenario(current.planningScenarios, id, projectId);
          if (!source) return null;
          const copy = { ...clonePlanningScenario(source, name), projectId };
          set((state) => ({
            planningScenarios: [...state.planningScenarios, copy],
            selectedPlanningScenarioId: copy.id,
          }));
          return copy.id;
        },
        selectPlanningScenario: (selectedPlanningScenarioId) =>
          set(state => selectedPlanningScenarioId === null || findProjectPlanningScenario(state.planningScenarios,
            selectedPlanningScenarioId, state.data?.parcel.id) ? { selectedPlanningScenarioId } : state),
        setRepresentativePlanningScenarioId: (id, purpose = "verified-reference") => {
          if (id == null) {
            set({
              representativePlanningScenarioId: null,
              representativeGeometrySnapshot: null,
              representativeParcelBasisHash: null,
              geometryValidationError: null,
            });
            return true;
          }

          const state = get();
          const parcel = state.data?.parcel;
          const scenario = findProjectPlanningScenario(state.planningScenarios, id, parcel?.id);
          if (!scenario || !parcel) {
            set(
              representativeInvalidation(
                "계획안 또는 부지 데이터가 없어 대표안을 확정할 수 없습니다."
              )
            );
            return false;
          }
          if (!hasParcelBoundary(parcel)) {
            set(
              representativeInvalidation(
                "대지 경계 GIS 데이터가 없어 Geometry Snapshot을 만들 수 없습니다."
              )
            );
            return false;
          }

          const assumptionSource =
            state.data?.scenarios.find(
              (financeScenario) => financeScenario.id === id
            )?._raw.assumptions ??
            state.data?.scenarios[0]?._raw.assumptions ??
            defaultAssumptions();
          const baseCalculation = calculatePlanningScenario(scenario, {
            parcel: {
              address: parcel.address,
              zoning: parcel.zoning,
              zoningStatus:
                parcel.inputProvenance?.zoning === "vworld-land-use"
                  ? "public-observation"
                  : "user-entered",
              sunlightRuleAsOf: new Date().toISOString().slice(0, 10),
              lotAreaSqm: parcel.lotArea,
        boundary: parcel.boundary,
        boundaryPolygons: parcel.boundaryPolygons,
        roads: parcel.roads,
        setback: parcel.setback,
              maxFARPct: parcel.maxFAR,
              maxBCRPct: parcel.maxBCR,
              heightLimitM: parcel.heightLimit,
              regulatoryConstraints: parcel.regulatoryConstraints,
              roofAllowanceM: 1.4,
              acquisitionCostManwon: parcel.acquiredPrice,
              demolitionCostManwon: parcel.demolitionCost ?? 0,
            },
            assumptions: planningEconomicsAssumptionsFromLegacy(
              assumptionSource,
              "representative-readiness-v1"
            ),
            calculatedAt: new Date().toISOString(),
          });
          const calculation = applySpatialValidationToCalculation(baseCalculation, calculatePlanningSpatialValidation(
            parcel.boundary, parcel.zoning ?? "", scenario, parcel.roads, parcel.setback,
            baseCalculation.sunlight, baseCalculation.metrics.roofAllowanceM, parcel.boundaryPolygons,
          ));
          const readiness = assessRepresentativeCheckReadiness(
            calculation.checks
          );
          if (purpose !== "preliminary-analysis" && !readiness.ready) {
            const firstBlocker = readiness.blockers[0];
            set(
              representativeInvalidation(
                `대표안 법규·주차 검증 미완료: ${
                  firstBlocker?.message ??
                  "핵심 검증 항목을 모두 통과해야 합니다."
                }`
              )
            );
            return false;
          }
          const nextPlanningScenarios = state.planningScenarios.map(
            (candidate) =>
              candidate === scenario
                ? applyPlanningScenarioCalculation({ ...candidate, projectId: parcel.id }, calculation)
                : candidate
          );
          const calculatedScenario =
            findProjectPlanningScenario(nextPlanningScenarios, id, parcel.id) ??
            scenario;

          const geometry = buildPlanningGeometry({
            projectId: calculatedScenario.projectId ?? parcel.id,
            scenario: calculatedScenario,
            boundary: parcel.boundary,
            boundaryPolygons: parcel.boundaryPolygons,
            lotAreaSqm: parcel.lotArea,
            zoning: parcel.zoning ?? "",
            roads: parcel.roads,
            setback: parcel.setback,
            sunlight: calculation.sunlight,
            roofAllowanceM: calculation.metrics.roofAllowanceM,
          }).snapshot;
          if (!geometry.validation.representativeEligible) {
            const firstFailure = geometry.validation.issues.find(
              (issue) => issue.severity === "fail"
            );
            set(
              representativeInvalidation(
                firstFailure?.message ??
                  "계획 매스 기하 검증을 통과하지 못해 대표안을 확정할 수 없습니다."
              )
            );
            return false;
          }

          if (purpose === "preliminary-analysis") {
            const parking = buildPlanningParkingGeometry({ scenario: calculatedScenario, planning: geometry,
              requiredCars: calculation.parking.requiredCars, boundary: parcel.boundary,
              boundaryPolygons: parcel.boundaryPolygons, roads: parcel.roads });
            const input = { scenario: calculatedScenario, parcel, calculation, geometry, parking };
            const assessment = assessPlanningAnalysisReference(input);
            if (!assessment.ready) {
              set(representativeInvalidation(`예비 분석 채택 미완료: ${assessment.blockers[0]?.message}`));
              return false;
            }
            try {
              const selection = createAnalysisReferenceSelection(input, new Date().toISOString());
              if (!selection) return false;
              geometry.analysisReference = selection;
            } catch {
              set(representativeInvalidation("예비 분석 입력의 연결값을 생성하지 못했습니다."));
              return false;
            }
          }

          let nextData: ProjectComputed | null = null;
          try {
            nextData = recomputeFromPlanningScenarios(
              parcel,
              nextPlanningScenarios,
              id,
              state.data,
              {
                startDate: parcel.acquired,
                calculateMaxAcquisition: true,
                geometryHashes: {
                  [id]: geometry.geometryHash,
                },
                financialSources: state.financialSources[parcel.id],
              }
            );
          } catch (error) {
            set(
              representativeInvalidation(
                error instanceof Error
                  ? `대표 계획안 금융 재계산 실패: ${error.message}`
                  : "대표 계획안 금융 재계산을 완료하지 못했습니다."
              )
            );
            return false;
          }
          if (!nextData) {
            set(
              representativeInvalidation(
                "대표 계획안을 금융 시나리오로 변환하지 못했습니다."
              )
            );
            return false;
          }

          set({
            data: nextData,
            planningScenarios: nextPlanningScenarios,
            representativePlanningScenarioId: id,
            representativeGeometrySnapshot: geometry,
            representativeParcelBasisHash:
              buildRepresentativeParcelBasisHash(parcel),
            geometryValidationError: null,
          });
          return true;
        },
        clearPlanningScenarios: () =>
          set(state => {
            const projectId = state.data?.parcel.id;
            if (!projectId) return state;
            const removed = new Set(state.planningScenarios.filter(scenario => planningScenarioBelongsToProject(scenario, projectId)).map(scenario => scenario.id));
            return {
            planningScenarios: state.planningScenarios.filter(scenario => !planningScenarioBelongsToProject(scenario, projectId)),
            leaseRollDrafts: Object.fromEntries(Object.entries(state.leaseRollDrafts).filter(([, draft]) =>
              draft.projectId !== projectId || !removed.has(draft.scenarioId))),
            selectedPlanningScenarioId: null,
            representativePlanningScenarioId: null,
            representativeGeometrySnapshot: null,
            representativeParcelBasisHash: null,
            geometryValidationError: null,
            activeScenarioId: null,
          }; }),

        activeScenarioId: null,
        setActiveScenarioId: (activeScenarioId) =>
          set({ activeScenarioId }),
      }),
      {
        name: "parcelgrid-envelope",
        storage: createJSONStorage(() => sessionLocalStorage),
        skipHydration: true,
        partialize: (state) => ({
          envelopePlan: state.envelopePlan,
          planningScenarios: state.planningScenarios,
          selectedPlanningScenarioId: state.selectedPlanningScenarioId,
          representativePlanningScenarioId:
            state.representativePlanningScenarioId,
          representativeGeometrySnapshot:
            state.representativeGeometrySnapshot,
          representativeParcelBasisHash: state.representativeParcelBasisHash,
          activeScenarioId: state.activeScenarioId,
          draftAssumptions: state.draftAssumptions,
          draftAcquisitionPrices: state.draftAcquisitionPrices,
          financialSources: state.financialSources,
          revenuePricingDrafts: state.revenuePricingDrafts,
          leaseRollDrafts: state.leaseRollDrafts,
          expertTaxContracts: state.expertTaxContracts,
          stage3FeasibilitySnapshots: state.stage3FeasibilitySnapshots,
        }),
      }
    )
  )
);

export function findOverride(
  overrides: PendingOverride[],
  scenarioId: string,
  field: keyof AssumptionSet
): PendingOverride | undefined {
  return overrides.find(
    (override) =>
      override.scenarioId === scenarioId && override.field === field
  );
}
