import { readBoundedJson } from "@/lib/http/bounded-json";
import { operatingBudgetDraftSchema, type OperatingBudgetDraft } from "./operating-budget-contract";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export async function readOperatingBudgetFile(
  file: Pick<File, "name" | "size" | "stream">,
  signal: AbortSignal,
): Promise<OperatingBudgetDraft> {
  signal.throwIfAborted();
  if (!/\.json$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_IMPORT_BYTES) {
    throw new Error("운영비 초안은 비어 있지 않은 8 MiB 이하 JSON 파일이어야 합니다.");
  }
  const result = await readBoundedJson({ body: file.stream(), headers: new Headers({ "content-length": String(file.size) }), signal },
    { maxBytes: MAX_IMPORT_BYTES, maxDepth: 6, maxNodes: 8_000, timeoutMs: 5_000 });
  signal.throwIfAborted();
  if (!result.ok) throw new Error(result.error);
  const parsed = operatingBudgetDraftSchema.safeParse(result.value);
  if (!parsed.success) throw new Error(`운영비 초안 형식을 확인하세요. ${parsed.error.issues[0]?.message ?? ""}`);
  return parsed.data;
}
