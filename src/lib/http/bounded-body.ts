export const bodyErrors = {
  INVALID_JSON_OPTIONS: [400, "요청 본문 제한 설정이 올바르지 않습니다."],
  INVALID_CONTENT_LENGTH: [400, "요청 본문 길이 정보가 올바르지 않습니다."],
  EMPTY_BODY: [400, "요청 본문이 필요합니다."],
  BODY_READ_ERROR: [400, "요청 본문을 읽을 수 없습니다."],
  INVALID_UTF8: [400, "본문은 올바른 UTF-8 형식이어야 합니다."],
  INVALID_JSON: [400, "올바른 JSON 본문이 필요합니다."],
  INVALID_JSON_NUMBER: [400, "JSON 숫자가 유한한 범위를 벗어났습니다."],
  REQUEST_ABORTED: [400, "요청이 취소되었습니다."],
  REQUEST_TIMEOUT: [408, "본문을 읽는 시간이 초과되었습니다."],
  BODY_TOO_LARGE: [413, "본문이 허용 크기를 초과했습니다."],
  JSON_TOO_DEEP: [413, "JSON 중첩 깊이가 허용 범위를 초과했습니다."],
  JSON_TOO_MANY_NODES: [413, "JSON 항목 수가 허용 범위를 초과했습니다."],
  INVALID_MULTIPART: [400, "업로드 양식이 올바르지 않습니다."],
  INVALID_MULTIPART_FIELD: [400, "업로드 항목이 중복되었거나 허용 형식이 아닙니다."],
  MULTIPART_TOO_LARGE: [413, "업로드 파일·항목 수 또는 크기가 허용 범위를 초과했습니다."],
} as const;

export type BodyFailureCode = keyof typeof bodyErrors;
export type BodyFailure = { ok: false; status: 400 | 408 | 413; code: BodyFailureCode; error: string };
export function bodyFailure(code: BodyFailureCode): BodyFailure {
  const [status, error] = bodyErrors[code];
  return { ok: false, status, code, error };
}
export class BodyReadError extends Error {
  constructor(readonly code: BodyFailureCode) { super(bodyErrors[code][1]); this.name = "BodyReadError"; }
}
export interface BodySource {
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  signal?: AbortSignal;
}
export interface BodyLimits { maxBytes: number; timeoutMs?: number }

/** Consumers and finalization share one deadline; cancellation never blocks returning an error. */
export async function consumeBoundedBody(
  source: BodySource, options: BodyLimits,
  consume: (chunk: Uint8Array) => void | Promise<void>,
  finish?: () => void | Promise<void>,
): Promise<{ ok: true } | BodyFailure> {
  const { maxBytes, timeoutMs = 10_000 } = options ?? {};
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    return bodyFailure("INVALID_JSON_OPTIONS");
  }
  const deadline = performance.now() + timeoutMs;
  let interruption: BodyFailureCode | undefined;
  let wake: (() => void) | undefined;
  const interrupt = (code: BodyFailureCode) => { interruption ??= code; wake?.(); };
  const onAbort = () => interrupt("REQUEST_ABORTED");
  const check = () => {
    if (!interruption) {
      if (source.signal?.aborted) onAbort();
      else if (performance.now() >= deadline) interrupt("REQUEST_TIMEOUT");
    }
    if (interruption) throw new BodyReadError(interruption);
  };
  const timer = setTimeout(() => interrupt("REQUEST_TIMEOUT"), timeoutMs);
  source.signal?.addEventListener("abort", onAbort, { once: true });
  const wait = async <T>(operation: () => T | Promise<T>): Promise<T> => {
    check();
    try {
      const result = await new Promise<T>((resolve, reject) => {
        wake = () => reject(new BodyReadError(interruption!));
        Promise.resolve().then(operation).then(resolve, reject);
      });
      check();
      return result;
    } finally { wake = undefined; }
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  try {
    if (source.body) reader = source.body.getReader();
    check();
    const length = source.headers.get("content-length");
    if (length !== null) {
      if (!/^[0-9]+$/.test(length)) throw new BodyReadError("INVALID_CONTENT_LENGTH");
      const declared = Number(length);
      if (!Number.isSafeInteger(declared) || declared > maxBytes) throw new BodyReadError("BODY_TOO_LARGE");
    }
    if (!reader) throw new BodyReadError("EMPTY_BODY");
    let bytes = 0;
    while (true) {
      const chunk = await wait(() => reader!.read());
      if (chunk.done) { finished = true; break; }
      if (!(chunk.value instanceof Uint8Array)) throw new BodyReadError("BODY_READ_ERROR");
      if (chunk.value.byteLength > maxBytes - bytes) throw new BodyReadError("BODY_TOO_LARGE");
      bytes += chunk.value.byteLength;
      await wait(() => consume(chunk.value));
    }
    if (finish) await wait(finish);
    return { ok: true };
  } catch (error) {
    return bodyFailure(interruption ?? (error instanceof BodyReadError ? error.code : "BODY_READ_ERROR"));
  } finally {
    clearTimeout(timer);
    source.signal?.removeEventListener("abort", onAbort);
    wake = undefined;
    if (reader) {
      if (!finished) { try { void reader.cancel().catch(() => {}); } catch { /* Best effort. */ } }
      try { reader.releaseLock(); } catch { /* Already unavailable. */ }
    }
  }
}

export async function readBoundedText(source: BodySource, options: BodyLimits): Promise<{ ok: true; value: string } | BodyFailure> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let value = "";
  const result = await consumeBoundedBody(source, options, chunk => {
    try { value += decoder.decode(chunk, { stream: true }); }
    catch { throw new BodyReadError("INVALID_UTF8"); }
  }, () => {
    try { value += decoder.decode(); }
    catch { throw new BodyReadError("INVALID_UTF8"); }
  });
  return result.ok ? { ok: true, value } : result;
}
