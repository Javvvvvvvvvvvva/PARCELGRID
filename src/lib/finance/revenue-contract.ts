import { D, ONE, ZERO, type Decimal } from "@/lib/finance/math";
import type {
  AssumptionSet,
  FinancialRevenueAreaPools,
  FinancialRevenuePoolAmounts,
  FinancialRevenuePoolKey,
  FinancialRevenuePricingSnapshot,
  FinancialRevenueProjectionSnapshot,
  RevenuePriceAdjustmentDimension,
  RevenuePriceAdjustmentSnapshot,
  RevenuePriceSourceField,
  RevenuePoolPricingSnapshot,
  Scenario,
} from "@/lib/finance/types";

const WON_PER_MANWON = D(10_000);

export const REVENUE_PRICING_MODEL_VERSION =
  "revenue-pricing-2026.3" as const;
export const LEGACY_REVENUE_PRICING_MODEL_VERSION =
  "revenue-pricing-2026.2" as const;
export const REVENUE_PRICING_INPUT_VERSION =
  "revenue-pricing-input-2026.1" as const;
export const REVENUE_VALUATION_MODEL_VERSION =
  "revenue-valuation-2026.2" as const;
export const DEFAULT_STABILIZATION_FACTOR_PCT = 85;
export const DEFAULT_RETAIL_RENT_PREMIUM = 1.2;
export const DEFAULT_OPERATING_EXPENSE_RATE_PCT = 20;

export const FINANCIAL_REVENUE_POOL_KEYS: FinancialRevenuePoolKey[] = [
  "residentialSale",
  "retailSale",
  "officeSale",
  "residentialLease",
  "retailLease",
  "officeLease",
];

const SALE_POOLS = new Set<FinancialRevenuePoolKey>([
  "residentialSale",
  "retailSale",
  "officeSale",
]);

const REVENUE_PRICING_SOURCE_STATUSES = new Set([
  "internal-assumption",
  "user-input",
  "source-backed",
]);

const REVENUE_ADJUSTMENT_STATUSES = new Set([
  "not-applied",
  "internal-assumption",
  "user-input",
  "source-backed",
]);

export type RevenuePricingKind = "sale" | "lease";

export const REVENUE_PRICE_ADJUSTMENT_DIMENSIONS: RevenuePriceAdjustmentDimension[] = [
  "use",
  "location",
  "floor",
  "area",
  "newBuild",
];

export const REVENUE_POOL_SOURCE_FIELDS: Record<
  FinancialRevenuePoolKey,
  RevenuePriceSourceField
> = {
  residentialSale: "residentialSalePricePerSqM",
  retailSale: "retailSalePricePerSqM",
  officeSale: "officeSalePricePerSqM",
  residentialLease: "residentialRentPerSqMMonth",
  retailLease: "retailRentPerSqMMonth",
  officeLease: "officeRentPerSqMMonth",
};

const REVENUE_SOURCE_FIELD_POOLS = Object.fromEntries(
  Object.entries(REVENUE_POOL_SOURCE_FIELDS).map(([pool, field]) => [field, pool]),
) as Record<RevenuePriceSourceField, FinancialRevenuePoolKey>;

export interface RevenuePricingSourceInput {
  status?: RevenuePoolPricingSnapshot["sourceStatus"];
  field?: RevenuePoolPricingSnapshot["sourceField"];
  name?: string;
  ref?: string;
  asOf?: string;
}

export interface RevenuePricingAdjustmentInput {
  factor: number;
  status?: RevenuePriceAdjustmentSnapshot["status"];
  sourceName?: string;
  sourceRef?: string;
  asOf?: string;
  note?: string;
}

export interface RevenuePricingInput {
  assumptionsVersion?: string;
  unitPricesWon: Record<FinancialRevenuePoolKey, number>;
  vacancyRatePct: number;
  operatingExpenseRatePct?: number;
  capRatePct: number;
  stabilizationFactorPct?: number;
  adjustmentFactors?: Partial<Record<FinancialRevenuePoolKey, number>>;
  adjustments?: Partial<
    Record<
      FinancialRevenuePoolKey,
      Partial<
        Record<RevenuePriceAdjustmentDimension, RevenuePricingAdjustmentInput>
      >
    >
  >;
  sources?: Partial<Record<FinancialRevenuePoolKey, RevenuePricingSourceInput>>;
}

