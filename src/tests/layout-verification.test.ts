import { describe, expect, it } from "vitest";
import {
  assessInteriorLayout, DEFAULT_INTERIOR_SETTINGS, generateInteriorDraft,
  interiorPlanningCheck, reconnectInteriorDoors,
} from "@/lib/planning/interior-layout";
import { planContains, planRectangle, rotatePlanPoint, type PlanPoint } from "@/lib/planning/layout-geometry";
import {
  assessVehicleCirculation, buildVehiclePoses, DEFAULT_VEHICLE_PROFILE, screenVehiclePath, vehicleFootprint,
} from "@/lib/planning/vehicle-circulation";
import { clonePlanningScenario, createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import { calculateParkingLayout } from "@/lib/planning/parking-layout";
import type { FloorProgram } from "@/lib/planning/types";
import { canonicalProjectWorkspaceJson, validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";
import { calculatePlanningScenario, planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { defaultAssumptions } from "@/lib/finance/scenario";

const outline = planRectangle({ x: 0, z: 0 }, 10, 10);
function floorFixture(): FloorProgram {
  return createFloorProgram(2, [
    { ...createFloorZone("residential", 30, 1, "201호"), parkingExclusiveAreaSqm: 30, saleableAreaSqm: 30 },
    { ...createFloorZone("residential", 30, 1, "202호"), parkingExclusiveAreaSqm: 30, saleableAreaSqm: 30 },
    createFloorZone("common", 40, 0),
  ]);
}
function drafted() {
  const floor = floorFixture();
  const generated = generateInteriorDraft(floor, outline, DEFAULT_INTERIOR_SETTINGS);
  if (!generated.draft) throw new Error("fixture needs a draft");
  return { ...floor, interiorLayout: generated.draft };
}
const vehicle = { ...DEFAULT_VEHICLE_PROFILE };
const largeParcel = planRectangle({ x: 0, z: 0 }, 60, 60);
const straight = [{ x: -10, z: 0 }, { x: 10, z: 0 }];
const status = (floor: FloorProgram) => assessInteriorLayout(floor, outline);

describe("interior geometry screening", () => {
  it("generates actual contained spaces, independent common access and clear areas without changing finance", () => {
    const floor = drafted(), zones = structuredClone(floor.zones);
    const result = status(floor);
    expect(result.status).toBe("preliminary-fit");
    expect(result.units).toHaveLength(2);
    expect(result.units.every(u => u.connected && u.clearAreaSqm >= u.targetAreaSqm)).toBe(true);
    expect(result.approvalStatus).toBe("unverified");
    expect(floor.zones).toEqual(zones);
    expect(interiorPlanningCheck(floor, outline).status).toBe("review");
  });
  it("handles rotated floor outlines in the same local coordinates", () => {
    const floor = floorFixture(), rotated = outline.map(p => rotatePlanPoint(p, 32));
    const generated = generateInteriorDraft(floor, rotated, DEFAULT_INTERIOR_SETTINGS);
    expect(generated.assessment?.status).toBe("preliminary-fit");
  });
  it("does not invent boundary data", () => {
    const result = assessInteriorLayout(drafted());
    expect(result.status).toBe("missing");
    expect(result.issues[0].code).toBe("outline-missing");
  });
  it("invalidates drafts on changed geometry or target areas", () => {
    const floor = drafted();
    expect(assessInteriorLayout(floor, outline.map(p => ({ x: p.x + 1, z: p.z }))).issues.map(i => i.code)).toContain("stale-outline");
    floor.zones[0].parkingExclusiveAreaSqm = 40;
    expect(status(floor).issues.map(i => i.code)).toContain("stale-program");
    expect(status(floor).issues.map(i => i.code)).toContain("exclusive-area-shortfall");
  });
  it("rejects duplicate IDs, overlaps, outside shapes and inadequate clear width", () => {
    const floor = drafted();
    floor.interiorLayout.spaces[2].center = { ...floor.interiorLayout.spaces[0].center };
    floor.interiorLayout.spaces[2].widthM = 1;
    floor.interiorLayout.spaces[3].id = floor.interiorLayout.spaces[2].id;
    floor.interiorLayout.spaces[3].center.x = 50;
    const codes = status(floor).issues.map(i => i.code);
    expect(codes).toEqual(expect.arrayContaining(["duplicate-space", "overlap", "outside", "clear-width"]));
  });
  it("rejects doors not on shared walls or narrower than the chosen clear width", () => {
    const floor = drafted();
    floor.interiorLayout.doors[0].center.x += 0.5;
    floor.interiorLayout.doors[1].widthM = 0.3;
    expect(status(floor).issues.map(i => i.code)).toContain("door-invalid");
  });
  it("does not treat access through another household as a common corridor", () => {
    const floor = drafted();
    const units = floor.interiorLayout.spaces.filter(s => s.kind === "unit");
    floor.interiorLayout.doors = floor.interiorLayout.doors.filter(d => d.from !== units[1].id && d.to !== units[1].id);
    floor.interiorLayout.doors.push({
      from: units[0].id, to: units[1].id, center: { x: 1.5, z: 0 }, widthM: 0.9,
    });
    expect(status(floor).issues.map(i => i.code)).toContain("unit-disconnected");
  });
  it("reconnects valid shared-wall doors after explicit user action", () => {
    const floor = drafted();
    floor.interiorLayout.doors = [];
    expect(status(floor).status).toBe("conflict");
    floor.interiorLayout = reconnectInteriorDoors(floor.interiorLayout);
    expect(status(floor).status).toBe("preliminary-fit");
  });
  it("reports template area shortfalls without rewriting the area program", () => {
    const floor = floorFixture();
    floor.zones[0].parkingExclusiveAreaSqm = 45;
    floor.zones[1].parkingExclusiveAreaSqm = 45;
    const before = JSON.stringify(floor);
    const generated = generateInteriorDraft(floor, outline, DEFAULT_INTERIOR_SETTINGS);
    expect(generated.assessment?.status).toBe("conflict");
    expect(JSON.stringify(floor)).toBe(before);
  });
  it("does not convert no-template-fit into an impossible-site verdict", () => {
    const skinny = planRectangle({ x: 0, z: 0 }, 2, 30);
    const generated = generateInteriorDraft(floorFixture(), skinny, DEFAULT_INTERIOR_SETTINGS);
    expect(generated.draft).toBeNull();
    expect(generated.message).toContain("불가능 판정은 아닙니다");
  });
  it("rejects malformed settings, self-crossing outlines and unsupported mixed uses", () => {
    const floor = floorFixture();
    expect(generateInteriorDraft(floor, outline, { ...DEFAULT_INTERIOR_SETTINGS, wallThicknessM: NaN }).draft).toBeNull();
    const bow = [{ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }, { x: 10, z: 0 }];
    expect(generateInteriorDraft(floor, bow, DEFAULT_INTERIOR_SETTINGS).draft).toBeNull();
    floor.zones.push(createFloorZone("retail", 1, 1));
    expect(generateInteriorDraft(floor, outline, DEFAULT_INTERIOR_SETTINGS).draft).toBeNull();
  });
  it("clears copied interior references instead of sharing old floor and zone ownership", () => {
    const source = createBlankPlanningScenario();
    source.floorPrograms = [drafted()];
    source.parking.vehicleProfile = { ...vehicle };
    const copy = clonePlanningScenario(source);
    expect(copy.floorPrograms[0].interiorLayout).toBeUndefined();
    copy.parking.vehicleProfile!.widthM = 2;
    expect(source.parking.vehicleProfile.widthM).toBe(1.85);
  });
});

describe("planar collision primitives", () => {
  it("detects a concave notch crossing even if all rectangle corners are inside", () => {
    const concave: PlanPoint[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 6, z: 10 },
      { x: 6, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 }];
    expect(planContains(concave, planRectangle({ x: 5, z: 5 }, 8, 8))).toBe(false);
  });
});

describe("vehicle swept-path screening", () => {
  it("checks the whole car rather than a centreline and preserves unverified approval", () => {
    const clear = screenVehiclePath({ waypoints: straight, vehicle, parcel: largeParcel, obstacles: [] });
    expect(clear.status).toBe("clear-candidate");
    expect(clear.distanceM).toBeCloseTo(20);
    const narrow = screenVehiclePath({ waypoints: straight, vehicle, parcel: planRectangle({ x: 0, z: 0 }, 60, 1.9), obstacles: [] });
    expect(narrow.status).toBe("conflict");
    expect(narrow.collisions).toContain("대지 경계");
  });
  it("constructs tangent turns with the configured rear-axle radius", () => {
    const poses = buildVehiclePoses([{ x: -15, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 15 }], 5)!;
    expect(poses.length).toBeGreaterThan(50);
    expect(poses[0].headingRad).toBeCloseTo(0);
    expect(poses.at(-1)!.headingRad).toBeCloseTo(Math.PI / 2);
    const turning = poses.filter(p => p.headingRad > 0 && p.headingRad < Math.PI / 2);
    for (const pose of turning) expect(Math.hypot(pose.rearAxle.x + 5, pose.rearAxle.z - 5)).toBeCloseTo(5);
  });
  it("rejects impossible short fillets, U-turns and invalid inputs without asserting site impossibility", () => {
    const result = screenVehiclePath({ waypoints: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }], vehicle, parcel: largeParcel, obstacles: [] });
    expect(result.status).toBe("no-template-fit");
    expect(buildVehiclePoses([{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 0, z: 0 }], 5)).toBeNull();
    expect(buildVehiclePoses(straight, NaN)).toBeNull();
    expect(screenVehiclePath({ waypoints: straight, vehicle: { ...vehicle, lengthM: 3 }, parcel: largeParcel, obstacles: [] }).status).toBe("unavailable");
  });
  it("detects thin obstructions between samples and off-centre body collisions", () => {
    for (const [x, z] of [[0.123, 0], [0, 0.98]]) {
      const result = screenVehiclePath({ waypoints: straight, vehicle, parcel: largeParcel,
        obstacles: [{ id: "실측 장애물", shape: planRectangle({ x, z }, 0.02, 0.02) }] });
      expect(result.collisions).toContain("실측 장애물");
    }
  });
  it("detects inside-corner obstacles during turning", () => {
    const waypoints = [{ x: -15, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 15 }];
    const poses = buildVehiclePoses(waypoints, 5)!;
    const mid = poses.find(p => p.headingRad > 0.7 && p.headingRad < 0.85)!;
    const point = vehicleFootprint(mid, vehicle)[0];
    const result = screenVehiclePath({ waypoints, vehicle, parcel: largeParcel,
      obstacles: [{ id: "회전 기둥", shape: planRectangle(point, 0.15, 0.15) }] });
    expect(result.status).toBe("conflict");
  });
  it("requires the final body and clearance to fit the actual destination stall", () => {
    const result = screenVehiclePath({ waypoints: straight, vehicle, parcel: largeParcel, obstacles: [],
      destination: planRectangle({ x: 11.3, z: 0 }, 4, 1.8) });
    expect(result.collisions).toContain("주차면 유효 폭·깊이");
  });
  it("retains unknown when frontage is absent or a strategy has no route model", () => {
    const parking = { strategy: "surface" as const, providedCars: 1 };
    const layout = calculateParkingLayout({ strategy: "surface", parcelShape: outline, parking, requiredCars: 1 });
    expect(assessVehicleCirculation({ layout, parcel: outline, parking, frontEdge: null }).status).toBe("unknown");
    const result = assessVehicleCirculation({ layout, parcel: outline, parking: { ...parking, strategy: "mixed" }, frontEdge: [outline[0], outline[1]] });
    expect(result.status).toBe("unknown");
    expect(result.approvalStatus).toBe("unverified");
  });
  it("keeps successful direct-frontage internal candidates separate from road entry permission", () => {
    const parcel = planRectangle({ x: 0, z: 0 }, 12, 7);
    const parking = { strategy: "surface" as const, providedCars: 2, columnLossPct: 0 };
    const edge: [PlanPoint, PlanPoint] = [parcel[0], parcel[1]];
    const layout = calculateParkingLayout({ strategy: "surface", parcelShape: parcel, parking, requiredCars: 2, frontEdge: edge });
    const result = assessVehicleCirculation({ layout, parcel, parking, frontEdge: edge });
    expect(result.stalls.length).toBeGreaterThan(0);
    expect(result.clearCandidateCount).toBeGreaterThan(0);
    expect(result.approvalStatus).toBe("unverified");
    expect(result.limitations.join(" ")).toContain("외부 도로");
  });
});

