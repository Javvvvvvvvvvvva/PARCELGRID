import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runInteriorDrawingWorker, INTERIOR_DRAWING_WORKER_TIMEOUT_MS, type InteriorDrawingDownload } from "@/lib/planning/interior-drawing-worker";
import type { IntegratedVerificationInput } from "@/lib/handoff/integrated-verification";

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
const input = {} as IntegratedVerificationInput;
const valid = (): InteriorDrawingDownload => ({ inputKey: `PG-ANALYSIS-${"a".repeat(64)}`,
  filename: `PARCELGRID-interior-${"a".repeat(16)}.zip`, zipBytes: new Uint8Array([1, 2, 3]), entityCount: 56 });
beforeEach(() => { vi.useFakeTimers(); FakeWorker.instances = []; FakeWorker.failPost = false; vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("accepts a bound package and terminates its worker with no remaining timer", async () => {
  const pending = runInteriorDrawingWorker(input, new AbortController().signal), worker = FakeWorker.instances[0], result = valid();
  expect(worker.url.pathname).toContain("interior-drawing.worker.ts"); expect(worker.postMessage).toHaveBeenCalledWith(input);
  worker.onmessage!({ data: { type: "result", result } } as MessageEvent);
  expect(await pending).toBe(result); expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("hard-stops at the deadline without returning a partial file", async () => {
  const pending = runInteriorDrawingWorker(input, new AbortController().signal), assertion = expect(pending).rejects.toThrow("제한 시간");
  await vi.advanceTimersByTimeAsync(INTERIOR_DRAWING_WORKER_TIMEOUT_MS); await assertion;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("aborts and ignores a queued completion", async () => {
  const controller = new AbortController(), pending = runInteriorDrawingWorker(input, controller.signal);
  const worker = FakeWorker.instances[0], late = worker.onmessage!, assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); late({ data: { type: "result", result: valid() } } as MessageEvent); await assertion;
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("rejects an overdue response even when its timeout callback has not run", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    const pending = runInteriorDrawingWorker(input, new AbortController().signal), assertion = expect(pending).rejects.toThrow("제한 시간");
    clock.mockReturnValue(INTERIOR_DRAWING_WORKER_TIMEOUT_MS + 1);
    FakeWorker.instances[0].onmessage!({ data: { type: "result", result: valid() } } as MessageEvent);
    await assertion; expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  } finally { clock.mockRestore(); }
});

it("does not spawn after cancellation", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(runInteriorDrawingWorker(input, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.instances).toHaveLength(0);
});

it.each(["unsupported", "constructor", "post", "crash", "decode", "response"])("fails closed on %s", async kind => {
  if (kind === "unsupported") vi.stubGlobal("Worker", undefined);
  if (kind === "constructor") vi.stubGlobal("Worker", class { constructor() { throw new Error("failed"); } });
  if (kind === "post") FakeWorker.failPost = true;
  const pending = runInteriorDrawingWorker(input, new AbortController().signal), assertion = expect(pending).rejects.toBeInstanceOf(Error);
  const worker = FakeWorker.instances[0];
  if (kind === "crash") worker.onerror!();
  if (kind === "decode") worker.onmessageerror!();
  if (kind === "response") worker.onmessage!({ data: { type: "error", error: "failed" } } as MessageEvent);
  await assertion;
  if (worker) expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["bytes", "empty", "oversize", "key", "filename", "count", "missing"])("rejects malformed output: %s", async kind => {
  const pending = runInteriorDrawingWorker(input, new AbortController().signal), assertion = expect(pending).rejects.toThrow("결과");
  const result: Record<string, unknown> = { ...valid() };
  if (kind === "bytes") result.zipBytes = [1, 2];
  if (kind === "empty") result.zipBytes = new Uint8Array();
  if (kind === "oversize") result.zipBytes = new Uint8Array(20_100_001);
  if (kind === "key") result.inputKey = "stale";
  if (kind === "filename") result.filename = "wrong.zip";
  if (kind === "count") result.entityCount = 5001;
  FakeWorker.instances[0].onmessage!({ data: { type: "result", result: kind === "missing" ? null : result } } as MessageEvent);
  await assertion; expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
