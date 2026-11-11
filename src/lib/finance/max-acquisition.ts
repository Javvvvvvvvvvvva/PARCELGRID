import { calculateScenario } from "./scenario";
import { calculatedAnnualIrr, meetsIrrTarget } from "./return-metrics";
import type { Parcel, Scenario, ScenarioResult, ManWon, Pct } from "./types";

type FundingStatus = ScenarioResult["funding"]["status"];
type IrrStatus = NonNullable<ScenarioResult["irrStatus"]>;

export type MaxAcquisitionStatus =
  | "bracketed"
  | "search-limited"
  | "no-candidate"
  | "invalid";

export type MaxAcquisitionStopReason =
  | "tolerance"
  | "expansion-limit"
  | "iteration-limit"
  | "no-feasible-candidate"
  | "invalid-input"
  | "calculation-unavailable"
  | "candidate-recheck-failed";

export interface MaxAcquisitionResult {
  scenarioId: string;
  targetIRR: Pct;
  status: MaxAcquisitionStatus;
  stopReason: MaxAcquisitionStopReason;
  /** A rechecked integer candidate, not a global maximum when search-limited. */
  maxLandCost: ManWon | null;
  /** Unrounded annual IRR evaluated at exactly maxLandCost. */
  achievedIRR: Pct | null;
  marketGap: ManWon | null;
  /** Eligibility of the explicit current-price probe; null means unavailable. */
  feasible: boolean | null;
  marketIRR: Pct | null;
  marketIRRStatus: IrrStatus | null;
  marketFundingStatus: FundingStatus | null;
  fundingStatus: FundingStatus | null;
  /** Evaluated feasible/ineligible integer bounds; unavailable bounds are null. */
  lowerBound: ManWon | null;
  upperBound: ManWon | null;
  iterations: number;
  expansions: number;
}

export interface ScenarioMaxAcquisition {
  scenarioId: string;
  scenarioName: string;
  marketPrice: ManWon;
  /** Unrounded annual IRR, or null when it cannot be established. */
  marketIRR: Pct | null;
  marketIRRStatus: IrrStatus | null;
  marketFundingStatus: FundingStatus | null;
  results: MaxAcquisitionResult[];
}

export const DEFAULT_IRR_TARGETS: Pct[] = [10, 15, 20];

interface Probe {
  price: ManWon;
  result: ScenarioResult | null;
  irr: Pct | null;
  eligible: boolean | null;
}

function acquisitionEligibility(result: ScenarioResult, target: Pct): boolean | null {
  if (result.viable === false || result.funding.status === "shortfall") return false;
  if (result.viable !== true ||
      !["funded", "unverified"].includes(result.funding.status) ||
      calculatedAnnualIrr(result) === null) return null;
  return meetsIrrTarget(result, target);
}

