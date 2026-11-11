import type { FinancialRevenuePricingSnapshot } from "@/lib/finance/types";
import { REVENUE_PRICE_ADJUSTMENT_DIMENSIONS } from "@/lib/finance/revenue-contract";
import type { PlanningDwellingSaleBand, PlanningScenario } from "@/lib/planning/types";
import { DWELLING_MARKET_VERSION } from "@/lib/finance/dwelling-market";

export function validateDwellingSaleBands(bands: PlanningDwellingSaleBand[]): string | null {
  const sorted = [...bands].sort((a, b) => a.minExclusiveSqm - b.minExclusiveSqm);
  for (let i = 0; i < sorted.length; i += 1) {
    const band = sorted[i];
    if (!Number.isFinite(band.minExclusiveSqm) || band.minExclusiveSqm < 0 ||
        (band.maxExclusiveSqm !== null && (!Number.isFinite(band.maxExclusiveSqm) || band.maxExclusiveSqm <= band.minExclusiveSqm)) ||
        !Number.isFinite(band.unitPriceWon) || band.unitPriceWon <= 0 || !band.source.trim()) {
      return "평형별 단가의 면적 구간·양수 단가·근거를 확인하세요.";
    }
    if (i > 0 && (sorted[i - 1].maxExclusiveSqm ?? Infinity) > band.minExclusiveSqm) {
      return "평형별 단가 구간이 겹칩니다.";
    }
  }
  return null;
}

/** Saleable area drives revenue; exclusive area only selects the price band. */
export function dwellingSaleBreakdown(scenario: PlanningScenario, fallbackUnitPriceWon: number) {
  const bands = scenario.dwellingProgram?.salePriceBands ?? [];
  const error = validateDwellingSaleBands(bands);
  if (error) throw new Error(error);
  return scenario.floorPrograms.flatMap((floor) => floor.zones.map(zone => ({ zone, level: floor.level }))).filter(({ zone }) =>
    zone.useType === "residential" && (zone.revenueModel ?? "sale") === "sale" && zone.unitCount > 0,
  ).map(({ zone, level }) => {
    const saleAreaSqm = zone.saleableAreaSqm ?? zone.areaSqm;
    const exclusiveSqm = (zone.parkingExclusiveAreaSqm ?? saleAreaSqm) / zone.unitCount;
    const candidate = bands.find((b) => exclusiveSqm >= b.minExclusiveSqm && exclusiveSqm < (b.maxExclusiveSqm ?? Infinity));
    const observation = candidate?.marketObservation;
    const observationFits = !observation || (observation.methodVersion === DWELLING_MARKET_VERSION && observation.projectId === scenario.projectId && zone.parkingExclusiveAreaSqm != null &&
      Math.abs(observation.targetExclusiveSqm - exclusiveSqm) <= 1e-6 &&
      Math.abs(saleAreaSqm / zone.unitCount - exclusiveSqm) <= 1e-5 &&
      level >= 2 && level <= 5 && observation.unitPriceWon === candidate?.unitPriceWon);
    const band = observationFits ? candidate : undefined;
    const unitPriceWon = band?.unitPriceWon ?? fallbackUnitPriceWon;
    return {
      unitCount: zone.unitCount, exclusiveSqm, saleAreaSqm, unitPriceWon,
      revenueManwon: saleAreaSqm * unitPriceWon / 10_000,
      source: band?.source ?? (observation ? "공통 가정 · 관측 단가의 대상·면적·층 조건 변경" : "공통 주거 매각 단가 · 평형별 근거 미분리"),
      bandApplied: Boolean(band),
    };
  });
}

/** Store the weighted final price in the existing Stage2/3 six-pool contract. */
export function applyDwellingSalePricing(scenario: PlanningScenario, pricing: FinancialRevenuePricingSnapshot): FinancialRevenuePricingSnapshot {
  if (!scenario.dwellingProgram?.salePriceBands?.length) return pricing;
  const rows = dwellingSaleBreakdown(scenario, pricing.pools.residentialSale.unitPriceWon);
  const area = rows.reduce((sum, row) => sum + row.saleAreaSqm, 0);
  if (area <= 0) return pricing;
  const unitPriceWon = rows.reduce((sum, row) => sum + row.saleAreaSqm * row.unitPriceWon, 0) / area;
  const adjustments = Object.fromEntries(REVENUE_PRICE_ADJUSTMENT_DIMENSIONS.map((dimension) => [dimension, {
    factor: 1, status: "not-applied" as const, sourceName: "평형별 최종단가에 포함",
  }])) as NonNullable<FinancialRevenuePricingSnapshot["pools"]["residentialSale"]["adjustments"]>;
  return {
    ...pricing,
    pools: { ...pricing.pools, residentialSale: {
      ...pricing.pools.residentialSale, baseUnitPriceWon: unitPriceWon, unitPriceWon,
      adjustmentFactor: 1, adjustments, sourceStatus: "user-input", sourceRef: undefined,
      sourceName: rows.map((r) => `${r.exclusiveSqm.toFixed(2)}㎡ × ${r.unitCount}세대: ${r.unitPriceWon}원/㎡ (${r.source})`).join("; "),
    } },
  };
}
