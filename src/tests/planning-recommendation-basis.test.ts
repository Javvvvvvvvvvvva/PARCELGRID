import { beforeAll, describe, expect, it } from "vitest";
import {
  generatePlanningRecommendationsV2,
  selectCurrentPlanningRecommendations,
  type PlanningRecommendationAnalysis,
} from "@/lib/planning/recommendation-analysis";
import { planningRecommendationInput, planningRecommendationInputBasis } from "@/lib/planning/recommendation-basis";
import type { PlanningRecommendationEngineInput } from "@/lib/planning/recommendation-engine";
import type { PlanningScenario } from "@/lib/planning/types";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

export function recommendationProject() {
  const data = projectWorkspaceFixture("same-pnu").projectData;
  data.scenarios = [];
  Object.assign(data.parcel, {
    lotArea: 1600, maxFAR: 250, maxBCR: 50, heightLimit: 18,
    acquiredPrice: 20_000, demolitionCost: 1_000,
    boundary: [[127.0255, 37.6503], [127.0260, 37.6503],
      [127.0260, 37.6507], [127.0255, 37.6507], [127.0255, 37.6503]],
    roads: [], setback: { road: 0.5, side: 0.5, rear: 0.5 },
  });
  return data;
}

describe("recommendation input provenance", () => {
  let input: PlanningRecommendationEngineInput;
  let result: PlanningRecommendationAnalysis;
  let plans: PlanningScenario[];
  beforeAll(() => {
    input = planningRecommendationInput(recommendationProject(), "same-pnu");
    result = generatePlanningRecommendationsV2({ ...input, generatedAt: "2026-10-17T12:00:00Z" });
    plans = [result.architecturalFeasibility, result.profitOptimal, result.legalCeilingReference, result.combinedPrimary]
      .filter((plan): plan is PlanningScenario => Boolean(plan));
    expect(plans.length).toBeGreaterThan(0);
  });

  it("preserves plans but rejects old 250% recommendations for the same PNU at 200%", () => {
    const before = JSON.stringify(plans);
    const changed = structuredClone(input);
    changed.parcel.maxFARPct = 200;
    const selected = selectCurrentPlanningRecommendations(plans, input.projectId, planningRecommendationInputBasis(changed));
    expect(selected.current).toEqual([]);
    expect(selected.stale).toHaveLength(plans.length);
    expect(JSON.stringify(plans)).toBe(before);
    const regenerated = generatePlanningRecommendationsV2(changed);
    expect(regenerated.arithmeticLegalFarCapPct).toBe(200);
    expect(regenerated.inputBasis).not.toBe(result.inputBasis);
    const legal = regenerated.legalCeilingReference;
    expect(legal).not.toBeNull();
    expect(legal?.recommendation?.reasons.join(" ")).toContain("200.0%");
    expect(legal?.recommendation?.reasons.join(" ")).not.toContain("250.0%");
    expect(selectCurrentPlanningRecommendations(legal ? [legal] : [], input.projectId, regenerated.inputBasis!).current).toHaveLength(1);
  });

  it.each([
    ["cost", (i: PlanningRecommendationEngineInput) => { i.parcel.acquisitionCostManwon += 1; }],
    ["boundary", (i: PlanningRecommendationEngineInput) => { i.parcel.boundary![0][0] += 0.00001; }],
    ["zoning", (i: PlanningRecommendationEngineInput) => { i.parcel.zoning = "준주거지역"; }],
    ["coverage", (i: PlanningRecommendationEngineInput) => { i.parcel.maxBCRPct = 60; }],
    ["height", (i: PlanningRecommendationEngineInput) => { i.parcel.heightLimitM = 30; }],
    ["economics", (i: PlanningRecommendationEngineInput) => { i.assumptions.constructionCostPerSqmWon += 1; }],
    ["source revision", (i: PlanningRecommendationEngineInput) => { i.sourceRevision = "new-input-revision"; }],
    ["rule date", (i: PlanningRecommendationEngineInput) => { i.parcel.parkingRuleAsOf = "2026-10-18"; }],
  ] as const)("invalidates prior ranks when %s changes", (_label, change) => {
    const next = structuredClone(input); change(next);
    expect(selectCurrentPlanningRecommendations(plans, input.projectId, planningRecommendationInputBasis(next)).current).toEqual([]);
  });

  it("survives JSON save/reload and new generation timestamps when effective input dates are unchanged", () => {
    const reloaded = JSON.parse(JSON.stringify(plans)) as PlanningScenario[];
    const same = { ...input, generatedAt: "2027-01-01T00:00:00Z" };
    expect(selectCurrentPlanningRecommendations(reloaded, input.projectId, planningRecommendationInputBasis(same)).current).toHaveLength(plans.length);
    expect(planningRecommendationInputBasis({ ...same, parcel: Object.fromEntries(Object.entries(same.parcel).reverse()) as typeof same.parcel }))
      .toBe(result.inputBasis);
  });

  it("uses generation dates only when rule dates were omitted", () => {
    const implicit = structuredClone(input);
    delete implicit.parcel.parkingRuleAsOf; delete implicit.parcel.sunlightRuleAsOf;
    expect(planningRecommendationInputBasis({ ...implicit, generatedAt: "2026-10-17T12:00:00Z" }))
      .not.toBe(planningRecommendationInputBasis({ ...implicit, generatedAt: "2026-10-18T12:00:00Z" }));
  });

  it("does not adopt legacy metadata or another project's recommendation", () => {
    const legacy = structuredClone(plans[0]); delete legacy.recommendation!.inputBasis;
    const other = { ...plans[0], projectId: "other-pnu" };
    const manual = { ...plans[0], recommendation: undefined, origin: "custom" as const };
    const selected = selectCurrentPlanningRecommendations([legacy, other, manual], input.projectId, result.inputBasis!);
    expect(selected.current).toEqual([]); expect(selected.stale).toEqual([legacy]);
  });

  it("rejects edited geometry, drafts and later saved versions without changing plan data", () => {
    const edited = structuredClone(plans[0]); edited.placement.offsetXM += 1;
    const draft = { ...plans[0], status: "draft" as const };
    const newer = { ...plans[0], version: plans[0].version + 1 };
    expect(selectCurrentPlanningRecommendations([edited, draft, newer], input.projectId, result.inputBasis!).stale).toHaveLength(3);
  });

  it("ignores new slot IDs but retains the same physical-plan and input checks", () => {
    const renamedIds = structuredClone(plans[0]); renamedIds.id += "-safe";
    for (const floor of renamedIds.floorPrograms) {
      floor.id += "-safe"; for (const zone of floor.zones) zone.id += "-safe";
    }
    expect(selectCurrentPlanningRecommendations([renamedIds], input.projectId, result.inputBasis!).current).toHaveLength(1);
  });
});
