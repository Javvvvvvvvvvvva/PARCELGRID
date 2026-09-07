import { describe, expect, it } from "vitest";
import {
  boundaryAreaDifferencePct,
  boundaryCenterDistanceM,
  parseManualParcelBoundaryGeoJson,
} from "@/lib/geo/manual-parcel-boundary";

const RING = [
  [127.034, 37.648],
  [127.0341, 37.648],
  [127.0341, 37.6481],
  [127.034, 37.6481],
];

describe("manual parcel GeoJSON", () => {
  it("accepts one WGS84 Polygon and closes its outer ring", () => {
    const parsed = parseManualParcelBoundaryGeoJson(
      JSON.stringify({ type: "Polygon", coordinates: [RING] }),
    );

    expect(parsed.boundary).toHaveLength(5);
    expect(parsed.boundary[0]).toEqual(parsed.boundary[4]);
    expect(parsed.center.lat).toBeCloseTo(37.64805, 5);
    expect(parsed.measuredAreaSqm).toBeGreaterThan(90);
    expect(parsed.measuredAreaSqm).toBeLessThan(110);
  });

  it("accepts a single Polygon Feature inside a FeatureCollection", () => {
    const parsed = parseManualParcelBoundaryGeoJson(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [RING] },
          },
        ],
      }),
    );

    expect(parsed.boundary[0]).toEqual([127.034, 37.648]);
  });

  it("rejects ambiguous collections and reversed coordinate order", () => {
    expect(() =>
      parseManualParcelBoundaryGeoJson(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
      ),
    ).toThrow("한 개만");
    expect(() =>
      parseManualParcelBoundaryGeoJson(
        JSON.stringify({
          type: "Polygon",
          coordinates: [[[37.648, 127.034], [37.649, 127.034], [37.648, 127.035]]],
        }),
      ),
    ).toThrow("국내 WGS84");
  });

  it("rejects a self-intersecting parcel ring", () => {
    expect(() =>
      parseManualParcelBoundaryGeoJson(
        JSON.stringify({
          type: "Polygon",
          coordinates: [[
            [127.034, 37.648],
            [127.0341, 37.6481],
            [127.034, 37.6481],
            [127.0341, 37.648],
          ]],
        }),
      ),
    ).toThrow("서로 교차");
  });

  it("reports the official-to-measured area difference", () => {
    expect(boundaryAreaDifferencePct(100, 105)).toBe(5);
    expect(boundaryAreaDifferencePct(0, 105)).toBeNull();
    expect(
      boundaryCenterDistanceM(
        { lat: 37.64805, lng: 127.03405 },
        { lat: 37.64805, lng: 127.03405 },
      ),
    ).toBe(0);
  });
});
