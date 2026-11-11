import { describe, expect, it, vi } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { featureCollection, intersect, polygon } from "@turf/turf";
import { Vector3 } from "three";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  buildCadastralContext,
  type CadastralParcelFeature,
  type LocalCadastralParcel,
} from "@/lib/geo/cadastral-context";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import * as topologyGeometry from "@/lib/geo/parcel-topology-geometry";
import {
  buildCadastralDxf,
  buildCadastralGeoJson,
  buildCadastralLineworkPackage,
} from "@/lib/planning/cadastral-linework-export";
import { buildPlanningCadDxf, buildPlanningCadPackage } from "@/lib/planning/planning-cad-export";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { buildSiteContextDae, buildSketchupSiteExport } from "@/lib/planning/sketchup-site-export";

const ORIGIN: [number, number] = [127.025749, 37.650511];
const GENERATED_AT = "2026-10-27T00:00:00.000Z";
const LNG_SCALE = 111_000 * Math.cos(ORIGIN[1] * Math.PI / 180);

function rectangle(x: number, z: number, width: number, depth: number): LocalPlanPoint[] {
  return [{ x, z }, { x: x + width, z }, { x: x + width, z: z + depth }, { x, z: z + depth }];
}

function toWgs84(ring: LocalPlanPoint[]): [number, number][] {
  return ring.map(({ x, z }) => [ORIGIN[0] + x / LNG_SCALE, ORIGIN[1] - z / 111_000]);
}

function signedArea(ring: number[][]): number {
  const [x, y] = ring[0];
  return ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + (point[0] - x) * (next[1] - y) - (next[0] - x) * (point[1] - y);
  }, 0) / 2;
}

function coordinates(ring: LocalPlanPoint[]): number[][] {
  return ring.map(({ x, z }) => [x, z]);
}

function parts(z = 0): LocalParcelPolygon[] {
  return [
    { outer: rectangle(20, z, 12, 10), holes: [rectangle(22, z + 2, 3, 3), rectangle(27, z + 6, 3, 2)] },
    { outer: rectangle(40, z, 6, 6), holes: [rectangle(41, z + 1, 2, 2)] },
  ];
}

function fixture() {
  const projectId = "topology-export";
  const targetBoundary = toWgs84(rectangle(-10, -10, 20, 20));
  const scenario = createBlankPlanningScenario({ projectId, name: "Topology export" });
  scenario.id = "topology-scenario";
  scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 80, 1)])];
  const planning = buildPlanningGeometry({
    projectId,
    scenario,
    boundary: targetBoundary,
    lotAreaSqm: 400,
    zoning: "제2종일반주거지역",
    roads: [],
    setback: { road: 0, side: 0, rear: 0 },
    generatedAt: GENERATED_AT,
  }).snapshot;
  const basePackage = buildSketchupExportPackage({ planning, generatedAt: GENERATED_AT });
  const sourceParcels: CadastralParcelFeature[] = ["adjacent", "cadastral", "upis"].map((pnu, index) => ({
    pnu,
    jibun: pnu,
    jimok: index === 0 ? "대" : "도로",
    // Explicit provenance must win even when the legacy code suggests the opposite.
    jimokCode: index === 1 ? "UPIS-UQ151" : "08",
    boundarySource: index === 2 ? "upis-planned-road" : "continuous-cadastral",
    lotAreaSqm: 137,
    distanceM: 20,
    boundary: [],
    polygons: parts(index * 30).map((part) => ({ outer: toWgs84(part.outer), holes: part.holes.map(toWgs84) })),
  }));
  const localParcels: LocalCadastralParcel[] = sourceParcels.map((source, index) => ({
    pnu: source.pnu,
    jibun: source.jibun,
    jimok: source.jimok,
    jimokCode: source.jimokCode,
    boundarySource: source.boundarySource,
    source: "VWorld LP_PA_CBND_BUBUN",
    officialAreaSqm: 137,
    measuredAreaSqm: 137,
    distanceM: 20,
    polygon: [],
    polygons: parts(index * 30),
  }));
  const cadastral = buildCadastralContext({ planning, targetPnu: "target", generatedAt: GENERATED_AT });
  cadastral.adjacentParcels = [localParcels[0]];
  cadastral.roadParcels = localParcels.slice(1);
  return { basePackage, cadastral, sourceParcels, targetBoundary };
}

interface DxfPolyline {
  layer: string;
  closed: boolean;
  count: number;
  points: number[][];
}

