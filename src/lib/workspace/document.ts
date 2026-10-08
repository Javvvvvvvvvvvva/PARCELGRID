import { z } from "zod";
import type { StoredParcel } from "@/lib/hooks/use-dynamic-project";
import type { ProjectTransferPayload } from "@/lib/handoff/project-transfer";
import { interiorLayoutSchema } from "@/lib/planning/interior/types";
import { buildingRegistryEvidenceSchema } from "@/lib/building-registry/types";

export const WORKSPACE_SCHEMA = 1 as const;
export const MAX_BACKUP_BYTES = 20_000_000;
export interface WorkspaceDocument {
  schemaVersion: typeof WORKSPACE_SCHEMA;
  projectId: string;
  intake: StoredParcel | null;
  payload: ProjectTransferPayload;
}
export interface WorkspaceRecord extends WorkspaceDocument {
  revision: string;
  savedAt: string;
  reason: string;
}
const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/).refine(value => !["__proto__", "prototype", "constructor"].includes(value));
const number = z.number().finite();
const record = z.record(z.unknown());
const coordinate = z.tuple([number, number]);
const text = z.string();
const sourceMetadata = z.object({ sourceName: text, sourceRef: text.optional(), asOf: text.optional(), retrievedAt: text.optional(), checkedBy: text.optional(), checkedRole: text.optional(), note: text.optional() });
const constraint = sourceMetadata.extend({ value: number.nullable(), unit: z.enum(["%", "m", "층"]), status: z.enum(["unknown", "reference-only", "user-entered", "source-backed", "expert-approved"]), referenceValue: number.nullable().optional(), referenceSourceName: text.optional(), referenceSourceRef: text.optional() });
const financialSource = z.object({ field: text, value: number, sourceKind: z.enum(["official-api", "signed-contract", "professional-quote", "lender-term-sheet", "appraisal", "approved-policy"]),
  sourceName: text, documentRef: text, asOf: text, verifiedBy: text, recordedAt: text,
  document: z.object({ pathname: text, fileName: text, contentType: text, size: number.nonnegative(), sha256: text, uploadedAt: text }).optional(),
});
const priceVerification = z.object({ projectId: id, target: z.enum(["acquisition", "sale"]), status: z.enum(["draft", "review-requested", "verified", "rejected"]),
  selectedComps: z.array(z.object({ id: text, address: text, date: text, type: text, lotAreaSqm: number, pricePerPyeongManwon: number })).max(10000),
  medianPricePerPyeongManwon: number, adjustmentPct: number, verifiedPricePerPyeongManwon: number, verifiedTotalManwon: number, verifiedPricePerSqmWon: number,
  reviewer: text, organization: text, rationale: text, sourceModelVersion: text.nullable().optional(), verifiedAt: text, updatedAt: text,
});
const expertReview = z.object({ discipline: z.enum(["architect", "developer", "finance-tax", "sales-marketing"]), status: z.enum(["not-requested", "requested", "approved", "changes-requested"]),
  reviewer: text, organization: text, evidenceRef: text, notes: text, reviewedAt: text, updatedAt: text, snapshotKey: text.optional(),
});
const facade = z.enum(["unselected", "standard-render", "brick-veneer", "exposed-concrete", "metal-panel"]);
const materialEvidence = z.object({ status: z.enum(["unpriced", "user-input", "source-backed"]), sourceName: text.optional(), sourceUrl: text.optional(), observedAt: text.optional(), note: text.optional() });
const materialRate = z.object({ baselineWonPerSqm: number.nonnegative().optional(), selectedWonPerSqm: number.nonnegative().optional(), evidence: materialEvidence.optional() });
const building = z.object({ name: text, mainPurpose: text, detailPurpose: text, groundFloors: number, undergroundFloors: number, totalArea: number,
  buildingArea: number, buildingCoverage: number, floorAreaRatio: number, structure: text, height: number, approvalDate: text, ageYears: number,
  isMainBuilding: z.boolean(), householdCount: number, familyCount: number, unitCount: number,
}).passthrough();
const intakeSchema = z.object({ id, address: z.string(), addressRoad: z.string().nullable(), lat: number.min(33).max(39.5), lng: number.min(124).max(132),
  pnu: z.string().nullable(), lotArea: number.positive(), lawdCd: z.string(), zoning: z.string(), zoneCode: z.string(),
  maxFAR: number.nonnegative(), maxBCR: number.nonnegative(), heightLimit: number.nonnegative(), landPrice: number.nonnegative(), landPriceYear: z.string(),
  acquired: z.string(), acquiredPrice: number.nonnegative().nullable(), intakeRevision: z.string().optional(), boundary: z.array(coordinate).min(3).max(10000).optional(),
  roads: z.array(z.object({ name: text.nullable(), points: z.array(coordinate).max(10000) })).max(5000).optional(),
  setback: z.object({ road: number, side: number, rear: number }).optional(), estMarketPrice: number.optional(), demolitionCost: number.optional(),
  regulatoryConstraints: z.object({ version: z.literal("regulatory-provenance-2026.1"), retrievedAt: text, zoningSource: sourceMetadata.extend({ status: z.enum(["source-backed", "unknown"]) }), far: constraint, bcr: constraint, height: constraint, floors: constraint }).optional(),
  overlays: z.array(z.object({ code: text, name: text, conflict: text })).optional(),
  inputProvenance: z.object({ mode: z.enum(["vworld", "manual"]), parcelFacts: z.enum(["vworld-cadastral", "user-entered"]), geometry: z.enum(["vworld-cadastral", "user-geojson", "unavailable"]), zoning: z.enum(["vworld-land-use", "user-entered"]), recordedAt: text, note: text.optional() }).optional(),
  currentBuilding: z.object({ buildings: z.array(building).max(1000), hasBuilding: z.boolean(), totalBuildingArea: number, oldestApprovalDate: text, maxAgeYears: number,
    averageAgeYears: number, redevelopmentSignal: z.enum(["vacant", "rebuild", "renovate", "keep", "unknown"]), signalLabel: text, signalReasoning: text,
    registry: buildingRegistryEvidenceSchema.optional(), source: z.enum(["building-registry", "vworld-gis"]).optional(),
  }).nullable().optional(),
}).passthrough();
const scenarioSchema = z.object({
  id, projectId: id, name: z.string(), version: number.int().nonnegative(), createdAt: z.string(), updatedAt: z.string(),
  status: z.enum(["draft", "saved", "archived"]), origin: z.enum(["algorithm-safe", "algorithm-balanced", "algorithm-max", "custom", "legacy"]),
  primaryUse: z.enum(["single-house", "multi-family", "retail", "mixed", "office"]),
  floorPrograms: z.array(z.object({ id, level: number.int(), label: z.string(), floorHeightM: number, footprintScalePct: number, northSetbackM: number,
    interior: interiorLayoutSchema.optional(), zones: z.array(z.object({ id, useType: z.enum(["residential", "retail", "office", "parking", "piloti", "common", "mechanical", "storage", "other"]), areaSqm: number, unitCount: number }).passthrough()).max(200),
  }).passthrough()).max(200),
  placement: z.object({ rotationDeg: number, offsetXM: number, offsetZM: number, roadSetbackM: number, northSetbackM: number }).passthrough(),
  parking: z.object({ strategy: z.enum(["none", "surface", "piloti", "basement", "mechanical", "mixed"]), providedCars: number, notes: text.optional(), orientation: z.enum(["auto", "parallel-front", "perpendicular-front"]).optional(), stallWidthM: number.optional(), stallDepthM: number.optional(), aisleWidthM: number.optional(), entryWidthM: number.optional(), coreAreaSqm: number.optional(), columnLossPct: number.optional() }),
  economicsPreview: z.object({ status: z.enum(["not-calculated", "estimated", "stale"]), acquisitionCostManwon: number, demolitionCostManwon: number, constructionCostManwon: number, softCostManwon: number, contingencyCostManwon: number, financingCostManwon: number, totalCostManwon: number, saleRevenueManwon: number, capitalizedLeaseValueManwon: number, expectedRevenueManwon: number, expectedAnnualNoiManwon: number, profitManwon: number, profitMarginPct: number }).passthrough(),
  geometrySource: z.object({ mode: z.enum(["engine-generated", "external-model", "reference-image"]), exactGeometryAvailable: z.boolean(), locked: z.boolean(), sourceName: text.optional(), sourceFormat: z.enum(["dae", "glb", "dxf"]).optional(), sourceGeometryHash: text.optional(), lockedGeometryHash: text.optional() }).passthrough().optional(),
  materials: z.object({
    pricingMode: z.enum(["assembly", "by-material"]).optional(),
    faceAssignments: z.record(z.string().regex(/^face-[0-9a-f]{8}$/), z.object({ material: facade.optional(), exposure: z.enum(["exposed", "shared", "unknown"]).optional(), openingAreaSqm: number.nonnegative().optional() })).optional(),
    materialRates: z.record(facade, materialRate).optional(),
    primaryFacadeMaterial: facade, secondaryFacadeMaterial: facade, primaryFacadeSharePct: number, windowRatioPct: number, facadeAreaOverrideSqm: number.optional(), baselineFacadeUnitCostPerSqmWon: number.optional(), selectedFacadeUnitCostPerSqmWon: number.optional(), rateEvidence: z.object({ status: z.enum(["unpriced", "user-input", "source-backed"]), sourceName: text.optional(), sourceUrl: text.optional(), observedAt: text.optional(), note: text.optional() }).optional() }).optional(),
  checks: z.array(z.object({ code: z.string(), label: z.string(), status: z.enum(["pass", "review", "fail", "unknown"]), message: z.string() }).passthrough()).max(2000),
}).passthrough();
const documentSchema = z.object({ schemaVersion: z.literal(WORKSPACE_SCHEMA), projectId: id, intake: intakeSchema.nullable(), payload: z.object({
  projectData: z.null(), envelopePlan: record.nullable(), planningScenarios: z.array(scenarioSchema).max(300),
  selectedScenarioId: id.nullable(), representativeScenarioId: id.nullable(), representativeGeometry: record.nullable(),
  draftAssumptions: z.record(z.record(number)), draftAcquisitionPrice: number.nullable(), financialSources: z.record(financialSource),
  stage3Snapshot: record.nullable(), priceVerifications: z.record(priceVerification), expertReviews: z.record(expertReview),
}).strict() }).strict();

