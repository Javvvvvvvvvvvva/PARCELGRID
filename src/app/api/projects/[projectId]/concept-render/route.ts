import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildConceptRenderPath,
  buildLockedConceptRenderPrompt,
  conceptRenderQuality,
  CONCEPT_RENDER_MODEL_DEFAULT,
  MAX_CONCEPT_REFERENCE_BYTES,
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
import { requireApiCapability } from "@/lib/auth/request";
import { tenantScopedProjectId } from "@/lib/auth/roles";
import { appendAuditEvent } from "@/lib/audit/audit-ledger";
import { readMultipartForm } from "@/lib/http/bounded-multipart";
import { readConceptRenderResponse } from "@/lib/ai/concept-render-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

function imageModel(): string {
  const configured = process.env.OPENAI_IMAGE_MODEL?.trim();
  return configured && /^[a-zA-Z0-9._-]{3,80}$/.test(configured)
    ? configured
    : CONCEPT_RENDER_MODEL_DEFAULT;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(
    request,
    "concept-render.create",
  );
  if (!authorization.ok) return authorization.response;
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
  const storageProjectId = tenantScopedProjectId(
    authorization.principal,
    projectId,
  );

  const parsedForm = await readMultipartForm(request, {
    fileField: "referenceImage", maxFileBytes: MAX_CONCEPT_REFERENCE_BYTES,
    fields: { prompt: 32_000, geometryHash: 640, quality: 16 },
  });
  if (!parsedForm.ok) return parsedForm.response;
  const { form } = parsedForm;

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

  // All inputs are bounded above. Finish encoding before fetch: Node 24's
  // outgoing FormData stream can enqueue after an early upstream cancellation.
  const encodedUpload = new Response(upstream);
  const upstreamBytes = await encodedUpload.arrayBuffer();

  const quota = reserveConceptRenderQuota({ projectId: storageProjectId });
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
  const upstreamSignal = AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]);
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": encodedUpload.headers.get("content-type")! },
      body: upstreamBytes,
      signal: upstreamSignal,
    });
  } catch {
    console.error("concept render API request failed");
    return NextResponse.json(
      { error: "AI 이미지 서비스에 연결하지 못했습니다." },
      { status: 503 },
    );
  }
  const requestId = response.headers.get("x-request-id")?.trim() ?? "";
  const openAiRequestId = /^req_[a-zA-Z0-9_-]{1,120}$/.test(requestId) ? requestId : undefined;

  const payload = await readConceptRenderResponse(response, upstreamSignal);
  if (!payload.ok) {
    return NextResponse.json(
      {
        error: payload.error,
        code: payload.code,
        requestId: openAiRequestId,
      },
      { status: payload.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const generatedBytes = payload.bytes;

  const sha256 = createHash("sha256")
    .update(generatedBytes)
    .digest("hex");
  const sourceImageSha256 = createHash("sha256")
    .update(sourceBytes)
    .digest("hex");
  const pathname = buildConceptRenderPath(storageProjectId, sha256);

  try {
    await saveConceptRender(pathname, generatedBytes);
  } catch {
    console.error("concept render storage failed");
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

  try {
    await appendAuditEvent({
      principal: authorization.principal,
      action: "concept-render.created",
      resourceType: "project-concept-render",
      resourceId: projectId,
      payload: {
        projectId,
        pathname: metadata.pathname,
        sha256: metadata.sha256,
        sourceImageSha256: metadata.sourceImageSha256,
        geometryHash: metadata.geometryHash,
        model: metadata.model,
        quality: metadata.quality,
        openAiRequestId: metadata.openAiRequestId,
        usage: metadata.usage,
      },
    });
  } catch {
    console.error("concept render audit append failed");
    return NextResponse.json(
      {
        code: "AUDIT_WRITE_FAILED",
        error: "이미지는 생성됐지만 감사 원장 기록에 실패해 결과를 확정하지 않았습니다.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ render: metadata, quota }, { status: 201 });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(request, "project.read");
  if (!authorization.ok) return authorization.response;
  const { projectId } = await context.params;
  const storageProjectId = tenantScopedProjectId(
    authorization.principal,
    projectId,
  );
  const pathname = request.nextUrl.searchParams.get("pathname") ?? "";
  if (!pathname || !isProjectConceptRenderPath(storageProjectId, pathname)) {
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
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) console.error("concept render storage read failed");
    return NextResponse.json(
      {
        code: missing ? "RENDER_NOT_FOUND" : "STORAGE_UNAVAILABLE",
        error: missing
          ? "저장된 콘셉트 렌더를 찾을 수 없습니다."
          : "렌더 저장소를 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: missing ? 404 : 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
