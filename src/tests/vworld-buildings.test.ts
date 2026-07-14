import { describe, expect, it } from "vitest";
import type { BuildingPolygon, LngLat } from "@/lib/geo/existing-building-geometry";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import {
  attachExistingBuildingGeometry,
  calculateFootprintParcelOverlap,
  normalizeViolationStatus,
  parseBuildingFeatureCollection,
} from "@/lib/integrations/vworld-buildings";

const PNU = "1132010500102810023";
const boundary: LngLat[] = [
  [127.0319, 37.6499],
  [127.0322, 37.6499],
  [127.0322, 37.6502],
  [127.0319, 37.6502],
  [127.0319, 37.6499],
];
const center = { lng: 127.03205, lat: 37.65005 };

function polygon(lngOffset = 0, latOffset = 0): BuildingPolygon {
  return [
    [
      [127.03198 + lngOffset, 37.64998 + latOffset],
      [127.03212 + lngOffset, 37.64998 + latOffset],
      [127.03212 + lngOffset, 37.65012 + latOffset],
      [127.03198 + lngOffset, 37.65012 + latOffset],
      [127.03198 + lngOffset, 37.64998 + latOffset],
    ],
  ];
}

function rectangle(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number
): BuildingPolygon {
  return [
    [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ],
  ];
}

function feature(pnu: string, id: string, coordinates: BuildingPolygon = polygon()) {
  return {
    type: "Feature",
    id,
    geometry: { type: "MultiPolygon", coordinates: [coordinates] },
    properties: {
      pnu,
      buld_idntfc_no: id,
      buld_nm: "테스트 건물",
      ar: "55.2",
      totar: "110.4",
      hg: "6.1",
      ground_floor_co: "2",
      undgrnd_floor_co: "1",
      use_confm_de: "19740115",
      violt_bild: "N",
    },
  };
}

describe("VWorld dt_d010 building geometry", () => {
  it("selects all exact-PNU footprints and preserves MultiPolygon coordinates", () => {
    const result = parseBuildingFeatureCollection(
      {
        type: "FeatureCollection",
        features: [
          feature(PNU, "main"),
          feature(PNU, "annex", polygon(0.00002, 0.00002)),
          feature("1132010500109990001", "neighbor", polygon(0.001, 0.001)),
        ],
      },
      { pnu: PNU, boundary, center }
    );

    expect(result.status).toBe("matched");
    expect(result.queryFeatureCount).toBe(3);
    expect(result.footprints).toHaveLength(2);
    expect(result.footprints.every((item) => item.matchMethod === "pnu")).toBe(true);
    expect(result.footprints.every((item) => item.parcelOverlapStatus === "verified")).toBe(true);
    expect(result.footprints[0].polygons[0][0].length).toBeGreaterThanOrEqual(4);
  });

  it("normalizes EPSG:4326 axis-swapped coordinates around the target parcel", () => {
    const swapped: BuildingPolygon = polygon().map((ring) =>
      ring.map(([lng, lat]) => [lat, lng] as LngLat)
    );
    const result = parseBuildingFeatureCollection(
      { type: "FeatureCollection", features: [feature(PNU, "swapped", swapped)] },
      { pnu: PNU, boundary, center }
    );

    const first = result.footprints[0].polygons[0][0][0];
    expect(first[0]).toBeGreaterThan(120);
    expect(first[1]).toBeLessThan(40);
  });

  it("uses parcel intersection only when PNU is unavailable", () => {
    const noPnu = feature("", "geometry-match");
    const outside = feature("", "outside", polygon(0.01, 0.01));
    const result = parseBuildingFeatureCollection(
      { type: "FeatureCollection", features: [noPnu, outside] },
      { pnu: PNU, boundary, center }
    );

    expect(result.footprints).toHaveLength(1);
    expect(result.footprints[0].id).toBe("geometry-match");
    expect(result.footprints[0].matchMethod).toBe("geometry");
    expect(result.rejectedFootprintCount).toBe(1);
  });

  it("rejects an exact-PNU footprint when less than 60% lies inside the parcel", () => {
    const mostlyOutside = rectangle(127.03217, 37.64998, 127.03231, 37.65012);
    const result = parseBuildingFeatureCollection(
      { type: "FeatureCollection", features: [feature(PNU, "wrong-pnu-shape", mostlyOutside)] },
      { pnu: PNU, boundary, center }
    );

    expect(result.status).toBe("not_found");
    expect(result.footprints).toHaveLength(0);
    expect(result.rejectedFootprintCount).toBe(1);
  });

  it("keeps a 60-85% boundary-straddling footprint but marks it for review", () => {
    const boundaryStraddling = rectangle(127.0321, 37.64998, 127.03224, 37.65012);
    const overlap = calculateFootprintParcelOverlap([boundaryStraddling], boundary);
    const result = parseBuildingFeatureCollection(
      { type: "FeatureCollection", features: [feature(PNU, "boundary-building", boundaryStraddling)] },
      { pnu: PNU, boundary, center }
    );

    expect(overlap).toBeGreaterThan(0.6);
    expect(overlap).toBeLessThan(0.85);
    expect(result.status).toBe("matched");
    expect(result.footprints[0].parcelOverlapStatus).toBe("review");
    expect(result.reviewFootprintCount).toBe(1);
  });

  it("attaches geometry without replacing MOLIT building attributes", () => {
    const geometry = parseBuildingFeatureCollection(
      { type: "FeatureCollection", features: [feature(PNU, "main")] },
      { pnu: PNU, boundary, center }
    );
    const current: BuildingLookupResult = {
      hasBuilding: true,
      buildings: [
        {
          name: "기존 건물",
          mainPurpose: "단독주택",
          detailPurpose: "다가구주택",
          groundFloors: 2,
          undergroundFloors: 1,
          totalArea: 119.88,
          buildingArea: 67.77,
          buildingCoverage: 55.5,
          floorAreaRatio: 87.6,
          structure: "철근콘크리트구조",
          height: 6,
          approvalDate: "1974-01-15",
          ageYears: 52,
          isMainBuilding: true,
          householdCount: 0,
          familyCount: 3,
          unitCount: 0,
        },
      ],
      totalBuildingArea: 119.88,
      oldestApprovalDate: "1974-01-15",
      maxAgeYears: 52,
      averageAgeYears: 52,
      redevelopmentSignal: "rebuild",
      signalLabel: "노후 건물",
      signalReasoning: "52년 경과",
    };

    const merged = attachExistingBuildingGeometry(current, geometry, 122.1);
    expect(merged?.buildings[0].detailPurpose).toBe("다가구주택");
    expect(merged?.geometry.footprints[0].id).toBe("main");
  });

  it("does not over-interpret unknown violation codes", () => {
    expect(normalizeViolationStatus("Y")).toBe("yes");
    expect(normalizeViolationStatus("N")).toBe("no");
    expect(normalizeViolationStatus("02")).toBe("unknown");
  });
});
