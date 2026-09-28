import { describe, expect, it } from "vitest";
import { generateInteriorCandidates } from "@/lib/planning/interior/generator";
import { connectAdjacentSpaces, connectSpaces, doorSegment, polygonContains, rotatePoint, sharedEdge, validateInteriorLayout } from "@/lib/planning/interior/geometry";
import { applyInteriorToFloor, isInteriorFinanceCurrent } from "@/lib/planning/interior/finance";
import { clonePlanningScenario } from "@/lib/planning/scenario-utils";
import { cloneFloorProgramAtLevel } from "@/lib/planning/floor-program-editor";
import { protectLockedPlanningGeometryPatch } from "@/lib/planning/geometry-source";
import { recommendationCandidateKey } from "@/lib/planning/recommendation-analysis";
import { generationInput, interiorFixture, rectangle } from "./helpers/interior-fixture";

describe("independent concept floor layouts", () => {
  it.each([0, 27, 90])("fits valid connected layouts at rotation %s degrees", rotation => {
    const input = generationInput(rectangle().map(p => rotatePoint(p, rotation)));
    const result = generateInteriorCandidates(input);
    expect(result.status).toBe("candidates");
    for (const { layout } of result.candidates) {
      const assessment = validateInteriorLayout(layout, input.outline);
      expect(assessment.valid, JSON.stringify(assessment.issues)).toBe(true);
      expect(layout.spaces.filter(s => s.kind === "unit")).toHaveLength(2);
      expect(assessment.connectedSpaceIds).toHaveLength(layout.spaces.length);
      expect(assessment.assignedAreaSqm).toBeLessThanOrEqual(144.00001);
      expect(assessment.clearAreaSqm).toBeLessThan(assessment.assignedAreaSqm);
      expect(layout.doors.every(d => !!doorSegment(layout, d))).toBe(true);
    }
  });

  it("checks the entire concave boundary instead of just rectangle corners", () => {
    const concave = [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 12 }, { x: 8, z: 12 }, { x: 8, z: 6 }, { x: 4, z: 6 }, { x: 4, z: 12 }, { x: 0, z: 12 }];
    expect(polygonContains(concave, rectangle())).toBe(false);
    const result = generateInteriorCandidates({ ...generationInput(concave), count: 1, coreDepthM: 2, minRoomAreaSqm: 6, minRoomWidthM: 1 });
    expect(result.status).toBe("candidates");
    expect(result.candidates.every(c => validateInteriorLayout(c.layout, concave).valid)).toBe(true);
  });

  it("does not call an unsuccessful template search an infeasible building", () => {
    const result = generateInteriorCandidates(generationInput(rectangle(2, 2)));
    expect(result.status).toBe("no-template-fit");
    expect(result.message).toContain("건축 불가능 판정이 아닙니다");
    expect(generateInteriorCandidates({ ...generationInput(), count: 100000 }).status).toBe("invalid-input");
    expect(generateInteriorCandidates({ ...generationInput(), minRoomAreaSqm: NaN }).status).toBe("invalid-input");
  });

  it("rejects overlap, out-of-floor geometry, and stale floor outlines", () => {
    const { layout, initial } = interiorFixture();
    const shape = initial.building.floors[0].shape;
    const overlap = structuredClone(layout);
    overlap.spaces[2].center = { ...overlap.spaces[3].center };
    expect(validateInteriorLayout(overlap, shape).issues.some(i => i.code === "overlap")).toBe(true);
    overlap.spaces[2].center.x += 100;
    expect(validateInteriorLayout(overlap, shape).issues.some(i => i.code === "outside")).toBe(true);
    expect(validateInteriorLayout(layout, shape.map(p => ({ ...p, x: p.x + 1 }))).issues.some(i => i.code === "stale-outline")).toBe(true);
  });

  it("requires a shared segment, a correctly placed door, and an actual route to a core", () => {
    expect(sharedEdge(rectangle(1, 1), rectangle(1, 1).map(p => ({ x: p.x + 1, z: p.z + 1 })))).toBeNull();
    const { layout, initial } = interiorFixture();
    const disconnected = { ...layout, doors: [] };
    expect(validateInteriorLayout(disconnected, initial.building.floors[0].shape).issues.some(i => i.code === "disconnected")).toBe(true);
    const repaired = connectAdjacentSpaces(disconnected);
    expect(validateInteriorLayout(repaired, initial.building.floors[0].shape).valid).toBe(true);
    repaired.doors[0].center.x += 0.3;
    repaired.doors[0].center.z += 0.3;
    expect(validateInteriorLayout(repaired, initial.building.floors[0].shape).issues.some(i => i.code === "door")).toBe(true);
  });

  it("reports unmet relationship preferences separately from geometric errors", () => {
    const { layout, initial } = interiorFixture();
    const edge = layout.doors[0];
    layout.relations.push({ id: "separate-common", from: edge.from, to: edge.to, kind: "separate" });
    const result = validateInteriorLayout(layout, initial.building.floors[0].shape);
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "preference", severity: "review" }));
  });

  it("connects touching private rooms and retains their door when common doors are rebuilt", () => {
    const candidate = generateInteriorCandidates(generationInput()).candidates.find(c => c.layout.spaces[2].center.x === c.layout.spaces[3].center.x)!;
    const layout = connectSpaces(candidate.layout, "unit-1", "unit-2");
    const door = layout.doors.find(d => d.from === "unit-1" && d.to === "unit-2")!;
    expect(doorSegment(layout, door)).not.toBeNull();
    expect(connectAdjacentSpaces(layout).doors).toContainEqual(door);
    expect(() => connectSpaces(layout, "unit-1", "unit-1")).toThrow();
    expect(() => connectSpaces(layout, "unit-1", "unit-2", NaN)).toThrow();
  });

  it("fails malformed input and collapsed clear spaces without NaN summaries", () => {
    const { layout } = interiorFixture();
    const result = validateInteriorLayout(layout, [{ x: NaN, z: 0 }]);
    expect(result.valid).toBe(false);
    expect(Number.isFinite(result.floorAreaSqm)).toBe(true);
    const invalid = structuredClone(layout); invalid.spaces[0].widthM = 0.2; invalid.wallThicknessM = 0.6;
    expect(validateInteriorLayout(invalid, layout.sourceOutline).issues.some(i => i.code === "minimum")).toBe(true);
  });
});

