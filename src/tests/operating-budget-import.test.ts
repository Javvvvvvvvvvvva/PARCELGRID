import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPERATING_BUDGET_VERSION, OPERATING_COST_CATEGORIES, resetOperatingBudgetCalendar, type OperatingBudgetDraft,
} from "@/lib/finance/operating-budget-contract";
import { readOperatingBudgetFile } from "@/lib/finance/operating-budget-import";

const MAX_BYTES = 8 * 1024 * 1024;
function source(): OperatingBudgetDraft {
  return {
    version: OPERATING_BUDGET_VERSION, projectId: "project", scenarioId: "scenario", sourceBasis: "a".repeat(64),
    revision: 4, updatedAt: "2024-01-01T00:00:00.000Z", calendarStart: null, baselineCalendarStart: null,
    scopeConfirmed: false, allocationNote: "",
    categories: OPERATING_COST_CATEGORIES.map(category => ({ category, sourceName: "", sourceRef: "", sourceAsOf: null, amounts: [] })),
  };
}
const file = (value: string, name = "budget.json") => new File([value], name, { type: "application/json" });
const signal = () => new AbortController().signal;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("bounded operating-budget import", () => {
  it("preserves incomplete drafts, revision, binding and baseline calendar without approval or mutation", async () => {
    const draft = source(); draft.baselineCalendarStart = "2024-01-01";
    const imported = await readOperatingBudgetFile(file(`\ufeff${JSON.stringify(draft)}`, "budget.JSON"), signal());
    expect(imported).toEqual(draft);
    expect(imported).not.toHaveProperty("financialApplied");
    imported.categories[0].sourceName = "Local edit";
    expect(draft.categories[0].sourceName).toBe("");
  });

  it("round-trips a full 24-month shape at maximum string lengths within structural bounds", async () => {
    const draft = resetOperatingBudgetCalendar(source(), "2024-01-01");
    draft.allocationNote = "\u0000".repeat(2000);
    draft.projectId = "p".repeat(200); draft.scenarioId = "s".repeat(200);
    for (const item of draft.categories) {
      item.sourceName = "\u0000".repeat(300); item.sourceRef = "\u0000".repeat(1000);
      item.amounts.forEach(amount => { amount.amountWon = 1e13; });
    }
    const exported = file(JSON.stringify(draft, null, 2));
    expect(exported.size).toBeLessThan(MAX_BYTES);
    expect(await readOperatingBudgetFile(exported, signal())).toEqual(draft);
  });

  it("rejects invalid filename and declared size before opening the stream", async () => {
    for (const [name, size] of [["budget.json.exe", 100], ["budget", 100], ["budget.json", 0],
      ["budget.json", -.5], ["budget.json", NaN], ["budget.json", Infinity], ["budget.json", MAX_BYTES + 1]] as const) {
      const stream = vi.fn();
      await expect(readOperatingBudgetFile({ name, size, stream }, signal())).rejects.toThrow("8 MiB");
      expect(stream).not.toHaveBeenCalled();
    }
  });

  it("enforces streamed bytes independently of metadata and cancels oversized streams", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.enqueue(new Uint8Array(MAX_BYTES + 1)); }, cancel });
    await expect(readOperatingBudgetFile({ name: "budget.json", size: 1, stream: () => body }, signal())).rejects.toThrow("허용 크기");
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("rejects structural depth, node count, nonfinite JSON and malformed input before schema acceptance", async () => {
    for (const value of ["null", "[]", "{", "1e400", JSON.stringify([[[[[[[0]]]]]]]), JSON.stringify(Array(8_000).fill(0))]) {
      await expect(readOperatingBudgetFile(file(value), signal())).rejects.toThrow();
    }
  });

  it("rejects unknown approval/prototype fields and nested duplicates instead of silently stripping them", async () => {
    const draft = resetOperatingBudgetCalendar(source(), "2024-01-01");
    const duplicate = structuredClone(draft); duplicate.categories[0].amounts[1].month = "2024-01";
    const nested = structuredClone(draft); Object.assign(nested.categories[0], { incomeTax: 10 });
    const prototype = JSON.parse('{"__proto__":{"approved":true}}') as Record<string, unknown>;
    for (const value of [{ ...draft, financialApplied: true }, { ...draft, approvalStatus: "approved" },
      { ...draft, ...prototype }, { ...draft, categories: [draft.categories[0], draft.categories[0]] }, duplicate, nested]) {
      await expect(readOperatingBudgetFile(file(JSON.stringify(value)), signal())).rejects.toThrow("형식");
    }
    expect(Object.prototype).not.toHaveProperty("approved");
  });

  it("aborts before opening a stream", async () => {
    const controller = new AbortController(); controller.abort(); const stream = vi.fn();
    await expect(readOperatingBudgetFile({ name: "budget.json", size: 100, stream }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(stream).not.toHaveBeenCalled();
  });

  it("cancels stalled reads on invalidation even when cancellation itself never settles", async () => {
    const controller = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull: () => new Promise(() => {}), cancel });
    const reading = readOperatingBudgetFile({ name: "budget.json", size: 100, stream: () => body }, controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
  });

  it("times out stalled reads at five seconds and releases the reader and timer", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull: () => new Promise(() => {}), cancel });
    const reading = expect(readOperatingBudgetFile({ name: "budget.json", size: 100, stream: () => body }, signal())).rejects.toThrow("시간");
    await vi.advanceTimersByTimeAsync(5_000); await reading;
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
});
