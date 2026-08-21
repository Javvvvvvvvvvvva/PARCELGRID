import { describe, expect, it } from "vitest";
import {
  buildCompGeocodeQuery,
  coordinateDistanceKm,
  extractAdministrativeArea,
  extractDong,
  scatterApproximateCoordinate,
} from "../lib/geo/comps-geocode";

describe("comp geocoding helpers", () => {
  it("combines a masked dong with the subject administrative area", () => {
    expect(
      buildCompGeocodeQuery(
        "쌍문동 2*",
        "서울특별시 도봉구 쌍문동 281-23",
      ),
    ).toBe("서울특별시 도봉구 쌍문동");

    expect(
      buildCompGeocodeQuery(
        "정자동 1*",
        "경기도 성남시 분당구 정자동 178-1",
      ),
    ).toBe("경기도 성남시 분당구 정자동");
  });

  it("does not fabricate a query without locality or regional context", () => {
    expect(extractDong("지번 미상")).toBeNull();
    expect(extractAdministrativeArea("")).toBeNull();
    expect(buildCompGeocodeQuery("지번 미상", "서울특별시 도봉구")).toBeNull();
  });

  it("keeps deterministic marker scattering within a small local radius", () => {
    const origin = { lat: 37.648, lng: 127.034 };
    const points = Array.from({ length: 40 }, (_, index) =>
      scatterApproximateCoordinate(origin.lat, origin.lng, index),
    );

    for (const point of points) {
      expect(coordinateDistanceKm(origin, point)).toBeLessThan(0.15);
    }
    expect(points[0]).toEqual(
      scatterApproximateCoordinate(origin.lat, origin.lng, 0),
    );
  });
});