describe("interior, finance, and geometry consistency", () => {
  it("preserves gross area, excludes common revenue, and requires explicit finance sync", () => {
    const { scenario, layout, initial, build } = interiorFixture();
    const floor = scenario.floorPrograms[0];
    floor.interior = layout;
    expect(build().validation.issues.some(i => i.code === "interior-finance-stale")).toBe(true);
    const applied = applyInteriorToFloor(floor, layout, initial.building.floors[0].shape);
    scenario.floorPrograms = [applied];
    expect(applied.zones.reduce((sum, z) => sum + z.areaSqm, 0)).toBeCloseTo(144, 8);
    expect(applied.zones.filter(z => z.useType === "common").every(z => z.revenueModel === "non-revenue" && z.unitCount === 0)).toBe(true);
    expect(applied.zones.reduce((sum, z) => sum + (z.saleableAreaSqm ?? 0), 0)).toBeLessThan(144);
    expect(isInteriorFinanceCurrent(applied)).toBe(true);
    expect(build().validation.representativeEligible).toBe(true);
    const syncedHash = build().geometryHash;
    expect(syncedHash).not.toBe(initial.geometryHash);
    applied.interior!.wallThicknessM = 0.2;
    expect(isInteriorFinanceCurrent(applied)).toBe(false);
    expect(build().geometryHash).not.toBe(syncedHash);
    expect(build().validation.representativeEligible).toBe(false);
  });

  it("also detects manual financial edits and rejects unvalidated layouts", () => {
    const { scenario, layout, initial } = interiorFixture();
    const applied = applyInteriorToFloor(scenario.floorPrograms[0], layout, initial.building.floors[0].shape);
    applied.zones[2].saleableAreaSqm = 999;
    expect(isInteriorFinanceCurrent(applied)).toBe(false);
    expect(() => applyInteriorToFloor(applied, { ...layout, doors: [] }, initial.building.floors[0].shape)).toThrow();
  });

  it("deep-clones interior data and preserves lock protection", () => {
    const { scenario, layout, initial } = interiorFixture();
    scenario.floorPrograms[0] = applyInteriorToFloor(scenario.floorPrograms[0], layout, initial.building.floors[0].shape);
    const clone = clonePlanningScenario(scenario);
    const upper = cloneFloorProgramAtLevel(scenario.floorPrograms[0], 2);
    expect(isInteriorFinanceCurrent(clone.floorPrograms[0])).toBe(true);
    expect(isInteriorFinanceCurrent(upper)).toBe(true);
    expect(recommendationCandidateKey(clone)).toBe(recommendationCandidateKey(scenario));
    clone.floorPrograms[0].interior!.spaces[0].label = "변경";
    expect(recommendationCandidateKey(clone)).not.toBe(recommendationCandidateKey(scenario));
    expect(scenario.floorPrograms[0].interior!.spaces[0].label).not.toBe("변경");
    scenario.geometrySource = { mode: "engine-generated", exactGeometryAvailable: true, locked: true };
    expect(protectLockedPlanningGeometryPatch(scenario, { floorPrograms: clone.floorPrograms }).floorPrograms).toBeUndefined();
  });
});
