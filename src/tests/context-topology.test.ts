import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCadastralContext, type CadastralParcelFeature } from "@/lib/geo/cadastral-context";
import { localParcelPolygons, type LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelArea, localParcelCoveredArea, validateLocalParcelTopology } from "@/lib/geo/parcel-topology-geometry";
import * as topology from "@/lib/geo/parcel-topology-geometry";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { buildContextParcelAlignment } from "@/lib/planning/context-parcel-alignment";
import { buildSiteDeliveryAudit } from "@/lib/planning/site-delivery-audit";

const origin: [number, number] = [127, 37];
const square = (x: number, z: number, width: number, depth = width) => [
  { x, z }, { x: x + width, z }, { x: x + width, z: z + depth }, { x, z: z + depth },
];
const toWgs = (ring: ReturnType<typeof square>): [number, number][] => ring.map(p => [origin[0] + p.x / (111000 * Math.cos(origin[1] * Math.PI / 180)), origin[1] - p.z / 111000]);
function planning(shape?: ReturnType<typeof square>) {
  const scenario = createBlankPlanningScenario({ projectId: "topology-test", name: "Synthetic topology" });
  scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 100, 1)])];
  const snapshot = buildPlanningGeometry({ projectId: "topology-test", scenario, boundary: toWgs(square(-10, -10, 20)),
    lotAreaSqm: 400, zoning: "일반상업지역", roads: [], setback: { road: 0, side: 0, rear: 0 } }).snapshot;
  if (shape) {
    const floor = { ...snapshot.building.floors[0], shape };
    snapshot.building.floors = [floor]; snapshot.building.aboveGroundFloors = [floor];
  }
  return snapshot;
}
const roadParts = (): LocalParcelPolygon[] => [
  { outer: square(10, -15, 10, 30), holes: [square(12, -5, 6, 10)] },
  { outer: square(30, -5, 5, 10), holes: [] },
];
function source(parts = roadParts(), road = true): CadastralParcelFeature {
  return { pnu: "synthetic-neighbor", jibun: "Synthetic", jimok: road ? "도로" : "대", jimokCode: road ? "14" : "08",
    lotAreaSqm: localParcelArea(parts), boundary: [], polygons: parts.map(part => ({ outer: toWgs(part.outer), holes: part.holes.map(toWgs) })),
    distanceM: 10, boundarySource: "continuous-cadastral" };
}
const context = (parts = roadParts(), shape?: ReturnType<typeof square>) => buildCadastralContext({ planning: planning(shape), targetPnu: "target", parcels: [source(parts)] });
afterEach(() => vi.restoreAllMocks());

