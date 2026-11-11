import { describe, expect, it } from "vitest";
import { assessInteriorLayout, DEFAULT_INTERIOR_SETTINGS, generateInteriorDraft, interiorProgramBasis, reconnectInteriorDoors } from "@/lib/planning/interior-layout";
import { assessRoomLayout, generateRoomLayout, reconnectRoomDoors, roomPlanningCheck } from "@/lib/planning/room-layout";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/planning/room-layout-schema";
import { assessEgressCore, DEFAULT_EGRESS_SETTINGS, EGRESS_VERSION, egressPlanningCheck, groundExitBasis, groundExitCandidates, stairReservation } from "@/lib/planning/egress-core";
import { planRectangle, rotatePlanPoint, sharedPlanEdge } from "@/lib/planning/layout-geometry";
import { pathDoorSegment, pathSpaceShape } from "@/lib/planning/interior-paths";
import { protectLockedPlanningGeometryPatch } from "@/lib/planning/geometry-source";
import { clonePlanningScenario, createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import { canonicalProjectWorkspaceJson, validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { defaultAssumptions } from "@/lib/finance/scenario";

const outline = planRectangle({ x: 0, z: 0 }, 12, 12);
const parcelShape = planRectangle({ x: 0, z: 0 }, 20, 20);
const settings = { ...DEFAULT_INTERIOR_SETTINGS, coreDepthM: 5.5 };
function drafted(level = 2, rotation = 0) {
  const shape = outline.map(p => rotatePlanPoint(p, rotation));
  const floor = createFloorProgram(level, level === 1 ? [createFloorZone("piloti", 108, 0), createFloorZone("common", 36, 0)] : [
    { ...createFloorZone("residential", 108, 1, "주거"), parkingExclusiveAreaSqm: 90, saleableAreaSqm: 90 },
    createFloorZone("common", 36, 0),
  ]);
  const draft = generateInteriorDraft(floor, shape, settings).draft!;
  const withParent = { ...floor, interiorLayout: draft };
  for (const unit of draft.spaces.filter(s => s.kind === "unit")) {
    const generated = generateRoomLayout(withParent, unit.id, shape, DEFAULT_ROOM_SETTINGS);
    if (!generated.draft) throw new Error(generated.message);
    draft.roomLayouts = [...draft.roomLayouts ?? [], generated.draft];
  }
  return withParent;
}
function fixture() {
  const scenario = createBlankPlanningScenario({ projectId: "room-egress-test" });
  scenario.floorPrograms = [drafted(1), drafted(2), drafted(3)];
  const ground = scenario.floorPrograms[0];
  const candidate = groundExitCandidates(ground, outline)[0];
  scenario.egressPlan = { version: EGRESS_VERSION, settings: { ...DEFAULT_EGRESS_SETTINGS }, exit: {
    floorId: ground.id, spaceId: candidate.spaceId, edgeIndex: candidate.edgeIndex, offsetRatio: 0.5, widthM: 0.9,
    layoutBasis: groundExitBasis(ground.interiorLayout!),
  } };
  return { scenario, floors: scenario.floorPrograms.map((f, i) => ({ id: f.id, level: f.level, shape: outline, baseHeightM: i * 3 })),
    parcelShape, groundObstacles: [] };
}
const unitId = (f: ReturnType<typeof drafted>) => f.interiorLayout.spaces.find(s => s.kind === "unit")!.id;
const roomResult = (f: ReturnType<typeof drafted>) => assessRoomLayout(f, unitId(f), outline);

describe("detailed room screening", () => {
  it("generates bedroom, kitchen, bathroom, living and independent hall connections", () => {
    const floor = drafted(), result = roomResult(floor);
    expect(assessInteriorLayout(floor, outline).status).toBe("preliminary-fit");
    expect(result.issues.filter(i => i.status === "fail")).toEqual([]);
    expect(result.status).toBe("preliminary-fit");
    expect(result.approvalStatus).toBe("unverified");
    expect(result.rooms).toHaveLength(6);
    expect(result.rooms.every(r => r.route && r.candidateDistanceM! > 0)).toBe(true);
    expect(result.clearAreaSqm).toBeLessThan(result.unitEnvelopeSqm);
    expect(roomPlanningCheck(floor, outline).status).toBe("review");
  });
  it.each([32, 90, -45])("generates and connects rotated units (%s degrees)", rotation => {
    const floor = drafted(2, rotation);
    expect(assessRoomLayout(floor, unitId(floor), outline.map(p => rotatePlanPoint(p, rotation))).status).toBe("preliminary-fit");
  });
  it("supports living/sleeping combined and flags infeasible bedroom counts without changing the program", () => {
    const floor = drafted(), before = JSON.stringify(floor.zones);
    for (const bedrooms of [0, 2, 3]) {
      const draft = generateRoomLayout(floor, unitId(floor), outline, { ...DEFAULT_ROOM_SETTINGS, bedrooms }).draft!;
      expect(draft.spaces.filter(s => s.kind === "bedroom")).toHaveLength(bedrooms);
    }
    expect(JSON.stringify(floor.zones)).toBe(before);
  });
  it("rejects invalid settings and cannot fabricate an absent parent", () => {
    const floor = drafted();
    expect(generateRoomLayout(floor, unitId(floor), outline, { ...DEFAULT_ROOM_SETTINGS, bedrooms: 1.5 }).draft).toBeNull();
    expect(assessRoomLayout({ ...floor, interiorLayout: undefined }, "missing", outline).status).toBe("missing");
    expect(assessRoomLayout(floor, unitId(floor)).status).toBe("missing");
  });
  it("invalidates changed unit shapes and entry doors", () => {
    const floor = drafted();
    floor.interiorLayout.spaces.find(s => s.kind === "unit")!.widthM -= 0.1;
    expect(roomResult(floor).issues.map(i => i.code)).toContain("stale-parent");
    const other = drafted();
    other.interiorLayout.doors.find(d => d.from === unitId(other) || d.to === unitId(other))!.widthM = 1;
    expect(roomResult(other).issues.map(i => i.code)).toContain("stale-parent");
  });
  it("flags overlap, out-of-unit and small rooms", () => {
    const floor = drafted(), draft = floor.interiorLayout.roomLayouts![0];
    draft.spaces[2].center = { ...draft.spaces[3].center };
    draft.spaces[4].center.x = 100;
    draft.spaces[5].widthM = 0.5;
    expect(roomResult(floor).issues.map(i => i.code)).toEqual(expect.arrayContaining(["room-overlap", "room-outside", "room-size"]));
  });
  it("rejects wrong program counts and duplicate or orphan room records", () => {
    const floor = drafted(), draft = floor.interiorLayout.roomLayouts![0];
    draft.settings.bedrooms = 2;
    expect(roomResult(floor).issues.map(i => i.code)).toContain("room-program");
    floor.interiorLayout.roomLayouts!.push(structuredClone(draft));
    expect(roomResult(floor).issues.map(i => i.code)).toContain("duplicate-unit");
    floor.interiorLayout.roomLayouts![1].unitId = "deleted-unit";
    expect(roomPlanningCheck(floor, outline).status).toBe("fail");
  });
  it("rejects an off-wall door and a disconnected room, then reconnects explicitly", () => {
    const floor = drafted(), draft = floor.interiorLayout.roomLayouts![0];
    draft.doors[0].center.x += 1;
    expect(roomResult(floor).issues.map(i => i.code)).toContain("room-door");
    draft.doors = [];
    expect(roomResult(floor).issues.map(i => i.code)).toContain("room-disconnected");
    floor.interiorLayout.roomLayouts = [reconnectRoomDoors(draft)];
    expect(roomResult(floor).status).toBe("preliminary-fit");
  });
  it("does not route bedroom access through the living room", () => {
    const floor = drafted(), draft = floor.interiorLayout.roomLayouts![0];
    const bed = draft.spaces.find(s => s.kind === "bedroom")!, living = draft.spaces.find(s => s.kind === "living")!;
    draft.doors = draft.doors.filter(d => d.from !== bed.id && d.to !== bed.id);
    const edge = sharedPlanEdge(pathSpaceShape(bed), pathSpaceShape(living))!;
    const door = { from: bed.id, to: living.id, center: { x: (edge[0].x + edge[1].x) / 2, z: (edge[0].z + edge[1].z) / 2 }, widthM: 0.8 };
    expect(pathDoorSegment(draft.spaces, door, draft.settings.wallThicknessM)).not.toBeNull();
    draft.doors.push(door);
    expect(roomResult(floor).rooms.find(r => r.id === bed.id)?.route).toBeNull();
  });
});

describe("egress and inter-floor core screening", () => {
  it("connects stored rooms through aligned stair reservations and a ground exit, without legal approval", () => {
    const result = assessEgressCore(fixture());
    expect(result.issues.filter(i => i.status !== "review")).toEqual([]);
    expect(result.status).toBe("preliminary-chain");
    expect(result.links.every(l => l.status === "fit")).toBe(true);
    expect(result.connectedFloors).toHaveLength(3);
    expect(result.routes).toHaveLength(8);
    expect(result.groundRoute.length).toBeGreaterThan(1);
    expect(result.approvalStatus).toBe("unverified");
    expect(egressPlanningCheck(result).status).toBe("review");
  });
  it("sizes even risers and two flights using actual height and selected assumptions", () => {
    const stair = stairReservation(3, DEFAULT_EGRESS_SETTINGS)!;
    expect(stair.risers).toBe(18);
    expect(stair.riserHeightM).toBeCloseTo(3 / 18);
    expect(stair.widthM).toBeCloseTo(2.5);
    expect(stair.depthM).toBeCloseTo(4.78);
    expect(stairReservation(0, DEFAULT_EGRESS_SETTINGS)).toBeNull();
    expect(stairReservation(NaN, DEFAULT_EGRESS_SETTINGS)).toBeNull();
    expect(stairReservation(3, { ...DEFAULT_EGRESS_SETTINGS, maxRiserM: 0 })).toBeNull();
  });
  it("rejects stair reservation overflow even when cores align", () => {
    const input = fixture();
    input.scenario.egressPlan!.settings.landingDepthM = 2;
    const result = assessEgressCore(input);
    expect(result.status).toBe("conflict");
    expect(result.links.every(l => l.status === "conflict")).toBe(true);
    expect(result.routes).toHaveLength(0);
  });
  it("rejects misaligned cores despite individually valid floors", () => {
    const input = fixture(), upper = input.scenario.floorPrograms[2];
    upper.interiorLayout!.spaces = upper.interiorLayout!.spaces.map(s => ({ ...s, center: { x: -s.center.x, z: s.center.z } }));
    upper.interiorLayout = reconnectInteriorDoors(upper.interiorLayout!);
    upper.interiorLayout.roomLayouts = [];
    const generated = generateRoomLayout(upper, upper.interiorLayout.spaces.find(s => s.kind === "unit")!.id, outline, DEFAULT_ROOM_SETTINGS);
    upper.interiorLayout.roomLayouts = [generated.draft!];
    expect(assessInteriorLayout(upper, outline).status).toBe("preliminary-fit");
    expect(assessEgressCore(input).links[1].status).toBe("conflict");
  });
  it("does not bridge a missing middle floor", () => {
    const input = fixture();
    input.scenario.floorPrograms.splice(1, 1);
    const result = assessEgressCore(input);
    expect(result.status).toBe("missing");
    expect(result.links[0].status).toBe("missing");
    expect(result.routes).toHaveLength(0);
  });
  it("rejects duplicate floor levels and invalid heights", () => {
    const input = fixture();
    input.scenario.floorPrograms[2].level = 2;
    expect(assessEgressCore(input).issues.map(i => i.code)).toContain("egress-level");
    input.floors[1].baseHeightM = 0;
    expect(assessEgressCore(input).links[0].status).toBe("missing");
  });
  it("leaves geometry, rooms and ground-exit absence unconfirmed", () => {
    const input = fixture();
    expect(assessEgressCore({ scenario: input.scenario }).status).toBe("missing");
    input.scenario.egressPlan!.exit = undefined;
    expect(assessEgressCore(input).issues.map(i => i.code)).toContain("exit-missing");
    input.scenario.floorPrograms[1].interiorLayout!.roomLayouts = [];
    expect(assessEgressCore(input).issues.map(i => i.code)).toContain("egress-rooms");
    input.scenario.floorPrograms.shift();
    expect(assessEgressCore(input).connectedFloors).toEqual([]);
  });
  it("invalidates changed ground layout and blocks oversized or edge-clipped exit openings", () => {
    const input = fixture();
    input.scenario.floorPrograms[0].interiorLayout!.doors[0].widthM += 0.05;
    expect(assessEgressCore(input).issues.map(i => i.code)).toContain("exit-stale");
    const fresh = fixture();
    fresh.scenario.egressPlan!.exit!.offsetRatio = 0;
    expect(assessEgressCore(fresh).issues.map(i => i.code)).toContain("exit-disconnected");
    fresh.scenario.egressPlan!.exit!.widthM = 0.6;
    expect(assessEgressCore(fresh).issues.map(i => i.code)).toContain("exit-opening");
  });
  it("rejects exterior landings outside the parcel and pedestrian/parking collisions", () => {
    const input = fixture();
    expect(assessEgressCore({ ...input, parcelShape: outline }).issues.map(i => i.code)).toContain("exit-outside");
    const result = assessEgressCore({ ...input, groundObstacles: [{ id: "주차면 1", shape: outline }] });
    expect(result.issues.map(i => i.code)).toContain("pedestrian-obstacle");
    expect(result.connectedFloors).toHaveLength(0);
  });
  it("applies egress opening assumptions to internal room doors as well", () => {
    const input = fixture();
    input.scenario.egressPlan!.settings.minimumDoorWidthM = 0.85;
    expect(assessEgressCore(input).issues.map(i => i.code)).toContain("egress-room-width");
  });
  it("requires explicit common-area budget without changing parking or residential area", () => {
    const floor = drafted(1);
    expect(assessInteriorLayout(floor, outline).status).toBe("preliminary-fit");
    floor.zones.find(z => z.useType === "common")!.areaSqm = 9;
    floor.interiorLayout.programBasis = interiorProgramBasis(floor);
    const before = JSON.stringify(floor.zones);
    expect(assessInteriorLayout(floor, outline).issues.map(i => i.code)).toContain("common-area-shortfall");
    expect(JSON.stringify(floor.zones)).toBe(before);
  });
});

describe("room/egress workspace and decision boundaries", () => {
  it("round-trips canonical workspace serialization without false stale detections", () => {
    const input = fixture(), payload = projectWorkspaceFixture("room-egress-test");
    payload.planningScenarios = [input.scenario];
    const restored = JSON.parse(canonicalProjectWorkspaceJson(payload));
    expect(validateProjectWorkspacePayload(restored, "room-egress-test").valid).toBe(true);
    expect(assessEgressCore({ ...input, scenario: restored.planningScenarios[0] }).status).toBe("preliminary-chain");
  });
  it("rejects malformed nested room and egress data at the save boundary", () => {
    const input = fixture(), payload = projectWorkspaceFixture("room-egress-test");
    input.scenario.egressPlan!.settings.treadDepthM = -1;
    input.scenario.floorPrograms[1].interiorLayout!.roomLayouts![0].spaces[0].widthM = -1;
    payload.planningScenarios = [input.scenario];
    const result = validateProjectWorkspacePayload(payload, "room-egress-test");
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("피난");
    expect(result.errors.join(" ")).toContain("실내 구획");
  });
  it("clears dependent references on scenario clone", () => {
    const copy = clonePlanningScenario(fixture().scenario);
    expect(copy.egressPlan).toBeUndefined();
    expect(copy.floorPrograms.every(f => !f.interiorLayout)).toBe(true);
  });
  it("protects egress edits in the locked scenario data layer", () => {
    const { scenario } = fixture();
    scenario.geometrySource = { mode: "engine-generated", exactGeometryAvailable: true, locked: true };
    const patch = protectLockedPlanningGeometryPatch(scenario, { egressPlan: scenario.egressPlan, name: "이름 변경" });
    expect(patch.egressPlan).toBeUndefined();
    expect(patch.name).toBe("이름 변경");
  });
  it("never promotes preliminary checks to representative approval", () => {
    const input = fixture();
    const checks = [egressPlanningCheck(assessEgressCore(input)), roomPlanningCheck(input.scenario.floorPrograms[1], outline)];
    expect(assessRepresentativeCheckReadiness(checks).ready).toBe(false);
  });
  it("does not mutate finance, area, or statutory parking quantities", () => {
    const input = fixture(), context = {
      parcel: { address: "서울특별시 도봉구", lotAreaSqm: 400, maxFARPct: 200, maxBCRPct: 60,
        heightLimitM: 18, acquisitionCostManwon: 50000, demolitionCostManwon: 1000 },
      assumptions: planningEconomicsAssumptionsFromLegacy(defaultAssumptions()), calculatedAt: "2026-10-22T00:00:00Z",
    };
    const withDetails = calculatePlanningScenario(input.scenario, context);
    const before = JSON.stringify(input.scenario);
    assessEgressCore(input);
    expect(JSON.stringify(input.scenario)).toBe(before);
    input.scenario.egressPlan = undefined;
    for (const f of input.scenario.floorPrograms) f.interiorLayout = undefined;
    const without = calculatePlanningScenario(input.scenario, context);
    expect(withDetails.economicsPreview).toEqual(without.economicsPreview);
    expect(withDetails.revenueProjection).toEqual(without.revenueProjection);
    expect(withDetails.parking.requiredCars).toBe(without.parking.requiredCars);
  });
});
