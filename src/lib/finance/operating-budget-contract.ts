import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { leaseRollBasis } from "./lease-roll-contract";
import type { Scenario } from "./types";

export const OPERATING_BUDGET_VERSION = "operating-budget-2026.1" as const;
export const OPERATING_COST_CATEGORIES = [
  "property-tax", "insurance", "routine-maintenance", "management", "utilities", "other",
] as const;
export type OperatingCostCategory = typeof OPERATING_COST_CATEGORIES[number];

const id = z.string().trim().min(1).max(200);
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2199-12-31");
const calendar = date.refine(value => value.endsWith("-01"), "비교 시작일은 월의 첫날이어야 합니다.").nullable();
const amountSchema = z.object({
  month: z.string().regex(/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/),
  amountWon: z.number().finite().min(0).max(1e13).nullable(),
}).strict();
const categorySchema = z.object({
  category: z.enum(OPERATING_COST_CATEGORIES),
  sourceName: z.string().max(300),
  sourceRef: z.string().max(1000),
  sourceAsOf: date.nullable(),
  amounts: z.array(amountSchema).max(24).superRefine((amounts, context) => {
    const months = new Set<string>();
    for (const [index, amount] of amounts.entries()) {
      if (months.has(amount.month)) context.addIssue({ code: "custom", path: [index, "month"], message: "운영비 월이 중복됩니다." });
      months.add(amount.month);
    }
  }),
}).strict();

export const operatingBudgetDraftSchema = z.object({
  version: z.literal(OPERATING_BUDGET_VERSION),
  projectId: id,
  scenarioId: id,
  sourceBasis: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().min(0).max(1e9),
  updatedAt: z.iso.datetime(),
  calendarStart: calendar,
  baselineCalendarStart: calendar,
  // Acknowledges the full retained portfolio, vacant/unassigned space and owner common costs.
  scopeConfirmed: z.boolean(),
  allocationNote: z.string().max(2000),
  // Owner-borne operating costs net of recoveries, including nonrecoverable tax.
  // Excludes debt, income tax, CAPEX, reserves, tenant improvements and commissions.
  categories: z.array(categorySchema).max(6).superRefine((categories, context) => {
    const seen = new Set<OperatingCostCategory>();
    for (const [index, item] of categories.entries()) {
      if (seen.has(item.category)) context.addIssue({ code: "custom", path: [index, "category"], message: "운영비 항목이 중복됩니다." });
      seen.add(item.category);
    }
  }),
}).strict();

export type OperatingBudgetDraft = z.infer<typeof operatingBudgetDraftSchema>;

function emptyCategory(category: OperatingCostCategory): OperatingBudgetDraft["categories"][number] {
  return { category, sourceName: "", sourceRef: "", sourceAsOf: null, amounts: [] };
}

export function buildOperatingBudgetDraftKey(projectId: string, scenarioId: string): string {
  return JSON.stringify([projectId, scenarioId]);
}

export function operatingBudgetBasis(projectId: string, scenario: Scenario): string {
  // Tuple order is stable through PostgreSQL JSONB object-key reordering.
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
    OPERATING_BUDGET_VERSION, leaseRollBasis(projectId, scenario),
  ]))));
}

export function createOperatingBudgetDraft(
  projectId: string,
  scenario: Scenario,
  now = new Date().toISOString(),
): OperatingBudgetDraft {
  return operatingBudgetDraftSchema.parse({
    version: OPERATING_BUDGET_VERSION, projectId, scenarioId: scenario.id,
    sourceBasis: operatingBudgetBasis(projectId, scenario), revision: 0, updatedAt: now,
    calendarStart: null, baselineCalendarStart: null, scopeConfirmed: false, allocationNote: "",
    categories: OPERATING_COST_CATEGORIES.map(emptyCategory),
  });
}

export function resetOperatingBudgetCalendar(
  draft: OperatingBudgetDraft,
  calendarStart: string | null,
): OperatingBudgetDraft {
  const parsed = operatingBudgetDraftSchema.parse(draft);
  const anchor = calendar.parse(calendarStart);
  const months: string[] = [];
  if (anchor !== null) {
    const year = Number(anchor.slice(0, 4));
    const month = Number(anchor.slice(5, 7)) - 1;
    if (Date.UTC(year, month + 24, 1) > Date.UTC(2200, 0, 1)) {
      throw new Error("24개월 비교 기간은 2199-12-31 이내에 끝나야 합니다.");
    }
    for (let index = 0; index < 24; index++) {
      months.push(new Date(Date.UTC(year, month + index, 1)).toISOString().slice(0, 7));
    }
  }
  return {
    ...parsed, calendarStart: anchor, scopeConfirmed: false,
    categories: OPERATING_COST_CATEGORIES.map(category => ({
      ...(parsed.categories.find(item => item.category === category) ?? emptyCategory(category)),
      amounts: months.map(month => ({ month, amountWon: null })),
    })),
  };
}
