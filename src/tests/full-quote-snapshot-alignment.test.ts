import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullQuoteAdoptionFixture } from "./helpers/full-quote-adoption-fixture";
import { validateReviewSnapshotAlignment, type ReviewableStage3Snapshot } from "@/lib/handoff/review-snapshot";
import { resolveStage3DashboardContext } from "@/lib/stage3/dashboard-model";
import { recomputeFromPlanningScenarios } from "@/lib/services/recompute-from-planning-scenarios";
import { canonicalProjectWorkspaceJson } from "@/lib/workspace/project-workspace";
import type { PlanningScenario } from "@/lib/planning/types";
import { fullQuoteCostContractsMatch } from "@/lib/planning/full-quote-cost-contract";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-11T00:00:00Z")); });
afterEach(() => vi.useRealTimers());

function setup(savedAdoption: boolean) {
  const f = fullQuoteAdoptionFixture();
  const savedPlan = savedAdoption ? f.adopted : f.scenario;
  const data = recomputeFromPlanningScenarios(f.data.parcel, [savedPlan], savedPlan.id, f.data, {
    calculateMaxAcquisition: false, geometryHashes: { [savedPlan.id]: f.geometry.geometryHash }, startDate: "2026-11-01",
  })!;
  const snapshot: ReviewableStage3Snapshot = { projectId: f.projectId, representativeScenarioId: savedPlan.id,
    representativeScenarioVersion: savedPlan.version, geometryHash: f.geometry.geometryHash,
    savedAt: "2026-11-11T00:00:00Z", data };
  const check = (current: PlanningScenario) => ({
    alignment: validateReviewSnapshotAlignment({ snapshot, geometry: f.geometry, currentScenario: current }),
    dashboard: resolveStage3DashboardContext({ parcel: data.parcel, projectId: f.projectId,
      representativeScenarioId: current.id, representativeGeometrySnapshot: f.geometry,
      planningScenarios: [{ ...current, checks: ["bcr", "far", "height", "parking"].map(code =>
        ({ code, label: code, status: "pass" as const, message: "Synthetic readiness for contract-boundary test" })) }],
      financeScenarios: data.scenarios }),
  });
  return { ...f, snapshot, check };
}

describe("full quote current/saved finance alignment", () => {
  it("rejects a pre-adoption snapshot even when plan version and geometry did not change", () => {
    const f = setup(false);
    expect(f.check(f.scenario).alignment.valid).toBe(true);
    expect(f.check(f.scenario).dashboard.ready).toBe(true);
    const result = f.check(f.adopted);
    expect(result.alignment.valid).toBe(false);
    expect(result.dashboard).toMatchObject({ ready: false, code: "stale-finance-contract" });
    expect(f.snapshot.data.scenarios[0]._raw.program.areaContract?.fullQuoteCost).toBeUndefined();
  });
  it("rejects a quoted snapshot after explicit removal without deleting the old snapshot", () => {
    const f = setup(true), before = structuredClone(f.snapshot);
    expect(f.check(f.scenario).alignment.valid).toBe(false);
    expect(f.check(f.scenario).dashboard).toMatchObject({ ready: false, code: "stale-finance-contract" });
    expect(f.snapshot).toEqual(before);
  });
  it("accepts matching recomputed quote contracts after JSONB key reordering", () => {
    const f = setup(true);
    const current = JSON.parse(canonicalProjectWorkspaceJson(f.adopted));
    expect(f.check(current).alignment.valid).toBe(true);
    expect(f.check(current).dashboard.ready).toBe(true);
    expect(f.snapshot.data.scenarios[0].hardCost).toBeCloseTo(f.quote.statedTotalWon! / 10000, 0);
  });
  it("preserves historical snapshot alignment after the original quote expires", () => {
    const f = setup(true);
    vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
    expect(f.check(f.adopted).alignment.valid).toBe(true);
  });
  it("rejects identical malformed contracts instead of treating matching JSON as validation", () => {
    const f = setup(true);
    const invalid = { ...f.adopted.fullQuoteAdoption, totalWon: -1 };
    expect(fullQuoteCostContractsMatch(invalid, structuredClone(invalid))).toBe(false);
    expect(fullQuoteCostContractsMatch(null, null)).toBe(false);
  });
  it.each(["scope", "quote", "total", "source-key"])("rejects changed %s even if a geometry hash was retained", change => {
    const f = setup(true);
    const stored = f.snapshot.data.scenarios[0]._raw.program.areaContract!.fullQuoteCost!;
    if (change === "scope") stored.review.scopes[0].source += " revised";
    if (change === "quote") stored.quote.reference += " revised";
    if (change === "total") stored.totalWon += 1;
    if (change === "source-key") stored.sourceKey = stored.review.sourceKey = "PG-QUOTE-REVIEW-" + "a".repeat(64);
    expect(f.check(f.adopted).alignment.valid).toBe(false);
    expect(f.check(f.adopted).dashboard).toMatchObject({ ready: false, code: "stale-finance-contract" });
  });
});
