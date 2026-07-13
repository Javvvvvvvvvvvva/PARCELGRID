import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "@/lib/three/guard-empty-paths";

describe("Stage 2 Three.js empty path guard", () => {
  it("does not throw when an empty shape is closed and extruded", () => {
    const shape = new THREE.Shape();

    expect(() => shape.closePath()).not.toThrow();
    expect(() =>
      new THREE.ExtrudeGeometry(shape, {
        depth: 3,
        bevelEnabled: false,
      })
    ).not.toThrow();
  });

  it("keeps normal non-empty paths working", () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(2, 0);
    shape.lineTo(2, 2);
    shape.lineTo(0, 2);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 3,
      bevelEnabled: false,
    });

    expect(geometry.attributes.position.count).toBeGreaterThan(0);
  });
});
