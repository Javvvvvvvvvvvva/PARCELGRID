export class ProviderConcurrencyError extends Error {
  constructor(readonly code: "PROVIDER_BUSY" | "REQUEST_ABORTED") {
    super(code === "PROVIDER_BUSY" ? "External request capacity is temporarily exhausted." : "External request was interrupted.");
    this.name = code === "REQUEST_ABORTED" ? "TimeoutError" : "ProviderConcurrencyError";
  }
}

/** Process-local admission only; not a shared rate limit or a provider billing quota. */
export function createProviderConcurrencyLimit(maxActive: number, maxQueued: number) {
  if (!Number.isSafeInteger(maxActive) || maxActive < 1 || !Number.isSafeInteger(maxQueued) || maxQueued < 0) {
    throw new Error("Invalid external request capacity configuration.");
  }
  let active = 0;
  const queue: Array<{ grant: () => void }> = [];
  const acquire = (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(new ProviderConcurrencyError("REQUEST_ABORTED"));
    if (active < maxActive) { active++; return Promise.resolve(); }
    if (queue.length >= maxQueued) return Promise.reject(new ProviderConcurrencyError("PROVIDER_BUSY"));
    return new Promise((resolve, reject) => {
      const entry = { grant: () => {
        signal.removeEventListener("abort", abort);
        active++;
        resolve();
      } };
      const abort = () => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        signal.removeEventListener("abort", abort);
        reject(new ProviderConcurrencyError("REQUEST_ABORTED"));
      };
      signal.addEventListener("abort", abort, { once: true });
      queue.push(entry);
    });
  };
  return async <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
    await acquire(signal);
    try {
      if (signal.aborted) throw new ProviderConcurrencyError("REQUEST_ABORTED");
      return await work();
    } finally {
      active--;
      queue.shift()?.grant();
    }
  };
}
