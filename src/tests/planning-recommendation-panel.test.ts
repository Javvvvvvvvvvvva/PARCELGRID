import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PlanningRecommendationPanelV2 } from "@/components/planning/PlanningRecommendationPanelV2";
import { generatePlanningRecommendationsV2, type PlanningRecommendationAnalysis } from "@/lib/planning/recommendation-analysis";
import { planningRecommendationInput } from "@/lib/planning/recommendation-basis";
import { runPlanningRecommendationWorker } from "@/lib/planning/recommendation-worker";
import type { PlanningScenario } from "@/lib/planning/types";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const harness = vi.hoisted(() => ({ state: {} as Record<string, unknown>, hooks: [] as unknown[], children: null as unknown }));
vi.mock("@/lib/planning/recommendation-worker", () => ({ runPlanningRecommendationWorker: vi.fn() }));
vi.mock("@/lib/auth/client-session", () => ({ clientSession: { active: true, subscribe: () => () => {} } }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => harness.hooks.length
    ? [harness.hooks.shift(), vi.fn()] : actual.useState(initial) };
});
vi.mock("@/lib/stores/project-store", () => ({
  useProjectStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(harness.state), {
    getState: () => harness.state,
  }),
}));
vi.mock("@/components/ui/primitives", () => ({ Panel: ({ children }: { children: ReactNode }) => {
  harness.children = children; return React.createElement("div", null, children);
} }));

function dataAt(far = 250) {
  const data = projectWorkspaceFixture("same-pnu").projectData;
  data.scenarios = [];
  Object.assign(data.parcel, {
    maxFAR: far, maxBCR: 50, heightLimit: 18, acquiredPrice: 20000,
    boundary: [[127.0255, 37.6503], [127.0260, 37.6503],
      [127.0260, 37.6507], [127.0255, 37.6507], [127.0255, 37.6503]],
  });
  return data;
}
let result: PlanningRecommendationAnalysis;
let plans: PlanningScenario[];
beforeAll(() => {
  result = generatePlanningRecommendationsV2(planningRecommendationInput(dataAt(), "same-pnu"));
  plans = [result.architecturalFeasibility, result.profitOptimal, result.legalCeilingReference]
    .filter((plan): plan is PlanningScenario => Boolean(plan));
  expect(plans.length).toBeGreaterThan(0);
});
beforeEach(() => {
  vi.stubGlobal("React", React);
  harness.state = {
    data: dataAt(), planningScenarios: structuredClone(plans),
    selectedPlanningScenarioId: null, representativePlanningScenarioId: null,
    setPlanningScenarios: vi.fn(), selectPlanningScenario: vi.fn(), duplicatePlanningScenario: vi.fn(),
  };
  harness.hooks = [false, null, null];
  vi.mocked(runPlanningRecommendationWorker).mockReset().mockResolvedValue(result);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function render() { return renderToStaticMarkup(React.createElement(PlanningRecommendationPanelV2, { projectId: "same-pnu" })); }
function button(node: unknown): ReactElement<{ onClick: () => void }> | undefined {
  if (Array.isArray(node)) return node.map(button).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  if (node.type === "button") return node as ReactElement<{ onClick: () => void }>;
  return button((node.props as { children?: ReactNode }).children);
}

it("renders unchanged recommendations, then hides old 250% reasons at the same PNU with 200% input", () => {
  expect(render()).toContain("250.0%");
  harness.hooks = [false, null, null]; harness.state.data = dataAt(200);
  const before = JSON.stringify(harness.state.planningScenarios);
  const html = render();
  expect(html).toContain("이전 추천"); expect(html).toContain("추천안 다시 계산");
  expect(html).not.toContain("250.0%");
  expect(JSON.stringify(harness.state.planningScenarios)).toBe(before);
  expect(harness.state.setPlanningScenarios).not.toHaveBeenCalled();
});

it("keeps legacy plans but does not render unbound historical reasons", () => {
  const legacy = structuredClone(plans);
  for (const plan of legacy) delete plan.recommendation!.inputBasis;
  harness.state.planningScenarios = legacy;
  const html = render(); expect(html).toContain("이전 추천"); expect(html).not.toContain("250.0%");
});

it("hides stale in-memory warnings, rejection counts and success messages after input changes", () => {
  harness.state.data = dataAt(200); harness.state.planningScenarios = [];
  harness.hooks = [false, { ...result, warnings: ["OLD_WARNING"],
    rejectionSummary: { rejectedCandidates: 99999, reasons: [], multipleReasonsPossible: true } },
  { basis: result.inputBasis, text: "OLD_MESSAGE" }];
  const html = render();
  expect(html).not.toContain("OLD_WARNING"); expect(html).not.toContain("OLD_MESSAGE");
  expect(html).not.toContain("99,999");
});

it("discards the delayed generation callback if inputs changed before it starts", () => {
  vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, confirm: () => true });
  render(); button(harness.children)!.props.onClick();
  harness.state.data = dataAt(200);
  vi.advanceTimersByTime(20);
  expect(harness.state.setPlanningScenarios).not.toHaveBeenCalled();
});

