import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORAGE_DIRECTORY = ".parcelgrid-data/concept-renders";

export function conceptRenderStorageDirectory(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.CONCEPT_RENDER_STORAGE_DIR?.trim();
  return path.resolve(process.cwd(), configured || DEFAULT_STORAGE_DIRECTORY);
}

export function resolveConceptRenderFilePath(
  pathname: string,
  storageDirectory = conceptRenderStorageDirectory(),
): string {
  if (!pathname || pathname.includes("\\") || pathname.includes("\0")) {
    throw new Error("유효하지 않은 콘셉트 렌더 저장 경로입니다.");
  }
  const segments = pathname.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith("."),
    )
  ) {
    throw new Error("유효하지 않은 콘셉트 렌더 저장 경로입니다.");
  }
  const root = path.resolve(storageDirectory);
  const resolved = path.resolve(root, ...segments);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("콘셉트 렌더 저장소 밖의 경로는 사용할 수 없습니다.");
  }
  return resolved;
}

export async function saveConceptRender(
  pathname: string,
  bytes: Uint8Array,
): Promise<void> {
  const filePath = resolveConceptRenderFilePath(pathname);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, bytes, { mode: 0o600 });
}

export async function loadConceptRender(
  pathname: string,
): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(resolveConceptRenderFilePath(pathname)),
  );
}
