import { describe, expect, it } from "vitest";
import {
  analyzeFrontage,
  legalEdgeSetbacksFromFrontage,
} from "../lib/geo/road-frontage";

const ORIGIN: [number, number] = [127.034, 37.648];

function toLngLat(x: number, y: number): [number, number] {
  const lngScale = 111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return [ORIGIN[0] + x / lngScale, ORIGIN[1] + y / 110_540];
}

const parcel = [
  toLngLat(-10, -10),
  toLngLat(10, -10),
  toLngLat(10, 10),
  toLngLat(-10, 10),
  toLngLat(-10, -10),
];

describe("road frontage", () => {
  it("keeps both outward road edges as frontages on a corner lot", () => {
    const result = analyzeFrontage(parcel, [
      {
        name: "남측로",
        points: [toLngLat(-25, -14), toLngLat(25, -14)],
      },
      {
        name: "동측로",
        points: [toLngLat(14, -25), toLngLat(14, 25)],
      },
    ]);

    expect(result).not.toBeNull();
    expect(result!.edges.map((edge) => edge.role)).toEqual([
      "전면",
      "전면",
      "측면",
      "측면",
    ]);
    expect(result!.rearIndex).toBe(-1);
    expect(legalEdgeSetbacksFromFrontage(result)).toEqual([0, 0, 0.5, 0.5]);
  });

  it("identifies a single opposite rear edge on a four-sided parcel", () => {
    const result = analyzeFrontage(parcel, [
      {
        name: "남측로",
        points: [toLngLat(-25, -14), toLngLat(25, -14)],
      },
    ]);

    expect(result!.edges.map((edge) => edge.role)).toEqual([
      "전면",
      "측면",
      "후면",
      "측면",
    ]);
    expect(result!.frontIndex).toBe(0);
    expect(result!.rearIndex).toBe(2);
  });

  it("does not call an inward or crossing centerline a frontage", () => {
    const result = analyzeFrontage(parcel, [
      {
        name: "잘못된 내부선",
        points: [toLngLat(-25, 0), toLngLat(25, 0)],
      },
    ]);

    expect(result!.frontIndex).toBe(-1);
    expect(result!.edges.every((edge) => edge.role === "측면")).toBe(true);
  });
});
