import { describe, expect, it, vi } from "vitest";
import { XMLParser } from "fast-xml-parser";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { buildCadastralContext, buildCadastralContextSnapshot, cadastralFrontageIdentity, type CadastralParcelFeature } from "@/lib/geo/cadastral-context";
import { localParcelPolygons, type Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelArea, localParcelIntersectionArea } from "@/lib/geo/parcel-topology-geometry";
import { projectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { buildCadastralDxf, buildCadastralGeoJson, buildCadastralLineworkPackage } from "@/lib/planning/cadastral-linework-export";
import { buildPlanningCadDxf, buildPlanningCadPackage } from "@/lib/planning/planning-cad-export";
import { buildSiteDeliveryAudit } from "@/lib/planning/site-delivery-audit";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { buildSiteContextDae, buildSketchupSiteExport } from "@/lib/planning/sketchup-site-export";
import { buildSketchupSiteDeliveryExport } from "@/lib/planning/sketchup-site-delivery-export";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";

const ORIGIN: [number, number] = [127, 37.65];
const SCALE = 111_000 * Math.cos(ORIGIN[1] * Math.PI / 180);
const GENERATED_AT = "2026-10-28T00:00:00.000Z";
const rectangle = (x: number, z: number, w: number, h: number): [number, number][] =>
  [[x, z], [x + w, z], [x + w, z + h], [x, z + h]]
    .map(([px, pz]) => [ORIGIN[0] + px / SCALE, ORIGIN[1] - pz / 111_000]);
const target = (): Wgs84ParcelPolygon[] => [
  { outer: rectangle(-20, -10, 20, 20), holes: [rectangle(-18, -8, 3, 3), rectangle(-8, 5, 3, 2)] },
  { outer: rectangle(20, -6, 12, 12), holes: [rectangle(22, -4, 2, 2)] },
];
function road(polygons: Wgs84ParcelPolygon[]): CadastralParcelFeature {
  return { pnu: "road", jibun: "road", jimok: "도로", jimokCode: "14", distanceM: 0, lotAreaSqm: 88,
    boundary: [], polygons, boundarySource: "continuous-cadastral" };
}

function fixture(targetBoundaryPolygons = target(), sourceParcels = [road([
  { outer: rectangle(80, 0, 4, 4), holes: [] },
  { outer: rectangle(32, -6, 6, 12), holes: [] },
])]) {
  const scenario = createBlankPlanningScenario({ projectId: "target-topology", name: "Target topology" });
  scenario.id = "target-topology-scenario";
  scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("office", 20)])];
  scenario.placement = { rotationDeg: 0, offsetXM: 0, offsetZM: 0, roadSetbackM: 0, northSetbackM: 0 };
  const planning = buildPlanningGeometry({ projectId: "target-topology", scenario,
    boundaryPolygons: targetBoundaryPolygons,
    lotAreaSqm: localParcelArea(projectParcelPolygons(targetBoundaryPolygons, ORIGIN)),
    zoning: "일반상업지역", setback: { road: 0, side: 0, rear: 0 }, generatedAt: GENERATED_AT,
  }).snapshot;
  const basePackage = buildSketchupExportPackage({ planning, generatedAt: GENERATED_AT });
  const cadastral = buildCadastralContextSnapshot({ planning, targetPnu: "target", targetBoundaryPolygons,
    parcels: sourceParcels, generatedAt: GENERATED_AT });
  return { basePackage, cadastral, targetBoundaryPolygons, sourceParcels, targetBoundary: rectangle(-20, -10, 20, 20) };
}

function packagedExports(input: ReturnType<typeof fixture>) {
  return [
    () => buildCadastralGeoJson({ ...input, snapshot: input.cadastral }),
    () => buildCadastralLineworkPackage({ ...input, snapshot: input.cadastral }),
    () => buildPlanningCadPackage(input),
    () => buildSketchupSiteExport(input),
    () => buildSketchupSiteDeliveryExport(input),
  ];
}

