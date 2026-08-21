export const CONCEPT_RENDER_MODEL_DEFAULT = "gpt-image-2";
export const MAX_CONCEPT_REFERENCE_BYTES = 10 * 1024 * 1024;
export const CONCEPT_RENDER_ACCEPT =
  "image/png,image/jpeg,image/webp";

export type ConceptRenderQuality = "low" | "medium" | "high";

export interface ConceptReferenceFileLike {
  name: string;
  type: string;
  size: number;
}

export interface ConceptRenderUsage {
  inputTokens: number;
  inputImageTokens: number;
  inputTextTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ConceptGeometryReviewStatus =
  | "pending"
  | "confirmed"
  | "rejected";

export interface ConceptRenderMetadata {
  pathname: string;
  fileName: string;
  contentType: "image/png";
  size: number;
  sha256: string;
  createdAt: string;
  model: string;
  quality: ConceptRenderQuality;
  geometryHash: string | null;
  sourceImageSha256: string;
  prompt: string;
  usage?: ConceptRenderUsage;
  geometryReview?: {
    status: ConceptGeometryReviewStatus;
    reviewedAt?: string;
  };
}

export interface ConceptRenderPromptInput {
  designPrompt: string;
  geometryHash?: string | null;
}

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const GEOMETRY_HASH_PATTERN = /^[a-zA-Z0-9._:-]{6,160}$/;

export function validateConceptGeometryHash(value: string): string[] {
  const hash = value.trim();
  if (!hash) {
    return ["검증된 대표안 Geometry Hash가 필요합니다."];
  }
  if (!GEOMETRY_HASH_PATTERN.test(hash)) {
    return ["Geometry Hash 형식이 올바르지 않습니다."];
  }
  return [];
}

export function validateConceptReferenceFile(
  file: ConceptReferenceFileLike,
): string[] {
  const errors: string[] = [];
  if (!file.name.trim()) errors.push("기준 이미지 파일명이 필요합니다.");
  if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
    errors.push("PNG·JPEG·WEBP 기준 이미지만 사용할 수 있습니다.");
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    errors.push("비어 있거나 크기를 확인할 수 없는 이미지입니다.");
  } else if (file.size > MAX_CONCEPT_REFERENCE_BYTES) {
    errors.push("기준 이미지는 10MB 이하여야 합니다.");
  }
  return errors;
}

export function validateConceptReferenceBytes(
  contentType: string,
  bytes: Uint8Array,
): string[] {
  if (bytes.byteLength === 0) return ["비어 있는 이미지입니다."];
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value)
      ? []
      : ["PNG 파일 시그니처를 확인할 수 없습니다."];
  }
  if (contentType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? []
      : ["JPEG 파일 시그니처를 확인할 수 없습니다."];
  }
  if (contentType === "image/webp") {
    const decoder = new TextDecoder();
    const riff = decoder.decode(bytes.slice(0, 4));
    const webp = decoder.decode(bytes.slice(8, 12));
    return riff === "RIFF" && webp === "WEBP"
      ? []
      : ["WEBP 파일 시그니처를 확인할 수 없습니다."];
  }
  return ["지원하지 않는 기준 이미지 형식입니다."];
}

export function buildLockedConceptRenderPrompt({
  designPrompt,
  geometryHash,
}: ConceptRenderPromptInput): string {
  const trimmed = designPrompt.trim().slice(0, 8_000);
  if (!trimmed) throw new Error("디자인 프롬프트가 필요합니다.");
  const geometryReference = geometryHash?.trim()
    ? `Geometry Hash: ${geometryHash.trim()}.`
    : "Geometry Hash is not available; treat the attached reference image as the only geometric source.";

  return [
    "PRESERVATION CONTRACT — the attached PARCELGRID reference image is the absolute geometric source.",
    "Edit finishes and architectural appearance only.",
    "Preserve exactly the floor count, overall silhouette, every floor outline, step-back direction and size, parcel placement, building rotation, parcel-to-road relationship, camera angle, focal length, perspective, and image crop.",
    "Do not add, remove, widen, narrow, raise, lower, rotate, or relocate any building volume.",
    "Do not add balconies, cantilevers, rooftop rooms, penthouses, exposed basements, exterior stairs, parking, vehicles, people, signage, or new buildings unless they already exist in the reference image.",
    "Keep adjacent buildings as simple light-gray context masses and keep the proposed mass clearly readable.",
    geometryReference,
    "DESIGN INTENT:",
    trimmed,
    "Produce one realistic, design-neutral Korean low-rise residential architectural concept render in soft overcast daylight.",
    "This is an AI concept visualization, not a design drawing, permit document, construction document, appraisal, or cost estimate.",
  ].join("\n");
}

export function normalizeConceptRenderSegment(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return normalized || "unknown";
}

export function conceptRenderProjectPrefix(projectId: string): string {
  return `projects/${encodeURIComponent(projectId.normalize("NFKC").trim()) || "unknown"}/concept-renders/`;
}

export function buildConceptRenderPath(
  projectId: string,
  sha256: string,
): string {
  const suffix = sha256.slice(0, 16).toLowerCase();
  return `${conceptRenderProjectPrefix(projectId)}concept-${suffix}.png`;
}

export function isProjectConceptRenderPath(
  projectId: string,
  pathname: string,
): boolean {
  return pathname.startsWith(conceptRenderProjectPrefix(projectId));
}

export function conceptRenderQuality(value: string): ConceptRenderQuality {
  return value === "low" || value === "high" ? value : "medium";
}
