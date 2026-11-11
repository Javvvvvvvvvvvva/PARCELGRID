import { calculateScenario, CONST_COST_RANGE, FIXED_FULL_QUOTE_COST_REASON, type CalcInput } from "./scenario";
import { PROJECT_LEDGER_MODEL_VERSION } from "./project-ledger";
import { D } from "./math";
import type { ScenarioResult } from "./types";
import { calculatedValueMatches } from "./calculation-match";

export const CONSTRUCTION_COST_SENSITIVITY_VERSION = "construction-cost-ledger-2026.2" as const;

type CostCaseResult = Pick<ScenarioResult,
  "hardCost" | "softCost" | "contingency" | "interestCost" | "pfFee" | "trustFee" |
  "financingCost" | "totalCost" | "totalRevenue" | "profit" | "irr" | "irrStatus" |
  "npv" | "funding" | "maxExposure" | "totalMonths" | "equityCashFlowsManwon" |
  "profitUnroundedManwon" | "npvUnroundedManwon" | "irrUnroundedPct"
>;

interface CalculatedCostCase {
  multiplier: number;
  unitCostPerSqmWon: number;
  status: "calculated";
  result: CostCaseResult;
}
export type ConstructionCostCase = CalculatedCostCase | {
  multiplier: number;
  unitCostPerSqmWon: number;
  status: "unavailable";
  reason: string;
};
export interface ConstructionCostSensitivity {
  modelVersion: typeof CONSTRUCTION_COST_SENSITIVITY_VERSION;
  ledgerModelVersion: typeof PROJECT_LEDGER_MODEL_VERSION;
  method: "base-unit-rate";
  low: ConstructionCostCase;
  base: CalculatedCostCase;
  high: ConstructionCostCase;
}

function summarize(result: ScenarioResult): CostCaseResult {
  return {
    hardCost: result.hardCost, softCost: result.softCost, contingency: result.contingency,
    interestCost: result.interestCost, pfFee: result.pfFee, trustFee: result.trustFee,
    financingCost: result.financingCost, totalCost: result.totalCost, totalRevenue: result.totalRevenue,
    profit: result.profit, irr: result.irr, irrStatus: result.irrStatus, npv: result.npv,
    funding: result.funding, maxExposure: result.maxExposure, totalMonths: result.totalMonths,
    equityCashFlowsManwon: result.equityCashFlowsManwon,
    profitUnroundedManwon: result.profitUnroundedManwon,
    npvUnroundedManwon: result.npvUnroundedManwon,
    irrUnroundedPct: result.irrUnroundedPct,
  };
}

/** Only final project comparisons pay for three ledgers; iterative solvers use calculateScenario. */
export function calculateScenarioWithCostSensitivity(input: CalcInput): ScenarioResult & {
  constructionCostSensitivity: ConstructionCostSensitivity;
} {
  const base = calculateScenario(input);
  const baseRate = input.scenario.assumptions.constCostPerSqM;
  const stress = (multiplier: number): ConstructionCostCase => {
    const unitCostPerSqmWon = D(baseRate).times(multiplier).toNumber();
    if (input.scenario.program.areaContract?.fullQuoteCost !== undefined) {
      return { multiplier, unitCostPerSqmWon, status: "unavailable", reason: FIXED_FULL_QUOTE_COST_REASON };
    }
    try {
      const result = calculateScenario({ ...input, scenario: { ...input.scenario,
        assumptions: { ...input.scenario.assumptions, constCostPerSqM: unitCostPerSqmWon },
      } });
      return { multiplier, unitCostPerSqmWon, status: "calculated", result: summarize(result) };
    } catch {
      // An unsupported stress input must not erase a valid baseline or become a zero/fallback profit.
      return { multiplier, unitCostPerSqmWon, status: "unavailable",
        reason: "변경 공사단가가 입력 한도 또는 원가 계약을 충족하지 않아 월별 계산을 완료하지 못했습니다." };
    }
  };
  const low = stress(CONST_COST_RANGE.low), high = stress(CONST_COST_RANGE.high);
  return {
    ...base,
    constructionCostSensitivity: {
      modelVersion: CONSTRUCTION_COST_SENSITIVITY_VERSION,
      ledgerModelVersion: PROJECT_LEDGER_MODEL_VERSION, method: "base-unit-rate",
      low, base: { multiplier: 1, unitCostPerSqmWon: baseRate, status: "calculated", result: summarize(base) }, high,
    },
    // Compatibility fields are derived from the monthly calculation, never approximated.
    profitAtLowCost: low.status === "calculated" ? low.result.profit : undefined,
    profitAtHighCost: high.status === "calculated" ? high.result.profit : undefined,
    constructionCostLow: low.status === "calculated" ? low.result.hardCost : undefined,
    constructionCostHigh: high.status === "calculated" ? high.result.hardCost : undefined,
  };
}

/** Recompute saved stress results against the current raw parcel and scenario. No legacy fallback. */
export function verifiedConstructionCostSensitivity(input: CalcInput, stored: unknown): ConstructionCostSensitivity | null {
  if (!stored || typeof stored !== "object" ||
      (stored as { modelVersion?: unknown }).modelVersion !== CONSTRUCTION_COST_SENSITIVITY_VERSION) return null;
  try {
    const expected = calculateScenarioWithCostSensitivity(input).constructionCostSensitivity;
    return calculatedValueMatches(stored, expected) ? expected : null;
  } catch {
    return null;
  }
}
