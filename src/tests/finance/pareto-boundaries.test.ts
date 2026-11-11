import { describe, expect, it } from "vitest";
import {
  buildScenarioDecisionSupport, SCENARIO_DECISION_MODEL_VERSION, type ScenarioDecisionCandidate,
} from "@/lib/finance/scenario-decision-support";
import {
  buildAfterTaxDecisionSupport, AFTER_TAX_DECISION_MODEL_VERSION, type AfterTaxDecisionCandidate,
} from "@/lib/finance/after-tax-decision-support";

const modes = ["pretax", "after-tax-confirmed", "after-tax-preliminary"] as const;
type Mode = typeof modes[number];
type Candidate = ScenarioDecisionCandidate;

function candidate(id: string, patch: Partial<Candidate> = {}): Candidate {
  return {
    id, viable: true, profit: 100, downsideProfit: 70, npv: 60, irr: 18,
    requiredEquity: 80, maxExposure: 130, durationMonths: 24,
    regulatoryScore: 90, fundingStatus: "funded", ...patch,
  };
}

function permutations<T>(values: T[]): T[][] {
  if (!values.length) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, other) => index !== other))
    .map(rest => [value, ...rest]));
}

function afterTax(value: Candidate, mode: Exclude<Mode, "pretax">): AfterTaxDecisionCandidate {
  return {
    scenarioId: value.id,
    ledger: {
      status: mode === "after-tax-confirmed" ? "expert-confirmed" : "draft",
      strategy: "stabilized-sale", decisionGrade: mode === "after-tax-confirmed",
      afterTaxProfitManwon: value.profit, afterTaxProfitUnroundedManwon: value.profit,
      npvManwon: value.npv, npvUnroundedManwon: value.npv,
      irrPct: value.irr, irrUnroundedPct: value.irr,
      irrStatus: value.irr === null ? "not-calculated" : "calculated", errors: [],
    },
    requiredEquityManwon: value.requiredEquity, maxExposureManwon: value.maxExposure,
    durationMonths: value.durationMonths, regulatoryScore: value.regulatoryScore,
  };
}

function compare(mode: Mode, candidates: Candidate[]) {
  if (mode === "pretax") {
    const result = buildScenarioDecisionSupport(candidates);
    return {
      frontier: result.paretoScenarioIds, leaders: result.objectiveLeaders,
      entries: result.entries.map(entry => ({
        id: entry.scenarioId, status: entry.status, reasons: entry.exclusionReasons,
        advisory: entry.advisoryReasons, dominatedBy: entry.dominatedByScenarioIds,
      })),
      warnings: result.warnings,
    };
  }
  // Keep the after-tax comparison independent of pretax ranking and its IRR.
  const result = buildAfterTaxDecisionSupport({
    strategy: "stabilized-sale",
    preTaxDecisionSupport: buildScenarioDecisionSupport(candidates.map(value => candidate(value.id))),
    candidates: candidates.map(value => afterTax(value, mode)),
  });
  const confirmed = mode === "after-tax-confirmed";
  return {
    frontier: confirmed ? result.confirmedParetoScenarioIds : result.preliminaryParetoScenarioIds,
    leaders: (confirmed ? result.confirmedObjectiveLeaders : result.preliminaryObjectiveLeaders)
      .map(leader => ({ ...leader, objective: leader.objective.replace("after-tax-", "") })),
    entries: result.entries.map(entry => ({
      id: entry.scenarioId, status: entry.status, reasons: entry.reasons,
      advisory: entry.advisoryReasons, dominatedBy: entry.dominatedByScenarioIds,
    })),
    warnings: result.warnings,
  };
}

const cycle = () => [
  candidate("A", { profit: 2e-6, npv: 0, irr: 1e-6 }),
  candidate("B", { profit: 1e-6, npv: 2e-6, irr: 0 }),
  candidate("C", { profit: 0, npv: 1e-6, irr: 2e-6 }),
];
const nearTies = () => [
  candidate("A", { profit: 0, npv: 20, requiredEquity: 300 }),
  candidate("B", { profit: 0.75e-6, npv: 10, requiredEquity: 200 }),
  candidate("C", { profit: 1.5e-6, npv: 0, requiredEquity: 100 }),
];

