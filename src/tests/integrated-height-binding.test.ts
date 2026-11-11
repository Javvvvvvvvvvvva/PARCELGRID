import { describe, expect, it } from "vitest";
import { buildIntegratedVerification, verificationApprovalBlockers } from "@/lib/handoff/integrated-verification";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";

const fixture = integratedVerificationFixture();
const disciplines = ["architect", "developer", "finance-tax", "insurance-risk", "sales-marketing"] as const;
const id = "binding.geometry-heights";

describe("integrated vertical geometry source binding", () => {
  it("recomputes storey elevations from the original programme without granting approval", () => {
    const input = structuredClone(fixture), before = structuredClone(input);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === id)?.status).toBe("checked");
    expect(report.checks.find(c => c.id === "egress.core")?.status).toBe("checked");
    expect(report.approvalStatus).toBe("unverified");
    expect(input).toEqual(before);
  });

  it.each(["compressed", "shifted", "floor-height", "floor-top", "total-height", "basement-depth", "missing-floor-top", "missing-total"])(
    "blocks every discipline even if all stored floor views agree: %s", kind => {
      const input = structuredClone(fixture), building = input.geometry!.building;
      if (kind === "compressed") {
        for (const floor of building.floors) { floor.baseHeightM /= 2; floor.topHeightM /= 2; floor.floorHeightM /= 2; }
        building.totalHeightM /= 2;
      } else if (kind === "shifted") {
        for (const floor of building.floors) { floor.baseHeightM += 1; floor.topHeightM += 1; }
      } else if (kind === "floor-height") building.floors[1].floorHeightM += 0.01;
      else if (kind === "floor-top") building.floors[1].topHeightM += 0.01;
      else if (kind === "total-height") building.totalHeightM += 0.01;
      else if (kind === "basement-depth") building.basementDepthM = 3;
      else if (kind === "missing-floor-top") Reflect.deleteProperty(building.floors[1], "topHeightM");
      else Reflect.deleteProperty(building, "totalHeightM");
      const report = buildIntegratedVerification(input);
      expect(report.checks.find(c => c.id === "binding.geometry-floor-views")?.status).toBe("checked");
      for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)).toContainEqual(
        expect.objectContaining({ id, status: kind.startsWith("missing") ? "missing" : "fail" }));
      expect(report.checks.find(c => c.id === "egress.core")?.status).not.toBe("checked");
      expect(report.approvalStatus).toBe("unverified");
    },
  );

  it("checks nonuniform storeys and basements in level order, independently of input ordering", () => {
    const input = structuredClone(fixture), scenario = input.planningScenario!;
    scenario.floorPrograms[0].floorHeightM = 3.2;
    scenario.floorPrograms[1].floorHeightM = 2.9;
    scenario.floorPrograms[2].floorHeightM = 3.15;
    for (const level of [-1, -2]) {
      const floor = createFloorProgram(level, [createFloorZone("parking", 144, 0)]);
      floor.floorHeightM = level === -1 ? 3.6 : 4.1;
      scenario.floorPrograms.push(floor);
    }
    scenario.floorPrograms.reverse();
    input.geometry = buildPlanningGeometry({ projectId: input.projectId, scenario,
      boundary: input.data.parcel.boundary, roads: input.data.parcel.roads, lotAreaSqm: 900,
      zoning: "일반상업지역", setback: { road: 0, side: 0, rear: 0 } }).snapshot;
    const before = structuredClone(input);
    expect(buildIntegratedVerification(input).checks.find(c => c.id === id)?.status).toBe("checked");
    expect(input).toEqual(before);
    input.geometry.building.basementFloors[1].baseHeightM += 0.1;
    expect(buildIntegratedVerification(input).checks.find(c => c.id === id)?.status).toBe("fail");
  });
});
