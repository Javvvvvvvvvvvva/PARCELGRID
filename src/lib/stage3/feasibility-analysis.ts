import { calculateScenario } from "@/lib/finance/scenario";
import type { AssumptionSet, Parcel, Scenario } from "@/lib/finance/types";

export const STAGE3_REVENUE_STEPS = [-10, -5, 0, 5, 10] as const;
export const STAGE3_COST_STEPS = [-10, -5, 0, 10, 20] as const;

export interface Stage3SensitivityCell {
  profit: number;
  irr: number;
}

export interface Stage3Sensitivity {
  rows: Stage3SensitivityCell[][];
  revenueLabel: string;
  revenueSteps: typeof STAGE3_REVENUE_STEPS;
  costSteps: typeof STAGE3_COST_STEPS;
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
  const saleDriven = scenario.program.mix.residentialSale > 0;
  const revenueField: keyof AssumptionSet = saleDriven
    ? "salePricePerSqM"
    : "rentPerSqMMonth";
  const baseRevenue = scenario.assumptions[revenueField];
  const baseCost = scenario.assumptions.constCostPerSqM;

  const rows = STAGE3_COST_STEPS.map((costDelta) =>
    STAGE3_REVENUE_STEPS.map((revenueDelta) => {
      const assumptions = {
        ...scenario.assumptions,
        [revenueField]: baseRevenue * (1 + revenueDelta / 100),
        constCostPerSqM: baseCost * (1 + costDelta / 100),
      };
      const result = calculateScenario({
        parcel,
        scenario: { ...scenario, assumptions },
      });
      return { profit: result.profit, irr: result.irr };
    })
  );

  return {
    rows,
    revenueLabel: saleDriven ? "매각·분양 단가" : "임대료",
    revenueSteps: STAGE3_REVENUE_STEPS,
    costSteps: STAGE3_COST_STEPS,
  };
}

/** Find the revenue input where the active pro forma reaches zero profit. */
export function findStage3BreakEvenRevenuePrice(
  parcel: Parcel,
  scenario: Scenario
): Stage3BreakEvenPrice {
  const saleDriven = scenario.program.mix.residentialSale > 0;
  const kind = saleDriven ? ("sale" as const) : ("rent" as const);
  const field: keyof AssumptionSet = saleDriven
    ? "salePricePerSqM"
    : "rentPerSqMMonth";
  const current = scenario.assumptions[field];
  let lo = 0;
  let hi = Math.max(1, current * 4);

  const profitAt = (value: number) =>
    calculateScenario({
      parcel,
      scenario: {
        ...scenario,
        assumptions: { ...scenario.assumptions, [field]: value },
      },
    }).profit;

  if (profitAt(hi) < 0) {
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
    if (profitAt(mid) >= 0) hi = mid;
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
