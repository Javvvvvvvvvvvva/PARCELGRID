import { NextResponse } from "next/server";
import { readBoundedJson } from "./bounded-json";

export const JSON_REQUEST_LIMITS = {
  login: 16_384,
  lookup: 16_384,
  calculation: 262_144,
  compGeocode: 262_144,
  override: 1_500_000,
  dynamicProject: 5_000_000,
  reviewEvent: 32_768,
} as const;

/** Call after authorization; credentials use their own smaller unauthenticated limit. */
export async function readJsonObject(request: Request, options: Parameters<typeof readBoundedJson>[1] & { tooLargeCode?: string }) {
  const result = await readBoundedJson(request, options);
  if (!result.ok) return { ok: false as const, response: NextResponse.json({
    code: result.status === 413 && options.tooLargeCode ? options.tooLargeCode : result.code,
    error: result.error,
  }, { status: result.status, headers: { "Cache-Control": "no-store" } }) };
  if (!result.value || typeof result.value !== "object" || Array.isArray(result.value)) {
    return { ok: false as const, response: NextResponse.json({ code: "INVALID_JSON_OBJECT", error: "JSON 객체 형식의 요청이 필요합니다." },
      { status: 400, headers: { "Cache-Control": "no-store" } }) };
  }
  return { ok: true as const, value: result.value as Record<string, unknown> };
}
