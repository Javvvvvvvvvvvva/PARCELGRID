import { describe, expect, it } from "vitest";
import {
  conceptReferenceStorageKey,
  createConceptReferenceCapture,
  parseConceptReferenceCapture,
} from "@/lib/ai/concept-reference-cache";

describe("concept reference cache", () => {
  it("round-trips only the exact project and geometry", () => {
    const capture = createConceptReferenceCapture({
      projectId: "P1",
      geometryHash: "PG-GEOMETRY-1",
      dataUrl: "data:image/jpeg;base64,AAAA",
      capturedAt: "2026-08-21T10:00:00.000Z",
    });
    const serialized = JSON.stringify(capture);

    expect(
      parseConceptReferenceCapture(serialized, {
        projectId: "P1",
        geometryHash: "PG-GEOMETRY-1",
      })
    ).toEqual(capture);
    expect(
      parseConceptReferenceCapture(serialized, {
        projectId: "P1",
        geometryHash: "PG-GEOMETRY-2",
      })
    ).toBeNull();
  });

  it("rejects unsupported or malformed browser data", () => {
    expect(() =>
      createConceptReferenceCapture({
        projectId: "P1",
        geometryHash: "PG-GEOMETRY-1",
        dataUrl: "data:text/plain;base64,AAAA",
      })
    ).toThrow("PNG·JPEG·WEBP");
    expect(parseConceptReferenceCapture("{broken", { projectId: "P1" })).toBeNull();
    expect(conceptReferenceStorageKey(" P1 ")).toBe(
      "parcelgrid-concept-reference:P1"
    );
  });
});