export interface RevenuePoolPricingDraft {
  baseUnitPriceWon?: number;
  adjustments?: Partial<Record<RevenuePriceAdjustmentDimension, number>>;
}

export interface RevenuePricingDraftContract {
  version: typeof REVENUE_PRICING_INPUT_VERSION;
  projectId: string;
  scenarioId: string;
  pools: Partial<Record<FinancialRevenuePoolKey, RevenuePoolPricingDraft>>;
  updatedAt: string;
}

function nonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function adjustmentSnapshot(
  dimension: RevenuePriceAdjustmentDimension,
  input?: RevenuePricingAdjustmentInput,
): RevenuePriceAdjustmentSnapshot {
  const factor = Number.isFinite(input?.factor) && Number(input?.factor) > 0
    ? Number(input?.factor)
    : 1;
  return {
    factor,
    status: input?.status ?? "not-applied",
    sourceName:
      input?.sourceName ??
      (factor === 1 ? "보정 미적용" : `${dimension} 내부 보정`),
    sourceRef: input?.sourceRef,
    asOf: input?.asOf,
    note: input?.note,
  };
}

function adjustmentProduct(
  adjustments: Record<
    RevenuePriceAdjustmentDimension,
    RevenuePriceAdjustmentSnapshot
  >,
): number {
  return REVENUE_PRICE_ADJUSTMENT_DIMENSIONS.reduce(
    (product, dimension) => product * adjustments[dimension].factor,
    1,
  );
}

function normalizedAdjustments(
  pool: RevenuePoolPricingSnapshot,
): Record<
  RevenuePriceAdjustmentDimension,
  RevenuePriceAdjustmentSnapshot
> {
  if (pool.adjustments) {
    return Object.fromEntries(
      REVENUE_PRICE_ADJUSTMENT_DIMENSIONS.map((dimension) => [
        dimension,
        adjustmentSnapshot(dimension, pool.adjustments?.[dimension]),
      ]),
    ) as Record<
      RevenuePriceAdjustmentDimension,
      RevenuePriceAdjustmentSnapshot
    >;
  }
  return Object.fromEntries(
    REVENUE_PRICE_ADJUSTMENT_DIMENSIONS.map((dimension) => [
      dimension,
      adjustmentSnapshot(
        dimension,
        dimension === "use"
          ? {
              factor:
                Number.isFinite(pool.adjustmentFactor) &&
                pool.adjustmentFactor > 0
                  ? pool.adjustmentFactor
                  : 1,
              status:
                pool.adjustmentFactor === 1
                  ? "not-applied"
                  : "internal-assumption",
              sourceName:
                pool.adjustmentFactor === 1
                  ? "보정 미적용"
                  : "2026.2 통합 보정",
              note: "구형 통합 보정값을 용도 보정축으로 이관",
            }
          : undefined,
      ),
    ]),
  ) as Record<
    RevenuePriceAdjustmentDimension,
    RevenuePriceAdjustmentSnapshot
  >;
}

function normalizedBasePrice(pool: RevenuePoolPricingSnapshot): number {
  if (Number.isFinite(pool.baseUnitPriceWon)) {
    return nonNegative(pool.baseUnitPriceWon);
  }
  const factor =
    Number.isFinite(pool.adjustmentFactor) && pool.adjustmentFactor > 0
      ? pool.adjustmentFactor
      : 1;
  return nonNegative(pool.unitPriceWon) / factor;
}

function rebuiltPool(
  pool: RevenuePoolPricingSnapshot,
  patch: Partial<RevenuePoolPricingSnapshot> = {},
): RevenuePoolPricingSnapshot {
  const merged = { ...pool, ...patch };
  const adjustments = normalizedAdjustments(merged);
  const baseUnitPriceWon = normalizedBasePrice(merged);
  const adjustmentFactor = adjustmentProduct(adjustments);
  return {
    ...merged,
    baseUnitPriceWon,
    adjustmentFactor,
    adjustments,
    unitPriceWon: baseUnitPriceWon * adjustmentFactor,
  };
}

