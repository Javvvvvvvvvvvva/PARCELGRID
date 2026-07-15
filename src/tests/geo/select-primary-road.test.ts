import { describe, expect, it } from "vitest";
import { selectPrimaryRoad } from "@/lib/geo/select-primary-road";

const parcel = [
  { x: -5, z: -8 },
  { x: 5, z: -8 },
  { x: 5, z: 8 },
  { x: -5, z: 8 },
];

describe("selectPrimaryRoad", () => {
  it("selects the road parallel to the east frontage", () => {
    const selection = selectPrimaryRoad(parcel, [
      {
        name: "노해로41길",
        points: [
          { x: 7, z: -20 },
          { x: 7, z: 20 },
        ],
      },
      {
        name: "원거리 도로",
        points: [
          { x: -20, z: 15 },
          { x: 20, z: 15 },
        ],
      },
    ]);

    expect(selection?.roadIndex).toBe(0);
    expect(selection?.boundarySegmentIndex).toBe(1);
    expect(selection?.alignment).toBeGreaterThan(0.99);
    expect(selection?.distanceM).toBeCloseTo(2, 5);
  });

  it("prefers a parallel frontage over a similarly close perpendicular segment", () => {
    const selection = selectPrimaryRoad(parcel, [
      {
        name: "평행 도로",
        points: [
          { x: 7.5, z: -20 },
          { x: 7.5, z: 20 },
        ],
      },
      {
        name: "교차 도로",
        points: [
          { x: 5.2, z: 0 },
          { x: 12, z: 0 },
        ],
      },
    ]);

    expect(selection?.roadIndex).toBe(0);
    expect(selection?.alignment).toBeGreaterThan(0.99);
  });

  it("returns null when every road is outside the frontage search distance", () => {
    const selection = selectPrimaryRoad(parcel, [
      {
        name: "먼 도로",
        points: [
          { x: 30, z: -20 },
          { x: 30, z: 20 },
        ],
      },
    ]);

    expect(selection).toBeNull();
  });
});
