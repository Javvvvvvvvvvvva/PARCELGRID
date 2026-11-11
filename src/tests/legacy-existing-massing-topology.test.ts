import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLegacyMassingPreview, MassingView } from "@/components/ui/MassingView";
import { buildExistingBuildingPreview } from "@/components/ui/ExistingBuildingMassCorrected";
import { ExistingBuildingMass } from "@/components/ui/ExistingBuildingMass";
import { projectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { localParcelArea, localParcelIntersectionArea } from "@/lib/geo/parcel-topology-geometry";
import { parcelRings, type LocalParcelPolygon, type ParcelBoundaryInput } from "@/lib/geo/parcel-topology";
import { contextFlatGeometry, contextPrismGeometry, contextCameraDistance, type ContextSceneFrame } from "@/lib/planning/context-three-geometry";
import * as parking from "@/lib/geo/parking-layout";
import type { ExistingBuildingFootprint } from "@/lib/geo/existing-building-geometry";
import { fixtureBuildingLookup } from "./helpers/building-registry-fixture";

const harness = vi.hoisted(() => ({ canvas: null as ReactNode, hooks: [] as unknown[] }));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactNode }) => { harness.canvas = children; return null; },
  useThree: vi.fn(), useFrame: vi.fn(),
}));
vi.mock("@react-three/drei", () => ({
  ContactShadows: () => null, Edges: () => null, Line: () => null,
  OrbitControls: () => null, Text: () => null,
}));
vi.mock("@/lib/stores/project-store", () => ({ useProjectStore: () => [] }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => harness.hooks.length
    ? [harness.hooks.shift(), vi.fn()] : actual.useState(initial) };
});

const origin: [number, number] = [127, 37];
function geo(x: number, z: number): [number, number] {
  return [origin[0] + x / (111_000 * Math.cos(origin[1] * Math.PI / 180)), origin[1] - z / 111_000];
}
function ring(x = 0, z = 0, width = 20, depth = 20) {
  return [geo(x, z), geo(x + width, z), geo(x + width, z + depth), geo(x, z + depth)];
}
const legacy = ring(-500, -500, 1000, 1000);
const full = [
  { outer: ring(), holes: [ring(8, 8, 4, 4), ring(2, 2, 1, 1)] },
  { outer: ring(400, 40, 15, 15), holes: [] },
];
const massInput = { boundary: legacy, boundaryPolygons: full, floors: 3, zoning: "일반상업지역" };

