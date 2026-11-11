import { describe, expect, it } from "vitest";
import {
  calcBuildableArea,
  type LngLat,
} from "@/lib/finance/buildable-area";
import {
  evaluateSunlightRegulation,
  toSunlightGeometryProfile,
} from "@/lib/regulatory/sunlight-rules";

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

    expect(translatedNorthLine.length, JSON.stringify(result)).toBeGreaterThanOrEqual(2);
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

  it("uses cumulative actual floor heights and adds roof allowance only at the top", () => {
    const boundary = lngLatRing([
      [0, 0],
      [30, 0],
      [30, 30],
      [0, 30],
    ]);
    const sunlight = evaluateSunlightRegulation({
      context: { jurisdictionCode: "KR-11", asOf: "2026-09-08" },
      zoning: "제2종일반주거지역",
      zoningStatus: "source-backed",
      buildingHeightM: 11,
      floorsAbove: 3,
      legalUse: "detached-house",
      legalUseStatus: "source-backed",
      northBoundary: {
        adjacentZoning: "제2종일반주거지역",
        adjacentZoningStatus: "source-backed",
        separatorType: "none",
        separatorStatus: "source-backed",
      },
      daylight: {
        sameLotBuildingCount: 1,
        sameLotBuildingCountStatus: "source-backed",
      },
    });
    const result = calcBuildableArea(
      boundary,
      0,
      3,
      3.2,
      true,
      [0, 0, 0, 0],
      {
        sunlightProfile: toSunlightGeometryProfile(sunlight),
        floorHeightsM: [3.6, 3, 3],
        floorLevels: [1, 2, 3],
        roofAllowanceM: 1.4,
      }
    );

    expect(result.requiredSetbackMaxHeight).toBe(5.5);
    expect(result.stepped3D.map((step) => step.heightM)).toEqual([
      3.6,
      6.6,
      11,
    ]);
    expect(result.stepped3D.map((step) => step.requiredSetbackM)).toEqual([
      1.5,
      1.5,
      5.5,
    ]);
  });
});