export function revenuePriceSourceFieldForPool(
  pool: FinancialRevenuePoolKey,
): RevenuePriceSourceField {
  return REVENUE_POOL_SOURCE_FIELDS[pool];
}

export function revenuePoolForPriceSourceField(
  field: string,
): FinancialRevenuePoolKey | null {
  return field in REVENUE_SOURCE_FIELD_POOLS
    ? REVENUE_SOURCE_FIELD_POOLS[field as RevenuePriceSourceField]
    : null;
}

export function buildRevenuePricingDraftKey(
  projectId: string,
  scenarioId: string,
): string {
  return `${projectId}::${scenarioId}`;
}

function emptyPoolAmounts(): FinancialRevenuePoolAmounts {
  return {
    residentialSale: 0,
    retailSale: 0,
    officeSale: 0,
    residentialLease: 0,
    retailLease: 0,
    officeLease: 0,
  };
}

export function emptyRevenueAreaPools(): FinancialRevenueAreaPools {
  return {
    residentialSaleSqm: 0,
    retailSaleSqm: 0,
    officeSaleSqm: 0,
    residentialLeaseSqm: 0,
    retailLeaseSqm: 0,
    officeLeaseSqm: 0,
  };
}

/**
 * Reads both the six-pool 2026.2 contract and the former three-pool shape.
 * Legacy commercial lease area remains retail because its original split is
 * unrecoverable; a newly confirmed representative regenerates the six pools.
 */
export function normalizeRevenueAreaPools(
  areas: FinancialRevenueAreaPools,
): FinancialRevenueAreaPools {
  const legacyRetailSqm = nonNegative(areas.retailSqm);
  return {
    residentialSaleSqm: nonNegative(areas.residentialSaleSqm),
    retailSaleSqm: nonNegative(areas.retailSaleSqm),
    officeSaleSqm: nonNegative(areas.officeSaleSqm),
    residentialLeaseSqm: nonNegative(areas.residentialLeaseSqm),
    retailLeaseSqm:
      areas.retailLeaseSqm == null
        ? legacyRetailSqm
        : nonNegative(areas.retailLeaseSqm),
    officeLeaseSqm: nonNegative(areas.officeLeaseSqm),
  };
}

export function revenueAreaForPool(
  areas: FinancialRevenueAreaPools,
  pool: FinancialRevenuePoolKey,
): number {
  const normalized = normalizeRevenueAreaPools(areas);
  switch (pool) {
    case "residentialSale":
      return normalized.residentialSaleSqm;
    case "retailSale":
      return normalized.retailSaleSqm;
    case "officeSale":
      return normalized.officeSaleSqm;
    case "residentialLease":
      return normalized.residentialLeaseSqm;
    case "retailLease":
      return normalized.retailLeaseSqm;
    case "officeLease":
      return normalized.officeLeaseSqm;
  }
}

export function revenueAreaTotals(areas: FinancialRevenueAreaPools): {
  saleSqm: number;
  leaseSqm: number;
  totalSqm: number;
} {
  const normalized = normalizeRevenueAreaPools(areas);
  const saleSqm =
    normalized.residentialSaleSqm +
    normalized.retailSaleSqm +
    normalized.officeSaleSqm;
  const leaseSqm =
    normalized.residentialLeaseSqm +
    normalized.retailLeaseSqm +
    normalized.officeLeaseSqm;
  return { saleSqm, leaseSqm, totalSqm: saleSqm + leaseSqm };
}