beforeEach(() => {
  vi.stubGlobal("React", React);
  harness.canvas = null;
  harness.hooks = [];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function rayHits(polygons: LocalParcelPolygon[], x: number, z: number, prism = false) {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const geometries = polygons.map(polygon => prism
    ? contextPrismGeometry(polygon, 0, 3) : contextFlatGeometry(polygon));
  try {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    return geometries.some(geometry => ray.intersectObject(new THREE.Mesh(geometry, material)).length > 0);
  } finally { geometries.forEach(geometry => geometry.dispose()); material.dispose(); }
}

function localPoint(x: number, z: number, projectionOrigin: [number, number]) {
  return projectParcelPolygons([{ outer: ring(x, z, 0.01, 0.01), holes: [] }], projectionOrigin)[0].outer[0];
}

function sceneProps<T>() {
  const suspense = harness.canvas as ReactElement<{ children: ReactElement<T> }>;
  return suspense.props.children.props;
}

describe("legacy envelope topology", () => {
  it.each([false, true])("keeps both holes and remote components through each cap (reversed/closed %s)", reverse => {
    const input = structuredClone(massInput);
    if (reverse) for (const points of parcelRings(input.boundaryPolygons)) {
      points.reverse(); points.push([...points[0]]);
    }
    const before = structuredClone(input);
    const preview = buildLegacyMassingPreview(input);
    expect(preview.parcel.available).toBe(true);
    expect(preview.envelopeStatus).toBe("available");
    expect(preview.masses).toHaveLength(3);
    expect(preview.parcel.polygons).toHaveLength(2);
    for (const polygons of [preview.parcel.polygons, ...preview.masses.map(mass => mass.polygons)]) {
      expect(polygons).toHaveLength(2);
      expect(polygons.reduce((count, part) => count + part.holes.length, 0)).toBe(2);
      for (const [x, z, expected] of [[5, 5, true], [10, 10, false], [2.5, 2.5, false],
        [407, 47, true], [200, 20, false], [-200, 0, false]] as const) {
        const point = localPoint(x, z, preview.parcel.origin);
        expect(rayHits(polygons, point.x, point.z)).toBe(expected);
        expect(rayHits(polygons, point.x, point.z, true)).toBe(expected);
      }
    }
    for (const mass of preview.masses) {
      expect(localParcelArea(mass.polygons)).toBeCloseTo(mass.floorPlateSqm, 3);
      expect(mass).not.toHaveProperty("units");
    }
    expect(input).toEqual(before);
  });

  it("retains ground when a valid setback erases all envelope regions", () => {
    const preview = buildLegacyMassingPreview({ ...massInput,
      boundaryPolygons: [{ outer: ring(0, 0, 0.8, 0.8), holes: [] }] });
    expect(preview.parcel.available).toBe(true);
    expect(preview.envelopeStatus).toBe("available");
    expect(preview.masses.every(mass => mass.polygons.length === 0 && mass.floorPlateSqm === 0)).toBe(true);
  });

  it("shows both components when a setback removes a narrow connecting neck", () => {
    const boundary = [[0, 0], [8, 0], [8, 3.8], [16, 3.8], [16, 0], [24, 0],
      [24, 8], [16, 8], [16, 4.2], [8, 4.2], [8, 8], [0, 8]].map(([x, z]) => geo(x, z));
    const preview = buildLegacyMassingPreview({ boundary, floors: 2, zoning: "상업" });
    expect(preview.parcel.polygons).toHaveLength(1);
    for (const mass of preview.masses) {
      expect(mass.polygons).toHaveLength(2);
      const gap = localPoint(12, 4, preview.parcel.origin);
      expect(rayHits(mass.polygons, gap.x, gap.z, true)).toBe(false);
    }
  });

  it("retains ground when the envelope engine cannot process touching components", () => {
    const preview = buildLegacyMassingPreview({ ...massInput, boundaryPolygons: [
      { outer: ring(), holes: [] }, { outer: ring(20, 0), holes: [] },
    ] });
    expect(preview.parcel.available).toBe(true);
    expect(preview.envelopeStatus).toBe("unavailable");
    expect(preview.masses).toEqual([]);
    expect(preview.parcel.polygons).toHaveLength(2);
    expect(preview.warnings.length).toBeGreaterThan(0);
  });

  it("does not call legacy parking for a complex region or allocate its financial units", () => {
    const layout = vi.spyOn(parking, "layoutParkingFromBoundary");
    const html = renderToStaticMarkup(React.createElement(MassingView, { ...massInput, units: 47,
      roads: [{ name: "Synthetic road", points: [geo(-5, 22), geo(425, 22)] }] }));
    expect(layout).not.toHaveBeenCalled();
    expect(html).toContain('data-parking-status="unverified"');
    expect(html).toContain("확정된 여러 동의 배치가 아닙니다");
    expect(html).toContain("재무값은 변경되지 않습니다");
    expect(html).toContain("47세대 · 배치 미확인");
    expect(html).not.toContain("세대당 평균");
    expect(sceneProps<{ preview: ReturnType<typeof buildLegacyMassingPreview> }>().preview.parkingPolygons).toEqual([]);
  });

  it.each([16 / 9, 1, 320 / 560])("frames every component and floor at aspect %s", aspect => {
    const preview = buildLegacyMassingPreview(massInput);
    const { frame } = preview;
    const distance = contextCameraDistance(frame.radius, 45, aspect);
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, distance * 5 + frame.radius * 2);
    camera.position.copy(new THREE.Vector3(1.8, 1.8, 2.2).normalize().multiplyScalar(distance)
      .add(new THREE.Vector3(...frame.center)));
    camera.lookAt(new THREE.Vector3(...frame.center)); camera.updateMatrixWorld();
    for (const point of parcelRings(preview.parcel.polygons).flat()) for (const y of [0, 9]) {
      const screen = new THREE.Vector3(point.x, y, point.z).project(camera);
      expect(Math.abs(screen.x)).toBeLessThan(1);
      expect(Math.abs(screen.y)).toBeLessThan(1);
      expect(Math.abs(screen.z)).toBeLessThan(1);
    }
  });
});

describe("authoritative boundary availability on both surfaces", () => {
  it.each([
    { boundaryPolygons: [] }, { boundaryPolygons: null },
    { boundaryPolygons: [{ outer: ring(), holes: [ring(30, 30)] }] },
    { boundaryPolygons: [{ outer: ring(), holes: [[geo(8, 8)]] }] },
    { boundaryPolygons: [{ outer: [geo(0, 0), geo(20, 20), geo(20, 0), geo(0, 20)], holes: [] }] },
  ])("never falls back to a valid legacy ring for invalid/empty topology %#", source => {
    const input = { boundary: legacy, ...source } as ParcelBoundaryInput;
    expect(buildLegacyMassingPreview({ ...massInput, ...input }).parcel.available).toBe(false);
    expect(buildExistingBuildingPreview({ ...input, currentBuilding: fixtureBuildingLookup(), lotArea: 400 }).status)
      .toBe("unavailable");
    for (const element of [React.createElement(MassingView, { ...massInput, ...input }),
      React.createElement(ExistingBuildingMass, { ...input, lotArea: 400 })]) {
      expect(renderToStaticMarkup(element)).toContain("유효하지 않아");
      expect(harness.canvas).toBeNull();
    }
  });

  it.each([undefined, [], legacy])("accepts full topology with legacy %j", boundary => {
    expect(buildLegacyMassingPreview({ ...massInput, boundary }).parcel.polygons).toHaveLength(2);
    expect(buildExistingBuildingPreview({ boundary, boundaryPolygons: full, lotArea: 608 }).parcel.polygons).toHaveLength(2);
  });

  it("preserves simple legacy compatibility only when full topology is absent", () => {
    const source = { boundary: ring() };
    expect(buildLegacyMassingPreview({ ...source, floors: 2, zoning: "상업" }).masses).toHaveLength(2);
    expect(buildExistingBuildingPreview({ ...source, lotArea: 400, currentBuilding: fixtureBuildingLookup() }).status)
      .toBe("schematic");
  });
});

describe("existing buildings on complete ground regions", () => {
  it("withholds a courtyard-crossing approximation and keeps both ground components", () => {
    const currentBuilding = fixtureBuildingLookup(); currentBuilding.buildings[0].buildingArea = 300;
    const input = { boundary: legacy, boundaryPolygons: full, currentBuilding, lotArea: 608 };
    const before = structuredClone(input);
    const preview = buildExistingBuildingPreview(input);
    expect(preview.status).toBe("withheld"); expect(preview.models).toEqual([]);
    const html = renderToStaticMarkup(React.createElement(ExistingBuildingMass, input));
    expect(html).toContain('data-building-geometry="withheld"');
    expect(html).toContain("건물 형상 표시 보류"); expect(html).toContain("대지 형상만 유지");
    expect(html).toContain("재무값은 변경되지 않습니다");
    const scene = sceneProps<{ lotPolygons: LocalParcelPolygon[]; models: unknown[]; frame: ContextSceneFrame }>();
    expect(scene.lotPolygons).toHaveLength(2); expect(scene.models).toEqual([]);
    for (const point of parcelRings(scene.lotPolygons).flat()) {
      expect(new THREE.Vector3(point.x, 0, point.z).distanceTo(new THREE.Vector3(...scene.frame.center)))
        .toBeLessThanOrEqual(scene.frame.radius);
    }
    expect(input).toEqual(before);
  });

  it("detects even a tiny enclosed hole without relying on perimeter samples", () => {
    const preview = buildExistingBuildingPreview({ lotArea: 400, currentBuilding: fixtureBuildingLookup(),
      boundaryPolygons: [{ outer: ring(), holes: [ring(9, 9, 0.01, 0.01)] }] });
    expect(preview.status).toBe("withheld");
  });

  it("withholds a centroid-scaled concave outline that would leave the parcel", () => {
    const currentBuilding = fixtureBuildingLookup(); currentBuilding.buildings[0].buildingArea = 100;
    const preview = buildExistingBuildingPreview({ lotArea: 175, currentBuilding,
      boundaryPolygons: [{ outer: [[0, 0], [20, 0], [20, 5], [5, 5], [5, 20], [0, 20]]
        .map(([x, z]) => geo(x, z)), holes: [] }] });
    expect(preview.status).toBe("withheld");
  });

  it("uses only one fitting component and clearly marks the result as approximate", () => {
    const input = { lotArea: 608, currentBuilding: fixtureBuildingLookup(), boundaryPolygons: full };
    const preview = buildExistingBuildingPreview(input);
    expect(preview.status).toBe("schematic"); expect(preview.models).toHaveLength(1);
    const polygons = preview.models[0].polygons.map(([outer, ...holes]) => ({ outer, holes }));
    expect(localParcelArea(polygons)).toBeCloseTo(100.2, 4);
    expect(localParcelIntersectionArea(polygons, preview.parcel.polygons)).toBeCloseTo(localParcelArea(polygons), 6);
    const html = renderToStaticMarkup(React.createElement(ExistingBuildingMass, input));
    expect(html).toContain("실제 위치·외곽선이나 공식 배치도를 뜻하지 않습니다");
  });

  it("preserves provider courtyard holes and withholds an out-of-parcel provider footprint without clipping it", () => {
    const footprint: ExistingBuildingFootprint = { id: "synthetic", pnu: "synthetic", buildingName: "Synthetic",
      polygons: [[ring(), ring(8, 8, 4, 4), ring(2, 2, 1, 1)]], footprintAreaSqm: 383,
      totalAreaSqm: 766, heightM: 6, groundFloors: 2, undergroundFloors: 0,
      useApprovalDate: "", purposeCode: "", structureCode: "", violationStatus: "unknown", violationRaw: "",
      matchMethod: "geometry", source: "vworld-dt_d010" };
    const currentBuilding = Object.assign(fixtureBuildingLookup(), { geometry: {
      source: "vworld-dt_d010" as const, status: "matched" as const, footprints: [footprint], queryFeatureCount: 1,
    } });
    const input = { lotArea: 608, currentBuilding, boundaryPolygons: full };
    const preview = buildExistingBuildingPreview(input);
    expect(preview.status).toBe("actual");
    const polygons = preview.models[0].polygons.map(([outer, ...holes]) => ({ outer, holes }));
    const hole = localPoint(10, 10, preview.parcel.origin);
    expect(rayHits(polygons, hole.x, hole.z, true)).toBe(false);
    currentBuilding.geometry.footprints[0] = { ...footprint, polygons: [[ring(-1, -1, 22, 22)]] };
    expect(buildExistingBuildingPreview(input).status).toBe("withheld");
  });

  it("renders all minimap components with even-odd courtyard fill in 3D mode", () => {
    harness.hooks = [false, true, "3d", 0, 0];
    const html = renderToStaticMarkup(React.createElement(ExistingBuildingMass, {
      boundaryPolygons: full, lotArea: 608,
    }));
    expect(html.match(/fill-rule="evenodd"/g)).toHaveLength(2);
    expect(html).toContain('data-view-mode="3d"');
  });
});
