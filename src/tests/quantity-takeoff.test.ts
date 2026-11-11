import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { assessInteriorLayout, DEFAULT_INTERIOR_SETTINGS, interiorProgramBasis } from "@/lib/planning/interior-layout";
import { pathDoorSegment } from "@/lib/planning/interior-paths";
import { planRectangle, rotatePlanPoint } from "@/lib/planning/layout-geometry";
import { assessRoomLayout, reconnectRoomDoors, roomParentBasis } from "@/lib/planning/room-layout";
import { DEFAULT_ROOM_SETTINGS, ROOM_LAYOUT_VERSION, type RoomSpace } from "@/lib/planning/room-layout-schema";
import { QUANTITY_ITEM_IDS, QUANTITY_TAKEOFF_VERSION, takeoffPlanningQuantities, type QuantityTakeoff } from "@/lib/planning/quantity-takeoff";
import type { PlanningScenario } from "@/lib/planning/types";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";

const baseline = integratedVerificationFixture().planningScenario!;
const fixture = () => structuredClone(baseline);
const quantities = (result: QuantityTakeoff) => Object.fromEntries(result.items.map(item => [item.id, item.quantity]));
function unavailable(result: QuantityTakeoff, status: "missing" | "conflict") {
  expect(result.status, result.issues.join("; ")).toBe(status);
  expect(result.items.map(item => item.id)).toEqual(QUANTITY_ITEM_IDS);
  expect(result.items.every(item => item.quantity === null)).toBe(true);
  expect(result.issues.length).toBeGreaterThan(0);
}

// A 10 x 10 clear unit. A 2 m horizontal hall separates 3+7 m and 5+5 m
// room rows: 10+10+4+4 = 28 m shared walls, four internal doors and one unit entry.
function handPlan() {
  const scenario = fixture(), floor = scenario.floorPrograms[1];
  scenario.floorPrograms = [floor];
  floor.zones[0].areaSqm = 104.04;
  floor.zones[1].areaSqm = 40.8;
  const unitId = floor.zones[0].id + "-0";
  const draft = floor.interiorLayout!;
  draft.sourceOutline = planRectangle({ x: 7.1, z: 5.1 }, 14.2, 10.2);
  draft.programBasis = interiorProgramBasis(floor);
  draft.settings = { ...DEFAULT_INTERIOR_SETTINGS };
  draft.spaces = [
    { id: "core", label: "Core", kind: "core", center: { x: 2, z: 2 }, widthM: 4, depthM: 4, rotationDeg: 0 },
    { id: "corridor", label: "Corridor", kind: "corridor", center: { x: 2, z: 7.1 }, widthM: 4, depthM: 6.2, rotationDeg: 0 },
    { id: unitId, zoneId: floor.zones[0].id, label: "Unit", kind: "unit", center: { x: 9.1, z: 5.1 }, widthM: 10.2, depthM: 10.2, rotationDeg: 0 },
  ];
  draft.doors = [
    { from: "core", to: "corridor", center: { x: 2, z: 4 }, widthM: 0.9 },
    { from: unitId, to: "corridor", center: { x: 4, z: 5.1 }, widthM: 0.9 },
  ];
  const space = (id: string, kind: RoomSpace["kind"], x: number, z: number, widthM: number, depthM: number): RoomSpace => ({
    id, label: id, kind, center: { x: 4.1 + x + widthM / 2, z: 0.1 + z + depthM / 2 }, widthM, depthM, rotationDeg: 0,
  });
  draft.roomLayouts = [reconnectRoomDoors({
    version: ROOM_LAYOUT_VERSION, unitId, parentBasis: roomParentBasis(draft, draft.spaces[2]), settings: { ...DEFAULT_ROOM_SETTINGS },
    entryDoor: structuredClone(draft.doors[1]), doors: [], spaces: [
      space("hall", "hall", 0, 4, 10, 2), space("bath", "bathroom", 0, 0, 3, 4), space("kitchen", "kitchen", 3, 0, 7, 4),
      space("bedroom", "bedroom", 0, 6, 5, 4), space("living", "living", 5, 6, 5, 4),
    ],
  })];
  return scenario;
}
function refreshParents(scenario: PlanningScenario) {
  for (const floor of scenario.floorPrograms) {
    const parent = floor.interiorLayout!;
    for (const room of parent.roomLayouts ?? []) room.parentBasis = roomParentBasis(parent, parent.spaces.find(s => s.id === room.unitId)!);
  }
}