describe("whole cadastral topology", () => {
  it("preserves two components and a hole, counts one parcel, and subtracts the hole from area", () => {
    const result = context();
    expect(result.roadParcels).toHaveLength(1);
    expect(result.roadParcels[0].polygon).toEqual([]);
    expect(result.roadParcels[0].polygons).toHaveLength(2);
    expect(result.roadParcels[0].polygons![0].holes).toHaveLength(1);
    expect(result.roadParcels[0].measuredAreaSqm).toBeCloseTo(290, 5);
  });
  it("stops road width at a hole and never bridges disconnected road parts", () => {
    const result = context();
    expect(result.summary.primaryWidthMinM).toBeCloseTo(2, 3);
    expect(result.summary.primaryWidthMaxM).toBeCloseTo(10, 3);
    expect(result.summary.primaryWidthAvgM).toBeCloseTo(5.2, 3);
    expect(result.frontages[0].widthSamples).toHaveLength(5);
  });
  it("finds the near second component even if the remote one comes first", () => {
    const result = context([...roadParts()].reverse());
    expect(result.summary.primaryWidthMinM).toBeCloseTo(2, 3);
  });
  it("does not report road intrusion for a floor wholly inside a road hole", () => {
    const result = context(roadParts(), square(13, -2, 4));
    expect(result.roadClearances[0].intrusionAreaSqm).toBe(0);
    expect(result.roadClearances[0].minimumClearanceM).toBeCloseTo(1, 3);
  });
  it("detects intrusion in the second component", () => {
    const result = context(roadParts(), square(31, -2, 3, 4));
    expect(result.roadClearances[0].intrusionAreaSqm).toBeCloseTo(12, 3);
    expect(result.roadClearances[0].minimumClearanceM).toBe(0);
    expect(result.validation.usable).toBe(false);
  });
  it("subtracts the hole when a floor spans both road and excluded area", () => {
    expect(context(roadParts(), square(11, -6, 8, 12)).roadClearances[0].intrusionAreaSqm).toBeCloseTo(36, 3);
  });
  it("hashes non-primary parts, holes and boundary provenance", () => {
    const baseline = context().cadastralHash;
    const parts = roadParts(); parts[1].outer[0].x += 1;
    expect(context(parts).cadastralHash).not.toBe(baseline);
    const holes = roadParts(); holes[0].holes[0][0].x += 1;
    expect(context(holes).cadastralHash).not.toBe(baseline);
    const planned = source(); planned.boundarySource = "upis-planned-road";
    const upis = buildCadastralContext({ planning: planning(), targetPnu: "target", parcels: [planned] });
    expect(upis.cadastralHash).not.toBe(baseline);
    expect(upis.frontages[0].widthSamples).toEqual([]);
    expect(upis.summary.primaryWidthMinM).toBeNull();
    expect(upis.summary.primaryPlannedWidthMinM).toBeCloseTo(2, 3);
  });
  it.each([
    [{ outer: square(0, 0, 10), holes: [square(9, 9, 4)] }],
    [{ outer: square(0, 0, 10), holes: [square(1, 1, 5), square(2, 2, 5)] }],
    [{ outer: square(0, 0, 10), holes: [square(1, 1, 7), square(2, 2, 1)] }],
    [{ outer: square(0, 0, 10), holes: [] }, { outer: square(5, 5, 10), holes: [] }],
    [],
  ].map(parts => ({ parts })))("rejects malformed topology without falling back to an outer ring %#", ({ parts }) => {
    expect(validateLocalParcelTopology(parts)).toBe(false);
    const feature = source(parts); feature.boundary = toWgs(square(0, 0, 10));
    const result = buildCadastralContext({ planning: planning(), targetPnu: "target", parcels: [feature] });
    expect(result.roadParcels).toEqual([]);
    expect(result.validation.usable).toBe(false);
  });
  it("supports an independent island inside another component's hole", () => {
    const parts = [{ outer: square(0, 0, 20), holes: [square(2, 2, 16)] }, { outer: square(5, 5, 5), holes: [] }];
    expect(validateLocalParcelTopology(parts)).toBe(true);
    expect(localParcelArea(parts)).toBe(169);
  });
  it("reports budget exhaustion as incomplete, not success or geometric impossibility", () => {
    const plan = planning();
    let clock = 0; vi.spyOn(performance, "now").mockImplementation(() => clock += 2100);
    const result = buildCadastralContext({ planning: plan, targetPnu: "target", parcels: [source()] });
    expect(result.validation.usable).toBe(false);
    expect(result.validation.issues).toContainEqual(expect.objectContaining({ code: "cadastral-time-limit" }));
    expect(result.summary.roadIntrusionCount).toBe(0);
  });
  it("keeps legacy single rings supported but never uses them instead of supplied empty topology", () => {
    const ring = square(0, 0, 10);
    expect(localParcelPolygons({ polygon: ring })).toEqual([{ outer: ring, holes: [] }]);
    expect(localParcelPolygons({ polygon: ring, polygons: [] })).toEqual([]);
  });
});