/** Check serializable structure before persisting or applying a downloaded backup. */
export function validateWorkspaceDocument(raw: unknown): WorkspaceDocument {
  assertJsonInput(raw);
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) throw new Error("저장 자료의 버전 또는 형식이 올바르지 않습니다.");
  // Validate without normalizing: Zod reorders object keys and can invalidate existing
  // order-sensitive interior/geometry signatures despite unchanged coordinates.
  const result = structuredClone(raw) as WorkspaceDocument;
  if (result.intake && result.intake.id !== result.projectId) throw new Error("부지 ID가 저장 프로젝트와 다릅니다.");
  if (result.payload.planningScenarios.some(s => s.projectId !== result.projectId)) throw new Error("다른 부지의 계획안이 섞여 있습니다.");
  const ids = new Set(result.payload.planningScenarios.map(s => s.id));
  if (ids.size !== result.payload.planningScenarios.length) throw new Error("계획안 ID가 중복됐습니다.");
  for (const selected of [result.payload.selectedScenarioId, result.payload.representativeScenarioId]) if (selected && !ids.has(selected)) throw new Error("선택한 계획안이 저장 목록에 없습니다.");
  if (result.payload.representativeGeometry && result.payload.representativeGeometry.projectId !== result.projectId) throw new Error("Geometry의 부지 ID가 다릅니다.");
  if (result.payload.stage3Snapshot && result.payload.stage3Snapshot.projectId !== result.projectId) throw new Error("사업성 저장본의 부지 ID가 다릅니다.");
  for (const [key, value] of Object.entries(result.payload.priceVerifications)) if (value.projectId !== result.projectId || value.target !== key) throw new Error("가격 검토의 부지 또는 대상이 다릅니다.");
  for (const [key, value] of Object.entries(result.payload.expertReviews)) if (value.discipline !== key) throw new Error("검토 분야가 일치하지 않습니다.");
  for (const [key, value] of Object.entries(result.payload.financialSources)) if (value.field !== key) throw new Error("재무 근거의 항목이 일치하지 않습니다.");
  return result;
}

