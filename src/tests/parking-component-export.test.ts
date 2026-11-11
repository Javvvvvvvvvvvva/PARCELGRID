import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { buildCadastralContext } from "@/lib/geo/cadastral-context";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelIntersectionArea } from "@/lib/geo/parcel-topology-geometry";
import type { ParkingComponentLayout } from "@/lib/planning/parking-layout";
import { buildPlanningCadDxf } from "@/lib/planning/planning-cad-export";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { polygonAreaSqm, type LocalPlanPoint } from "@/lib/planning/planning-massing";
import { buildPlanningParkingGeometry } from "@/lib/planning/planning-parking-geometry";
import { buildSketchupDae, buildSketchupDaeExport } from "@/lib/planning/sketchup-dae-export";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";

const ORIGIN = [127.025749, 37.650511];
const GENERATED_AT = "2026-10-27T00:00:00.000Z";

function rectangle(x: number, z: number, width: number, depth: number): LocalPlanPoint[] {
  return [{ x, z }, { x: x + width, z }, { x: x + width, z: z + depth }, { x, z: z + depth }];
}

function toWgs84(ring: LocalPlanPoint[]): [number, number][] {
  const scale = 111_000 * Math.cos(ORIGIN[1] * Math.PI / 180);
  return ring.map(({ x, z }) => [ORIGIN[0] + x / scale, ORIGIN[1] - z / 111_000]);
}

function fixture() {
  const projectId = "component-export";
  const scenario = createBlankPlanningScenario({ projectId, name: "Component export" });
  scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 40, 1)])];
  scenario.parking = { strategy: "none", providedCars: 0 };
  const planningInput = {
    projectId, scenario, boundary: toWgs84(rectangle(-10, -10, 20, 20)),
    lotAreaSqm: 400, zoning: "제2종일반주거지역", roads: [],
    setback: { road: 0, side: 0, rear: 0 }, generatedAt: GENERATED_AT,
  };
  const planning = buildPlanningGeometry(planningInput).snapshot;
  const cadastral = buildCadastralContext({ planning, targetPnu: projectId, generatedAt: GENERATED_AT });
  const parking = buildPlanningParkingGeometry({
    scenario, planning, boundary: planningInput.boundary, roads: planningInput.roads,
    requiredCars: 0, generatedAt: GENERATED_AT,
  });
  const polygons: LocalParcelPolygon[] = [-20, 10].map((x) => ({
    outer: rectangle(x, -10, 20, 20), holes: [rectangle(x + 15, 4, 3, 3)],
  }));
  const components: ParkingComponentLayout[] = polygons.map((parcelPolygon, index) => {
    const x = parcelPolygon.outer[0].x;
    return {
      ...parking.layout,
      // These IDs collide after XML sanitization unless component indices are retained.
      id: index === 0 ? "west/surface" : "west?surface",
      source: index === 0 ? "surface" : "piloti",
      polygonIndex: index, parcelPolygon, frontage: null, accessStatus: "candidate", obstacles: [],
      supportedStrategy: true, capacityCars: 2, accessMode: "internal-aisle",
      targetShape: parcelPolygon.outer,
      stalls: [2, 5].map((offset, stallIndex) => ({
        id: `stall-${stallIndex + 1}`, source: "surface", componentId: index === 0 ? "west/surface" : "west?surface",
        polygonIndex: index, corners: rectangle(x + offset, -9, 2.5, 5),
        center: { x: x + offset + 1.25, z: -6.5 }, widthM: 2.5, depthM: 5, angleDeg: 0,
      })),
      aisleShape: rectangle(x + 2, -3, 12, 3), coreShape: rectangle(x + 2, 6, 3, 3),
      columns: Array.from({ length: index + 1 }, (_, i) => ({ x: x + 10 + i * 2, z: 6 })),
      entryPath: [{ x: 900, z: 900 }, { x: 910, z: 900 }],
      entryPaths: [
        { stallId: "stall-1", points: [{ x: x + 1, z: -10 }, { x: x + 1, z: -2 }, { x: x + 3, z: -2 }] },
        { stallId: "stall-2", points: [{ x: x + 6, z: -10 }, { x: x + 6, z: -8 }] },
      ],
    };
  });
  parking.layout = {
    ...parking.layout, components, source: "mixed", capacityCars: 4,
    stalls: components.flatMap((component) => component.stalls),
    aisleShape: [], coreShape: [], columns: [], entryPath: [],
  };
  // Exercise emitter source with a controlled snapshot; production topology remains gated.
  planning.parcel = { ...planning.parcel, polygon: [], polygons };
  const snapshot = () => buildSketchupExportPackage({ planning, parking, generatedAt: GENERATED_AT });
  return { planning, planningInput, cadastral, parking, polygons, components, snapshot };
}

