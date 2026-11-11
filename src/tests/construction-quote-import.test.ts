import { afterEach, describe, expect, it, vi } from "vitest";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";
import { CONSTRUCTION_QUOTE_FILE_BYTES, CONSTRUCTION_QUOTE_FILE_TIMEOUT_MS, readConstructionQuoteFile } from "@/lib/planning/construction-quote-import";

const encoder = new TextEncoder();
const signal = () => new AbortController().signal;
function quoteFile(text: string, name = "quote.json") { return new File([text], name, { type: "application/json" }); }
function source() { return constructionQuoteFixture().scenario.constructionQuote!; }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("construction quote local import", () => {
  it("round-trips evidence without rebasing, rounding, approval or financial adoption", async () => {
    const quote = source();
    quote.sourceBasis = "old-plan-source";
    const before = structuredClone(quote);
    const actual = await readConstructionQuoteFile(quoteFile(JSON.stringify(quote, null, 2)), signal());
    expect(actual).toEqual(before);
    expect(actual).not.toHaveProperty("approvalStatus");
    expect(actual).not.toHaveProperty("financialApplied");
    actual.lines[0].note = "edited";
    expect(quote).toEqual(before);
  });

  it("preserves valid incomplete and arithmetically conflicting evidence for explicit review", async () => {
    const quote = source();
    quote.issuer = ""; quote.reviewDate = ""; quote.lines[0].amountWon = 10;
    expect(await readConstructionQuoteFile(quoteFile(JSON.stringify(quote)), signal())).toEqual(quote);
  });

  it.each(["quote.json", "QUOTE.JSON", "한국 견적.json"])("accepts UTF-8 JSON with case-insensitive extension: %s", async name => {
    const quote = source(); quote.issuer = "견적 발행자";
    expect((await readConstructionQuoteFile(quoteFile(`\ufeff${JSON.stringify(quote)}`, name), signal())).issuer).toBe(quote.issuer);
  });

  it.each(["quote.pdf", "quote.json.exe", "quote", "quote.xlsx"])("rejects other file formats before reading: %s", async name => {
    const stream = vi.fn();
    await expect(readConstructionQuoteFile({ name, size: 5, stream }, signal())).rejects.toThrow("JSON");
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([0, -1, .5, Infinity, NaN, CONSTRUCTION_QUOTE_FILE_BYTES + 1])("rejects invalid size %s before reading", async size => {
    const stream = vi.fn();
    await expect(readConstructionQuoteFile({ name: "x.json", size, stream }, signal())).rejects.toThrow("8 MiB");
    expect(stream).not.toHaveBeenCalled();
  });

  it("counts streamed bytes even if the size is understated", async () => {
    const cancelled = vi.fn();
    const stream = () => new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) { controller.enqueue(new Uint8Array(CONSTRUCTION_QUOTE_FILE_BYTES + 1)); }, cancel: cancelled,
    });
    await expect(readConstructionQuoteFile({ name: "x.json", size: 1, stream }, signal())).rejects.toThrow("허용 크기");
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("accepts exactly the maximum UTF-8 byte size", async () => {
    const text = JSON.stringify(source());
    const padding = " ".repeat(CONSTRUCTION_QUOTE_FILE_BYTES - encoder.encode(text).length);
    expect(await readConstructionQuoteFile(quoteFile(text + padding), signal())).toEqual(source());
  });

  it.each(["한", "\u0000"])("round-trips every schema string/row/link at maximum length, including %j escaping", async char => {
    const quote = source();
    quote.sourceBasis = char.repeat(200);
    quote.reference = quote.issuer = quote.projectReference = char.repeat(300);
    quote.lines = Array.from({ length: 256 }, (_, index) => ({ ...quote.lines[0],
      id: `${char.repeat(97)}${String(index).padStart(3, "0")}`, description: char.repeat(300),
      sourceLocator: char.repeat(300), note: char.repeat(2000) }));
    quote.coverage = quote.coverage.map(scope => ({ ...scope, lineIds: quote.lines.map(line => line.id), note: char.repeat(2000) }));
    const file = quoteFile(JSON.stringify(quote, null, 2));
    expect(file.size).toBeGreaterThan(2 * 1024 * 1024);
    expect(file.size).toBeLessThan(CONSTRUCTION_QUOTE_FILE_BYTES);
    expect(await readConstructionQuoteFile(file, signal())).toEqual(quote);
  });

  it("rejects malformed UTF-8", async () => {
    await expect(readConstructionQuoteFile(new File([new Uint8Array([0xc0, 0xff])], "quote.json"), signal())).rejects.toThrow("UTF-8");
  });

  it.each([" ", "null", "[]", "{", "1e400", '["'.repeat(9) + '"]'.repeat(9)])("rejects malformed/unsupported input %s", async text => {
    await expect(readConstructionQuoteFile(quoteFile(text), signal())).rejects.toThrow();
  });

  it("rejects excessively nested and numerous JSON values", async () => {
    await expect(readConstructionQuoteFile(quoteFile("[".repeat(10) + "0" + "]".repeat(10)), signal())).rejects.toThrow("중첩");
    await expect(readConstructionQuoteFile(quoteFile(JSON.stringify(Array(12_001).fill(0))), signal())).rejects.toThrow("항목 수");
  });

  it.each([
    { approvalStatus: "approved" }, { financialApplied: true }, { version: "construction-quote-2025.1" },
    { statedTotalWon: -1 }, { issuedOn: "2026-02-30" }, { lines: Array(257).fill({}) },
    { inputs: { constructionCostPerSqmWon: "123", basementCostMultiplier: 1 } },
  ])("rejects injected metadata and invalid fields %j", async patch => {
    await expect(readConstructionQuoteFile(quoteFile(JSON.stringify({ ...source(), ...patch })), signal())).rejects.toThrow("형식");
  });

  it("rejects duplicate line IDs and coverage IDs", async () => {
    const quote = source(); quote.lines[1].id = quote.lines[0].id;
    await expect(readConstructionQuoteFile(quoteFile(JSON.stringify(quote)), signal())).rejects.toThrow("형식");
    const coverage = source(); coverage.coverage[1].id = coverage.coverage[0].id;
    await expect(readConstructionQuoteFile(quoteFile(JSON.stringify(coverage)), signal())).rejects.toThrow("형식");
  });

  it("rejects an already cancelled read without opening the stream", async () => {
    const controller = new AbortController(); controller.abort();
    const stream = vi.fn();
    await expect(readConstructionQuoteFile({ name: "quote.json", size: 10, stream }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(stream).not.toHaveBeenCalled();
  });

  it("cancels a pending read without waiting for a stalled cancellation callback", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = () => new ReadableStream<Uint8Array<ArrayBuffer>>({ pull: () => new Promise(() => {}), cancel });
    const reading = readConstructionQuoteFile({ name: "quote.json", size: 10, stream }, controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds a stalled read and releases the stream", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull: () => new Promise(() => {}), cancel });
    const reading = expect(readConstructionQuoteFile({ name: "quote.json", size: 10, stream: () => body }, signal())).rejects.toThrow("시간");
    await vi.advanceTimersByTimeAsync(CONSTRUCTION_QUOTE_FILE_TIMEOUT_MS);
    await reading;
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
