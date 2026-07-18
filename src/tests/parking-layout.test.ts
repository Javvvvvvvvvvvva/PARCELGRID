import { describe, expect, it } from "vitest";
import { calculateParkingLayout } from "@/lib/planning/parking-layout";

const piloti = [
  { x: -5, z: -8 },
  { x: 5, z: -8 },
  { x: 5, z: 8 },
  { x: -5, z: 8 },
];

const parcel = [
  { x: -10, z: -8 },
  { x: 10, z: -8 },
  { x: 10, z: 8 },
  { x: -10, z: 8 },
];

const baseParking = {
  strategy: "piloti" as const,
  providedCars: 0,
  orientation: "auto" as const,
  stallWidthM: 2.5,
  stallDepthM: 5,
  aisleWidthM: 6,
  entryWidthM: 3,
  coreAreaSqm: 0,
  columnLossPct: 0,
};

describe("Stage 2 parking layout", () => {
  it("places a double-loaded piloti parking row when width and depth allow it", () => {
    const result = calculateParkingLayout({
      strategy: "piloti",
      parcelShape: parcel,
      pilotiShape: piloti,
      pilotiEnabled: true,
      requiredCars: 2,
      frontEdge: [parcel[0], parcel[1]],
      parking: baseParking,
    });

    expect(result.supportedStrategy).toBe(true);
    expect(result.capacityCars).toBe(8);
    expect(result.stalls).toHaveLength(8);
    expect(result.shortfallCars).toBe(0);
    expect(result.aisleShape).toHaveLength(4);
  });

  it("excludes the building footprint from surface parking candidates", () => {
    const building = [
      { x: -4, z: -4 },
      { x: 4, z: -4 },
      { x: 4, z: 4 },
      { x: -4, z: 4 },
    ];
    const result = calculateParkingLayout({
      strategy: "surface",
      parcelShape: parcel,
      buildingShape: building,
      requiredCars: 2,
      frontEdge: [parcel[0], parcel[1]],
      parking: { ...baseParking, strategy: "surface" },
    });

    expect(result.supportedStrategy).toBe(true);
    expect(result.capacityCars).toBeGreaterThan(0);
    expect(
      result.stalls.every((stall) =>
        stall.corners.every(
          (point) => Math.abs(point.x) >= 4 || Math.abs(point.z) >= 4
        )
      )
    ).toBe(true);
  });

  it("uses direct frontage access on small sites without forcing a 6m internal aisle", () => {
    const smallParcel = [
      { x: -5, z: -6 },
      { x: 5, z: -6 },
      { x: 5, z: 6 },
      { x: -5, z: 6 },
    ];
    const rearBuilding = [
      { x: -4, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 5 },
      { x: -4, z: 5 },
    ];
    const result = calculateParkingLayout({
      strategy: "surface",
      parcelShape: smallParcel,
      buildingShape: rearBuilding,
      requiredCars: 2,
      frontEdge: [smallParcel[0], smallParcel[1]],
      parking: { ...baseParking, strategy: "surface" },
    });

    expect(result.capacityCars).toBe(3);
    expect(result.accessMode).toBe("direct-frontage");
    expect(result.aisleShape).toHaveLength(0);
    expect(result.requiredDepthM).toBe(5);
    expect(result.warnings.join(" ")).toContain("직접진입");
  });

  it("keeps site and depth diagnostics visible when no stall fits", () => {
    const tinyParcel = [
      { x: -2, z: -2 },
      { x: 2, z: -2 },
      { x: 2, z: 2 },
      { x: -2, z: 2 },
    ];
    const result = calculateParkingLayout({
      strategy: "surface",
      parcelShape: tinyParcel,
      requiredCars: 1,
      frontEdge: [tinyParcel[0], tinyParcel[1]],
      parking: { ...baseParking, strategy: "surface" },
    });

    expect(result.capacityCars).toBe(0);
    expect(result.supportedStrategy).toBe(true);
    expect(result.targetShape).toEqual(tinyParcel);
    expect(result.usableAreaSqm).toBe(16);
    expect(result.requiredDepthM).toBe(5);
  });

  it("blocks piloti capacity when the first floor has no piloti program", () => {
    const result = calculateParkingLayout({
      strategy: "piloti",
      parcelShape: parcel,
      pilotiShape: piloti,
      pilotiEnabled: false,
      requiredCars: 2,
      parking: baseParking,
    });

    expect(result.supportedStrategy).toBe(false);
    expect(result.capacityCars).toBe(0);
    expect(result.shortfallCars).toBe(2);
    expect(result.warnings.join(" ")).toContain("필로티");
  });
});