function zipTexts(bytes: Uint8Array): Map<string, string> {
  const files = new Map<string, string>(), decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    expect(view.getUint16(8, true)).toBe(0);
    const size = view.getUint32(18, true), nameLength = view.getUint16(26, true), extraLength = view.getUint16(28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    offset += 30 + nameLength + extraLength;
    files.set(name, decoder.decode(bytes.subarray(offset, offset + size)));
    offset += size;
  }
  return files;
}

function dxfRings(text: string, layer: string) {
  return text.split("0\nLWPOLYLINE\n").slice(1).filter(entity => entity.startsWith(`8\n${layer}\n`)).map(entity => {
    const lines = entity.split("\n"), ring: { x: number; z: number }[] = [];
    for (let i = 0; i < lines.length - 1; i += 2) {
      if (lines[i] === "0") break;
      if (lines[i] === "10") ring.push({ x: Number(lines[i + 1]), z: NaN });
      if (lines[i] === "20") ring[ring.length - 1].z = -Number(lines[i + 1]);
    }
    return ring;
  });
}

function assertTargetDae(text: string, input: ReturnType<typeof fixture>) {
  const document = new XMLParser({ ignoreAttributes: false, isArray: name => name === "geometry" }).parse(text) as {
    COLLADA: { library_geometries: { geometry: Array<{ "@_id": string; mesh: {
      source: { float_array: { "#text": string } }; triangles: { p: string };
    } }> } };
  };
  const geometries = document.COLLADA.library_geometries.geometry.filter(mesh => mesh["@_id"].startsWith("PG_PARCEL-"));
  const parts = localParcelPolygons(input.cadastral.targetParcel);
  expect(geometries).toHaveLength(parts.length);
  geometries.forEach((geometry, partIndex) => {
    const floats = geometry.mesh.source.float_array["#text"].split(/\s+/).map(Number);
    const faces = geometry.mesh.triangles.p.split(/\s+/).map(Number);
    expect(floats.every(Number.isFinite)).toBe(true);
    let topArea = 0;
    for (let i = 0; i < faces.length; i += 3) {
      const triangle = faces.slice(i, i + 3).map(index => ({ x: floats[index * 3], y: floats[index * 3 + 1], z: floats[index * 3 + 2] }));
      if (!triangle.every(point => point.y === 0)) continue;
      const area = localParcelArea([{ outer: triangle, holes: [] }]);
      topArea += area;
      for (const hole of parts[partIndex].holes) {
        expect(localParcelIntersectionArea([{ outer: triangle, holes: [] }], [{ outer: hole, holes: [] }])).toBeLessThan(1e-6);
      }
    }
    expect(topArea).toBeCloseTo(localParcelArea([parts[partIndex]]), 3);
  });
}

