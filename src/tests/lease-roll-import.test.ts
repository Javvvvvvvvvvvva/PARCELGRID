import { afterEach, describe, expect, it, vi } from "vitest";
import { createLeaseRollRow, leaseRollDraftSchema, LEASE_ROLL_VERSION, MAX_LEASE_IMPORT_BYTES, type LeaseRollDraft } from "@/lib/finance/lease-roll-contract";
import { readLeaseRollFile } from "@/lib/finance/lease-roll-import";

function source(): LeaseRollDraft {
  return { version: LEASE_ROLL_VERSION, projectId: "synthetic", scenarioId: "lease-scenario", sourceBasis: "a".repeat(64),
    revision: 3, updatedAt: "2026-11-11T00:00:00.000Z", calendarStart: null, rows: [createLeaseRollRow("unit-1")] };
}
const file = (text: string, name = "lease.json") => new File([text], name, { type: "application/json" });
const signal = () => new AbortController().signal;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("local lease-roll import", () => {
  it("preserves incomplete drafts, binding and revision without approving or adopting", async () => {
    const draft = source();
    const imported = await readLeaseRollFile(file(JSON.stringify(draft)), signal());
    expect(imported).toEqual(draft);
    expect(imported).not.toHaveProperty("financialApplied");
    imported.rows[0].unitLabel = "local edit";
    expect(draft.rows[0].unitLabel).toBe("");
  });
  it.each(["임대차.JSON", "lease.json"])("supports UTF-8 BOM and case-insensitive JSON: %s", async name => {
    expect(await readLeaseRollFile(file(`\ufeff${JSON.stringify(source())}`, name), signal())).toEqual(source());
  });
  it.each(["lease.pdf", "lease.json.exe", "lease"])("rejects non-JSON filename %s before reading", async name => {
    const stream = vi.fn();
    await expect(readLeaseRollFile({ name, size: 100, stream }, signal())).rejects.toThrow("JSON");
    expect(stream).not.toHaveBeenCalled();
  });
  it.each([0, -1, .5, Infinity, NaN, MAX_LEASE_IMPORT_BYTES + 1])("rejects size %s before reading", async size => {
    const stream = vi.fn();
    await expect(readLeaseRollFile({ name: "lease.json", size, stream }, signal())).rejects.toThrow("8 MiB");
    expect(stream).not.toHaveBeenCalled();
  });
  it.each(["한", "\u0000"])("exports and reimports every bounded string at maximum length (%j)", async char => {
    const draft = source();
    draft.rows = Array.from({ length: 256 }, (_, index) => ({ ...createLeaseRollRow(`${index}${char.repeat(195)}`),
      unitLabel: char.repeat(200), sourceName: char.repeat(300), sourceRef: char.repeat(1000) }));
    const exported = file(JSON.stringify(draft, null, 2));
    expect(exported.size).toBeLessThan(MAX_LEASE_IMPORT_BYTES);
    expect(await readLeaseRollFile(exported, signal())).toEqual(draft);
  });
  it("enforces actual streamed size independently of file metadata", async () => {
    const cancel = vi.fn();
    const stream = () => new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.enqueue(new Uint8Array(MAX_LEASE_IMPORT_BYTES + 1)); }, cancel });
    await expect(readLeaseRollFile({ name: "lease.json", size: 1, stream }, signal())).rejects.toThrow("허용 크기");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["null", "[]", "{", "1e400", '["'.repeat(10) + '"]'.repeat(10)])("rejects unsupported data %s", async value => {
    await expect(readLeaseRollFile(file(value), signal())).rejects.toThrow();
  });
  it.each([{ financialApplied: true }, { approvalStatus: "approved" }, { calendarStart: "2026-02-30" },
    { calendarStart: "2026-02-02" }, { calendarStart: "1899-01-01" }, { rows: Array(257).fill({}) },
    { sourceBasis: "different-plan" }, { revision: -1 }, { updatedAt: "yesterday" }])("rejects unknown/invalid metadata %j", async patch => {
    await expect(readLeaseRollFile(file(JSON.stringify({ ...source(), ...patch })), signal())).rejects.toThrow("형식");
  });
  it("normalizes IDs before checking duplicates and overlapping contracts", () => {
    const draft = source();
    draft.rows.push({ ...draft.rows[0], id: " unit-1 " });
    expect(leaseRollDraftSchema.safeParse(draft).success).toBe(false);
    draft.rows[1].id = "second";
    draft.rows[1].unitId = " unit-1 ";
    for (const row of draft.rows) { row.startDate = "2026-01-01"; row.endDate = "2026-01-31"; }
    expect(leaseRollDraftSchema.safeParse(draft).success).toBe(false);
  });
  it("rejects impossible dates and string amounts without zero coercion", () => {
    const draft = source(); draft.rows[0].startDate = "2027-02-29";
    expect(leaseRollDraftSchema.safeParse(draft).success).toBe(false);
    draft.rows[0].startDate = "2028-02-29";
    expect(leaseRollDraftSchema.safeParse(draft).success).toBe(true);
    expect(leaseRollDraftSchema.safeParse({ ...draft, rows: [{ ...draft.rows[0], monthlyRentWon: "0" }] }).success).toBe(false);
  });
  it("aborts before opening a stream", async () => {
    const controller = new AbortController(); controller.abort(); const stream = vi.fn();
    await expect(readLeaseRollFile({ name: "lease.json", size: 100, stream }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(stream).not.toHaveBeenCalled();
  });
  it("cancels stalled reads on session invalidation", async () => {
    const controller = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = () => new ReadableStream<Uint8Array<ArrayBuffer>>({ pull: () => new Promise(() => {}), cancel });
    const reading = readLeaseRollFile({ name: "lease.json", size: 100, stream }, controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("times out stalled streams and releases the reader", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull: () => new Promise(() => {}), cancel });
    const reading = expect(readLeaseRollFile({ name: "lease.json", size: 100, stream: () => body }, signal())).rejects.toThrow("시간");
    await vi.advanceTimersByTimeAsync(5000); await reading;
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
});
