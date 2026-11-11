import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FINANCIAL_SOURCE_FIELD_META } from "@/lib/finance/source-data-gate";
import {
  buildVersionedSourceDocumentPath,
  MAX_SOURCE_DOCUMENT_BYTES,
  isProjectSourceDocumentPath,
  sourceDocumentContentType,
  validateSourceDocumentBytes,
  validateSourceDocumentFile,
  type SourceDocumentMetadata,
} from "@/lib/finance/source-document";
import {
  loadSourceDocument,
  saveSourceDocument,
} from "@/lib/runtime/source-document-storage";
import { requireApiCapability } from "@/lib/auth/request";
import { appendAuditEvent } from "@/lib/audit/audit-ledger";
import { tenantScopedProjectId } from "@/lib/auth/roles";
import { readMultipartForm } from "@/lib/http/bounded-multipart";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

function isSourceDocumentField(value: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(FINANCIAL_SOURCE_FIELD_META, value) ||
    value === "tax-stabilized-sale" ||
    value === "tax-long-term-hold"
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(request, "evidence.upload");
  if (!authorization.ok) return authorization.response;
  const { projectId } = await context.params;
  const storageProjectId = tenantScopedProjectId(
    authorization.principal,
    projectId,
  );

  const parsedForm = await readMultipartForm(request, {
    fileField: "file", maxFileBytes: MAX_SOURCE_DOCUMENT_BYTES, fields: { field: 128 },
  });
  if (!parsedForm.ok) return parsedForm.response;
  const { form } = parsedForm;

  const field = String(form.get("field") ?? "");
  const file = form.get("file");
  if (!isSourceDocumentField(field)) {
    return NextResponse.json({ error: "유효한 계산 항목이 필요합니다." }, { status: 422 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "원문 파일이 필요합니다." }, { status: 422 });
  }

  const fileValidation = validateSourceDocumentFile(file);
  if (!fileValidation.valid || !fileValidation.extension || !fileValidation.contentType) {
    return NextResponse.json({ error: fileValidation.errors.join(" ") }, { status: 422 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const signatureErrors = validateSourceDocumentBytes(fileValidation.extension, bytes);
  if (signatureErrors.length > 0) {
    return NextResponse.json({ error: signatureErrors.join(" ") }, { status: 422 });
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    const pathname = buildVersionedSourceDocumentPath(
      storageProjectId,
      field,
      file.name,
      sha256,
    );
    await saveSourceDocument(pathname, bytes);
    const document: SourceDocumentMetadata = {
      pathname,
      fileName: file.name,
      contentType: fileValidation.contentType,
      size: file.size,
      sha256,
      uploadedAt: new Date().toISOString(),
    };
    await appendAuditEvent({
      principal: authorization.principal,
      action: "evidence.uploaded",
      resourceType: "project-evidence",
      resourceId: projectId,
      payload: { projectId, field, document },
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch {
    console.error("source document upload failed");
    return NextResponse.json(
      { error: "원문 저장 또는 감사 원장 기록을 완료하지 못했습니다." },
      { status: 503 },
    );
  }
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
  const requestedName = request.nextUrl.searchParams.get("fileName") ?? "source-document";
  if (!pathname || !isProjectSourceDocumentPath(storageProjectId, pathname)) {
    return NextResponse.json({ error: "이 프로젝트의 원문 경로가 아닙니다." }, { status: 400 });
  }

  try {
    const bytes = await loadSourceDocument(pathname);
    const safeName = requestedName.replace(/[\r\n]/g, "").slice(0, 180) || "source-document";
    return new NextResponse(Uint8Array.from(bytes).buffer, {
      headers: {
        "Content-Type": sourceDocumentContentType(safeName),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) console.error("source document storage read failed");
    return NextResponse.json(
      {
        code: missing ? "DOCUMENT_NOT_FOUND" : "STORAGE_UNAVAILABLE",
        error: missing
          ? "저장된 원문을 찾을 수 없습니다."
          : "원문 저장소를 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: missing ? 404 : 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
