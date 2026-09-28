import { describe, expect, it } from "vitest";
import { calculateSolarAccess, solarDirection } from "@/lib/planning/solar-access";
import { interiorFixture } from "./helpers/interior-fixture";

describe("proposed-mass-only solar access", () => {
  it("converts SunCalc v2 degrees to the planning east/north axes", () => {
    expect(solarDirection(0, 0).toArray()).toEqual([0, 0, -1]);
    expect(solarDirection(90, 0).x).toBeCloseTo(1);
    expect(solarDirection(180, 0).z).toBeCloseTo(1);
    expect(solarDirection(0, 90).y).toBeCloseTo(1);
  });

  it("traces shadows from actual plan geometry and uses Korean local time", () => {
    const { initial } = interiorFixture();
    const input = { planning: initial, date: "2026-12-21", startHour: 9, endHour: 15, stepMinutes: 30 };
    const result = calculateSolarAccess(input);
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.some(p => p.sunnyMinutes < 360)).toBe(true);
    expect(result.points.some(p => p.sunnyMinutes === 360)).toBe(true);
    expect(result).toMatchObject({ geometryHash: initial.geometryHash, timezone: "Asia/Seoul", coverage: "proposed-mass-only", sampledMinutes: 360 });
    expect(calculateSolarAccess({ ...input, startHour: 0, endHour: 3 }).points.every(p => p.sunnyMinutes === 0)).toBe(true);
  });

  it("does not count more than the requested duration and rejects invalid dates", () => {
    const planning = interiorFixture().initial;
    planning.building.aboveGroundFloors = [];
    const input = { planning, date: "2026-06-21", startHour: 12, endHour: 13.25, stepMinutes: 30 };
    expect(calculateSolarAccess(input).points.every(p => p.sunnyMinutes === 75)).toBe(true);
    expect(() => calculateSolarAccess({ ...input, date: "2026-02-31" })).toThrow();
    expect(() => calculateSolarAccess({ ...input, stepMinutes: 0 })).toThrow();
  });
});
