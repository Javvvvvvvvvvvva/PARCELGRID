import { discardProviderBody, ProviderBodyError, readProviderJson } from "@/lib/http/provider-body";
import { z } from "zod";
import { createProviderConcurrencyLimit } from "@/lib/http/provider-concurrency";
import { createProviderDeadline } from "@/lib/http/provider-deadline";

export const VWORLD_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const VWORLD_MAX_ACTIVE_REQUESTS = 4;
export const VWORLD_MAX_QUEUED_REQUESTS = 16;
const withCapacity = createProviderConcurrencyLimit(VWORLD_MAX_ACTIVE_REQUESTS, VWORLD_MAX_QUEUED_REQUESTS);
const coordinate = z.number().finite().min(-180).max(180);
const positionSchema = z.union([z.tuple([coordinate, coordinate]), z.tuple([coordinate, coordinate, z.number().finite()])]);
function featureCollectionSchema(allowSwappedAxes: boolean, geometryKind: "polygon" | "line" = "polygon") {
  const position = positionSchema.refine(p => Math.abs(p[1]) <= 90 || (allowSwappedAxes && Math.abs(p[0]) <= 90));
  const line = z.array(position).min(2).max(10_000).refine(points =>
    points.some(p => p[0] !== points[0][0] || p[1] !== points[0][1]));
  const ring = z.array(position).min(4).max(10_000).refine(points => {
    const first = points[0], last = points.at(-1);
    return first != null && last != null && first[0] === last[0] && first[1] === last[1];
  });
  const polygon = z.array(ring).min(1).max(100);
  const geometry = z.discriminatedUnion("type", [
    z.object({ type: z.literal("Polygon"), coordinates: polygon }),
    z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygon).min(1).max(200) }),
    z.object({ type: z.literal("LineString"), coordinates: line }),
    z.object({ type: z.literal("MultiLineString"), coordinates: z.array(line).min(1).max(200) }),
  ]).superRefine((value, ctx) => {
    const points = value.type === "Polygon" || value.type === "MultiLineString"
      ? value.coordinates.reduce((sum, ring) => sum + ring.length, 0)
      : value.type === "MultiPolygon" ? value.coordinates.reduce((sum, polygon) => sum + polygon.reduce((n, ring) => n + ring.length, 0), 0)
      : value.coordinates.length;
    if (points > 10_000) ctx.addIssue({ code: "custom", message: "Geometry vertex limit exceeded" });
    const supported = geometryKind === "polygon" ? ["Polygon", "MultiPolygon"] : ["LineString", "MultiLineString"];
    if (!supported.includes(value.type)) ctx.addIssue({ code: "custom", message: "Unsupported dataset geometry" });
  });
  return z.object({ features: z.array(z.object({
    geometry,
    properties: z.record(z.string(), z.unknown()).nullable().optional(),
  })).max(200) });
}
const dataCollectionSchema = featureCollectionSchema(false);
const lineCollectionSchema = featureCollectionSchema(false, "line");
const buildingCollectionSchema = featureCollectionSchema(true);
const dataEnvelopeSchema = (collection: typeof dataCollectionSchema) => z.object({ response: z.object({
  status: z.enum(["OK", "NOT_FOUND", "ERROR"]),
  result: z.object({ featureCollection: collection }).optional(),
}) });
const dataSchema = dataEnvelopeSchema(dataCollectionSchema);
const lineDataSchema = dataEnvelopeSchema(lineCollectionSchema);

/** A single deadline includes both response headers and body, not one budget for each. */
export async function fetchVworldJson(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number; requireJsonContentType?: boolean; envelope?: "data" | "wfs"; geometryKind?: "polygon" | "line"; signal?: AbortSignal; outerDeadline?: number } = {},
): Promise<unknown> {
  const { deadline, signal } = createProviderDeadline(options.timeoutMs ?? 12_000, options.signal, options.outerDeadline);
  return withCapacity(signal, () => readVworldResponse(url, options, deadline, signal));
}

async function readVworldResponse(
  url: string,
  options: { maxBytes?: number; requireJsonContentType?: boolean; envelope?: "data" | "wfs"; geometryKind?: "polygon" | "line" },
  deadline: number,
  signal: AbortSignal,
): Promise<unknown> {
  const checkDeadline = (response?: Response) => {
    if (signal.aborted || performance.now() >= deadline) {
      if (response) discardProviderBody(response);
      throw new ProviderBodyError("REQUEST_TIMEOUT");
    }
  };
  checkDeadline();
  let response: Response;
  try { response = await fetch(url, { signal }); }
  catch (error) {
    if (signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) {
      throw new DOMException("V-World request timed out or was interrupted.", "TimeoutError");
    }
    throw new Error("V-World network request failed");
  }
  checkDeadline(response);
  if (!response.ok) {
    discardProviderBody(response);
    throw new Error(`V-World HTTP ${response.status}`);
  }
  if (options.requireJsonContentType && !response.headers.get("content-type")?.toLowerCase().includes("json")) {
    discardProviderBody(response);
    throw new Error("V-World returned a non-JSON response");
  }
  const value = await readProviderJson(response, { maxBytes: options.maxBytes ?? VWORLD_MAX_RESPONSE_BYTES, timeoutMs: Math.max(1, Math.ceil(deadline - performance.now())), signal });
  // Do not turn a provider error or missing success collection into a successful empty lookup.
  if (options.envelope === "data") {
    const result = (options.geometryKind === "line" ? lineDataSchema : dataSchema).safeParse(value);
    if (!result.success || result.data.response.status === "ERROR"
      || (result.data.response.status === "OK" && !result.data.response.result)) {
      throw new Error("V-World feature response invalid or unavailable");
    }
  } else if (options.envelope === "wfs" && !buildingCollectionSchema.safeParse(value).success) {
    throw new Error("V-World feature response invalid or unavailable");
  }
  checkDeadline();
  return value;
}
