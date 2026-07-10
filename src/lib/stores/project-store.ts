/**
 * Active project store.
 *
 * Holds the current project's computed data and any pending assumption
 * overrides. The assumption editor screen mutates `pendingOverrides`;
 * the rest of the app subscribes and re-renders.
 *
 * Why Zustand and not React Query alone:
 *   - The "what-if" feel of the assumption editor needs optimistic local
 *     state that doesn't round-trip to the server on every keystroke.
 *   - Multiple screens share the in-flight override state simultaneously
 *     (editor on the right, KPI tiles on the left).
 *
 * Why not just useState lifted to App level:
 *   - Survives client-side route changes without re-fetching.
 *   - Cleanly separates "applied state" (the saved project) from
 *     "draft state" (pending overrides).
 */

"use client";

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { AssumptionSet } from "@/lib/finance/types";
import type { ProjectComputed } from "@/lib/services/compute-project";

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

  // 가정 편집 draft (시나리오별) — 대시보드 사이드바 ↔ 가정 편집 페이지 공유.
  // 화면을 넘나들어도(그리고 새로고침해도) 편집값이 유지된다.
  draftAssumptions: Record<string, Partial<AssumptionSet>>;
  setDraftAssumption: (
    scenarioId: string,
    field: keyof AssumptionSet,
    value: number
  ) => void;
  resetDraftAssumptions: (scenarioId: string) => void;

  // envelope 건축 기획 (단일 진실 소스)
  envelopePlan: EnvelopePlan | null;
  setEnvelopePlan: (plan: EnvelopePlan) => void;
  clearEnvelopePlan: () => void;

  // Which scenario is "focused" across screens
  activeScenarioId: string | null;
  setActiveScenarioId: (id: string | null) => void;
}

export const useProjectStore = create<ProjectStore>()(
  devtools(
    persist(
      (set) => ({
    data: null,
    setData: (data) => set({ data }),

    pendingOverrides: [],

    setOverride: (override) =>
      set((s) => {
        const without = s.pendingOverrides.filter(
          (o) =>
            !(
              o.scenarioId === override.scenarioId &&
              o.field === override.field
            )
        );
        // Only keep the override if it actually differs from base
        if (override.overrideValue === override.baseValue) {
          return { pendingOverrides: without };
        }
        return { pendingOverrides: [...without, override] };
      }),

    clearOverride: (scenarioId, field) =>
      set((s) => ({
        pendingOverrides: s.pendingOverrides.filter(
          (o) => !(o.scenarioId === scenarioId && o.field === field)
        ),
      })),

    clearAllOverrides: () => set({ pendingOverrides: [] }),

    draftAssumptions: {},
    setDraftAssumption: (scenarioId, field, value) =>
      set((s) => ({
        draftAssumptions: {
          ...s.draftAssumptions,
          [scenarioId]: {
            ...(s.draftAssumptions[scenarioId] ?? {}),
            [field]: value,
          },
        },
      })),
    resetDraftAssumptions: (scenarioId) =>
      set((s) => {
        const next = { ...s.draftAssumptions };
        delete next[scenarioId];
        return { draftAssumptions: next };
      }),

    activeScenarioId: null,
    envelopePlan: null,
    setEnvelopePlan: (envelopePlan) => set({ envelopePlan }),
    clearEnvelopePlan: () => set({ envelopePlan: null }),

    setActiveScenarioId: (id) => set({ activeScenarioId: id }),
      }),
      {
        name: "parcelgrid-envelope",
        partialize: (state) => ({
          envelopePlan: state.envelopePlan,
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
    (o) => o.scenarioId === scenarioId && o.field === field
  );
}
