import type { LocalPoint } from "./select-primary-road";

/**
 * Three.js ExtrudeGeometry starts on the XY plane and is then rotated -90°
 * around X so extrusion depth becomes world +Y. That rotation maps the shape's
 * Y coordinate to world -Z. Because the GIS scene convention already uses
 * -Z as north, the input Z must be negated before creating the 2D shape.
 */
export function scenePointToExtrusionPlane(point: LocalPoint): [number, number] {
  return [point.x, -point.z];
}

/** Test/debug inverse for the -90° X rotation used by the mass renderer. */
export function extrusionPlaneYToSceneZ(planeY: number): number {
  return -planeY;
}
