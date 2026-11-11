import busboy from "busboy";
import { NextResponse } from "next/server";
import { bodyFailure, consumeBoundedBody, type BodyFailure } from "./bounded-body";

export async function readMultipartForm(request: Request, options: {
  fileField: string; maxFileBytes: number; fields: Record<string, number>; timeoutMs?: number;
}) {
  const reject = (failure: BodyFailure) => ({ ok: false as const, response: NextResponse.json(
    { code: failure.code, error: failure.error }, { status: failure.status, headers: { "Cache-Control": "no-store" } },
  ) });
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type) || type.length > 512) return reject(bodyFailure("INVALID_MULTIPART"));
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({ headers: { "content-type": type }, defParamCharset: "utf8", limits: {
      files: 1, fields: Object.keys(options.fields).length, parts: Object.keys(options.fields).length + 2,
      fileSize: options.maxFileBytes + 1, fieldSize: Math.max(0, ...Object.values(options.fields)) + 1,
    } });
  } catch { return reject(bodyFailure("INVALID_MULTIPART")); }
  const form = new FormData(), seen = new Set<string>(), controller = new AbortController();
  let failure: BodyFailure | undefined;
  const fail = (code: BodyFailure["code"]) => { failure ??= bodyFailure(code); controller.abort(); };
  parser.on("error", () => fail("INVALID_MULTIPART"));
  for (const event of ["partsLimit", "filesLimit", "fieldsLimit"] as const) parser.on(event, () => fail("MULTIPART_TOO_LARGE"));
  parser.on("field", (name, value, info) => {
    if (!Object.hasOwn(options.fields, name) || seen.has(name)) return fail("INVALID_MULTIPART_FIELD");
    seen.add(name);
    if (info.nameTruncated || info.valueTruncated || Buffer.byteLength(value) > options.fields[name]) return fail("MULTIPART_TOO_LARGE");
    form.set(name, value);
  });
  parser.on("file", (name, stream, info) => {
    stream.on("error", () => fail("INVALID_MULTIPART"));
    if (name !== options.fileField || seen.has(name)) { fail("INVALID_MULTIPART_FIELD"); stream.resume(); return; }
    seen.add(name);
    if (!info.filename || Buffer.byteLength(info.filename) > 512) { fail("INVALID_MULTIPART_FIELD"); stream.resume(); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    stream.on("limit", () => fail("MULTIPART_TOO_LARGE"));
    stream.on("data", (chunk: Buffer) => {
      if (failure) return;
      size += chunk.length;
      if (size > options.maxFileBytes) { fail("MULTIPART_TOO_LARGE"); return; }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      if (!failure) form.set(name, new File([Buffer.concat(chunks, size)], info.filename, { type: info.mimeType }));
    });
  });
  const signal = AbortSignal.any([request.signal, controller.signal]);
  try {
    const result = await consumeBoundedBody({ body: request.body, headers: request.headers, signal }, {
      maxBytes: options.maxFileBytes + 65_536, timeoutMs: options.timeoutMs ?? 30_000,
    }, chunk => new Promise<void>((resolve, reject) => {
      parser.write(chunk, error => error ? reject(error) : resolve());
    }), () => new Promise<void>((resolve, reject) => {
      parser.once("close", resolve);
      parser.once("error", reject);
      parser.end();
    }));
    if (failure) return reject(failure);
    if (!result.ok) return reject(result);
    return { ok: true as const, form };
  } finally { parser.destroy(); }
}
