import type { ScenarioResult } from "./types";

type AnnualIrrResult = Pick<ScenarioResult, "irrStatus" | "irrUnroundedPct">;

/** Older display-only results cannot establish a return threshold. */
export function calculatedAnnualIrr(result: AnnualIrrResult): number | null {
  const value = result.irrUnroundedPct;
  return result.irrStatus === "calculated" &&
    typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

export function meetsIrrTarget(result: AnnualIrrResult, target: number): boolean {
  const value = calculatedAnnualIrr(result);
  return value !== null && Number.isFinite(target) && value >= target;
}
