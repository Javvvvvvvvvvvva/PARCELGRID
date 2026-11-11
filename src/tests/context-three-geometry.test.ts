import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { localParcelPolygons, parcelRings, type LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import {
  calculateContextSceneFrame,
  contextCameraDistance,
  contextFlatGeometry,
  contextPrismGeometry,
} from "@/lib/planning/context-three-geometry";

function rectangle(x: number, z: number, width: number, depth: number) {
  return [{ x, z }, { x: x + width, z }, { x: x + width, z: z + depth }, { x, z: z + depth }];
}

function donut(): LocalParcelPolygon {
  return {
    outer: rectangle(10, -30, 20, 15),
    holes: [rectangle(12, -28, 5, 4), rectangle(22, -23, 3, 5)],
  };
}

function horizontalArea(geometry: THREE.BufferGeometry, y: number): number {
  const positions = geometry.getAttribute("position");
  if (!positions) return 0;
  const indices = geometry.getIndex();
  let area = 0;
  for (let offset = 0; offset < (indices?.count ?? positions.count); offset += 3) {
    const vertices = [0, 1, 2].map((corner) => new THREE.Vector3().fromBufferAttribute(
      positions, indices ? indices.getX(offset + corner) : offset + corner
    ));
    if (vertices.every((point) => Math.abs(point.y - y) < 1e-5)) {
      const [a, b, c] = vertices;
      area += new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
    }
  }
  return area;
}

function hasSurfaceAt(geometry: THREE.BufferGeometry, x: number, z: number): boolean {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  try {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(new THREE.Mesh(geometry, material)).length > 0;
  } finally {
    material.dispose();
  }
}

describe("context 3D polygon geometry", () => {
  it.each([
    { reverseOuter: false, reverseHoles: false, closed: false },
    { reverseOuter: true, reverseHoles: false, closed: true },
    { reverseOuter: false, reverseHoles: true, closed: true },
    { reverseOuter: true, reverseHoles: true, closed: false },
  ])("keeps both holes empty for source winding/closure %j", ({ reverseOuter, reverseHoles, closed }) => {
    const polygon = donut();
    if (reverseOuter) polygon.outer.reverse();
    if (reverseHoles) polygon.holes.forEach((hole) => hole.reverse());
    if (closed) parcelRings([polygon]).forEach((ring) => ring.push({ ...ring[0] }));
    const original = structuredClone(polygon);
    const geometry = contextFlatGeometry(polygon);
    try {
      expect(horizontalArea(geometry, 0)).toBeCloseTo(300 - 20 - 15, 5);
      expect(hasSurfaceAt(geometry, 11, -29)).toBe(true);
      expect(hasSurfaceAt(geometry, 14, -26)).toBe(false);
      expect(hasSurfaceAt(geometry, 23, -20)).toBe(false);
      expect(hasSurfaceAt(geometry, 11, 29)).toBe(false);
      expect(polygon).toEqual(original);
    } finally {
      geometry.dispose();
    }
  });

  it("renders every authoritative component without a surface bridging the gap", () => {
    const polygons = localParcelPolygons({
      polygon: [],
      polygons: [donut(), { outer: rectangle(200, -20, 10, 10), holes: [] }],
    });
    const geometries = polygons.map(contextFlatGeometry);
    try {
      expect(geometries.reduce((area, geometry) => area + horizontalArea(geometry, 0), 0)).toBeCloseTo(365, 5);
      expect(geometries.some((geometry) => hasSurfaceAt(geometry, 11, -29))).toBe(true);
      expect(geometries.some((geometry) => hasSurfaceAt(geometry, 205, -15))).toBe(true);
      expect(geometries.some((geometry) => hasSurfaceAt(geometry, 100, -20))).toBe(false);
    } finally {
      geometries.forEach((geometry) => geometry.dispose());
    }
  });

  it("retains courtyard openings through both caps of an extruded building", () => {
    const geometry = contextPrismGeometry(donut(), 2, 17);
    try {
      expect(horizontalArea(geometry, 2)).toBeCloseTo(265, 5);
      expect(horizontalArea(geometry, 17)).toBeCloseTo(265, 5);
      expect(hasSurfaceAt(geometry, 14, -26)).toBe(false);
      expect(hasSurfaceAt(geometry, 23, -20)).toBe(false);
      expect(hasSurfaceAt(geometry, 11, -29)).toBe(true);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox?.min.y).toBeCloseTo(2);
      expect(geometry.boundingBox?.max.y).toBeCloseTo(17);
    } finally {
      geometry.dispose();
    }
  });

  it("falls back to the legacy ring only when topology is undefined", () => {
    const legacy = rectangle(-500, -500, 1000, 1000);
    expect(localParcelPolygons({ polygon: legacy })).toEqual([{ outer: legacy, holes: [] }]);
    expect(localParcelPolygons({ polygon: legacy, polygons: [] })).toEqual([]);
    const authoritative = [donut()];
    expect(localParcelPolygons({ polygon: legacy, polygons: authoritative })).toBe(authoritative);
  });

  it.each([
    { hole: [] },
    { hole: [{ x: 12, z: -28 }, { x: NaN, z: -28 }, { x: 12, z: -24 }] },
    { hole: rectangle(12, -28, 0, 4) },
  ])(
    "does not fill a polygon when an authoritative hole is unusable %#", ({ hole }) => {
      const geometry = contextFlatGeometry({ outer: donut().outer, holes: [hole] });
      const edges = new THREE.EdgesGeometry(geometry);
      try {
        expect(geometry.getAttribute("position").count).toBe(0);
        expect(edges.getAttribute("position").count).toBe(0);
      } finally {
        edges.dispose();
        geometry.dispose();
      }
    }
  );
});

describe("context 3D camera framing", () => {
  const polygons = [donut(), { outer: rectangle(400, 80, 80, 50), holes: [] }];
  const lines = [[{ x: -100, z: 60 }, { x: -80, z: 60 }]];

  it("includes remote components and lines beyond the previous extent cap", () => {
    const frame = calculateContextSceneFrame({ polygons, lines, heightM: 80 });
    expect(frame.center).toEqual([190, 40, 50]);
    expect(frame.radius).toBeGreaterThan(290);
    const center = new THREE.Vector3(...frame.center);
    for (const point of [...parcelRings(polygons), ...lines].flat()) {
      for (const y of [0, 80]) {
        expect(new THREE.Vector3(point.x, y, point.z).distanceTo(center)).toBeLessThanOrEqual(frame.radius);
      }
    }
  });

  it.each([16 / 9, 1, 320 / 520])("fits all components in a viewport of aspect %s", (aspect) => {
    const frame = calculateContextSceneFrame({ polygons, lines, heightM: 80 });
    const distance = contextCameraDistance(frame.radius, 44, aspect);
    const camera = new THREE.PerspectiveCamera(44, aspect, 0.1, distance * 5 + frame.radius * 2);
    const target = new THREE.Vector3(...frame.center);
    camera.position.copy(new THREE.Vector3(1.45, 1.25, 1.7).normalize().multiplyScalar(distance).add(target));
    camera.lookAt(target);
    camera.updateMatrixWorld();
    for (const point of [...parcelRings(polygons), ...lines].flat()) {
      for (const y of [0, 80]) {
        const projected = new THREE.Vector3(point.x, y, point.z).project(camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
        expect(Math.abs(projected.z)).toBeLessThan(1);
      }
    }
  });
});
