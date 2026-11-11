import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildSteppedEnvelopeProfile, generatePlanningRecommendations, type PlanningRecommendationEngineInput, type PlanningRecommendationSet } from "@/lib/planning/recommendation-engine";
import { planningRecommendationInput, planningRecommendationInputBasis } from "@/lib/planning/recommendation-basis";
import { planningEconomicsAssumptionsFromLegacy } from "@/lib/planning/scenario-calculator";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { projectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { localParcelIntersectionArea, localParcelArea } from "@/lib/geo/parcel-topology-geometry";
import { resolvePlanningParcel } from "@/lib/planning/planning-parcel";
import { calculatePlanningSpatialValidation } from "@/lib/planning/scenario-spatial-validation";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const origin: [number, number] = [127.03, 37.65];
const point = (x: number, z: number): [number, number] => [origin[0] + x / (111000 * Math.cos(origin[1] * Math.PI / 180)), origin[1] - z / 111000];
const rect = (x: number, z: number, w: number, h: number) => [[x, z], [x + w, z], [x + w, z + h], [x, z + h]].map(([a, b]) => point(a, b));
function fixture(): PlanningRecommendationEngineInput {
  return { projectId: "recommendation-topology", generatedAt: "2026-10-28T00:00:00Z",
    assumptions: planningEconomicsAssumptionsFromLegacy(defaultAssumptions(), "topology-test"),
    parcel: { lotAreaSqm: 791, maxFARPct: 50, maxBCRPct: 100, heightLimitM: 18,
      acquisitionCostManwon: 20000, demolitionCostManwon: 1000, zoning: "일반상업지역", boundary: [],
      boundaryPolygons: [{ outer: rect(-25, -10, 20, 20), holes: [rect(-22, -7, 3, 3)] },
        { outer: rect(5, -10, 20, 20), holes: [] }],
      roads: [{ name: "Synthetic access", points: [point(-30, 13), point(30, 13)] }] } };
}

describe("full-source recommendation pipeline", () => {
  it("retains full-source scope and approval warnings when traversal expires", () => {
    let time = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => time++ === 0 ? 0 : 100000);
    try {
      const result = generatePlanningRecommendations(fixture());
      expect(result.searchStatus).toBe("incomplete");
      expect(result.profitOptimal).toBeNull();
      expect(result.warnings.join(" ")).toContain("다동");
      expect(result.warnings.join(" ")).toContain("공식 경계");
    } finally { clock.mockRestore(); }
  });
  it("caps a single building floor at one connected component, not the combined parcel area", () => {
    const input = fixture();
    const result = buildSteppedEnvelopeProfile(input.parcel, 2);
    expect(result.source).toBe("legal-envelope");
    expect(result.capacitiesSqm).toHaveLength(2);
    expect(result.capacitiesSqm.every(area => area > 350 && area < 400)).toBe(true);
    const holed = structuredClone(input.parcel);
    holed.boundaryPolygons = [holed.boundaryPolygons![0]];
    const filled = { ...holed, boundaryPolygons: [{ ...holed.boundaryPolygons[0], holes: [] }] };
    expect(buildSteppedEnvelopeProfile(holed, 1).capacitiesSqm[0])
      .toBeLessThan(buildSteppedEnvelopeProfile(filled, 1).capacitiesSqm[0]);
  });

  it.each(["empty", "bad-hole", "crossed"])("never restores BCR fallback for explicit invalid %s source", kind => {
    const input = fixture();
    input.parcel.boundary = rect(-25, -10, 20, 20);
    if (kind === "empty") input.parcel.boundaryPolygons = [];
    if (kind === "bad-hole") input.parcel.boundaryPolygons![0].holes = [rect(100, 100, 3, 3)];
    if (kind === "crossed") input.parcel.boundaryPolygons![0].outer = [point(0, 0), point(10, 10), point(10, 0), point(0, 10)];
    expect(buildSteppedEnvelopeProfile(input.parcel, 2)).toMatchObject({ source: "unavailable", capacitiesSqm: [0, 0] });
    const result = generatePlanningRecommendations(input);
    expect(result.evaluations).toEqual([]);
    expect(result.profitOptimal).toBeNull();
    expect(result.legalCeilingReference).toBeNull();
  });

  it("propagates every component and hole into recommendation freshness after JSON reload", () => {
    const data = projectWorkspaceFixture("recommendation-topology").projectData;
    data.scenarios = [];
    const { boundary, boundaryPolygons } = fixture().parcel;
    Object.assign(data.parcel, { boundary, boundaryPolygons });
    const input = planningRecommendationInput(data, data.parcel.id);
    expect(input.parcel.boundaryPolygons).toEqual(boundaryPolygons);
    const basis = planningRecommendationInputBasis(input);
    const reloaded = JSON.parse(JSON.stringify(input)) as typeof input;
    expect(planningRecommendationInputBasis(reloaded)).toBe(basis);
    reloaded.parcel.boundaryPolygons![1].outer[0][0] += 0.00001;
    expect(planningRecommendationInputBasis(reloaded)).not.toBe(basis);
    reloaded.parcel.boundaryPolygons = structuredClone(boundaryPolygons);
    reloaded.parcel.boundaryPolygons![0].holes = [];
    expect(planningRecommendationInputBasis(reloaded)).not.toBe(basis);
  });

  describe("generated candidates", () => {
    let input: PlanningRecommendationEngineInput;
    let result: PlanningRecommendationSet;
    let before: string;
    beforeAll(() => {
      input = fixture(); before = JSON.stringify(input);
      result = generatePlanningRecommendations(input);
    });

    it("generates bounded candidates without mutating source or claiming multi-building/official approval", () => {
      expect(result.evaluatedCandidates).toBeGreaterThan(0);
      expect(JSON.stringify(input)).toBe(before);
      expect(result.warnings.join(" ")).toContain("다동");
      expect(result.warnings.join(" ")).toContain("공식 경계");
      expect(result.evaluations.some(candidate => candidate.geometryEligible)).toBe(true);
    });

    it("keeps component-specific parking and preserves holes in every geometrically eligible floor", () => {
      const region = resolvePlanningParcel(input.parcel);
      expect(result.evaluations.some(candidate => candidate.parkingLayout.components.length === 2)).toBe(true);
      for (const candidate of result.evaluations.filter(c => c.geometryEligible)) {
        const spatial = calculatePlanningSpatialValidation(input.parcel.boundary, input.parcel.zoning, candidate.scenario,
          input.parcel.roads, input.parcel.setback, candidate.calculation.sunlight,
          candidate.calculation.metrics.roofAllowanceM, input.parcel.boundaryPolygons)!;
        const polygons = projectParcelPolygons(input.parcel.boundaryPolygons!, region.origin);
        for (const floor of spatial.model.floors) {
          const shape = [{ outer: floor.shape, holes: [] }];
          expect(localParcelArea(shape) - localParcelIntersectionArea(polygons, shape)).toBeLessThan(1e-4);
        }
        expect(candidate.parkingLayout.components.every(part => part.frontage?.polygonIndex === part.polygonIndex)).toBe(true);
        expect(candidate.parkingLayout.capacityCars).toBe(candidate.parkingLayout.components.reduce((sum, part) => sum + part.capacityCars, 0));
      }
    });
  });
});
