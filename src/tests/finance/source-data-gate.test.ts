import { describe, expect, it } from "vitest";
import {
  applyFinancialSources,
  buildSourceDataGate,
  FINANCIAL_SOURCE_GUIDANCE,
  HOLD_PERIOD_SOURCE_FIELDS,
  TENANT_ROLLOVER_SOURCE_FIELDS,
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
    rentPerSqMMonth: "appraisal",
    residentialSalePricePerSqM: "appraisal",
    retailSalePricePerSqM: "appraisal",
    officeSalePricePerSqM: "appraisal",
    residentialRentPerSqMMonth: "appraisal",
    retailRentPerSqMMonth: "appraisal",
    officeRentPerSqMMonth: "appraisal",
    operatingExpenseRate: "professional-quote",
    constCostPerSqM: "professional-quote",
    softCostRate: "professional-quote",
    contingencyRate: "approved-policy",
    acquisitionTaxManwon: "professional-quote",
    acquisitionOtherCostManwon: "professional-quote",
    tenantRelocationCostManwon: "professional-quote",
    ltcTarget: "lender-term-sheet",
    interestRate: "lender-term-sheet",
    pfUpfrontFeeRate: "lender-term-sheet",
    trustFeeManwon: "professional-quote",
    equityCommitmentManwon: "approved-policy",
    takeoutLtv: "lender-term-sheet",
    takeoutInterestRate: "lender-term-sheet",
    takeoutAmortizationYears: "lender-term-sheet",
    takeoutLoanTermYears: "lender-term-sheet",
    takeoutPaymentDeferralMonths: "lender-term-sheet",
    takeoutInterestOnlyMonths: "lender-term-sheet",
    takeoutRateResetMonths: "lender-term-sheet",
    takeoutAnnualRateChange: "approved-policy",
    takeoutRateFloor: "lender-term-sheet",
    takeoutRateCap: "lender-term-sheet",
    takeoutDsraMonths: "lender-term-sheet",
    takeoutMinDscr: "lender-term-sheet",
    takeoutLoanCommitmentManwon: "lender-term-sheet",
    takeoutFeeRate: "lender-term-sheet",
    holdPeriodYears: "approved-policy",
    annualRentGrowthRate: "appraisal",
    annualExpenseGrowthRate: "approved-policy",
    rentFreeMonths: "appraisal",
    tenantImprovementPerSqM: "professional-quote",
    leasingCommissionRate: "professional-quote",
    securityDepositMonths: "appraisal",
    tenantLeaseTermMonths: "appraisal",
    tenantRenewalProbability: "appraisal",
    renewalRentAdjustmentRate: "appraisal",
    renewalRentFreeMonths: "appraisal",
    replacementDowntimeMonths: "appraisal",
    replacementRentFreeMonths: "appraisal",
    replacementTenantImprovementPerSqM: "professional-quote",
    replacementLeasingCommissionRate: "professional-quote",
    replacementReservePerSqMYear: "professional-quote",
    majorRepairYear: "approved-policy",
    majorRepairCostManwon: "professional-quote",
    holdExitCapRate: "appraisal",
    exitSellingCostRate: "professional-quote",
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
    expect(fields).toHaveLength(17);
  });

  it("requires independent evidence only for active Stage 2 revenue pools", () => {
    const areaScenario: Scenario = {
      ...scenario,
      program: {
        ...scenario.program,
        areaContract: {
          schemaVersion: "stage2-finance-area-2026.1",
          source: "stage2-planning",
          sourceScenarioId: scenario.id,
          sourceScenarioVersion: 1,
          constructionAreaSqm: 100,
          aboveGroundAreaSqm: 100,
          basementAreaSqm: 0,
          farAreaSqm: 100,
          gradeFootprintAreaSqm: 50,
          parkingAreaSqm: 0,
          commonAreaSqm: 20,
          saleableAreaSqm: 50,
          rentableAreaSqm: 30,
          revenueAreas: {
            residentialSaleSqm: 50,
            retailSaleSqm: 0,
            officeSaleSqm: 0,
            residentialLeaseSqm: 0,
            retailLeaseSqm: 0,
            officeLeaseSqm: 30,
          },
          providedParkingSpaces: 0,
          requiredParkingSpaces: 0,
          materialAdjustmentCostManwon: 0,
        },
      },
    };
    const fields = requiredSourceFields(areaScenario);

    expect(fields).toContain("residentialSalePricePerSqM");
    expect(fields).toContain("officeRentPerSqMMonth");
    expect(fields).not.toContain("salePricePerSqM");
    expect(fields).not.toContain("rentPerSqMMonth");
    expect(fields).not.toContain("retailSalePricePerSqM");
    expect(fields).not.toContain("retailRentPerSqMMonth");
  });

  it("uses generic source prices as fallback and lets pool evidence override", () => {
    const applied = applyFinancialSources(parcel, scenario, {
      salePricePerSqM: validRecord("salePricePerSqM", 5_000_000),
      rentPerSqMMonth: validRecord("rentPerSqMMonth", 20_000),
      residentialSalePricePerSqM: validRecord(
        "residentialSalePricePerSqM",
        7_000_000,
      ),
      retailRentPerSqMMonth: validRecord(
        "retailRentPerSqMMonth",
        30_000,
      ),
    });

    expect(applied.scenario.revenuePricing?.pools.residentialSale).toMatchObject({
      baseUnitPriceWon: 7_000_000,
      sourceField: "residentialSalePricePerSqM",
      sourceStatus: "source-backed",
    });
    expect(applied.scenario.revenuePricing?.pools.retailSale.unitPriceWon).toBe(
      5_000_000,
    );
    expect(applied.scenario.revenuePricing?.pools.residentialLease.unitPriceWon).toBe(
      20_000,
    );
    expect(applied.scenario.revenuePricing?.pools.retailLease).toMatchObject({
      baseUnitPriceWon: 30_000,
      unitPriceWon: 36_000,
      sourceField: "retailRentPerSqMMonth",
      sourceStatus: "source-backed",
    });
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
    expect(leaseFields).toEqual(
      expect.arrayContaining([
        "takeoutLtv",
        "takeoutInterestRate",
        "takeoutAmortizationYears",
        "takeoutLoanTermYears",
        "takeoutPaymentDeferralMonths",
        "takeoutInterestOnlyMonths",
        "takeoutRateResetMonths",
        "takeoutDsraMonths",
        "takeoutMinDscr",
        "takeoutLoanCommitmentManwon",
        "takeoutFeeRate",
      ]),
    );
  });

  it("requires variable-rate path evidence only when rate resets are enabled", () => {
    const fixedScenario: Scenario = {
      ...scenario,
      program: defaultProgram("retail", parcel.maxFAR, parcel.maxBCR),
    };
    const fixedFields = requiredSourceFields(fixedScenario);

    expect(fixedFields).not.toContain("takeoutAnnualRateChange");
    expect(fixedFields).not.toContain("takeoutRateFloor");
    expect(fixedFields).not.toContain("takeoutRateCap");

    const variableScenario: Scenario = {
      ...fixedScenario,
      assumptions: {
        ...fixedScenario.assumptions,
        takeoutRateResetMonths: 12,
      },
    };
    const variableFields = requiredSourceFields(variableScenario);

    expect(variableFields).toEqual(
      expect.arrayContaining([
        "takeoutAnnualRateChange",
        "takeoutRateFloor",
        "takeoutRateCap",
      ]),
    );
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
        field === "acquisitionPrice"
          ? parcel.acquiredPrice
          : field === "equityCommitmentManwon"
            ? 200_000
            : scenario.assumptions[
                field as keyof typeof scenario.assumptions
              ],
      );
    }
    const gate = buildSourceDataGate(scenario, records);
    expect(gate.status).toBe("source-backed");
    expect(gate.coveragePct).toBe(100);
    expect(gate.missingFields).toEqual([]);
  });

  it("does not accept a zero equity commitment as verified funding", () => {
    const zeroCommitment = validRecord("equityCommitmentManwon", 0);
    expect(validateFinancialSource(zeroCommitment)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        "확인 자기자본 한도는 0보다 커야 합니다.",
      ]),
    });
  });

  it("does not certify missing take-out terms or a zero commitment", () => {
    expect(validateFinancialSource(validRecord("takeoutLtv", 0))).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        "장기대출 최대 LTV은(는) 0보다 커야 합니다.",
      ]),
    });
    expect(
      validateFinancialSource(validRecord("takeoutLoanCommitmentManwon", 0)),
    ).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        "장기대출 확약액은(는) 0보다 커야 합니다.",
      ]),
    });
    expect(validateFinancialSource(validRecord("takeoutFeeRate", 0)).valid).toBe(
      true,
    );
    expect(
      validateFinancialSource(
        validRecord("takeoutPaymentDeferralMonths", 0),
      ).valid,
    ).toBe(true);
    expect(
      validateFinancialSource(validRecord("takeoutDsraMonths", 0)).valid,
    ).toBe(true);
  });

  it("passes an all-lease case only after take-out terms are source-backed", () => {
    const leaseScenario: Scenario = {
      ...scenario,
      program: defaultProgram("retail", parcel.maxFAR, parcel.maxBCR),
    };
    const takeoutValues: Partial<Record<FinancialSourceField, number>> = {
      takeoutLtv: 60,
      takeoutInterestRate: 5.2,
      takeoutAmortizationYears: 25,
      takeoutLoanTermYears: 5,
      takeoutMinDscr: 1.3,
      takeoutLoanCommitmentManwon: 100_000,
      takeoutFeeRate: 1,
    };
    const records: FinancialSourceMap = {};
    for (const field of requiredSourceFields(leaseScenario)) {
      records[field] = validRecord(
        field,
        field === "acquisitionPrice"
          ? parcel.acquiredPrice
          : field === "equityCommitmentManwon"
            ? 200_000
            : takeoutValues[field] ??
              leaseScenario.assumptions[
                field as keyof typeof leaseScenario.assumptions
              ],
      );
    }

    const gate = buildSourceDataGate(leaseScenario, records);
    expect(gate.status).toBe("source-backed");
    expect(gate.validRecords).toHaveLength(gate.requiredFields.length);
  });

  it("requires hold operating and exit evidence only after a hold period is enabled", () => {
    const leaseScenario: Scenario = {
      ...scenario,
      program: defaultProgram("retail", parcel.maxFAR, parcel.maxBCR),
    };
    expect(requiredSourceFields(leaseScenario)).not.toContain(
      "holdExitCapRate",
    );

    const holdScenario: Scenario = {
      ...leaseScenario,
      assumptions: {
        ...leaseScenario.assumptions,
        holdPeriodYears: 5,
        holdExitCapRate: 5.5,
      },
    };
    const fields = requiredSourceFields(holdScenario);
    expect(fields).toEqual(expect.arrayContaining(HOLD_PERIOD_SOURCE_FIELDS));
    expect(fields).not.toEqual(
      expect.arrayContaining(TENANT_ROLLOVER_SOURCE_FIELDS),
    );

    const records: FinancialSourceMap = {};
    const takeoutValues: Partial<Record<FinancialSourceField, number>> = {
      takeoutLtv: 60,
      takeoutInterestRate: 5.2,
      takeoutAmortizationYears: 25,
      takeoutLoanTermYears: 5,
      takeoutMinDscr: 1.3,
      takeoutLoanCommitmentManwon: 100_000,
      takeoutFeeRate: 1,
      holdPeriodYears: 5,
      holdExitCapRate: 5.5,
      tenantLeaseTermMonths: 120,
    };
    for (const field of fields) {
      records[field] = validRecord(
        field,
        field === "acquisitionPrice"
          ? parcel.acquiredPrice
          : field === "equityCommitmentManwon"
            ? 200_000
            : takeoutValues[field] ??
              holdScenario.assumptions[
                field as keyof typeof holdScenario.assumptions
              ],
      );
    }

    const gate = buildSourceDataGate(holdScenario, records);
    expect(gate.status).toBe("source-backed");
    expect(gate.requiredFields).toEqual(expect.arrayContaining(fields));
  });

  it("requires hold and rollover evidence for a mixed sale-and-lease case", () => {
    const mixedScenario: Scenario = {
      ...scenario,
      program: defaultProgram("officetel", parcel.maxFAR, parcel.maxBCR),
      assumptions: {
        ...scenario.assumptions,
        holdPeriodYears: 5,
        holdExitCapRate: 5.5,
        tenantLeaseTermMonths: 36,
        tenantRenewalProbability: 50,
      },
    };

    const fields = requiredSourceFields(mixedScenario);
    expect(fields).toEqual(expect.arrayContaining(HOLD_PERIOD_SOURCE_FIELDS));
    expect(fields).toEqual(
      expect.arrayContaining(TENANT_ROLLOVER_SOURCE_FIELDS),
    );
  });

  it("requires only the rollover branch inputs that affect expected cash flow", () => {
    const baseHold: Scenario = {
      ...scenario,
      program: defaultProgram("retail", parcel.maxFAR, parcel.maxBCR),
      assumptions: {
        ...scenario.assumptions,
        holdPeriodYears: 5,
        holdExitCapRate: 5.5,
        tenantLeaseTermMonths: 24,
      },
    };
    const allRenew = requiredSourceFields({
      ...baseHold,
      assumptions: {
        ...baseHold.assumptions,
        tenantRenewalProbability: 100,
      },
    });
    const allReplace = requiredSourceFields({
      ...baseHold,
      assumptions: {
        ...baseHold.assumptions,
        tenantRenewalProbability: 0,
      },
    });

    expect(allRenew).toEqual(
      expect.arrayContaining([
        "tenantRenewalProbability",
        "renewalRentAdjustmentRate",
        "renewalRentFreeMonths",
      ]),
    );
    expect(allRenew).not.toContain("replacementDowntimeMonths");
    expect(allReplace).toEqual(
      expect.arrayContaining([
        "tenantRenewalProbability",
        "replacementDowntimeMonths",
        "replacementRentFreeMonths",
        "replacementTenantImprovementPerSqM",
        "replacementLeasingCommissionRate",
      ]),
    );
    expect(allReplace).not.toContain("renewalRentAdjustmentRate");
  });

  it("does not certify a zero hold period or exit cap as verified hold terms", () => {
    expect(
      validateFinancialSource(validRecord("holdPeriodYears", 0)),
    ).toMatchObject({ valid: false });
    expect(
      validateFinancialSource(validRecord("holdExitCapRate", 0)),
    ).toMatchObject({ valid: false });
    expect(
      validateFinancialSource(validRecord("tenantLeaseTermMonths", 0)),
    ).toMatchObject({ valid: false });
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
