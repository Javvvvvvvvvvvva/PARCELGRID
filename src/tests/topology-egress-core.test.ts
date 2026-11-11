import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { assessEgressCore, DEFAULT_EGRESS_SETTINGS, EGRESS_VERSION, groundExitBasis, groundExitCandidates } from "@/lib/planning/egress-core";
import { DEFAULT_INTERIOR_SETTINGS, generateInteriorDraft } from "@/lib/planning/interior-layout";
import { generateRoomLayout } from "@/lib/planning/room-layout";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/planning/room-layout-schema";
import { planRectangle } from "@/lib/planning/layout-geometry";
import { polygonCentroid } from "@/lib/planning/planning-massing";
import * as massing from "@/lib/planning/planning-massing";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";

function fixture() {
  const outline = planRectangle({ x: 0, z: 0 }, 12, 12), parcelShape = planRectangle({ x: 0, z: 0 }, 20, 20);
  const scenario = createBlankPlanningScenario();
  scenario.floorPrograms = [1, 2].map(level => {
    const floor = createFloorProgram(level, level === 1
      ? [createFloorZone("piloti", 108, 0), createFloorZone("common", 36, 0)]
      : [{ ...createFloorZone("residential", 108, 1), parkingExclusiveAreaSqm: 90, saleableAreaSqm: 90 }, createFloorZone("common", 36, 0)]);
    floor.interiorLayout = generateInteriorDraft(floor, outline, { ...DEFAULT_INTERIOR_SETTINGS, coreDepthM: 5.5 }).draft!;
    floor.interiorLayout.roomLayouts = floor.interiorLayout.spaces.filter(s => s.kind === "unit")
      .map(unit => generateRoomLayout(floor, unit.id, outline, DEFAULT_ROOM_SETTINGS).draft!);
    return floor;
  });
  const ground = scenario.floorPrograms[0], candidate = groundExitCandidates(ground, outline)[0];
  scenario.egressPlan = { version: EGRESS_VERSION, settings: { ...DEFAULT_EGRESS_SETTINGS }, exit: {
    floorId: ground.id, spaceId: candidate.spaceId, edgeIndex: candidate.edgeIndex, offsetRatio: 0.5, widthM: 0.9,
    layoutBasis: groundExitBasis(ground.interiorLayout!),
  } };
  return { scenario, floors: scenario.floorPrograms.map((floor, i) => ({ id: floor.id, level: floor.level, shape: outline, baseHeightM: i * 3 })),
    parcelShape, groundObstacles: [] };
}

describe("component-owned egress landing", () => {
  afterEach(() => vi.restoreAllMocks());
  it("connects the real exit on a later component with no legacy ring", () => {
    const input = fixture();
    const polygons: LocalParcelPolygon[] = [{ outer: planRectangle({ x: 50, z: 0 }, 20, 20), holes: [] }, { outer: input.parcelShape, holes: [] }];
    const result = assessEgressCore({ ...input, parcelShape: [], parcelPolygons: polygons });
    expect(result.status).toBe("preliminary-chain");
    expect(result.exitPolygonIndex).toBe(1);
    expect(result.connectedFloors).toHaveLength(2);
    expect(result.approvalStatus).toBe("unverified");
  });

  it("allows a parcel hole clear of the real floor and landing", () => {
    const input = fixture();
    const result = assessEgressCore({ ...input, parcelPolygons: [{ outer: input.parcelShape,
      holes: [planRectangle({ x: 8, z: 8 }, 0.3, 0.3)] }] });
    expect(result.status).toBe("preliminary-chain");
    expect(result.exitPolygonIndex).toBe(0);
  });

  it("rejects a tiny hole fully enclosed by the landing", () => {
    const input = fixture(), baseline = assessEgressCore(input);
    const hole = planRectangle(polygonCentroid(baseline.exitLanding), 0.02, 0.02);
    const result = assessEgressCore({ ...input, parcelPolygons: [{ outer: input.parcelShape, holes: [hole] }] });
    expect(result.status).toBe("conflict");
    expect(result.issues.some(i => i.code === "exit-outside")).toBe(true);
    expect(result.connectedFloors).toEqual([]);
  });

  it("rejects a thin concave intrusion between landing corners", () => {
    const input = fixture(), center = polygonCentroid(assessEgressCore(input).exitLanding);
    const outer = [{ x: -10, z: -10 }, { x: center.x - 0.01, z: -10 }, { x: center.x - 0.01, z: center.z + 0.01 },
      { x: center.x + 0.01, z: center.z + 0.01 }, { x: center.x + 0.01, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }];
    const result = assessEgressCore({ ...input, parcelPolygons: [{ outer, holes: [] }] });
    expect(result.status).toBe("conflict");
    expect(result.issues.some(i => i.code === "exit-outside")).toBe(true);
  });

  it("cannot use a landing on a different touching component", () => {
    const input = fixture(), landing = assessEgressCore(input).exitLanding;
    const result = assessEgressCore({ ...input, parcelPolygons: [
      { outer: input.floors[0].shape, holes: [] }, { outer: landing, holes: [] },
    ] });
    expect(result.status).toBe("conflict");
    expect(result.exitPolygonIndex).toBeNull();
    expect(result.connectedFloors).toEqual([]);
  });

  it.each([[], [{ outer: [], holes: [] }], null])("keeps invalid explicit topology unknown without legacy fallback (%j)", polygons => {
    const result = assessEgressCore({ ...fixture(), parcelPolygons: polygons as LocalParcelPolygon[] });
    expect(result.status).toBe("missing");
    expect(result.issues.some(i => i.code === "exit-parcel" && i.status === "unknown")).toBe(true);
    expect(result.connectedFloors).toEqual([]);
    expect(result.approvalStatus).toBe("unverified");
  });

  it("reports an exhausted shared geometry budget as unknown, never a conflict or approval", () => {
    const input = fixture();
    const budget = vi.spyOn(massing, "createPlanningGeometryBudget").mockImplementation(() => {
      let remaining = 10;
      return () => { if (--remaining < 0) { const error = new Error("bounded"); error.name = "TimeoutError"; throw error; } };
    });
    const result = assessEgressCore({ ...input, parcelPolygons: [{ outer: input.parcelShape, holes: [] }] });
    expect(budget).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("missing");
    expect(result.issues.some(i => i.code === "egress-geometry-budget" && i.status === "unknown")).toBe(true);
    expect(result.connectedFloors).toEqual([]);
    expect(result.approvalStatus).toBe("unverified");
  });
});