interface Mesh {
  id: string;
  positions: number[][];
  faces: number[][];
}

function parseDae(text: string): Mesh[] {
  const document = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === "geometry" }).parse(text) as {
    COLLADA: { library_geometries: { geometry?: Array<{
      "@_id": string;
      mesh: { source: { float_array: { "#text": string } }; triangles: { p: string } };
    }> } };
  };
  return (document.COLLADA.library_geometries.geometry ?? []).map((geometry) => {
    const positions = geometry.mesh.source.float_array["#text"].split(/\s+/).map(Number);
    const indices = geometry.mesh.triangles.p.split(/\s+/).map(Number);
    expect(positions.every(Number.isFinite)).toBe(true);
    return {
      id: geometry["@_id"],
      positions: Array.from({ length: positions.length / 3 }, (_, i) => positions.slice(i * 3, i * 3 + 3)),
      faces: Array.from({ length: indices.length / 3 }, (_, i) => indices.slice(i * 3, i * 3 + 3)),
    };
  });
}

function parseDxf(text: string) {
  const lines = text.trim().split(/\r?\n/);
  const entities: Array<{ layer: string; closed: boolean; points: LocalPlanPoint[] }> = [];
  let entity: (typeof entities)[number] | undefined;
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]), value = lines[i + 1];
    if (code === 0) {
      entity = value === "LWPOLYLINE" ? { layer: "", closed: false, points: [] } : undefined;
      if (entity) entities.push(entity);
    }
    if (!entity) continue;
    if (code === 8) entity.layer = value;
    if (code === 70) entity.closed = Number(value) === 1;
    if (code === 10) entity.points.push({ x: Number(value), z: 0 });
    if (code === 20) entity.points[entity.points.length - 1].z = -Number(value) || 0;
  }
  return entities;
}

const PARKING_COUNTS = {
  PG_PARKING_STALLS: 4, PG_PARKING_AISLE: 2, PG_PARKING_CORE: 2,
  PG_PARKING_COLUMNS_REFERENCE: 3, PG_PARKING_ACCESS_REFERENCE: 4,
};

