import { describe, expect, it } from "vitest";
import {
  applyFinancialSources,
  buildSourceDataGate,
  FINANCIAL_SOURCE_GUIDANCE,
  requiredSourceFields,
  sourceKindRequiresDocument,
  validateFinancialSource,
  type FinancialSourceField,
  type FinancialSourceMap,
  type FinancialSourceRecord,
} from "../../lib/finance/source-data-gate";
import { defaultAssumptions, defaultProgram } from "../../lib/finance/scenario";
import type { Parcel, Scenario } from "../../lib/finance/types";

const parcel: Parcel = {
  id: "SOURCE-GATE-PARCEL",
  address: "서울특별시 테스트구 테스트동 3",
  addressRoad: "테스트로 3",
  lotArea: 300,
  zoning: "제2종일반주거지역",
  zoneCode: "UQA122",
  maxFAR: 250,
  maxBCR: 60,
  heightLimit: 20,
  setback: { road: 1, side: 0.5, rear: 0.5 },
  landPrice: 3_000_000,
  estMarketPrice: 8_000_000,
  acquired: "2026-01-01",
  acquiredPrice: 150_000,
};

const scenario: Scenario = {
  id: "SOURCE-GATE-SCENARIO",
  name: "다가구 통매각",
  shortName: "소스 검증",
  program: defaultProgram("multi-family", parcel.maxFAR, parcel.maxBCR),
  assumptions: defaultAssumptions(),
};

function record(
  field: FinancialSourceField,
  value: number,
  sourceKind: FinancialSourceRecord["sourceKind"] = "approved-policy",
): FinancialSourceRecord {
  return {
    field,
    value,
    sourceKind,
    sourceName: "테스트 발급기관",
    documentRef: "DOC-2026-001",
    asOf: "2026-07-21",
    verifiedBy: "홍길동",
    recordedAt: "2026-07-21",
  };
}

function validRecord(field: FinancialSourceField, value: number) {
  const kindByField: Partial<
    Record<FinancialSourceField, FinancialSourceRecord["sourceKind"]>
  > = {
    acquisitionPrice: "signed-contract",
    salePricePerSqM: "appraisal",
    constCostPerSqM: "professional-quote",
    softCostRate: "professional-quote",
    contingencyRate: "approved-policy",
    ltcTarget: "lender-term-sheet",
    interestRate: "lender-term-sheet",
    equityIRR: "approved-policy",
    salesPaceMonthlyPct: "appraisal",
    leaseUpMonths: "approved-policy",
    designMonths: "professional-quote",
    constructionMonths: "professional-quote",
    saleOutMonths: "appraisal",
  };
  const result = record(field, value, kindByField[field]);
  if (sourceKindRequiresDocument(result.sourceKind)) {
    result.document = {
      pathname: `projects/source-gate/source-documents/${field}/source.pdf`,
      fileName: "source.pdf",
      contentType: "application/pdf",
      size: 1_024,
      sha256: "a".repeat(64),
      uploadedAt: "2026-07-21T12:00:00.000Z",
    };
  }
  return result;
}