describe.each(modes)("Pareto boundaries: %s", mode => {
  it("preserves genuine all-axis domination in either order", () => {
    const values = [candidate("LOW"), candidate("BEST", {
      profit: 200, downsideProfit: 100, npv: 100, irr: 30,
      requiredEquity: 60, maxExposure: 100, durationMonths: 18, regulatoryScore: 95,
    })];
    for (const ordered of permutations(values)) {
      const result = compare(mode, ordered);
      expect(result.frontier).toEqual(["BEST"]);
      expect(result.entries.find(entry => entry.id === "LOW"))
        .toMatchObject({ status: "dominated", dominatedBy: ["BEST"], reasons: [] });
    }
  });

  it("keeps ordinary profit/IRR tradeoffs", () => {
    for (const ordered of permutations([
      candidate("PROFIT", { profit: 200, npv: 100, irr: 10 }), candidate("IRR", { irr: 30 }),
    ])) {
      const result = compare(mode, ordered);
      expect([...result.frontier].sort()).toEqual(["IRR", "PROFIT"]);
      expect(result.leaders.find(leader => leader.objective === "irr"))
        .toMatchObject({ bestValue: 30, scenarioIds: ["IRR"] });
    }
  });

  it.each([null, NaN, Infinity, -Infinity])("keeps known IRR alternatives when another IRR is %s", irr => {
    const values = [candidate("UNKNOWN", { profit: 200, npv: 100, irr }),
      candidate("HIGH_IRR", { profit: 100, npv: 60, irr: 30 }),
      candidate("LOW_IRR", { profit: 210, npv: 95, irr: 10 })];
    for (const ordered of permutations(values)) {
      const result = compare(mode, ordered);
      expect([...result.frontier].sort()).toEqual(["HIGH_IRR", "LOW_IRR", "UNKNOWN"]);
      expect(result.leaders.find(leader => leader.objective === "irr"))
        .toMatchObject({ bestValue: 30, scenarioIds: ["HIGH_IRR"] });
      expect(result.entries.find(entry => entry.id === "UNKNOWN")!.advisory.join(" ")).toContain("IRR");
      expect(result.warnings.join(" ")).toContain("IRR");
    }
  });

  it("still compares shared metrics when both IRRs are missing", () => {
    for (const ordered of permutations([
      candidate("BEST", { profit: 200, irr: null }), candidate("LOW", { irr: null }),
    ])) {
      const result = compare(mode, ordered);
      expect(result.frontier).toEqual(["BEST"]);
      expect(result.leaders.find(leader => leader.objective === "irr"))
        .toMatchObject({ bestValue: null, scenarioIds: [] });
    }
  });

  it("retains all eligible candidates in the former epsilon cycle across permutations", () => {
    for (const ordered of permutations(cycle())) {
      const result = compare(mode, ordered);
      expect([...result.frontier].sort()).toEqual(["A", "B", "C"]);
      expect(result.entries.every(entry => entry.status === "pareto" && entry.dominatedBy.length === 0)).toBe(true);
    }
  });

  it("does not hide even a small disadvantage on a minimized axis", () => {
    for (const ordered of permutations([
      candidate("PROFIT", { profit: 200, requiredEquity: 80 + 0.5e-6 }), candidate("CAPITAL"),
    ])) {
      expect([...compare(mode, ordered).frontier].sort()).toEqual(["CAPITAL", "PROFIT"]);
    }
  });

  it("requires an improvement beyond tolerance for strict domination", () => {
    for (const ordered of permutations([
      candidate("A"), candidate("B", { profit: 100 + 0.5e-6 }),
    ])) {
      expect([...compare(mode, ordered).frontier].sort()).toEqual(["A", "B"]);
    }
  });

  it("anchors leader ties to the true maximum in every permutation", () => {
    for (const ordered of permutations(nearTies())) {
      const result = compare(mode, ordered);
      const leader = result.leaders.find(leader => leader.objective === "profit")!;
      expect([...result.frontier].sort()).toEqual(["A", "B", "C"]);
      expect(leader.bestValue).toBe(1.5e-6);
      expect([...leader.scenarioIds].sort()).toEqual(["B", "C"]);
    }
  });

  it("anchors leader ties to the true minimum in every permutation", () => {
    const values = [candidate("A", { requiredEquity: 0, profit: 0 }),
      candidate("B", { requiredEquity: 0.75e-6, profit: 10 }),
      candidate("C", { requiredEquity: 1.5e-6, profit: 20 })];
    for (const ordered of permutations(values)) {
      const result = compare(mode, ordered);
      const leader = result.leaders.find(leader => leader.objective === "required-equity")!;
      expect([...result.frontier].sort()).toEqual(["A", "B", "C"]);
      expect(leader.bestValue).toBe(0);
      expect([...leader.scenarioIds].sort()).toEqual(["A", "B"]);
    }
  });

  it("keeps a nonempty acyclic frontier on a bounded 36-point availability/epsilon grid", () => {
    const values: Candidate[] = [];
    for (const profit of [0, 1e-6, 2e-6]) for (const npv of [0, 1e-6, 2e-6]) {
      for (const irr of [null, 0, 1e-6, 2e-6]) values.push(candidate(String(values.length), { profit, npv, irr }));
    }
    let expectedFrontier: string[] | undefined;
    for (const ordered of [values, [...values].reverse(), [...values.slice(12), ...values.slice(0, 12)]]) {
      const result = compare(mode, ordered);
      expect(result.frontier.length).toBeGreaterThan(0);
      const frontier = [...result.frontier].sort();
      if (expectedFrontier) expect(frontier).toEqual(expectedFrontier);
      else expectedFrontier = frontier;
      const edges = new Map(result.entries.map(entry => [entry.id, entry.dominatedBy]));
      const active = new Set<string>(), visited = new Set<string>();
      const visit = (id: string): boolean => {
        if (active.has(id)) return false;
        if (visited.has(id)) return true;
        active.add(id);
        for (const other of edges.get(id) ?? []) if (!visit(other)) return false;
        active.delete(id); visited.add(id);
        return true;
      };
      expect(result.entries.every(entry => visit(entry.id))).toBe(true);
    }
  });
});

