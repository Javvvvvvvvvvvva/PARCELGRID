import { calculateScenario, FIXED_FULL_QUOTE_COST_REASON } from "@/lib/finance/scenario";
import {
  blendedRevenueUnitPrice,
  revenuePricingKindForScenario,
  withScenarioRevenueUnitPrice,
} from "@/lib/finance/revenue-contract";
import type { Parcel, Scenario } from "@/lib/finance/types";

export const STAGE3_REVENUE_STEPS = [-10, -5, 0, 5, 10] as const;
export const STAGE3_COST_STEPS = [-10, -5, 0, 10, 20] as const;

export interface Stage3SensitivityCell {
  profit: number;
  profitUnroundedManwon: number | null;
  irr: number;
  irrStatus?: "calculated" | "not-calculated" | "ambiguous";
}

export interface Stage3Sensitivity {
  rows: Stage3SensitivityCell[][];
  revenueLabel: string;
  revenueSteps: typeof STAGE3_REVENUE_STEPS;
  costSteps: readonly number[];
  costStressUnavailableReason?: string;
}

export interface Stage3BreakEvenPrice {
  kind: "sale" | "rent";
  label: string;
  current: number;
  value: number | null;
  marginPct: number | null;
}

/**
 * Two-way stress test for the two inputs that dominate early feasibility:
 * exit revenue and hard construction cost. The center cell must equal the
 * active pro forma exactly.
 */
export function buildStage3Sensitivity(
  parcel: Parcel,
  scenario: Scenario
): Stage3Sensitivity {
  const revenueKind = revenuePricingKindForScenario(scenario);
  const saleDriven = revenueKind === "sale";
  const baseRevenue = blendedRevenueUnitPrice(scenario, revenueKind);
  const baseCost = scenario.assumptions.constCostPerSqM;
  const fixedQuote = scenario.program.areaContract?.fullQuoteCost !== undefined;
  const costSteps = fixedQuote ? [0] : STAGE3_COST_STEPS;

  const rows = costSteps.map((costDelta) =>
    STAGE3_REVENUE_STEPS.map((revenueDelta) => {
      const pricedScenario = withScenarioRevenueUnitPrice(
        scenario,
        revenueKind,
        baseRevenue * (1 + revenueDelta / 100),
      );
      const assumptions = {
        ...pricedScenario.assumptions,
        constCostPerSqM: baseCost * (1 + costDelta / 100),
      };
      const result = calculateScenario({
        parcel,
        scenario: { ...pricedScenario, assumptions },
      });
      return {
        profit: result.profit,
        profitUnroundedManwon: Number.isFinite(result.profitUnroundedManwon)
          ? result.profitUnroundedManwon! : null,
        irr: result.irr,
        irrStatus: result.irrStatus,
      };
    })
  );

  return {
    rows,
    revenueLabel: saleDriven ? "매각·분양 단가" : "임대료",
    revenueSteps: STAGE3_REVENUE_STEPS,
    costSteps,
    ...(fixedQuote ? { costStressUnavailableReason: FIXED_FULL_QUOTE_COST_REASON } : {}),
  };
}

/** Find the revenue input where the active pro forma reaches zero profit. */
export function findStage3BreakEvenRevenuePrice(
  parcel: Parcel,
  scenario: Scenario
): Stage3BreakEvenPrice {
  const revenueKind = revenuePricingKindForScenario(scenario);
  const saleDriven = revenueKind === "sale";
  const kind = saleDriven ? ("sale" as const) : ("rent" as const);
  const current = blendedRevenueUnitPrice(scenario, revenueKind);
  let lo = 0;
  let hi = Math.max(1, current * 4);

  const profitAt = (value: number) =>
    calculateScenario({
      parcel,
      scenario: withScenarioRevenueUnitPrice(scenario, revenueKind, value),
    }).profitUnroundedManwon;

  const upperProfit = profitAt(hi);
  if (!Number.isFinite(upperProfit) || upperProfit! < 0) {
    return {
      kind,
      label: saleDriven ? "매각 단가" : "임대료",
      current,
      value: null,
      marginPct: null,
    };
  }

  for (let i = 0; i < 36; i += 1) {
    const mid = (lo + hi) / 2;
    const profit = profitAt(mid);
    if (!Number.isFinite(profit)) {
      return { kind, label: saleDriven ? "매각 단가" : "임대료", current, value: null, marginPct: null };
    }
    if (profit! >= 0) hi = mid;
    else lo = mid;
  }

  const value = hi;
  return {
    kind,
    label: saleDriven ? "매각 단가" : "임대료",
    current,
    value,
    marginPct: value > 0 ? ((current - value) / value) * 100 : null,
  };
}
