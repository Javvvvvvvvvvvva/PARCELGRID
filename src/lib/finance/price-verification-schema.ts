import { z } from "zod";

const priceComparableSchema = z.object({
  id: z.string(),
  address: z.string(),
  date: z.string(),
  type: z.string(),
  lotAreaSqm: z.number().finite(),
  pricePerPyeongManwon: z.number().finite(),
});

// Consumer-safe persisted shape, not approval readiness. Incomplete drafts remain valid.
export const priceVerificationRecordSchema = z.object({
  projectId: z.string(),
  target: z.enum(["acquisition", "sale"]),
  status: z.enum(["draft", "review-requested", "verified", "rejected"]),
  selectedComps: z.array(priceComparableSchema).max(10_000),
  medianPricePerPyeongManwon: z.number().finite(),
  adjustmentPct: z.number().finite(),
  verifiedPricePerPyeongManwon: z.number().finite(),
  verifiedTotalManwon: z.number().finite(),
  verifiedPricePerSqmWon: z.number().finite(),
  reviewer: z.string(),
  organization: z.string(),
  rationale: z.string(),
  sourceModelVersion: z.string().nullable().optional(),
  verifiedAt: z.string(),
  updatedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
});
