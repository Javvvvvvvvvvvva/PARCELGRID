import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORAGE_DIRECTORY = ".parcelgrid-data/source-documents";

export interface StoredSourceDocument {
  pathname: string;
  bytes: Uint8Array;
}

export function sourceDocumentStorageDirectory(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.SOURCE_DOCUMENT_STORAGE_DIR?.trim();
  return path.resolve(process.cwd(), configured || DEFAULT_STORAGE_DIRECTORY);
}

export function resolveSourceDocumentFilePath(
  pathname: string,
  storageDirectory = sourceDocumentStorageDirectory(),
): string {
  if (!pathname || pathname.includes("\\") || pathname.includes("\0")) {
    throw new Error("유효하지 않은 원문 저장 경로입니다.");
  }

  const segments = pathname.split("/");
  if (
    segments.some(
      (segment) =>
        !segment || segment === "." || segment === ".." || segment.startsWith("."),
    )
  ) {
    throw new Error("유효하지 않은 원문 저장 경로입니다.");
  }

  const root = path.resolve(storageDirectory);
  const resolved = path.resolve(root, ...segments);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("원문 저장소 밖의 경로는 사용할 수 없습니다.");
  }
  return resolved;
}

export async function saveSourceDocument(
  pathname: string,
  bytes: Uint8Array,
): Promise<StoredSourceDocument> {
  const filePath = resolveSourceDocumentFilePath(pathname);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, bytes, { mode: 0o600 });
  return { pathname, bytes };
}

export async function loadSourceDocument(pathname: string): Promise<Uint8Array> {
  const filePath = resolveSourceDocumentFilePath(pathname);
  return new Uint8Array(await readFile(filePath));
}

export function sourceDocumentStorageLabel(): string {
  return "로컬 비공개 파일 저장소";
}
