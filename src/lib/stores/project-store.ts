/**
 * Active project store.
 *
 * Stage 1 stores the computed parcel and existing-condition data.
 * Stage 2 stores multiple planning scenarios and the currently selected plan.
 * Stage 3 consumes a saved planning scenario for detailed feasibility analysis.
 */

"use client";

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { AssumptionSet } from "@/lib/finance/types";
import type { ProjectComputed } from "@/lib/services/compute-project";
import type { PlanningScenario } from "@/lib/planning/types";
import {
  clonePlanningScenario,
  touchPlanningScenario,
} from "@/lib/planning/scenario-utils";

/**
 * Legacy aggregate plan used by the current Stage 2 screen.
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

interface ProjectStore {
  // Server state, refreshed via React Query
  data: ProjectComputed | null;
  setData: (data: ProjectComputed) => void;

  // Draft overrides not yet saved
  pendingOverrides: PendingOverride[];
  setOverride: (override: PendingOverride) => void;
  clearOverride: (scenarioId: string, field: keyof AssumptionSet) => void;
  clearAllOverrides: () => void;

  // 가정 편집 draft (시나리오별)
  draftAssumptions: Record<string, Partial<AssumptionSet>>;
  setDraftAssumption: (
    scenarioId: string,
    field: keyof AssumptionSet,
    value: number
  ) => void;
  resetDraftAssumptions: (scenarioId: string) => void;

  // Legacy envelope plan — removed after the Stage 2 UI migration is complete.
  envelopePlan: EnvelopePlan | null;
  setEnvelopePlan: (plan: EnvelopePlan) => void;
  clearEnvelopePlan: () => void;

  // Stage 2 planning scenarios
  planningScenarios: PlanningScenario[];
  selectedPlanningScenarioId: string | null;
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
  clearPlanningScenarios: () => void;

  // Which finance scenario is focused across legacy screens
  activeScenarioId: string | null;
  setActiveScenarioId: (id: string | null) => void;
}

export const useProjectStore = create<ProjectStore>()(
  devtools(
    persist(
      (set, get) => ({
        data: null,
        setData: (data) => set({ data }),

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
              (item) => !(item.scenarioId === scenarioId && item.field === field)
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

        envelopePlan: null,
        setEnvelopePlan: (envelopePlan) => set({ envelopePlan }),
        clearEnvelopePlan: () => set({ envelopePlan: null }),

        planningScenarios: [],
        selectedPlanningScenarioId: null,
        setPlanningScenarios: (planningScenarios) =>
          set((state) => ({
            planningScenarios,
            selectedPlanningScenarioId:
              planningScenarios.some(
                (scenario) => scenario.id === state.selectedPlanningScenarioId
              )
                ? state.selectedPlanningScenarioId
                : planningScenarios[0]?.id ?? null,
          })),
        addPlanningScenario: (scenario) => {
          set((state) => ({
            planningScenarios: [...state.planningScenarios, scenario],
            selectedPlanningScenarioId: scenario.id,
          }));
          return scenario.id;
        },
        editPlanningScenarioDraft: (id, patch) =>
          set((state) => ({
            planningScenarios: state.planningScenarios.map((scenario) => {
              if (scenario.id !== id) return scenario;
              const patchedEconomics = patch.economicsPreview
                ? patch.economicsPreview
                : {
                    ...scenario.economicsPreview,
                    status:
                      scenario.economicsPreview.status === "not-calculated"
                        ? "not-calculated"
                        : "stale",
                  };
              return {
                ...scenario,
                ...patch,
                id: scenario.id,
                createdAt: scenario.createdAt,
                version: scenario.version,
                status: "draft",
                updatedAt: new Date().toISOString(),
                economicsPreview: patchedEconomics,
              };
            }),
          })),
        updatePlanningScenario: (id, patch) =>
          set((state) => ({
            planningScenarios: state.planningScenarios.map((scenario) =>
              scenario.id === id
                ? touchPlanningScenario(scenario, patch)
                : scenario
            ),
          })),
        removePlanningScenario: (id) =>
          set((state) => {
            const planningScenarios = state.planningScenarios.filter(
              (scenario) => scenario.id !== id
            );
            return {
              planningScenarios,
              selectedPlanningScenarioId:
                state.selectedPlanningScenarioId === id
                  ? planningScenarios[0]?.id ?? null
                  : state.selectedPlanningScenarioId,
            };
          }),
        duplicatePlanningScenario: (id, name) => {
          const source = get().planningScenarios.find(
            (scenario) => scenario.id === id
          );
          if (!source) return null;
          const copy = clonePlanningScenario(source, name);
          set((state) => ({
            planningScenarios: [...state.planningScenarios, copy],
            selectedPlanningScenarioId: copy.id,
          }));
          return copy.id;
        },
        selectPlanningScenario: (selectedPlanningScenarioId) =>
          set({ selectedPlanningScenarioId }),
        clearPlanningScenarios: () =>
          set({ planningScenarios: [], selectedPlanningScenarioId: null }),

        activeScenarioId: null,
        setActiveScenarioId: (activeScenarioId) => set({ activeScenarioId }),
      }),
      {
        name: "parcelgrid-envelope",
        partialize: (state) => ({
          envelopePlan: state.envelopePlan,
          planningScenarios: state.planningScenarios,
          selectedPlanningScenarioId: state.selectedPlanningScenarioId,
          draftAssumptions: state.draftAssumptions,
        }),
      }
    )
  )
);

/** Get the override for a specific (scenario, field), if any. */
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
