import { beforeAll, describe, expect, it } from "vitest";
import { analysisReferenceFixture } from "./helpers/analysis-reference-fixture";
import { useProjectStore } from "@/lib/stores/project-store";
import { buildInteriorDrawingExport } from "@/lib/planning/interior-drawing-export";
import { analysisReferenceInputKey } from "@/lib/planning/analysis-reference-contract";
import type { IntegratedVerificationInput } from "@/lib/handoff/integrated-verification";
import { pathSpaceShape } from "@/lib/planning/interior-paths";
import { takeoffPlanningQuantities } from "@/lib/planning/quantity-takeoff";
import { createHash } from "node:crypto";

let original: IntegratedVerificationInput;
beforeAll(() => {
  const fixture = analysisReferenceFixture();
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useProjectStore.setState({ data: fixture.input.data, planningScenarios: [fixture.scenario] });
  expect(useProjectStore.getState().setRepresentativePlanningScenarioId(fixture.scenario.id, "preliminary-analysis")).toBe(true);
  const state = useProjectStore.getState();
  original = { projectId: fixture.parcel.id, representativeScenarioId: fixture.scenario.id, representativeScenarioVersion: fixture.scenario.version,
    data: state.data!, planningScenario: state.planningScenarios[0], geometry: state.representativeGeometrySnapshot!,
    geometryHash: state.representativeGeometrySnapshot!.geometryHash };
}, 30000);

describe("source-bound interior CAD and quantity delivery", () => {
  it("exports exact room/door/core candidates with floor elevations and independent quantities", () => {
    const input = structuredClone(original), before = JSON.stringify(input);
    const result = buildInteriorDrawingExport(input), metadata = JSON.parse(result.metadataText);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.zipBytes.slice(0, 4)).toEqual(new Uint8Array([80, 75, 3, 4]));
    expect(metadata.approvalStatus).toBe("unverified");
    expect(metadata.analysisReference.approvalStatus).toBe("unverified");
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, canonical(item)])) : value;
    expect(metadata.inputKey).toBe(`PG-ANALYSIS-${createHash("sha256").update(JSON.stringify(canonical(metadata.inputBasis))).digest("hex")}`);
    expect(metadata.quantities).toEqual(takeoffPlanningQuantities(input.planningScenario!));
    expect(metadata.financialAreas.providedParkingSpaces).toBe(4);
    expect(result.dxfText).toContain("$INSUNITS\n70\n6\n");
    expect(result.dxfText).toContain("30\n6.000000\n");
    expect(result.dxfText.match(/0\nPOLYLINE\n/g)?.length).toBe(metadata.entities.length);
    expect(metadata.entities.filter((entity: { kind: string }) => entity.kind === "STAIR_RESERVATION")).toHaveLength(2);
    const floor = input.planningScenario!.floorPrograms[1], unit = floor.interiorLayout!.roomLayouts![0], room = unit.spaces[0];
    const entity = metadata.entities.find((item: { floorId: string; sourceId: string; unitId?: string }) =>
      item.floorId === floor.id && item.unitId === unit.unitId && item.sourceId === room.id);
    expect(entity.points).toEqual(pathSpaceShape(room));
    expect(entity.elevationM).toBe(3);
    expect(metadata.verification.approvalStatus).toBe("unverified");
    expect(result.readmeText).toContain("공식 경계·허가·전문가 승인은 미확정");
    expect(result.readmeText).toContain("구조체가 아닙니다");
  });

  it.each(["door", "room", "exit", "parking", "boundary", "geometry", "height", "floor-view", "finance", "missing-selection"])("does not export %s corruption as complete drawings", kind => {
    const input = structuredClone(original), scenario = input.planningScenario!, geometry = input.geometry!;
    if (kind === "door") scenario.floorPrograms[1].interiorLayout!.roomLayouts![0].doors[0].widthM = 0.01;
    if (kind === "room") scenario.floorPrograms[1].interiorLayout!.roomLayouts = [];
    if (kind === "exit") delete scenario.egressPlan!.exit;
    if (kind === "parking") scenario.parking.providedCars = 0;
    if (kind === "boundary") input.data.parcel.boundary![0][0] += 0.001;
    if (kind === "geometry") geometry.building.floors[1].shape[0].x += 1;
    if (kind === "height") geometry.building.floors[1].baseHeightM = 0.1;
    if (kind === "floor-view") geometry.building.aboveGroundFloors = [];
    if (kind === "finance") input.data.scenarios[0]._raw.program.areaContract!.geometrySource!.geometryHash += "stale";
    if (kind === "missing-selection") delete geometry.analysisReference;
    // A caller can recompute a change digest; it must not bypass independent raw verification.
    if (geometry.analysisReference) geometry.analysisReference.inputKey = analysisReferenceInputKey(scenario, input.data.parcel, geometry);
    expect(() => buildInteriorDrawingExport(input)).toThrow();
  });

  it("binds exported coordinates to the current source rather than cached calculated checks", () => {
    const input = structuredClone(original);
    const current = buildInteriorDrawingExport(input);
    input.planningScenario!.checks = [];
    expect(buildInteriorDrawingExport(input).metadata.inputKey).toBe(current.metadata.inputKey);
    expect(buildInteriorDrawingExport(input).dxfText).toBe(current.dxfText);
  });
});