function parseDxf(text: string): DxfPolyline[] {
  const lines = text.trim().split(/\r?\n/);
  const polylines: DxfPolyline[] = [];
  let current: DxfPolyline | undefined;
  for (let index = 0; index < lines.length; index += 2) {
    const code = Number(lines[index]);
    const value = lines[index + 1];
    if (code === 0) {
      current = value === "LWPOLYLINE" ? { layer: "", closed: false, count: 0, points: [] } : undefined;
      if (current) polylines.push(current);
    }
    if (!current) continue;
    if (code === 8) current.layer = value;
    if (code === 70) current.closed = (Number(value) & 1) === 1;
    if (code === 90) current.count = Number(value);
    if (code === 10) current.points.push([Number(value), NaN]);
    if (code === 20) current.points[current.points.length - 1][1] = Number(value);
  }
  return polylines;
}

interface DaeMesh {
  id: string;
  positions: Vector3[];
  faces: number[][];
}

function parseDae(text: string): DaeMesh[] {
  const document = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === "geometry" }).parse(text) as {
    COLLADA: { library_geometries: { geometry?: Array<{
      "@_id": string;
      mesh: {
        source: { float_array: { "#text": string; "@_count": string } };
        triangles: { p: string; "@_count": string };
      };
    }> } };
  };
  return (document.COLLADA.library_geometries.geometry ?? []).map((geometry) => {
    const floats = geometry.mesh.source.float_array["#text"].split(/\s+/).map(Number);
    const indices = geometry.mesh.triangles.p.split(/\s+/).map(Number);
    expect(floats).toHaveLength(Number(geometry.mesh.source.float_array["@_count"]));
    expect(indices).toHaveLength(Number(geometry.mesh.triangles["@_count"]) * 3);
    const positions = Array.from({ length: floats.length / 3 }, (_, index) => new Vector3(...floats.slice(index * 3, index * 3 + 3) as [number, number, number]));
    const faces = Array.from({ length: indices.length / 3 }, (_, index) => indices.slice(index * 3, index * 3 + 3));
    for (const index of indices) expect(index >= 0 && index < positions.length && Number.isInteger(index)).toBe(true);
    expect(floats.every(Number.isFinite)).toBe(true);
    return { id: geometry["@_id"], positions, faces };
  });
}

function assertPrism(mesh: DaeMesh, part: LocalParcelPolygon) {
  const expectedArea = Math.abs(signedArea(coordinates(part.outer))) -
    part.holes.reduce((sum, hole) => sum + Math.abs(signedArea(coordinates(hole))), 0);
  let topArea = 0;
  let bottomArea = 0;
  let wallCount = 0;
  let volume = 0;
  const edges = new Map<string, number[]>();
  for (const face of mesh.faces) {
    const [a, b, c] = face.map((index) => mesh.positions[index]);
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    expect(normal.length()).toBeGreaterThan(0);
    volume += a.dot(b.clone().cross(c)) / 6;
    face.forEach((from, index) => {
      const to = face[(index + 1) % 3];
      const key = [from, to].sort((x, y) => x - y).join(":");
      edges.set(key, [...(edges.get(key) ?? []), from < to ? 1 : -1]);
    });
    if (a.y === b.y && a.y === c.y) {
      const top = a.y === -0.005;
      expect(top ? normal.y : -normal.y).toBeGreaterThan(0);
      if (top) topArea += normal.y / 2;
      else bottomArea -= normal.y / 2;
      const triangle = polygon([[[a.x, a.z], [b.x, b.z], [c.x, c.z], [a.x, a.z]]]);
      for (const hole of part.holes) {
        const ring = coordinates(hole);
        const overlap = intersect(featureCollection([triangle, polygon([[...ring, ring[0]]])]));
        expect(overlap).toBeNull();
      }
      const xs = part.outer.map((point) => point.x);
      const zs = part.outer.map((point) => point.z);
      for (const point of [a, b, c]) {
        expect(point.x).toBeGreaterThanOrEqual(Math.min(...xs));
        expect(point.x).toBeLessThanOrEqual(Math.max(...xs));
        expect(point.z).toBeGreaterThanOrEqual(Math.min(...zs));
        expect(point.z).toBeLessThanOrEqual(Math.max(...zs));
      }
    } else {
      wallCount += 1;
      const ringIndex = [part.outer, ...part.holes].findIndex((ring) =>
        [a, b, c].every((point) => ring.some((vertex) => vertex.x === point.x && vertex.z === point.z))
      );
      expect(ringIndex).toBeGreaterThanOrEqual(0);
      const ring = [part.outer, ...part.holes][ringIndex];
      const center = new Vector3(
        ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
        0,
        ring.reduce((sum, point) => sum + point.z, 0) / ring.length
      );
      const outward = a.clone().add(b).add(c).divideScalar(3).sub(center);
      expect(normal.dot(outward) * (ringIndex === 0 ? 1 : -1)).toBeGreaterThan(0);
    }
  }
  expect(topArea).toBeCloseTo(expectedArea, 8);
  expect(bottomArea).toBeCloseTo(expectedArea, 8);
  expect(volume).toBeCloseTo(expectedArea * 0.02, 8);
  expect(wallCount).toBe([part.outer, ...part.holes].reduce((sum, ring) => sum + ring.length * 2, 0));
  for (const directions of edges.values()) {
    expect(directions).toHaveLength(2);
    expect(directions[0] + directions[1]).toBe(0);
  }
}

