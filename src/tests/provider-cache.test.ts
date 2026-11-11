import { describe, expect, it } from "vitest";
import { createProviderCache } from "@/lib/http/provider-cache";

describe("completed provider cache bounds", () => {
  it("evicts the least recently used entry without refreshing source expiry", () => {
    const cache = createProviderCache<string>(2, 10);
    cache.set("a", "A", 3, 100, 0); cache.set("b", "B", 3, 100, 0);
    expect(cache.get("a", 10)).toBe("A");
    cache.set("c", "C", 3, 200, 20);
    expect(cache.get("b", 20)).toBeUndefined();
    expect(cache.get("a", 100)).toBeUndefined();
    expect(cache.stats(100)).toEqual({ entries: 1, bytes: 3 });
  });
  it("bounds weighted bytes at the exact limit and releases replacement/deletion weights", () => {
    const cache = createProviderCache<string>(10, 10);
    cache.set("a", "A", 6, 100, 0); cache.set("b", "B", 4, 100, 0);
    expect(cache.stats(0)).toEqual({ entries: 2, bytes: 10 });
    cache.set("a", "small", 1, 100, 0);
    expect(cache.stats(0).bytes).toBe(5);
    cache.set("c", "C", 6, 100, 0);
    expect(cache.get("b", 0)).toBeUndefined();
    cache.delete("c"); cache.delete("missing");
    expect(cache.stats(0)).toEqual({ entries: 1, bytes: 1 });
  });
  it.each([11, -1, NaN, Infinity, 1.5])("does not cache invalid/oversized weight %s", weight => {
    const cache = createProviderCache<string>(1, 10);
    cache.set("private-query", "private-value", weight, 100, 0);
    expect(cache.stats(0)).toEqual({ entries: 0, bytes: 0 });
  });
  it("prunes all expired entries on access, writes and stats", () => {
    const cache = createProviderCache<string>(2, 10);
    cache.set("a", "A", 5, 1, 0); cache.set("b", "B", 5, 2, 0);
    cache.set("c", "C", 5, 3, 2);
    expect(cache.stats(2)).toEqual({ entries: 1, bytes: 5 });
    expect(cache.stats(3)).toEqual({ entries: 0, bytes: 0 });
    cache.set("bad", "B", 5, Infinity, 0);
    expect(cache.get("bad", 0)).toBeUndefined();
  });
  it.each([[0, 1], [1, 0], [1.5, 10], [1, Infinity]])("validates limits %s/%s", (entries, bytes) => {
    expect(() => createProviderCache(entries, bytes)).toThrow("Invalid provider cache limits");
  });
});
