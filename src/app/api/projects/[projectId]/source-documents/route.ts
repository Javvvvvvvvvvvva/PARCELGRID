import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FINANCIAL_SOURCE_FIELD_META, type FinancialSourceField } from "@/lib/finance/source-data-gate";
import {
  buildVersionedSourceDocumentPath,
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

export const runtime = "nodejs";

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
    { error: "원문 보관함 접근 키가 올바르지 않습니다." },
    { status: 401 },
  );
}

function isFinancialSourceField(value: string): value is FinancialSourceField {
  return Object.prototype.hasOwnProperty.call(FINANCIAL_SOURCE_FIELD_META, value);
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!hasWorkspaceAccess(request)) return unauthorized();
  const { projectId } = await context.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "업로드 양식을 읽을 수 없습니다." }, { status: 400 });
  }

  const field = String(form.get("field") ?? "");
  const file = form.get("file");
  if (!isFinancialSourceField(field)) {
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
      projectId,
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
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    console.error("source document upload failed", error);
    return NextResponse.json(
      { error: "로컬 비공개 원문 저장소에 파일을 쓰지 못했습니다." },
      { status: 503 },
    );
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  if (!hasWorkspaceAccess(request)) return unauthorized();
  const { projectId } = await context.params;
  const pathname = request.nextUrl.searchParams.get("pathname") ?? "";
  const requestedName = request.nextUrl.searchParams.get("fileName") ?? "source-document";
  if (!pathname || !isProjectSourceDocumentPath(projectId, pathname)) {
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
    console.error("source document download failed", error);
    return new NextResponse("Not found", { status: 404 });
  }
}
