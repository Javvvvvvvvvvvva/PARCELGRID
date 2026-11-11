import { describe, expect, it } from "vitest";
import { buildLayoutFinancePreview, applyLayoutFinance, undoLayoutFinance, type LayoutFinanceInput } from "@/lib/planning/layout-finance";
import { layoutFinanceBinding, layoutFinancePlanningCheck } from "@/lib/planning/layout-finance-state";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone, clonePlanningScenario } from "@/lib/planning/scenario-utils";
import { DEFAULT_INTERIOR_SETTINGS, generateInteriorDraft, assessInteriorLayout, interiorProgramBasis } from "@/lib/planning/interior-layout";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/planning/room-layout-schema";
import { generateRoomLayout, assessRoomLayout } from "@/lib/planning/room-layout";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { canonicalProjectWorkspaceJson, validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";
import { protectLockedPlanningGeometryPatch } from "@/lib/planning/geometry-source";
import { DEFAULT_EGRESS_SETTINGS, EGRESS_VERSION, groundExitBasis, groundExitCandidates } from "@/lib/planning/egress-core";
import type { PlanningScenario } from "@/lib/planning/types";
import { DEFAULT_DWELLING_PROGRAM } from "@/lib/planning/dwelling-program";
import { DWELLING_MARKET_VERSION, DWELLING_MARKET_SOURCE } from "@/lib/finance/dwelling-market";
import { molitEvidenceFixture } from "./helpers/molit-evidence-fixture";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import { planIntersectionArea, planRectangle } from "@/lib/planning/layout-geometry";

const at = "2026-10-24T12:00:00.000Z";
const origin = [127.03, 37.65], dx = 1 / (111000 * Math.cos(origin[1] * Math.PI / 180)), dy = 1 / 111000;
const geo = (x: number, z: number): [number, number] => [origin[0] + x * dx, origin[1] - z * dy];
const boundary = [geo(-10, -10), geo(10, -10), geo(10, 10), geo(-10, 10), geo(-10, -10)];
function geometry(scenario: PlanningScenario) {
  return buildPlanningGeometry({ scenario, projectId: scenario.projectId!, boundary, lotAreaSqm: 400,
    zoning: "일반상업지역", generatedAt: at }).snapshot;
}
function fixture(count = 1, level = 2): LayoutFinanceInput {
  const scenario = createBlankPlanningScenario({ projectId: "layout-finance-test" });
  scenario.createdAt = at; scenario.updatedAt = at;
  scenario.floorPrograms = [createFloorProgram(level, [
    { ...createFloorZone("residential", 108, count), saleableAreaSqm: 90, parkingExclusiveAreaSqm: 90 },
    createFloorZone("common", 36, 0),
  ])];
  const g = geometry(scenario), floor = scenario.floorPrograms[0], outline = g.building.floors[0].shape;
  floor.interiorLayout = generateInteriorDraft(floor, outline, { ...DEFAULT_INTERIOR_SETTINGS, coreDepthM: 5.5 }).draft!;
  if (count === 1) {
    const unit = floor.interiorLayout.spaces.find(s => s.kind === "unit")!;
    const generated = generateRoomLayout(floor, unit.id, outline, { ...DEFAULT_ROOM_SETTINGS, serviceDepthM: 2 });
    if (!generated.draft) throw new Error(generated.message);
    floor.interiorLayout.roomLayouts = [generated.draft];
  }
  return { scenario, geometry: g, options: { areaBasis: "unit-clear", floorIds: [floor.id] },
    context: { parcel: { address: "서울 도봉구 쌍문동", lotAreaSqm: 400, maxFARPct: 200, maxBCRPct: 60,
      heightLimitM: 30, acquisitionCostManwon: 50000, demolitionCostManwon: 1000, parkingRuleAsOf: "2026-10-24" },
    assumptions: planningEconomicsAssumptionsFromLegacy(defaultAssumptions(), "layout-test"), calculatedAt: at } };
}
function adopt(input: LayoutFinanceInput) {
  const preview = buildLayoutFinancePreview(input);
  expect(preview.issues).toEqual([]);
  const applied = applyLayoutFinance(input, preview.sourceKey, at);
  expect(applied.error).toBeUndefined();
  return { ...input.scenario, ...applied.patch };
}

describe("layout finance assumptions bridge", () => {
  it("previews without mutation, preserves gross, provided parking, units and construction cost", () => {
    const input = fixture(), original = structuredClone(input.scenario), p = buildLayoutFinancePreview(input);
    expect(p.issues).toEqual([]); expect(p.status).toBe("ready");
    expect(input.scenario).toEqual(original);
    expect(p.after!.metrics.constructionAreaSqm).toBeCloseTo(144, 8);
    expect(p.after!.economicsPreview.constructionCostManwon).toBe(p.before!.economicsPreview.constructionCostManwon);
    expect(p.candidate!.parking).toEqual(original.parking);
    expect(p.candidate!.floorPrograms[0].zones.reduce((n, z) => n + z.unitCount, 0)).toBe(1);
    expect(p.after!.metrics.saleableAreaSqm).toBeCloseTo(p.rows[0].proposedSqm, 2);
    expect(p.rows[0].proposedSqm).not.toBe(90);
    expect(geometry(p.candidate!).geometryHash).toBe(input.geometry!.geometryHash);
  });
  it("uses detailed clear rooms including private halls and preserves room freshness after adoption", () => {
    const input = fixture(); input.options.areaBasis = "room-clear";
    const room = assessRoomLayout(input.scenario.floorPrograms[0], input.scenario.floorPrograms[0].interiorLayout!.roomLayouts![0].unitId, input.geometry!.building.floors[0].shape);
    const p = buildLayoutFinancePreview(input);
    expect(p.issues).toEqual([]); expect(p.rows[0].proposedSqm).toBe(room.clearAreaSqm);
    expect(p.rows[0].proposedSqm).toBeLessThan(p.rows[0].envelopeClearSqm);
    const adopted = adopt(input), f = adopted.floorPrograms[0];
    expect(assessRoomLayout(f, f.interiorLayout!.roomLayouts![0].unitId, input.geometry!.building.floors[0].shape).status).toBe("preliminary-fit");
    expect(layoutFinancePlanningCheck(adopted)?.status).toBe("review");
    expect(buildLayoutFinancePreview({ ...input, scenario: adopted, geometry: geometry(adopted) }).changed).toBe(false);
  });
  it("splits grouped units into per-unit parking/revenue records and restores original identifiers", () => {
    const input = fixture(2), original = structuredClone(input.scenario), p = buildLayoutFinancePreview(input);
    expect(p.issues).toEqual([]);
    const s = adopt(input), f = s.floorPrograms[0], units = f.zones.filter(z => z.useType === "residential");
    expect(units).toHaveLength(2); expect(units.every(z => z.unitCount === 1)).toBe(true);
    expect(assessInteriorLayout(f, input.geometry!.building.floors[0].shape).status).toBe("preliminary-fit");
    expect(p.after!.parking).toEqual(calculatePlanningScenario(p.candidate!, input.context).parking);
    const restored = undoLayoutFinance(s, at);
    expect(restored.error).toBeUndefined();
    expect(layoutFinanceBinding({ ...s, ...restored.patch })).toBe(layoutFinanceBinding(original));
  });
  it.each(["lease", "non-revenue"] as const)("preserves %s revenue intent without manufacturing sale area", model => {
    const input = fixture(), floor = input.scenario.floorPrograms[0];
    floor.zones[0].revenueModel = model; floor.zones[0].rentableAreaSqm = 90;
    floor.interiorLayout!.programBasis = interiorProgramBasis(floor);
    const p = buildLayoutFinancePreview(input);
    expect(p.issues).toEqual([]); expect(p.after!.metrics.saleableAreaSqm).toBe(0);
    expect(p.after!.metrics.rentableAreaSqm).toBeCloseTo(model === "lease" ? p.rows[0].proposedSqm : 0, 2);
  });
  it("reconciles only area shortfalls and refuses overlaps or stale parent layouts", () => {
    const input = fixture(), f = input.scenario.floorPrograms[0];
    f.zones[0].parkingExclusiveAreaSqm = 108; f.interiorLayout!.programBasis = interiorProgramBasis(f);
    expect(assessInteriorLayout(f, input.geometry!.building.floors[0].shape).issues.some(i => i.code === "exclusive-area-shortfall")).toBe(true);
    input.options.areaBasis = "room-clear";
    expect(buildLayoutFinancePreview(input).issues).toEqual([]);
    f.interiorLayout!.spaces.find(s => s.kind === "unit")!.center.x += 10;
    expect(buildLayoutFinancePreview(input).status).toBe("blocked");
    const other = fixture(); other.scenario.floorPrograms[0].zones[0].saleableAreaSqm = 80;
    expect(buildLayoutFinancePreview(other).status).toBe("blocked");
  });
  it("blocks missing/wrong/stale geometry and gross/outline inconsistencies", () => {
    const input = fixture();
    expect(buildLayoutFinancePreview({ ...input, geometry: null }).status).toBe("blocked");
    expect(buildLayoutFinancePreview({ ...input, geometry: { ...input.geometry!, scenarioId: "different" } }).status).toBe("blocked");
    input.scenario.placement.offsetXM = 1;
    expect(buildLayoutFinancePreview(input).status).toBe("blocked");
    input.scenario.placement.offsetXM = 0;
    input.geometry!.building.floors[0].shape[0].x += 0.1;
    expect(buildLayoutFinancePreview(input).status).toBe("blocked");
  });
  it("blocks missing/stale rooms in detailed mode without refreshing stale room bindings in unit mode", () => {
    const input = fixture(), f = input.scenario.floorPrograms[0];
    f.interiorLayout!.roomLayouts![0].parentBasis = "outdated";
    input.options.areaBasis = "room-clear";
    expect(buildLayoutFinancePreview(input).status).toBe("blocked");
    input.options.areaBasis = "unit-clear";
    const s = adopt(input);
    expect(s.floorPrograms[0].interiorLayout!.roomLayouts![0].parentBasis).toBe("outdated");
    delete f.interiorLayout!.roomLayouts;
    input.options.areaBasis = "room-clear";
    expect(buildLayoutFinancePreview(input).status).toBe("blocked");
  });
  it("requires an unchanged comparison source and honors locks at both operation and store boundary", () => {
    const input = fixture(), p = buildLayoutFinancePreview(input);
    input.context.assumptions.constructionCostPerSqmWon += 1;
    expect(applyLayoutFinance(input, p.sourceKey, at).patch).toBeUndefined();
    input.scenario.geometrySource = { mode: "engine-generated", locked: true, exactGeometryAvailable: true };
    expect(applyLayoutFinance(input, buildLayoutFinancePreview(input).sourceKey, at).patch).toBeUndefined();
    expect(protectLockedPlanningGeometryPatch(input.scenario, { layoutFinanceHistory: [] })).toEqual({});
  });
  it("restores exact source, refuses later geometry edits, and detects damaged rollback history", () => {
    const input = fixture(), s = adopt(input), original = layoutFinanceBinding(input.scenario);
    expect(layoutFinanceBinding({ ...s, ...undoLayoutFinance(s, at).patch })).toBe(original);
    s.parking.providedCars += 1;
    expect(undoLayoutFinance(s, at).patch).toBeUndefined();
    expect(layoutFinancePlanningCheck(s)?.status).toBe("unknown");
    s.parking.providedCars -= 1;
    s.layoutFinanceHistory![0].beforeFloors[0].zones[0].areaSqm += 1;
    expect(undoLayoutFinance(s, at).patch).toBeUndefined();
  });
  it("preserves a current ground exit binding while adopting and undoing, without approving it", () => {
    const input = fixture(1, 1), floor = input.scenario.floorPrograms[0], choice = groundExitCandidates(floor, input.geometry!.building.floors[0].shape)[0];
    input.scenario.egressPlan = { version: EGRESS_VERSION, settings: DEFAULT_EGRESS_SETTINGS, exit: {
      floorId: floor.id, spaceId: choice.spaceId, edgeIndex: choice.edgeIndex, offsetRatio: 0.5, widthM: 0.9, layoutBasis: groundExitBasis(floor.interiorLayout!),
    } };
    const s = adopt(input);
    expect(s.egressPlan!.exit!.layoutBasis).toBe(groundExitBasis(s.floorPrograms[0].interiorLayout!));
    expect(undoLayoutFinance(s, at).patch!.egressPlan).toEqual(input.scenario.egressPlan);
  });
  it("round-trips canonical workspace history, rejects corruption and drops history on clone", () => {
    const s = adopt(fixture()), payload = projectWorkspaceFixture(s.projectId!);
    payload.planningScenarios = [s]; payload.selectedScenarioId = s.id;
    const restored = JSON.parse(canonicalProjectWorkspaceJson(payload));
    expect(validateProjectWorkspacePayload(restored, s.projectId!).valid).toBe(true);
    expect(restored.planningScenarios[0].layoutFinanceHistory).toEqual(JSON.parse(JSON.stringify(s.layoutFinanceHistory)));
    expect(clonePlanningScenario(s).layoutFinanceHistory).toBeUndefined();
    restored.planningScenarios[0].layoutFinanceHistory[0].beforeFloors[0].zones[0].areaSqm = -1;
    expect(validateProjectWorkspacePayload(restored, s.projectId!).valid).toBe(false);
  });
  it("passes adopted areas and parking into the existing Stage 3 bridge without changing gross", () => {
    const input = fixture(), p = buildLayoutFinancePreview(input), program = planningScenarioToBuildingProgram(p.candidate!, p.after!);
    expect(program.areaContract!.constructionAreaSqm).toBeCloseTo(144, 8);
    expect(program.areaContract!.saleableAreaSqm).toBeCloseTo(p.rows[0].proposedSqm, 2);
    expect(program.areaContract!.requiredParkingSpaces).toBe(p.after!.parking.requiredCars);
  });
  it("re-evaluates observed prices when the exact target area changes", () => {
    const input = fixture(), unitPriceWon = 8000000;
    input.scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM, salePriceBands: [{
      minExclusiveSqm: 0, maxExclusiveSqm: null, unitPriceWon, source: "합성 단가 관측 테스트",
      marketObservation: { methodVersion: DWELLING_MARKET_VERSION, sourceUrl: DWELLING_MARKET_SOURCE,
        asOf: "2026-10-24", projectId: input.scenario.projectId!, lawdCd: "11320", dongName: "쌍문동",
        targetExclusiveSqm: 90, unitPriceWon, addressCount: 3, sampleMinWon: unitPriceWon, sampleMaxWon: unitPriceWon,
        comparables: [], collection: molitEvidenceFixture({ type: "villa" }) },
    }] };
    const p = buildLayoutFinancePreview(input);
    expect(p.issues).toEqual([]);
    expect(p.before!.economicsPreview.saleRevenueManwon).toBe(72000);
    expect(p.notes.some(n => n.includes("관측 단가가 해제"))).toBe(true);
    expect(p.after!.economicsPreview.saleRevenueManwon).toBeCloseTo(
      p.after!.metrics.saleableAreaSqm * input.context.assumptions.residentialSalePricePerSqmWon / 10000, 1);
  });
  it("supports successive adoptions and undoes them in order", () => {
    const input = fixture(); input.options.areaBasis = "room-clear";
    const first = adopt(input), secondInput = { ...input, scenario: first, geometry: geometry(first), options: { ...input.options, areaBasis: "unit-clear" as const } };
    const second = adopt(secondInput), undoSecond = undoLayoutFinance(second, at);
    expect(undoSecond.error).toBeUndefined();
    const restoredFirst = { ...second, ...undoSecond.patch };
    expect(layoutFinanceBinding(restoredFirst)).toBe(layoutFinanceBinding(first));
    const undoFirst = undoLayoutFinance(restoredFirst, at);
    expect(undoFirst.error).toBeUndefined();
    expect(layoutFinanceBinding({ ...restoredFirst, ...undoFirst.patch })).toBe(layoutFinanceBinding(input.scenario));
  });
  it("changes only selected floors and keeps other floor assumptions explicit", () => {
    const input = fixture(), other = fixture().scenario.floorPrograms[0]; other.level = 3; other.label = "3층";
    input.scenario.floorPrograms.push(other); input.geometry = geometry(input.scenario);
    const p = buildLayoutFinancePreview(input);
    expect(p.issues).toEqual([]);
    expect(p.candidate!.floorPrograms[1]).toEqual(other);
    expect(p.notes.some(n => n.includes("선택하지 않은 주거층"))).toBe(true);
    expect(p.floors).toHaveLength(1);
  });
  it("rejects empty/duplicate scope, duplicate zone IDs, and unsupported mixed floors", () => {
    const input = fixture();
    expect(buildLayoutFinancePreview({ ...input, options: { ...input.options, floorIds: [] } }).status).toBe("blocked");
    expect(buildLayoutFinancePreview({ ...input, options: { ...input.options, floorIds: [...input.options.floorIds, ...input.options.floorIds] } }).status).toBe("blocked");
    input.scenario.floorPrograms[0].zones[1].id = input.scenario.floorPrograms[0].zones[0].id;
    expect(buildLayoutFinancePreview(input).status).toBe("blocked");
    const mixed = fixture(); mixed.scenario.floorPrograms[0].zones[1].useType = "retail";
    expect(buildLayoutFinancePreview(mixed).status).toBe("blocked");
  });
  it("keeps adoption conditional and never marks representative readiness approved", () => {
    const input = fixture(), adopted = adopt(input), checks = calculatePlanningScenario(adopted, input.context).checks;
    expect(checks.find(c => c.code === "layout-finance-adoption")?.status).toBe("review");
    expect(assessRepresentativeCheckReadiness(checks).blockers.map(b => b.code)).toContain("layout-finance-adoption");
  });
  it("retains real overlap detection after clipping precision normalization", () => {
    const rect = planRectangle({ x: 0.000000363714827, z: -0.000000520299678 }, 4, 6, 32);
    expect(planIntersectionArea(rect, rect)).toBeCloseTo(24, 6);
    const overlap = planRectangle({ x: 0.001, z: 0 }, 4, 6, 32);
    expect(planIntersectionArea(rect, overlap)).toBeGreaterThan(23.9);
  });
});
