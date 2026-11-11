import { describe, expect, it } from "vitest";
import {
  buildAfterTaxDecisionSupport,
  type AfterTaxDecisionCandidate,
} from "@/lib/finance/after-tax-decision-support";
import {
  buildScenarioDecisionSupport,
  type ScenarioDecisionCandidate,
} from "@/lib/finance/scenario-decision-support";

function preTaxCandidate(
  id: string,
  patch: Partial<ScenarioDecisionCandidate> = {},
): ScenarioDecisionCandidate {
  return {
    id,
    viable: true,
    profit: 100,
    downsideProfit: 70,
    npv: 60,
    irr: 18,
    requiredEquity: 80,
    maxExposure: 130,
    durationMonths: 24,
    regulatoryScore: 90,
    fundingStatus: "unverified",
    ...patch,
  };
}

function afterTaxCandidate(
  scenarioId: string,
  status: AfterTaxDecisionCandidate["ledger"]["status"],
  profit: number | null,
  patch: Partial<AfterTaxDecisionCandidate> = {},
): AfterTaxDecisionCandidate {
  return {
    scenarioId,
    ledger: {
      status,
      strategy: "stabilized-sale",
      decisionGrade: status === "expert-confirmed",
      afterTaxProfitManwon: profit,
      npvManwon: profit == null ? null : profit - 10,
      irrPct: profit == null ? null : 15,
      afterTaxProfitUnroundedManwon: profit,
      npvUnroundedManwon: profit == null ? null : profit - 10,
      irrUnroundedPct: profit == null ? null : 15,
      irrStatus: profit == null ? "not-calculated" : "calculated",
      errors: [],
    },
    requiredEquityManwon: 80,
    maxExposureManwon: 130,
    durationMonths: 24,
    regulatoryScore: 90,
    ...patch,
  };
}

describe("after-tax decision support", () => {
  it("never mixes a complete draft into the expert-confirmed frontier", () => {
    const preTax = buildScenarioDecisionSupport([
      preTaxCandidate("CONFIRMED"),
      preTaxCandidate("DRAFT"),
    ]);
    const result = buildAfterTaxDecisionSupport({
      strategy: "stabilized-sale",
      preTaxDecisionSupport: preTax,
      candidates: [
        afterTaxCandidate("CONFIRMED", "expert-confirmed", 90),
        afterTaxCandidate("DRAFT", "draft", 1_000),
      ],
    });

    expect(result.confirmedParetoScenarioIds).toEqual(["CONFIRMED"]);
    expect(result.preliminaryParetoScenarioIds).toEqual(["DRAFT"]);
    expect(
      result.entries.find((entry) => entry.scenarioId === "DRAFT"),
    ).toMatchObject({ tier: "preliminary", status: "pareto" });
  });

  it("computes domination independently inside the confirmed tax tier", () => {
    const preTax = buildScenarioDecisionSupport([
      preTaxCandidate("BEST"),
      preTaxCandidate("LOW"),
    ]);
    const result = buildAfterTaxDecisionSupport({
      strategy: "stabilized-sale",
      preTaxDecisionSupport: preTax,
      candidates: [
        afterTaxCandidate("BEST", "expert-confirmed", 120),
        afterTaxCandidate("LOW", "expert-confirmed", 80),
      ],
    });

    expect(result.confirmedParetoScenarioIds).toEqual(["BEST"]);
    expect(
      result.entries.find((entry) => entry.scenarioId === "LOW"),
    ).toMatchObject({
      tier: "confirmed",
      status: "dominated",
      dominatedByScenarioIds: ["BEST"],
    });
  });

  it("excludes stale and incomplete ledgers from both frontiers", () => {
    const preTax = buildScenarioDecisionSupport([
      preTaxCandidate("STALE"),
      preTaxCandidate("INCOMPLETE"),
    ]);
    const result = buildAfterTaxDecisionSupport({
      strategy: "stabilized-sale",
      preTaxDecisionSupport: preTax,
      candidates: [
        afterTaxCandidate("STALE", "stale", null),
        afterTaxCandidate("INCOMPLETE", "incomplete", 100),
      ],
    });

    expect(result.confirmedParetoScenarioIds).toEqual([]);
    expect(result.preliminaryParetoScenarioIds).toEqual([]);
    expect(result.entries.map((entry) => entry.status)).toEqual([
      "not-ranked",
      "not-ranked",
    ]);
    expect(result.entries[0].reasons.join(" ")).toContain("재확인");
  });

  it("preserves pretax physical and funding exclusions", () => {
    const preTax = buildScenarioDecisionSupport([
      preTaxCandidate("VALID"),
      preTaxCandidate("LOSS", { profit: -1 }),
    ]);
    const result = buildAfterTaxDecisionSupport({
      strategy: "stabilized-sale",
      preTaxDecisionSupport: preTax,
      candidates: [
        afterTaxCandidate("VALID", "expert-confirmed", 90),
        afterTaxCandidate("LOSS", "expert-confirmed", 200),
      ],
    });

    expect(result.confirmedParetoScenarioIds).toEqual(["VALID"]);
    expect(
      result.entries.find((entry) => entry.scenarioId === "LOSS"),
    ).toMatchObject({ tier: "confirmed", status: "ineligible" });
  });
});

