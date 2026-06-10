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
import { devtools } from "zustand/middleware";
import type { AssumptionSet } from "@/lib/finance/types";
import type { ProjectComputed } from "@/lib/services/compute-project";

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

  // Which scenario is "focused" across screens
  activeScenarioId: string | null;
  setActiveScenarioId: (id: string | null) => void;
}

export const useProjectStore = create<ProjectStore>()(
  devtools((set) => ({
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

    activeScenarioId: null,
    setActiveScenarioId: (id) => set({ activeScenarioId: id }),
  }))
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
