import { describe, expect, it } from "vitest";
import {
  buildConceptRenderPath,
  buildLockedConceptRenderPrompt,
  conceptRenderProjectPrefix,
  isProjectConceptRenderPath,
  validateConceptReferenceBytes,
  validateConceptReferenceFile,
} from "@/lib/ai/concept-render";
import { resolveConceptRenderFilePath } from "@/lib/runtime/concept-render-storage";

describe("geometry-locked concept render contract", () => {
  it("requires a supported non-empty reference image", () => {
    expect(
      validateConceptReferenceFile({
        name: "parcelgrid.png",
        type: "image/png",
        size: 1024,
      }),
    ).toEqual([]);
    expect(
      validateConceptReferenceFile({
        name: "parcelgrid.svg",
        type: "image/svg+xml",
        size: 1024,
      }),
    ).toContain("PNG·JPEG·WEBP 기준 이미지만 사용할 수 있습니다.");
  });

  it("checks image magic bytes instead of trusting only MIME metadata", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(validateConceptReferenceBytes("image/png", png)).toEqual([]);
    expect(
      validateConceptReferenceBytes("image/png", new Uint8Array([1, 2, 3])),
    ).toContain("PNG 파일 시그니처를 확인할 수 없습니다.");
  });

  it("always prepends the non-negotiable geometry preservation contract", () => {
    const prompt = buildLockedConceptRenderPrompt({
      designPrompt: "웜 레드 벽돌 75%, 노출콘크리트 25%",
      geometryHash: "PG-LOCKED-123",
    });

    expect(prompt).toContain("absolute geometric source");
    expect(prompt).toContain("Preserve exactly the floor count");
    expect(prompt).toContain("Do not add balconies");
    expect(prompt).toContain("Geometry Hash: PG-LOCKED-123");
    expect(prompt).toContain("웜 레드 벽돌 75%");
  });

  it("keeps project renders inside the private project directory", () => {
    const projectId = "1132010500102810023";
    const pathname = buildConceptRenderPath(projectId, "a".repeat(64));
    expect(pathname).toBe(
      `${conceptRenderProjectPrefix(projectId)}concept-${"a".repeat(16)}.png`,
    );
    expect(isProjectConceptRenderPath(projectId, pathname)).toBe(true);
    expect(
      resolveConceptRenderFilePath(
        pathname,
        "/tmp/parcelgrid-concept-render-test",
      ),
    ).toContain("/tmp/parcelgrid-concept-render-test/projects/");
    expect(() =>
      resolveConceptRenderFilePath(
        "../outside.png",
        "/tmp/parcelgrid-concept-render-test",
      ),
    ).toThrow("유효하지 않은 콘셉트 렌더 저장 경로");
  });
});
