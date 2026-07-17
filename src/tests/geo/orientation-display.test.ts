import { describe, expect, it } from "vitest";
import {
  angularDifference,
  bearingFromSceneVector,
  frontageSideLabel,
  roadAxisLabel,
  sceneSegmentBearing,
} from "@/lib/geo/orientation";

describe("scene orientation display helpers", () => {
  it("uses north=-Z and east=+X", () => {
    expect(bearingFromSceneVector(0, -1)).toBeCloseTo(0);
    expect(bearingFromSceneVector(1, 0)).toBeCloseTo(90);
    expect(bearingFromSceneVector(0, 1)).toBeCloseTo(180);
    expect(bearingFromSceneVector(-1, 0)).toBeCloseTo(270);
  });

  it("formats road axes as two opposite directions", () => {
    expect(roadAxisLabel({ x: 0, z: 4 }, { x: 0, z: -4 })).toBe("북–남");
    expect(roadAxisLabel({ x: -4, z: 0 }, { x: 4, z: 0 })).toBe("동–서");
  });

  it("identifies the parcel side facing the road", () => {
    expect(frontageSideLabel({ x: 5, z: -2 }, { x: 5, z: 2 })).toBe("동측");
    expect(frontageSideLabel({ x: -2, z: -5 }, { x: 2, z: -5 })).toBe("북측");
  });

  it("normalizes scene segment bearings and circular differences", () => {
    expect(sceneSegmentBearing({ x: 0, z: 0 }, { x: 1, z: -1 })).toBeCloseTo(45);
    expect(angularDifference(359, 1)).toBe(2);
  });
});
