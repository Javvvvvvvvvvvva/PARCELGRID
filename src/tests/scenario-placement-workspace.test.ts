import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPlacementPreviewData,
  ScenarioPlacementWorkspace,
} from "@/components/planning/ScenarioPlacementWorkspace";
import { defaultAssumptions } from "@/lib/finance/scenario";
import type { AssumptionSet } from "@/lib/finance/types";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { analyzeParcelFrontage } from "@/lib/geo/road-frontage";
import { resolvePlanningParcel } from "@/lib/planning/planning-parcel";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { assessPlanningPlacement } from "@/lib/planning/placement-assessment";
import * as calculator from "@/lib/planning/scenario-calculator";
import { calculatePlanningSpatialValidation } from "@/lib/planning/scenario-spatial-validation";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import type { PlanningScenario } from "@/lib/planning/types";
import { DEMO_PARCEL } from "@/lib/seed/demo-project";
import type { ProjectComputed } from "@/lib/services/compute-project";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const harness = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/lib/stores/project-store", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) => selector(harness.state),
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const projectId = "placement-preview";
function rect(x: number, z: number, width: number, depth: number): [number, number][] {
  return [[x, z], [x + width, z], [x + width, z + depth], [x, z + depth]].map(([east, south]) => [
    127 + east / (111_000 * Math.cos(37.65 * Math.PI / 180)), 37.65 - south / 111_000,
  ]);
}

function project(): ProjectComputed {
  const data = projectWorkspaceFixture(projectId).projectData;
  data.scenarios = [];
  Object.assign(data.parcel, structuredClone(DEMO_PARCEL), {
    id: projectId, boundary: rect(-10, -10, 20, 20), roads: [], lotArea: 400,
    acquiredPrice: 72_000, demolitionCost: 1_700,
  });
  return data;
}

function residentialScenario(): PlanningScenario {
  const scenario = createBlankPlanningScenario({ projectId, name: "Placement regression" });
  scenario.primaryUse = "multi-family";
  scenario.floorPrograms = [
    createFloorProgram(1, [createFloorZone("residential", 40, 1)], 3.2),
    createFloorProgram(2, [createFloorZone("residential", 35, 1)], 3.4),
    createFloorProgram(3, [createFloorZone("residential", 30, 1)], 3.1),
    createFloorProgram(-1, [createFloorZone("parking", 50)], 3),
  ];
  scenario.placement = { rotationDeg: 0, offsetXM: 0, offsetZM: 0, roadSetbackM: 0, northSetbackM: 0 };
  return scenario;
}

// The production workspace derives this context from the current project, not saved preview results.
function productionContext(data: ProjectComputed): calculator.PlanningCalculationContext {
  const { parcel, meta } = data;
  const legacy = data.scenarios.find(scenario => scenario.recommended)?._raw.assumptions
    ?? data.scenarios[0]?._raw.assumptions ?? defaultAssumptions();
  return {
    parcel: {
      address: parcel.address, zoning: parcel.zoning,
      zoningStatus: parcel.inputProvenance?.zoning === "vworld-land-use" ? "public-observation" : "user-entered",
      sunlightRuleAsOf: meta.lastSyncedAt.slice(0, 10),
      lotAreaSqm: parcel.lotArea, maxFARPct: parcel.maxFAR, maxBCRPct: parcel.maxBCR,
      heightLimitM: parcel.heightLimit ?? 0, regulatoryConstraints: parcel.regulatoryConstraints,
      roofAllowanceM: 1.4, acquisitionCostManwon: parcel.acquiredPrice,
      demolitionCostManwon: parcel.demolitionCost ?? 0,
    },
    assumptions: calculator.planningEconomicsAssumptionsFromLegacy(legacy, `stage2-${meta.version}`),
    calculatedAt: meta.lastSyncedAt,
  };
}

