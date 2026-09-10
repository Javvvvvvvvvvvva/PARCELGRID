"use client";

import { useMemo } from "react";
import { useProjectStore } from "@/lib/stores/project-store";
import { resolveStage3DashboardContext } from "@/lib/stage3/dashboard-model";
import { validateReviewSnapshotAlignment } from "@/lib/handoff/review-snapshot";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import { coreRegulatoryConstraintsVerified } from "@/lib/regulatory/constraints";
import { buildSourceDataGate, type FinancialSourceMap } from "@/lib/finance/source-data-gate";
import { canShowSavedFinance, describeNextAction, haveInputsChanged } from "./presentation";

const EMPTY_SOURCES: FinancialSourceMap = Object.freeze({});

/** Read-only projection of existing stores and gates. No setters, engine runs,
 * approval records, or additional persisted project fields belong here. */
export function useProjectOverview(projectId: string) {
  const live = useProjectStore((s) => s.data);
  const scenarios = useProjectStore((s) => s.planningScenarios);
  const representativeId = useProjectStore((s) => s.representativePlanningScenarioId);
  const currentGeometry = useProjectStore((s) => s.representativeGeometrySnapshot);
  const snapshot = useProjectStore((s) => s.stage3FeasibilitySnapshots[projectId]);
  const drafts = useProjectStore((s) => s.draftAssumptions);
  const draftPrice = useProjectStore((s) => s.draftAcquisitionPrices[projectId]);
  const sources = useProjectStore((s) => s.financialSources[projectId] ?? EMPTY_SOURCES);

  return useMemo(() => {
    // Do not flash the previous project's parcel during route hydration.
    const projectMatches = live?.parcel.id === projectId;
    const data = projectMatches ? live : null;
    const plan = projectMatches ? scenarios.find((s) => s.id === representativeId && (!s.projectId || s.projectId === projectId)) ?? null : null;
    const scopedGeometry = currentGeometry?.projectId === projectId ? currentGeometry : null;
    const checks = plan ? assessRepresentativeCheckReadiness(plan.checks) : null;
    const geometryReady = Boolean(projectMatches && plan && plan.status !== "draft" && scopedGeometry && checks?.ready &&
      scopedGeometry.scenarioId === plan.id && scopedGeometry.scenarioVersion === plan.version &&
      scopedGeometry.validation.status === "pass" && scopedGeometry.validation.representativeEligible &&
      scopedGeometry.validation.exportable);
    const geometry = geometryReady ? scopedGeometry : null;
    const ownedSnapshot = snapshot?.projectId === projectId && snapshot.data.parcel.id === projectId ? snapshot : null;
    const alignment = validateReviewSnapshotAlignment({ snapshot: ownedSnapshot, geometry, currentScenario: plan });
    const context = resolveStage3DashboardContext({
      projectId, representativeScenarioId: representativeId,
      representativeGeometrySnapshot: geometry, planningScenarios: scenarios,
      financeScenarios: ownedSnapshot?.data.scenarios ?? [],
    });
    const savedScenario = context.ready ? context.financeScenario : null;
    const savedInputs = { ...savedScenario?._raw.assumptions, acquisitionPrice: ownedSnapshot?.data.parcel.acquiredPrice };
    const draftInputs = { ...(representativeId ? drafts[representativeId] : {}), acquisitionPrice: draftPrice };
    const inputsChanged = Boolean(ownedSnapshot && savedScenario && haveInputsChanged(savedInputs, draftInputs, sources));
    const sourceGate = savedScenario ? buildSourceDataGate(savedScenario._raw, sources) : null;
    const regulatoryVerified = Boolean(data && coreRegulatoryConstraintsVerified(data.parcel.regulatoryConstraints));
    const readiness = {
      projectMatches, geometryReady, snapshotPresent: Boolean(ownedSnapshot), snapshotAligned: alignment.valid,
      financeReady: context.ready, inputsChanged, regulatoryVerified,
      sourceBacked: sourceGate?.status === "source-backed",
    };
    const finance = canShowSavedFinance(readiness) ? savedScenario : null;
    return {
      projectId, data, plan, geometry, snapshot: ownedSnapshot, finance, sources, sourceGate,
      readiness, next: describeNextAction(readiness),
      alignmentErrors: alignment.errors,
      planningMessage: context.ready ? null : context.message,
    };
  }, [live, scenarios, representativeId, currentGeometry, snapshot, drafts, draftPrice, sources, projectId]);
}
export type ProjectOverviewModel = ReturnType<typeof useProjectOverview>;
