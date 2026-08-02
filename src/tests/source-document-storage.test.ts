import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadSourceDocument,
  resolveSourceDocumentFilePath,
  saveSourceDocument,
} from "@/lib/runtime/source-document-storage";

const originalStorageDirectory = process.env.SOURCE_DOCUMENT_STORAGE_DIR;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalStorageDirectory === undefined) {
    delete process.env.SOURCE_DOCUMENT_STORAGE_DIR;
  } else {
    process.env.SOURCE_DOCUMENT_STORAGE_DIR = originalStorageDirectory;
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("local source document storage", () => {
  it("round-trips a private source document below the configured root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "parcelgrid-source-"));
    temporaryDirectories.push(root);
    process.env.SOURCE_DOCUMENT_STORAGE_DIR = root;
    const pathname = "projects/p/source-documents/interest/pf-123456789abc.pdf";
    const bytes = new TextEncoder().encode("%PDF-1.7 test");

    await saveSourceDocument(pathname, bytes);
    expect(await loadSourceDocument(pathname)).toEqual(bytes);
    expect(resolveSourceDocumentFilePath(pathname, root).startsWith(root)).toBe(true);
  });

  it("rejects traversal and hidden path segments", () => {
    expect(() => resolveSourceDocumentFilePath("../outside.pdf", "/tmp/store")).toThrow();
    expect(() => resolveSourceDocumentFilePath("projects/.hidden/file.pdf", "/tmp/store")).toThrow();
  });
});
