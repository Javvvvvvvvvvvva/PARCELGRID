import { readBoundedJson } from "@/lib/http/bounded-json";
import { constructionQuoteSchema, type ConstructionQuote } from "./construction-quote";

// Includes pretty JSON with all schema-bounded strings escaped at six bytes per code unit.
export const CONSTRUCTION_QUOTE_FILE_BYTES = 8 * 1024 * 1024;
export const CONSTRUCTION_QUOTE_FILE_TIMEOUT_MS = 5_000;
type QuoteFile = Pick<File, "name" | "size" | "stream">;

/** Local evidence only: importing never changes its source basis or grants approval. */
export async function readConstructionQuoteFile(file: QuoteFile, signal: AbortSignal): Promise<ConstructionQuote> {
  signal.throwIfAborted();
  if (!/\.json$/i.test(file.name)) throw new Error("견적 초안 JSON 파일이 필요합니다.");
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > CONSTRUCTION_QUOTE_FILE_BYTES) {
    throw new Error("견적 파일은 비어 있지 않은 8 MiB 이하 파일이어야 합니다.");
  }
  const result = await readBoundedJson({ body: file.stream(), headers: new Headers({ "content-length": String(file.size) }), signal },
    { maxBytes: CONSTRUCTION_QUOTE_FILE_BYTES, maxDepth: 8, maxNodes: 12_000, timeoutMs: CONSTRUCTION_QUOTE_FILE_TIMEOUT_MS });
  signal.throwIfAborted();
  if (!result.ok) throw new Error(result.error);
  const parsed = constructionQuoteSchema.safeParse(result.value);
  if (!parsed.success) throw new Error("견적 버전·내역·공종·수치 형식을 확인해 주세요. 승인 정보나 프로젝트 전체 파일은 불러올 수 없습니다.");
  signal.throwIfAborted();
  return parsed.data;
}