export function createRevenuePricingSnapshot(
  input: RevenuePricingInput,
): FinancialRevenuePricingSnapshot {
  const pools = Object.fromEntries(
    FINANCIAL_REVENUE_POOL_KEYS.map((pool) => {
      const sale = SALE_POOLS.has(pool);
      const source = input.sources?.[pool];
      const legacyFactor = input.adjustmentFactors?.[pool];
      const adjustments = Object.fromEntries(
        REVENUE_PRICE_ADJUSTMENT_DIMENSIONS.map((dimension) => {
          const explicit = input.adjustments?.[pool]?.[dimension];
          const fallback =
            dimension === "use" && legacyFactor != null
              ? {
                  factor: legacyFactor,
                  status:
                    legacyFactor === 1
                      ? ("not-applied" as const)
                      : ("internal-assumption" as const),
                  sourceName:
                    legacyFactor === 1 ? "보정 미적용" : "용도 내부 보정",
                }
              : undefined;
          return [
            dimension,
            adjustmentSnapshot(dimension, explicit ?? fallback),
          ];
        }),
      ) as Record<
        RevenuePriceAdjustmentDimension,
        RevenuePriceAdjustmentSnapshot
      >;
      const baseUnitPriceWon = nonNegative(input.unitPricesWon[pool]);
      const adjustmentFactor = adjustmentProduct(adjustments);
      return [
        pool,
        {
          unit: sale ? "won-per-sqm" : "won-per-sqm-month",
          baseUnitPriceWon,
          unitPriceWon: baseUnitPriceWon * adjustmentFactor,
          sourceField: source?.field ?? REVENUE_POOL_SOURCE_FIELDS[pool],
          sourceStatus: source?.status ?? "internal-assumption",
          sourceName:
            source?.name ?? input.assumptionsVersion ?? "사업성 내부 가정",
          sourceRef: source?.ref,
          asOf: source?.asOf,
          adjustmentFactor,
          adjustments,
        } satisfies RevenuePoolPricingSnapshot,
      ];
    }),
  ) as Record<FinancialRevenuePoolKey, RevenuePoolPricingSnapshot>;

  return {
    modelVersion: REVENUE_PRICING_MODEL_VERSION,
    assumptionsVersion: input.assumptionsVersion,
    pools,
    vacancyRatePct: Math.min(100, nonNegative(input.vacancyRatePct)),
    operatingExpenseRatePct: Math.min(
      100,
      nonNegative(
        input.operatingExpenseRatePct ??
          DEFAULT_OPERATING_EXPENSE_RATE_PCT,
      ),
    ),
    capRatePct: nonNegative(input.capRatePct),
    stabilizationFactorPct: Math.min(
      100,
      nonNegative(
        input.stabilizationFactorPct ?? DEFAULT_STABILIZATION_FACTOR_PCT,
      ),
    ),
  };
}

export function revenuePricingFromAssumptions(
  assumptions: AssumptionSet,
): FinancialRevenuePricingSnapshot {
  return createRevenuePricingSnapshot({
    assumptionsVersion: "stage3-assumption-set",
    unitPricesWon: {
      residentialSale: assumptions.salePricePerSqM,
      retailSale: assumptions.salePricePerSqM,
      officeSale: assumptions.salePricePerSqM,
      residentialLease: assumptions.rentPerSqMMonth,
      retailLease: assumptions.rentPerSqMMonth,
      officeLease: assumptions.rentPerSqMMonth,
    },
    vacancyRatePct: assumptions.vacancyRate,
    operatingExpenseRatePct:
      assumptions.operatingExpenseRate ??
      DEFAULT_OPERATING_EXPENSE_RATE_PCT,
    capRatePct: assumptions.capRate,
    stabilizationFactorPct: DEFAULT_STABILIZATION_FACTOR_PCT,
    adjustments: {
      retailLease: {
        use: {
          factor: DEFAULT_RETAIL_RENT_PREMIUM,
          status: "internal-assumption",
          sourceName: "상가 임대 내부 용도 보정",
          note: "대상지 상가 임대사례로 교체 전 1.20배 예비 가정",
        },
      },
    },
  });
}

function scenarioPricingSource(
  scenario: Scenario,
): FinancialRevenuePricingSnapshot | undefined {
  return (
    scenario.revenuePricing ??
    scenario.program.areaContract?.revenueProjection?.pricing
  );
}

function relativeRevenueAreasForScenario(
  scenario: Scenario,
): FinancialRevenueAreaPools {
  if (scenario.program.areaContract) {
    return normalizeRevenueAreaPools(
      scenario.program.areaContract.revenueAreas,
    );
  }

  const { mix, type } = scenario.program;
  return {
    residentialSaleSqm: nonNegative(mix.residentialSale),
    retailSaleSqm: 0,
    officeSaleSqm: 0,
    residentialLeaseSqm:
      type === "office" ? 0 : nonNegative(mix.residentialLease),
    retailLeaseSqm: nonNegative(mix.retail),
    officeLeaseSqm:
      type === "office" ? nonNegative(mix.residentialLease) : 0,
  };
}

