import { describe, expect, it } from "vitest";
import { calculateScenario } from "@/lib/finance/scenario";
import { annualizeIRR, D, irr, npv, toManWon, toPct } from "@/lib/finance/math";
import { buildAfterTaxLedger, createDraftExpertTaxContract } from "@/lib/finance/after-tax-ledger";
import { precisionFixture } from "@/tests/helpers/finance-precision-fixture";

function basisFor(input: ReturnType<typeof precisionFixture>, result: ReturnType<typeof calculateScenario>) {
  return {
    projectId: input.parcel.id, scenarioId: input.scenario.id, strategy: "stabilized-sale" as const,
    preTaxEquityCashFlowsManwon: result.equityCashFlowsManwon,
    preTaxAcquisitionTaxManwon: result.acquisitionTax,
    equityHurdleRatePct: input.scenario.assumptions.equityIRR,
  };
}

describe("scenario cash-flow precision", () => {
  for (const months of [14, 36, 120]) {
    it.each([2_300_001, 2_300_211, 2_302_347])(`preserves zero-tax identity for ${months} construction months and cost %s`, (cost) => {
      const input = precisionFixture({ constructionMonths: months, constCostPerSqM: cost });
      const result = calculateScenario(input);
      const basis = basisFor(input, result);
      const contract = createDraftExpertTaxContract(basis);
      contract.assessments = contract.assessments.map((item) => ({
        ...item,
        assessmentStatus: item.category === "acquisition-tax-in-ledger" ? "confirmed" : "not-applicable",
        note: "Synthetic zero incremental tax identity, not expert tax advice",
      }));
      const after = buildAfterTaxLedger({ ...basis, contract });
      expect(after.status).toBe("draft");
      expect(after.decisionGrade).toBe(false);
      expect(after.netIncrementalTaxManwon).toBe(0);
      expect(after.afterTaxProfitManwon).toBe(result.profit);
      expect(after.npvManwon).toBe(result.npv);
      expect(after.irrPct).toBe(result.irr);
      expect(after.rows.map((row) => row.afterTaxEquityCashFlow)).toEqual(result.equityCashFlowsManwon);
      expect(result.equityCashFlowsManwon.some((flow) => !Number.isInteger(flow))).toBe(true);

      const sum = result.equityCashFlowsManwon.reduce((total, flow) => total.plus(D(flow)), D(0));
      const monthlyHurdle = Math.pow(1 + basis.equityHurdleRatePct / 100, 1 / 12) - 1;
      expect(result.profitUnroundedManwon).toBeCloseTo(sum.toNumber(), 8);
      expect(result.npvUnroundedManwon).toBe(npv(monthlyHurdle, result.equityCashFlowsManwon).toNumber());
      const annual = annualizeIRR(irr(result.equityCashFlowsManwon, 0.01)!, 12).times(100);
      expect(result.irrUnroundedPct).toBe(annual.toNumber());
      expect(result.profit).toBe(toManWon(D(result.profitUnroundedManwon!)));
      expect(result.npv).toBe(toManWon(D(result.npvUnroundedManwon!)));
      expect(result.irr).toBe(toPct(annual));
    });
  }

  it("requires a new tax basis when a legacy rounded series differs from the raw series", () => {
    const input = precisionFixture({ constCostPerSqM: 2_300_001 });
    const result = calculateScenario(input);
    const basis = basisFor(input, result);
    const roundedFlows = result.equityCashFlowsManwon.map((flow) => toManWon(D(flow)));
    const contract = createDraftExpertTaxContract({ ...basis, preTaxEquityCashFlowsManwon: roundedFlows });
    const original = structuredClone(contract);
    const after = buildAfterTaxLedger({ ...basis, contract });
    expect(after.status).toBe("stale");
    expect(after.decisionGrade).toBe(false);
    expect(after.afterTaxProfitManwon).toBeNull();
    expect(after.calculationBasisFingerprint).not.toBe(after.contractBasisFingerprint);
    expect(contract).toEqual(original);
    expect(contract.calculationBasis.preTaxEquityCashFlowsManwon).toEqual(roundedFlows);
  });

  it("does not expose zero as raw IRR when no IRR can be calculated", () => {
    const result = calculateScenario(precisionFixture({ salePricePerSqM: 0 }));
    expect(result.irrStatus).toBe("not-calculated");
    expect(result.irrUnroundedPct).toBeUndefined();
    expect(result.irr).toBe(0);
    expect(Number.isFinite(result.profitUnroundedManwon)).toBe(true);
    expect(Number.isFinite(result.npvUnroundedManwon)).toBe(true);
  });

  it("preserves a fractional loss and negative NPV when both displays round to zero", () => {
    const result = calculateScenario(precisionFixture({
      constCostPerSqM: 0, interestRate: 0, equityIRR: 0,
    }, 300_000.4));
    expect(Math.abs(result.profit)).toBe(0);
    expect(Math.abs(result.npv)).toBe(0);
    expect(result.profitUnroundedManwon).toBeCloseTo(-0.4, 8);
    expect(result.npvUnroundedManwon).toBeCloseTo(-0.4, 8);
    expect(result.irrStatus).toBe("calculated");
    expect(result.irrUnroundedPct).toBeLessThan(0);
  });
});
