import { z } from "zod";

const money = z.number().finite().min(0).max(1e13);
const area = z.number().finite().min(0).max(1e9);
export const facadeMaterialSchema = z.enum(["unselected", "standard-render", "brick-veneer", "exposed-concrete", "metal-panel"]);
export const materialEvidenceSchema = z.object({
  status: z.enum(["unpriced", "user-input", "source-backed"]),
  sourceName: z.string().optional(), sourceUrl: z.string().optional(),
  observedAt: z.string().optional(), note: z.string().optional(),
}).strict();
export const planningMaterialSelectionSchema = z.object({
  primaryFacadeMaterial: facadeMaterialSchema,
  secondaryFacadeMaterial: facadeMaterialSchema.optional(),
  primaryFacadeSharePct: z.number().finite().min(0).max(100).optional(),
  windowRatioPct: z.number().finite().min(0).max(80).optional(),
  facadeAreaOverrideSqm: area.optional(),
  baselineFacadeUnitCostPerSqmWon: money.optional(),
  selectedFacadeUnitCostPerSqmWon: money.optional(),
  rateEvidence: materialEvidenceSchema.optional(),
  pricingMode: z.enum(["assembly", "by-material"]).optional(),
  faceAssignments: z.record(z.string().regex(/^face-[0-9a-f]{8}$/), z.object({
    material: facadeMaterialSchema.optional(), exposure: z.enum(["exposed", "shared", "unknown"]).optional(),
    openingAreaSqm: area.optional(),
  }).strict()).refine(value => Object.keys(value).length <= 4096).optional(),
  materialRates: z.partialRecord(facadeMaterialSchema, z.object({
    baselineWonPerSqm: money.optional(), selectedWonPerSqm: money.optional(), evidence: materialEvidenceSchema.optional(),
  }).strict()).optional(),
}).strict();