export function revenuePricingKindForScenario(
  scenario: Scenario,
): RevenuePricingKind {
  const totals = revenueAreaTotals(relativeRevenueAreasForScenario(scenario));
  return totals.saleSqm > 0 ? "sale" : "lease";
}

/**
 * Resolves the pricing contract used by Stage 3. Scenario edits win over the
 * Stage 2 lock; legacy scenarios derive the same six-pool shape from aliases.
 * Global NOI rates remain editable Stage 3 assumptions.
 */
export function revenuePricingForScenario(
  scenario: Scenario,
): FinancialRevenuePricingSnapshot {
  const pricing = scenarioPricingSource(scenario);
  const resolved = pricing
    ? upgradeRevenuePricingSnapshot(pricing)
    : revenuePricingFromAssumptions(scenario.assumptions);
  return {
    ...resolved,
    vacancyRatePct: scenario.assumptions.vacancyRate,
    operatingExpenseRatePct:
      scenario.assumptions.operatingExpenseRate ??
      DEFAULT_OPERATING_EXPENSE_RATE_PCT,
    capRatePct: scenario.assumptions.capRate,
  };
}

/** Area-weighted final unit price for the selected disposition family. */
export function blendedRevenueUnitPrice(
  scenario: Scenario,
  kind: RevenuePricingKind,
): number {
  if (!scenarioPricingSource(scenario)) {
    return kind === "sale"
      ? nonNegative(scenario.assumptions.salePricePerSqM)
      : nonNegative(scenario.assumptions.rentPerSqMMonth);
  }

  const areas = relativeRevenueAreasForScenario(scenario);
  const pricing = revenuePricingForScenario(scenario);
  let totalArea = 0;
  let weightedPrice = 0;
  for (const pool of FINANCIAL_REVENUE_POOL_KEYS) {
    if (SALE_POOLS.has(pool) !== (kind === "sale")) continue;
    const area = revenueAreaForPool(areas, pool);
    totalArea += area;
    weightedPrice += area * pricing.pools[pool].unitPriceWon;
  }

  if (totalArea <= 0) {
    return kind === "sale"
      ? nonNegative(scenario.assumptions.salePricePerSqM)
      : nonNegative(scenario.assumptions.rentPerSqMMonth);
  }
  return weightedPrice / totalArea;
}

export function upgradeRevenuePricingSnapshot(
  pricing: FinancialRevenuePricingSnapshot,
): FinancialRevenuePricingSnapshot {
  return {
    ...pricing,
    modelVersion: REVENUE_PRICING_MODEL_VERSION,
    pools: Object.fromEntries(
      FINANCIAL_REVENUE_POOL_KEYS.map((pool) => [
        pool,
        rebuiltPool(pricing.pools[pool]),
      ]),
    ) as Record<FinancialRevenuePoolKey, RevenuePoolPricingSnapshot>,
  };
}

export function applyRevenuePricingDraft(
  pricing: FinancialRevenuePricingSnapshot,
  draft: RevenuePricingDraftContract | null | undefined,
): FinancialRevenuePricingSnapshot {
  const upgraded = upgradeRevenuePricingSnapshot(pricing);
  if (!draft) return upgraded;
  const pools = { ...upgraded.pools };
  for (const pool of FINANCIAL_REVENUE_POOL_KEYS) {
    const poolDraft = draft.pools[pool];
    if (!poolDraft) continue;
    const current = pools[pool];
    const adjustments = normalizedAdjustments(current);
    for (const dimension of REVENUE_PRICE_ADJUSTMENT_DIMENSIONS) {
      const factor = poolDraft.adjustments?.[dimension];
      if (factor == null) continue;
      adjustments[dimension] = adjustmentSnapshot(dimension, {
        factor,
        status: "user-input",
        sourceName: "사용자 보정 입력",
      });
    }
    const baseChanged = poolDraft.baseUnitPriceWon != null;
    pools[pool] = rebuiltPool(
      {
        ...current,
        baseUnitPriceWon: baseChanged
          ? poolDraft.baseUnitPriceWon
          : current.baseUnitPriceWon,
        sourceField: REVENUE_POOL_SOURCE_FIELDS[pool],
        sourceStatus: baseChanged ? "user-input" : current.sourceStatus,
        sourceName: baseChanged ? "사용자 단가 입력" : current.sourceName,
        sourceRef: baseChanged ? undefined : current.sourceRef,
        asOf: baseChanged ? undefined : current.asOf,
        adjustments,
      },
    );
  }
  return { ...upgraded, pools };
}

