import { describe, expect, it } from "vitest";
import {
  AFTER_TAX_LEDGER_MODEL_VERSION,
  AFTER_TAX_CALCULATION_BASIS_VERSION,
  EXPERT_TAX_CONTRACT_SCHEMA_VERSION,
  buildAfterTaxLedger,
  createDraftExpertTaxContract,
  type ExpertTaxInputContract,
  type TaxAssessmentCategory,
} from "@/lib/finance/after-tax-ledger";

const sourceDocument = {
  pathname: "projects/P1/source-documents/tax/tax-memo.pdf",
  fileName: "tax-memo.pdf",
  contentType: "application/pdf",
  size: 12_345,
  sha256: "a".repeat(64),
  uploadedAt: "2026-09-09T12:00:00.000Z",
};

const taxBasis = {
  preTaxEquityCashFlowsManwon: [-100, 0, 200],
  preTaxAcquisitionTaxManwon: 10,
  equityHurdleRatePct: 10,
};

function confirmedContract(
  overrides: Partial<ExpertTaxInputContract> = {},
): ExpertTaxInputContract {
  const draft = createDraftExpertTaxContract({
    projectId: "P1",
    scenarioId: "S1",
    strategy: "stabilized-sale",
    ...taxBasis,
  });
  return {
    ...draft,
    reviewStatus: "expert-confirmed",
    taxpayerType: "corporation",
    asOf: "2026-09-09",
    preparedBy: "홍길동",
    preparerRole: "세무사",
    expertAttestation: {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "tax@example.com",
      name: "홍길동",
      organization: "세무법인 예시",
      reviewerRole: "tax-advisor",
      confirmedAt: "2026-09-09T12:00:00.000Z",
    },
    documentRef: "세무검토-2026-09",
    document: sourceDocument,
    assessments: draft.assessments.map((assessment) => ({
      ...assessment,
      assessmentStatus: "confirmed" as const,
      note: `${assessment.category} 검토 완료`,
    })),
    updatedAt: "2026-09-09T12:00:00.000Z",
    ...overrides,
  };
}

function replaceAssessment(
  contract: ExpertTaxInputContract,
  category: TaxAssessmentCategory,
  patch: Partial<ExpertTaxInputContract["assessments"][number]>,
): ExpertTaxInputContract {
  return {
    ...contract,
    assessments: contract.assessments.map((assessment) =>
      assessment.category === category
        ? { ...assessment, ...patch }
        : assessment,
    ),
  };
}