describe("neighboring cadastral and UPIS topology export", () => {
  it("exports every DXF ring on distinct outer/hole layers in both packages", () => {
    const input = fixture();
    const linework = buildCadastralLineworkPackage({ ...input, snapshot: input.cadastral });
    const cad = buildPlanningCadPackage(input);
    for (const [text, roadLayer] of [[linework.dxfText, "PG_ROAD_PARCELS"], [cad.dxfText, "PG_ROAD_PARCELS_CADASTRAL"]]) {
      const entities = parseDxf(text);
      for (const layer of ["PG_ADJACENT_PARCELS", roadLayer, "PG_ROAD_BOUNDARY_UPIS"]) {
        const outers = entities.filter((entity) => entity.layer === layer);
        const holes = entities.filter((entity) => entity.layer === `${layer}_HOLES`);
        expect(outers).toHaveLength(2);
        expect(holes).toHaveLength(3);
        for (const entity of [...outers, ...holes]) {
          expect(entity.closed).toBe(true);
          expect(entity.count).toBe(4);
          expect(entity.points).toHaveLength(entity.count);
        }
        const netArea = outers.reduce((sum, entity) => sum + Math.abs(signedArea(entity.points)), 0) -
          holes.reduce((sum, entity) => sum + Math.abs(signedArea(entity.points)), 0);
        expect(netArea).toBeCloseTo(137, 8);
      }
    }
    const metadata = JSON.parse(cad.metadataText);
    expect(metadata.exportVersion).toBe("planning-cad-export-v4");
    expect(JSON.parse(linework.metadataText).exportVersion).toBe("cadastral-linework-export-v2");
    expect(metadata.topologyScope.target).toBe("single-ring");
    expect(metadata.layers.find((layer: { name: string }) => layer.name === "PG_ADJACENT_PARCELS_HOLES"))
      .toMatchObject({ entityCount: 3, defaultVisible: false });
  });

  it("keeps GeoJSON components, holes, winding, coordinates and explicit provenance", () => {
    const input = fixture();
    const geojson = JSON.parse(buildCadastralGeoJson({ ...input, snapshot: input.cadastral })) as FeatureCollection<Polygon | MultiPolygon>;
    const neighbors = geojson.features.filter((feature) => feature.properties?.pnu !== "target");
    expect(neighbors).toHaveLength(3);
    for (const feature of neighbors) {
      expect(feature.geometry.type).toBe("MultiPolygon");
      const components = (feature.geometry as MultiPolygon).coordinates;
      expect(components.map((rings) => rings.length)).toEqual([3, 2]);
      let netArea = 0;
      for (const rings of components) {
        rings.forEach((ring, index) => {
          expect(ring).toHaveLength(5);
          expect(ring[0]).toEqual(ring[ring.length - 1]);
          expect(signedArea(ring) * (index === 0 ? 1 : -1)).toBeGreaterThan(0);
          const local = ring.map(([lng, lat]) => [(lng - ORIGIN[0]) * LNG_SCALE, (ORIGIN[1] - lat) * 111_000]);
          netArea += Math.abs(signedArea(local)) * (index === 0 ? 1 : -1);
        });
      }
      expect(netArea).toBeCloseTo(137, 6);
    }
    expect(neighbors.find((feature) => feature.properties?.pnu === "upis")?.properties)
      .toMatchObject({ source: "VWorld LT_C_UPISUQ151", boundarySource: "upis-planned-road", layer: "PG_ROAD_BOUNDARY_UPIS" });
    expect(neighbors.find((feature) => feature.properties?.pnu === "cadastral")?.properties)
      .toMatchObject({ source: "VWorld LP_PA_CBND_BUBUN", boundarySource: "continuous-cadastral", layer: "PG_ROAD_PARCELS" });
  });

  it("exports a holed Polygon and uses the same legacy provenance default as the context engine", () => {
    const input = fixture();
    const source = input.sourceParcels[1];
    source.polygons = source.polygons!.slice(0, 1);
    source.boundarySource = undefined;
    // The nonempty legacy boundary must never replace authoritative holed geometry.
    source.boundary = input.targetBoundary;
    input.sourceParcels = [source, { ...source, pnu: "target" }];
    input.cadastral = buildCadastralContext({ planning: input.basePackage.planning, targetPnu: "target", parcels: input.sourceParcels });
    const geojson = JSON.parse(buildCadastralGeoJson({ ...input, snapshot: input.cadastral })) as FeatureCollection<Polygon>;
    expect(geojson.features).toHaveLength(2);
    expect(geojson.features[0].properties?.topologyScope).toBe("single-ring");
    expect(geojson.features[1].geometry.type).toBe("Polygon");
    expect(geojson.features[1].geometry.coordinates.map((ring) => ring.length)).toEqual([5, 5, 5]);
    expect(geojson.features[1].properties).toMatchObject({
      source: "VWorld LP_PA_CBND_BUBUN", boundarySource: "continuous-cadastral",
    });
  });

  it.each([false, true])("triangulates all road components without filling holes or gaps, reversed=%s", (reverse) => {
    const input = fixture();
    if (reverse) {
      for (const parcel of [...input.cadastral.adjacentParcels, ...input.cadastral.roadParcels]) {
        parcel.polygons = parcel.polygons!.map((part) => {
          const closedReverse = (ring: LocalPlanPoint[]) => [...ring, ring[0]].reverse();
          return { outer: closedReverse(part.outer), holes: part.holes.map(closedReverse) };
        });
      }
    }
    const before = JSON.stringify(input.cadastral);
    const meshes = parseDae(buildSiteContextDae({ ...input, siteHash: "test" }));
    expect(JSON.stringify(input.cadastral)).toBe(before);
    const adjacent = meshes.filter((mesh) => mesh.id.startsWith("adjacent-"));
    expect(adjacent).toHaveLength(20);
    let adjacentTopArea = 0;
    for (const mesh of adjacent) {
      for (const face of mesh.faces) {
        const [a, b, c] = face.map((index) => mesh.positions[index]);
        if (a.y === 0.045 && b.y === a.y && c.y === a.y) {
          adjacentTopArea += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
        }
      }
    }
    expect(adjacentTopArea).toBeCloseTo((44 + 12 + 10 + 24 + 8) * 0.055, 8);
    const roads = meshes.filter((mesh) => /^(cadastral|upis)-road-/.test(mesh.id));
    expect(roads).toHaveLength(4);
    roads.forEach((mesh, index) => assertPrism(mesh, parts(index < 2 ? 30 : 60)[index % 2]));
  });

  it.each([false, true])("uses legacy rings only when topology is undefined, supplied=%s", (supplied) => {
    const input = fixture();
    for (const parcel of [...input.cadastral.adjacentParcels, ...input.cadastral.roadParcels]) {
      parcel.polygon = rectangle(20, 0, 12, 10);
      parcel.polygons = supplied ? [] : undefined;
    }
    for (const source of input.sourceParcels) {
      source.boundary = toWgs84(rectangle(20, 0, 12, 10));
      source.polygons = supplied ? [] : undefined;
    }
    if (supplied) {
      expect(() => buildCadastralDxf(input.cadastral)).toThrow();
      expect(() => buildPlanningCadDxf(input)).toThrow();
      expect(() => buildPlanningCadPackage(input)).toThrow();
      expect(() => buildCadastralGeoJson({ ...input, snapshot: input.cadastral })).toThrow();
      expect(() => buildSiteContextDae({ ...input, siteHash: "test" })).toThrow();
      return;
    }
    const expected = 1;
    const dxf = parseDxf(buildCadastralDxf(input.cadastral));
    expect(dxf.filter((entity) => entity.layer === "PG_ADJACENT_PARCELS")).toHaveLength(expected);
    expect(dxf.filter((entity) => entity.layer === "PG_ROAD_PARCELS")).toHaveLength(expected);
    const cad = parseDxf(buildPlanningCadDxf(input).dxfText);
    expect(cad.filter((entity) => entity.layer === "PG_ROAD_BOUNDARY_UPIS")).toHaveLength(expected);
    const geojson = JSON.parse(buildCadastralGeoJson({ ...input, snapshot: input.cadastral }));
    expect(geojson.features).toHaveLength(expected * 3 + 1);
    if (!supplied) expect(geojson.features[1].geometry.type).toBe("Polygon");
    const meshes = parseDae(buildSiteContextDae({ ...input, siteHash: "test" }));
    expect(meshes).toHaveLength(expected * 6);
  });

  it.each(["hole-removed", "hole-moved", "component-removed", "target-moved", "provenance", "missing", "extra", "duplicate", "empty", "nonfinite", "outside-hole"])(
    "blocks source/snapshot mismatch across packaged exports: %s", (mutation) => {
      const input = fixture();
      const source = input.sourceParcels[2];
      if (mutation === "hole-removed") source.polygons![0].holes.pop();
      if (mutation === "hole-moved") source.polygons![0].holes[0][0][0] += 0.5 / LNG_SCALE;
      if (mutation === "component-removed") source.polygons!.pop();
      if (mutation === "target-moved") input.targetBoundary[0][0] += 1 / LNG_SCALE;
      if (mutation === "provenance") source.boundarySource = "continuous-cadastral";
      if (mutation === "missing") input.sourceParcels.pop();
      if (mutation === "extra") input.sourceParcels.push({ ...source, pnu: "extra" });
      if (mutation === "duplicate") input.sourceParcels.push(source);
      if (mutation === "empty") source.polygons = [];
      if (mutation === "nonfinite") source.polygons![0].outer[0][0] = NaN;
      if (mutation === "outside-hole") source.polygons![0].holes[0] = toWgs84(rectangle(100, 100, 2, 2));
      expect(() => buildCadastralGeoJson({ ...input, snapshot: input.cadastral })).toThrow();
      expect(() => buildCadastralLineworkPackage({ ...input, snapshot: input.cadastral })).toThrow();
      expect(() => buildPlanningCadPackage(input)).toThrow();
      expect(() => buildSketchupSiteExport(input)).toThrow();
    }
  );

  it("never reintroduces a rejected source record through GeoJSON", () => {
    const input = fixture();
    input.sourceParcels[0].polygons![0].holes[0] = toWgs84(rectangle(100, 100, 2, 2));
    input.cadastral = buildCadastralContext({ planning: input.basePackage.planning, targetPnu: "target", parcels: input.sourceParcels });
    expect(input.cadastral.validation.usable).toBe(false);
    expect(input.cadastral.adjacentParcels).toHaveLength(0);
    expect(() => buildCadastralLineworkPackage({ ...input, snapshot: input.cadastral })).toThrow();
    expect(() => buildSketchupSiteExport(input)).toThrow();
  });

  it("accepts equivalent ring order, winding and closure without changing snapshot provenance", () => {
    const input = fixture();
    const rotateReverse = <T,>(ring: T[]) => {
      const reversed = [...ring.slice(1), ring[0]].reverse();
      return [...reversed, reversed[0]];
    };
    input.targetBoundary = rotateReverse(input.targetBoundary);
    for (const source of input.sourceParcels) {
      source.polygons = source.polygons!.reverse().map((part) => ({
        outer: rotateReverse(part.outer), holes: part.holes.reverse().map(rotateReverse),
      }));
      source.jibun = "unbound label";
      source.lotAreaSqm = 999;
    }
    const result = buildPlanningCadPackage(input);
    const geojson = JSON.parse(result.geojsonText);
    expect(geojson.sourceBinding).toBe("validated-snapshot");
    expect(geojson.features[1].properties).toMatchObject({ jibun: "adjacent", lotAreaSqm: 137, measuredAreaSqm: 137 });
    expect(JSON.parse(result.metadataText).cadastralHash).toBe(input.cadastral.cadastralHash);
  });

  it.each(["invalid-context", "invalid-topology", "wrong-origin", "wrong-project", "wrong-target"])(
    "enforces the full site audit in the direct SketchUp package: %s", (mutation) => {
      const input = fixture();
      if (mutation === "invalid-context") input.cadastral.validation = { usable: false, status: "fail", issues: [] };
      if (mutation === "invalid-topology") input.cadastral.roadParcels[0].polygons = [];
      if (mutation === "wrong-origin") input.cadastral.coordinateSystem = {
        ...input.cadastral.coordinateSystem, originLngLat: [128, 38],
      };
      if (mutation === "wrong-project") input.cadastral.projectId = "different";
      if (mutation === "wrong-target") input.cadastral.targetParcel.polygon = rectangle(30, 30, 20, 20);
      expect(input.basePackage.validation.exportable).toBe(true);
      expect(() => buildSketchupSiteExport(input)).toThrow();
    }
  );

  it.each(["dxf", "source"])("shares a monotonic two-second validation budget for %s", (exporter) => {
    const input = fixture();
    let elapsed = 0;
    const validate = topologyGeometry.validateLocalParcelTopology;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const validator = vi.spyOn(topologyGeometry, "validateLocalParcelTopology").mockImplementation((polygons, checkDeadline) => {
      elapsed += 750;
      return validate(polygons, checkDeadline);
    });
    try {
      expect(() => exporter === "dxf"
        ? buildCadastralDxf(input.cadastral)
        : buildCadastralGeoJson({ ...input, snapshot: input.cadastral }))
        .toThrow(expect.objectContaining({ name: "TimeoutError" }));
      expect(validator).toHaveBeenCalledTimes(3);
    } finally {
      validator.mockRestore();
      clock.mockRestore();
    }
  });

  it.each(["decimal-grid", "float32-mm"])("preserves solid road meshes after serialized receiver conversion: %s", (receiver) => {
    const input = fixture();
    input.cadastral = buildCadastralContext({ planning: input.basePackage.planning, targetPnu: "target", parcels: input.sourceParcels });
    const result = buildSketchupSiteExport(input);
    expect(JSON.parse(result.metadataText).deliveryAudit.exportable).toBe(true);
    expect(JSON.parse(result.metadataText).siteCoordinatePrecisionM).toBe(0.000001);
    const roads = parseDae(result.siteDaeText).filter((mesh) => /^(cadastral|upis)-road-/.test(mesh.id));
    expect(roads).toHaveLength(4);
    roads.forEach((mesh, index) => {
      const convert = (value: number) => receiver === "decimal-grid"
        ? Number(value.toFixed(6)) : Math.fround(Math.fround(value) * 1000) / 1000;
      const positions = mesh.positions.map((point) => new Vector3(convert(point.x), convert(point.y), convert(point.z)));
      for (const face of mesh.faces) {
        const [a, b, c] = face.map((vertex) => positions[vertex].clone().multiplyScalar(1000));
        expect(b.sub(a).cross(c.sub(a)).length()).toBeGreaterThan(0.000001);
      }
      assertPrism({ ...mesh, positions }, parts(index < 2 ? 30 : 60)[index % 2]);
    });
  });

  it("propagates hole and secondary-component changes through cadastral and site hashes", () => {
    const input = fixture();
    const exportVariant = (sources: CadastralParcelFeature[]) => {
      const cadastral = buildCadastralContext({ planning: input.basePackage.planning, targetPnu: "target", parcels: sources, generatedAt: GENERATED_AT });
      const result = buildSketchupSiteExport({ ...input, sourceParcels: sources, cadastral });
      return { cadastral, metadata: JSON.parse(result.metadataText) };
    };
    const original = exportVariant(input.sourceParcels);
    expect(original.cadastral.roadParcels).toHaveLength(2);
    expect(original.metadata.exportVersion).toBe("sketchup-site-export-v2");
    expect(original.metadata.topologyScope.target).toBe("single-ring");
    for (const parcelIndex of [0, 1, 2]) {
      for (const mutation of ["hole", "component"] as const) {
        const sources = structuredClone(input.sourceParcels);
        const parts = sources[parcelIndex].polygons!;
        const point = mutation === "hole" ? parts[0].holes[0][1] : parts[1].outer[1];
        point[0] += 0.5 / LNG_SCALE;
        const changed = exportVariant(sources);
        expect(changed.cadastral.cadastralHash).not.toBe(original.cadastral.cadastralHash);
        expect(changed.metadata.siteHash).not.toBe(original.metadata.siteHash);
        expect(changed.metadata.hashes.cadastral).toBe(changed.cadastral.cadastralHash);
      }
    }
  });
});