export function applyRevenuePoolSource(
  pricing: FinancialRevenuePricingSnapshot,
  pool: FinancialRevenuePoolKey,
  input: {
    value: number;
    field: RevenuePoolPricingSnapshot["sourceField"];
    status?: RevenuePoolPricingSnapshot["sourceStatus"];
    name: string;
    ref: string;
    asOf: string;
  },
): FinancialRevenuePricingSnapshot {
  const upgraded = upgradeRevenuePricingSnapshot(pricing);
  return {
    ...upgraded,
    pools: {
      ...upgraded.pools,
      [pool]: rebuiltPool({
        ...upgraded.pools[pool],
        baseUnitPriceWon: nonNegative(input.value),
        sourceField: input.field,
        sourceStatus: input.status ?? "source-backed",
        sourceName: input.name,
        sourceRef: input.ref,
        asOf: input.asOf,
      }),
    },
  };
}

export function scaleRevenuePricing(
  pricing: FinancialRevenuePricingSnapshot,
  kind: RevenuePricingKind,
  factor: number,
): FinancialRevenuePricingSnapshot {
  const upgraded = upgradeRevenuePricingSnapshot(pricing);
  const safeFactor = Number.isFinite(factor) ? Math.max(0, factor) : 0;
  if (safeFactor === 1) return upgraded;
  return {
    ...upgraded,
    pools: Object.fromEntries(
      FINANCIAL_REVENUE_POOL_KEYS.map((pool) => {
        const applies = SALE_POOLS.has(pool) === (kind === "sale");
        const current = upgraded.pools[pool];
        return [
          pool,
          applies
            ? rebuiltPool({
                ...current,
                baseUnitPriceWon:
                  normalizedBasePrice(current) * safeFactor,
                sourceStatus: "internal-assumption",
                sourceName: `분석 비례 조정 (${current.sourceName})`,
                sourceRef: undefined,
                asOf: undefined,
              })
            : current,
        ];
      }),
    ) as Record<FinancialRevenuePoolKey, RevenuePoolPricingSnapshot>,
  };
}

/**
 * Applies a sensitivity or reverse-solve target without collapsing the six
 * pool prices. Existing relative price spreads and adjustment factors remain.
 */
export function withScenarioRevenueUnitPrice(
  scenario: Scenario,
  kind: RevenuePricingKind,
  targetUnitPriceWon: number,
): Scenario {
  const target = nonNegative(targetUnitPriceWon);
  const field = kind === "sale" ? "salePricePerSqM" : "rentPerSqMMonth";
  const assumptions = { ...scenario.assumptions, [field]: target };
  if (!scenarioPricingSource(scenario)) {
    return { ...scenario, assumptions };
  }

  const current = blendedRevenueUnitPrice(scenario, kind);
  let revenuePricing = revenuePricingForScenario(scenario);
  if (current > 0) {
    revenuePricing = scaleRevenuePricing(revenuePricing, kind, target / current);
  } else {
    revenuePricing = {
      ...revenuePricing,
      pools: Object.fromEntries(
        FINANCIAL_REVENUE_POOL_KEYS.map((pool) => {
          const applies = SALE_POOLS.has(pool) === (kind === "sale");
          const item = revenuePricing.pools[pool];
          return [
            pool,
            applies
              ? rebuiltPool({
                  ...item,
                  baseUnitPriceWon: target / item.adjustmentFactor,
                  sourceStatus: "internal-assumption",
                  sourceName: "분석 단가 입력",
                  sourceRef: undefined,
                  asOf: undefined,
                })
              : item,
          ];
        }),
      ) as Record<FinancialRevenuePoolKey, RevenuePoolPricingSnapshot>,
    };
  }

  return { ...scenario, assumptions, revenuePricing };
}

