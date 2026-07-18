import { describe, expect, it } from "vitest";
import {
  calcBuildableArea,
  type LngLat,
} from "@/lib/finance/buildable-area";

const ORIGIN: LngLat = [127, 37];

function lngLatRing(pointsM: LngLat[]): LngLat[] {
  const lngScale = 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return pointsM.map(([x, y]) => [
    ORIGIN[0] + x / lngScale,
    ORIGIN[1] + y / 111_000,
  ]);
}

function toMeters(points: LngLat[]): LngLat[] {
  const lngScale = 111_000 * Math.cos((ORIGIN[1] * Math.PI) / 180);
  return points.map(([lng, lat]) => [
    (lng - ORIGIN[0]) * lngScale,
    (lat - ORIGIN[1]) * 111_000,
  ]);
}

describe("buildable-area true-north sunlight envelope", () => {
  it("uses the original north boundary so side and sunlight setbacks do not add", () => {
    const boundary = lngLatRing([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);

    const result = calcBuildableArea(
      boundary,
      0.5,
      1,
      3,
      true,
      [0.5, 0.5, 0.5, 0.5]
    );

    expect(result.afterSideSetbackSqm).toBeCloseTo(81, 1);
    // 9m 폭 × (북측 원경계 1.5m, 남측 0.5m를 뺀 8m 높이)
    expect(result.buildable2DSqm).toBeCloseTo(72, 1);
    expect(result.stepped3D[0]?.requiredSetbackM).toBe(1.5);
  });

  it("keeps a diagonal north boundary parallel after true-south translation", () => {
    const boundary = lngLatRing([
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 10],
    ]);

    const result = calcBuildableArea(
      boundary,
      0,
      1,
      3,
      true,
      [0, 0, 0, 0]
    );
    const ringM = toMeters(result.buildable2DRing ?? []);
    const translatedNorthLine = ringM.filter(([x, y]) =>
      Math.abs(y - (8.5 - 0.2 * x)) < 0.03
    );

    expect(translatedNorthLine.length).toBeGreaterThanOrEqual(2);
    const [a, b] = translatedNorthLine;
    expect((b[1] - a[1]) / (b[0] - a[0])).toBeCloseTo(-0.2, 2);
  });

  it("switches from 1.5m to half the height above 10m", () => {
    const boundary = lngLatRing([
      [0, 0],
      [30, 0],
      [30, 30],
      [0, 30],
    ]);
    const result = calcBuildableArea(boundary, 0, 4, 3, true, [0, 0, 0, 0]);

    expect(result.requiredSetbackMaxHeight).toBe(6.7);
    expect(result.stepped3D.map((step) => step.requiredSetbackM)).toEqual([
      1.5,
      1.5,
      5.2,
      6.7,
    ]);
  });
});
