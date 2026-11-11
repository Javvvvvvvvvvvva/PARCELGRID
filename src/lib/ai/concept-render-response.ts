import { z } from "zod";
import { readProviderJson } from "@/lib/http/provider-body";
import { validateConceptReferenceBytes } from "./concept-render";

export const MAX_GENERATED_IMAGE_BYTES = 16 * 1024 * 1024;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();
const responseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().max(Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4) })).max(1).optional(),
  usage: z.object({ input_tokens: count, output_tokens: count, total_tokens: count,
    input_tokens_details: z.object({ image_tokens: count, text_tokens: count }).optional(),
  }).optional(),
  error: z.object({ code: z.string().max(80).nullable().optional() }).optional(),
});

export async function readConceptRenderResponse(response: Response, signal: AbortSignal) {
  const fail = (moderation = false) => ({ ok: false as const, status: moderation ? 422 : response.status === 429 ? 429 : 502,
    code: moderation ? "moderation_blocked" : "OPENAI_IMAGE_ERROR",
    error: moderation ? "이미지 안전 정책에 따라 요청이 차단됐습니다. 프롬프트를 확인하세요." : "AI 이미지 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  });
  try {
    const raw = await readProviderJson(response, { maxBytes: 24 * 1024 * 1024, timeoutMs: 30_000, signal });
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) return fail();
    const payload = parsed.data;
    if (!response.ok) return fail(payload.error?.code === "moderation_blocked");
    const encoded = payload.data?.[0]?.b64_json;
    if (!encoded) return fail();
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > MAX_GENERATED_IMAGE_BYTES || bytes.toString("base64") !== encoded ||
      validateConceptReferenceBytes("image/png", bytes).length) return fail();
    return { ok: true as const, bytes, usage: payload.usage };
  } catch { return fail(); }
}
