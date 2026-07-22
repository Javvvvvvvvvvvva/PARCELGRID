export const MAX_SOURCE_DOCUMENT_BYTES = 4 * 1024 * 1024;

export const SOURCE_DOCUMENT_ACCEPT = ".pdf,.xlsx,.xls,.csv";

export type SourceDocumentExtension = "pdf" | "xlsx" | "xls" | "csv";

export interface SourceDocumentMetadata {
  pathname: string;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  uploadedAt: string;
}

export interface SourceDocumentFileLike {
  name: string;
  type: string;
  size: number;
}

export interface SourceDocumentValidationResult {
  valid: boolean;
  errors: string[];
  extension: SourceDocumentExtension | null;
  contentType: string | null;
}

const CONTENT_TYPES: Record<SourceDocumentExtension, string[]> = {
  pdf: ["application/pdf"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  csv: [
    "text/csv",
    "application/csv",
    "text/plain",
    "application/vnd.ms-excel",
    "application/octet-stream",
  ],
};

const CANONICAL_CONTENT_TYPE: Record<SourceDocumentExtension, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};

export function sourceDocumentExtension(
  fileName: string,
): SourceDocumentExtension | null {
  const extension = fileName.trim().toLowerCase().split(".").pop();
  return extension === "pdf" ||
    extension === "xlsx" ||
    extension === "xls" ||
    extension === "csv"
    ? extension
    : null;
}

export function validateSourceDocumentFile(
  file: SourceDocumentFileLike,
): SourceDocumentValidationResult {
  const errors: string[] = [];
  const extension = sourceDocumentExtension(file.name);
  if (!file.name.trim()) errors.push("파일명이 필요합니다.");
  if (!extension) errors.push("PDF·XLSX·XLS·CSV 파일만 업로드할 수 있습니다.");
  if (!Number.isFinite(file.size) || file.size <= 0) {
    errors.push("비어 있거나 크기를 확인할 수 없는 파일입니다.");
  } else if (file.size > MAX_SOURCE_DOCUMENT_BYTES) {
    errors.push("원문 파일은 4MB 이하여야 합니다.");
  }
  const suppliedType = file.type.trim().toLowerCase();
  if (
    extension &&
    suppliedType &&
    !CONTENT_TYPES[extension].includes(suppliedType)
  ) {
    errors.push("파일 확장자와 MIME 유형이 일치하지 않습니다.");
  }
  return {
    valid: errors.length === 0,
    errors,
    extension,
    contentType: extension ? CANONICAL_CONTENT_TYPE[extension] : null,
  };
}

export function validateSourceDocumentBytes(
  extension: SourceDocumentExtension,
  bytes: Uint8Array,
): string[] {
  if (bytes.byteLength === 0) return ["비어 있는 파일입니다."];
  if (extension === "pdf") {
    const magic = new TextDecoder().decode(bytes.slice(0, 5));
    return magic === "%PDF-" ? [] : ["PDF 파일 시그니처를 확인할 수 없습니다."];
  }
  if (extension === "xlsx") {
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    return zip ? [] : ["XLSX 파일 시그니처를 확인할 수 없습니다."];
  }
  if (extension === "xls") {
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return ole.every((value, index) => bytes[index] === value)
      ? []
      : ["XLS 파일 시그니처를 확인할 수 없습니다."];
  }
  if (bytes.slice(0, Math.min(bytes.length, 4096)).includes(0)) {
    return ["CSV로 처리할 수 없는 바이너리 파일입니다."];
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.slice(0, Math.min(bytes.length, 4096)),
    );
    return [];
  } catch {
    return ["CSV 파일은 UTF-8 텍스트여야 합니다."];
  }
}

export function normalizeSourceDocumentSegment(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return normalized || "unknown";
}

export function sourceDocumentProjectPrefix(projectId: string): string {
  const projectKey = encodeURIComponent(projectId.normalize("NFKC").trim());
  return `projects/${projectKey || "unknown"}/source-documents/`;
}

export function buildSourceDocumentPath(
  projectId: string,
  field: string,
  fileName: string,
): string {
  return `${sourceDocumentProjectPrefix(projectId)}${normalizeSourceDocumentSegment(field)}/${normalizeSourceDocumentSegment(fileName)}`;
}

export function isProjectSourceDocumentPath(
  projectId: string,
  pathname: string,
): boolean {
  return pathname.startsWith(sourceDocumentProjectPrefix(projectId));
}

export function validateSourceDocumentMetadata(
  document: SourceDocumentMetadata,
): string[] {
  const errors: string[] = [];
  if (!document.pathname.trim()) errors.push("원문 저장 경로가 없습니다.");
  if (!document.fileName.trim()) errors.push("원문 파일명이 없습니다.");
  if (!sourceDocumentExtension(document.fileName)) {
    errors.push("지원하지 않는 원문 파일 형식입니다.");
  }
  if (!Number.isFinite(document.size) || document.size <= 0 || document.size > MAX_SOURCE_DOCUMENT_BYTES) {
    errors.push("원문 파일 크기가 허용 범위를 벗어났습니다.");
  }
  if (!/^[a-f0-9]{64}$/i.test(document.sha256)) {
    errors.push("원문 SHA-256 해시가 올바르지 않습니다.");
  }
  if (!document.uploadedAt || Number.isNaN(Date.parse(document.uploadedAt))) {
    errors.push("원문 업로드 시각이 올바르지 않습니다.");
  }
  return errors;
}
