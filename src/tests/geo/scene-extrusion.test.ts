import { describe, expect, it } from "vitest";
import {
  extrusionPlaneYToSceneZ,
  scenePointToExtrusionPlane,
} from "@/lib/geo/scene-extrusion";

describe("scene extrusion coordinates", () => {
  it("preserves a north-side point after extrusion rotation", () => {
    const point = { x: 3, z: -12 };
    const [planeX, planeY] = scenePointToExtrusionPlane(point);

    expect(planeX).toBe(3);
    expect(extrusionPlaneYToSceneZ(planeY)).toBe(-12);
  });

  it("preserves a south-side point after extrusion rotation", () => {
    const point = { x: -4, z: 9 };
    const [, planeY] = scenePointToExtrusionPlane(point);

    expect(extrusionPlaneYToSceneZ(planeY)).toBe(9);
  });

  it("keeps an extruded parcel edge aligned with an unextruded road", () => {
    const parcelEdgeZ = -6.25;
    const roadCenterlineZ = -6.25;
    const [, planeY] = scenePointToExtrusionPlane({ x: 0, z: parcelEdgeZ });

    expect(extrusionPlaneYToSceneZ(planeY)).toBe(roadCenterlineZ);
  });
});
