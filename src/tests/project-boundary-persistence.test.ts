import { describe, expect, it } from "vitest";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { createProjectTransferBundle, parseProjectTransferBundle, serializeProjectTransferBundle } from "@/lib/handoff/project-transfer";
import { hashProjectWorkspacePayload, validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";

const projectId = "boundary-persistence";
const ring = (x: number, y: number, size = 0.0001): [number, number][] =>
  [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
const outer = ring(127, 37), other = ring(127.0003, 37);
const polygons: Wgs84ParcelPolygon[] = [
  { outer, holes: [ring(127.00003, 37.00003, 0.00002)] },
  { outer: other, holes: [] },
];

function fixture(boundary: object) {
  const payload = projectWorkspaceFixture(projectId);
  Object.assign(payload.projectData.parcel, boundary);
  return payload;
}

function transfer(payload: ReturnType<typeof fixture>) {
  return parseProjectTransferBundle(serializeProjectTransferBundle(createProjectTransferBundle({
    projectId, payload: { ...payload, expertReviews: {} },
  })), projectId);
}

describe("full boundary preservation at storage and transfer boundaries", () => {
  it("preserves every component and hole without creating approvals or changing adopted numbers", async () => {
    const payload = fixture({ boundary: [], boundaryPolygons: polygons });
    const before = JSON.stringify(payload);
    const restored = validateProjectWorkspacePayload(JSON.parse(before), projectId);
    expect(restored.valid).toBe(true);
    expect(restored.payload?.projectData.parcel.boundaryPolygons).toEqual(polygons);
    expect(restored.payload?.projectData.parcel.lotArea).toBe(320);
    expect(restored.payload?.representativeGeometry).toBeNull();
    expect(restored.payload?.stage3Snapshot).toBeNull();
    const imported = transfer(payload);
    expect(imported.valid).toBe(true);
    expect(imported.bundle?.payload.projectData?.parcel.boundaryPolygons).toEqual(polygons);
    expect(imported.bundle?.payload.expertReviews).toEqual({});
    expect(JSON.stringify(payload)).toBe(before);
    const changed = structuredClone(payload);
    changed.projectData.parcel.boundaryPolygons![0].holes[0][0][0] += 0.000001;
    expect(await hashProjectWorkspacePayload(changed)).not.toBe(await hashProjectWorkspacePayload(payload));
  });

  it.each([{}, { boundary: [] }, { boundary: outer }, { boundaryPolygons: [{ outer, holes: [] }] }])(
    "retains absent or valid legacy/source geometry: %j", source => {
      const payload = fixture(source);
      expect(validateProjectWorkspacePayload(payload, projectId).valid).toBe(true);
      expect(transfer(payload).valid).toBe(true);
    });

  it.each([
    { boundary: outer, boundaryPolygons: [] },
    { boundary: outer, boundaryPolygons: null },
    { boundary: outer, boundaryPolygons: polygons },
    { boundary: outer, boundaryPolygons: [{ outer: other, holes: [] }] },
    { boundary: null },
    { boundary: { length: 0 } },
    { boundary: [outer[0], outer[2], outer[1], outer[3]] },
    { boundary: [["127", 37], ...outer.slice(1)] },
    { boundaryPolygons: [{ outer, holes: [other] }] },
    { boundaryPolygons: [{ outer, holes: [] }, { outer, holes: [] }] },
    { boundaryPolygons: Array.from({ length: 201 }, () => ({ outer, holes: [] })) },
  ])("rejects malformed authoritative geometry before hydration/import: %j", source => {
    const payload = fixture(source);
    const stored = validateProjectWorkspacePayload(payload, projectId);
    expect(stored.valid).toBe(false);
    expect(stored.errors.join(" ")).toContain("부지 경계");
    const imported = transfer(payload);
    expect(imported.valid).toBe(false);
    expect(imported.errors.join(" ")).toContain("부지 경계");
    expect(imported.bundle).toBeNull();
  });

  it("reports a missing parcel in a checksum-valid transfer without throwing", () => {
    const payload = fixture({});
    payload.projectData.parcel = null as unknown as typeof payload.projectData.parcel;
    expect(() => transfer(payload)).not.toThrow();
    expect(transfer(payload)).toMatchObject({ valid: false, bundle: null });
  });
});
