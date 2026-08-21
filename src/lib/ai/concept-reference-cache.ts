export const CONCEPT_REFERENCE_CACHE_VERSION =
  "concept-reference-2026.1" as const;
export const MAX_CONCEPT_REFERENCE_DATA_URL_CHARS = 4_500_000;

export interface ConceptReferenceCapture {
  version: typeof CONCEPT_REFERENCE_CACHE_VERSION;
  projectId: string;
  geometryHash: string;
  capturedAt: string;
  dataUrl: string;
  source: "planning-3d-context";
}

export function conceptReferenceStorageKey(projectId: string): string {
  return `parcelgrid-concept-reference:${projectId.normalize("NFKC").trim()}`;
}

function supportedDataUrl(value: string): boolean {
  return /^data:image\/(?:jpeg|png|webp);base64,/i.test(value);
}

export function createConceptReferenceCapture(input: {
  projectId: string;
  geometryHash: string;
  dataUrl: string;
  capturedAt?: string;
}): ConceptReferenceCapture {
  const projectId = input.projectId.normalize("NFKC").trim();
  const geometryHash = input.geometryHash.trim();
  if (!projectId) throw new Error("프로젝트 ID가 필요합니다.");
  if (!geometryHash) throw new Error("검증된 Geometry Hash가 필요합니다.");
  if (!supportedDataUrl(input.dataUrl)) {
    throw new Error("PNG·JPEG·WEBP 캡처 데이터만 저장할 수 있습니다.");
  }
  if (input.dataUrl.length > MAX_CONCEPT_REFERENCE_DATA_URL_CHARS) {
    throw new Error("3D 기준 이미지가 브라우저 저장 한도를 초과합니다.");
  }
  return {
    version: CONCEPT_REFERENCE_CACHE_VERSION,
    projectId,
    geometryHash,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    dataUrl: input.dataUrl,
    source: "planning-3d-context",
  };
}

export function parseConceptReferenceCapture(
  value: string | null,
  expected: { projectId: string; geometryHash?: string | null }
): ConceptReferenceCapture | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ConceptReferenceCapture>;
    if (
      parsed.version !== CONCEPT_REFERENCE_CACHE_VERSION ||
      parsed.projectId !== expected.projectId ||
      !parsed.geometryHash ||
      !parsed.capturedAt ||
      parsed.source !== "planning-3d-context" ||
      !parsed.dataUrl ||
      !supportedDataUrl(parsed.dataUrl) ||
      parsed.dataUrl.length > MAX_CONCEPT_REFERENCE_DATA_URL_CHARS
    ) {
      return null;
    }
    if (
      expected.geometryHash &&
      parsed.geometryHash !== expected.geometryHash
    ) {
      return null;
    }
    return parsed as ConceptReferenceCapture;
  } catch {
    return null;
  }
}
