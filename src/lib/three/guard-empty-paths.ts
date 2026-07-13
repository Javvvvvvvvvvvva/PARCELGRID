import * as THREE from "three";

/**
 * Three.js Path.closePath() assumes that at least one curve exists and reads
 * curves[0].getPoint(). Stage 2 can intentionally produce an empty footprint
 * when a floor has no program area or its legal envelope has disappeared.
 *
 * Keep the planning workspace alive in that case. ExtrudeGeometry and
 * ShapeGeometry can represent the resulting empty shape as an empty buffer
 * geometry, while the planning validation continues to report the floor as
 * unavailable or non-compliant.
 */
type GuardedPathPrototype = THREE.Path & {
  __parcelgridEmptyPathGuardInstalled?: boolean;
};

const prototype = THREE.Path.prototype as GuardedPathPrototype;

if (!prototype.__parcelgridEmptyPathGuardInstalled) {
  const originalClosePath = prototype.closePath;

  prototype.closePath = function guardedClosePath(this: THREE.Path): THREE.Path {
    if (!Array.isArray(this.curves) || this.curves.length === 0) {
      return this;
    }
    return originalClosePath.call(this);
  };

  prototype.__parcelgridEmptyPathGuardInstalled = true;
}
