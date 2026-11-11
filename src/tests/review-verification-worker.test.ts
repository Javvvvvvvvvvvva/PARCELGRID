import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReviewVerificationWorker, REVIEW_VERIFICATION_TIMEOUT_MS } from "@/lib/handoff/review-verification-worker";
import type { ReviewVerificationRequest, ReviewVerificationResult } from "@/lib/handoff/review-verification-task";
import { INTEGRATED_VERIFICATION_VERSION } from "@/lib/handoff/integrated-verification";

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(() => { if (FakeWorker.failPost) throw Error("clone"); });
  terminate = vi.fn();
  constructor(readonly url: URL) { FakeWorker.instances.push(this); }
}
const report = { version: INTEGRATED_VERIFICATION_VERSION, approvalStatus: "unverified", status: "incomplete", checks: [], limitations: [], modelVersions: {} };
const request = { kind: "saved", input: { snapshot: { projectId: "P", representativeScenarioId: "S", representativeScenarioVersion: 2, geometryHash: "G" } } } as Extract<ReviewVerificationRequest, { kind: "saved" }>;
// Transport-only shape; full calculation parity is covered by the task tests.
const result = () => ({ kind: "saved", snapshotKey: `PG-REVIEW-SHA256-${"A".repeat(64)}`, payload: { ...request.input.snapshot, verification: structuredClone(report) } }) as unknown as ReviewVerificationResult;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("Worker", FakeWorker); FakeWorker.instances = []; FakeWorker.failPost = false; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("review verification worker transport", () => {
  it("returns the bound packet/key and terminates without a synchronous fallback", async () => {
    const pending = runReviewVerificationWorker(request, new AbortController().signal), worker = FakeWorker.instances[0], value = result();
    expect(worker.url.pathname).toContain("review-verification.worker.ts");
    expect(worker.postMessage).toHaveBeenCalledWith(request);
    worker.onmessage!({ data: { type: "result", result: value } } as MessageEvent);
    expect(await pending).toBe(value);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["incomplete", "conflict", "preliminary"])("retains %s preview findings without manufacturing a saved packet", async status => {
    const preview = { kind: "preview", input: {} } as ReviewVerificationRequest;
    const pending = runReviewVerificationWorker(preview, new AbortController().signal);
    const value = { kind: "preview", report: { ...report, status } };
    FakeWorker.instances[0].onmessage!({ data: { type: "result", result: value } } as MessageEvent);
    expect(await pending).toEqual(value);
  });

  it("hard-stops a stalled computation", async () => {
    const pending = runReviewVerificationWorker(request, new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow("제한 시간");
    await vi.advanceTimersByTimeAsync(REVIEW_VERIFICATION_TIMEOUT_MS);
    await assertion;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it("rejects an overdue result even when its timer has not run", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const pending = runReviewVerificationWorker(request, new AbortController().signal);
    clock.mockReturnValue(REVIEW_VERIFICATION_TIMEOUT_MS);
    FakeWorker.instances[0].onmessage!({ data: { type: "result", result: result() } } as MessageEvent);
    await expect(pending).rejects.toThrow("제한 시간");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts and discards late results", async () => {
    const controller = new AbortController(), pending = runReviewVerificationWorker(request, controller.signal);
    const worker = FakeWorker.instances[0], late = worker.onmessage!;
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); late({ data: { type: "result", result: result() } } as MessageEvent);
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runReviewVerificationWorker(request, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it.each(["unavailable", "constructor", "post", "error", "decode", "response"])("fails closed for %s failures", async kind => {
    if (kind === "unavailable") vi.stubGlobal("Worker", undefined);
    if (kind === "constructor") vi.stubGlobal("Worker", class { constructor() { throw Error("no worker"); } });
    if (kind === "post") FakeWorker.failPost = true;
    const pending = runReviewVerificationWorker(request, new AbortController().signal);
    const assertion = expect(pending).rejects.toBeInstanceOf(Error);
    const worker = FakeWorker.instances[0];
    if (kind === "error") worker.onerror!();
    if (kind === "decode") worker.onmessageerror!();
    if (kind === "response") worker.onmessage!({ data: { type: "error" } } as MessageEvent);
    await assertion;
    if (worker) expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["project", "scenario", "version", "hash", "key", "approval", "kind"])("rejects mismatched %s output", async kind => {
    const pending = runReviewVerificationWorker(request, new AbortController().signal);
    const value = result();
    if (value.kind !== "saved") throw Error("fixture");
    if (kind === "project") value.payload.projectId = "foreign";
    if (kind === "scenario") value.payload.representativeScenarioId = "foreign";
    if (kind === "version") value.payload.representativeScenarioVersion++;
    if (kind === "hash") value.payload.geometryHash = "foreign";
    if (kind === "key") value.snapshotKey = "invalid";
    if (kind === "approval") Object.assign(value.payload.verification, { approvalStatus: "approved" });
    if (kind === "kind") Object.assign(value, { kind: "preview" });
    FakeWorker.instances[0].onmessage!({ data: { type: "result", result: value } } as MessageEvent);
    await expect(pending).rejects.toThrow("현재 입력");
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
