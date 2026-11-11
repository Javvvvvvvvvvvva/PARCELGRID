import { afterEach, describe, expect, it, vi } from "vitest";
import { readMultipartForm } from "@/lib/http/bounded-multipart";
import { consumeBoundedBody } from "@/lib/http/bounded-body";

const options = { fileField: "file", maxFileBytes: 16, fields: { label: 12 } };
function form(size = 16) {
  const value = new FormData();
  value.set("label", "자료");
  value.set("file", new File([new Uint8Array(size)], "설계도.pdf", { type: "application/pdf" }));
  return value;
}
const request = (body: BodyInit, headers?: HeadersInit) => new Request("http://localhost/upload", { method: "POST", body, headers });
// Use received wire bytes: Node 24's outgoing FormData encoder has a cancel/enqueue race.
async function wireForm(body: FormData) {
  const encoded = request(body);
  return request(await encoded.arrayBuffer(), encoded.headers);
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("streamed multipart", () => {
  it("accepts exact file limits and preserves UTF-8 names across one-byte chunks", async () => {
    const original = request(form()), bytes = new Uint8Array(await original.arrayBuffer());
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (offset < bytes.length) c.enqueue(bytes.slice(offset, ++offset)); else c.close(); } });
    const streamed = new Request(original.url, { method: "POST", body, headers: original.headers, duplex: "half" } as RequestInit);
    const unbounded = vi.spyOn(streamed, "formData");
    const result = await readMultipartForm(streamed, options);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.form.get("label")).toBe("자료");
      const file = result.form.get("file") as File;
      expect(file.name).toBe("설계도.pdf"); expect(file.size).toBe(16); expect(file.type).toBe("application/pdf");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(16));
    }
    expect(unbounded).not.toHaveBeenCalled();
  });

  it.each([17, 65_600])("rejects excess file/body bytes: %s", async size => {
    const result = await readMultipartForm(await wireForm(form(size)), options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });
  it.each(["duplicate-field", "duplicate-file", "unknown", "wrong-file", "wrong-field"])("rejects %s without ambiguous form.get selection", async kind => {
    const value = form();
    if (kind === "duplicate-field") value.append("label", "second");
    if (kind === "duplicate-file") value.append("file", new File(["x"], "second.pdf"));
    if (kind === "unknown") value.append("extra", "x");
    if (kind === "wrong-file") value.set("file", "not-a-file");
    if (kind === "wrong-field") value.set("label", new File(["x"], "field.pdf"));
    const result = await readMultipartForm(await wireForm(value), options);
    expect(result.ok).toBe(false);
    if (!result.ok) { expect([400, 413]).toContain(result.response.status); expect(result.response.headers.get("cache-control")).toBe("no-store"); }
  });
  it.each(["x".repeat(13), "가".repeat(5)])("bounds field bytes rather than UTF-16 length", async label => {
    const value = form(); value.set("label", label);
    const result = await readMultipartForm(await wireForm(value), options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });
  it.each([undefined, "application/json", "multipart/form-data", "multipart/form-data; boundary="])("rejects invalid content-type: %s", async type => {
    const result = await readMultipartForm(request("secret-source", type ? { "content-type": type } : {}), options);
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.response.status).toBe(400); expect(await result.response.text()).not.toContain("secret-source"); }
  });
  it("rejects a truncated form instead of returning a partial file", async () => {
    const original = request(form()); const bytes = new Uint8Array(await original.arrayBuffer());
    const result = await readMultipartForm(request(bytes.slice(0, -20), original.headers), { ...options, maxFileBytes: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
  it("counts trailing bytes even after the parser saw its closing boundary", async () => {
    const original = request(form()); const bytes = new Uint8Array(await original.arrayBuffer());
    const result = await readMultipartForm(request(new Blob([bytes, new Uint8Array(65_536)]), original.headers), options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });
  it("rejects oversized declarations without reading", async () => {
    const original = await wireForm(form()); original.headers.set("content-length", "99999999");
    const read = vi.spyOn(ReadableStreamDefaultReader.prototype, "read");
    const result = await readMultipartForm(original, options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["timeout", "abort"])("cancels stalled streams without awaiting cancellation: %s", async kind => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {})), abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel }, { highWaterMark: 0 });
    const original = new Request("http://localhost/upload", { method: "POST", body, headers: { "content-type": "multipart/form-data; boundary=test" }, signal: abort.signal, duplex: "half" } as RequestInit);
    const pending = readMultipartForm(original, { ...options, timeoutMs: 100 });
    if (kind === "abort") abort.abort(); else await vi.advanceTimersByTimeAsync(101);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(kind === "abort" ? 400 : 408);
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["consume", "finish"])("the transport deadline also bounds a stalled %s callback", async phase => {
    vi.useFakeTimers();
    const stalled = () => new Promise<void>(() => {});
    const pending = consumeBoundedBody(request("x"), { maxBytes: 10, timeoutMs: 100 }, phase === "consume" ? stalled : () => {}, phase === "finish" ? stalled : undefined);
    await vi.advanceTimersByTimeAsync(101);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "REQUEST_TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
