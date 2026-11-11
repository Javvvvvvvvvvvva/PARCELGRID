import { z } from "zod";
import {
  FINANCIAL_REVENUE_POOL_KEYS,
  REVENUE_PRICE_ADJUSTMENT_DIMENSIONS,
  REVENUE_PRICING_INPUT_VERSION,
} from "@/lib/finance/revenue-contract";

const pricingId = z.string().min(1).max(300).refine(value => value === value.trim());

export const revenuePricingDraftSchema = z.object({
  version: z.literal(REVENUE_PRICING_INPUT_VERSION),
  projectId: pricingId,
  scenarioId: pricingId,
  pools: z.partialRecord(z.enum(FINANCIAL_REVENUE_POOL_KEYS), z.object({
    baseUnitPriceWon: z.number().finite().nonnegative().optional(),
    adjustments: z.partialRecord(z.enum(REVENUE_PRICE_ADJUSTMENT_DIMENSIONS),
      z.number().finite().positive().max(10)).optional(),
  }).strict()),
  updatedAt: z.iso.datetime(),
}).strict();
