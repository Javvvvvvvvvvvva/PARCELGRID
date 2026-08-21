import { describe, expect, it } from "vitest";
import type { FinancialSourceMap } from "@/lib/finance/source-data-gate";
import {
  createProjectTransferBundle,
  detachTransferredSourceDocuments,
  parseProjectTransferBundle,
  serializeProjectTransferBundle,
  type ProjectTransferPayload,
} from "@/lib/handoff/project-transfer";

function emptyPayload(): ProjectTransferPayload {
  return {
    projectData: null,
    envelopePlan: null,
    planningScenarios: [],
    selectedScenarioId: null,
    representativeScenarioId: null,
    representativeGeometry: null,
    draftAssumptions: {},
    draftAcquisitionPrice: null,
    financialSources: {},
    stage3Snapshot: null,
    priceVerifications: {},
    expertReviews: {},
  };
}

describe("project transfer bundle", () => {
  it("round-trips a checksum-bound package for the same project", () => {
    const bundle = createProjectTransferBundle({
      projectId: "P-100",
      exportedAt: "2026-08-21T00:00:00.000Z",
      payload: {
        ...emptyPayload(),
        draftAcquisitionPrice: 123_456,
      },
    });

    const result = parseProjectTransferBundle(
      serializeProjectTransferBundle(bundle),
      "P-100"
    );

    expect(result.valid).toBe(true);
    expect(result.bundle?.payload.draftAcquisitionPrice).toBe(123_456);
  });

  it("rejects importing a package into a different project", () => {
    const bundle = createProjectTransferBundle({
      projectId: "P-100",
      payload: emptyPayload(),
    });

    const result = parseProjectTransferBundle(
      serializeProjectTransferBundle(bundle),
      "P-200"
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("프로젝트 ID가 다릅니다");
  });

  it("rejects a modified payload when the checksum is unchanged", () => {
    const bundle = createProjectTransferBundle({
      projectId: "P-100",
      payload: emptyPayload(),
    });
    const modified = JSON.parse(
      serializeProjectTransferBundle(bundle)
    ) as Record<string, unknown>;
    const payload = modified.payload as Record<string, unknown>;
    payload.draftAcquisitionPrice = 999_999;

    const result = parseProjectTransferBundle(
      JSON.stringify(modified),
      "P-100"
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("체크섬");
  });

  it("rejects expert reviews without their Stage 3 evidence snapshot", () => {
    const bundle = createProjectTransferBundle({
      projectId: "P-100",
      payload: {
        ...emptyPayload(),
        expertReviews: {
          architect: {
            discipline: "architect",
            status: "requested",
            reviewer: "검토자",
            organization: "테스트",
            evidenceRef: "DOC-1",
            notes: "검토 요청",
            reviewedAt: "2026-08-21",
            updatedAt: "2026-08-21T00:00:00.000Z",
            snapshotKey: "PG-REVIEW-OLD",
          },
        },
      },
    });

    const result = parseProjectTransferBundle(
      serializeProjectTransferBundle(bundle),
      "P-100"
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("Stage 3 저장본");
  });
  it("detaches source files that are not contained in the JSON package", () => {
    const sources = {
      constCostPerSqM: {
        field: "constCostPerSqM",
        value: 3_000_000,
        sourceKind: "professional-quote",
        sourceName: "견적",
        documentRef: "quote.pdf",
        asOf: "2026-08-21",
        verifiedBy: "검토자",
        recordedAt: "2026-08-21",
        document: {
          pathname: "projects/P-100/source-documents/quote.pdf",
          fileName: "quote.pdf",
          contentType: "application/pdf",
          size: 100,
          sha256: "a".repeat(64),
          uploadedAt: "2026-08-21T00:00:00.000Z",
        },
      },
    } as FinancialSourceMap;

    const detached = detachTransferredSourceDocuments(sources);

    expect(detached.constCostPerSqM?.document).toBeUndefined();
    expect(detached.constCostPerSqM?.documentRef).toBe("quote.pdf");
  });
});
