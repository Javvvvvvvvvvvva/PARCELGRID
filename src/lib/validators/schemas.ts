/**
 * Zod schemas for API input/output validation.
 *
 * These are the API contract. Every route handler validates with these
 * before touching the engine; every client-side form validates with these
 * before submitting. Type safety end-to-end.
 */

import { z } from "zod";

export const assumptionSetSchema = z.object({
  rentPerSqMMonth: z.number().min(0).max(500_000),
  salePricePerSqM: z.number().min(0).max(100_000_000),
  vacancyRate: z.number().min(0).max(100),
  capRate: z.number().min(0.1).max(20),

  constCostPerSqM: z.number().min(0).max(50_000_000),
  softCostRate: z.number().min(0).max(40),
  contingencyRate: z.number().min(0).max(20),

  ltcTarget: z.number().min(0).max(95),
  interestRate: z.number().min(0).max(20),
  equityIRR: z.number().min(0).max(50),

  leaseUpMonths: z.number().int().min(0).max(60),
  salesPaceMonthlyPct: z.number().min(0).max(100),

  designMonths: z.number().int().min(0).max(60),
  constructionMonths: z.number().int().min(1).max(120),
  saleOutMonths: z.number().int().min(0).max(60),
});

export const buildingProgramSchema = z.object({
  type: z.enum([
    "officetel",
    "urban-housing",
    "retail",
    "coliving",
    "office",
    "mixed",
  ]),
  far: z.number().min(0).max(2000),
  bcr: z.number().min(0).max(100),
  floorsAbove: z.number().int().min(1).max(80),
  floorsBelow: z.number().int().min(0).max(10),
  units: z.object({
    residential: z.number().int().min(0),
    retail: z.number().int().min(0),
  }),
  mix: z
    .object({
      residentialSale: z.number().min(0).max(1),
      residentialLease: z.number().min(0).max(1),
      retail: z.number().min(0).max(1),
    })
    .refine(
      (m) => Math.abs(m.residentialSale + m.residentialLease + m.retail - 1) < 0.01,
      "Mix proportions must sum to 1.0"
    ),
});

export const parcelSchema = z.object({
  id: z.string(),
  address: z.string().min(1),
  addressRoad: z.string(),
  lotArea: z.number().min(1).max(1_000_000),
  zoning: z.string(),
  zoneCode: z.string(),
  maxFAR: z.number().min(0).max(2000),
  maxBCR: z.number().min(0).max(100),
  heightLimit: z.number().min(0).max(500),
  setback: z.object({
    road: z.number().min(0).max(50),
    side: z.number().min(0).max(50),
    rear: z.number().min(0).max(50),
  }),
  landPrice: z.number().min(0),
  estMarketPrice: z.number().min(0),
  acquired: z.string(),
  acquiredPrice: z.number().min(0),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const scenarioSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  shortName: z.string(),
  tag: z.string().optional(),
  program: buildingProgramSchema,
  assumptions: assumptionSetSchema,
});

export const calcRequestSchema = z.object({
  parcel: parcelSchema,
  scenario: scenarioSchema,
});

export const sensitivityRequestSchema = z.object({
  parcel: parcelSchema,
  scenario: scenarioSchema,
  paramX: z.string(),
  paramY: z.string(),
  xValues: z.array(z.number()).optional(),
  yValues: z.array(z.number()).optional(),
});

export type CalcRequest = z.infer<typeof calcRequestSchema>;
export type ParcelInput = z.infer<typeof parcelSchema>;
export type ScenarioInput = z.infer<typeof scenarioSchema>;