describe("buildAfterTaxLedger", () => {
  const baseInput = {
    projectId: "P1",
    scenarioId: "S1",
    strategy: "stabilized-sale" as const,
    ...taxBasis,
  };

  it("does not present after-tax metrics without an expert contract", () => {
    const result = buildAfterTaxLedger(baseInput);

    expect(result.modelVersion).toBe(AFTER_TAX_LEDGER_MODEL_VERSION);
    expect(result.modelVersion).toBe("after-tax-ledger-2026.3");
    expect(result.status).toBe("not-configured");
    expect(result.afterTaxProfitManwon).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.afterTaxProfitUnroundedManwon).toBeNull();
    expect(result.npvUnroundedManwon).toBeNull();
    expect(result.irrUnroundedPct).toBeNull();
  });

  it("reconciles acquisition tax without deducting it a second time", () => {
    let contract = confirmedContract();
    contract = replaceAssessment(contract, "corporate-or-income-tax", {
      payments: [{ month: 3, amountManwon: 20, direction: "payment" }],
    });

    const result = buildAfterTaxLedger({ ...baseInput, contract });

    expect(result.status).toBe("expert-confirmed");
    expect(result.decisionGrade).toBe(true);
    expect(result.includedInPretaxTaxManwon).toBe(10);
    expect(result.grossIncrementalTaxPaymentsManwon).toBe(20);
    expect(result.netIncrementalTaxManwon).toBe(20);
    expect(result.afterTaxProfitManwon).toBe(80);
    expect(result.afterTaxProfitUnroundedManwon).toBe(80);
    expect(result.irrStatus).toBe("ambiguous");
    expect(result.irrUnroundedPct).toBeNull();
    expect(result.rows.map((row) => row.afterTaxEquityCashFlow)).toEqual([
      -100,
      0,
      200,
      -20,
    ]);
  });

  it("supports timed refunds and extends the monthly cash-flow horizon", () => {
    let contract = confirmedContract();
    contract = replaceAssessment(contract, "vat-settlement", {
      payments: [
        { month: 1, amountManwon: 8, direction: "payment" },
        { month: 5, amountManwon: 3, direction: "refund" },
      ],
    });

    const result = buildAfterTaxLedger({ ...baseInput, contract });

    expect(result.rows).toHaveLength(6);
    expect(result.grossIncrementalTaxPaymentsManwon).toBe(8);
    expect(result.grossIncrementalTaxRefundsManwon).toBe(3);
    expect(result.netIncrementalTaxManwon).toBe(5);
    expect(result.rows[5]).toMatchObject({
      taxRefund: 3,
      afterTaxEquityCashFlow: 3,
    });
  });

  it("rejects acquisition tax that does not reconcile to the pretax ledger", () => {
    let contract = confirmedContract();
    contract = replaceAssessment(contract, "acquisition-tax-in-ledger", {
      payments: [{ month: 0, amountManwon: 12, direction: "payment" }],
    });

    const result = buildAfterTaxLedger({ ...baseInput, contract });

    expect(result.status).toBe("invalid");
    expect(result.afterTaxProfitManwon).toBeNull();
    expect(result.errors.join(" ")).toContain("세전 원장");
  });

  it("keeps a partially assessed draft visibly incomplete", () => {
    const contract = createDraftExpertTaxContract({
      projectId: "P1",
      scenarioId: "S1",
      strategy: "stabilized-sale",
      ...taxBasis,
    });
    const result = buildAfterTaxLedger({ ...baseInput, contract });

    expect(result.status).toBe("incomplete");
    expect(result.decisionGrade).toBe(false);
    expect(result.missingCategories.length).toBeGreaterThan(0);
    expect(result.afterTaxProfitManwon).not.toBeNull();
  });

  it("invalidates an expert confirmation when the pretax basis changes", () => {
    const contract = confirmedContract();
    const result = buildAfterTaxLedger({
      ...baseInput,
      preTaxEquityCashFlowsManwon: [-100, 0, 210],
      contract,
    });

    expect(result.status).toBe("stale");
    expect(result.decisionGrade).toBe(false);
    expect(result.afterTaxProfitManwon).toBeNull();
    expect(result.calculationBasisFingerprint).not.toBe(
      result.contractBasisFingerprint,
    );
    expect(result.errors.join(" ")).toContain("다시 저장");
  });

  it("requires expert identity and a validated source document for confirmation", () => {
    const contract = confirmedContract({
      preparedBy: "",
      expertAttestation: undefined,
      document: undefined,
    });
    const result = buildAfterTaxLedger({ ...baseInput, contract });

    expect(result.status).toBe("incomplete");
    expect(result.decisionGrade).toBe(false);
    expect(result.errors.join(" ")).toContain("작성자");
    expect(result.errors.join(" ")).toContain("확인 주체");
    expect(result.errors.join(" ")).toContain("원문");
  });

  it("rejects a typed expert name that does not match the authenticated attestation", () => {
    const contract = confirmedContract({ preparedBy: "다른 사용자" });
    const result = buildAfterTaxLedger({ ...baseInput, contract });

    expect(result.status).toBe("invalid");
    expect(result.decisionGrade).toBe(false);
    expect(result.errors.join(" ")).toContain("로그인 확인 주체");
  });

  it("rejects contracts for a different scenario or strategy", () => {
    const contract = confirmedContract({
      schemaVersion: EXPERT_TAX_CONTRACT_SCHEMA_VERSION,
      scenarioId: "S2",
      strategy: "long-term-hold",
    });
    const result = buildAfterTaxLedger({ ...baseInput, contract });

    expect(result.status).toBe("invalid");
    expect(result.errors.join(" ")).toContain("계획안");
    expect(result.errors.join(" ")).toContain("처분전략");
  });

  it("requires a rationale when an expert marks a category not applicable", () => {
    let contract = confirmedContract();
    contract = replaceAssessment(contract, "additional-disposal-tax", {
      assessmentStatus: "not-applicable",
      payments: [],
      note: "",
    });

    const result = buildAfterTaxLedger({ ...baseInput, contract });

    expect(result.status).toBe("incomplete");
    expect(result.errors.join(" ")).toContain("해당 없음 근거");
  });

  it("exposes raw metrics from the same monthly cash flows while retaining rounded displays", () => {
    const input = { ...baseInput, preTaxEquityCashFlowsManwon: [-100, ...Array<number>(11).fill(0), 109.96] };
    const contract = confirmedContract({ calculationBasis: createDraftExpertTaxContract(input).calculationBasis });
    const result = buildAfterTaxLedger({ ...input, contract });

    expect(result.status).toBe("expert-confirmed");
    expect(result.afterTaxProfitUnroundedManwon).toBeCloseTo(9.96, 10);
    expect(result.npvUnroundedManwon).toBeCloseTo(-100 + 109.96 / 1.1, 8);
    expect(result.irrUnroundedPct).toBeCloseTo(9.96, 6);
    expect(result.afterTaxProfitManwon).toBe(10);
    expect(Math.abs(result.npvManwon!)).toBe(0);
    expect(result.irrPct).toBe(10);
    expect(result.rows.map(row => row.afterTaxEquityCashFlow)).toEqual(input.preTaxEquityCashFlowsManwon);
  });

  it("retains a fractional loss in the raw profit when its display rounds to zero", () => {
    const input = { ...baseInput, preTaxEquityCashFlowsManwon: [-100, 99.6] };
    const contract = confirmedContract({ calculationBasis: createDraftExpertTaxContract(input).calculationBasis });
    const result = buildAfterTaxLedger({ ...input, contract });

    expect(result.status).toBe("expert-confirmed");
    expect(result.afterTaxProfitUnroundedManwon).toBeCloseTo(-0.4, 10);
    expect(result.afterTaxProfitUnroundedManwon).toBeLessThan(0);
    expect(Math.abs(result.afterTaxProfitManwon!)).toBe(0);
  });

  it("preserves exact decimal break-even across months without a false negative loss", () => {
    const input = { ...baseInput, equityHurdleRatePct: 0, preTaxEquityCashFlowsManwon: [-0.1, -0.2, 0.3] };
    const contract = confirmedContract({ calculationBasis: createDraftExpertTaxContract(input).calculationBasis });
    const result = buildAfterTaxLedger({ ...input, contract });
    expect(result.afterTaxProfitUnroundedManwon).toBe(0);
    expect(result.npvUnroundedManwon).toBe(0);
    expect(result.rows.at(-1)!.cumulativeAfterTaxEquityCashFlow).toBe(0);
    expect(result.rows.at(-1)!.cumulativePreTaxEquityCashFlow).toBe(0);
  });

  it("uses decimal tax aggregation and within-month subtraction before the raw target gate", () => {
    const input = { ...baseInput, equityHurdleRatePct: 0, preTaxEquityCashFlowsManwon: [-0.1, 0.4] };
    const contract = replaceAssessment(confirmedContract({ calculationBasis: createDraftExpertTaxContract(input).calculationBasis }),
      "corporate-or-income-tax", { payments: [
        { month: 1, amountManwon: 0.1, direction: "payment" },
        { month: 1, amountManwon: 0.2, direction: "payment" },
      ] });
    const result = buildAfterTaxLedger({ ...input, contract });
    expect(result.rows[1].taxPayment).toBe(0.3);
    expect(result.rows[1].afterTaxEquityCashFlow).toBe(0.1);
    expect(result.afterTaxProfitUnroundedManwon).toBe(0);
    expect(result.npvUnroundedManwon).toBe(0);
  });

  it("keeps the basis version and fingerprints numeric flow changes rather than array identity", () => {
    const input = { ...baseInput, preTaxEquityCashFlowsManwon: [-100.25, 0, 110.2] };
    const contract = confirmedContract({ calculationBasis: createDraftExpertTaxContract(input).calculationBasis });
    const unchanged = buildAfterTaxLedger({ ...input, preTaxEquityCashFlowsManwon: [...input.preTaxEquityCashFlowsManwon], contract });
    const rounded = buildAfterTaxLedger({ ...input, preTaxEquityCashFlowsManwon: [-100, 0, 110], contract });

    expect(AFTER_TAX_CALCULATION_BASIS_VERSION).toBe("after-tax-calculation-basis-2026.1");
    expect(unchanged.status).toBe("expert-confirmed");
    expect(unchanged.calculationBasisFingerprint).toBe(contract.calculationBasis.fingerprint);
    expect(rounded.status).toBe("stale");
    expect(rounded.calculationBasisFingerprint).not.toBe(contract.calculationBasis.fingerprint);
    expect(rounded.afterTaxProfitUnroundedManwon).toBeNull();
    expect(rounded.npvUnroundedManwon).toBeNull();
    expect(rounded.irrUnroundedPct).toBeNull();
  });
});


it("rejects a legacy snapshot with no pretax series without crashing or inventing tax results", () => {
 const input = {projectId:"P1",scenarioId:"S1",strategy:"stabilized-sale",preTaxAcquisitionTaxManwon:10,equityHurdleRatePct:10} as Parameters<typeof buildAfterTaxLedger>[0];
 const result=buildAfterTaxLedger(input);
 expect(result.status).toBe("invalid");expect(result.decisionGrade).toBe(false);expect(result.afterTaxProfitManwon).toBeNull();expect(result.errors.join(" ")).toContain("재계산");
});
