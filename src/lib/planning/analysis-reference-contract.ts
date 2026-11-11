import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Parcel } from "@/lib/finance/types";
import { validateJsonStructure } from "@/lib/http/bounded-json";
import { representativeParcelBasis } from "./representative-basis";
import type { PlanningScenario } from "./types";
import type { PlanningGeometrySnapshot } from "./planning-geometry";

export const ANALYSIS_REFERENCE_VERSION = "analysis-reference-2026.1" as const;
export const ANALYSIS_REFERENCE_NOTICE = "예비 분석 기준안 · 공식 경계·허가·전문가 승인 미확정";
export const analysisReferenceSchema = z.object({
  version: z.literal(ANALYSIS_REFERENCE_VERSION),
  purpose: z.literal("preliminary-analysis"),
  approvalStatus: z.literal("unverified"),
  selectedAt: z.string().datetime(),
  inputKey: z.string().regex(/^PG-ANALYSIS-[a-f0-9]{64}$/),
  unresolved: z.array(z.object({
    code: z.string().min(1).max(200),
    status: z.enum(["review", "unknown"]),
    message: z.string().min(1).max(4000),
  }).strict()).max(256),
}).strict();
export type AnalysisReferenceSelection = z.infer<typeof analysisReferenceSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function analysisReferenceInputBasis(scenario: PlanningScenario, parcel: Parcel, geometry: PlanningGeometrySnapshot) {
  return { version: ANALYSIS_REFERENCE_VERSION, projectId: parcel.id, scenarioId: scenario.id, scenarioVersion: scenario.version,
    floors: scenario.floorPrograms, placement: scenario.placement, parking: scenario.parking, egress: scenario.egressPlan,
    geometrySource: scenario.geometrySource,
    primaryUse: scenario.primaryUse, dwellingProgram: scenario.dwellingProgram, layoutFinanceHistory: scenario.layoutFinanceHistory,
    quantityCost: scenario.quantityCost, fullQuoteAdoption: scenario.fullQuoteAdoption,
    constructionQuote: scenario.constructionQuote, parcelBasis: representativeParcelBasis(parcel), geometryHash: geometry.geometryHash };
}

/** Change binding only. Approval and the server review seal remain separate. */
export function analysisReferenceInputKey(scenario: PlanningScenario, parcel: Parcel, geometry: PlanningGeometrySnapshot): string {
  const raw = analysisReferenceInputBasis(scenario, parcel, geometry);
  if (!validateJsonStructure(raw, { maxDepth: 32, maxNodes: 100000 }).ok) throw new Error("예비 분석 입력 한도를 초과했습니다.");
  const json = JSON.stringify(canonical(raw));
  if (json.length > 2_000_000) throw new Error("예비 분석 입력 한도를 초과했습니다.");
  return `PG-ANALYSIS-${bytesToHex(sha256(new TextEncoder().encode(json)))}`;
}

export function analysisReferenceIsCurrent(scenario: PlanningScenario, parcel: Parcel | undefined, geometry: PlanningGeometrySnapshot): boolean {
  const parsed = analysisReferenceSchema.safeParse(geometry.analysisReference);
  if (!parsed.success || !parcel) return false;
  try {
    return geometry.projectId === parcel.id && geometry.scenarioId === scenario.id && geometry.scenarioVersion === scenario.version &&
      parsed.data.inputKey === analysisReferenceInputKey(scenario, parcel, geometry);
  } catch { return false; }
}
