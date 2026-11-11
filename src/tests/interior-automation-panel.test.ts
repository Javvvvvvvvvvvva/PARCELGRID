import React, { type ReactElement, type ReactNode } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { analysisReferenceFixture } from "./helpers/analysis-reference-fixture";
import type { InteriorAutomationInput, InteriorAutomationResult } from "@/lib/planning/interior-automation";
const harness = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, pending: { current: null as AbortController | null },
  state: {} as Record<string, unknown>, active: true, listener: null as (() => void) | null,
  worker: vi.fn(), apply: vi.fn(), effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (value: unknown) => { harness.states[index] = value; }];
  },
  useMemo: (fn: () => unknown) => fn(), useRef: () => harness.pending,
  useEffect: (fn: () => void | (() => void)) => { harness.effects.push(fn); },
}));
vi.mock("@/lib/stores/project-store", () => ({ useProjectStore: { getState: () => harness.state } }));
vi.mock("@/lib/auth/client-session", () => ({ clientSession: {
  get active() { return harness.active; }, assertActive: () => { if (!harness.active) throw Error("Session locked"); },
  subscribe: (fn: () => void) => { harness.listener = fn; return () => { harness.listener = null; }; },
} }));
vi.mock("@/lib/planning/interior-automation-worker", () => ({ runInteriorAutomationWorker: harness.worker, runInteriorAutomationApplyWorker: harness.apply }));
import { PlanningInteriorAutomation } from "@/components/planning/PlanningInteriorAutomation";
import { interiorAutomationInputKey } from "@/lib/planning/interior-automation";

let input: InteriorAutomationInput, result: InteriorAutomationResult;
const change = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("React", React);
  harness.states = []; harness.cursor = 0; harness.pending.current = null; harness.active = true; harness.listener = null; harness.effects = [];
  const fixture = analysisReferenceFixture();
  input = { scenario: fixture.scenario, geometry: fixture.geometry, parking: fixture.parking, options: { replaceExisting: false, bedrooms: 1 } };
  harness.state = { data: { parcel: fixture.parcel }, planningScenarios: [input.scenario], selectedPlanningScenarioId: input.scenario.id,
    representativePlanningScenarioId: null, representativeGeometrySnapshot: null };
  result = { version: "interior-automation-2026.1", sourceKey: interiorAutomationInputKey(input), status: "ready", approvalStatus: "unverified",
    changed: true, attempts: 1, rows: [], connectedFloors: 3, issues: [], candidate: null };
  harness.worker.mockResolvedValue(result); harness.apply.mockResolvedValue({ floorPrograms: input.scenario.floorPrograms });
});
afterEach(() => vi.unstubAllGlobals());
function render() {
  harness.cursor = 0; harness.effects = [];
  return PlanningInteriorAutomation({ ...input, onChange: change });
}
function find(node: ReactNode, name: string): ReactElement<{ onClick: () => Promise<void> | void; disabled: boolean }> | undefined {
  if (Array.isArray(node)) return node.map(item => find(item, name)).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  const props = node.props as { children?: ReactNode; "aria-label"?: string };
  const text = (Array.isArray(props.children) ? props.children : [props.children]).filter(value => typeof value === "string").join("");
  if (node.type === "button" && (text === name || props["aria-label"] === name)) return node as ReturnType<typeof find>;
  return find(props.children, name);
}
const generate = () => find(render(), "전체 층 후보 생성")!.props.onClick();

it("keeps generation as a preview until the user explicitly applies it", async () => {
  await generate(); expect(change).not.toHaveBeenCalled();
  const apply = find(render(), "전체 층 후보 적용")!;
  expect(apply.props.disabled).toBe(false);
  await apply.props.onClick();
  expect(harness.apply).toHaveBeenCalledWith(input, result, expect.any(AbortSignal)); expect(change).toHaveBeenCalledOnce();
});

it.each(["selection", "scenario", "parcel", "representative", "session"])("discards delayed results on %s changes", async kind => {
  let finish!: (result: InteriorAutomationResult) => void;
  harness.worker.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = generate();
  if (kind === "selection") harness.state.selectedPlanningScenarioId = "other";
  if (kind === "scenario") harness.state.planningScenarios = [{ ...input.scenario, version: input.scenario.version + 1 }];
  if (kind === "parcel") (harness.state.data as { parcel: { lotArea: number } }).parcel.lotArea++;
  if (kind === "representative") harness.state.representativePlanningScenarioId = "other";
  if (kind === "session") harness.active = false;
  finish(result); await pending;
  expect(find(render(), "전체 층 후보 적용")).toBeUndefined(); expect(change).not.toHaveBeenCalled();
});

it("rechecks the live source when apply is clicked, even before props rerender", async () => {
  await generate(); const apply = find(render(), "전체 층 후보 적용")!;
  (harness.state.data as { parcel: { lotArea: number } }).parcel.lotArea++;
  await apply.props.onClick(); expect(harness.apply).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
});

it.each(["session", "parcel", "cancel"])("does not write after %s changes during application revalidation", async kind => {
  await generate();
  let finish!: (patch: object) => void;
  harness.apply.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const applying = find(render(), "전체 층 후보 적용")!.props.onClick();
  const signal = harness.apply.mock.calls[0][2] as AbortSignal;
  if (kind === "session") harness.active = false;
  if (kind === "parcel") (harness.state.data as { parcel: { lotArea: number } }).parcel.lotArea++;
  if (kind === "cancel") { find(render(), "일괄 구획 생성 취소")!.props.onClick(); expect(signal.aborted).toBe(true); }
  finish({ floorPrograms: input.scenario.floorPrograms }); await applying;
  expect(change).not.toHaveBeenCalled();
});

it("aborts explicit cancellation and ignores the late worker result", async () => {
  let finish!: (result: InteriorAutomationResult) => void;
  harness.worker.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = generate(), signal = harness.worker.mock.calls[0][1] as AbortSignal;
  find(render(), "일괄 구획 생성 취소")!.props.onClick();
  expect(signal.aborted).toBe(true); finish(result); await pending;
  expect(find(render(), "전체 층 후보 적용")).toBeUndefined(); expect(change).not.toHaveBeenCalled();
});

it("terminates pending work on unmount and session invalidation", async () => {
  render();
  const cleanups = harness.effects.map(effect => effect());
  let finish!: (result: InteriorAutomationResult) => void;
  harness.worker.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = generate(), signal = harness.worker.mock.calls[0][1] as AbortSignal;
  harness.active = false; harness.listener!();
  for (const cleanup of cleanups) cleanup?.();
  expect(signal.aborted).toBe(true); finish(result); await pending;
  expect(change).not.toHaveBeenCalled();
});
