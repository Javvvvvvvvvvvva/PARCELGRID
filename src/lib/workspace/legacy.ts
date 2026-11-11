import type { StoredParcel } from "@/lib/hooks/use-dynamic-project";
import type { WorkspaceDatabase } from "./database";
import { digestText, emptyWorkspace, invalidateWorkspaceResults, validateWorkspaceDocument, type WorkspaceDocument } from "./document";

export interface LegacyValues { envelope: string | null; review: string | null; draft: string | null }
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
export function readLegacyValues(): LegacyValues {
  // Never remove or rewrite the old keys, even after successful migration.
  return { envelope: localStorage.getItem("parcelgrid-envelope"), review: localStorage.getItem("parcelgrid-review-workflow"), draft: sessionStorage.getItem("parcelgrid:draft-parcel") };
}
export function prepareLegacy(values: LegacyValues): { documents: WorkspaceDocument[]; issues: string[] } {
  const issues: string[] = [];
  const parse = (raw: string | null, label: string, persisted: boolean): ObjectValue => {
    if (!raw) return {};
    try {
      const parsed = object(JSON.parse(raw));
      if (persisted && parsed.version !== undefined && parsed.version !== 0) throw new Error("version");
      return persisted ? object(parsed.state) : parsed;
    } catch { issues.push(`${label} 원본을 자동 복원하지 못했습니다.`); return {}; }
  };
  const state = parse(values.envelope, "계획", true), review = parse(values.review, "검토", true), draft = parse(values.draft, "부지", false);
  const scenarios = Array.isArray(state.planningScenarios) ? state.planningScenarios.map(object) : [];
  const projectIds = new Set<string>();
  if (typeof draft.id === "string") projectIds.add(draft.id);
  for (const scenario of scenarios) {
    if (typeof scenario.projectId === "string") projectIds.add(scenario.projectId);
    else issues.push("부지 ID가 없는 옛 계획은 원본 백업에 보존했습니다.");
  }
  for (const map of [state.draftAcquisitionPrices, state.financialSources, state.stage3FeasibilitySnapshots, review.priceVerifications, review.expertReviews]) Object.keys(object(map)).forEach(key => projectIds.add(key));
  const documents: WorkspaceDocument[] = [];
  for (const projectId of projectIds) {
    try {
      const document = emptyWorkspace(projectId, draft.id === projectId ? draft as unknown as StoredParcel : null);
      const p = document.payload, plans = scenarios.filter(s => s.projectId === projectId), ids = new Set(plans.map(s => s.id));
      p.planningScenarios = plans as unknown as typeof p.planningScenarios;
      p.selectedScenarioId = typeof state.selectedPlanningScenarioId === "string" && ids.has(state.selectedPlanningScenarioId) ? state.selectedPlanningScenarioId : null;
      p.draftAssumptions = Object.fromEntries(Object.entries(object(state.draftAssumptions)).filter(([key]) => ids.has(key))) as typeof p.draftAssumptions;
      p.draftAcquisitionPrice = typeof object(state.draftAcquisitionPrices)[projectId] === "number" ? object(state.draftAcquisitionPrices)[projectId] as number : null;
      p.financialSources = object(object(state.financialSources)[projectId]) as typeof p.financialSources;
      p.priceVerifications = object(object(review.priceVerifications)[projectId]) as typeof p.priceVerifications;
      p.expertReviews = object(object(review.expertReviews)[projectId]) as typeof p.expertReviews;
      // The old global envelope/approval has no reliable intake revision; the raw backup retains it.
      documents.push(validateWorkspaceDocument(invalidateWorkspaceResults(document)));
    } catch { issues.push(`${projectId} 자료 형식을 확인해야 합니다. 원본 백업을 보존했습니다.`); }
  }
  return { documents, issues: [...new Set(issues)] };
}

export async function migrateLegacy(database: WorkspaceDatabase, values: LegacyValues): Promise<string[]> {
  const prepared = prepareLegacy(values), savedAt = new Date().toISOString();
  const globalValues = { envelope: values.envelope, review: values.review };
  const globalId = `local-${await digestText(JSON.stringify(globalValues))}`;
  const draftId = `session-${await digestText(values.draft ?? "")}`;
  await database.transaction("rw", database.projects, database.history, database.legacyBackups, async () => {
    if ((values.envelope || values.review) && !await database.legacyBackups.get(globalId)) await database.legacyBackups.add({ id: globalId, savedAt, values: globalValues, issues: prepared.issues });
    if (values.draft && !await database.legacyBackups.get(draftId)) await database.legacyBackups.add({ id: draftId, savedAt, values: { draft: values.draft }, issues: prepared.issues });
    for (const document of prepared.documents) {
      const existing = await database.projects.get(document.projectId);
      if (!existing) await database.save(document, null, "기존 브라우저 자료 이전");
      else if (!existing.intake && document.intake) await database.save({ schemaVersion: 1, projectId: existing.projectId, intake: document.intake, payload: existing.payload }, existing.revision, "기존 부지 입력 연결");
    }
  });
  return prepared.issues;
}
