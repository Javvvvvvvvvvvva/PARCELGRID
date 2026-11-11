import { describe, expect, it } from "vitest";
import { buildIntegratedVerification, verificationApprovalBlockers } from "@/lib/handoff/integrated-verification";
import { planningGeometryContentHash } from "@/lib/planning/planning-geometry";
import { localParcelPolygons } from "@/lib/geo/parcel-topology";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";

const fixture = integratedVerificationFixture();
const disciplines = ["architect", "developer", "finance-tax", "insurance-risk", "sales-marketing"] as const;
const hashFor = (input: typeof fixture) => {
  const snapshot = input.geometry!;
  return planningGeometryContentHash({ projectId: snapshot.projectId, scenarioId: snapshot.scenarioId,
    origin: snapshot.coordinateSystem.originLngLat, polygons: localParcelPolygons(snapshot.parcel), parcelAvailable: true,
    officialAreaSqm: snapshot.parcel.officialAreaSqm, zoning: input.data.parcel.zoning,
    floors: snapshot.building.floors, roads: snapshot.roads });
};

describe("stored geometry content and quantities", () => {
  it("reconstructs the existing v6 identifier through JSON key reordering without changing identity", () => {
    const ordered = JSON.stringify(fixture, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
    const input = JSON.parse(ordered);
    expect(hashFor(input)).toBe(fixture.geometry!.geometryHash);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === "binding.geometry-content")?.status).toBe("checked");
    expect(report.checks.find(c => c.id === "binding.geometry-quantities")?.status).toBe("checked");
    expect(report.approvalStatus).toBe("unverified");
  });

  it.each(["shape", "visual-area", "programme-area", "zoning"])("rejects a stale geometry identity after %s changes", kind => {
    const input = structuredClone(fixture), building = input.geometry!.building;
    if (kind === "shape") for (const floor of building.floors) for (const point of floor.shape) point.x += 0.1;
    else if (kind === "visual-area") building.floors[1].visualAreaSqm += 10;
    else if (kind === "programme-area") building.floors[1].programAreaSqm += 10;
    else input.data.parcel.zoning = "제2종일반주거지역";
    const before = structuredClone(input);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === "binding.geometry-hash")?.status).toBe("checked");
    expect(hashFor(input)).not.toBe(input.geometry!.geometryHash);
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)).toContainEqual(
      expect.objectContaining({ id: "binding.geometry-content", status: "fail" }));
    expect(input).toEqual(before);
  });

  it.each(["totalProgramAreaSqm", "totalGeometryAreaSqm", "preliminaryFarAreaSqm", "preliminaryFarPct", "preliminaryBcrPct"] as const)(
    "recomputes %s independently of the unchanged hash and pass flags", field => {
      const input = structuredClone(fixture);
      input.geometry!.building[field] += 0.5;
      const report = buildIntegratedVerification(input);
      expect(hashFor(input)).toBe(input.geometry!.geometryHash);
      for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)).toContainEqual(
        expect.objectContaining({ id: "binding.geometry-quantities", status: "fail" }));
      expect(report.approvalStatus).toBe("unverified");
    },
  );

  it.each(["visual-area", "programme-area"])("rejects invented %s even if a client recomputes all identity references", kind => {
    const input = structuredClone(fixture);
    if (kind === "visual-area") input.geometry!.building.floors[1].visualAreaSqm += 1;
    else input.geometry!.building.floors[1].programAreaSqm += 1;
    input.geometryHash = input.geometry!.geometryHash = hashFor(input);
    input.data.scenarios[0]._raw.program.areaContract!.geometrySource!.geometryHash = input.geometryHash;
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === "binding.geometry-content")?.status).toBe("checked");
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)).toContainEqual(
      expect.objectContaining({ id: "binding.geometry-quantities", status: "fail" }));
  });

  it.each(["floor-area", "summary", "zoning"])("marks absent %s evidence missing instead of accepting default zero", kind => {
    const input = structuredClone(fixture);
    if (kind === "floor-area") Reflect.deleteProperty(input.geometry!.building.floors[0], "visualAreaSqm");
    else if (kind === "summary") Reflect.deleteProperty(input.geometry!.building, "totalGeometryAreaSqm");
    else Reflect.deleteProperty(input.data.parcel, "zoning");
    const report = buildIntegratedVerification(input);
    const id = kind === "zoning" ? "binding.geometry-content" : "binding.geometry-quantities";
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)).toContainEqual(
      expect.objectContaining({ id, status: "missing" }));
  });
});
