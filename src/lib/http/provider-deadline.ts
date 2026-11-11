import { discardProviderBody, ProviderBodyError } from "./provider-body";

/** Timers cannot preempt synchronous parsing; monotonic checks reject late success. */
export function createProviderDeadline(timeoutMs: number, callerSignal?: AbortSignal, outerDeadline = Infinity) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647
    || (outerDeadline !== Infinity && !Number.isFinite(outerDeadline))) throw new Error("Invalid provider deadline.");
  const deadline = Math.min(performance.now() + timeoutMs, outerDeadline);
  const timeout = AbortSignal.timeout(Math.max(0, Math.ceil(deadline - performance.now())));
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const check = (response?: Response) => {
    if (signal.aborted || performance.now() >= deadline) {
      if (response) discardProviderBody(response);
      throw new ProviderBodyError("REQUEST_TIMEOUT");
    }
  };
  return { signal, deadline, check, remainingMs: () => { check(); return Math.max(1, Math.ceil(deadline - performance.now())); } };
}
