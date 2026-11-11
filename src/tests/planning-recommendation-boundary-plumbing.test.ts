import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanningRecommendationPanelV2 } from "@/components/planning/PlanningRecommendationPanelV2";
import type { ParcelBoundaryInput } from "@/lib/geo/parcel-topology";
import * as recommendation from "@/lib/planning/recommendation-analysis";
import * as worker from "@/lib/planning/recommendation-worker";
import { planningRecommendationInput, planningRecommendationInputBasis } from "@/lib/planning/recommendation-basis";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>, hooks: [] as unknown[], cursor: 0,
  children: null as ReactNode,
}));
vi.mock("@/lib/auth/client-session", () => ({ clientSession: { active: true, subscribe: () => () => {} } }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    const index = harness.cursor++;
    return index < harness.hooks.length ? [harness.hooks[index], vi.fn()] : actual.useState(initial);
  } };
});
vi.mock("@/lib/stores/project-store", () => ({
  useProjectStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(harness.state), {
    getState: () => harness.state,
  }),
}));
vi.mock("@/components/ui/primitives", () => ({ Panel: ({ children }: { children: ReactNode }) => {
  harness.children = children;
  return React.createElement("div", null, children);
} }));

const projectId = "recommendation-boundary";
const legacy: [number, number][] = [[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001]];
const full = [
  { outer: legacy, holes: [[
    [127.0001, 37.0001], [127.0002, 37.0001], [127.0002, 37.0002], [127.0001, 37.0002],
  ] as [number, number][]] },
  { outer: [[127.002, 37], [127.003, 37], [127.003, 37.001], [127.002, 37.001]] as [number, number][], holes: [] },
];
const emptyResult: recommendation.PlanningRecommendationAnalysis = {
  searchStatus: "complete",
  engineVersion: "test", generatedAt: "2026-09-09T12:00:00.000Z", evaluatedCandidates: 0,
  eligibleCandidates: 0, architecturalFeasibility: null, profitOptimal: null,
  legalCeilingReference: null, warnings: [], evaluations: [], sharedPrimaryCandidate: false,
  profitMode: null, combinedPrimary: null, legalGeometryCandidateCount: 0, arithmeticLegalFarCapPct: null,
  rejectionSummary: { rejectedCandidates: 0, reasons: [], multipleReasonsPossible: true },
};
let data: ReturnType<typeof projectWorkspaceFixture>["projectData"];
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, confirm: vi.fn(() => true) });
  data = projectWorkspaceFixture(projectId).projectData;
  data.scenarios = [];
  Object.assign(data.parcel, {
    boundary: legacy, maxBCR: 60, maxFAR: 250, heightLimit: 30, acquiredPrice: 20000,
    roads: [], setback: { road: 0, side: 0, rear: 0 },
  });
  harness.state = {
    data, planningScenarios: [], selectedPlanningScenarioId: null, representativePlanningScenarioId: null,
    setPlanningScenarios: vi.fn(), selectPlanningScenario: vi.fn(), duplicatePlanningScenario: vi.fn(),
  };
  harness.hooks = [false, null, null];
  vi.spyOn(worker, "runPlanningRecommendationWorker").mockImplementation(async (input) => ({
    ...emptyResult, inputBasis: planningRecommendationInputBasis(input),
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function render() {
  harness.cursor = 0;
  harness.children = null;
  return renderToStaticMarkup(React.createElement(PlanningRecommendationPanelV2, { projectId }));
}
function firstButton(node: ReactNode): ReactElement<{ onClick: () => void }> | undefined {
  if (Array.isArray(node)) return node.map(firstButton).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  if (node.type === "button") return node as ReactElement<{ onClick: () => void }>;
  return firstButton((node.props as { children?: ReactNode }).children);
}
function queueGeneration() {
  render();
  const button = firstButton(harness.children);
  expect(button).toBeDefined();
  button!.props.onClick();
}

describe("recommendation full boundary plumbing", () => {
  it.each([
    { label: "legacy", source: { boundary: legacy } },
    { label: "polygon-only", source: { boundary: undefined, boundaryPolygons: full } },
    { label: "full with empty legacy", source: { boundary: [], boundaryPolygons: full } },
    { label: "full alongside legacy", source: { boundary: legacy, boundaryPolygons: full } },
    { label: "authoritative empty", source: { boundary: legacy, boundaryPolygons: [] } },
    { label: "authoritative malformed", source: { boundary: legacy, boundaryPolygons: [{ outer: [], holes: [] }] } },
  ])("passes $label input unchanged to generation and its basis", async ({ source }) => {
    Object.assign(data.parcel, source);
    queueGeneration();
    await vi.advanceTimersByTimeAsync(20);
    const generate = vi.mocked(worker.runPlanningRecommendationWorker);
    expect(generate).toHaveBeenCalledTimes(1);
    const input = generate.mock.calls[0][0];
    const boundaryInput = input.parcel as ParcelBoundaryInput;
    expect(boundaryInput.boundary).toBe(data.parcel.boundary);
    expect(boundaryInput.boundaryPolygons).toBe(data.parcel.boundaryPolygons);
    expect(JSON.parse(planningRecommendationInputBasis(input)).parcel.boundaryPolygons).toEqual(data.parcel.boundaryPolygons);
    expect(harness.state.setPlanningScenarios).toHaveBeenCalledTimes(1);
  });

  it.each(["hole", "secondary part", "empty full source"])("discards a queued result when only the %s changes", (change) => {
    data.parcel.boundaryPolygons = structuredClone(full);
    queueGeneration();
    const next = structuredClone(data);
    if (change === "hole") next.parcel.boundaryPolygons![0].holes[0][0][0] += 0.00001;
    else if (change === "secondary part") next.parcel.boundaryPolygons![1].outer[0][0] += 0.00001;
    else next.parcel.boundaryPolygons = [];
    harness.state.data = next;
    vi.advanceTimersByTime(20);
    expect(worker.runPlanningRecommendationWorker).not.toHaveBeenCalled();
    expect(harness.state.setPlanningScenarios).not.toHaveBeenCalled();
  });

  it("hides prior result messages and warnings after a topology-only change", () => {
    data.parcel.boundaryPolygons = full;
    const input = planningRecommendationInput(data, projectId);
    const inputBasis = planningRecommendationInputBasis({
      ...input, parcel: Object.assign({}, input.parcel, { boundaryPolygons: full }),
    });
    harness.hooks = [false, { ...emptyResult, inputBasis, warnings: ["OLD_WARNING"] },
      { basis: inputBasis, text: "OLD_MESSAGE" }];
    const current = render();
    expect(current).toContain("OLD_WARNING");
    expect(current).toContain("OLD_MESSAGE");
    harness.state.data = { ...data, parcel: { ...data.parcel, boundaryPolygons: [] } };
    const stale = render();
    expect(stale).not.toContain("OLD_WARNING");
    expect(stale).not.toContain("OLD_MESSAGE");
    expect(harness.state.setPlanningScenarios).not.toHaveBeenCalled();
  });
});