function assertJsonInput(raw: unknown) {
  let count = 0;
  const visit = (value: unknown, depth: number) => {
    if (++count > 500000 || depth > 40) throw new Error("저장 자료의 크기나 중첩 깊이가 허용 범위를 넘었습니다.");
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("저장 자료에 유효하지 않은 숫자가 있습니다.");
    if (value && typeof value === "object") {
      if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("지원하지 않는 저장 자료입니다.");
      for (const [key, child] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("지원하지 않는 저장 키입니다.");
        visit(child, depth + 1);
      }
    } else if (!["string", "number", "boolean", "undefined"].includes(typeof value) && value !== null) throw new Error("지원하지 않는 저장 값입니다.");
  };
  visit(raw, 0);
}

export function emptyWorkspace(projectId: string, intake: StoredParcel | null = null): WorkspaceDocument {
  return { schemaVersion: WORKSPACE_SCHEMA, projectId, intake, payload: { projectData: null, envelopePlan: null, planningScenarios: [],
    selectedScenarioId: null, representativeScenarioId: null, representativeGeometry: null, draftAssumptions: {}, draftAcquisitionPrice: null,
    financialSources: {}, stage3Snapshot: null, priceVerifications: {}, expertReviews: {} } };
}

/** Restoring inputs never restores an old approval as approval of the current work. */
export function invalidateWorkspaceResults(document: WorkspaceDocument): WorkspaceDocument {
  const copy = structuredClone(document), p = copy.payload;
  p.envelopePlan = null; p.representativeScenarioId = null; p.representativeGeometry = null; p.stage3Snapshot = null;
  p.expertReviews = Object.fromEntries(Object.entries(p.expertReviews).map(([key, value]) => [key, { ...value, status: value.status === "approved" ? "requested" : value.status, snapshotKey: undefined }]));
  p.priceVerifications = Object.fromEntries(Object.entries(p.priceVerifications).map(([key, value]) => [key, value.status === "verified" ? { ...value, status: "review-requested", verifiedAt: "" } : value]));
  p.planningScenarios = p.planningScenarios.map(s => ({ ...s, economicsPreview: { ...s.economicsPreview, status: s.economicsPreview.status === "not-calculated" ? "not-calculated" : "stale" } }));
  return copy;
}

export function documentFromRecord({ schemaVersion, projectId, intake, payload }: WorkspaceDocument): WorkspaceDocument {
  return { schemaVersion, projectId, intake, payload };
}

export async function digestText(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function exportWorkspace(document: WorkspaceDocument): Promise<string> {
  const data = JSON.stringify(validateWorkspaceDocument(document));
  return JSON.stringify({ format: "parcelgrid-workspace-backup", version: 1, data, sha256: await digestText(data) }, null, 2);
}
export async function importWorkspace(serialized: string): Promise<WorkspaceDocument> {
  if (new TextEncoder().encode(serialized).length > MAX_BACKUP_BYTES) throw new Error("백업 파일은 20MB 이하여야 합니다.");
  const raw = JSON.parse(serialized);
  if (raw?.format !== "parcelgrid-workspace-backup" || raw.version !== 1 || typeof raw.data !== "string" || raw.sha256 !== await digestText(raw.data)) throw new Error("지원하지 않거나 손상된 백업 파일입니다.");
  return invalidateWorkspaceResults(validateWorkspaceDocument(JSON.parse(raw.data)));
}
