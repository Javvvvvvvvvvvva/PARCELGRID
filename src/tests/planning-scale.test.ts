import { describe, expect, it } from "vitest";
import { buildReviewSnapshotPayload, canonicalReviewSnapshotJson, validateReviewSnapshotAlignment } from "@/lib/handoff/review-snapshot";
import { prepareReviewSnapshotSeal } from "@/lib/handoff/server-review-snapshot";
import { createQuantityCostDraft, evaluateQuantityCost } from "@/lib/planning/quantity-cost";
import { takeoffPlanningQuantities } from "@/lib/planning/quantity-takeoff";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { computeProject } from "@/lib/services/compute-project";
import { scalePlanningFixture } from "./helpers/scale-planning-fixture";

describe("maximum planning scale", () => {
  it("preserves raw rooms and exact quantities through cost binding, monthly finance and server sealing at 32 floors / 120 units", async () => {
    const small = scalePlanningFixture([0, 4]);
    const f = scalePlanningFixture([0, 0, ...Array<number>(30).fill(4)]);
    const single = takeoffPlanningQuantities(small.scenario), large = takeoffPlanningQuantities(f.scenario);
    expect(large.status, large.issues.join("; ")).toBe("preliminary");
    for (const item of large.items) expect(item.quantity).toBeCloseTo(single.items.find(i => i.id === item.id)!.quantity! * 30, 6);
    const inputs = { constructionCostPerSqmWon: f.assumptions.constCostPerSqM, basementCostMultiplier: f.assumptions.basementCostMultiplier };
    f.scenario.quantityCost = createQuantityCostDraft(f.scenario, inputs);
    for (const line of f.scenario.quantityCost.lines) Object.assign(line, { treatment: "included", source: "Synthetic scope only", scopeConfirmed: true });
    expect(evaluateQuantityCost(f.scenario, inputs).status).toBe("ready");
    const calculation = calculatePlanningScenario(f.scenario, { parcel: { address: f.parcel.address, lotAreaSqm: 2500,
      maxFARPct: 200, maxBCRPct: 60, heightLimitM: 30, acquisitionCostManwon: 50000, demolitionCostManwon: 1000,
      parkingRuleAsOf: "2026-10-26" }, assumptions: planningEconomicsAssumptionsFromLegacy(f.assumptions, "scale-test") });
    const program = planningScenarioToBuildingProgram(f.scenario, calculation, { geometryHash: f.geometry.geometryHash });
    const data = computeProject(f.parcel, [{ id: f.scenario.id, name: "Scale test", shortName: "Scale", program, assumptions: f.assumptions }],
      { recommendedId: f.scenario.id, calculateMaxAcquisition: false });
    const packet = buildReviewSnapshotPayload({ snapshot: { projectId: f.projectId, representativeScenarioId: f.scenario.id,
      representativeScenarioVersion: f.scenario.version, geometryHash: f.geometry.geometryHash, savedAt: "2026-10-26T00:00:00Z", data },
      planningScenario: f.scenario, geometry: f.geometry, financialSources: {}, priceVerifications: {}, expertTaxContracts: [] });
    const restored = JSON.parse(canonicalReviewSnapshotJson({ scenario: f.scenario, geometry: f.geometry, data }));
    expect(validateReviewSnapshotAlignment({
      currentScenario: restored.scenario, geometry: restored.geometry,
      snapshot: { projectId: f.projectId, representativeScenarioId: f.scenario.id,
        representativeScenarioVersion: f.scenario.version, geometryHash: f.geometry.geometryHash,
        savedAt: "2026-10-26T00:00:00Z", data: restored.data },
    })).toEqual({ valid: true, errors: [] });
    const binding = packet.verification.checks.filter(c => c.id.startsWith("binding."));
    expect(binding.filter(c => c.status !== "checked")).toEqual([]);
    expect(packet.verification.approvalStatus).toBe("unverified");
    expect(packet.verification.status).not.toBe("preliminary");
    expect(packet.planningScenario).toEqual(f.scenario);
    expect(new TextEncoder().encode(canonicalReviewSnapshotJson(packet)).length).toBeLessThan(1_000_000);
    const sealed = await prepareReviewSnapshotSeal(packet, f.projectId);
    expect(sealed.valid, sealed.valid ? undefined : sealed.errors.join("; ")).toBe(true);
    const changed = structuredClone(f.scenario);
    changed.floorPrograms[31].interiorLayout!.roomLayouts![3].spaces[0].widthM -= 0.01;
    expect(evaluateQuantityCost(changed, inputs).status).toBe("stale");
    const legacy = structuredClone(f.scenario);
    legacy.quantityCost!.sourceBasis = JSON.stringify({ floorPrograms: legacy.floorPrograms });
    expect(evaluateQuantityCost(legacy, inputs).status).toBe("stale");
  }, 30_000);
});