describe("approval boundary", () => {
  it("does not let geometry-only preliminary results confirm a representative", () => {
    const base = ["bcr", "far", "height", "parking"].map(code => ({ code, label: code, status: "pass" as const, message: "" }));
    const result = assessRepresentativeCheckReadiness([...base, interiorPlanningCheck(drafted(), outline),
      { code: "vehicle-circulation", label: "동선", status: "review", message: "승인 미확정" }]);
    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(2);
  });
  it("round-trips drafts and vehicle assumptions through workspace validation", () => {
    const payload = projectWorkspaceFixture("layout-test");
    const scenario = createBlankPlanningScenario({ projectId: "layout-test" });
    scenario.floorPrograms = [drafted()];
    scenario.parking.vehicleProfile = { ...vehicle };
    payload.planningScenarios = [scenario];
    const restored = JSON.parse(canonicalProjectWorkspaceJson(payload));
    expect(validateProjectWorkspacePayload(restored, "layout-test").valid).toBe(true);
    expect(restored.planningScenarios[0].floorPrograms[0].interiorLayout).toEqual(scenario.floorPrograms[0].interiorLayout);
    expect(status(restored.planningScenarios[0].floorPrograms[0]).status).toBe("preliminary-fit");
    restored.planningScenarios[0].parking.vehicleProfile.lengthM = 1;
    expect(validateProjectWorkspacePayload(restored, "layout-test").valid).toBe(false);
  });
  it("rejects malformed interior drafts and entrance positions at the storage boundary", () => {
    const payload = projectWorkspaceFixture("layout-test");
    const scenario = createBlankPlanningScenario({ projectId: "layout-test" });
    scenario.floorPrograms = [drafted()];
    scenario.floorPrograms[0].interiorLayout!.spaces[0].widthM = -2;
    scenario.parking.entryOffsetRatio = 2;
    payload.planningScenarios = [scenario];
    const validation = validateProjectWorkspacePayload(payload, "layout-test");
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("실내 구획");
    expect(validation.errors.join(" ")).toContain("진입 위치");
  });
  it("does not change sale revenue, costs or parking-law input when only concept geometry changes", () => {
    const scenario = createBlankPlanningScenario({ projectId: "layout-finance" });
    scenario.floorPrograms = [floorFixture()];
    const context = {
      parcel: { address: "서울특별시 도봉구", lotAreaSqm: 200, maxFARPct: 200, maxBCRPct: 60,
        heightLimitM: 18, acquisitionCostManwon: 50000, demolitionCostManwon: 1000 },
      assumptions: planningEconomicsAssumptionsFromLegacy(defaultAssumptions()), calculatedAt: "2026-10-20T00:00:00Z",
    };
    const before = calculatePlanningScenario(scenario, context);
    scenario.floorPrograms[0].interiorLayout = generateInteriorDraft(scenario.floorPrograms[0], outline, DEFAULT_INTERIOR_SETTINGS).draft!;
    scenario.parking.vehicleProfile = { ...vehicle };
    const after = calculatePlanningScenario(scenario, context);
    expect(after.economicsPreview).toEqual(before.economicsPreview);
    expect(after.parking.requiredCars).toBe(before.parking.requiredCars);
    expect(after.revenueProjection).toEqual(before.revenueProjection);
  });
});
