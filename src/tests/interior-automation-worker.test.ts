import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runInteriorAutomationWorker, runInteriorAutomationApplyWorker, INTERIOR_AUTOMATION_WORKER_TIMEOUT_MS } from "@/lib/planning/interior-automation-worker";
import type { InteriorAutomationInput, InteriorAutomationResult } from "@/lib/planning/interior-automation";

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(() => { if (FakeWorker.failPost) throw new Error("clone failed"); });
  terminate = vi.fn();
  constructor(readonly url: URL) { FakeWorker.instances.push(this); }
}
const input = {} as InteriorAutomationInput;
beforeEach(() => { vi.useFakeTimers(); FakeWorker.instances = []; FakeWorker.failPost = false; vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("streams progress but resolves only a final result and terminates the worker", async () => {
  const progress = vi.fn(), pending = runInteriorAutomationWorker(input, new AbortController().signal, progress);
  const worker = FakeWorker.instances[0], result = { status: "ready" } as InteriorAutomationResult;
  expect(worker.url.pathname).toContain("interior-automation.worker.ts");
  expect(worker.postMessage).toHaveBeenCalledWith({ type: "generate", input });
  worker.onmessage!({ data: { type: "progress", progress: { attempt: 1, floor: 0, totalFloors: 3 } } } as MessageEvent);
  expect(progress).toHaveBeenCalledOnce(); expect(worker.terminate).not.toHaveBeenCalled();
  worker.onmessage!({ data: { type: "result", result } } as MessageEvent);
  expect(await pending).toBe(result); expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("validates application in its own worker without doing geometry work on the UI thread", async () => {
  const result = { status: "ready" } as InteriorAutomationResult;
  const pending = runInteriorAutomationApplyWorker(input, result, new AbortController().signal);
  const worker = FakeWorker.instances[0], patch = { egressPlan: undefined };
  expect(worker.postMessage).toHaveBeenCalledWith({ type: "apply", input, result });
  worker.onmessage!({ data: { type: "applied", patch } } as MessageEvent);
  expect(await pending).toEqual(patch); expect(worker.terminate).toHaveBeenCalledOnce();
});

it("rejects a generation response sent to the application worker", async () => {
  const pending = runInteriorAutomationApplyWorker(input, {} as InteriorAutomationResult, new AbortController().signal);
  const assertion = expect(pending).rejects.toThrow();
  FakeWorker.instances[0].onmessage!({ data: { type: "result", result: {} } } as MessageEvent);
  await assertion;
});

it("hard-stops a worker after its deadline and never returns partial progress as a candidate", async () => {
  const pending = runInteriorAutomationWorker(input, new AbortController().signal);
  const assertion = expect(pending).rejects.toThrow("제한 시간");
  await vi.advanceTimersByTimeAsync(INTERIOR_AUTOMATION_WORKER_TIMEOUT_MS);
  await assertion; expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it("aborts and ignores both late progress and late results", async () => {
  const controller = new AbortController(), progress = vi.fn();
  const pending = runInteriorAutomationWorker(input, controller.signal, progress);
  const worker = FakeWorker.instances[0], late = worker.onmessage!;
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  late({ data: { type: "progress", progress: {} } } as MessageEvent);
  late({ data: { type: "result", result: {} } } as MessageEvent);
  await assertion;
  expect(progress).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("does not spawn after cancellation", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(runInteriorAutomationWorker(input, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.instances).toHaveLength(0);
});

it.each(["unsupported", "constructor", "post", "crash", "decode", "response"])("fails closed on %s", async kind => {
  if (kind === "unsupported") vi.stubGlobal("Worker", undefined);
  if (kind === "constructor") vi.stubGlobal("Worker", class { constructor() { throw new Error("failed"); } });
  if (kind === "post") FakeWorker.failPost = true;
  const pending = runInteriorAutomationWorker(input, new AbortController().signal);
  const assertion = expect(pending).rejects.toBeInstanceOf(Error), worker = FakeWorker.instances[0];
  if (kind === "crash") worker.onerror!();
  if (kind === "decode") worker.onmessageerror!();
  if (kind === "response") worker.onmessage!({ data: { type: "error", error: "failed" } } as MessageEvent);
  await assertion;
  if (worker) expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
