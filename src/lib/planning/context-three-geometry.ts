import * as THREE from "three";
import { parcelRings, type LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import { planningPointToThreeShape } from "@/lib/planning/three-coordinate-contract";

export function openContextRing(points: LocalPlanPoint[]): LocalPlanPoint[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.z === last.z ? points.slice(0, -1) : points;
}

function contextShape(polygon: LocalParcelPolygon): THREE.Shape | null {
  const rings = parcelRings([polygon]).map(openContextRing);
  // An unusable hole must not turn its parent into a filled surface.
  if (rings.some((ring) => ring.length < 3 || ring.some(
    (point) => !Number.isFinite(point.x) || !Number.isFinite(point.z)
  ))) return null;
  const paths = rings.map((ring) => ring.map((point) => {
    const { x, y } = planningPointToThreeShape(point);
    return new THREE.Vector2(x, y);
  }));
  if (paths.some((path) => THREE.ShapeUtils.area(path) === 0)) return null;
  const shape = new THREE.Shape(paths[0]);
  shape.closePath();
  shape.holes = paths.slice(1).map((points) => {
    const hole = new THREE.Path(points);
    hole.closePath();
    return hole;
  });
  return shape;
}

export function contextFlatGeometry(polygon: LocalParcelPolygon): THREE.BufferGeometry {
  const shape = contextShape(polygon);
  if (!shape) return new THREE.ShapeGeometry([]);
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function contextPrismGeometry(
  polygon: LocalParcelPolygon,
  bottomY: number,
  topY: number
): THREE.BufferGeometry {
  const shape = contextShape(polygon);
  if (!shape) return new THREE.ShapeGeometry([]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, topY - bottomY),
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottomY, 0);
  return geometry;
}

export interface ContextSceneFrame {
  center: [number, number, number];
  radius: number;
}

export function calculateContextSceneFrame(input: {
  polygons: LocalParcelPolygon[];
  lines: LocalPlanPoint[][];
  heightM: number;
}): ContextSceneFrame {
  const bounds = new THREE.Box3();
  for (const ring of [...parcelRings(input.polygons), ...input.lines]) {
    for (const point of ring) {
      if (Number.isFinite(point.x) && Number.isFinite(point.z)) {
        bounds.expandByPoint(new THREE.Vector3(point.x, 0, point.z));
      }
    }
  }
  if (bounds.isEmpty()) return { center: [0, 0, 0], radius: 12 };
  bounds.max.y = Number.isFinite(input.heightM) ? Math.max(0, input.heightM) : 0;
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  return { center: sphere.center.toArray(), radius: Math.max(12, sphere.radius) };
}

export function contextCameraDistance(radius: number, fov: number, aspect: number): number {
  const verticalHalfFov = THREE.MathUtils.degToRad(fov / 2);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(0.01, aspect));
  return radius * 1.15 / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov));
}
