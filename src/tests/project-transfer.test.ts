import { describe, expect, it } from "vitest";
import type { FinancialSourceMap } from "@/lib/finance/source-data-gate";
import {
  createProjectTransferBundle,
  detachTransferredSourceDocuments,
  detachTransferredTaxDocuments,
  parseProjectTransferBundle,
  serializeProjectTransferBundle,
  type ProjectTransferPayload,
} from "@/lib/handoff/project-transfer";
import { createDraftExpertTaxContract } from "@/lib/finance/after-tax-ledger";
import { buildReviewSnapshotKey } from "@/lib/handoff/review-snapshot";
import { PROJECT_CALCULATION_VERSION } from "@/lib/services/compute-project";

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
    expertTaxContracts: [],
    stage3Snapshot: null,
    priceVerifications: {},
    expertReviews: {},
  };
}

function representativePayload(): ProjectTransferPayload {
  const scenario = {
    id: "S1",
    projectId: "P-100",
    version: 1,
  } as ProjectTransferPayload["planningScenarios"][number];
  const geometry = {
    projectId: "P-100",
    scenarioId: "S1",
    scenarioVersion: 1,
    geometryHash: "PG-S1",
    validation: {
      status: "pass",
      representativeEligible: true,
      exportable: true,
      issues: [],
    },
  } as unknown as ProjectTransferPayload["representativeGeometry"];
  const projectData = {
    parcel: { id: "P-100" },
    meta: { version: PROJECT_CALCULATION_VERSION },
    scenarios: [],
  } as unknown as NonNullable<ProjectTransferPayload["projectData"]>;
  const stage3Snapshot = {
    projectId: "P-100",
    representativeScenarioId: "S1",
    representativeScenarioVersion: 1,
    geometryHash: "PG-S1",
    savedAt: "2026-08-21T00:00:00.000Z",
    data: projectData,
  };
  return {
    ...emptyPayload(),
    projectData,
    planningScenarios: [scenario],
    selectedScenarioId: "S1",
    representativeScenarioId: "S1",
    representativeGeometry: geometry,
    stage3Snapshot,
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

  it("rejects a representative without its parcel and regulatory basis", () => {
    const bundle = createProjectTransferBundle({
      projectId: "P-100",
      payload: { ...representativePayload(), projectData: null },
    });

    const result = parseProjectTransferBundle(
      serializeProjectTransferBundle(bundle),
      "P-100"
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("부지·법규 기준 데이터");
  });

  it("rejects malformed requested reviews, not only malformed approvals", () => {
    const payload = representativePayload();
    const snapshotKey = buildReviewSnapshotKey({
      snapshot: payload.stage3Snapshot!,
      financialSources: {},
      priceVerifications: {},
      expertTaxContracts: [],
    });
    payload.expertReviews = {
      architect: {
        discipline: "architect",
        status: "requested",
        reviewer: "",
        organization: "",
        requestedBy: "",
        requestedAt: "2026-08-21",
        evidenceRef: "",
        notes: "",
        reviewedAt: "",
        updatedAt: "2026-08-21T00:00:00.000Z",
        snapshotKey,
        history: [],
      },
    };
    const bundle = createProjectTransferBundle({
      projectId: "P-100",
      payload,
    });

    const result = parseProjectTransferBundle(
      serializeProjectTransferBundle(bundle),
      "P-100"
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("전문가 검토 기록");
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

  it("detaches tax source files and removes expert-confirmed status on import", () => {
    const contract = {
      ...createDraftExpertTaxContract({
        projectId: "P-100",
        scenarioId: "S1",
        strategy: "stabilized-sale",
        preTaxEquityCashFlowsManwon: [-100, 120],
        preTaxAcquisitionTaxManwon: 0,
        equityHurdleRatePct: 10,
      }),
      reviewStatus: "expert-confirmed" as const,
      document: {
        pathname:
          "projects/P-100/source-documents/tax-stabilized-sale/memo.pdf",
        fileName: "memo.pdf",
        contentType: "application/pdf",
        size: 100,
        sha256: "b".repeat(64),
        uploadedAt: "2026-08-21T00:00:00.000Z",
      },
    };

    const [detached] = detachTransferredTaxDocuments([contract]);

    expect(detached.document).toBeUndefined();
    expect(detached.reviewStatus).toBe("draft");
  });
});
