import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analysisReferenceFixture } from "./helpers/analysis-reference-fixture";

const harness = vi.hoisted(() => ({ state: {} as Record<string, unknown>, projectId: "synthetic-analysis-reference" }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), use: () => ({ projectId: harness.projectId }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/stores/project-store", () => ({ useProjectStore: (selector: (state: Record<string, unknown>) => unknown) => selector(harness.state) }));
vi.mock("@/lib/hooks/use-access-session", () => ({ useAccessSession: () => ({ data: {} }), principalHasCapability: () => true }));
vi.mock("@/components/planning/PlanningRecommendationPanelV2", () => ({ PlanningRecommendationPanelV2: () => null }));
vi.mock("@/components/planning/PlanningScenarioWorkspaceV4", () => ({ PlanningScenarioWorkspaceV4: () => null }));
vi.mock("@/components/planning/PlanningGeometryContractPanel", () => ({ PlanningGeometryContractPanel: () => null }));
vi.mock("@/components/planning/PlanningSiteContextPanel", () => ({ PlanningSiteContextPanel: () => null }));
vi.mock("@/components/planning/SketchupSiteExportPanel", () => ({ SketchupSiteExportPanel: () => null }));
vi.mock("@/components/planning/CadastralRoadContextPanel", () => ({ CadastralRoadContextPanel: () => null }));
vi.mock("@/components/planning/ScenarioPlacementWorkspace", () => ({ ScenarioPlacementWorkspace: () => null }));
vi.mock("@/components/planning/ScenarioParkingWorkspace", () => ({ ScenarioParkingWorkspace: () => null }));
vi.mock("@/components/planning/ScenarioChangeWorkspace", () => ({ ScenarioChangeWorkspace: () => null }));
vi.mock("@/components/planning/RegulatoryEvidencePanel", () => ({ RegulatoryEvidencePanel: () => null }));
import EnvelopePage from "@/app/projects/[projectId]/envelope/page";

let adopted: Record<string, unknown>;
beforeAll(async () => {
  const { useProjectStore } = await vi.importActual<typeof import("@/lib/stores/project-store")>("@/lib/stores/project-store");
  const input = analysisReferenceFixture();
  useProjectStore.setState({ data: input.input.data, planningScenarios: [input.scenario] });
  expect(useProjectStore.getState().setRepresentativePlanningScenarioId(input.scenario.id, "preliminary-analysis")).toBe(true);
  const state = useProjectStore.getState();
  adopted = { data: state.data, planningScenarios: state.planningScenarios, representativePlanningScenarioId: state.representativePlanningScenarioId,
    representativeGeometrySnapshot: state.representativeGeometrySnapshot };
}, 30000);
beforeEach(() => { vi.stubGlobal("React", React); harness.state = structuredClone(adopted); });
afterEach(() => vi.unstubAllGlobals());

describe("planning navigation uses the same Stage3 contract", () => {
  it.each(["current", "changed-parcel", "missing-finance", "missing-stamp"])("handles %s without a direct URL shortcut", kind => {
    const state = harness.state as unknown as ReturnType<typeof import("@/lib/stores/project-store").useProjectStore.getState>;
    if (kind === "changed-parcel") state.data!.parcel.maxFAR = 1;
    if (kind === "missing-finance") state.data!.scenarios = [];
    if (kind === "missing-stamp") delete state.representativeGeometrySnapshot!.analysisReference;
    const html = renderToStaticMarkup(React.createElement(EnvelopePage, { params: Promise.resolve({ projectId: harness.projectId }) }));
    const button = html.match(/<button[^>]*class="stage3-handoff"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button!.includes("disabled")).toBe(kind !== "current");
    if (kind === "current") expect(button).toContain("예비 분석 기준안의 사업성 검토로 이동");
  });
});
