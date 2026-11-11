import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderDeadline } from "@/lib/http/provider-deadline";

afterEach(() => vi.restoreAllMocks());
describe("absolute provider budgets", () => {
  it("subtracts headers/queue time from body time with a monotonic clock", () => {
    let now = 10;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const budget = createProviderDeadline(1000);
    now = 710;
    expect(budget.remainingMs()).toBe(300);
    now = 1010;
    expect(budget.signal.aborted).toBe(false);
    expect(() => budget.check()).toThrowError(expect.objectContaining({ name: "TimeoutError" }));
  });
  it("uses the earliest outer deadline and discards late response bodies", () => {
    let now = 10;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const budget = createProviderDeadline(1000, undefined, 110);
    expect(budget.remainingMs()).toBe(100);
    now = 111;
    expect(() => budget.check(response)).toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("honors caller cancellation without waiting for its own timer", () => {
    const controller = new AbortController();
    const budget = createProviderDeadline(1000, controller.signal);
    controller.abort();
    expect(() => budget.remainingMs()).toThrow();
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])("rejects invalid timeout %s", timeout => {
    expect(() => createProviderDeadline(timeout)).toThrow("Invalid provider deadline");
  });
  it.each([NaN, -Infinity])("rejects invalid outer deadline %s", deadline => {
    expect(() => createProviderDeadline(10, undefined, deadline)).toThrow("Invalid provider deadline");
  });
});
