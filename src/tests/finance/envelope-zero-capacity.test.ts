import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScenarioComparison } from "@/lib/finance/scenario-verdict";
import type { Parcel } from "@/lib/finance/types";
import { unprojectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { buildSteppedEnvelopeProfile } from "@/lib/planning/recommendation-engine-v2";

function parcel(w = 10, h = 4): Parcel {
  const boundary = unprojectParcelPolygons([{ outer: [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: h }, { x: 0, z: h }], holes: [] }], [127, 37])[0].outer;
  return { id: "synthetic", address: "서울 합성 필지", addressRoad: "", lotArea: w * h, boundary, zoning: "제2종일반주거지역", zoneCode: "", maxFAR: 400, maxBCR: 100,
    heightLimit: 0, setback: { road: 0.5, side: 0.5, rear: 0.5 }, landPrice: 1, estMarketPrice: 1, acquired: "2026-10-27", acquiredPrice: 1 };
}
beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("envelope capacity is not a truthy fallback", () => {
  it("does not resurrect an erased top level as full BCR area", () => {
    const result = buildScenarioComparison("multi-family", parcel());
    // Three lower levels: (10 - 2*0.5)*(4 - 0.5 - 1.5)=18 each. Top level is empty.
    expect(result.max.geometryStatus).toBe("available");
    expect(result.max.buildable2DSqm).toBe(0);
    expect(result.max.gfaSqm).toBeCloseTo(54, 2);
  });
  it("keeps a fully erased parcel at zero with zero automatically generated units", () => {
    const result = buildScenarioComparison("multi-family", parcel(0.4, 10));
    for (const option of [result.max, result.recommended]) {
      expect(option.geometryStatus).toBe("available");
      expect(option.gfaSqm).toBe(0);
      expect(option.units).toBe(0);
      expect(option.score).toBe(0);
      expect(option.parkingSufficient).toBeNull();
    }
  });
  it("uses null capacity for missing geometry, not zero or theoretical BCR", () => {
    const input = parcel(); delete input.boundary;
    const result = buildScenarioComparison("multi-family", input);
    expect(result.max).toMatchObject({ geometryStatus: "unavailable", gfaSqm: null, farUsedPct: null, buildable2DSqm: null, score: 0 });
  });
  it("does not claim a combined discontinuous floor in the legacy comparison", () => {
    const input = parcel();
    input.boundaryPolygons = [{ outer: input.boundary!, holes: [] }, { outer: input.boundary!.map(([lng, lat]) => [lng + 0.001, lat]), holes: [] }];
    input.boundary = [];
    expect(buildScenarioComparison("multi-family", input).max).toMatchObject({ geometryStatus: "unavailable", gfaSqm: null });
  });
  it("keeps zero upper capacities in the recommendation profile", () => {
    const input = parcel();
    const result = buildSteppedEnvelopeProfile({ boundary: input.boundary, lotAreaSqm: 40, maxFARPct: 400, maxBCRPct: 100, zoning: input.zoning, heightLimitM: 0,
      acquisitionCostManwon: 0, demolitionCostManwon: 0 }, 4);
    expect(result.capacitiesSqm[0]).toBeGreaterThan(0);
    expect(result.capacitiesSqm[3]).toBe(0);
  });
});
