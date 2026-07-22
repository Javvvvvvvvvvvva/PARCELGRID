import { describe, expect, it } from "vitest";
import {
  buildSourceDocumentPath,
  isProjectSourceDocumentPath,
  MAX_SOURCE_DOCUMENT_BYTES,
  validateSourceDocumentBytes,
  validateSourceDocumentFile,
  validateSourceDocumentMetadata,
} from "../../lib/finance/source-document";

describe("source document security", () => {
  it("accepts supported document types within the server upload limit", () => {
    const result = validateSourceDocumentFile({
      name: "견적서.pdf",
      type: "application/pdf",
      size: 512_000,
    });
    expect(result.valid).toBe(true);
    expect(result.contentType).toBe("application/pdf");
  });

  it("rejects oversized and mismatched files", () => {
    expect(
      validateSourceDocumentFile({
        name: "term-sheet.pdf",
        type: "text/csv",
        size: MAX_SOURCE_DOCUMENT_BYTES + 1,
      }).errors,
    ).toHaveLength(2);
  });

  it("checks binary signatures instead of trusting extensions", () => {
    expect(validateSourceDocumentBytes("pdf", new TextEncoder().encode("%PDF-1.7"))).toEqual([]);
    expect(validateSourceDocumentBytes("pdf", new TextEncoder().encode("not-pdf"))[0]).toContain("시그니처");
    expect(validateSourceDocumentBytes("xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toEqual([]);
    expect(validateSourceDocumentBytes("xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toEqual([]);
  });

  it("confines download paths to the selected project", () => {
    const path = buildSourceDocumentPath("1132010500102810023", "interestRate", "../PF 조건.xlsx");
    expect(path).not.toContain("../");
    expect(isProjectSourceDocumentPath("1132010500102810023", path)).toBe(true);
    expect(isProjectSourceDocumentPath("other-project", path)).toBe(false);
  });

  it("rejects tampered persisted metadata", () => {
    expect(
      validateSourceDocumentMetadata({
        pathname: "projects/p/source-documents/f/a.pdf",
        fileName: "a.pdf",
        contentType: "application/pdf",
        size: 100,
        sha256: "not-a-hash",
        uploadedAt: "2026-07-21T12:00:00.000Z",
      }),
    ).toContain("원문 SHA-256 해시가 올바르지 않습니다.");
  });
});

