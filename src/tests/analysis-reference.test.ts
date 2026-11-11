import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analysisReferenceFixture } from "./helpers/analysis-reference-fixture";
import { assessPlanningAnalysisReference, createAnalysisReferenceSelection } from "@/lib/planning/analysis-reference";
import { analysisReferenceInputKey, analysisReferenceIsCurrent } from "@/lib/planning/analysis-reference-contract";
import { assessRepresentativeCheckReadiness } from "@/lib/planning/representative-readiness";
import { useProjectStore } from "@/lib/stores/project-store";
import { resolveStage3DashboardContext } from "@/lib/stage3/dashboard-model";
import { buildRepresentativeParcelBasisHash } from "@/lib/planning/representative-basis";
import { validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";
import { buildIntegratedVerification } from "@/lib/handoff/integrated-verification";

const AT = "2026-10-29T12:00:00.000Z";
let original: ReturnType<typeof analysisReferenceFixture>;
beforeAll(() => { original = analysisReferenceFixture(); }, 30000);
beforeEach(() => useProjectStore.setState(useProjectStore.getInitialState(), true));

describe("separate preliminary analysis reference", () => {
  it("passes actual rooms, egress, all parking candidates without promoting official checks", () => {
    const input = structuredClone(original);
    const before = JSON.stringify(input);
    expect(assessPlanningAnalysisReference(input).ready).toBe(true);
    expect(assessRepresentativeCheckReadiness(input.calculation.checks).ready).toBe(false);
    const stamp = createAnalysisReferenceSelection(input, AT)!;
    expect(stamp.approvalStatus).toBe("unverified");
    expect(stamp.unresolved.length).toBeGreaterThan(0);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["missing-height", "exceeded-far", "shortage", "frontage", "unchecked-vehicle", "room", "exit", "parking-exit-conflict", "stale-layout-finance"])("blocks %s", kind => {
    const input = structuredClone(original);
    if (kind === "missing-height") { input.parcel.heightLimit = 0; input.parcel.regulatoryConstraints!.height.value = null; }
    if (kind === "exceeded-far") input.parcel.regulatoryConstraints!.far.value = 1;
    if (kind === "shortage") input.scenario.parking.providedCars = 0;
    if (kind === "frontage") input.parking.frontage.sourceMatched = false;
    if (kind === "unchecked-vehicle") input.parking.circulation.uncheckedStalls = 1;
    if (kind === "room") input.scenario.floorPrograms[1].interiorLayout!.roomLayouts = [];
    if (kind === "exit") delete input.scenario.egressPlan!.exit;
    if (kind === "parking-exit-conflict") input.parking.layout.stalls[0].corners = [{ x: -50, z: -50 }, { x: 50, z: -50 }, { x: 50, z: 50 }, { x: -50, z: 50 }];
    if (kind === "stale-layout-finance") input.calculation.checks.push({ code: "layout-finance-adoption", label: "stale", status: "unknown", message: "changed" });
    expect(assessPlanningAnalysisReference(input).ready).toBe(false);
    expect(createAnalysisReferenceSelection(input, AT)).toBeNull();
  });

  it.each(["door", "parking", "boundary", "regulation", "geometry", "version", "approval"])("rejects %s changes without relying on cached checks", kind => {
    const input = structuredClone(original);
    input.geometry.analysisReference = createAnalysisReferenceSelection(input, AT)!;
    expect(analysisReferenceIsCurrent(input.scenario, input.parcel, input.geometry)).toBe(true);
    if (kind === "door") input.scenario.floorPrograms[1].interiorLayout!.roomLayouts![0].doors[0].widthM += 0.01;
    if (kind === "parking") input.scenario.parking.providedCars++;
    if (kind === "boundary") input.parcel.boundary![0][0] += 0.000001;
    if (kind === "regulation") input.parcel.maxFAR++;
    if (kind === "geometry") input.geometry.geometryHash += "tamper";
    if (kind === "version") input.scenario.version++;
    if (kind === "approval") Object.assign(input.geometry.analysisReference, { approvalStatus: "approved" });
    expect(analysisReferenceIsCurrent(input.scenario, input.parcel, input.geometry)).toBe(false);
  });

  it("ignores derived check tampering in its raw-input key", () => {
    const input = structuredClone(original);
    const key = analysisReferenceInputKey(input.scenario, input.parcel, input.geometry);
    input.scenario.checks = [];
    expect(analysisReferenceInputKey(input.scenario, input.parcel, input.geometry)).toBe(key);
  });

  it("adopts explicitly, recalculates finance, persists binding, and keeps approvals unverified", () => {
    const input = structuredClone(original);
    useProjectStore.setState({ data: input.input.data, planningScenarios: [input.scenario] });
    expect(useProjectStore.getState().setRepresentativePlanningScenarioId(input.scenario.id)).toBe(false);
    expect(useProjectStore.getState().setRepresentativePlanningScenarioId(input.scenario.id, "preliminary-analysis"),
      useProjectStore.getState().geometryValidationError ?? "").toBe(true);
    const state = useProjectStore.getState();
    const geometry = state.representativeGeometrySnapshot!;
    const scenario = state.planningScenarios[0];
    const data = state.data!;
    expect(scenario.floorPrograms).toEqual(input.scenario.floorPrograms);
    expect(scenario.parking).toEqual(input.scenario.parking);
    expect(geometry.analysisReference?.approvalStatus).toBe("unverified");
    const dashboard = { projectId: input.parcel.id, parcel: data.parcel, representativeScenarioId: scenario.id,
      representativeGeometrySnapshot: geometry, planningScenarios: [scenario], financeScenarios: data.scenarios };
    expect(resolveStage3DashboardContext(dashboard)).toMatchObject({ ready: true });
    expect(resolveStage3DashboardContext({ ...dashboard, parcel: { ...data.parcel, maxFAR: 1 } })).toMatchObject({ ready: false });
    const payload = { ...projectWorkspaceFixture(input.parcel.id), projectData: data, planningScenarios: [scenario],
      representativeScenarioId: scenario.id, representativeGeometry: geometry,
      representativeParcelBasisHash: buildRepresentativeParcelBasisHash(data.parcel) };
    expect(validateProjectWorkspacePayload(payload)).toMatchObject({ valid: true });
    const packet = { projectId: input.parcel.id, representativeScenarioId: scenario.id, representativeScenarioVersion: scenario.version,
      geometryHash: geometry.geometryHash, data, planningScenario: scenario, geometry };
    const report = buildIntegratedVerification(packet);
    expect(report.approvalStatus).toBe("unverified");
    expect(report.checks.find(c => c.id === "binding.analysis-reference")?.status).toBe("checked");
    expect(report.checks.filter(c => c.id.startsWith("binding.") && ["fail", "missing"].includes(c.status))).toEqual([]);
    const tampered = structuredClone(packet);
    tampered.planningScenario.parking.providedCars++;
    expect(buildIntegratedVerification(tampered).checks.find(c => c.id === "binding.analysis-reference")?.status).toBe("fail");
    payload.planningScenarios = [tampered.planningScenario];
    expect(validateProjectWorkspacePayload(payload)).toMatchObject({ valid: false });
    state.editPlanningScenarioDraft(scenario.id, { parking: { ...scenario.parking, providedCars: 0 } });
    expect(useProjectStore.getState().representativePlanningScenarioId).toBeNull();
    expect(useProjectStore.getState().representativeGeometrySnapshot).toBeNull();
  }, 30000);
});
