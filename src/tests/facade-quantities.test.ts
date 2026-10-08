import { applyWorkspace } from "@/lib/workspace/state";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { describe, expect, it } from "vitest";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone, clonePlanningScenario } from "@/lib/planning/scenario-utils";
import { buildPlanningGeometry, type PlanningGeometryFloor, type PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import { calculatePlanningMaterialAdjustment, createDefaultPlanningMaterials } from "@/lib/planning/materials";
import { floorFacadeFaces, geometryFacadeQuantities } from "@/lib/planning/facade-quantities";
import { facadeSurfacePatches } from "@/lib/planning/facade-render";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { planningScenarioToBuildingProgram } from "@/lib/planning/scenario-to-building-program";
import { buildPlanningDesignIntent } from "@/lib/planning/design-intent";
import { emptyWorkspace, validateWorkspaceDocument } from "@/lib/workspace/document";
import { buildReviewSnapshotKey, validateReviewSnapshotAlignment, type ReviewableStage3Snapshot } from "@/lib/handoff/review-snapshot";
import type { ProjectComputed } from "@/lib/services/compute-project";

const boundary: [number, number][] = [[127, 37], [127.0005, 37], [127.0005, 37.0005], [127, 37.0005]];
const rectangle = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 0, z: 10 }];
function scenario() {
  const s = createBlankPlanningScenario({ projectId: "facade-test" });
  s.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 200, 1)], 3)];
  s.materials = { ...createDefaultPlanningMaterials(), primaryFacadeMaterial: "brick-veneer", secondaryFacadeMaterial: "metal-panel", primaryFacadeSharePct: 100, windowRatioPct: 25 };
  return s;
}
function fixture(shape = rectangle) {
  const s = scenario();
  const g = buildPlanningGeometry({ projectId: s.projectId!, scenario: s, boundary, lotAreaSqm: 2460, zoning: "상업지역" }).snapshot;
  const f: PlanningGeometryFloor = { ...g.building.aboveGroundFloors[0], shape, baseHeightM: 0, topHeightM: 3, floorHeightM: 3, areaStatus: "pass", selfIntersects: false };
  g.building.aboveGroundFloors = [f]; g.building.floors = [f];
  g.validation = { ...g.validation, status: "pass", representativeEligible: true, exportable: true };
  return { s, g, f };
}