/** Bounded integer search. Unknown calculations never establish an upper bound. */
export function findMaxLandCostForIRR(
  parcel: Parcel,
  scenario: Scenario,
  targetIRR: Pct,
  options: { maxIterations?: number; tolerance?: number; maxExpansions?: number } = {},
): MaxAcquisitionResult {
  const { maxIterations = 18, tolerance = 1, maxExpansions = 3 } = options;
  const marketPrice = parcel.acquiredPrice;
  const state: { best: Probe | null; upper: number | null; market: Probe | null } = {
    best: null, upper: null, market: null,
  };
  let iterations = 0;
  let expansions = 0;

  function probe(price: number): Probe {
    try {
      const result = calculateScenario({ parcel: { ...parcel, acquiredPrice: price }, scenario });
      return { price, result, irr: calculatedAnnualIrr(result), eligible: acquisitionEligibility(result, targetIRR) };
    } catch {
      return { price, result: null, irr: null, eligible: null };
    }
  }

  function retain(candidate: Probe): void {
    if (candidate.eligible && Number.isSafeInteger(candidate.price) &&
        (state.best === null || candidate.price > state.best.price)) {
      state.best = candidate;
    }
  }

  function finish(status: MaxAcquisitionStatus, stopReason: MaxAcquisitionStopReason): MaxAcquisitionResult {
    // Keep the published price and its metrics bound to the same final evaluation.
    if (state.best !== null) {
      const checked = probe(state.best.price);
      if (checked.eligible !== true) {
        state.best = null;
        status = "invalid";
        stopReason = "candidate-recheck-failed";
      } else {
        state.best = checked;
      }
    }
    return {
      scenarioId: scenario.id,
      targetIRR,
      status,
      stopReason,
      maxLandCost: state.best?.price ?? null,
      achievedIRR: state.best?.irr ?? null,
      marketGap: state.best === null ? null : state.best.price - marketPrice,
      feasible: state.market?.eligible ?? null,
      marketIRR: state.market?.irr ?? null,
      marketIRRStatus: state.market?.result?.irrStatus ?? null,
      marketFundingStatus: state.market?.result?.funding.status ?? null,
      fundingStatus: state.best?.result?.funding.status ?? null,
      lowerBound: state.best?.price ?? null,
      upperBound: state.upper,
      iterations,
      expansions,
    };
  }

  if (!Number.isFinite(marketPrice) || marketPrice < 0 || marketPrice > Number.MAX_SAFE_INTEGER ||
      !Number.isFinite(targetIRR) || targetIRR < 0 || targetIRR > 100 ||
      !Number.isSafeInteger(maxIterations) || maxIterations < 0 || maxIterations > 256 ||
      !Number.isSafeInteger(maxExpansions) || maxExpansions < 0 || maxExpansions > 32 ||
      !Number.isFinite(tolerance) || tolerance < 1) {
    return finish("invalid", "invalid-input");
  }

  state.market = probe(marketPrice);
  retain(state.market);
  retain(marketPrice === 0 ? state.market : probe(0));
  if (!Number.isInteger(marketPrice)) retain(probe(Math.floor(marketPrice)));

  let hi = Math.min(Number.MAX_SAFE_INTEGER, Math.max(Math.ceil(marketPrice * 3), 100_000));
  let upper = probe(hi);
  retain(upper);
  while (upper.eligible !== false && expansions < maxExpansions && hi < Number.MAX_SAFE_INTEGER) {
    hi = Math.min(Number.MAX_SAFE_INTEGER, hi * 2);
    expansions += 1;
    upper = probe(hi);
    retain(upper);
  }
  if (upper.eligible !== false) {
    return finish(
      upper.eligible === null ? "invalid" : "search-limited",
      upper.eligible === null ? "calculation-unavailable" : "expansion-limit",
    );
  }
  state.upper = hi;

  let lo = state.best?.price ?? 0;
  while (hi - lo > tolerance && iterations < maxIterations) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const candidate = probe(mid);
    iterations += 1;
    if (candidate.eligible === null) return finish("invalid", "calculation-unavailable");
    if (candidate.eligible) {
      retain(candidate);
      lo = mid;
    } else {
      hi = mid;
      state.upper = mid;
    }
  }
  if (hi - lo > tolerance) return finish("search-limited", "iteration-limit");
  return state.best === null
    ? finish("no-candidate", "no-feasible-candidate")
    : finish("bracketed", "tolerance");
}

export function findMaxAcquisitionForScenario(
  parcel: Parcel,
  scenario: Scenario,
  targets: Pct[] = DEFAULT_IRR_TARGETS,
): ScenarioMaxAcquisition {
  const results = targets.map((target) => findMaxLandCostForIRR(parcel, scenario, target));
  // Even an empty target list retains the explicit market-price calculation.
  const market = results[0] ?? findMaxLandCostForIRR(parcel, scenario, 0, { maxIterations: 0, maxExpansions: 0 });
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    marketPrice: parcel.acquiredPrice,
    marketIRR: market.marketIRR,
    marketIRRStatus: market.marketIRRStatus,
    marketFundingStatus: market.marketFundingStatus,
    results,
  };
}

export function findMaxAcquisitionAll(
  parcel: Parcel,
  scenarios: Scenario[],
  targets: Pct[] = DEFAULT_IRR_TARGETS,
): ScenarioMaxAcquisition[] {
  return scenarios.map((scenario) => findMaxAcquisitionForScenario(parcel, scenario, targets));
}