describe("bounded full target cadastral topology", () => {
  it("preserves target components, holes, net area, ownership and second-component frontage identities", () => {
    const input = fixture();
    const before = structuredClone(input.cadastral.targetParcel);
    expect(input.cadastral.validation.usable).toBe(true);
    expect(input.cadastral.targetParcel.polygon).toEqual([]);
    expect(input.cadastral.targetParcel.polygons?.map(part => part.holes.length)).toEqual([2, 1]);
    expect(input.cadastral.targetParcel.measuredAreaSqm).toBeCloseTo(525, 3);
    expect(input.cadastral.frontages[0]).toMatchObject({ targetPolygonIndex: 1, targetRingIndex: 0, targetEdgeIndex: 1,
      roadPolygonIndex: 1, roadRingIndex: 0, roadEdgeIndex: 3, widthMinM: 6 });
    expect(buildSiteDeliveryAudit({ planning: input.basePackage.planning, context: input.basePackage.context, cadastral: input.cadastral }).exportable).toBe(true);
    const inherited = buildCadastralContext({ planning: input.basePackage.planning, targetPnu: "target", parcels: input.sourceParcels });
    expect(inherited.targetParcel).toEqual(before);
    input.basePackage.planning.parcel.polygons![1].outer[0].x += 1;
    input.targetBoundaryPolygons[0].holes.pop();
    expect(input.cadastral.targetParcel).toEqual(before);
    expect(inherited.targetParcel).toEqual(before);
  });

  it("measures into a target hole and preserves the target hole's ring identity", () => {
    const input = fixture([{ outer: rectangle(-20, -20, 40, 40), holes: [rectangle(-6, -6, 12, 12)] }], [road([
      { outer: rectangle(80, 0, 4, 4), holes: [] },
      { outer: rectangle(-6, -6, 12, 12), holes: [rectangle(-3, -3, 6, 6)] },
    ])]);
    expect(input.cadastral.frontages[0]).toMatchObject({ targetPolygonIndex: 0, targetRingIndex: 1,
      roadPolygonIndex: 1, roadRingIndex: 0, widthMinM: 3, status: "verified-cadastral-width" });
  });

  it("retains the road hole ring identity when the target is inside an exclusion", () => {
    const input = fixture([{ outer: rectangle(-10, -10, 20, 20), holes: [] }], [road([
      { outer: rectangle(-16, -16, 32, 32), holes: [rectangle(-10, -10, 20, 20)] },
    ])]);
    expect(input.cadastral.frontages[0]).toMatchObject({ targetPolygonIndex: 0, targetRingIndex: 0,
      roadPolygonIndex: 0, roadRingIndex: 1, widthMinM: 6, status: "verified-cadastral-width" });
  });

  it("includes the full target in identity even with no neighboring sources or frontages", () => {
    const input = fixture(target(), []);
    const changed = structuredClone(input.basePackage.planning);
    changed.parcel.polygons![1].holes[0][0].x += 0.25;
    const next = buildCadastralContext({ planning: changed, targetPnu: "target" });
    expect(next.validation.usable).toBe(true);
    expect(next.cadastralHash).not.toBe(input.cadastral.cadastralHash);
  });

  it.each(["component", "hole", "component-order", "hole-order", "vertex-order"])("binds changed/reordered target identity: %s", mutation => {
    const input = fixture(), changed = structuredClone(input.targetBoundaryPolygons);
    if (mutation === "component") changed[1].outer[1][0] += 1 / SCALE;
    if (mutation === "hole") changed[0].holes[0][1][0] += 0.2 / SCALE;
    if (mutation === "component-order") changed.reverse();
    if (mutation === "hole-order") changed[0].holes.reverse();
    if (mutation === "vertex-order") changed[0].outer.push(changed[0].outer.shift()!);
    for (const build of packagedExports({ ...input, targetBoundaryPolygons: changed })) expect(build).toThrow();
    const stale = buildCadastralContext({ planning: input.basePackage.planning, targetPnu: "target", targetBoundaryPolygons: changed });
    expect(stale.validation.issues).toContainEqual(expect.objectContaining({ code: "cadastral-target-source-mismatch", severity: "fail" }));
    const changedPlan = structuredClone(input.basePackage.planning);
    changedPlan.parcel.polygons = projectParcelPolygons(changed, changedPlan.coordinateSystem.originLngLat);
    const rebuilt = buildCadastralContext({ planning: changedPlan, targetPnu: "target", targetBoundaryPolygons: changed, parcels: input.sourceParcels });
    expect(rebuilt.validation.usable).toBe(true);
    expect(rebuilt.cadastralHash).not.toBe(input.cadastral.cadastralHash);
    expect(buildSiteDeliveryAudit({ planning: changedPlan, context: input.basePackage.context, cadastral: input.cadastral }).summary.parcelBoundaryMatches).toBe(false);
    const originalSite = JSON.parse(buildSketchupSiteExport(input).metadataText);
    const changedSite = JSON.parse(buildSketchupSiteExport({ ...input, targetBoundaryPolygons: changed, cadastral: rebuilt,
      basePackage: { ...input.basePackage, planning: changedPlan } }).metadataText);
    expect(changedSite.siteHash).not.toBe(originalSite.siteHash);
  });

  it.each([[], null, [{ outer: rectangle(0, 0, 5, 5), holes: [rectangle(10, 10, 1, 1)] }],
    [{ outer: [[Infinity, 37], [127, 37], [127, 38]], holes: [] }],
    [{ outer: rectangle(0, 0, 5, 5), holes: null }], Array.from({ length: 201 }, () => ({ outer: rectangle(0, 0, 5, 5), holes: [] })),
  ].map(value => ({ value })))("rejects authoritative invalid target without a valid legacy fallback %#", ({ value }) => {
    const input = fixture(), targetBoundaryPolygons = value as Wgs84ParcelPolygon[];
    for (const build of packagedExports({ ...input, targetBoundaryPolygons })) expect(build).toThrow();
    const cadastral = buildCadastralContext({ planning: input.basePackage.planning, targetPnu: "target",
      targetBoundary: input.targetBoundary, targetBoundaryPolygons, parcels: input.sourceParcels });
    expect(cadastral.validation.usable).toBe(false);
    expect(cadastral.targetParcel).toMatchObject({ polygon: [], polygons: [], measuredAreaSqm: 0 });
    expect(cadastral.frontages).toEqual([]);
    const forged = structuredClone(input.cadastral);
    forged.targetParcel.polygons = [];
    forged.targetParcel.polygon = input.basePackage.planning.parcel.polygons![0].outer;
    expect(() => buildCadastralDxf(forged)).toThrow();
    expect(buildSiteDeliveryAudit({ planning: input.basePackage.planning, context: input.basePackage.context, cadastral: forged }).exportable).toBe(false);
  });

  it("does not ignore invalid inherited planning topology or accept two empty legacy rings", () => {
    const input = fixture();
    input.basePackage.planning.parcel.polygons = [];
    const inherited = buildCadastralContext({ planning: input.basePackage.planning, targetPnu: "target" });
    expect(inherited.validation.usable).toBe(false);
    delete input.basePackage.planning.parcel.polygons;
    delete inherited.targetParcel.polygons;
    expect(buildSiteDeliveryAudit({ planning: input.basePackage.planning, context: input.basePackage.context, cadastral: inherited }).summary.parcelBoundaryMatches).toBe(false);
  });

  it("fails closed when the shared cadastral validation deadline expires", () => {
    const input = fixture();
    let elapsed = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => elapsed += 1001);
    try {
      const result = buildCadastralContext({ planning: input.basePackage.planning, targetPnu: "target", targetBoundaryPolygons: input.targetBoundaryPolygons });
      expect(result.validation.usable).toBe(false);
      expect(() => buildCadastralGeoJson({ ...input, snapshot: input.cadastral })).toThrow();
      expect(buildSiteDeliveryAudit({ planning: input.basePackage.planning, context: input.basePackage.context, cadastral: input.cadastral }).exportable).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it("exports the production complex target without overriding validation or granting approvals", () => {
    const input = fixture(target(), []);
    expect(input.basePackage.validation.exportable).toBe(true);
    expect(() => buildSketchupSiteDeliveryExport(input)).not.toThrow();
    expect(() => buildPlanningCadPackage(input)).not.toThrow();
    expect(input.basePackage.planning.sourceNotes.join(" ")).toContain("공식 경계");
  });
});

describe("full target production export payloads", () => {
  it("accepts full sources without the optional legacy boundary in every production package", () => {
    const input = { ...fixture(), targetBoundary: undefined };
    expect(() => buildCadastralLineworkPackage({ ...input, snapshot: input.cadastral })).not.toThrow();
    expect(() => buildPlanningCadPackage(input)).not.toThrow();
    expect(() => buildSketchupSiteExport(input)).not.toThrow();
    expect(() => buildSketchupSiteDeliveryExport(input)).not.toThrow();
  });

  it.each([target(), [{ outer: rectangle(-20, -20, 40, 40), holes: [rectangle(-18, -18, 3, 3), rectangle(12, 12, 3, 3)] }]]
    .map(parts => ({ parts })))("exports every target outer and hole through GeoJSON, both DXFs and combined/clean DAE %#", ({ parts }) => {
    const input = fixture(parts);
    const linework = buildCadastralLineworkPackage({ ...input, snapshot: input.cadastral });
    const audit = buildSiteDeliveryAudit({ planning: input.basePackage.planning, context: input.basePackage.context, cadastral: input.cadastral });
    expect(audit.exportable, JSON.stringify(audit)).toBe(true);
    const cad = buildPlanningCadPackage(input);
    const delivery = buildSketchupSiteDeliveryExport(input);
    const zip = zipTexts(delivery.zipBytes);
    const texts = [linework.geojsonText, cad.geojsonText, zip.get(delivery.geojsonFilename)!];
    for (const text of texts) {
      const geojson = JSON.parse(text) as FeatureCollection<Polygon | MultiPolygon>;
      const feature = geojson.features[0];
      expect(feature.geometry.type).toBe(parts.length > 1 ? "MultiPolygon" : "Polygon");
      const coordinates = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [feature.geometry.coordinates];
      expect(coordinates.map(rings => rings.length)).toEqual(parts.map(part => part.holes.length + 1));
      const roundtrip = coordinates.map(rings => ({ outer: rings[0] as [number, number][], holes: rings.slice(1) as [number, number][][] }));
      expect(localParcelArea(projectParcelPolygons(roundtrip, input.cadastral.coordinateSystem.originLngLat)))
        .toBeCloseTo(input.cadastral.targetParcel.measuredAreaSqm!, 3);
      expect(feature.properties).toMatchObject({ pnu: "target", topologyScope: "all-components-and-holes" });
      if (input.cadastral.frontages.length) expect(geojson.features.find(feature => feature.properties?.layer === "PG_FRONTAGE")?.properties)
        .toMatchObject(cadastralFrontageIdentity(input.cadastral.frontages[0]));
    }
    for (const [text, layer] of [[linework.dxfText, "PG_SITE_BOUNDARY"], [cad.dxfText, "PG_PARCEL"], [zip.get(delivery.dxfFilename)!, "PG_SITE_BOUNDARY"]]) {
      const outers = dxfRings(text, layer), holes = dxfRings(text, `${layer}_HOLES`);
      expect(outers).toHaveLength(parts.length);
      expect(holes).toHaveLength(parts.reduce((sum, part) => sum + part.holes.length, 0));
      expect(localParcelArea(outers.map(outer => ({ outer, holes: [] }))) - localParcelArea(holes.map(outer => ({ outer, holes: [] }))))
        .toBeCloseTo(input.cadastral.targetParcel.measuredAreaSqm!, 3);
      if (input.cadastral.frontages.length) expect(text).toContain(JSON.stringify(cadastralFrontageIdentity(input.cadastral.frontages[0])));
    }
    assertTargetDae(delivery.combinedDaeText, input);
    assertTargetDae(delivery.cleanDaeText, input);
    expect(zip.get(delivery.combinedDaeFilename)).toBe(delivery.combinedDaeText);
    expect(zip.get(delivery.cleanDaeFilename)).toBe(delivery.cleanDaeText);
    for (const text of [linework.metadataText, cad.metadataText, delivery.metadataText]) {
      const metadata = JSON.parse(text);
      expect(metadata.sourceBinding).toBe("validated-snapshot");
      expect(metadata.targetParcel).toEqual(input.cadastral.targetParcel);
      expect(metadata.frontages).toEqual(input.cadastral.frontages);
      expect(metadata.topologyScope.target).toBe("all-components-and-holes");
    }
    expect(buildPlanningCadDxf(input).entityCountByLayer.PG_PARCEL).toBe(parts.length);
    expect(buildSiteContextDae({ ...input, siteHash: "test" })).toContain("<frontage_identities>");
  });

  it("rejects stale or missing complex frontage identities across standalone and packaged exports", () => {
    for (const mutation of ["target-ring", "target-edge", "road-ring", "road-edge", "missing"] as const) {
      const input = fixture(), frontage = input.cadastral.frontages[0];
      if (mutation === "target-ring") frontage.targetRingIndex = 1;
      if (mutation === "target-edge") frontage.targetEdgeIndex = 0;
      if (mutation === "road-ring") frontage.roadRingIndex = 4;
      if (mutation === "road-edge") frontage.roadEdgeIndex = 1;
      if (mutation === "missing") {
        delete frontage.targetPolygonIndex; delete frontage.targetRingIndex;
        delete frontage.roadPolygonIndex; delete frontage.roadRingIndex; delete frontage.roadEdgeIndex;
      }
      expect(() => buildCadastralDxf(input.cadastral)).toThrow();
      expect(() => buildSiteContextDae({ ...input, siteHash: "test" })).toThrow();
      for (const build of packagedExports(input)) expect(build).toThrow();
    }
  });
});
