import { describe, expect, it } from "vitest";
import {
  planningPointToThreeShape,
  threeShapePointToPlanningWorld,
} from "@/lib/planning/three-coordinate-contract";

describe("Planning to Three.js coordinate contract", () => {
  it("preserves the planning X/Z position after the Shape geometry rotation", () => {
    const planning = { x: 12.5, z: -7.25 };
    const shape = planningPointToThreeShape(planning);
    const world = threeShapePointToPlanningWorld(shape);

    expect(shape).toEqual({ x: 12.5, y: 7.25 });
    expect(world).toEqual(planning);
  });

  it("does not mirror north and south when surfaces and direct lines share a scene", () => {
    const north = { x: 0, z: -10 };
    const south = { x: 0, z: 10 };

    expect(
      threeShapePointToPlanningWorld(planningPointToThreeShape(north)).z
    ).toBeLessThan(0);
    expect(
      threeShapePointToPlanningWorld(planningPointToThreeShape(south)).z
    ).toBeGreaterThan(0);
  });
});