function expectProductionParity(data: ProjectComputed, scenario: PlanningScenario) {
  const preview = buildPlacementPreviewData(data, scenario)!;
  expect(preview).not.toBeNull();
  const { parcel } = data;
  const calculation = calculator.calculatePlanningScenario(scenario, productionContext(data));
  const spatial = calculatePlanningSpatialValidation(
    parcel.boundary, parcel.zoning, scenario, parcel.roads, parcel.setback,
    calculation.sunlight, calculation.metrics.roofAllowanceM, parcel.boundaryPolygons,
  )!;
  const geometry = buildPlanningGeometry({
    projectId, scenario, boundary: parcel.boundary, boundaryPolygons: parcel.boundaryPolygons,
    lotAreaSqm: parcel.lotArea, zoning: parcel.zoning, roads: parcel.roads, setback: parcel.setback,
    sunlight: calculation.sunlight, roofAllowanceM: calculation.metrics.roofAllowanceM,
  });
  expect(preview.envelopeSteps).toEqual(spatial.envelopeSteps);
  expect(preview.model).toEqual(spatial.model);
  expect(geometry.model).toMatchObject(preview.model);
  expect(preview.assessment).toEqual(spatial.assessment);
  expect(preview.assessment).toEqual(assessPlanningPlacement(geometry.model, spatial.envelopeSteps));
  expect(preview.groundPolygons).toEqual(geometry.groundPolygons);
  expect(preview.groundShape).toEqual(geometry.groundShape);
  expect(preview.warnings).toEqual(spatial.warnings);
  return { preview, calculation, geometry };
}