describe("component parking and target parcel exporter source", () => {
  it.each([0.4, 0.8])("exports every component object with matching identities/counts and column width %s", columnWidthM => {
    const input = fixture();
    input.parking.circulation.profile!.columnWidthM = columnWidthM;
    const basePackage = input.snapshot();
    const result = buildSketchupDaeExport(basePackage);
    const meshes = parseDae(result.daeText);
    const cad = buildPlanningCadDxf({ basePackage, cadastral: input.cadastral });
    const entities = parseDxf(cad.dxfText);
    expect(new Set(meshes.map((mesh) => mesh.id)).size).toBe(meshes.length);
    for (const [layer, count] of Object.entries(PARKING_COUNTS)) {
      expect(basePackage.layers.find((item) => item.name === layer)?.objectCount).toBe(count);
      expect(meshes.filter((mesh) => mesh.id.startsWith(`${layer}-`))).toHaveLength(count);
      expect(cad.entityCountByLayer[layer]).toBe(count);
    }
    const expectedShapes = {
      PG_PARKING_STALLS: input.components.flatMap((part) => part.stalls.map((stall) => stall.corners)),
      PG_PARKING_AISLE: input.components.map((part) => part.aisleShape),
      PG_PARKING_CORE: input.components.map((part) => part.coreShape),
      PG_PARKING_COLUMNS_REFERENCE: input.components.flatMap((part) => part.columns.map((point) =>
        rectangle(point.x - columnWidthM / 2, point.z - columnWidthM / 2, columnWidthM, columnWidthM))),
    };
    for (const [layer, shapes] of Object.entries(expectedShapes)) {
      const layerMeshes = meshes.filter((mesh) => mesh.id.startsWith(`${layer}-`));
      expect(entities.filter((entity) => entity.layer === layer).map((entity) => entity.points)).toEqual(
        shapes.map((ring) => ring.map(({ x, z }) => ({ x: Number(x.toFixed(6)), z: Number(z.toFixed(6)) })))
      );
      layerMeshes.forEach((mesh, index) => mesh.positions.forEach(([x, , z], vertex) => {
        expect(x).toBeCloseTo(shapes[index][vertex % 4].x, 10);
        expect(z).toBeCloseTo(shapes[index][vertex % 4].z, 10);
      }));
    }
    const paths = input.components.flatMap((part) => part.entryPaths);
    const access = entities.filter((entity) => entity.layer === "PG_PARKING_ACCESS_REFERENCE");
    expect(access.map((entity) => entity.points)).toEqual(paths.map((path) => path.points));
    expect(access.every((entity) => !entity.closed)).toBe(true);
    const accessMeshes = meshes.filter((mesh) => mesh.id.startsWith("PG_PARKING_ACCESS_REFERENCE-"));
    accessMeshes.forEach((mesh, index) => {
      expect(mesh.positions).toHaveLength((paths[index].points.length - 1) * 8);
      const xs = paths[index].points.map((point) => point.x);
      expect(mesh.positions.every(([x]) => x >= Math.min(...xs) - 0.1 && x <= Math.max(...xs) + 0.1)).toBe(true);
    });
    expect(JSON.parse(result.metadataText).parking.layout.components).toEqual(input.components);
  });

  it("triangulates all target components without capping holes and exports separate hole rings", () => {
    const input = fixture(), basePackage = input.snapshot();
    const terrain = parseDae(buildSketchupDae(basePackage)).filter((mesh) => mesh.id.startsWith("PG_PARCEL-"));
    expect(terrain).toHaveLength(2);
    expect(basePackage.layers.find((layer) => layer.name === "PG_PARCEL")?.objectCount).toBe(2);
    terrain.forEach((mesh, index) => {
      const part = input.polygons[index];
      const topFaces = mesh.faces.map((face) => face.map((vertex) => mesh.positions[vertex]))
        .filter((face) => face.every((point) => point[1] === 0));
      let area = 0;
      for (const face of topFaces) {
        const triangle = face.map(([x, , z]) => ({ x, z }));
        area += polygonAreaSqm(triangle);
        for (const hole of part.holes) {
          expect(localParcelIntersectionArea([{ outer: triangle, holes: [] }], [{ outer: hole, holes: [] }])).toBeCloseTo(0, 8);
        }
      }
      expect(area).toBeCloseTo(polygonAreaSqm(part.outer) - part.holes.reduce((sum, hole) => sum + polygonAreaSqm(hole), 0), 8);
      expect(mesh.positions).toHaveLength((part.outer.length + part.holes.flat().length) * 2);
    });
    const cad = buildPlanningCadDxf({ basePackage, cadastral: input.cadastral });
    const rings = parseDxf(cad.dxfText);
    expect(cad.entityCountByLayer.PG_PARCEL).toBe(2);
    expect(cad.entityCountByLayer.PG_PARCEL_HOLES).toBe(2);
    expect(cad.layers.find((layer) => layer.name === "PG_PARCEL_HOLES")?.defaultVisible).toBe(true);
    expect(rings.filter((ring) => ring.layer === "PG_PARCEL").map((ring) => ring.points)).toEqual(input.polygons.map((part) => part.outer));
    expect(rings.filter((ring) => ring.layer === "PG_PARCEL_HOLES").map((ring) => ring.points)).toEqual(input.polygons.flatMap((part) => part.holes));
  });

  it.each(["missing", "empty"])("uses singular parking only when components are missing: %s", (mode) => {
    const input = fixture();
    input.parking.layout = { ...input.parking.layout, ...input.components[0], components: [] };
    if (mode === "missing") Reflect.deleteProperty(input.parking.layout, "components");
    const basePackage = input.snapshot();
    const meshes = parseDae(buildSketchupDae(basePackage));
    const cad = buildPlanningCadDxf({ basePackage, cadastral: input.cadastral });
    const counts = mode === "missing" ? [2, 1, 1, 1, 1] : [0, 0, 0, 0, 0];
    Object.keys(PARKING_COUNTS).forEach((layer, index) => {
      expect(basePackage.layers.find((item) => item.name === layer)?.objectCount).toBe(counts[index]);
      expect(meshes.filter((mesh) => mesh.id.startsWith(`${layer}-`))).toHaveLength(counts[index]);
      expect(cad.entityCountByLayer[layer] ?? 0).toBe(counts[index]);
    });
  });

  it("ignores stale singular geometry when components and their entry paths are explicit", () => {
    const input = fixture();
    input.parking.layout.aisleShape = rectangle(800, 800, 20, 20);
    input.parking.layout.stalls.push({ ...input.components[0].stalls[0], id: "stale" });
    input.components.forEach((part) => { part.entryPaths = []; });
    const basePackage = input.snapshot();
    const meshes = parseDae(buildSketchupDae(basePackage));
    const cad = buildPlanningCadDxf({ basePackage, cadastral: input.cadastral });
    expect(meshes.filter((mesh) => mesh.id.startsWith("PG_PARKING_STALLS-"))).toHaveLength(4);
    expect(meshes.filter((mesh) => mesh.id.startsWith("PG_PARKING_AISLE-"))).toHaveLength(2);
    expect(meshes.some((mesh) => mesh.id.startsWith("PG_PARKING_ACCESS_REFERENCE-"))).toBe(false);
    expect(cad.entityCountByLayer.PG_PARKING_STALLS).toBe(4);
    expect(cad.entityCountByLayer.PG_PARKING_AISLE).toBe(2);
    expect(cad.entityCountByLayer.PG_PARKING_ACCESS_REFERENCE).toBeUndefined();
  });

  it.each(["missing", "empty"])("honors target polygon presence and keeps north geometry finite: %s", (mode) => {
    const input = fixture();
    input.planning.parcel.polygon = rectangle(-10, -10, 20, 20);
    input.planning.parcel.polygons = mode === "empty" ? [] : undefined;
    const basePackage = input.snapshot();
    const meshes = parseDae(buildSketchupDae(basePackage));
    const cad = buildPlanningCadDxf({ basePackage, cadastral: input.cadastral });
    const count = mode === "empty" ? 0 : 1;
    for (const layer of ["PG_PARCEL", "PG_NORTH"]) {
      expect(meshes.filter((mesh) => mesh.id.startsWith(`${layer}-`))).toHaveLength(count);
      expect(basePackage.layers.find((item) => item.name === layer)?.objectCount).toBe(count);
    }
    expect(cad.entityCountByLayer.PG_PARCEL ?? 0).toBe(count);
    expect(cad.entityCountByLayer.PG_NORTH ?? 0).toBe(count * 2);
    expect(cad.dxfText).not.toMatch(/NaN|Infinity/);
  });

  it("still blocks a complex target with mismatched recorded land area", () => {
    const input = fixture();
    const planning = buildPlanningGeometry({
      ...input.planningInput,
      boundaryPolygons: input.polygons.map((part) => ({ outer: toWgs84(part.outer), holes: part.holes.map(toWgs84) })),
    }).snapshot;
    expect(planning.validation.issues).toContainEqual(expect.objectContaining({ code: "parcel-area-mismatch", severity: "fail" }));
    const basePackage = buildSketchupExportPackage({ planning });
    expect(basePackage.validation.exportable).toBe(false);
    expect(() => buildSketchupDae(basePackage)).toThrow();
    expect(() => buildPlanningCadDxf({ basePackage, cadastral: input.cadastral })).toThrow();
  });
});