describe("context topology reconciliation", () => {
  it("does not double count overlapping parcel coverage", () => {
    const subject = [{ outer: square(0, 0, 10), holes: [] }];
    const covered = [[{ outer: square(0, 0, 5, 10), holes: [] }], [{ outer: square(2, 0, 3, 10), holes: [] }]];
    expect(localParcelCoveredArea(subject, covered)).toBe(50);
  });
  it.each([{ shape: square(13, -2, 4), status: "mismatch", coverage: 0 }, { shape: square(31, -2, 3, 4), status: "aligned", coverage: 100 }])("uses every parcel component/hole for building alignment: $status", ({ shape, status, coverage }) => {
    const plan = planning(), base = buildSketchupExportPackage({ planning: plan }).context;
    base.buildings = [{ id: "building", name: "Synthetic", polygons: [{ outer: shape, holes: [] }], sourceFootprintAreaSqm: 12,
      measuredFootprintAreaSqm: 12, groundFloors: 1, heightM: 3, heightSource: "registered-height", accuracy: "verified", source: "vworld-dt_d010" }];
    const cadastral = buildCadastralContext({ planning: plan, targetPnu: "target", parcels: [source(roadParts(), false)] });
    const alignment = buildContextParcelAlignment({ context: base, cadastral });
    expect(alignment.buildings[0].status).toBe(status);
    expect(alignment.buildings[0].coveragePct).toBe(coverage);
    cadastral.adjacentParcels[0].polygons = [];
    expect(buildContextParcelAlignment({ context: base, cadastral }).buildings[0]).toMatchObject({ status: "unavailable", coveragePct: null });
  });
  it.each(["continuous-cadastral", "upis-planned-road"] as const)("delivery audit preserves known %s intrusion from the same plan", boundarySource => {
    const plan = planning(square(31, -2, 3, 4));
    const base = buildSketchupExportPackage({ planning: plan }).context;
    const road = { ...source(), boundarySource };
    const cadastral = buildCadastralContext({ planning: plan, targetPnu: "target", parcels: [road] });
    const audit = buildSiteDeliveryAudit({ planning: plan, context: base, cadastral });
    expect(cadastral.roadClearances[0]).toMatchObject({ intrudes: true, intrusionAreaSqm: 12 });
    expect(cadastral.validation).toMatchObject({ usable: false, status: "fail" });
    expect(audit.roadOverlapFloorIds).toEqual([plan.building.floors[0].id]);
    expect(audit.checks.find(check => check.id === "context-topology")?.status).toBe("pass");
    expect(audit.checks.find(check => check.id === "road-overlap")).toMatchObject({ status: "fail", message: expect.stringContaining("1개 지상층") });
    expect(audit.exportable).toBe(false);

    const insideHole = planning(square(13, -2, 4));
    const holeCadastral = buildCadastralContext({ planning: insideHole, targetPnu: "target", parcels: [road] });
    const holeAudit = buildSiteDeliveryAudit({ planning: insideHole, context: base, cadastral: holeCadastral });
    expect(holeAudit.roadOverlapFloorIds).toEqual([]);
    expect(holeAudit.checks.find(check => check.id === "road-overlap")?.status).toBe("pass");
    expect(holeAudit.exportable).toBe(true);

    cadastral.roadParcels[0].polygons = [];
    const invalid = buildSiteDeliveryAudit({ planning: plan, context: base, cadastral });
    expect(invalid.exportable).toBe(false);
    expect(invalid.checks.find(check => check.id === "context-topology")?.status).toBe("fail");
    expect(invalid.checks.find(check => check.id === "road-overlap")?.status).toBe("fail");
  });

  it.each(["cadastral-time-limit", "cadastral-invalid-parcel", "cadastral-topology-calculation-failed", "unknown-failure"])("does not promote %s to complete geometry even alongside known intrusion", code => {
    const plan = planning(square(31, -2, 3, 4));
    const base = buildSketchupExportPackage({ planning: plan }).context;
    const cadastral = buildCadastralContext({ planning: plan, targetPnu: "target", parcels: [source()] });
    cadastral.validation.issues.push({ code, severity: "fail", message: "Synthetic incomplete source" });

    const audit = buildSiteDeliveryAudit({ planning: plan, context: base, cadastral });

    expect(audit.exportable).toBe(false);
    expect(audit.checks.find(check => check.id === "context-topology")?.status).toBe("fail");
    expect(audit.checks.find(check => check.id === "road-overlap")?.status).toBe("fail");
  });

  it("keeps unexplained rejected cadastral snapshots incomplete", () => {
    const plan = planning(), base = buildSketchupExportPackage({ planning: plan }).context;
    const cadastral = context();
    cadastral.validation = { usable: false, status: "fail", issues: [] };

    const audit = buildSiteDeliveryAudit({ planning: plan, context: base, cadastral });

    expect(audit.exportable).toBe(false);
    expect(audit.checks.find(check => check.id === "context-topology")?.status).toBe("fail");
  });

  it("blocks an audit that times out during topology validation", () => {
    const plan = planning(), base = buildSketchupExportPackage({ planning: plan }).context;
    const cadastral = context();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const validate = topology.validateLocalParcelTopology;
    const validation = vi.spyOn(topology, "validateLocalParcelTopology").mockImplementation((polygons, checkDeadline) => {
      expect(checkDeadline).toBeTypeOf("function");
      now = 2_000;
      return validate(polygons, checkDeadline);
    });

    const audit = buildSiteDeliveryAudit({ planning: plan, context: base, cadastral });

    expect(validation).toHaveBeenCalledOnce();
    expect(audit.exportable).toBe(false);
    expect(audit.checks.find(check => check.id === "context-topology")?.status).toBe("fail");
  });

  it("retains completed floor overlaps when a later intersection exceeds the audit budget", () => {
    const plan = planning(square(31, -2, 3, 4));
    const first = plan.building.floors[0];
    const second = { ...first, id: "second-floor", level: 2 };
    const third = { ...first, id: "third-floor", level: 3 };
    plan.building.floors = [first, second, third];
    plan.building.aboveGroundFloors = plan.building.floors;
    const base = buildSketchupExportPackage({ planning: plan }).context;
    const cadastral = buildCadastralContext({ planning: plan, targetPnu: "target", parcels: [source()] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const intersect = topology.localParcelIntersectionArea;
    let intersections = 0;
    const calculation = vi.spyOn(topology, "localParcelIntersectionArea").mockImplementation((...args) => {
      const result = intersect(...args);
      now = ++intersections === 1 ? 1_500 : 2_000;
      return result;
    });

    const audit = buildSiteDeliveryAudit({ planning: plan, context: base, cadastral });

    expect(calculation).toHaveBeenCalledTimes(2);
    expect(audit.roadOverlapFloorIds).toEqual([first.id]);
    expect(audit.exportable).toBe(false);
    expect(audit.checks.find(check => check.id === "context-topology")?.status).toBe("fail");
    expect(audit.checks.find(check => check.id === "road-overlap")?.status).toBe("fail");
  });
});
