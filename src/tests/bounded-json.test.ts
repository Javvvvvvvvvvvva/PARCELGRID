import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readBoundedJson } from "@/lib/http/bounded-json";

const encoder = new TextEncoder();
const url = "http://localhost/api/example";
const never = () => new Promise<void>(() => {});

function streamed(
  chunks: Uint8Array[],
  headers?: HeadersInit,
  signal?: AbortSignal,
) {
  let index = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
  const request = new Request(url, {
    method: "POST", body, headers, signal, duplex: "half",
  } as RequestInit);
  return { request, body, cancel };
}

function stalled(signal?: AbortSignal, cancel = vi.fn(never)) {
  const pull = vi.fn(never);
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  const request = new Request(url, {
    method: "POST", body, signal, duplex: "half",
  } as RequestInit);
  return { request, body, pull, cancel };
}

function textRequest(source: string) {
  return new Request(url, { method: "POST", body: source });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("readBoundedJson", () => {
  it.each(["1e400", "-1e400", '{"unknown":{"value":1e400}}', "[1,-1e400]"])(
    "rejects exponent overflow before unknown metadata can be canonicalized to null: %s", async source => {
      await expect(readBoundedJson(textRequest(source), { maxBytes: 100 }))
        .resolves.toMatchObject({ ok: false, status: 400, code: "INVALID_JSON_NUMBER" });
    },
  );
  it.each([undefined, "0", "1", "0001"])(
    "counts actual streamed bytes with missing or understated content-length %s",
    async (length) => {
      const chunks = [encoder.encode('{"n":'), encoder.encode("123}")];
      const headers = length === undefined ? undefined : { "content-length": length };
      const { request, body } = streamed(chunks, headers);
      const json = vi.spyOn(request, "json");
      const text = vi.spyOn(request, "text");
      await expect(readBoundedJson(request, { maxBytes: 9 }))
        .resolves.toEqual({ ok: true, value: { n: 123 } });
      expect(json).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);

      const oversized = streamed(chunks, headers);
      const read = vi.spyOn(ReadableStreamDefaultReader.prototype, "read");
      await expect(readBoundedJson(oversized.request, { maxBytes: 8 }))
        .resolves.toMatchObject({ ok: false, status: 413, code: "BODY_TOO_LARGE" });
      expect(read).toHaveBeenCalledTimes(2);
      expect(oversized.cancel).toHaveBeenCalledOnce();
      expect(oversized.body.locked).toBe(false);
    },
  );

  it.each(["9", "0009", "0".repeat(400) + "9"])(
    "accepts a declared length exactly at the byte limit: %s",
    async (length) => {
      const { request } = streamed([encoder.encode('{"n":123}')], { "content-length": length });
      await expect(readBoundedJson(request, { maxBytes: 9 }))
        .resolves.toEqual({ ok: true, value: { n: 123 } });
    },
  );

  it.each(["10", "00010", "9007199254740992", "999999999999999999999999", "9".repeat(400)])(
    "rejects oversized declared length before reading even a small body: %s",
    async (length) => {
      const { request, body, cancel } = streamed([encoder.encode("{}")], { "content-length": length });
      const read = vi.spyOn(ReadableStreamDefaultReader.prototype, "read");
      await expect(readBoundedJson(request, { maxBytes: 9 }))
        .resolves.toMatchObject({ ok: false, status: 413, code: "BODY_TOO_LARGE" });
      expect(read).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    },
  );

  it("does not await cancellation when rejecting an oversized declaration", async () => {
    vi.useFakeTimers();
    const { request, body, pull, cancel } = stalled();
    request.headers.set("content-length", "11");
    const read = vi.spyOn(ReadableStreamDefaultReader.prototype, "read");
    const remove = vi.spyOn(request.signal, "removeEventListener");
    await expect(readBoundedJson(request, { maxBytes: 10 }))
      .resolves.toMatchObject({ ok: false, status: 413, code: "BODY_TOO_LARGE" });
    expect(read).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an oversized declaration even without a body", async () => {
    const request = new Request(url, { headers: { "content-length": "11" } });
    await expect(readBoundedJson(request, { maxBytes: 10 }))
      .resolves.toMatchObject({ ok: false, status: 413, code: "BODY_TOO_LARGE" });
  });

  it.each(["", "-1", "+1", "1.0", "1e2", "NaN", "Infinity", "1, 1", "1 2", "0x10"])(
    "rejects malformed content-length %j before reading",
    async (length) => {
      const { request, cancel } = streamed([encoder.encode("{}")], { "content-length": length });
      const read = vi.spyOn(ReadableStreamDefaultReader.prototype, "read");
      await expect(readBoundedJson(request, { maxBytes: 10 }))
        .resolves.toMatchObject({ ok: false, status: 400, code: "INVALID_CONTENT_LENGTH" });
      expect(read).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([undefined, "text/plain", "application/octet-stream", "application/json"])(
    "accepts NextRequest without imposing a content-type policy (%s)",
    async (type) => {
      const request = new NextRequest(url, {
        method: "POST",
        body: encoder.encode('{"ok":true}'),
        headers: type ? { "content-type": type } : undefined,
      });
      await expect(readBoundedJson(request, { maxBytes: 11 }))
        .resolves.toEqual({ ok: true, value: { ok: true } });
    },
  );

  it("handles split UTF-8 characters and exact byte boundaries", async () => {
    const source = '"한😀"';
    const bytes = encoder.encode(source);
    expect(bytes.byteLength).toBe(9);
    const chunks = [...bytes].map((byte) => Uint8Array.of(byte));
    await expect(readBoundedJson(streamed(chunks).request, { maxBytes: 9 }))
      .resolves.toEqual({ ok: true, value: "한😀" });
    await expect(readBoundedJson(streamed(chunks).request, { maxBytes: 8 }))
      .resolves.toMatchObject({ ok: false, status: 413, code: "BODY_TOO_LARGE" });
  });

  it("counts UTF-8 BOM bytes and skips empty chunks", async () => {
    const chunks = [new Uint8Array(), Uint8Array.of(0xef), Uint8Array.of(0xbb, 0xbf), encoder.encode("0")];
    await expect(readBoundedJson(streamed(chunks).request, { maxBytes: 4 }))
      .resolves.toEqual({ ok: true, value: 0 });
    await expect(readBoundedJson(streamed(chunks).request, { maxBytes: 3 }))
      .resolves.toMatchObject({ ok: false, code: "BODY_TOO_LARGE" });
  });

  it.each([
    [0x22, 0xff, 0x22],
    [0x22, 0xc0, 0xaf, 0x22],
    [0x22, 0xed, 0xa0, 0x80, 0x22],
    [0x22, 0xe2, 0x82],
  ])("rejects invalid or incomplete UTF-8 (%j)", async (...bytes) => {
    await expect(readBoundedJson(streamed([Uint8Array.from(bytes)]).request, { maxBytes: 20 }))
      .resolves.toMatchObject({ ok: false, status: 400, code: "INVALID_UTF8" });
  });

  it.each(["{", " ", '{"secret-marker":}', "{} {}", "null trailing", "[1,]"])(
    "rejects invalid JSON without reflecting input: %j",
    async (source) => {
      const result = await readBoundedJson(textRequest(source), { maxBytes: 100 });
      expect(result).toMatchObject({ ok: false, status: 400, code: "INVALID_JSON" });
      if (!result.ok) {
        expect(result.error.length).toBeLessThan(100);
        expect(result.error).toMatch(/[가-힣]/);
        expect(result.error).not.toContain("secret-marker");
      }
    },
  );

  it("rejects missing and empty bodies", async () => {
    for (const request of [new Request(url), textRequest(""), streamed([]).request]) {
      await expect(readBoundedJson(request, { maxBytes: 10 }))
        .resolves.toMatchObject({ ok: false, status: 400, code: "EMPTY_BODY" });
    }
  });

  it.each(["null", "true", "12", '"value"', "{}", "[]"])(
    "accepts any JSON root at depth zero: %s",
    async (source) => {
      await expect(readBoundedJson(textRequest(source), { maxBytes: 20, maxDepth: 0, maxNodes: 1 }))
        .resolves.toEqual({ ok: true, value: JSON.parse(source) });
    },
  );

  it("enforces the default depth boundary iteratively", async () => {
    for (const depth of [48, 49, 512]) {
      const source = "[".repeat(depth) + "0" + "]".repeat(depth);
      const result = await readBoundedJson(textRequest(source), { maxBytes: 2_000 });
      if (depth === 48) expect(result.ok).toBe(true);
      else expect(result).toMatchObject({ ok: false, status: 413, code: "JSON_TOO_DEEP" });
    }
  });

  it("counts containers, nulls and primitive leaves, with root depth zero", async () => {
    const source = '{"items":[null,true,{"n":1}]}';
    await expect(readBoundedJson(textRequest(source), { maxBytes: 100, maxDepth: 3, maxNodes: 6 }))
      .resolves.toEqual({ ok: true, value: { items: [null, true, { n: 1 }] } });
    await expect(readBoundedJson(textRequest(source), { maxBytes: 100, maxDepth: 2 }))
      .resolves.toMatchObject({ ok: false, status: 413, code: "JSON_TOO_DEEP" });
    await expect(readBoundedJson(textRequest(source), { maxBytes: 100, maxNodes: 5 }))
      .resolves.toMatchObject({ ok: false, status: 413, code: "JSON_TOO_MANY_NODES" });
    await expect(readBoundedJson(textRequest('{"a":0}'), { maxBytes: 100, maxDepth: 0 }))
      .resolves.toMatchObject({ ok: false, code: "JSON_TOO_DEEP" });
  });

  it("bounds wide arrays and objects with small node budgets", async () => {
    for (const source of [
      '[0,1,2,3,4,5]', '{"a":0,"b":1,"c":2,"d":3,"e":4,"f":5}',
      '[{},{},{},{},{},{}]', '{"a":{},"b":{},"c":{},"d":{},"e":{},"f":{}}',
    ]) {
      await expect(readBoundedJson(textRequest(source), { maxBytes: 100, maxNodes: 6 }))
        .resolves.toMatchObject({ ok: false, status: 413, code: "JSON_TOO_MANY_NODES" });
    }
  });

  it("treats prototype-related keys as own data and includes them in limits", async () => {
    const source = '{"__proto__":{"boundedJsonPolluted":true},"constructor":{"prototype":{"x":1}},"hasOwnProperty":0}';
    const result = await readBoundedJson(textRequest(source), { maxBytes: 200, maxNodes: 7 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
      expect(Object.hasOwn(result.value as object, "__proto__")).toBe(true);
      expect(result.value).toEqual(JSON.parse(source));
    }
    expect(Object.hasOwn(Object.prototype, "boundedJsonPolluted")).toBe(false);
    await expect(readBoundedJson(textRequest(source), { maxBytes: 200, maxNodes: 6 }))
      .resolves.toMatchObject({ ok: false, code: "JSON_TOO_MANY_NODES" });
    await expect(readBoundedJson(textRequest(source), { maxBytes: 200, maxDepth: 2 }))
      .resolves.toMatchObject({ ok: false, code: "JSON_TOO_DEEP" });
  });

  it.each([
    {}, { maxBytes: 0 }, { maxBytes: -1 }, { maxBytes: 1.5 }, { maxBytes: NaN },
    { maxBytes: Infinity }, { maxBytes: Number.MAX_SAFE_INTEGER + 1 }, { maxBytes: "10" },
    { maxBytes: 10, maxDepth: -1 }, { maxBytes: 10, maxDepth: 1.5 },
    { maxBytes: 10, maxDepth: null }, { maxBytes: 10, maxDepth: Infinity },
    { maxBytes: 10, maxNodes: 0 }, { maxBytes: 10, maxNodes: NaN },
    { maxBytes: 10, timeoutMs: 0 }, { maxBytes: 10, timeoutMs: -1 },
    { maxBytes: 10, timeoutMs: 0.5 }, { maxBytes: 10, timeoutMs: Infinity },
    { maxBytes: 10, timeoutMs: 2_147_483_648 }, null, undefined,
  ])("validates options without consuming the body: %j", async (options) => {
    const request = textRequest("{}");
    await expect(readBoundedJson(request, options as Parameters<typeof readBoundedJson>[1]))
      .resolves.toMatchObject({ ok: false, status: 400, code: "INVALID_JSON_OPTIONS" });
    expect(request.bodyUsed).toBe(false);
    expect(request.body?.locked).toBe(false);
  });

  it("interrupts a pending read on abort even when pull and cancel never settle", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { request, body, pull, cancel } = stalled(controller.signal);
    const remove = vi.spyOn(request.signal, "removeEventListener");
    const pending = readBoundedJson(request, { maxBytes: 10 });
    await Promise.resolve();
    expect(pull).toHaveBeenCalledOnce();
    controller.abort(new Error("secret-marker"));
    await expect(pending).resolves.toMatchObject({ ok: false, status: 400, code: "REQUEST_ABORTED" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors an already-aborted request without reading", async () => {
    const { request, body, pull, cancel } = stalled(AbortSignal.abort());
    await expect(readBoundedJson(request, { maxBytes: 10 }))
      .resolves.toMatchObject({ ok: false, status: 400, code: "REQUEST_ABORTED" });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("uses a 10-second default timeout even when pull and cancel never settle", async () => {
    vi.useFakeTimers();
    const { request, body, cancel } = stalled();
    let settled = false;
    const pending = readBoundedJson(request, { maxBytes: 10 }).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ ok: false, status: 408, code: "REQUEST_TIMEOUT" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reset the absolute deadline when chunks arrive", async () => {
    vi.useFakeTimers();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn(never);
    const body = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; }, cancel,
    });
    const request = new Request(url, { method: "POST", body, duplex: "half" } as RequestInit);
    const pending = readBoundedJson(request, { maxBytes: 100, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(60);
    streamController.enqueue(encoder.encode("["));
    await vi.advanceTimersByTimeAsync(39);
    streamController.enqueue(encoder.encode("0"));
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ ok: false, status: 408, code: "REQUEST_TIMEOUT" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 1])("enforces the absolute deadline for continuous %i-byte chunks without timer callbacks", async (size) => {
    vi.useFakeTimers();
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const cancel = vi.fn(never);
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      elapsed += 2;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    });
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const request = new Request(url, { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readBoundedJson(request, { maxBytes: 10, timeoutMs: 8 }))
      .resolves.toMatchObject({ ok: false, status: 408, code: "REQUEST_TIMEOUT" });
    expect(pull).toHaveBeenCalledTimes(4);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["pending", "rejected", "throwing"])(
    "does not wait for %s cancellation after a byte-limit failure",
    async (mode) => {
      const cancel = vi.fn(() => {
        if (mode === "pending") return never();
        if (mode === "rejected") return Promise.reject(new Error("secret-marker"));
        throw new Error("secret-marker");
      });
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(encoder.encode("123")); }, cancel,
      }, { highWaterMark: 0 });
      const request = new Request(url, { method: "POST", body, duplex: "half" } as RequestInit);
      await expect(readBoundedJson(request, { maxBytes: 2 }))
        .resolves.toMatchObject({ ok: false, status: 413, code: "BODY_TOO_LARGE" });
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    },
  );

  it("handles source errors without exposing their messages", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() { throw new Error("secret-marker"); },
    });
    const request = new Request(url, { method: "POST", body, duplex: "half" } as RequestInit);
    const result = await readBoundedJson(request, { maxBytes: 10 });
    expect(result).toMatchObject({ ok: false, status: 400, code: "BODY_READ_ERROR" });
    expect(JSON.stringify(result)).not.toContain("secret-marker");
    expect(body.locked).toBe(false);
  });

  it("rejects locked and consumed bodies", async () => {
    const locked = textRequest("{}");
    const reader = locked.body!.getReader();
    await expect(readBoundedJson(locked, { maxBytes: 10 }))
      .resolves.toMatchObject({ ok: false, code: "BODY_READ_ERROR" });
    expect(locked.body!.locked).toBe(true);
    reader.releaseLock();
    const consumed = textRequest("{}");
    await consumed.text();
    await expect(readBoundedJson(consumed, { maxBytes: 10 }))
      .resolves.toMatchObject({ ok: false, status: 400 });
  });

  it("cleans up the timer and abort listener after success", async () => {
    vi.useFakeTimers();
    const { request, body, cancel } = streamed([encoder.encode("null")]);
    const remove = vi.spyOn(request.signal, "removeEventListener");
    await expect(readBoundedJson(request, { maxBytes: 4 }))
      .resolves.toEqual({ ok: true, value: null });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(cancel).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
