/**
 * React Query hooks for project data.
 *
 * - useProject: fetches the computed project (4 scenarios + PF + risks).
 * - useScenarioRecalc: re-runs one scenario with pending overrides.
 *   Used by the assumption editor for live "what-if" preview.
 * - useSensitivity: 2D grid.
 * - useCompsAnalysis: hedonic comp adjustment.
 *
 * All queries are keyed so they refetch only when inputs actually change.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProjectComputed } from "@/lib/services/compute-project";
import type {
  Parcel,
  Scenario,
  ScenarioResult,
  PFSchedule,
  TaxBreakdown,
  SensitivityGrid,
  AssumptionSet,
} from "@/lib/finance/types";
import type { RiskCheck } from "@/lib/finance/compliance";
import type { CompAnalysis, Comp } from "@/lib/finance/comps";

// ─────────────────────────── Project ───────────────────────────

export function useProject(projectId: string) {
  return useQuery<ProjectComputed>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error(`Failed to load project: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

// ─────────────────────────── Live scenario recalc ───────────────────────────

interface CalcResponse {
  result: ScenarioResult;
  schedule: PFSchedule;
  taxes: TaxBreakdown;
  compliance: RiskCheck[];
  complianceScore: number;
}

export function useScenarioCalc(parcel: Parcel | null, scenario: Scenario | null) {
  return useQuery<CalcResponse>({
    enabled: !!parcel && !!scenario,
    queryKey: ["scenario-calc", scenario?.id, JSON.stringify(scenario?.assumptions)],
    queryFn: async () => {
      const res = await fetch("/api/scenarios/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcel, scenario }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Calc failed: ${res.status}`);
      }
      return res.json();
    },
    // Recalc is small; don't keep stale because UI shows live impact
    staleTime: 0,
  });
}

// ─────────────────────────── Sensitivity ───────────────────────────

export function useSensitivity(
  parcel: Parcel | null,
  scenario: Scenario | null,
  paramX: keyof AssumptionSet,
  paramY: keyof AssumptionSet
) {
  return useQuery<{ grid: SensitivityGrid }>({
    enabled: !!parcel && !!scenario,
    queryKey: ["sensitivity", scenario?.id, paramX, paramY],
    queryFn: async () => {
      const res = await fetch("/api/scenarios/sensitivity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcel, scenario, paramX, paramY }),
      });
      if (!res.ok) throw new Error(`Sensitivity failed: ${res.status}`);
      return res.json();
    },
  });
}

// ─────────────────────────── Comps ───────────────────────────

interface CompsAnalysisResponse {
  analysis: CompAnalysis;
  target: { lotArea: number; plannedFAR: number };
  comps: Comp[];
}

export function useCompsAnalysis(target?: { lotArea: number; plannedFAR: number }) {
  return useQuery<CompsAnalysisResponse>({
    queryKey: ["comps", target?.lotArea, target?.plannedFAR],
    queryFn: async () => {
      const res = await fetch("/api/comps/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!res.ok) throw new Error(`Comps analysis failed: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}
