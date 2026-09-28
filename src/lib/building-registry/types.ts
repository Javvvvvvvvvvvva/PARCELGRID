import { z } from "zod";

export const BUILDING_REGISTRY_SOURCE = "https://www.data.go.kr/data/15134735/openapi.do";
export const BUILDING_REGISTRY_VERSION = "building-registry-2026.1";
export const REGISTRY_PAGE_SIZE = 100;
export const REGISTRY_MAX_PAGES = 10;
export const REGISTRY_MAX_DATASET_BYTES = 350_000;

export const registryQuerySchema = z.object({
  sigunguCd: z.string().regex(/^\d{5}$/),
  bjdongCd: z.string().regex(/^\d{5}$/),
  platGbCd: z.enum(["0", "1"]),
  bun: z.string().regex(/^\d{4}$/),
  ji: z.string().regex(/^\d{4}$/),
});
export type RegistryQuery = z.infer<typeof registryQuerySchema>;

export const registryOperationSchema = z.enum([
  "getBrTitleInfo", "getBrFlrOulnInfo", "getBrExposPubuseAreaInfo",
]);
export type RegistryOperation = z.infer<typeof registryOperationSchema>;

// Preserve provider identifiers verbatim. An endpoint's PK is not a universal
// building UUID; in particular, a unit registry PK need not be its title PK.
export const registryRecordSchema = z.object({
  registryPk: z.string().max(200).nullable(),
  rowNumber: z.string().max(40).nullable(),
  generatedDate: z.string().max(40).nullable(),
  fields: z.record(z.string().max(500)).refine((value) => Object.keys(value).length <= 80),
});
export type RegistryRecord = z.infer<typeof registryRecordSchema>;

export const registryDatasetSchema = z.object({
  operation: registryOperationSchema,
  status: z.enum(["complete", "partial", "unavailable", "not-requested"]),
  retrievedAt: z.string().datetime(),
  // No key-bearing URL or provider error text is ever persisted.
  requestUrl: z.string().max(1000).url().refine((value) => {
    try {
      const url = new URL(value);
      return url.origin === "https://apis.data.go.kr" && !url.searchParams.has("serviceKey");
    } catch { return false; }
  }),
  totalCount: z.number().int().nonnegative().nullable(),
  fetchedCount: z.number().int().nonnegative(),
  pagesFetched: z.number().int().nonnegative().max(REGISTRY_MAX_PAGES),
  rows: z.array(registryRecordSchema).max(REGISTRY_MAX_PAGES * REGISTRY_PAGE_SIZE),
  issues: z.array(z.string().max(80)).max(30),
}).superRefine((data, ctx) => {
  if (data.status === "complete" && (data.totalCount == null || data.pagesFetched < 1 ||
      data.fetchedCount !== data.totalCount || data.rows.length !== data.totalCount || data.issues.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "완료된 조회의 건수·페이지·행 근거가 일치하지 않습니다." });
  }
});
export type RegistryDataset = z.infer<typeof registryDatasetSchema>;

export const buildingRegistryEvidenceSchema = z.object({
  version: z.literal(BUILDING_REGISTRY_VERSION),
  sourceUrl: z.literal(BUILDING_REGISTRY_SOURCE),
  query: registryQuerySchema,
  title: registryDatasetSchema,
  floors: registryDatasetSchema,
  exclusiveCommon: registryDatasetSchema,
}).superRefine((data, ctx) => {
  if (data.title.operation !== "getBrTitleInfo" || data.floors.operation !== "getBrFlrOulnInfo" || data.exclusiveCommon.operation !== "getBrExposPubuseAreaInfo") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "건축물대장 API 종류가 일치하지 않습니다." });
  }
});
export type BuildingRegistryEvidence = z.infer<typeof buildingRegistryEvidenceSchema>;

export const REGISTRY_ISSUE_LABELS: Record<string, string> = {
  "not-configured": "API 키 미설정",
  "access-denied": "키·활용 승인·접근 권한 확인 필요",
  "rate-limit": "공공 API 호출 한도 초과",
  timeout: "조회 시간 제한 도달",
  network: "공공 API 연결 실패",
  "http-error": "공공 API HTTP 오류",
  "provider-error": "공공 API 처리 오류",
  "invalid-response": "응답 형식 또는 필수 페이지 정보 오류",
  "invalid-row": "주소 범위 또는 행 형식 불일치",
  "missing-id": "일부 원본 PK 누락",
  "repeated-page": "같은 페이지 내용 반복",
  "count-changed": "조회 중 전체 건수 변경",
  "count-mismatch": "수신 건수와 전체 건수 불일치",
  "page-limit": "최대 10페이지 도달 · 일부 자료만 확보",
  "size-limit": "저장 용량 한도 도달 · 일부 속성 행만 보존",
  "duplicate-title-id": "표제부 PK 중복 · 중복 동은 합계에서 제외",
  "duplicate-row": "원본 PK·순번 중복 · 중복 행은 합계에서 제외",
  "missing-row-number": "원본 순번 누락 · 중복 여부 확인 필요",
};

export function registryNumber(value: string | undefined): number | null {
  if (!value?.trim() || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number <= 1e12 ? number : null;
}
