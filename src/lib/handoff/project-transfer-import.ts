import { readBoundedJson } from "@/lib/http/bounded-json";
import {
  MAX_PROJECT_TRANSFER_BYTES,
  PROJECT_TRANSFER_READ_LIMITS,
  validateProjectTransferBundle,
  type ProjectTransferBundle,
} from "./project-transfer";

export async function readProjectTransferFile(
  file: Pick<File, "name" | "size" | "stream">,
  signal: AbortSignal,
  expectedProjectId: string,
): Promise<ProjectTransferBundle> {
  signal.throwIfAborted();
  if (!file || typeof file.name !== "string" || !/\.json$/i.test(file.name) || !Number.isSafeInteger(file.size) ||
      file.size <= 0 || file.size > MAX_PROJECT_TRANSFER_BYTES) {
    throw new Error("인계 패키지는 비어 있지 않은 20 MiB 이하 JSON 파일이어야 합니다.");
  }
  if (typeof expectedProjectId !== "string" || !expectedProjectId.trim()) {
    throw new Error("인계 패키지를 가져올 프로젝트 ID가 필요합니다.");
  }
  let body: ReadableStream<Uint8Array>;
  try { body = file.stream(); }
  catch { throw new Error("인계 파일의 내용을 읽을 수 없습니다."); }
  const result = await readBoundedJson({
    body,
    headers: new Headers({ "content-length": String(file.size) }),
    signal,
  }, PROJECT_TRANSFER_READ_LIMITS);
  signal.throwIfAborted();
  if (!result.ok) throw new Error(result.error);
  const validation = validateProjectTransferBundle(result.value, expectedProjectId);
  signal.throwIfAborted();
  if (!validation.valid || !validation.bundle) throw new Error(validation.errors.join(" "));
  return validation.bundle;
}
