import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanningGeometryContractPanel } from "@/components/planning/PlanningGeometryContractPanel";
import { CadastralRoadContextPanel } from "@/components/planning/CadastralRoadContextPanel";
import { PlanningSiteContextPanel } from "@/components/planning/PlanningSiteContextPanel";
import { PlanningScenarioWorkspaceV4 } from "@/components/planning/PlanningScenarioWorkspaceV4";
import { SketchupSiteExportPanel } from "@/components/planning/SketchupSiteExportPanel";
import type { ParcelBoundaryInput } from "@/lib/geo/parcel-topology";
import * as cadastral from "@/lib/geo/cadastral-context";
import * as geometry from "@/lib/planning/planning-geometry";
import * as parking from "@/lib/planning/planning-parking-geometry";
import * as spatial from "@/lib/planning/scenario-spatial-validation";
import * as calculator from "@/lib/planning/scenario-calculator";
import { defaultAssumptions } from "@/lib/finance/scenario";
import type { AssumptionSet } from "@/lib/finance/types";
import * as packages from "@/lib/planning/sketchup-export-package";
import * as audits from "@/lib/planning/site-delivery-audit";
import { createBlankPlanningScenario, createFloorProgram, createFloorZone } from "@/lib/planning/scenario-utils";
import type { PlanningScenario } from "@/lib/planning/types";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>, hooks: [] as unknown[], cursor: 0,
  panels: [] as ReactNode[], fetch: vi.fn(), massing: vi.fn(() => null),
  parkingSequence: vi.fn(() => null),
  linework: vi.fn(), sketchup: vi.fn(), cad: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    const index = harness.cursor++;
    return index < harness.hooks.length ? [harness.hooks[index], vi.fn()] : actual.useState(initial);
  } };
});
vi.mock("@/lib/stores/project-store", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) => selector(harness.state),
}));
vi.mock("@/lib/auth/client-session", () => ({
  sessionFetch: harness.fetch, sessionLocalStorage: { setItem: vi.fn() },
}));
vi.mock("@/lib/planning/cadastral-linework-export", () => ({ downloadCadastralLineworkPackage: harness.linework }));
vi.mock("@/lib/planning/sketchup-site-delivery-export", () => ({ downloadSketchupSiteDeliveryExport: harness.sketchup }));
vi.mock("@/lib/planning/planning-cad-export", () => ({ downloadPlanningCadPackage: harness.cad }));
vi.mock("@react-three/fiber", () => ({ Canvas: () => null, useThree: vi.fn() }));
vi.mock("@react-three/drei", () => ({ Line: () => null, OrbitControls: () => null, Text: () => null }));
vi.mock("@/components/ui/primitives", () => ({
  Panel: ({ children }: { children: ReactNode }) => {
    harness.panels.push(children);
    return React.createElement("div", null, children);
  },
  SectionTitle: () => null,
}));
vi.mock("@/components/planning/PlanningMassingView", () => ({ PlanningMassingView: harness.massing }));
vi.mock("@/components/planning/FloorProgramEditor", () => ({ FloorProgramEditor: () => null }));
vi.mock("@/components/planning/DwellingAssumptionsEditor", () => ({ DwellingAssumptionsEditor: () => null }));
vi.mock("@/components/planning/PlanningGuidedEditor", () => ({ PlanningGuidedEditor: () => null }));
vi.mock("@/components/planning/PlanningGeometrySourcePanel", () => ({ PlanningGeometrySourcePanel: () => null }));
vi.mock("@/components/planning/PlanningParkingSequencePanel", () => ({ PlanningParkingSequencePanel: harness.parkingSequence }));
vi.mock("@/components/planning/PlanningMaterialEditor", () => ({ PlanningMaterialEditor: () => null }));
vi.mock("@/components/planning/PlanningLayoutVerification", () => ({ PlanningLayoutVerification: () => null }));