describe.each(["expert-confirmed", "draft"] as const)("unrounded after-tax comparison: %s", status => {
  function compare(candidates: AfterTaxDecisionCandidate[]) {
    const result = buildAfterTaxDecisionSupport({
      strategy: "stabilized-sale",
      preTaxDecisionSupport: buildScenarioDecisionSupport(candidates.map(value => preTaxCandidate(value.scenarioId))),
      candidates,
    });
    return {
      ...result,
      frontier: status === "expert-confirmed" ? result.confirmedParetoScenarioIds : result.preliminaryParetoScenarioIds,
      leaders: status === "expert-confirmed" ? result.confirmedObjectiveLeaders : result.preliminaryObjectiveLeaders,
    };
  }

  it.each(["afterTaxProfitUnroundedManwon", "npvUnroundedManwon"] as const)(
    "requires finite %s even when the display value is valid", field => {
      for (const value of [undefined, null, NaN, Infinity, -Infinity]) {
        const legacy = afterTaxCandidate("LEGACY", status, 100);
        legacy.ledger[field] = value;
        const result = compare([legacy]);
        expect(result.frontier).toEqual([]);
        expect(result.entries[0].status).toBe("ineligible");
        expect(result.entries[0].reasons.join(" ")).toContain("반올림 전");
        expect(result.warnings.join(" ")).toContain("정밀");
        expect(result.entries[0].metrics.afterTaxProfitManwon).toBe(100);
        expect(result.entries[0].metrics[field]).toBe(value);
      }
    },
  );

  it("excludes a raw -0.4 loss even when displayed profit is zero", () => {
    const loss = afterTaxCandidate("LOSS", status, 0);
    loss.ledger.afterTaxProfitUnroundedManwon = -0.4;
    const result = compare([loss, afterTaxCandidate("VALID", status, 100)]);
    expect(result.frontier).toEqual(["VALID"]);
    expect(result.entries.find(entry => entry.scenarioId === "LOSS")).toMatchObject({
      status: "ineligible", metrics: { afterTaxProfitManwon: 0, afterTaxProfitUnroundedManwon: -0.4 },
    });
    expect(result.entries.find(entry => entry.scenarioId === "LOSS")!.reasons.join(" ")).toContain("손실");
  });

  it("compares raw profit and NPV beneath equal rounded displays", () => {
    const low = afterTaxCandidate("LOW", status, 100);
    const high = afterTaxCandidate("HIGH", status, 100);
    Object.assign(low.ledger, { afterTaxProfitUnroundedManwon: 99.8, npvUnroundedManwon: 89.8 });
    Object.assign(high.ledger, { afterTaxProfitUnroundedManwon: 100.2, npvUnroundedManwon: 90.2 });
    for (const candidates of [[low, high], [high, low]]) {
      const result = compare(candidates);
      expect(result.frontier).toEqual(["HIGH"]);
      expect(result.leaders.find(leader => leader.objective === "after-tax-profit")?.bestValue).toBe(100.2);
      expect(result.leaders.find(leader => leader.objective === "after-tax-npv")?.bestValue).toBe(90.2);
      expect(result.entries.every(entry => entry.metrics.afterTaxProfitManwon === 100 && entry.metrics.npvManwon === 90)).toBe(true);
      expect(result.entries.find(entry => entry.scenarioId === "LOW")!.metrics).toMatchObject({
        afterTaxProfitUnroundedManwon: 99.8, npvUnroundedManwon: 89.8,
      });
      expect(result.entries.find(entry => entry.scenarioId === "HIGH")!.metrics).toMatchObject({
        afterTaxProfitUnroundedManwon: 100.2, npvUnroundedManwon: 90.2,
      });
    }
  });

  it("ranks raw IRR 10.04 above 9.95 while retaining display IRR 10 for both", () => {
    const low = afterTaxCandidate("LOW", status, 100);
    const high = afterTaxCandidate("HIGH", status, 100);
    Object.assign(low.ledger, { irrPct: 10, irrUnroundedPct: 9.95 });
    Object.assign(high.ledger, { irrPct: 10, irrUnroundedPct: 10.04 });
    for (const candidates of [[low, high], [high, low]]) {
      const result = compare(candidates);
      expect(result.frontier).toEqual(["HIGH"]);
      expect(result.leaders.find(leader => leader.objective === "after-tax-irr"))
        .toMatchObject({ scenarioIds: ["HIGH"], bestValue: 10.04 });
      expect(result.entries.every(entry => entry.metrics.irrPct === 10)).toBe(true);
      expect(result.entries.find(entry => entry.scenarioId === "LOW")!.metrics.irrUnroundedPct).toBe(9.95);
      expect(result.entries.find(entry => entry.scenarioId === "HIGH")!.metrics.irrUnroundedPct).toBe(10.04);
    }
  });

  it("does not substitute displayed IRR when the raw IRR is missing or invalid", () => {
    for (const raw of [undefined, null, NaN, Infinity, -Infinity]) {
      const unknown = afterTaxCandidate("UNKNOWN", status, 200);
      Object.assign(unknown.ledger, { irrPct: 50, irrUnroundedPct: raw });
      const known = afterTaxCandidate("KNOWN", status, 100);
      Object.assign(known.ledger, { irrPct: 30, irrUnroundedPct: 30 });
      const result = compare([unknown, known]);
      expect([...result.frontier].sort()).toEqual(["KNOWN", "UNKNOWN"]);
      expect(result.leaders.find(leader => leader.objective === "after-tax-irr"))
        .toMatchObject({ scenarioIds: ["KNOWN"], bestValue: 30 });
      expect(result.entries.find(entry => entry.scenarioId === "UNKNOWN")!.advisoryReasons.join(" ")).toContain("IRR");
      expect(result.entries.find(entry => entry.scenarioId === "UNKNOWN")!.metrics.irrUnroundedPct).toBe(raw ?? null);
      expect(result.warnings.join(" ")).toContain("IRR");
    }
  });

  it.each(["ambiguous", "not-calculated"] as const)("keeps %s IRR unavailable even with a numeric raw field", irrStatus => {
    const unknown = afterTaxCandidate("UNKNOWN", status, 200);
    Object.assign(unknown.ledger, { irrStatus, irrPct: 50, irrUnroundedPct: 50 });
    const result = compare([unknown, afterTaxCandidate("KNOWN", status, 100)]);
    expect([...result.frontier].sort()).toEqual(["KNOWN", "UNKNOWN"]);
    expect(result.leaders.find(leader => leader.objective === "after-tax-irr")?.scenarioIds).toEqual(["KNOWN"]);
    expect(result.entries.find(entry => entry.scenarioId === "UNKNOWN")!.metrics.irrPct).toBeNull();
    expect(result.entries.find(entry => entry.scenarioId === "UNKNOWN")!.metrics.irrUnroundedPct).toBeNull();
  });
});