describe("bounded planning quantity takeoff", () => {
  it("uses the existing integrated fixture, is deterministic, and never mutates its input", () => {
    const scenario = fixture(), before = structuredClone(scenario), first = takeoffPlanningQuantities(scenario);
    expect(first.status, first.issues.join("; ")).toBe("preliminary");
    expect(first.version).toBe(QUANTITY_TAKEOFF_VERSION);
    expect(first.items.map(item => item.id)).toEqual(QUANTITY_ITEM_IDS);
    expect(first.items.map(item => item.unit)).toEqual(["m", "count", "count", "m2", "m2", "count", "count"]);
    expect(quantities(first)).toMatchObject({ kitchenCount: 2, bathroomCount: 2, entryDoorCount: 4 });
    expect(first.items.every(item => item.quantity !== null && Number.isFinite(item.quantity) && item.detail.length > 0)).toBe(true);
    expect(takeoffPlanningQuantities(scenario)).toEqual(first);
    expect(scenario).toEqual(before);
    expect(first.limitations.join(" ")).toMatch(/실측/);
    expect(first.limitations.join(" ")).toMatch(/외벽.*구조체.*공용부.*MEP.*소방/);
    expect(first.limitations.join(" ")).toMatch(/sourceOutline/);
  });

  it("matches hand-checked partial shared edges, clear areas and door counts, without perimeter or opening deductions", () => {
    const scenario = handPlan(), floor = scenario.floorPrograms[0], parent = floor.interiorLayout!;
    expect(assessInteriorLayout(floor, parent.sourceOutline).status).toBe("preliminary-fit");
    expect(assessRoomLayout(floor, parent.roomLayouts![0].unitId, parent.sourceOutline).status).toBe("preliminary-fit");
    const result = takeoffPlanningQuantities(scenario), values = quantities(result);
    expect(result.status, result.issues.join("; ")).toBe("preliminary");
    expect(values.partitionLengthM).toBeCloseTo(28, 8);
    expect(values.interiorDoorCount).toBe(4);
    expect(values.entryDoorCount).toBe(1);
    expect(values.dryFloorAreaSqm).toBeCloseTo(9.88 * 1.88 + 2 * 4.88 * 3.88 + 6.88 * 3.88, 8);
    expect(values.wetFloorAreaSqm).toBeCloseTo(2.88 * 3.88, 8);
    expect(values.kitchenCount).toBe(1);
    expect(values.bathroomCount).toBe(1);
  });

  it("unions collinear pieces across subdivided halls and T junctions", () => {
    const scenario = handPlan(), parent = scenario.floorPrograms[0].interiorLayout!, room = parent.roomLayouts![0];
    room.spaces[0] = { ...room.spaces[0], center: { x: 6.1, z: 5.1 }, widthM: 4 };
    room.spaces.push({ ...room.spaces[0], id: "hall-right", center: { x: 11.1, z: 5.1 }, widthM: 6 });
    parent.roomLayouts = [reconnectRoomDoors(room)];
    const result = takeoffPlanningQuantities(scenario);
    expect(result.status, result.issues.join("; ")).toBe("preliminary");
    expect(quantities(result).partitionLengthM).toBeCloseTo(30, 8);
    expect(quantities(result).interiorDoorCount).toBe(7);
    room.spaces.reverse();
    room.doors.reverse();
    expect(quantities(takeoffPlanningQuantities(scenario))).toEqual(quantities(result));
  });

  it.each([32, 90, -45, 180])("preserves quantities after %s degree rotation", angle => {
    const scenario = handPlan(), original = takeoffPlanningQuantities(scenario), parent = scenario.floorPrograms[0].interiorLayout!;
    parent.sourceOutline = parent.sourceOutline.map(p => rotatePlanPoint(p, angle));
    for (const space of parent.spaces) { space.center = rotatePlanPoint(space.center, angle); space.rotationDeg += angle; }
    for (const door of parent.doors) door.center = rotatePlanPoint(door.center, angle);
    for (const room of parent.roomLayouts!) {
      room.entryDoor.center = rotatePlanPoint(room.entryDoor.center, angle);
      for (const space of room.spaces) { space.center = rotatePlanPoint(space.center, angle); space.rotationDeg += angle; }
      for (const door of room.doors) door.center = rotatePlanPoint(door.center, angle);
    }
    refreshParents(scenario);
    const result = takeoffPlanningQuantities(scenario);
    expect(result.status, result.issues.join("; ")).toBe("preliminary");
    for (let i = 0; i < result.items.length; i++) expect(result.items[i].quantity).toBeCloseTo(original.items[i].quantity!, 7);
    expect(result.basis).not.toBe(original.basis);
  });

  it("deduplicates physical forward/reversed parent and room doors, excluding the copied entryDoor", () => {
    const scenario = handPlan(), original = takeoffPlanningQuantities(scenario), parent = scenario.floorPrograms[0].interiorLayout!;
    for (const doors of [parent.doors, parent.roomLayouts![0].doors]) {
      doors.push(...structuredClone(doors).flatMap(door => [door, { ...door, from: door.to, to: door.from }]));
    }
    refreshParents(scenario);
    const result = takeoffPlanningQuantities(scenario);
    expect(result.status, result.issues.join("; ")).toBe("preliminary");
    expect(quantities(result)).toEqual(quantities(original));
    expect(result.basis).not.toBe(original.basis);
  });

  it("counts all four actual unit/common entries in the two-household fixture, excluding three common/common doors", () => {
    const scenario = fixture();
    const counts = scenario.floorPrograms.map(floor => {
      const parent = floor.interiorLayout!, units = new Set(parent.spaces.filter(s => s.kind === "unit").map(s => s.id));
      return { total: parent.doors.length, entries: parent.doors.filter(d => units.has(d.from) || units.has(d.to)).length };
    });
    expect(counts).toEqual([{ total: 1, entries: 0 }, { total: 3, entries: 2 }, { total: 3, entries: 2 }]);
    expect(quantities(takeoffPlanningQuantities(scenario)).entryDoorCount).toBe(4);
    const commonOnly = fixture();
    commonOnly.floorPrograms = [commonOnly.floorPrograms[0]];
    const result = takeoffPlanningQuantities(commonOnly);
    expect(result.status).toBe("preliminary");
    expect(result.items.every(item => item.quantity === 0)).toBe(true);
  });

  it.each(["parent", "room"])("rejects partially overlapping %s openings instead of double charging", target => {
    const scenario = handPlan(), parent = scenario.floorPrograms[0].interiorLayout!;
    if (target === "parent") {
      const door = structuredClone(parent.doors[0]);
      door.center.x += 0.2; parent.doors.push(door);
    } else {
      const room = parent.roomLayouts![0], door = structuredClone(room.doors[0]);
      const segment = pathDoorSegment(room.spaces, door, room.settings.wallThicknessM)!;
      door.center.x += (segment[1].x - segment[0].x) * 0.2;
      door.center.z += (segment[1].z - segment[0].z) * 0.2;
      room.doors.push(door);
    }
    const result = takeoffPlanningQuantities(scenario);
    unavailable(result, "conflict");
    expect(result.issues.join(" ")).toMatch(/겹칩니다/);
  });

  it("returns null for every aggregate if just one of several units is missing", () => {
    const scenario = fixture();
    scenario.floorPrograms[2].interiorLayout!.roomLayouts = [];
    unavailable(takeoffPlanningQuantities(scenario), "missing");
  });

  it("requires common floor layouts as well as residential unit layouts", () => {
    const scenario = fixture();
    delete scenario.floorPrograms[0].interiorLayout;
    unavailable(takeoffPlanningQuantities(scenario), "missing");
  });

  it("does not present room coverage gaps as a complete quantity total", () => {
    const scenario = handPlan(), parent = scenario.floorPrograms[0].interiorLayout!, room = parent.roomLayouts![0];
    const living = room.spaces.find(space => space.kind === "living")!;
    living.depthM -= 0.2; living.center.z -= 0.1;
    expect(assessRoomLayout(scenario.floorPrograms[0], room.unitId, parent.sourceOutline).status).toBe("preliminary-fit");
    unavailable(takeoffPlanningQuantities(scenario), "missing");
  });

  it.each(["program", "parent", "rooms"])("rejects stale %s data without any partial totals", target => {
    const scenario = fixture(), floor = scenario.floorPrograms[1];
    if (target === "program") floor.zones[0].saleableAreaSqm! -= 1;
    if (target === "parent") floor.interiorLayout!.spaces.find(s => s.kind === "unit")!.widthM -= 0.1;
    if (target === "rooms") floor.interiorLayout!.roomLayouts![0].parentBasis = "stale";
    unavailable(takeoffPlanningQuantities(scenario), "conflict");
  });

  it.each(["retail", "office", "mechanical", "storage", "other"] as const)("does not partially cost a project containing %s", useType => {
    const scenario = fixture();
    scenario.floorPrograms[0].zones[0].useType = useType;
    unavailable(takeoffPlanningQuantities(scenario), "missing");
  });

  it.each(["duplicate-floor", "duplicate-level", "duplicate-zone", "duplicate-unit", "orphan-unit", "room-overlap", "bad-outline"])("rejects %s", problem => {
    const scenario = fixture(), floor = scenario.floorPrograms[1], parent = floor.interiorLayout!;
    if (problem === "duplicate-floor") scenario.floorPrograms[2].id = floor.id;
    if (problem === "duplicate-level") scenario.floorPrograms[2].level = floor.level;
    if (problem === "duplicate-zone") floor.zones[1].id = floor.zones[0].id;
    if (problem === "duplicate-unit") parent.roomLayouts!.push(structuredClone(parent.roomLayouts![0]));
    if (problem === "orphan-unit") parent.roomLayouts!.push({ ...structuredClone(parent.roomLayouts![0]), unitId: "unknown" });
    if (problem === "room-overlap") parent.roomLayouts![0].spaces[1].center = { ...parent.roomLayouts![0].spaces[0].center };
    if (problem === "bad-outline") parent.sourceOutline = [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }, { x: 1, z: 0 }];
    unavailable(takeoffPlanningQuantities(scenario), "conflict");
  });

  it.each(["NaN", "Infinity", "null-floor", "bad-doors", "bad-rooms", "fractional-units", "cycle", "bigint"])("fails closed on malformed %s data without throwing", problem => {
    const scenario = fixture(), floor = scenario.floorPrograms[1];
    if (problem === "NaN") floor.zones[0].areaSqm = NaN;
    if (problem === "Infinity") floor.interiorLayout!.roomLayouts![0].spaces[0].widthM = Infinity;
    if (problem === "null-floor") scenario.floorPrograms[1] = null as unknown as typeof floor;
    if (problem === "bad-doors") Object.assign(floor.interiorLayout!, { doors: "bad" });
    if (problem === "bad-rooms") Object.assign(floor.interiorLayout!, { roomLayouts: [null] });
    if (problem === "fractional-units") floor.zones[0].unitCount = 1.5;
    if (problem === "cycle") Object.assign(floor, { cyclic: floor });
    if (problem === "bigint") Object.assign(floor, { floorHeightM: 3n });
    const result = takeoffPlanningQuantities(scenario);
    expect(result.status).not.toBe("preliminary");
    expect(result.items.every(item => item.quantity === null)).toBe(true);
  });

  it("bounds total floor and unit counts before geometry validation", () => {
    const tooManyFloors = fixture();
    tooManyFloors.floorPrograms = Array.from({ length: 33 }, () => structuredClone(baseline.floorPrograms[1]));
    unavailable(takeoffPlanningQuantities(tooManyFloors), "missing");
    const tooManyUnits = fixture();
    tooManyUnits.floorPrograms = Array.from({ length: 7 }, (_, i) => {
      const floor = structuredClone(baseline.floorPrograms[1]);
      floor.id = `floor-${i}`; floor.level = i + 1; floor.zones[0].unitCount = 20;
      return floor;
    });
    unavailable(takeoffPlanningQuantities(tooManyUnits), "missing");
    const tooManyOnFloor = fixture(); tooManyOnFloor.floorPrograms[1].zones[0].unitCount = 21;
    unavailable(takeoffPlanningQuantities(tooManyOnFloor), "missing");
  });

  it("bounds nested raw data and polygon vertices", () => {
    const large = fixture();
    Object.assign(large.floorPrograms[0], { extra: "x".repeat(100001) });
    unavailable(takeoffPlanningQuantities(large), "missing");
    const longKey = fixture();
    Object.assign(longKey.floorPrograms[0], { ["x".repeat(100001)]: 0 });
    unavailable(takeoffPlanningQuantities(longKey), "missing");
    const polygon = fixture();
    polygon.floorPrograms[0].interiorLayout!.sourceOutline = Array.from({ length: 129 }, (_, i) => ({ x: Math.cos(i * 2 * Math.PI / 129), z: Math.sin(i * 2 * Math.PI / 129) }));
    unavailable(takeoffPlanningQuantities(polygon), "missing");
    const deep = fixture();
    let nested: unknown = {};
    for (let i = 0; i < 30; i++) nested = { nested };
    Object.assign(deep.floorPrograms[0], { nested });
    unavailable(takeoffPlanningQuantities(deep), "missing");
  });

  it("hashes the entire canonical raw basis with SHA-256, excluding caches, revisions, lifecycle timestamps and cost plans", () => {
    const scenario = handPlan(), before = takeoffPlanningQuantities(scenario);
    const selected = { id: scenario.id, projectId: scenario.projectId, placement: scenario.placement,
      floorPrograms: scenario.floorPrograms, dwellingProgram: scenario.dwellingProgram, materials: scenario.materials };
    const json = JSON.stringify(selected, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
    expect(before.basis).toBe(`${QUANTITY_TAKEOFF_VERSION}:sha256:${createHash("sha256").update(json).digest("hex")}`);
    scenario.version++;
    scenario.updatedAt = "2099-01-01T00:00:00.000Z";
    scenario.createdAt = "2000-01-01T00:00:00.000Z";
    Object.assign(scenario, { quantityCostPlan: { appliedBasis: before.basis }, costPlan: { total: 999 }, checks: [], economicsPreview: { hardCost: 999 } });
    expect(takeoffPlanningQuantities(scenario).basis).toBe(before.basis);
    const reordered = Object.fromEntries(Object.entries(scenario).reverse()) as unknown as PlanningScenario;
    reordered.floorPrograms = scenario.floorPrograms.map(f => Object.fromEntries(Object.entries(f).reverse()) as unknown as typeof f);
    expect(takeoffPlanningQuantities(reordered).basis).toBe(before.basis);
  });

  it.each(["id", "projectId", "placement", "height", "zones", "rooms", "doors", "materials", "dwellingProgram"])("binds raw %s changes even when version and checks do not change", target => {
    const scenario = handPlan(), before = takeoffPlanningQuantities(scenario).basis, floor = scenario.floorPrograms[0];
    if (target === "id") scenario.id += "-changed";
    if (target === "projectId") scenario.projectId += "-changed";
    if (target === "placement") scenario.placement.offsetXM += 0.1;
    if (target === "height") floor.floorHeightM += 0.1;
    if (target === "zones") floor.zones[0].areaSqm += 1;
    if (target === "rooms") floor.interiorLayout!.roomLayouts![0].spaces[0].widthM -= 0.1;
    if (target === "doors") floor.interiorLayout!.roomLayouts![0].doors[0].widthM += 0.05;
    if (target === "materials") Object.assign(scenario, { materials: { primaryFacadeMaterial: "brick-veneer" } });
    if (target === "dwellingProgram") Object.assign(scenario, { dwellingProgram: { baselineDwellingCount: 1 } });
    expect(takeoffPlanningQuantities(scenario).basis).not.toBe(before);
  });

  it("never fabricates quantities for an absent or empty scenario", () => {
    unavailable(takeoffPlanningQuantities(null as unknown as PlanningScenario), "missing");
    const scenario = fixture(); scenario.floorPrograms = [];
    unavailable(takeoffPlanningQuantities(scenario), "missing");
  });
});
