import { afterEach, describe, expect, it, vi } from "vitest";
import { readProviderJson, readProviderText, discardProviderBody } from "@/lib/http/provider-body";
import { readConceptRenderResponse } from "@/lib/ai/concept-render-response";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("bounded provider bodies", () => {
  it("reads valid split UTF-8 and JSON without unbounded response helpers", async () => {
    const bytes = new TextEncoder().encode('{"label":"공식"}');
    let offset = 0;
    const response = new Response(new ReadableStream({ pull(c) { if (offset < bytes.length) c.enqueue(bytes.slice(offset, ++offset)); else c.close(); } }));
    const json = vi.spyOn(response, "json"), text = vi.spyOn(response, "text");
    await expect(readProviderJson(response, { maxBytes: bytes.length })).resolves.toEqual({ label: "공식" });
    expect(json).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
  });
  it.each([undefined, "0", "1"])("counts actual bytes despite content-length %s", async length => {
    const cancel = vi.fn(); let read = 0;
    const response = new Response(new ReadableStream({ pull(c) { read++; c.enqueue(new Uint8Array(10)); }, cancel }, { highWaterMark: 0 }),
      { headers: length ? { "content-length": length } : {} });
    await expect(readProviderText(response, { maxBytes: 11 })).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
    expect(read).toBe(2); expect(cancel).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false);
  });
  it.each(["timeout", "abort"])("terminates stalled responses and releases locks: %s", async kind => {
    vi.useFakeTimers();
    const controller = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }, { highWaterMark: 0 }));
    const pending = readProviderText(response, { maxBytes: 100, timeoutMs: 100, signal: controller.signal });
    const expectation = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    if (kind === "abort") controller.abort(); else await vi.advanceTimersByTimeAsync(101);
    await expectation;
    expect(cancel).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["{", '{"nested":'.repeat(50) + "1" + "}".repeat(50), '{"number":1e400}'])("rejects invalid provider JSON without source text", async body => {
    await expect(readProviderJson(new Response(body), { maxBytes: 2000 })).rejects.toThrow("External response failed bounded validation.");
  });
  it("does not await discarded HTTP error bodies", () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    discardProviderBody(new Response(new ReadableStream({ cancel })));
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("image response validation", () => {
  const parse = (body: unknown, status = 200) => readConceptRenderResponse(Response.json(body, { status }), new AbortController().signal);
  it("retains valid PNG bytes and bounded token usage", async () => {
    const result = await parse({ data: [{ b64_json: png }], usage: { input_tokens: 2, total_tokens: 5 } });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.bytes.toString("base64")).toBe(png); expect(result.usage?.total_tokens).toBe(5); }
  });
  it.each([
    null, {}, { data: [] }, { data: [{ b64_json: 1 }] }, { data: [{ b64_json: "???" }] },
    { data: [{ b64_json: png + "!" }] }, { data: [{ b64_json: "aGVsbG8=" }] },
    { data: [{ b64_json: png }, { b64_json: png }] },
    { data: [{ b64_json: png }], usage: { total_tokens: -1 } },
    { data: [{ b64_json: png }], usage: { input_tokens: "2" } },
  ])("rejects malformed image or usage contracts", async value => {
    expect(await parse(value)).toMatchObject({ ok: false, status: 502, code: "OPENAI_IMAGE_ERROR" });
  });
  it.each([400, 401, 429, 500])("never echoes upstream secrets, status %s", async status => {
    const result = await parse({ error: { code: "private-provider-code", message: "api-key-and-private-prompt" } }, status);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private");
    if (!result.ok) expect(result.status).toBe(status === 429 ? 429 : 502);
  });
  it("keeps moderation failures distinguishable without echoing text", async () => {
    expect(await parse({ error: { code: "moderation_blocked", message: "secret" } }, 400))
      .toMatchObject({ ok: false, status: 422, code: "moderation_blocked" });
  });
  it("rejects oversized image responses before reading", async () => {
    const response = new Response("{}", { headers: { "content-length": String(24 * 1024 * 1024 + 1) } });
    const read = vi.spyOn(ReadableStreamDefaultReader.prototype, "read");
    expect(await readConceptRenderResponse(response, new AbortController().signal)).toMatchObject({ ok: false, status: 502 });
    expect(read).not.toHaveBeenCalled();
  });
});