describe("source data gate", () => {
  it("blocks default assumptions when no source records exist", () => {
    const gate = buildSourceDataGate(scenario, {});
    expect(gate.status).toBe("blocked");
    expect(gate.coveragePct).toBe(0);
    expect(gate.missingFields).toEqual(requiredSourceFields(scenario));
  });

  it("requires only fields that currently affect the financial ledger", () => {
    const noBasementSaleScenario: Scenario = {
      ...scenario,
      program: {
        ...scenario.program,
        floorsBelow: 0,
      },
    };
    const fields = requiredSourceFields(noBasementSaleScenario);

    expect(fields).toContain("salePricePerSqM");
    expect(fields).not.toContain("salesPaceMonthlyPct");
    expect(fields).not.toContain("leaseUpMonths");
    expect(fields).not.toContain("basementCostMultiplier");
    expect(fields).toHaveLength(11);
  });

  it("requires sales pace and lease-up evidence only when those inputs affect the ledger", () => {
    const mixedScenario: Scenario = {
      ...scenario,
      program: defaultProgram("officetel", parcel.maxFAR, parcel.maxBCR),
    };
    const mixedFields = requiredSourceFields(mixedScenario);

    expect(mixedFields).toContain("salesPaceMonthlyPct");
    expect(mixedFields).toContain("leaseUpMonths");

    const leaseScenario: Scenario = {
      ...scenario,
      program: defaultProgram("retail", parcel.maxFAR, parcel.maxBCR),
    };
    const leaseFields = requiredSourceFields(leaseScenario);
    expect(leaseFields).not.toContain("salesPaceMonthlyPct");
    expect(leaseFields).toContain("leaseUpMonths");
  });

  it("provides plain-language evidence guidance for every financial field", () => {
    for (const field of Object.keys(
      FINANCIAL_SOURCE_GUIDANCE,
    ) as FinancialSourceField[]) {
      expect(FINANCIAL_SOURCE_GUIDANCE[field].why.length).toBeGreaterThan(5);
      expect(
        FINANCIAL_SOURCE_GUIDANCE[field].recommendedEvidence.length,
      ).toBeGreaterThan(5);
    }
  });

  it("rejects incomplete metadata and an incompatible source type", () => {
    const invalid = record("interestRate", 5.9, "official-api");
    invalid.documentRef = "";
    const result = validateFinancialSource(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("문서번호"))).toBe(
      true,
    );
    expect(result.errors.some((error) => error.includes("허용되지"))).toBe(
      true,
    );
  });

  it("rejects source values outside the calculator domain", () => {
    const invalidVacancy = record("vacancyRate", 120, "approved-policy");
    const invalidDuration = record("constructionMonths", 6.5, "approved-policy");

    expect(validateFinancialSource(invalidVacancy).errors).toContain(
      "공실률은(는) 0 이상 100 이하여야 합니다.",
    );
    expect(
      validateFinancialSource(invalidDuration).errors.some((error) =>
        error.includes("정수 개월"),
      ),
    ).toBe(true);
  });

  it("passes only when every financially material field is source-backed", () => {
    const records: FinancialSourceMap = {};
    for (const field of requiredSourceFields(scenario)) {
      records[field] = validRecord(
        field,
        scenario.assumptions[field as keyof typeof scenario.assumptions] ??
          parcel.acquiredPrice,
      );
    }
    const gate = buildSourceDataGate(scenario, records);
    expect(gate.status).toBe("source-backed");
    expect(gate.coveragePct).toBe(100);
    expect(gate.missingFields).toEqual([]);
  });

  it("keeps manual values calculable while blocking handoff until an upload-required source has its original file", () => {
    const manual = record("interestRate", 4.7, "lender-term-sheet");
    const gate = buildSourceDataGate(scenario, { interestRate: manual });
    const applied = applyFinancialSources(parcel, scenario, {
      interestRate: manual,
    });

    expect(applied.scenario.assumptions.interestRate).toBe(4.7);
    expect(gate.status).toBe("blocked");
    expect(gate.invalidFields[0]?.errors[0]).toContain("원문 파일");
  });

  it("applies verified source values without mutating the saved project", () => {
    const records: FinancialSourceMap = {
      acquisitionPrice: validRecord("acquisitionPrice", 91_000),
      salePricePerSqM: validRecord("salePricePerSqM", 7_700_000),
      interestRate: validRecord("interestRate", 4.8),
    };
    const beforeParcel = JSON.stringify(parcel);
    const beforeScenario = JSON.stringify(scenario);
    const applied = applyFinancialSources(parcel, scenario, records);

    expect(applied.parcel.acquiredPrice).toBe(91_000);
    expect(applied.scenario.assumptions.salePricePerSqM).toBe(7_700_000);
    expect(applied.scenario.assumptions.interestRate).toBe(4.8);
    expect(applied.applied).toEqual([
      "acquisitionPrice",
      "salePricePerSqM",
      "interestRate",
    ]);
    expect(JSON.stringify(parcel)).toBe(beforeParcel);
    expect(JSON.stringify(scenario)).toBe(beforeScenario);
  });
});
