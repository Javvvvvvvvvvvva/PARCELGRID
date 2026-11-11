import { describe, expect, it } from "vitest";
import { buildIntegratedVerification, verificationApprovalBlockers } from "@/lib/handoff/integrated-verification";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";
import { projectParcelPolygons } from "@/lib/geo/parcel-envelope";

function fixture() {
  const input = integratedVerificationFixture();
  const boundary = input.data.parcel.boundary!;
  input.data.parcel.boundary = [];
  input.data.parcel.boundaryPolygons = [{ outer: boundary, holes: [] },
    { outer: boundary.map(([lng, lat]) => [lng + 0.001, lat]), holes: [] }];
  input.geometry!.parcel.polygons = projectParcelPolygons(input.data.parcel.boundaryPolygons, input.geometry!.coordinateSystem.originLngLat);
  input.geometry!.parcel.polygon = [];
  return input;
}

describe("integrated full-source parking revalidation", () => {
  it("withholds derived checks for a copied complex source with stale area and geometry identity", () => {
    const input = fixture(), before = structuredClone(input);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === "binding.parcel-region")?.status).toBe("checked");
    expect(report.checks.find(c => c.id === "parking.layout")).toBeUndefined();
    expect(report.checks.find(c => c.id === "parking.coverage")?.status).toBe("missing");
    expect(report.checks.find(c => c.id === "binding.geometry-content")?.status).toBe("fail");
    expect(report.approvalStatus).toBe("unverified");
    // The copied parcel's original area values cannot certify the enlarged source.
    expect(verificationApprovalBlockers(report, "architect")).toContainEqual(expect.objectContaining({ id: "binding.parcel-area", status: "fail" }));
    expect(input).toEqual(before);
  });

  it("does not calculate parking from a changed secondary component or a new hole", () => {
    for (const kind of ["secondary", "hole"]) {
      const input = fixture();
      if (kind === "secondary") input.data.parcel.boundaryPolygons![1].outer[0][0] += 0.00001;
      else {
        const part = input.data.parcel.boundaryPolygons![1];
        const [lng, lat] = part.outer[0];
        part.holes = [[[lng + 0.00002, lat - 0.00002], [lng + 0.00003, lat - 0.00002],
          [lng + 0.00003, lat - 0.00003], [lng + 0.00002, lat - 0.00003]]];
      }
      const report = buildIntegratedVerification(input);
      expect(report.checks.find(c => c.id === "binding.parcel-region")?.status).toBe("fail");
      expect(report.checks.find(c => c.id === "parking.layout")).toBeUndefined();
      for (const discipline of ["architect", "developer", "finance-tax", "insurance-risk", "sales-marketing"] as const) {
        expect(verificationApprovalBlockers(report, discipline)).toContainEqual(expect.objectContaining({ id: "binding.parcel-region", status: "fail" }));
      }
    }
  });

  it.each(["outside", "hole"])("rejects an equal-area saved floor in %s despite unchanged pass flags and hashes", kind => {
    const input = integratedVerificationFixture();
    if (kind === "outside") input.geometry!.building.floors[0].shape.forEach(point => { point.x += 50; });
    else {
      const boundary = input.data.parcel.boundary!;
      const origin = input.geometry!.coordinateSystem.originLngLat;
      const hole = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]): [number, number] =>
        [origin[0] + x / (111000 * Math.cos(origin[1] * Math.PI / 180)), origin[1] - z / 111000]);
      input.data.parcel.boundaryPolygons = [{ outer: boundary, holes: [hole] }];
      input.data.parcel.boundary = [];
      input.geometry!.parcel.polygons = projectParcelPolygons(input.data.parcel.boundaryPolygons, origin);
      input.geometry!.parcel.polygon = [];
    }
    const report = buildIntegratedVerification(input);
    expect(input.geometry!.validation.representativeEligible).toBe(true);
    expect(report.checks.find(check => check.id === "floor.floor-1.area")?.status).toBe("checked");
    expect(report.checks.find(check => check.id === "parking.layout")).toBeUndefined();
    expect(report.checks.find(check => check.id === "parking.geometry")?.status).toBe("missing");
    expect(report.checks.find(check => check.id === "parking.coverage")?.status).toBe("missing");
    expect(report.checks.find(check => check.id === "egress.obstacles")?.status).toBe("missing");
    expect(report.checks.find(check => check.id === "egress.core")?.status).toBe("missing");
    for (const discipline of ["architect", "developer", "finance-tax", "insurance-risk", "sales-marketing"] as const) {
      expect(verificationApprovalBlockers(report, discipline)).toContainEqual(expect.objectContaining({ id: "binding.floor.floor-1.parcel-region", status: "fail" }));
    }
  });

  it.each(["missing", "invalid", "area-mismatch"])("withholds parking and egress for %s ground geometry", kind => {
    const input = integratedVerificationFixture();
    const ground = input.geometry!.building.floors[0];
    if (kind === "missing") input.geometry!.building.floors = input.geometry!.building.floors.filter(f => f.level !== 1);
    else if (kind === "invalid") ground.shape = [];
    else ground.shape = ground.shape.map(p => ({ x: p.x * 0.5, z: p.z * 0.5 }));
    const before = structuredClone(input);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(check => check.id === "parking.geometry")?.status).toBe("missing");
    expect(report.checks.find(check => check.id === "parking.layout")).toBeUndefined();
    expect(report.checks.find(check => check.id === "egress.core")?.status).toBe("missing");
    expect(report.approvalStatus).toBe("unverified");
    expect(input).toEqual(before);
  });

  it("withholds stale model parking and egress when an upper floor moves outside the source", () => {
    const input = integratedVerificationFixture();
    input.geometry!.building.floors[1].shape.forEach(p => { p.x += 50; });
    const before = structuredClone(input);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(check => check.id === "binding.floor.floor-2.parcel-region")?.status).toBe("fail");
    expect(report.checks.find(check => check.id === "parking.layout")).toBeUndefined();
    expect(report.checks.find(check => check.id === "binding.geometry-content")?.status).toBe("fail");
    expect(report.checks.find(check => check.id === "egress.core")?.status).toBe("missing");
    expect(report.checks.some(check => check.id.startsWith("egress.link.") && check.status === "checked")).toBe(false);
    expect(input).toEqual(before);
  });

  it.each(["missing", "moved"])("does not reconstruct a %s saved above-ground floor list from canonical floors", kind => {
    const input = integratedVerificationFixture();
    if (kind === "missing") input.geometry!.building.aboveGroundFloors = [];
    else {
      const ground = input.geometry!.building.aboveGroundFloors[0];
      input.geometry!.building.aboveGroundFloors[0] = { ...ground, shape: ground.shape.map(p => ({ ...p, x: p.x + 50 })) };
    }
    const before = structuredClone(input);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(check => check.id === "parking.layout")?.status).toBe("fail");
    for (const discipline of ["architect", "developer", "finance-tax", "insurance-risk", "sales-marketing"] as const) {
      expect(verificationApprovalBlockers(report, discipline)).toContainEqual(expect.objectContaining({ id: "binding.geometry-floor-views", status: "fail" }));
    }
    expect(report.checks.find(check => check.id === "egress.obstacles")?.status).toBe("missing");
    expect(report.approvalStatus).toBe("unverified");
    expect(input).toEqual(before);
  });
});