it("preserves a manual plan added while generation was queued and saves newly bound results", async () => {
  vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, confirm: () => true });
  render(); button(harness.children)!.props.onClick();
  const manual = { ...plans[0], id: "added-manual", origin: "custom", recommendation: undefined };
  harness.state.planningScenarios = [...plans, manual];
  await vi.advanceTimersByTimeAsync(20);
  const save = vi.mocked(harness.state.setPlanningScenarios as (value: PlanningScenario[]) => void);
  expect(save).toHaveBeenCalledTimes(1);
  const saved = save.mock.calls[0][0];
  expect(saved).toContain(manual);
  expect(saved.filter((plan) => plan.recommendation).every((plan) => plan.recommendation?.inputBasis === result.inputBasis)).toBe(true);
});

it("keeps existing recommendations and representative when the search is incomplete", async () => {
  vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, confirm: () => true });
  vi.mocked(runPlanningRecommendationWorker).mockResolvedValue({ ...result, searchStatus: "incomplete" });
  harness.state.representativePlanningScenarioId = plans[0].id;
  render(); button(harness.children)!.props.onClick();
  await vi.advanceTimersByTimeAsync(20);
  expect(harness.state.setPlanningScenarios).not.toHaveBeenCalled();
  expect(harness.state.selectPlanningScenario).not.toHaveBeenCalled();
  expect(harness.state.representativePlanningScenarioId).toBe(plans[0].id);
});

it("rejects late worker results after an input edit", async () => {
  vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, confirm: () => true });
  let finish!: (value: PlanningRecommendationAnalysis) => void;
  vi.mocked(runPlanningRecommendationWorker).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(); button(harness.children)!.props.onClick();
  await vi.advanceTimersByTimeAsync(20);
  harness.state.data = dataAt(200);
  finish(result);
  await Promise.resolve();
  expect(harness.state.setPlanningScenarios).not.toHaveBeenCalled();
  expect(harness.state.selectPlanningScenario).not.toHaveBeenCalled();
});

it.each(["plan", "representative"])("preserves a %s changed during background search", async kind => {
  vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, confirm: () => true });
  let finish!: (value: PlanningRecommendationAnalysis) => void;
  vi.mocked(runPlanningRecommendationWorker).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(); button(harness.children)!.props.onClick();
  await vi.advanceTimersByTimeAsync(20);
  if (kind === "plan") (harness.state.planningScenarios as PlanningScenario[])[0].name = "Edited while running";
  else harness.state.representativePlanningScenarioId = "new-representative";
  finish(result);
  await Promise.resolve();
  expect(harness.state.setPlanningScenarios).not.toHaveBeenCalled();
  expect(harness.state.selectPlanningScenario).not.toHaveBeenCalled();
});
