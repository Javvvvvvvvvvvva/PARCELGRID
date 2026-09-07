import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildConceptRenderPath,
  buildLockedConceptRenderPrompt,
  conceptRenderQuality,
  CONCEPT_RENDER_MODEL_DEFAULT,
  isProjectConceptRenderPath,
  type ConceptRenderMetadata,
  validateConceptReferenceBytes,
  validateConceptReferenceFile,
  validateConceptGeometryHash,
} from "@/lib/ai/concept-render";
import {
  loadConceptRender,
  saveConceptRender,
} from "@/lib/runtime/concept-render-storage";
import { reserveConceptRenderQuota } from "@/lib/runtime/concept-render-quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

function hasWorkspaceAccess(request: NextRequest): boolean {
  const expected = process.env.SOURCE_DOCUMENT_UPLOAD_KEY?.trim();
  const supplied = request.headers.get("x-parcelgrid-upload-key")?.trim();
  if (!expected && process.env.NODE_ENV !== "production") return true;
  if (!expected || expected.length < 16 || !supplied) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

function unauthorized() {
  return NextResponse.json(
    { error: "콘셉트 렌더 보관함 접근 키가 올바르지 않습니다." },
    { status: 401 },
  );
}

function imageModel(): string {
  const configured = process.env.OPENAI_IMAGE_MODEL?.trim();
  return configured && /^[a-zA-Z0-9._-]{3,80}$/.test(configured)
    ? configured
    : CONCEPT_RENDER_MODEL_DEFAULT;
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!hasWorkspaceAccess(request)) return unauthorized();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY가 설정되지 않았습니다. 로컬 .env.local에 키를 추가한 뒤 서버를 다시 시작하세요.",
        code: "OPENAI_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }
  const { projectId } = await context.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "이미지 생성 요청을 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  const referenceImage = form.get("referenceImage");
  if (!(referenceImage instanceof File)) {
    return NextResponse.json(
      {
        error:
          "형상 보존을 위해 PARCELGRID 기준 이미지가 반드시 필요합니다.",
      },
      { status: 422 },
    );
  }
  const fileErrors = validateConceptReferenceFile(referenceImage);
  if (fileErrors.length > 0) {
    return NextResponse.json(
      { error: fileErrors.join(" ") },
      { status: 422 },
    );
  }

  const sourceArrayBuffer = await referenceImage.arrayBuffer();
  const sourceBytes = new Uint8Array(sourceArrayBuffer);
  const signatureErrors = validateConceptReferenceBytes(
    referenceImage.type.toLowerCase(),
    sourceBytes,
  );
  if (signatureErrors.length > 0) {
    return NextResponse.json(
      { error: signatureErrors.join(" ") },
      { status: 422 },
    );
  }

  const designPrompt = String(form.get("prompt") ?? "");
  const geometryHash = String(form.get("geometryHash") ?? "").trim();
  const geometryErrors = validateConceptGeometryHash(geometryHash);
  if (geometryErrors.length > 0) {
    return NextResponse.json(
      { error: geometryErrors.join(" "), code: "GEOMETRY_HASH_REQUIRED" },
      { status: 422 },
    );
  }
  let lockedPrompt: string;
  try {
    lockedPrompt = buildLockedConceptRenderPrompt({
      designPrompt,
      geometryHash,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "디자인 프롬프트가 올바르지 않습니다.",
      },
      { status: 422 },
    );
  }

  const quality = conceptRenderQuality(String(form.get("quality") ?? ""));
  const model = imageModel();
  const upstream = new FormData();
  upstream.set("model", model);
  upstream.set("image", referenceImage, referenceImage.name);
  upstream.set("prompt", lockedPrompt);
  upstream.set("size", "1536x1024");
  upstream.set("quality", quality);
  upstream.set("output_format", "png");
  upstream.set("background", "opaque");

  const quota = reserveConceptRenderQuota({ projectId });
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: `이 프로젝트의 오늘 AI 렌더 한도 ${quota.limit}회를 모두 사용했습니다. ${new Date(quota.resetAt).toLocaleString("ko-KR")} 이후 다시 시도하세요.`,
        code: "CONCEPT_RENDER_DAILY_LIMIT",
        quota,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(
              1,
              Math.ceil(
                (new Date(quota.resetAt).getTime() - Date.now()) / 1_000,
              ),
            ),
          ),
        },
      },
    );
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    console.error("concept render API request failed", error);
    return NextResponse.json(
      { error: "AI 이미지 서비스에 연결하지 못했습니다." },
      { status: 503 },
    );
  }
  const openAiRequestId = response.headers.get("x-request-id")?.trim() || undefined;

  const payload = (await response.json().catch(() => null)) as
    | {
        data?: Array<{ b64_json?: string }>;
        usage?: {
          input_tokens?: number;
          input_tokens_details?: {
            image_tokens?: number;
            text_tokens?: number;
          };
          output_tokens?: number;
          total_tokens?: number;
        };
        error?: { message?: string; code?: string };
      }
    | null;
  if (!response.ok || !payload?.data?.[0]?.b64_json) {
    const moderationBlocked =
      payload?.error?.code === "moderation_blocked";
    return NextResponse.json(
      {
        error: moderationBlocked
          ? "이미지 안전 정책에 따라 요청이 차단됐습니다. 프롬프트를 확인하세요."
          : payload?.error?.message || "AI 이미지 생성에 실패했습니다.",
        code: payload?.error?.code ?? "OPENAI_IMAGE_ERROR",
        requestId: openAiRequestId,
      },
      { status: response.status >= 400 ? response.status : 502 },
    );
  }

  const generatedBytes = new Uint8Array(
    Buffer.from(payload.data[0].b64_json, "base64"),
  );
  if (generatedBytes.byteLength === 0) {
    return NextResponse.json(
      { error: "생성된 이미지 데이터가 비어 있습니다." },
      { status: 502 },
    );
  }

  const sha256 = createHash("sha256")
    .update(generatedBytes)
    .digest("hex");
  const sourceImageSha256 = createHash("sha256")
    .update(sourceBytes)
    .digest("hex");
  const pathname = buildConceptRenderPath(projectId, sha256);

  try {
    await saveConceptRender(pathname, generatedBytes);
  } catch (error) {
    console.error("concept render storage failed", error);
    return NextResponse.json(
      { error: "생성 이미지를 로컬 비공개 저장소에 쓰지 못했습니다." },
      { status: 503 },
    );
  }

  const metadata: ConceptRenderMetadata = {
    pathname,
    fileName: `parcelgrid-concept-${sha256.slice(0, 12)}.png`,
    contentType: "image/png",
    size: generatedBytes.byteLength,
    sha256,
    createdAt: new Date().toISOString(),
    model,
    quality,
    openAiRequestId,
    geometryHash,
    sourceImageSha256,
    prompt: lockedPrompt,
    usage: payload.usage
      ? {
          inputTokens: payload.usage.input_tokens ?? 0,
          inputImageTokens:
            payload.usage.input_tokens_details?.image_tokens ?? 0,
          inputTextTokens:
            payload.usage.input_tokens_details?.text_tokens ?? 0,
          outputTokens: payload.usage.output_tokens ?? 0,
          totalTokens: payload.usage.total_tokens ?? 0,
        }
      : undefined,
    geometryReview: { status: "pending" },
  };

  return NextResponse.json({ render: metadata, quota }, { status: 201 });
}

export async function GET(request: NextRequest, context: RouteContext) {
  if (!hasWorkspaceAccess(request)) return unauthorized();
  const { projectId } = await context.params;
  const pathname = request.nextUrl.searchParams.get("pathname") ?? "";
  if (!pathname || !isProjectConceptRenderPath(projectId, pathname)) {
    return NextResponse.json(
      { error: "이 프로젝트의 콘셉트 렌더 경로가 아닙니다." },
      { status: 400 },
    );
  }

  try {
    const bytes = await loadConceptRender(pathname);
    return new NextResponse(Uint8Array.from(bytes).buffer, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("concept render load failed", error);
    return NextResponse.json(
      { error: "저장된 콘셉트 렌더를 찾을 수 없습니다." },
      { status: 404 },
    );
  }
}
