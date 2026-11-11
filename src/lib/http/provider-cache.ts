/** Bounded completed responses only; callers own serialization weights and value isolation. */
export function createProviderCache<T>(maxEntries: number, maxBytes: number) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid provider cache limits.");
  const entries = new Map<string, { value: T; bytes: number; expires: number }>();
  let bytes = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.bytes; entries.delete(key); }
  };
  const prune = (now: number) => {
    for (const [key, entry] of entries) if (entry.expires <= now) remove(key);
  };
  return {
    delete: remove,
    get(key: string, now = Date.now()): T | undefined {
      prune(now);
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key); entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T, weight: number, expires: number, now = Date.now()): void {
      prune(now); remove(key);
      if (!Number.isSafeInteger(weight) || weight < 0 || weight > maxBytes || !Number.isFinite(expires) || expires <= now) return;
      while (entries.size >= maxEntries || bytes + weight > maxBytes) remove(entries.keys().next().value!);
      entries.set(key, { value, bytes: weight, expires }); bytes += weight;
    },
    stats(now = Date.now()) { prune(now); return { entries: entries.size, bytes }; },
  };
}
