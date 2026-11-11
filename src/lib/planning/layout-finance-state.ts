import { z } from "zod";
import type { FloorZone, PlanningCheck, PlanningScenario } from "./types";

export const LAYOUT_FINANCE_VERSION = "layout-finance-2026.1" as const;
export const layoutFinanceOptionsSchema = z.object({
  areaBasis: z.enum(["unit-clear", "room-clear"]),
  floorIds: z.array(z.string().min(1).max(120)).min(1).max(100),
});
export type LayoutFinanceOptions = z.infer<typeof layoutFinanceOptionsSchema>;
const id = z.string().min(1).max(120);
const area = z.number().finite().min(0).max(1e7);
const zoneSchema = z.object({
  id, useType: z.enum(["residential", "retail", "office", "parking", "piloti", "common", "mechanical", "storage", "other"]),
  label: z.string().max(500).optional(), areaSqm: area, unitCount: z.number().int().min(0).max(10000),
  revenueModel: z.enum(["sale", "lease", "non-revenue"]).optional(),
  saleableAreaSqm: area.optional(), rentableAreaSqm: area.optional(), parkingExclusiveAreaSqm: area.optional(),
  parkingExclusiveAreaStatus: z.enum(["user-entered", "source-backed", "expert-approved"]).optional(),
}).passthrough();
const key = z.string().regex(/^PG-LAYOUT-[0-9a-f]{16}$/);
export const layoutFinanceHistorySchema = z.array(z.object({
  id, version: z.literal(LAYOUT_FINANCE_VERSION), appliedAt: z.string().datetime(),
  revertedAt: z.string().datetime().optional(), options: layoutFinanceOptionsSchema,
  sourceKey: key, beforeBinding: key, resultKey: key,
  beforeFloors: z.array(z.object({
    floorId: id, zones: z.array(zoneSchema).min(1).max(100),
    programBasis: z.string().max(20000),
    unitLinks: z.array(z.object({ beforeId: id, afterId: id, beforeZoneId: id, afterZoneId: id })).max(20),
    roomBases: z.array(z.object({ unitId: id, parentBasis: z.string().max(60000) })).max(20),
  })).min(1).max(100),
  beforeExitBasis: z.string().max(60000).optional(),
  beforeRevenueAreaSqm: area, afterRevenueAreaSqm: area,
  profitDeltaManwon: z.number().finite(),
})).max(10);
type HistoryEntry = z.infer<typeof layoutFinanceHistorySchema>[number];
export type LayoutFinanceApplication = Omit<HistoryEntry, "beforeFloors"> & {
  beforeFloors: Array<Omit<HistoryEntry["beforeFloors"][number], "zones"> & { zones: FloorZone[] }>;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Change detection only; professional approval and server audit signatures are separate. */
export function layoutFinanceKey(value: unknown): string {
  const text = JSON.stringify(canonical(value));
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n);
  return "PG-LAYOUT-" + hash.toString(16).padStart(16, "0");
}
export function layoutFinanceBinding(scenario: PlanningScenario): string {
  return layoutFinanceKey({ id: scenario.id, projectId: scenario.projectId, floors: scenario.floorPrograms,
    placement: scenario.placement, parking: scenario.parking, egress: scenario.egressPlan, use: scenario.primaryUse });
}
export function layoutFinancePlanningCheck(scenario: PlanningScenario): PlanningCheck | null {
  const last = scenario.layoutFinanceHistory?.filter(h => !h.revertedAt).at(-1);
  if (!last) return null;
  const current = last.resultKey === layoutFinanceBinding(scenario);
  return { code: "layout-finance-adoption", label: "평면 기반 면적 반영", status: current ? "review" : "unknown",
    message: current ? "평면 유효면적을 사용자 가정으로 반영했습니다. 법정 전용면적·허가·전문가 승인은 미확정입니다."
      : "면적 반영 후 평면·주차·코어 또는 프로그램이 변경됐습니다. 사업성 연결 비교안을 다시 확인해야 합니다.",
    source: LAYOUT_FINANCE_VERSION };
}
