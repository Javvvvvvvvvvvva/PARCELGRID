/** Exact JSON-value comparison against a bounded, engine-owned expected structure. */
export function calculatedValueMatches(stored: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return stored === expected;
  if (stored === null || typeof stored !== "object" || Array.isArray(stored) !== Array.isArray(expected)) return false;
  const keys = Object.keys(expected).filter(key => (expected as Record<string, unknown>)[key] !== undefined);
  if (Object.keys(stored).filter(key => (stored as Record<string, unknown>)[key] !== undefined).length !== keys.length) return false;
  return keys.every(key => calculatedValueMatches((stored as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key]));
}
