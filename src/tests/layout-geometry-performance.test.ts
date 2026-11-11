import { beforeEach, describe, expect, it, vi } from "vitest";
import { featureCollection, intersect, polygon } from "@turf/turf";
import { planContains, planIntersectionArea, planRectangle, type PlanPoint } from "@/lib/planning/layout-geometry";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";

vi.mock("@turf/turf", async importOriginal => {
  const actual = await importOriginal<typeof import("@turf/turf")>();
  return { ...actual, intersect: vi.fn(actual.intersect) };
});
const turf = await vi.importActual<typeof import("@turf/turf")>("@turf/turf");

// Reference is the pre-optimization algorithm, including its precision grid.
function referenceIntersection(a: PlanPoint[], b: PlanPoint[]) {
  if (a.length < 3 || b.length < 3) return 0;
  const feature = (points: PlanPoint[]) => {
    const ring = points.map(p => [Math.round(p.x * 1e8) / 1e8, Math.round(p.z * 1e8) / 1e8]);
    if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) ring.push([...ring[0]]);
    return polygon([ring]);
  };
  const clipped = turf.intersect(featureCollection([feature(a), feature(b)]));
  if (!clipped) return 0;
  const polygons = clipped.geometry.type === "Polygon" ? [clipped.geometry.coordinates] : clipped.geometry.coordinates;
  return polygons.reduce((sum, rings) => sum + rings.reduce((area, ring, i) =>
    area + (i === 0 ? 1 : -1) * polygonAreaSqm(ring.map(([x, z]) => ({ x, z }))), 0), 0);
}
const rectangle = (x = 0, z = 0, degrees = 0) => planRectangle({ x, z }, 4, 4, degrees);

beforeEach(() => vi.clearAllMocks());

describe("plan intersection broad phase", () => {
  it.each([[5, 0], [0, 5], [-5, 0], [0, -5], [4, 0], [4, 4]])(
    "skips clipping only for separated/touching valid rings at %s,%s", (x, z) => {
      const a = rectangle(), b = rectangle(x, z);
      expect(planIntersectionArea(a, b)).toBe(referenceIntersection(a, b));
      expect(intersect).not.toHaveBeenCalled();
    });

  it.each([4 - 4e-9, 4 - 6e-9, 4 + 4e-9, 4 + 6e-9, 4 - 1e-5])(
    "uses the same snapped coordinates near a shared edge (%s)", x => {
      const a = rectangle(), b = rectangle(x);
      expect(planIntersectionArea(a, b)).toBe(referenceIntersection(a, b));
      expect(planIntersectionArea(b, a)).toBe(referenceIntersection(b, a));
    });

  it("keeps clipping for overlapping bounds even when polygons are separate", () => {
    const a = rectangle(0, 0, 45), b = rectangle(3, 3, 45);
    expect(planIntersectionArea(a, b)).toBe(referenceIntersection(a, b));
    expect(intersect).toHaveBeenCalledOnce();
  });

  it("retains a nonzero thin overlap", () => {
    const a = rectangle(), b = rectangle(4 - 1e-5);
    expect(planIntersectionArea(a, b)).toBeGreaterThan(1e-5);
    expect(planIntersectionArea(a, b)).toBe(referenceIntersection(a, b));
    expect(intersect).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ x: 0, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }, { x: 2, z: 0 }],
    [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }],
    [{ x: 0, z: 0 }, { x: 1e-10, z: 0 }, { x: 0, z: 1e-10 }],
    [{ x: NaN, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }],
  ].map((points, index) => ({ points, index })))("does not fast-accept invalid or collapsed rings ($index)", ({ points }) => {
    const capture = (run: () => number) => {
      try { return { value: run() }; } catch (error) { return { error: (error as Error).message }; }
    };
    const expected = capture(() => referenceIntersection(points, rectangle(20)));
    expect(capture(() => planIntersectionArea(points, rectangle(20)))).toEqual(expected);
    if ("value" in expected) expect(intersect).toHaveBeenCalledOnce();
  });

  it("does not keep stale bounds after input mutation", () => {
    const a = rectangle(), b = rectangle(10);
    expect(planIntersectionArea(a, b)).toBe(0);
    b.forEach(p => { p.x -= 9; });
    expect(planIntersectionArea(a, b)).toBe(12);
    expect(intersect).toHaveBeenCalledOnce();
  });

  it("keeps complex rings on Turf without adding quadratic validity checks", () => {
    const ring = Array.from({ length: 128 }, (_, i) => ({ x: Math.cos(i * Math.PI / 64), z: Math.sin(i * Math.PI / 64) }));
    expect(planIntersectionArea(ring, rectangle(20))).toBe(referenceIntersection(ring, rectangle(20)));
    expect(intersect).toHaveBeenCalledOnce();
  });

  it("preserves winding, closed rings, concavity and containment", () => {
    const concave = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 2 },
      { x: 2, z: 2 }, { x: 2, z: 6 }, { x: 0, z: 6 }];
    const rings = [concave, [...concave].reverse(), [...concave, concave[0]], rectangle(12), rectangle(3, 3), rectangle(1, 1)];
    for (const a of rings) for (const b of rings) {
      expect(planIntersectionArea(a, b)).toBe(referenceIntersection(a, b));
    }
    expect(planContains(concave, rectangle(3, 3))).toBe(false);
    expect(planContains(planRectangle({ x: 0, z: 0 }, 20, 20), rectangle())).toBe(true);
  });

  it("matches Turf exactly across deterministic rotated and translated pairs", () => {
    let seed = 20261104;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let i = 0; i < 160; i++) {
      const offset = i % 3 === 0 ? 500_000 : 0;
      const a = planRectangle({ x: offset + random() * 10, z: offset + random() * 10 }, 1 + random() * 8, 1 + random() * 8, random() * 360);
      const b = planRectangle({ x: offset + random() * 10, z: offset + random() * 10 }, 1 + random() * 8, 1 + random() * 8, random() * 360);
      expect(planIntersectionArea(a, b)).toBe(referenceIntersection(a, b));
      expect(planIntersectionArea(b, a)).toBe(referenceIntersection(b, a));
    }
  });
});
