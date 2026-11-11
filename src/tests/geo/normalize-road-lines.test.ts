import { describe, expect, it } from "vitest";
import { normalizeRoadLines } from "@/lib/geo/normalize-road-lines";

describe("normalizeRoadLines", () => {
  it("preserves an authoritative source part even with irregular vertex spacing", () => {
    const points: [number, number][] = [[127, 37], [127.00001, 37], [127.003, 37], [127.00301, 37]];
    expect(normalizeRoadLines([{ name: "Source road", points, topology: "source-part" }])).toEqual([{ name: "Source road", points, topology: "source-part" }]);
  });
  it("keeps a continuous road polyline intact", () => {
    const roads = normalizeRoadLines([
      {
        name: "노해로41길",
        points: [
          [127.034, 37.65],
          [127.0341, 37.65005],
          [127.0342, 37.6501],
        ],
      },
    ]);

    expect(roads).toHaveLength(1);
    expect(roads[0].points).toHaveLength(3);
  });

  it("splits a flattened MultiLineString at an outlier jump", () => {
    const roads = normalizeRoadLines([
      {
        name: "노해로41길",
        points: [
          [127.034, 37.65],
          [127.03405, 37.65],
          [127.0347, 37.65055],
          [127.03475, 37.65055],
        ],
      },
    ]);

    expect(roads).toHaveLength(2);
    expect(roads.map((road) => road.points.length)).toEqual([2, 2]);
    expect(roads.every((road) => road.name === "노해로41길")).toBe(true);
  });

  it("does not split a legitimately sparse straight road", () => {
    const roads = normalizeRoadLines([
      {
        name: null,
        points: [
          [127.034, 37.65],
          [127.0345, 37.65],
          [127.035, 37.65],
        ],
      },
    ]);

    expect(roads).toHaveLength(1);
    expect(roads[0].points).toHaveLength(3);
  });

  it("removes duplicate consecutive points and invalid short lines", () => {
    const roads = normalizeRoadLines([
      {
        name: "도로 A",
        points: [
          [127.034, 37.65],
          [127.034, 37.65],
          [127.0341, 37.65],
        ],
      },
      { name: "도로 B", points: [[127.034, 37.65]] },
    ]);

    expect(roads).toHaveLength(1);
    expect(roads[0].points).toEqual([
      [127.034, 37.65],
      [127.0341, 37.65],
    ]);
  });
});
