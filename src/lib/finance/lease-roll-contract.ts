import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Scenario } from "./types";

export const LEASE_ROLL_VERSION = "lease-roll-2026.1" as const;
export const LEASE_USES = ["residential", "retail", "office"] as const;
export const MAX_LEASE_ROWS = 256;
export const MAX_LEASE_IMPORT_BYTES = 8 * 1024 * 1024;
const id = z.string().trim().min(1).max(200);
const money = z.number().finite().min(0).max(1e13).nullable();
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2199-12-31");

export const leaseRollRowSchema = z.object({
  id,
  unitId: id,
  unitLabel: z.string().max(200),
  use: z.enum(LEASE_USES),
  areaSqm: z.number().finite().positive().max(1e6).nullable(),
  // Contract rent excludes VAT and service charges; it is not NOI or realized cash collection.
  monthlyRentWon: money,
  depositWon: money,
  startDate: date.nullable(),
  endDate: date.nullable(),
  sourceName: z.string().max(300),
  sourceRef: z.string().max(1000),
  sourceAsOf: date.nullable(),
}).strict();

export const leaseRollDraftSchema = z.object({
  version: z.literal(LEASE_ROLL_VERSION),
  projectId: id,
  scenarioId: id,
  sourceBasis: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().min(0).max(1e9),
  updatedAt: z.iso.datetime(),
  calendarStart: date.refine(value => value.endsWith("-01"), "비교 시작일은 월의 첫날이어야 합니다.").nullable(),
  rows: z.array(leaseRollRowSchema).max(MAX_LEASE_ROWS),
}).strict().superRefine((draft, context) => {
  const ids = new Set<string>();
  const units = new Map<string, typeof draft.rows>();
  for (const [index, row] of draft.rows.entries()) {
    if (ids.has(row.id)) context.addIssue({ code: "custom", path: ["rows", index, "id"], message: "계약 ID가 중복됩니다." });
    ids.add(row.id);
    if (row.startDate && row.endDate && row.startDate > row.endDate) {
      context.addIssue({ code: "custom", path: ["rows", index, "endDate"], message: "종료일은 시작일보다 빠를 수 없습니다." });
    }
    const prior = units.get(row.unitId) ?? [];
    if (prior.some(other => other.use !== row.use || (other.areaSqm !== null && row.areaSqm !== null && other.areaSqm !== row.areaSqm))) {
      context.addIssue({ code: "custom", path: ["rows", index, "unitId"], message: "동일 호실의 용도·면적이 다릅니다." });
    }
    if (row.startDate && row.endDate && prior.some(other => other.startDate && other.endDate &&
      other.startDate <= row.endDate! && row.startDate! <= other.endDate)) {
      context.addIssue({ code: "custom", path: ["rows", index, "startDate"], message: "동일 호실의 계약 기간이 겹칩니다." });
    }
    units.set(row.unitId, [...prior, row]);
  }
});

export type LeaseRollDraft = z.infer<typeof leaseRollDraftSchema>;
export type LeaseRollRow = LeaseRollDraft["rows"][number];
export type LeaseUse = typeof LEASE_USES[number];

export function buildLeaseRollDraftKey(projectId: string, scenarioId: string): string {
  return JSON.stringify([projectId, scenarioId]);
}

export function leaseRollBasis(projectId: string, scenario: Scenario): string {
  const area = scenario.program.areaContract;
  if (!projectId.trim() || !scenario.id.trim() || !area || !area.sourceScenarioId ||
    !Number.isSafeInteger(area.sourceScenarioVersion) || area.sourceScenarioVersion < 0) {
    throw new Error("호실별 임대 대사에는 계획안과 연결된 면적 계약이 필요합니다.");
  }
  if (area.sourceScenarioId !== scenario.id) throw new Error("면적 계약과 임대차 계획안의 ID가 다릅니다.");
  const pools = area.revenueAreas;
  const values = [pools.residentialSaleSqm, pools.retailSaleSqm, pools.officeSaleSqm,
    pools.residentialLeaseSqm, pools.retailLeaseSqm, pools.officeLeaseSqm];
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error("용도별 면적 계약이 올바르지 않습니다.");
  // Fixed field order keeps the binding stable through PostgreSQL JSONB round-trips.
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
    LEASE_ROLL_VERSION, projectId, scenario.id, area.schemaVersion, area.sourceScenarioId,
    area.sourceScenarioVersion, area.geometrySource?.geometryHash ?? null, values,
  ]))));
}

export function createLeaseRollDraft(projectId: string, scenario: Scenario, now = new Date().toISOString()): LeaseRollDraft {
  return leaseRollDraftSchema.parse({ version: LEASE_ROLL_VERSION, projectId, scenarioId: scenario.id,
    sourceBasis: leaseRollBasis(projectId, scenario), revision: 0, updatedAt: now, calendarStart: null, rows: [] });
}

export function createLeaseRollRow(id: string): LeaseRollRow {
  return { id, unitId: id, unitLabel: "", use: "residential", areaSqm: null, monthlyRentWon: null,
    depositWon: null, startDate: null, endDate: null, sourceName: "", sourceRef: "", sourceAsOf: null };
}
