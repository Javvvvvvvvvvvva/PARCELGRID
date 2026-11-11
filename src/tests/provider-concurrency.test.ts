import { describe, expect, it, vi } from "vitest";
import { createProviderConcurrencyLimit } from "@/lib/http/provider-concurrency";

function latch() {
  let resolve!: () => void;
  return { promise: new Promise<void>(r => { resolve = r; }), release: () => resolve() };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("bounded provider admission", () => {
  it.each([[0, 1], [1.5, 1], [1, -1], [1, Infinity]])("rejects invalid capacity %s/%s", (active, queue) => {
    expect(() => createProviderConcurrencyLimit(active, queue)).toThrow("Invalid external request capacity configuration.");
  });
  it("admits only the active capacity and serves bounded waiters in order", async () => {
    const run = createProviderConcurrencyLimit(2, 3), barrier = latch(), started: number[] = [];
    const tasks = Array.from({ length: 5 }, (_, i) => run(new AbortController().signal, async () => { started.push(i); if (i < 2) await barrier.promise; return i; }));
    await tick(); expect(started).toEqual([0, 1]);
    const excess = vi.fn(async () => 99);
    await expect(run(new AbortController().signal, excess)).rejects.toMatchObject({ code: "PROVIDER_BUSY" });
    expect(excess).not.toHaveBeenCalled();
    barrier.release(); expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4]);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });
  it("removes an aborted waiter and reuses its queue slot without dispatching it", async () => {
    const run = createProviderConcurrencyLimit(1, 1), barrier = latch(), controller = new AbortController();
    const active = run(new AbortController().signal, () => barrier.promise);
    const abandoned = vi.fn(async () => 1), pending = expect(run(controller.signal, abandoned)).rejects.toMatchObject({ name: "TimeoutError" });
    controller.abort(); await pending;
    const next = run(new AbortController().signal, async () => 2);
    barrier.release(); await active; expect(await next).toBe(2); expect(abandoned).not.toHaveBeenCalled();
  });
  it("releases active capacity on both rejection and synchronous throws", async () => {
    const run = createProviderConcurrencyLimit(1, 1);
    await expect(run(new AbortController().signal, () => { throw new Error("failure"); })).rejects.toThrow("failure");
    await expect(run(new AbortController().signal, async () => { throw new Error("failure"); })).rejects.toThrow("failure");
    expect(await run(new AbortController().signal, async () => 3)).toBe(3);
  });
  it("does not dispatch a task aborted before admission", async () => {
    const run = createProviderConcurrencyLimit(1, 0), controller = new AbortController(), work = vi.fn(async () => 1);
    controller.abort(); await expect(run(controller.signal, work)).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(work).not.toHaveBeenCalled();
    expect(await run(new AbortController().signal, async () => 2)).toBe(2);
  });
  it("does not dispatch an admitted task aborted before its callback", async () => {
    const run = createProviderConcurrencyLimit(1, 1), controller = new AbortController(), work = vi.fn(async () => 1);
    const pending = expect(run(controller.signal, work)).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    controller.abort(); await pending; expect(work).not.toHaveBeenCalled();
    expect(await run(new AbortController().signal, async () => 2)).toBe(2);
  });
  it("retains an active slot until an ignoring operation settles", async () => {
    const run = createProviderConcurrencyLimit(1, 0), barrier = latch(), controller = new AbortController();
    const active = run(controller.signal, () => barrier.promise); await tick(); controller.abort();
    await expect(run(new AbortController().signal, async () => 1)).rejects.toMatchObject({ code: "PROVIDER_BUSY" });
    barrier.release(); await active;
    expect(await run(new AbortController().signal, async () => 2)).toBe(2);
  });
});
