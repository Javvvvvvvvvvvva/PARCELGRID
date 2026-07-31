import { describe, expect, it } from "vitest";
import {
  normalizePlacementRotationDeg,
  pointerDeltaToPlanMeters,
  pointerRotationDeltaDeg,
  snapPlacementValue,
} from "@/lib/planning/placement-interaction";

describe("Plan Studio direct placement interaction", () => {
  it("maps responsive SVG pointer movement to LOCAL_ENU meters", () => {
    expect(
      pointerDeltaToPlanMeters({
        deltaClientX: 44,
        deltaClientY: 26,
        viewportWidthPx: 440,
        viewportHeightPx: 260,
        bounds: { minX: -10, maxX: 10, minZ: -15, maxZ: 15 },
      })
    ).toEqual({ deltaXM: 2, deltaZM: 3 });
  });

  it("preserves movement direction and safely handles a hidden viewport", () => {
    const moved = pointerDeltaToPlanMeters({
      deltaClientX: -22,
      deltaClientY: -13,
      viewportWidthPx: 440,
      viewportHeightPx: 260,
      bounds: { minX: -10, maxX: 10, minZ: -15, maxZ: 15 },
    });
    expect(moved.deltaXM).toBeCloseTo(-1, 8);
    expect(moved.deltaZM).toBeCloseTo(-1.5, 8);
    expect(
      pointerDeltaToPlanMeters({
        deltaClientX: 20,
        deltaClientY: 20,
        viewportWidthPx: 0,
        viewportHeightPx: 0,
        bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      })
    ).toEqual({ deltaXM: 0, deltaZM: 0 });
  });

  it("uses the shortest rotation when the pointer crosses the angle boundary", () => {
    const center = { x: 0, y: 0 };
    const at170 = {
      x: Math.cos((170 * Math.PI) / 180),
      y: Math.sin((170 * Math.PI) / 180),
    };
    const atMinus170 = {
      x: Math.cos((-170 * Math.PI) / 180),
      y: Math.sin((-170 * Math.PI) / 180),
    };

    expect(
      pointerRotationDeltaDeg(at170, atMinus170, center)
    ).toBeCloseTo(20, 8);
    expect(
      pointerRotationDeltaDeg({ x: 1, y: 0 }, { x: 0, y: 1 }, center)
    ).toBeCloseTo(90, 8);
  });

  it("normalizes and snaps values used by shared placement state", () => {
    expect(normalizePlacementRotationDeg(190)).toBe(-170);
    expect(normalizePlacementRotationDeg(-190)).toBe(170);
    expect(snapPlacementValue(1.249, 0.1)).toBe(1.2);
    expect(snapPlacementValue(-0.00001, 0.1)).toBe(0);
  });
});