describe("pretax focus boundaries", () => {
  it("uses exact lexicographic focus independent of candidate order", () => {
    for (const ordered of permutations(nearTies())) {
      expect(buildScenarioDecisionSupport(ordered)).toMatchObject({ focusScenarioId: "C", focusMode: "highest-profit" });
    }
  });

  it("breaks exact metric ties by stable ID", () => {
    for (const ordered of permutations([candidate("C"), candidate("A"), candidate("B")])) {
      expect(buildScenarioDecisionSupport(ordered).focusScenarioId).toBe("A");
    }
  });

  it("selects an eligible cycle candidate before a higher-profit funding shortfall", () => {
    for (const ordered of permutations(cycle())) {
      const result = buildScenarioDecisionSupport([
        ...ordered, candidate("BLOCKED", { profit: 1_000, fundingStatus: "shortfall" }),
      ]);
      expect(result.focusScenarioId).toBe("A");
      expect(result.focusMode).toBe("highest-profit");
      expect(result.entries.find(entry => entry.scenarioId === result.focusScenarioId)?.status).toBe("pareto");
    }
  });

  it("retains explicit selection and its eligibility warning", () => {
    const result = buildScenarioDecisionSupport([
      ...cycle(), candidate("BLOCKED", { profit: 1_000, fundingStatus: "shortfall" }),
    ], "BLOCKED");
    expect(result.focusScenarioId).toBe("BLOCKED");
    expect(result.focusMode).toBe("explicit-selection");
    expect(result.entries.find(entry => entry.scenarioId === "BLOCKED")?.status).toBe("ineligible");
    expect(result.warnings.some(warning => warning.includes("사용자가 선택"))).toBe(true);
  });
});

it("versions the changed comparison semantics", () => {
  expect(SCENARIO_DECISION_MODEL_VERSION).toBe("scenario-decision-pareto-2026.5");
  expect(AFTER_TAX_DECISION_MODEL_VERSION).toBe("after-tax-decision-pareto-2026.2");
});