describe("facade quantities and material contracts", () => {
  it("uses a 20×10m rectangle's 60m perimeter, not the equivalent square", () => {
    const { s, g } = fixture();
    const result = calculatePlanningMaterialAdjustment(s, g);
    expect(result.areaBasis).toBe("geometry-derived");
    expect(result.quantities.grossFacadeAreaSqm).toBe(180);
    expect(result.quantities.openingAreaSqm).toBe(45);
    expect(result.facadeAreaSqm).toBe(135);
    expect(result.rows[0].areaSqm).toBe(135);
  });
  it("counts a concave 36m L-perimeter and stepped upper perimeter without horizontal surfaces", () => {
    const { s, g, f } = fixture([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 8 }, { x: 0, z: 8 }]);
    const upper = { ...f, id: "upper", level: 2, baseHeightM: 3, topHeightM: 6, shape: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }] };
    g.building.aboveGroundFloors.push(upper);
    expect(geometryFacadeQuantities(g, s.materials!).grossFacadeAreaSqm).toBe((36 + 16) * 3);
  });
  it("deducts explicit openings once, excludes shared walls and holds unknown faces", () => {
    const { s, g, f } = fixture(); const faces = floorFacadeFaces(f);
    s.materials!.faceAssignments = { [faces[0].id]: { openingAreaSqm: 10 }, [faces[1].id]: { exposure: "shared" }, [faces[3].id]: { exposure: "unknown" } };
    const q = geometryFacadeQuantities(g, s.materials!);
    expect(q.grossFacadeAreaSqm).toBe(120); expect(q.openingAreaSqm).toBe(25); expect(q.netFacadeAreaSqm).toBe(95);
    expect(q.excludedAreaSqm).toBe(30); expect(q.unresolvedAreaSqm).toBe(30); expect(q.status).toBe("partial");
    s.materials!.faceAssignments[faces[0].id].openingAreaSqm = 61;
    expect(geometryFacadeQuantities(g, s.materials!).unresolvedAreaSqm).toBe(90);
  });
  it("excludes open floors and refuses to infer an enclosed perimeter from mixed piloti area", () => {
    const { s, g, f } = fixture(); f.zones = [{ useType: "piloti", areaSqm: 200, unitCount: 0 }];
    expect(geometryFacadeQuantities(g, s.materials!).excludedAreaSqm).toBe(180);
    f.zones.push({ useType: "common", areaSqm: 10, unitCount: 0 });
    const q = geometryFacadeQuantities(g, s.materials!);
    expect(q.netFacadeAreaSqm).toBe(0); expect(q.unresolvedAreaSqm).toBe(180);
  });
  it("binds faces to coordinates and height, supports reversed rings, and blocks stale costs", () => {
    const { s, g, f } = fixture(); const faces = floorFacadeFaces(f);
    s.materials!.faceAssignments = { [faces[0].id]: { material: "metal-panel" } };
    expect(floorFacadeFaces({ ...f, shape: [...f.shape].reverse() }).map(x => x.id).sort()).toEqual(faces.map(x => x.id).sort());
    expect(floorFacadeFaces({ ...f, shape: [...f.shape, f.shape[0]] }).length).toBe(4);
    f.shape = f.shape.map(p => ({ x: p.x + 2, z: p.z }));
    s.materials!.baselineFacadeUnitCostPerSqmWon = 100; s.materials!.selectedFacadeUnitCostPerSqmWon = 200;
    const c = calculatePlanningMaterialAdjustment(s, g);
    expect(c.quantities.staleAssignmentIds).toHaveLength(1); expect(c.adjustmentWon).toBe(0); expect(c.priced).toBe(false);
  });
  it("prices only known material portions and preserves zero/negative deltas", () => {
    const { s, g, f } = fixture(); s.materials!.faceAssignments = { [floorFacadeFaces(f)[0].id]: { material: "metal-panel" } };
    s.materials!.pricingMode = "by-material";
    s.materials!.materialRates = { "brick-veneer": { baselineWonPerSqm: 100000, selectedWonPerSqm: 150000 } };
    const c = calculatePlanningMaterialAdjustment(s, g);
    expect(c.rows.reduce((n, row) => n + row.areaSqm, 0)).toBe(135);
    expect(c.unpricedAreaSqm).toBe(45); expect(c.adjustmentManwon).toBe(450); expect(c.pricingStatus).toBe("partial");
    s.materials!.materialRates["metal-panel"] = { baselineWonPerSqm: 100000, selectedWonPerSqm: 0 };
    const all = calculatePlanningMaterialAdjustment(s, g);
    expect(all.priced).toBe(true); expect(all.adjustmentWon).toBe(0);
  });
  it("keeps manual net quantities net and legacy rates as assembly prices", () => {
    const { s, g } = fixture(); Object.assign(s.materials!, { facadeAreaOverrideSqm: 100, primaryFacadeSharePct: 75, baselineFacadeUnitCostPerSqmWon: 100000, selectedFacadeUnitCostPerSqmWon: 150000 });
    const c = calculatePlanningMaterialAdjustment(s, g);
    expect(c.quantities.openingAreaSqm).toBe(0); expect(c.facadeAreaSqm).toBe(100); expect(c.adjustmentManwon).toBe(500);
    expect(c.rows.map(row => row.areaSqm).sort((a, b) => a - b)).toEqual([25, 75]);
  });
  it("uses real-size UV units for a 20m wall and preserves actual vertices", () => {
    const { s, f } = fixture(); const face = floorFacadeFaces(f)[0]; const [patch] = facadeSurfacePatches(face, s.materials!);
    expect(patch.u).toBeCloseTo(20 / 0.44); expect(patch.v).toBe(3 / 0.15);
    s.materials!.primaryFacadeSharePct = 75;
    expect(facadeSurfacePatches(face, s.materials!).map(p => p.top - p.base)).toEqual([2.25, 0.75]);
  });
  it("rejects invalid geometry, and does not certify source-backed costs without date", () => {
    const { s, g } = fixture(); Object.assign(s.materials!, { baselineFacadeUnitCostPerSqmWon: 100000, selectedFacadeUnitCostPerSqmWon: 150000, rateEvidence: { status: "source-backed", sourceName: "견적" } });
    expect(calculatePlanningMaterialAdjustment(s, g).evidenceStatus).toBe("user-input");
    g.validation.status = "fail";
    expect(calculatePlanningMaterialAdjustment(s, g).adjustmentWon).toBe(0);
  });
  it("shares one quantity/cost snapshot between preview, Stage 3 bridge and Plan DNA", () => {
    const s = scenario(); const context = { parcel: { lotAreaSqm: 2460, boundary, zoning: "상업지역", maxFARPct: 500, maxBCRPct: 80, heightLimitM: 30, acquisitionCostManwon: 0, demolitionCostManwon: 0 }, assumptions: planningEconomicsAssumptionsFromLegacy(defaultAssumptions(), "facade-test") };
    s.materials!.baselineFacadeUnitCostPerSqmWon = 100000; s.materials!.selectedFacadeUnitCostPerSqmWon = 123456.78;
    const first = calculatePlanningScenario(s, context), cost = first.economicsPreview.facadeCost!;
    const program = planningScenarioToBuildingProgram(s, first);
    expect(program.areaContract!.facadeCost).toEqual(cost);
    expect(program.areaContract!.materialAdjustmentCostManwon).toBe(cost.adjustmentManwon);
    expect(buildPlanningDesignIntent(s, { projectId: s.projectId!, address: "테스트", parcelAreaSqm: 2460, maxBuildingCoveragePct: 80, maxFloorAreaRatioPct: 500 }, first).facadeCost).toEqual(cost);
    s.materials!.selectedFacadeUnitCostPerSqmWon = 150000;
    const next = calculatePlanningScenario(s, context).economicsPreview.facadeCost!;
    expect(next.quantities.geometryHash).toBe(cost.quantities.geometryHash); expect(next.quantities.quantityKey).toBe(cost.quantities.quantityKey); expect(next.costKey).not.toBe(cost.costKey);
    s.materials!.primaryFacadeMaterial = "metal-panel";
    expect(calculatePlanningScenario(s, context).economicsPreview.facadeCost!.quantities.geometryHash).toBe(cost.quantities.geometryHash);
  });
  it("deep clones material edits and validates imported face and rate values", () => {
    const { s, f } = fixture(); const id = floorFacadeFaces(f)[0].id;
    s.materials!.faceAssignments = { [id]: { material: "metal-panel" } };
    s.materials!.materialRates = { "metal-panel": { selectedWonPerSqm: 123 } };
    const copy = clonePlanningScenario(s); copy.materials!.faceAssignments![id].material = "brick-veneer";
    expect(s.materials!.faceAssignments![id].material).toBe("metal-panel");
    const doc = emptyWorkspace(s.projectId!); doc.payload.planningScenarios = [s];
    expect(validateWorkspaceDocument(doc).payload.planningScenarios[0].materials).toEqual(s.materials);
    s.materials!.materialRates!["metal-panel"]!.selectedWonPerSqm = -1;
    expect(() => validateWorkspaceDocument(doc)).toThrow();
  });
  it("changes review identity with a rate change even when geometry stays identical", () => {
    const { s, g } = fixture(); const cost = calculatePlanningMaterialAdjustment(s, g);
    const snap: ReviewableStage3Snapshot = { projectId: g.projectId, representativeScenarioId: g.scenarioId, representativeScenarioVersion: g.scenarioVersion, geometryHash: g.geometryHash, savedAt: "2026-10-08", data: { scenarios: [{ id: g.scenarioId, _raw: { program: { areaContract: { facadeCost: cost, materialAdjustmentCostManwon: 0 } } } }], meta: { version: "test" } } as unknown as ProjectComputed };
    const a = buildReviewSnapshotKey({ snapshot: snap, financialSources: {}, priceVerifications: {} });
    cost.costKey = "edited-cost";
    expect(buildReviewSnapshotKey({ snapshot: snap, financialSources: {}, priceVerifications: {} })).not.toBe(a);
    cost.quantities.geometryHash = "different";
    expect(validateReviewSnapshotAlignment({ snapshot: snap, geometry: g as PlanningGeometrySnapshot, currentScenario: { id: g.scenarioId, version: g.scenarioVersion } }).valid).toBe(false);
  });
  it("preserves old material inputs but invalidates cached pre-quantity finance and approvals", () => {
    const { s, g } = fixture();
    const doc = emptyWorkspace(s.projectId!);
    doc.payload.planningScenarios = [s]; doc.payload.representativeScenarioId = s.id; doc.payload.representativeGeometry = g;
    doc.payload.stage3Snapshot = { projectId: s.projectId!, representativeScenarioId: s.id, representativeScenarioVersion: s.version, geometryHash: g.geometryHash,
      savedAt: "2026-10-08", data: { meta: {}, scenarios: [{ id: s.id, _raw: { program: { areaContract: { materialAdjustmentCostManwon: 100 } } } }] } as unknown as ProjectComputed };
    doc.payload.expertReviews.architect = { discipline: "architect", status: "approved", reviewer: "test", organization: "test", evidenceRef: "test", notes: "", reviewedAt: "2026-10-08", updatedAt: "2026-10-08", snapshotKey: "old" };
    applyWorkspace(doc);
    const state = useProjectStore.getState();
    expect(state.planningScenarios[0].materials).toEqual(s.materials);
    expect(state.representativePlanningScenarioId).toBeNull();
    expect(state.stage3FeasibilitySnapshots[s.projectId!]).toBeUndefined();
    expect(useReviewStore.getState().expertReviews[s.projectId!].architect?.status).toBe("requested");
  });

});
