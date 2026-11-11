import { bodyFailure, readBoundedText, type BodyFailure, type BodySource } from "./bounded-body";

/** Also used after content negotiation when a provider may return JSON or an XML error. */
export function validateJsonStructure(
  value: unknown,
  options: { maxDepth?: number; maxNodes?: number; signal?: AbortSignal; deadline?: number } = {},
): { ok: true; value: unknown } | BodyFailure {
  const { maxDepth = 48, maxNodes = 250_000, signal, deadline = Infinity } = options;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || !Number.isSafeInteger(maxNodes) || maxNodes <= 0) {
    return bodyFailure("INVALID_JSON_OPTIONS");
  }
  const interrupted = () => signal?.aborted ? bodyFailure("REQUEST_ABORTED")
    : performance.now() >= deadline ? bodyFailure("REQUEST_TIMEOUT") : null;
  if (typeof value === "number" && !Number.isFinite(value)) return bodyFailure("INVALID_JSON_NUMBER");
  const stack = [{ value, depth: 0 }];
  let nodes = 1;
  while (stack.length) {
    const stopped = interrupted();
    if (stopped) return stopped;
    const current = stack.pop()!;
    if (current.value === null || typeof current.value !== "object") continue;
    for (const key in current.value) {
      if (!Object.hasOwn(current.value, key)) continue;
      const stopped = interrupted();
      if (stopped) return stopped;
      if (++nodes > maxNodes) return bodyFailure("JSON_TOO_MANY_NODES");
      const depth = current.depth + 1;
      if (depth > maxDepth) return bodyFailure("JSON_TOO_DEEP");
      const child: unknown = (current.value as Record<string, unknown>)[key];
      if (typeof child === "number" && !Number.isFinite(child)) return bodyFailure("INVALID_JSON_NUMBER");
      if (child !== null && typeof child === "object") stack.push({ value: child, depth });
    }
  }
  return interrupted() ?? { ok: true, value };
}

/** Root depth is zero; every value, including the root and containers, is a node. */
export async function readBoundedJson(
  request: BodySource,
  options: { maxBytes: number; maxDepth?: number; maxNodes?: number; timeoutMs?: number },
): Promise<{ ok: true; value: unknown } | BodyFailure> {
  const { maxDepth = 48, maxNodes = 250_000, timeoutMs = 10_000 } = options ?? {};
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || !Number.isSafeInteger(maxNodes) || maxNodes <= 0) {
    return bodyFailure("INVALID_JSON_OPTIONS");
  }
  const deadline = performance.now() + timeoutMs;
  const interrupted = () => request.signal?.aborted ? bodyFailure("REQUEST_ABORTED")
    : performance.now() >= deadline ? bodyFailure("REQUEST_TIMEOUT") : null;
  const text = await readBoundedText(request, options);
  if (!text.ok) return text;
  if (!text.value.length) return bodyFailure("EMPTY_BODY");
  let value: unknown;
  try { value = JSON.parse(text.value); }
  catch { return interrupted() ?? bodyFailure("INVALID_JSON"); }
  const stopped = interrupted();
  if (stopped) return stopped;
  return validateJsonStructure(value, { maxDepth, maxNodes, deadline, signal: request.signal });
}
