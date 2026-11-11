import { readBoundedText, type BodyFailureCode, type BodyLimits } from "./bounded-body";
import { readBoundedJson } from "./bounded-json";

export class ProviderBodyError extends Error {
  constructor(readonly code: BodyFailureCode) {
    super("External response failed bounded validation.");
    this.name = code === "REQUEST_TIMEOUT" || code === "REQUEST_ABORTED" ? "TimeoutError" : "ProviderBodyError";
  }
}
export function discardProviderBody(response: Response): void {
  try { void response.body?.cancel().catch(() => {}); } catch { /* Best effort. */ }
}
type ProviderLimits = BodyLimits & { signal?: AbortSignal };
export async function readProviderText(response: Response, options: ProviderLimits): Promise<string> {
  const result = await readBoundedText({ body: response.body, headers: response.headers, signal: options.signal }, options);
  if (!result.ok) throw new ProviderBodyError(result.code);
  return result.value;
}
export async function readProviderJson(response: Response, options: ProviderLimits): Promise<unknown> {
  const result = await readBoundedJson({ body: response.body, headers: response.headers, signal: options.signal }, options);
  if (!result.ok) throw new ProviderBodyError(result.code);
  return result.value;
}
