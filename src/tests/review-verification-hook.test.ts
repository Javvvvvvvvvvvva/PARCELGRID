import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewVerificationRequest, ReviewVerificationResult } from "@/lib/handoff/review-verification-task";
import { INTEGRATED_VERIFICATION_VERSION } from "@/lib/handoff/integrated-verification";

const h = vi.hoisted(() => ({ active: true, slots: [] as unknown[], cursor: 0,
  effects: [] as Array<() => void>, listeners: new Set<() => void>(), worker: vi.fn() }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.slots)) h.slots[index] = initial;
    return [h.slots[index], (value: unknown) => { h.slots[index] = typeof value === "function" ? value(h.slots[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = h.cursor++;
    if (!(index in h.slots)) h.slots[index] = { current: initial };
    return h.slots[index];
  },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const index = h.cursor++, previous = h.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      const next = { deps, cleanup: undefined as (() => void) | undefined }; h.slots[index] = next;
      h.effects.push(() => { previous?.cleanup?.(); next.cleanup = fn() ?? undefined; });
    }
  },
}));
vi.mock("@/lib/auth/client-session", () => ({ clientSession: {
  get active() { return h.active; },
  assertActive: () => { if (!h.active) throw Error("Session locked"); },
  subscribe: (listener: () => void) => { h.listeners.add(listener); return () => h.listeners.delete(listener); },
} }));
vi.mock("@/lib/handoff/review-verification-worker", () => ({ runReviewVerificationWorker: h.worker }));
import { useReviewVerification } from "@/lib/hooks/use-review-verification";

const input = () => ({ kind: "preview", input: { projectId: "synthetic" } }) as ReviewVerificationRequest;
const output = () => ({ kind: "preview", report: { version: INTEGRATED_VERIFICATION_VERSION, approvalStatus: "unverified", status: "incomplete", checks: [], limitations: [], modelVersions: {} } }) as ReviewVerificationResult;
let jobs: Array<{ signal: AbortSignal; resolve: (value: ReviewVerificationResult) => void; reject: (error: Error) => void }>;
const flush = () => { for (const effect of h.effects.splice(0)) effect(); };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function useTestRender(request: ReviewVerificationRequest | null, effects = true) {
  h.cursor = 0;
  const work = useReviewVerification(request);
  if (effects) flush();
  return work;
}
function unmount() {
  for (const slot of h.slots) if (slot && typeof slot === "object" && "cleanup" in slot) {
    const effect = slot as { cleanup?: () => void }; effect.cleanup?.(); effect.cleanup = undefined;
  }
}
beforeEach(() => {
  h.active = true; h.slots = []; h.cursor = 0; h.effects = []; h.listeners.clear(); h.worker.mockReset(); jobs = [];
  h.worker.mockImplementation((_input, signal) => new Promise((resolve, reject) => jobs.push({ signal, resolve, reject })));
});
afterEach(unmount);

describe("source-bound review verification lifecycle", () => {
  it("exposes no packet or report until the current worker result arrives", async () => {
    const request = input();
    expect(useTestRender(request)).toMatchObject({ status: "pending", result: null, payload: null, report: null });
    const result = output(); jobs[0].resolve(result); await settle();
    expect(useTestRender(request)).toMatchObject({ status: "ready", result, payload: null });
    expect(h.worker).toHaveBeenCalledOnce();
  });

  it("invalidates displayed output immediately on a new input, before effect cleanup", async () => {
    const original = input(); useTestRender(original); jobs[0].resolve(output()); await settle();
    expect(useTestRender(original).report).not.toBeNull();
    const changed = input();
    expect(useTestRender(changed, false)).toMatchObject({ status: "pending", report: null, result: null });
    flush(); expect(jobs[0].signal.aborted).toBe(true);
    jobs[1].resolve(output()); await settle();
    expect(useTestRender(changed).status).toBe("ready");
  });

  it("ignores a stale result arriving between a new render and old effect cleanup", async () => {
    const original = input(); useTestRender(original);
    const changed = input(); useTestRender(changed, false);
    jobs[0].resolve(output()); await settle();
    expect(useTestRender(changed, false)).toMatchObject({ status: "pending", report: null });
    flush(); expect(jobs[0].signal.aborted).toBe(true);
    expect(h.worker).toHaveBeenCalledTimes(2);
  });

  it("cancels visibly and ignores a worker that delivers despite abort", async () => {
    const request = input(), work = useTestRender(request); work.cancel();
    expect(jobs[0].signal.aborted).toBe(true);
    jobs[0].resolve(output()); await settle();
    expect(useTestRender(request)).toMatchObject({ status: "error", report: null, result: null });
    expect(useTestRender(request).error).toContain("취소");
  });

  it("retries explicitly without reviving the cancelled result", async () => {
    const request = input(); useTestRender(request).cancel();
    useTestRender(request).retry();
    expect(useTestRender(request)).toMatchObject({ status: "pending", report: null });
    jobs[0].resolve(output()); await settle();
    expect(useTestRender(request).report).toBeNull();
    jobs[1].resolve(output()); await settle();
    expect(useTestRender(request).status).toBe("ready");
  });

  it("retains the explicit incomplete message after transport abort rejection", async () => {
    const request = input(); useTestRender(request).cancel();
    jobs[0].reject(new DOMException("Transport aborted", "AbortError")); await settle();
    expect(useTestRender(request)).toMatchObject({ status: "error", result: null });
    expect(useTestRender(request).error).toContain("현재 검증은 미완료");
  });

  it.each([false, true])("clears a result on session invalidation, already completed=%s", async completed => {
    const request = input(); useTestRender(request);
    if (completed) { jobs[0].resolve(output()); await settle(); }
    h.active = false; for (const listener of h.listeners) listener();
    jobs[0].resolve(output()); await settle();
    expect(jobs[0].signal.aborted).toBe(true);
    expect(useTestRender(request)).toMatchObject({ status: "error", report: null, payload: null, result: null });
  });

  it("aborts on unmount and does not accept a late completion", async () => {
    const request = input(); useTestRender(request); unmount();
    jobs[0].resolve(output()); await settle();
    expect(jobs[0].signal.aborted).toBe(true);
    expect(h.listeners.size).toBe(0);
    expect(useTestRender(request, false).report).toBeNull();
  });

  it("withholds all output when the representative is removed", async () => {
    useTestRender(input()); const work = useTestRender(null);
    jobs[0].resolve(output()); await settle();
    expect(work).toMatchObject({ status: "idle", result: null, report: null, payload: null });
    expect(jobs[0].signal.aborted).toBe(true);
  });

  it("reports failure and requires an explicit retry", async () => {
    const request = input(); useTestRender(request); jobs[0].reject(Error("Synthetic worker failure")); await settle();
    expect(useTestRender(request)).toMatchObject({ status: "error", error: "Synthetic worker failure", result: null });
    expect(h.worker).toHaveBeenCalledOnce();
  });

  it("never starts while logged out or without an input", async () => {
    expect(useTestRender(null).status).toBe("idle");
    h.active = false; const request = input(); useTestRender(request); await settle();
    expect(useTestRender(request).status).toBe("error");
    expect(h.worker).not.toHaveBeenCalled();
  });
});