describe("ScenarioPlacementWorkspace production geometry parity", () => {
  it("uses calculated residential sunlight and applies roof height only to the top envelope", () => {
    const data = project();
    const scenario = residentialScenario();
    const { preview, calculation } = expectProductionParity(data, scenario);
    expect(calculation.metrics.roofAllowanceM).toBe(1.4);
    expect(preview.envelopeSteps.map(step => step.requiredSetbackM)).toEqual([1.5, 1.5, 5.55, 0]);
    const withoutRoof = calculatePlanningSpatialValidation(
      data.parcel.boundary, data.parcel.zoning, scenario, [], undefined, calculation.sunlight, 0,
    )!;
    expect(preview.envelopeSteps[2].envelopeAreaSqm).toBeLessThan(withoutRoof.envelopeSteps[2].envelopeAreaSqm);
    expect(preview.envelopeSteps[3]).toEqual(withoutRoof.envelopeSteps[3]);
    expect(preview.assessment.allFloorsFit).toBe(true);
  });

  it("uses the calculated sunlight applicability instead of matching the zoning name", () => {
    const data = project();
    data.parcel.zoning = "준주거지역";
    const scenario = residentialScenario();
    const { preview, calculation } = expectProductionParity(data, scenario);
    expect(calculation.sunlight.north.geometryApplies).toBe(false);
    expect(preview.envelopeSteps.every(step => step.requiredSetbackM === 0)).toBe(true);
    const withoutProfile = calculatePlanningSpatialValidation(data.parcel.boundary, data.parcel.zoning, scenario)!;
    expect(preview.envelopeSteps[2].envelopeAreaSqm).toBeGreaterThan(withoutProfile.envelopeSteps[2].envelopeAreaSqm);
  });

  it("preserves all components, holes and frontage, including a road beside the second component", () => {
    const data = project();
    const scenario = residentialScenario();
    scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 20, 1)], 3.2)];
    data.parcel.boundaryPolygons = [
      { outer: rect(-10, -10, 20, 20), holes: [rect(-2, -2, 4, 4)] },
      { outer: rect(30, -5, 10, 10), holes: [] },
    ];
    data.parcel.lotArea = 484;
    data.parcel.roads = [{ name: "Second component road", points: rect(42, -10, 0, 20).slice(1, 3) }];
    const { preview } = expectProductionParity(data, scenario);
    expect(preview.groundShape).toEqual([]);
    expect(preview.groundPolygons).toHaveLength(2);
    expect(preview.groundPolygons[0].holes).toHaveLength(1);
    expect(preview.envelopeSteps[0].polygons).toHaveLength(2);
    expect(preview.envelopeSteps[0].polygons![0].holes).toHaveLength(1);
    const parcel = resolvePlanningParcel(data.parcel);
    const frontage = analyzeParcelFrontage(parcel.source, data.parcel.roads, parcel.origin)!;
    const primary = frontage.frontages.reduce((best, edge) => edge.roadDistM < best.roadDistM ? edge : best);
    expect(preview.frontEdge).toEqual(primary.edge);
    expect(preview.frontageRoadName).toBe("Second component road");
    expect(preview.groundPolygons[1].outer.some(point =>
      Math.hypot(point.x - preview.frontEdge![0].x, point.z - preview.frontEdge![0].z) < 1e-6,
    )).toBe(true);
    expect(preview.frontEdgeAngleDeg).toBeCloseTo(90, 5);

    data.parcel.boundary = undefined;
    expect(buildPlacementPreviewData(data, scenario)).toEqual(preview);
    scenario.placement = { ...scenario.placement, rotationDeg: 17, offsetXM: 50, offsetZM: 3 };
    const moved = expectProductionParity(data, scenario).preview;
    expect(moved.envelopeSteps).toEqual(preview.envelopeSteps);
    expect(moved.frontEdge).toEqual(preview.frontEdge);
    expect(moved.model.floors[0].shape).not.toEqual(preview.model.floors[0].shape);
    expect(moved.assessment.allFloorsFit).toBe(false);
  });

  it("matches production for sparse, unordered floor levels with unequal heights", () => {
    const data = project();
    const scenario = residentialScenario();
    const [first, second, top, basement] = scenario.floorPrograms;
    second.level = 3;
    top.level = 7;
    scenario.floorPrograms = [top, basement, first, second];
    const { preview } = expectProductionParity(data, scenario);
    expect(preview.envelopeSteps.map(step => [step.level, step.requiredSetbackM])).toEqual([
      [7, 5.55], [-1, 0], [1, 1.5], [3, 1.5],
    ]);
    expect(preview.model.aboveGroundFloors.map(floor => floor.level)).toEqual([1, 3, 7]);
    expect(preview.model.floors.every(floor => floor.envelopeAvailable && floor.shape.length > 0)).toBe(true);
  });

  it.each([[], null, [{ outer: rect(-10, -10, 20, 20), holes: [rect(30, 30, 2, 2)] }]])(
    "does not replace unavailable authoritative topology with the legacy ring: %j", polygons => {
      const data = project();
      data.parcel.boundaryPolygons = polygons as Wgs84ParcelPolygon[];
      expect(buildPlacementPreviewData(data, residentialScenario())).toBeNull();
    },
  );

  it.each(["recommended", "first", "default"] as const)(
    "uses %s project economics and V4 calculation context without changing saved results", source => {
      const data = project();
      const scenario = residentialScenario();
      const first = { ...defaultAssumptions(), constCostPerSqM: 2_111_111 };
      const recommended = { ...defaultAssumptions(), constCostPerSqM: 3_222_222 };
      const legacyScenario = (assumptions: AssumptionSet, recommended: boolean) => ({
        recommended, _raw: { assumptions },
      } as ProjectComputed["scenarios"][number]);
      if (source !== "default") data.scenarios = [legacyScenario(first, false), legacyScenario(recommended, source === "recommended")];
      data.parcel.inputProvenance = {
        mode: "vworld", parcelFacts: "vworld-cadastral", geometry: "vworld-cadastral",
        zoning: "vworld-land-use", recordedAt: data.meta.lastSyncedAt,
      };
      const before = structuredClone({ data, scenario });
      const calculate = vi.spyOn(calculator, "calculatePlanningScenario");
      buildPlacementPreviewData(data, scenario);
      expect(calculate).toHaveBeenCalledTimes(1);
      expect(calculate).toHaveBeenCalledWith(scenario, productionContext(data));
      expect(calculate.mock.calls[0][1].assumptions.constructionCostPerSqmWon).toBe(
        source === "recommended" ? recommended.constCostPerSqM : source === "first" ? first.constCostPerSqM : defaultAssumptions().constCostPerSqM,
      );
      expect({ data, scenario }).toEqual(before);
    },
  );

  it("renders the selected project's canonical fit status and retains draft placement controls", () => {
    vi.stubGlobal("React", React);
    const data = project();
    const selected = residentialScenario();
    const other = residentialScenario();
    other.projectId = "another-project";
    const editPlanningScenarioDraft = vi.fn();
    harness.state = { data, planningScenarios: [other, selected], selectedPlanningScenarioId: selected.id, editPlanningScenarioDraft };
    const before = structuredClone({ data, selected });
    const render = () => renderToStaticMarkup(React.createElement(ScenarioPlacementWorkspace, { projectId }));
    expect(render()).toContain("배치 가능");
    expect(render()).toContain("건물 직접 배치 미리보기");
    expect(render()).toContain("<circle");
    expect(editPlanningScenarioDraft).not.toHaveBeenCalled();
    expect({ data, selected }).toEqual(before);

    selected.placement.offsetXM = 50;
    expect(expectProductionParity(data, selected).preview.assessment.allFloorsFit).toBe(false);
    const moved = render();
    expect(moved).toContain("법규 외곽선 이탈");
    expect(moved).not.toContain("배치 가능");
    expect(editPlanningScenarioDraft).not.toHaveBeenCalled();
  });
});