export function validateRevenuePricingSnapshot(
  pricing: FinancialRevenuePricingSnapshot,
): string[] {
  const errors: string[] = [];
  if (
    pricing.modelVersion !== REVENUE_PRICING_MODEL_VERSION &&
    pricing.modelVersion !== LEGACY_REVENUE_PRICING_MODEL_VERSION
  ) {
    errors.push("지원하지 않는 수익 단가 Snapshot 버전입니다.");
  }
  for (const rate of [
    pricing.vacancyRatePct,
    pricing.operatingExpenseRatePct,
    pricing.stabilizationFactorPct,
  ]) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      errors.push("수익 단가 Snapshot 비율은 0~100%여야 합니다.");
      break;
    }
  }
  if (!Number.isFinite(pricing.capRatePct) || pricing.capRatePct < 0) {
    errors.push("수익 단가 Snapshot Cap rate가 올바르지 않습니다.");
  }
  for (const pool of FINANCIAL_REVENUE_POOL_KEYS) {
    const item = pricing.pools?.[pool];
    const salePool = SALE_POOLS.has(pool);
    const expectedUnit = salePool ? "won-per-sqm" : "won-per-sqm-month";
    const genericSourceField = salePool
      ? "salePricePerSqM"
      : "rentPerSqMMonth";
    if (
      !item ||
      !Number.isFinite(item.unitPriceWon) ||
      item.unitPriceWon < 0 ||
      !Number.isFinite(item.adjustmentFactor) ||
      item.adjustmentFactor <= 0 ||
      !item.sourceName?.trim() ||
      item.unit !== expectedUnit ||
      (item.sourceField !== genericSourceField &&
        item.sourceField !== REVENUE_POOL_SOURCE_FIELDS[pool]) ||
      !REVENUE_PRICING_SOURCE_STATUSES.has(item.sourceStatus)
    ) {
      errors.push(`${pool} 단가 또는 출처 메타데이터가 올바르지 않습니다.`);
      continue;
    }
    if (pricing.modelVersion === REVENUE_PRICING_MODEL_VERSION) {
      if (
        !Number.isFinite(item.baseUnitPriceWon) ||
        Number(item.baseUnitPriceWon) < 0 ||
        !item.adjustments ||
        REVENUE_PRICE_ADJUSTMENT_DIMENSIONS.some(
          (dimension) => !item.adjustments?.[dimension],
        )
      ) {
        errors.push(`${pool} 기준단가 또는 보정축이 없습니다.`);
        continue;
      }
      const adjustments = normalizedAdjustments(item);
      if (
        REVENUE_PRICE_ADJUSTMENT_DIMENSIONS.some(
          (dimension) =>
            !Number.isFinite(adjustments[dimension].factor) ||
            adjustments[dimension].factor <= 0 ||
            adjustments[dimension].factor > 10 ||
            !adjustments[dimension].sourceName.trim() ||
            !REVENUE_ADJUSTMENT_STATUSES.has(
              adjustments[dimension].status,
            ) ||
            (adjustments[dimension].status === "source-backed" &&
              (!adjustments[dimension].sourceRef?.trim() ||
                !adjustments[dimension].asOf ||
                Number.isNaN(Date.parse(adjustments[dimension].asOf)))),
        )
      ) {
        errors.push(`${pool} 보정축 값 또는 근거가 올바르지 않습니다.`);
        continue;
      }
      const expected = Number(item.baseUnitPriceWon) * adjustmentProduct(adjustments);
      if (Math.abs(adjustmentProduct(adjustments) - item.adjustmentFactor) > 1e-9) {
        errors.push(`${pool} 보정축 곱과 통합 보정값이 일치하지 않습니다.`);
      }
      if (Math.abs(expected - item.unitPriceWon) > 0.01) {
        errors.push(`${pool} 기준단가와 보정 후 단가가 일치하지 않습니다.`);
      }
    }
    if (
      item.sourceStatus === "source-backed" &&
      (!item.sourceRef?.trim() || !item.asOf || Number.isNaN(Date.parse(item.asOf)))
    ) {
      errors.push(`${pool} 원문 근거 단가의 문서 참조 또는 기준일이 없습니다.`);
    }
  }
  return errors;
}

