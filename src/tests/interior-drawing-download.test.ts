import React, { type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analysisReferenceFixture } from "./helpers/analysis-reference-fixture";
import { analysisReferenceInputKey } from "@/lib/planning/analysis-reference-contract";
import type { InteriorDrawingDownload } from "@/lib/planning/interior-drawing-worker";
const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>, active: true, states: [] as unknown[], cursor: 0,
  pending: { current: null as AbortController | null }, effects: [] as Array<() => void | (() => void)>,
  sessionListener: null as (() => void) | null, storeListeners: new Set<() => void>(),
  worker: vi.fn(), click: vi.fn(), remove: vi.fn(), createUrl: vi.fn(), append: vi.fn(), feedback: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (value: unknown) => { harness.states[index] = value; harness.feedback(value); }];
  },
  useRef: () => harness.pending,
  useEffect: (fn: () => void | (() => void)) => { harness.effects.push(fn); },
}));
vi.mock("@/lib/stores/project-store", () => ({ useProjectStore: Object.assign(
  (selector: (state: Record<string, unknown>) => unknown) => selector(harness.state), {
    getState: () => harness.state,
    subscribe: (fn: () => void) => { harness.storeListeners.add(fn); return () => harness.storeListeners.delete(fn); },
  }) }));
vi.mock("@/lib/auth/client-session", () => ({ clientSession: {
  assertActive: () => { if (!harness.active) throw Error("Session locked"); },
  subscribe: (fn: () => void) => { harness.sessionListener = fn; return () => { harness.sessionListener = null; }; },
} }));
vi.mock("@/lib/planning/interior-drawing-worker", () => ({ runInteriorDrawingWorker: harness.worker }));
import { InteriorDrawingExport } from "@/components/planning/InteriorDrawingExport";

let fixture: ReturnType<typeof analysisReferenceFixture>, result: InteriorDrawingDownload;
beforeEach(() => {
  vi.clearAllMocks(); harness.active = true; harness.states = []; harness.cursor = 0;
  harness.pending.current = null; harness.effects = []; harness.storeListeners.clear(); harness.sessionListener = null;
  vi.stubGlobal("React", React);
  fixture = analysisReferenceFixture();
  harness.state = { selectedPlanningScenarioId: fixture.scenario.id, representativePlanningScenarioId: fixture.scenario.id,
    data: fixture.input.data, planningScenarios: [fixture.scenario], representativeGeometrySnapshot: fixture.geometry };
  const inputKey = analysisReferenceInputKey(fixture.scenario, fixture.parcel, fixture.geometry);
  result = { zipBytes: new Uint8Array([1, 2, 3]), filename: `PARCELGRID-interior-${inputKey.slice(-16)}.zip`, inputKey, entityCount: 56 };
  harness.worker.mockResolvedValue(result);
  harness.createUrl.mockReturnValue("blob:synthetic");
  vi.stubGlobal("URL", { createObjectURL: harness.createUrl, revokeObjectURL: vi.fn() });
  vi.stubGlobal("document", { body: { appendChild: harness.append }, createElement: () => ({ click: harness.click, remove: harness.remove }) });
  vi.stubGlobal("window", { setTimeout: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
function render() {
  harness.cursor = 0; harness.effects = [];
  return InteriorDrawingExport({ projectId: fixture.parcel.id, scenarioId: fixture.scenario.id });
}
function find(node: ReactNode, name: string): ReactElement<{ onClick: () => Promise<void> | void; disabled: boolean }> | undefined {
  if (Array.isArray(node)) return node.map(item => find(item, name)).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  const props = node.props as { children?: ReactNode; "aria-label"?: string };
  const text = (Array.isArray(props.children) ? props.children : [props.children]).filter(value => typeof value === "string").join("");
  if (node.type === "button" && (text === name || props["aria-label"] === name)) return node as ReturnType<typeof find>;
  return find(props.children, name);
}
const click = () => find(render(), "실내 검토 도면·수량 내려받기")!.props.onClick();
function delayed() {
  let finish!: (value: InteriorDrawingDownload) => void;
  harness.worker.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  return { start: () => click(), finish: () => finish(result) };
}

describe("interior drawing download lifecycle", () => {
  it("downloads a current worker result and releases its temporary anchor", async () => {
    await click();
    expect(harness.worker).toHaveBeenCalledOnce(); expect(harness.click).toHaveBeenCalledOnce(); expect(harness.remove).toHaveBeenCalledOnce();
    expect(harness.feedback).toHaveBeenCalledWith(expect.objectContaining({ error: false }));
    expect(harness.storeListeners.size).toBe(0);
  });
  it.each(["session", "selection", "representative", "scenario", "geometry", "finance", "in-place-parcel"])("discards a late file after %s changes, even without rerender", async kind => {
    const wait = delayed(), pending = wait.start();
    if (kind === "session") harness.active = false;
    if (kind === "selection") harness.state.selectedPlanningScenarioId = "OTHER";
    if (kind === "representative") harness.state.representativePlanningScenarioId = null;
    if (kind === "scenario") harness.state.planningScenarios = [{ ...fixture.scenario, version: 999 }];
    if (kind === "geometry") harness.state.representativeGeometrySnapshot = { ...fixture.geometry };
    if (kind === "finance") harness.state.data = { ...fixture.input.data };
    if (kind === "in-place-parcel") fixture.parcel.lotArea++;
    wait.finish(); await pending;
    expect(harness.createUrl).not.toHaveBeenCalled(); expect(harness.storeListeners.size).toBe(0);
  });
  it("terminates immediately when the store changes its raw source", async () => {
    const wait = delayed(), pending = wait.start(), signal = harness.worker.mock.calls[0][1] as AbortSignal;
    harness.state.representativePlanningScenarioId = null;
    for (const listener of harness.storeListeners) listener();
    expect(signal.aborted).toBe(true);
    wait.finish(); await pending; expect(harness.click).not.toHaveBeenCalled();
  });
  it.each(["cancel", "unmount", "session"])("terminates on %s and ignores a late completion", async kind => {
    render(); const cleanups = harness.effects.map(effect => effect());
    const wait = delayed(), pending = wait.start(), signal = harness.worker.mock.calls[0][1] as AbortSignal;
    if (kind === "cancel") find(render(), "도면 생성 취소")!.props.onClick();
    if (kind === "unmount") for (const cleanup of cleanups) cleanup?.();
    if (kind === "session") { harness.active = false; harness.sessionListener!(); }
    expect(signal.aborted).toBe(true);
    wait.finish(); await pending; expect(harness.createUrl).not.toHaveBeenCalled();
    expect(harness.storeListeners.size).toBe(0);
  });
  it("does not create a file when raw validation fails", async () => {
    harness.worker.mockRejectedValueOnce(Error("stale room")); await click();
    expect(harness.createUrl).not.toHaveBeenCalled();
    expect(harness.feedback).toHaveBeenCalledWith({ error: true, text: "stale room" });
  });
  it("rejects a valid-looking package bound to different inputs", async () => {
    result.inputKey = `PG-ANALYSIS-${"f".repeat(64)}`; await click(); expect(harness.createUrl).not.toHaveBeenCalled();
  });
  it("does not spawn when the initial session is locked", async () => {
    harness.active = false; await click(); expect(harness.worker).not.toHaveBeenCalled();
  });
  it("does not start another worker while one download is pending", async () => {
    const tree = render(), button = find(tree, "실내 검토 도면·수량 내려받기")!;
    const wait = delayed(), first = button.props.onClick();
    await button.props.onClick(); expect(harness.worker).toHaveBeenCalledOnce();
    wait.finish(); await first;
  });
});