const projectId = "parent-boundary";
function ring(x: number, z: number, width: number, depth: number): [number, number][] {
  return [[x, z], [x + width, z], [x + width, z + depth], [x, z + depth]].map(([east, south]) => [
    127 + east / (111_000 * Math.cos(37 * Math.PI / 180)), 37 - south / 111_000,
  ]);
}
const legacy = ring(-15, -15, 30, 30);
const full = [
  { outer: legacy, holes: [ring(8, 8, 3, 3)] },
  { outer: ring(40, 0, 10, 10), holes: [] },
];
const panels = [
  PlanningGeometryContractPanel, CadastralRoadContextPanel, PlanningSiteContextPanel,
  SketchupSiteExportPanel, PlanningScenarioWorkspaceV4,
];
let data: ReturnType<typeof projectWorkspaceFixture>["projectData"];
let planning: geometry.PlanningGeometrySnapshot;
let basePackage: packages.SketchupExportPackageSnapshot;
let context: cadastral.CadastralContextSnapshot;
let audit: ReturnType<typeof audits.buildSiteDeliveryAudit>;
let road: cadastral.CadastralParcelFeature;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  data = projectWorkspaceFixture(projectId).projectData;
  data.scenarios = [];
  Object.assign(data.parcel, {
    lat: 37, lng: 127, boundary: legacy, lotArea: 900, maxBCR: 60, maxFAR: 250,
    heightLimit: 30, acquiredPrice: 20000, zoning: "일반상업지역",
    roads: [], setback: { road: 0, side: 0, rear: 0 },
  });
  const scenario = createBlankPlanningScenario({ projectId, name: "Boundary plumbing" });
  scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 100, 1)])];
  const result = geometry.buildPlanningGeometry({
    projectId, scenario, boundary: legacy, lotAreaSqm: 900,
    zoning: data.parcel.zoning, roads: [], setback: data.parcel.setback,
  });
  planning = result.snapshot;
  const parkingResult = parking.buildPlanningParkingGeometry({
    scenario, planning, boundary: legacy, requiredCars: 0, roads: [],
  });
  basePackage = packages.buildSketchupExportPackage({ planning });
  road = {
    pnu: "road", jibun: "Road", jimok: "도로", jimokCode: "14", lotAreaSqm: 180,
    boundary: ring(15, -15, 6, 30), distanceM: 0, boundarySource: "continuous-cadastral",
  };
  context = cadastral.buildCadastralContext({ planning, targetPnu: projectId, parcels: [road] });
  audit = audits.buildSiteDeliveryAudit({ planning, context: basePackage.context, cadastral: context });
  // Isolate parent forwarding and gates from backend geometry/export acceptance.
  basePackage.validation.exportable = true;
  context.validation = { usable: true, status: "pass", issues: [] };
  audit.exportable = true;
  vi.spyOn(geometry, "buildPlanningGeometry").mockReturnValue(result);
  vi.spyOn(parking, "buildPlanningParkingGeometry").mockReturnValue(parkingResult);
  vi.spyOn(packages, "buildSketchupExportPackage").mockReturnValue(basePackage);
  vi.spyOn(cadastral, "buildCadastralContext").mockReturnValue(context);
  vi.spyOn(audits, "buildSiteDeliveryAudit").mockReturnValue(audit);
  vi.spyOn(spatial, "calculatePlanningSpatialValidation");
  harness.state = {
    data, planningScenarios: [scenario], selectedPlanningScenarioId: scenario.id,
    representativeGeometrySnapshot: planning,
  };
  harness.linework.mockResolvedValue({ filename: "context.zip" });
  harness.sketchup.mockReturnValue({ filename: "site.zip", preferredImportFilename: "site.dae" });
  harness.cad.mockReturnValue({ filename: "cad.zip", dxfFilename: "site.dxf" });
});
afterEach(() => {
  expect(harness.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(panel: (typeof panels)[number], loadState = "ready") {
  harness.cursor = 0;
  harness.panels = [];
  harness.hooks = panel === CadastralRoadContextPanel
    ? [[road], loadState, null, [], null, false]
    : panel === PlanningSiteContextPanel
      ? [[road], undefined, [], loadState, null, [], true, true, true, true, false, null]
      : panel === SketchupSiteExportPanel ? [[road], undefined, loadState, [], null] : [];
  return renderToStaticMarkup(React.createElement(panel, { projectId }));
}
type Button = ReactElement<{ disabled?: boolean; onClick?: () => void | Promise<void>; children?: ReactNode }>;
function buttons(node: ReactNode): Button[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!React.isValidElement(node)) return [];
  if (node.type === "button") return [node as Button];
  return buttons((node.props as { children?: ReactNode }).children);
}
function downloads() {
  return buttons(harness.panels).filter((button) => button.props.onClick && button.props.disabled !== undefined);
}

const geometryParents = [
  PlanningGeometryContractPanel, CadastralRoadContextPanel, PlanningSiteContextPanel, SketchupSiteExportPanel,
];

function useRealGeometry() {
  vi.mocked(geometry.buildPlanningGeometry).mockRestore();
  return vi.spyOn(geometry, "buildPlanningGeometry");
}

describe("parent calculated sunlight and geometry identity", () => {
  it.each([
    { label: "residential sparse floors", zoning: "제2종일반주거지역", complex: false, economics: "recommended" },
    { label: "quasi-residential sunlight exemption", zoning: "준주거지역", complex: false, economics: "first" },
    { label: "multipart parcel with a hole", zoning: "제2종일반주거지역", complex: true, economics: "default" },
  ])("matches V4 geometry and calculation context for $label", ({ zoning, complex, economics }) => {
    const scenario = (harness.state.planningScenarios as PlanningScenario[])[0];
    scenario.primaryUse = "multi-family";
    scenario.floorPrograms = complex
      ? [createFloorProgram(1, [createFloorZone("residential", 20, 1)], 9.4)]
      : [
        createFloorProgram(7, [createFloorZone("residential", 30, 1)], 3.1),
        createFloorProgram(-1, [createFloorZone("parking", 50)], 3),
        createFloorProgram(1, [createFloorZone("residential", 50, 1)], 3.2),
        createFloorProgram(3, [createFloorZone("residential", 40, 1)], 3.4),
      ];
    Object.assign(data.parcel, {
      zoning, demolitionCost: 1_700,
      boundary: complex ? undefined : legacy,
      boundaryPolygons: complex ? full : undefined,
      lotArea: complex ? 991 : 900,
      inputProvenance: {
        mode: "vworld", parcelFacts: "vworld-cadastral", geometry: "vworld-cadastral",
        zoning: "vworld-land-use", recordedAt: data.meta.lastSyncedAt,
      },
    });
    const legacyScenario = (assumptions: AssumptionSet, recommended: boolean) => ({
      recommended, _raw: { assumptions },
    } as typeof data.scenarios[number]);
    const first = { ...defaultAssumptions(), constCostPerSqM: 2_111_111 };
    const recommended = { ...defaultAssumptions(), constCostPerSqM: 3_222_222 };
    if (economics !== "default") data.scenarios = [legacyScenario(first, false), legacyScenario(recommended, economics === "recommended")];
    const before = structuredClone({ data, scenario, representative: harness.state.representativeGeometrySnapshot });
    const build = useRealGeometry();
    const calculate = vi.spyOn(calculator, "calculatePlanningScenario");
    render(PlanningScenarioWorkspaceV4);
    const productionInput = build.mock.calls[0][0];
    const production = build.mock.results[0].value as geometry.PlanningGeometryBuildResult;
    const productionContext = calculate.mock.calls[0][1];
    expect(productionContext.assumptions.constructionCostPerSqmWon).toBe(
      economics === "recommended" ? recommended.constCostPerSqM : economics === "first" ? first.constCostPerSqM : defaultAssumptions().constCostPerSqM,
    );
    expect(productionInput.sunlight).toBeDefined();
    expect(productionInput.roofAllowanceM).toBe(1.4);
    expect(production.snapshot.building.floors.every(floor => floor.envelopeAvailable && floor.shape.length > 0)).toBe(true);
    if (complex) {
      expect(production.groundShape).toEqual([]);
      expect(production.groundPolygons).toHaveLength(2);
      expect(production.groundPolygons[0].holes).toHaveLength(1);
    }

    for (const panel of geometryParents) {
      build.mockClear(); calculate.mockClear();
      render(panel);
      expect(calculate).toHaveBeenCalledTimes(1);
      expect(calculate).toHaveBeenCalledWith(scenario, productionContext);
      expect(build).toHaveBeenCalledTimes(1);
      expect(build.mock.calls[0][0]).toEqual(productionInput);
      const result = build.mock.results[0].value as geometry.PlanningGeometryBuildResult;
      expect(result.snapshot.geometryHash).toBe(production.snapshot.geometryHash);
      expect(result.snapshot.building).toEqual(production.snapshot.building);
      expect(result.snapshot.validation).toEqual(production.snapshot.validation);
      expect(result.groundPolygons).toEqual(production.groundPolygons);
    }
    expect({ data, scenario, representative: harness.state.representativeGeometrySnapshot }).toEqual(before);
  });

  it("propagates verified profile and roof changes while retaining the saved representative lock", async () => {
    const scenario = (harness.state.planningScenarios as PlanningScenario[])[0];
    scenario.primaryUse = "multi-family";
    scenario.sunlightLegalUse = "apartment";
    scenario.sunlightLegalUseStatus = "source-backed";
    scenario.floorPrograms = [createFloorProgram(1, [createFloorZone("residential", 50, 1)], 9.4)];
    data.parcel.zoning = "제2종일반주거지역";
    const before = structuredClone({ data, scenario });
    const build = useRealGeometry();
    const realCalculate = calculator.calculatePlanningScenario;
    let separatorWidthM = 0;
    let verified = true;
    let roofAllowanceM = 1.4;
    // Supply canonical calculator results with reviewed boundary evidence to every consumer.
    // This tests forwarding; it does not upgrade the saved project's evidence or finances.
    const calculate = vi.spyOn(calculator, "calculatePlanningScenario").mockImplementation((plan, context) => realCalculate(plan, {
      ...context,
      parcel: {
        ...context.parcel, zoningStatus: "source-backed", roofAllowanceM,
        sunlightNorthBoundary: {
          adjacentZoning: "제2종일반주거지역", adjacentZoningStatus: "source-backed",
          separatorType: "road", separatorStatus: verified ? "source-backed" : "user-entered",
          separatorWidthM, separatorWidthStatus: verified ? "source-backed" : "user-entered",
        },
      },
    }));
    const hashes: string[] = [];
    let representative: geometry.PlanningGeometrySnapshot | undefined;
    for (const revision of ["baseline", "unverified width", "verified width", "roof change"]) {
      separatorWidthM = revision === "baseline" ? 0 : 4;
      verified = revision !== "unverified width";
      roofAllowanceM = revision === "roof change" ? 3.4 : 1.4;
      build.mockClear(); calculate.mockClear();
      render(PlanningScenarioWorkspaceV4);
      const production = (build.mock.results[0].value as geometry.PlanningGeometryBuildResult).snapshot;
      const calculation = calculate.mock.results[0].value;
      expect(calculation.sunlight.north.boundaryOffsetM).toBe(verified ? separatorWidthM : 0);
      expect(calculation.sunlight.daylight.boundary.boundaryOffsetM).toBe(verified ? separatorWidthM / 2 : 0);
      hashes.push(production.geometryHash);
      if (!representative) {
        expect(production.validation.representativeEligible).toBe(true);
        representative = structuredClone(production);
        harness.state.representativeGeometrySnapshot = representative;
      }
      const matchesRepresentative = production.geometryHash === representative.geometryHash;
      for (const panel of geometryParents) {
        build.mockClear();
        const html = render(panel);
        expect(build.mock.calls[0][0].sunlight).toEqual(calculation.sunlight);
        expect(build.mock.calls[0][0].roofAllowanceM).toBe(roofAllowanceM);
        const actual = (build.mock.results[0].value as geometry.PlanningGeometryBuildResult).snapshot;
        expect(actual.geometryHash).toBe(production.geometryHash);
        expect(actual.building.floors).toEqual(production.building.floors);
        if (panel === PlanningGeometryContractPanel) {
          expect(html.includes("대표안 스냅샷 잠김")).toBe(matchesRepresentative);
        }
        if (panel === PlanningSiteContextPanel || panel === SketchupSiteExportPanel) {
          const gated = downloads();
          expect(gated).toHaveLength(panel === PlanningSiteContextPanel ? 1 : 2);
          expect(gated.every(button => button.props.disabled === !matchesRepresentative)).toBe(true);
          if (!matchesRepresentative) for (const button of gated) await button.props.onClick!();
        }
      }
      expect(harness.state.representativeGeometrySnapshot).toBe(representative);
    }
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).not.toBe(hashes[1]);
    expect(hashes[3]).not.toBe(hashes[2]);
    expect(harness.sketchup).not.toHaveBeenCalled();
    expect(harness.cad).not.toHaveBeenCalled();
    expect({ data, scenario }).toEqual(before);
  });
});

describe.each(panels.map((panel) => ({ name: panel.name, panel })))("$name boundary availability", ({ panel }) => {
  it.each([
    { label: "legacy ring", source: { boundary: legacy } },
    { label: "full polygons without legacy", source: { boundary: undefined, boundaryPolygons: full } },
    { label: "full polygons with empty legacy", source: { boundary: [], boundaryPolygons: full } },
    { label: "full polygons with legacy", source: { boundary: legacy, boundaryPolygons: full } },
  ])("forwards $label without flattening", ({ source }) => {
    Object.assign(data.parcel, source);
    expect(render(panel)).not.toBe("");
    expect(geometry.buildPlanningGeometry).toHaveBeenCalledTimes(1);
    const input = vi.mocked(geometry.buildPlanningGeometry).mock.calls[0][0];
    expect(input.boundary).toBe(data.parcel.boundary);
    expect(input.boundaryPolygons).toBe(data.parcel.boundaryPolygons);
    if (panel === PlanningScenarioWorkspaceV4 || panel === SketchupSiteExportPanel) {
      const parkingInput = vi.mocked(parking.buildPlanningParkingGeometry).mock.calls[0][0];
      expect(parkingInput.boundary).toBe(data.parcel.boundary);
      expect(parkingInput.boundaryPolygons).toBe(data.parcel.boundaryPolygons);
    }
    if ([CadastralRoadContextPanel, PlanningSiteContextPanel, SketchupSiteExportPanel].includes(panel)) {
      expect(cadastral.buildCadastralContext).toHaveBeenCalledWith(expect.objectContaining({
        targetBoundary: data.parcel.boundary,
        targetBoundaryPolygons: data.parcel.boundaryPolygons,
      }));
    }
    if (panel === PlanningScenarioWorkspaceV4) {
      expect(vi.mocked(spatial.calculatePlanningSpatialValidation).mock.calls[0][7]).toBe(data.parcel.boundaryPolygons);
      expect(harness.massing).toHaveBeenCalledWith(expect.objectContaining({
        boundary: data.parcel.boundary, boundaryPolygons: data.parcel.boundaryPolygons,
      }), undefined);
      expect(harness.parkingSequence).toHaveBeenCalledWith(expect.objectContaining({
        boundary: data.parcel.boundary, boundaryPolygons: data.parcel.boundaryPolygons,
      }), undefined);
    }
  });

  it.each([
    { label: "empty", boundaryPolygons: [] },
    { label: "malformed hole", boundaryPolygons: [{ outer: legacy, holes: [[[127, 37]]] }] },
    { label: "null", boundaryPolygons: null },
  ])("does not fall back to a valid legacy ring for $label full input", ({ boundaryPolygons }) => {
    Object.assign(data.parcel, { boundaryPolygons } as unknown as ParcelBoundaryInput);
    render(panel);
    expect(geometry.buildPlanningGeometry).not.toHaveBeenCalled();
    expect(parking.buildPlanningParkingGeometry).not.toHaveBeenCalled();
    expect(cadastral.buildCadastralContext).not.toHaveBeenCalled();
    expect(harness.linework).not.toHaveBeenCalled();
    expect(harness.sketchup).not.toHaveBeenCalled();
    expect(harness.cad).not.toHaveBeenCalled();
  });
});

describe("full boundary downloads", () => {
  it.each([
    { label: "missing", boundary: undefined }, { label: "empty", boundary: [] }, { label: "present", boundary: legacy },
  ])("forwards the original full source to all three downloads (legacy $label)", async ({ boundary }) => {
    Object.assign(data.parcel, { boundary, boundaryPolygons: full });
    render(CadastralRoadContextPanel);
    expect(downloads()).toHaveLength(1);
    expect(downloads()[0].props.disabled).toBe(false);
    await downloads()[0].props.onClick!();
    render(SketchupSiteExportPanel);
    expect(downloads()).toHaveLength(2);
    for (const button of downloads()) {
      expect(button.props.disabled).toBe(false);
      await button.props.onClick!();
    }
    for (const exporter of [harness.linework, harness.sketchup, harness.cad]) {
      expect(exporter).toHaveBeenCalledTimes(1);
      expect(exporter.mock.calls[0][0].targetBoundary).toEqual(boundary ?? []);
      expect(exporter.mock.calls[0][0].targetBoundaryPolygons).toBe(full);
    }
  });

  it.each(["unlocked", "loading", "error", "no sources", "audit failure", "package failure"])(
    "retains the site export gate for %s with full boundaries", async (gate) => {
      Object.assign(data.parcel, { boundary: undefined, boundaryPolygons: full });
      if (gate === "unlocked") harness.state.representativeGeometrySnapshot = null;
      if (gate === "audit failure") audit.exportable = false;
      if (gate === "package failure") basePackage.validation.exportable = false;
      render(SketchupSiteExportPanel, gate === "loading" || gate === "error" ? gate : "ready");
      if (gate === "no sources") {
        harness.hooks[0] = [];
        harness.cursor = 0;
        harness.panels = [];
        renderToStaticMarkup(React.createElement(SketchupSiteExportPanel, { projectId }));
      }
      expect(downloads()).toHaveLength(2);
      for (const button of downloads()) {
        expect(button.props.disabled).toBe(true);
        await button.props.onClick!();
      }
      expect(harness.sketchup).not.toHaveBeenCalled();
      expect(harness.cad).not.toHaveBeenCalled();
    },
  );

  it("keeps the manual cadastral intake restriction", () => {
    Object.assign(data.parcel, { boundary: undefined, boundaryPolygons: full, inputProvenance: { mode: "manual" } });
    expect(render(CadastralRoadContextPanel)).toBe("");
    expect(harness.linework).not.toHaveBeenCalled();
  });
});