function toManwon(valueWon: Decimal): number {
  return valueWon.div(WON_PER_MANWON).toNumber();
}

export function valueRevenueAreaPools(
  areas: FinancialRevenueAreaPools,
  pricing: FinancialRevenuePricingSnapshot,
): FinancialRevenueProjectionSnapshot {
  const pricingErrors = validateRevenuePricingSnapshot(pricing);
  if (pricingErrors.length > 0) {
    throw new Error(`수익 단가 입력을 확인하세요: ${pricingErrors.join(" ")}`);
  }
  const normalizedAreas = normalizeRevenueAreaPools(areas);
  const valueByPoolManwon = emptyPoolAmounts();
  const annualPotentialRentByPoolManwon = emptyPoolAmounts();
  const annualEffectiveGrossIncomeByPoolManwon = emptyPoolAmounts();
  const annualOperatingExpenseByPoolManwon = emptyPoolAmounts();
  const annualNoiByPoolManwon = emptyPoolAmounts();
  const vacancyFactor = ONE.minus(D(pricing.vacancyRatePct).div(100));
  const operatingExpenseRate = D(pricing.operatingExpenseRatePct).div(100);
  const capRate = D(pricing.capRatePct).div(100);
  const stabilizationFactor = D(pricing.stabilizationFactorPct).div(100);

  for (const pool of FINANCIAL_REVENUE_POOL_KEYS) {
    const area = D(revenueAreaForPool(normalizedAreas, pool));
    const unitPrice = D(pricing.pools[pool].unitPriceWon);
    if (SALE_POOLS.has(pool)) {
      valueByPoolManwon[pool] = toManwon(area.times(unitPrice));
      continue;
    }

    const annualPotentialRentWon = area.times(unitPrice).times(12);
    const annualEffectiveGrossIncomeWon = annualPotentialRentWon.times(
      vacancyFactor,
    );
    const annualOperatingExpenseWon = annualEffectiveGrossIncomeWon.times(
      operatingExpenseRate,
    );
    const annualNoiWon = annualEffectiveGrossIncomeWon.minus(
      annualOperatingExpenseWon,
    );
    annualPotentialRentByPoolManwon[pool] = toManwon(
      annualPotentialRentWon,
    );
    annualEffectiveGrossIncomeByPoolManwon[pool] = toManwon(
      annualEffectiveGrossIncomeWon,
    );
    annualOperatingExpenseByPoolManwon[pool] = toManwon(
      annualOperatingExpenseWon,
    );
    annualNoiByPoolManwon[pool] = toManwon(annualNoiWon);
    valueByPoolManwon[pool] = capRate.gt(0)
      ? toManwon(annualNoiWon.div(capRate).times(stabilizationFactor))
      : ZERO.toNumber();
  }

  const saleRevenueManwon =
    valueByPoolManwon.residentialSale +
    valueByPoolManwon.retailSale +
    valueByPoolManwon.officeSale;
  const capitalizedLeaseValueManwon =
    valueByPoolManwon.residentialLease +
    valueByPoolManwon.retailLease +
    valueByPoolManwon.officeLease;
  const annualNoiManwon =
    annualNoiByPoolManwon.residentialLease +
    annualNoiByPoolManwon.retailLease +
    annualNoiByPoolManwon.officeLease;

  return {
    modelVersion: REVENUE_VALUATION_MODEL_VERSION,
    areas: normalizedAreas,
    pricing,
    valueByPoolManwon,
    annualPotentialRentByPoolManwon,
    annualEffectiveGrossIncomeByPoolManwon,
    annualOperatingExpenseByPoolManwon,
    annualNoiByPoolManwon,
    saleRevenueManwon,
    capitalizedLeaseValueManwon,
    totalRevenueManwon: saleRevenueManwon + capitalizedLeaseValueManwon,
    annualNoiManwon,
  };
}
