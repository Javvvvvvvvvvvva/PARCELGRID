import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlanningMassModel, planningEnvelopeContainsFootprint, type PlanningEnvelopeStep } from "@/lib/planning/planning-massing";
import { assessPlanningPlacement, polygonInsidePolygon } from "@/lib/planning/placement-assessment";
import { createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";

const rect = (x = 0, z = 0, w = 10, h = 10) => [{ x, z }, { x: x + w, z }, { x: x + w, z: z + h }, { x, z: z + h }];
const placement = { rotationDeg: 0, offsetXM: 0, offsetZM: 0, roadSetbackM: 0, northSetbackM: 0 };
const floor = (area = 50, level = 1) => createFloorProgram(level, [createFloorZone("residential", area, 1)], 3);
const step = (polygons: LocalParcelPolygon[], level = 1): PlanningEnvelopeStep => ({ level, polygons, shape: rect(), envelopeAreaSqm: 99999, requiredSetbackM: 0, envelopeAvailable: true });
afterEach(() => vi.restoreAllMocks());

describe("whole-region mass fitting and placement", () => {
  it("detects an enclosed hole even when all perimeter samples are inside", () => {
    const envelope = step([{ outer: rect(), holes: [rect(3, 3, 0.1, 0.1)] }]);
    expect(planningEnvelopeContainsFootprint(rect(1, 1, 8, 8), envelope)).toBe(false);
  });

  it("detects a thin concave intrusion between the old quarter-edge samples", () => {
    const concave = [[0, 0], [10, 0], [10, 10], [1.2, 10], [1.2, 5], [1.1, 5], [1.1, 10], [0, 10]].map(([x, z]) => ({ x, z }));
    expect(polygonInsidePolygon(rect(1, 1, 8, 8), concave).fits).toBe(false);
  });

  it("does not span the gap between two components or combine their floor capacities", () => {
    const envelope = step([{ outer: rect(), holes: [] }, { outer: rect(30), holes: [] }]);
    const model = buildPlanningMassModel([floor(150)], [envelope], placement);
    const mass = model.floors[0];
    expect(mass.envelopeAreaSqm).toBeCloseTo(200, 6);
    expect(mass.visualAreaSqm).toBeCloseTo(100, 6);
    expect(mass.capacityShortfallSqm).toBeCloseTo(50, 6);
    expect(mass.fitsEnvelope).toBe(false);
    expect(planningEnvelopeContainsFootprint(mass.shape, envelope)).toBe(true);
    expect(assessPlanningPlacement(model, [envelope]).allFloorsFit).toBe(false);
  });

  it("searches a viable second component instead of using only the first", () => {
    const envelope = step([{ outer: rect(0, 0, 1, 1), holes: [] }, { outer: rect(30), holes: [] }]);
    const model = buildPlanningMassModel([floor(80)], [envelope], placement);
    expect(model.floors[0].visualAreaSqm).toBeCloseTo(80, 5);
    expect(model.floors[0].shape.every(p => p.x >= 30)).toBe(true);
    expect(model.floors[0].fitsEnvelope).toBe(true);
  });

  it("generates a simple footprint that excludes a courtyard", () => {
    const envelope = step([{ outer: rect(0, 0, 20, 20), holes: [rect(8, 8, 4, 4)] }]);
    const model = buildPlanningMassModel([floor(100)], [envelope], placement);
    const mass = model.floors[0];
    expect(mass.visualAreaSqm).toBeCloseTo(100, 3);
    expect(planningEnvelopeContainsFootprint(mass.shape, envelope)).toBe(true);
    expect(mass.generationStatus).toBe("fitted");
  });

  it("does not mark a translated floor as fitting just because its area fits", () => {
    const envelope = step([{ outer: rect(), holes: [] }]);
    const mass = buildPlanningMassModel([floor()], [envelope], { ...placement, offsetXM: 20 }).floors[0];
    expect(mass.capacityShortfallSqm).toBeCloseTo(0, 6);
    expect(mass.fitsEnvelope).toBe(false);
  });

  it("does not use a first-floor fallback for a missing upper-floor envelope", () => {
    const model = buildPlanningMassModel([floor(50, 1), floor(50, 2)], [step([{ outer: rect(), holes: [] }])], placement);
    expect(model.floors[0].fitsEnvelope).toBe(true);
    expect(model.floors[1]).toMatchObject({ shape: [], envelopeAvailable: false, generationStatus: "invalid-envelope" });
  });

  it("preserves valid-empty status without using the supplied legacy ring", () => {
    const model = buildPlanningMassModel([floor()], [step([])], placement);
    expect(model.floors[0]).toMatchObject({ shape: [], envelopeAreaSqm: 0, envelopeAvailable: true, generationStatus: "empty-envelope", fitsEnvelope: false });
  });

  it.each([null, "invalid"])("does not describe malformed authoritative topology as an empty valid region: %j", polygons => {
    const envelope = { ...step([]), polygons } as unknown as PlanningEnvelopeStep;
    expect(buildPlanningMassModel([floor()], [envelope], placement).floors[0])
      .toMatchObject({ shape: [], envelopeAvailable: false, generationStatus: "invalid-envelope", fitsEnvelope: false });
  });

  it("does not claim support between separate components on consecutive floors", () => {
    const model = buildPlanningMassModel([floor(50, 1), floor(50, 2)], [step([{ outer: rect(), holes: [] }]), step([{ outer: rect(30), holes: [] }], 2)], placement);
    expect(model.floors[1].supportOverlapRatio).toBe(0);
    expect(model.floors[1].supportedByLowerFloor).toBe(false);
  });

  it("marks every remaining floor unavailable after the shared deadline", () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(2_001);
    const model = buildPlanningMassModel([floor(), floor(50, 2)], [step([{ outer: rect(), holes: [] }])], placement);
    expect(model.floors.every(f => f.generationStatus === "budget-exhausted" && !f.fitsEnvelope && !f.envelopeAvailable)).toBe(true);
  });
});
